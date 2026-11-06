/**
 * Runs ProVerif from a web page.
 *
 * The module is compiled once and shared by every run and every runner.
 * 
 * The idea is to keep the page responsive, as ProVerif could take some time.
 * Each run uses a fresh web worker (proverif-worker.js), which receives the
 * compiled module, so that the page stays "responsive" and the run can be
 * stopped at any time.
 *
 * Different story with the file:// protocol, where workers cannot be created.
 * In such case, ProVerif runs in the page itself, where the timeout cannot
 * interrupt it, but the max memory limit is still honoured.
 *
 *
 * @author Roberto Metere
 * @license GPL-2.0-or-later
 */
class ProVerifRunner {

  /**
   * The folder this script was loaded from, with a final slash, or an empty
   * string (the folder of the page) when it is not known.
   *
   * @type {string}
   */
  static FOLDER: string = ProVerifRunner.scriptFolder();

  /**
   * The compiled engine, shared by every runner: a promise of a
   * WebAssembly.Module, or null before the first use.
   *
   * @type {Promise<WebAssembly.Module>|null}
   */
  static compiled: Promise<WebAssembly.Module> | null = null;

  /**
   * The scripts loaded into the page, by URL: promises that resolve when
   * they have run.
   *
   * @type {Object<string, Promise>}
   */
  static scripts: Record<string, Promise<any>> = {};

  /**
   * A small model that the engine verifies once, at load time, so that the
   * browser optimises the interpreter before the first real run.
   *
   * @type {string}
   */
  static WARM_UP_MODEL: string = "free c: channel.\ntype key.\nfun senc(bitstring, key): bitstring.\n"
    + "reduc forall m: bitstring, k: key; sdec(senc(m, k), k) = m.\nfree s: bitstring [private].\n"
    + "query attacker(s).\nprocess new k: key; (out(c, senc(s, k)) | in(c, x: bitstring); out(c, sdec(x, k)))\n";

  folder: string;
  worker: Worker;
  timer: number;
  finish: any;
  useWorker: boolean;

  /**
   * @param {Object} params Where the engine is.
   * @param {string} params.folder The folder of the engine files, absolute
   *   or relative to the page, with a final slash.
   */
  constructor(params?: { folder?: string }) {
    const defaults = {
        folder: ProVerifRunner.FOLDER
    };
    params = {...defaults, ...params};
    this.folder = params.folder;
    this.worker = null;
    this.timer = null;
    this.finish = null;
    this.useWorker = location.protocol !== "file:" && typeof Worker !== "undefined";
  }

  /**
   * Finds the folder of this script while it runs.
   *
   * @return {string} The folder, with a final slash, or an empty string.
   */
  static scriptFolder(): string {
    if (typeof document === "undefined" || !document.currentScript || !(document.currentScript as HTMLScriptElement).src) {
      return "";
    }
    return new URL(".", (document.currentScript as HTMLScriptElement).src).href;
  }

  /**
   * @return {boolean} True while a run is in progress.
   */
  isRunning(): boolean {
    return this.finish !== null;
  }

  /**
   * @return {string} Where ProVerif runs: "worker" or "page".
   */
  getMode(): string {
    return this.useWorker ? "worker" : "page";
  }

  /**
   * Loads ProVerifEngine.js into the page, unless it is there already.
   *
   * @return {Promise} Resolves when ProVerifEngine is defined.
   */
  loadEngineClass(): Promise<any> {
    if (typeof ProVerifEngine === "function") {
      return Promise.resolve();
    }
    return ProVerifRunner.loadScript(this.folder + "ProVerifEngine.js");
  }

  /**
   * Compiles the engine, once for all the runners.
   *
   * @return {Promise<WebAssembly.Module>} The compiled module.
   */
  compile(): Promise<WebAssembly.Module> {
    if (ProVerifRunner.compiled === null) {
      const url = this.folder + "proverif.wasm";
      const fromScript = () => this.loadEngineClass()
        .then(() => ProVerifRunner.loadScript(this.folder + "proverif-wasm.js"))
        .then(() => WebAssembly.compile(ProVerifEngine.decode(self.proverifWasm)));
        
      let compiling;
      if (location.protocol === "file:") {
        compiling = fromScript();
      } else {
        compiling = fetch(url)
          .then(response => {
            if (!response.ok) {
              throw new Error("Cannot load " + url);
            }
            const streamed = response.headers.get("Content-Type") === "application/wasm"
              && typeof WebAssembly.compileStreaming === "function";
            return streamed ? WebAssembly.compileStreaming(response) : response.arrayBuffer().then(bytes => WebAssembly.compile(bytes));
          })
          .catch(() => fromScript());
      }
      
      ProVerifRunner.compiled = compiling.catch(error => {
        ProVerifRunner.compiled = null;
        throw new Error("Cannot compile the ProVerif engine: " + (error && error.message || error));
      });
    }
    
    return ProVerifRunner.compiled;
  }

  /**
   * Loads a script into the page, once.
   *
   * @param {string} url The script.
   * @return {Promise} Resolves when the script has run.
   */
  static loadScript(url: string): Promise<any> {
    if (!ProVerifRunner.scripts[url]) {
      ProVerifRunner.scripts[url] = new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = url;
        script.onload = () => resolve();
        script.onerror = () => {
          delete ProVerifRunner.scripts[url];
          reject(new Error("Cannot load " + url));
        };
        document.head.appendChild(script);
      });
    }
    
    return ProVerifRunner.scripts[url];
  }

  /**
   * Verifies a model.
   *
   * @param {string} source The ProVerif model.
   * @param {Object} options The run options.
   * @param {string} options.fileName The file name given to ProVerif, whose
   *   extension tells the input language (".pv" for the typed pi calculus).
   * @param {Array<string>} options.args Command line arguments, before the
   *   file name.
   * @param {Array<Object>} options.files Other files for the run, {name,
   *   text}, such as libraries for -lib (in ProVerifEngine.WORK_DIR).
   * @param {number} options.maxMemory The memory limit in bytes, 0 for as
   *   much as the browser gives (up to 4 GB), or null for the default of
   *   ProVerifEngine (1 GB).
   * @param {number} options.timeoutSeconds The timeout, or 0 for none.
   * @param {function(string, string):void} options.onOutput Receives the
   *   channel ("stdout" or "stderr") and a chunk of output.
   * @param {function(number, number):void} options.onMemory Receives the
   *   heap size and the limit, in bytes, when the heap grows.
   * @return {Promise<Object>} Resolves when the run ends, with its status
   *   ("done", "memory", "timeout", "cancelled" or "error"), the exit code,
   *   a message, the largest heap, the limit, the duration and the mode.
   */
  run(source: string, options: { fileName?: string; args?: string[]; files?: any[]; maxMemory?: number; timeoutSeconds?: number; onOutput?: ((arg0: string, arg1: string) => void); onMemory?: ((arg0: number, arg1: number) => void) }): Promise<any> {
    const defaults = {
        fileName: "model.pv"
      , args: []
      , files: []
      , maxMemory: null
      , timeoutSeconds: 0
      , onOutput: () => {}
      , onMemory: () => {}
    };
    options = {...defaults, ...options};
    
    if (this.isRunning()) {
      return Promise.reject(new Error("A verification is already running."));
    }
    
    const started = Date.now();
    return new Promise(resolve => {
      this.finish = result => {
        this.stopTimer();
        this.finish = null;
        resolve({...result, ms: Date.now() - started, mode: this.getMode()});
      };
      this.compile()
        .then(module => {
          if (!this.finish) {
            return;
          }
          if (this.useWorker) {
            this.runInWorker(module, source, options);
          } else {
            this.runInPage(module, source, options);
          }
        })
        .catch(error => {
          if (this.finish) {
            this.finish({ status: "error", exitCode: 0, message: String(error && error.message || error) });
          }
        });
    });
  }

  /**
   * Runs the engine in a web worker.
   *
   * @param {WebAssembly.Module} module The compiled engine.
   * @param {string} source The model.
   * @param {Object} options The run options.
   */
  runInWorker(module: WebAssembly.Module, source: string, options: any) {
    let worker;
    try {
      worker = new Worker(this.folder + "proverif-worker.js");
    } catch (e) {
      this.useWorker = false;
      this.runInPage(module, source, options);
      return;
    }
    this.worker = worker;
    
    let answered = false;
    
    worker.onmessage = event => {
      const message = event.data;
      answered = true;
      if (message.type === "output") {
        options.onOutput(message.channel, message.text);
      } else if (message.type === "memory") {
        options.onMemory(message.bytes, message.limit);
      } else if (message.type === "result") {
        this.stopWorker();
        if (this.finish) {
          this.finish(message.result);
        }
      }
    };
    
    worker.onerror = event => {
      event.preventDefault();
      this.stopWorker();
      if (!answered) {
        // The worker could not start: I use the page from now on
        this.useWorker = false;
        this.runInPage(module, source, options);
        return;
      }
      if (this.finish) {
        this.finish({ status: "error", exitCode: 0, message: event.message || "The engine stopped." });
      }
    };
  
    worker.postMessage({
        type: "run"
      , module: module
      , source: source
      , fileName: options.fileName
      , args: options.args
      , files: options.files
      , maxMemory: options.maxMemory
    });
    
    const timeout = options.timeoutSeconds;
    if (timeout > 0) {
      this.timer = setTimeout(() => {
        this.stopWorker();
        if (this.finish) {
          this.finish({ status: "timeout", exitCode: 0, message: "Stopped after " + timeout + " seconds." });
        }
      }, timeout*1000);
    }
  }

  /**
   * Runs the engine in the page, loading its scripts first if needed.
   *
   * @param {WebAssembly.Module} module The compiled engine.
   * @param {string} source The model.
   * @param {Object} options The run options.
   */
  runInPage(module: WebAssembly.Module, source: string, options: any) {
    this.loadEngineClass()
      .then(() => ProVerifRunner.loadScript(this.folder + "proverif.js"))
      .then(() => new Promise(resolve => setTimeout(resolve, 30)))
      .then(() => new ProVerifEngine({
          scope: self
        , module: module
        , maxMemory: options.maxMemory
        , onOutput: options.onOutput
        , onMemory: options.onMemory
      }).run(source, options.fileName, options.args, options.files))
      .then(result => {
        if (this.finish) {
          this.finish(result);
        }
      })
      .catch(error => {
        if (this.finish) {
          this.finish({ status: "error", exitCode: 0, message: String(error && error.message || error) });
        }
      });
  }

  /**
   * Verifies a small model once, without telling anyone, so that the browser
   * optimises the engine before the first verification.
   *
   * @return {Promise<Object>} The result of the run, or null in the page,
   *   where the run would block the user.
   */
  warmUp(): Promise<any> {
    if (!this.useWorker || this.isRunning()) {
      return Promise.resolve(null);
    }
    return this.run(ProVerifRunner.WARM_UP_MODEL, {
        maxMemory: 64*1048576
      , timeoutSeconds: 30
    }).catch(() => null);
  }

  /**
   * Stops the current run, if any.
   */
  cancel() {
    if (!this.isRunning()) {
      return;
    }
    this.stopWorker();
    this.finish({ status: "cancelled", exitCode: 0, message: "Verification cancelled." });
  }

  /**
   * Terminates the worker, if any.
   */
  stopWorker() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Clears the timeout, if any.
   */
  stopTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
// ----------------------------------------------------------------
