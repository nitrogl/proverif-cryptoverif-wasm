/**
 * Runs ProVerif once.
 *
 * Max memory is set to 4GB (due to it's being compiled 32-bit).
 * 
 * ProVerif asks to press return when it detects that its saturation may not
 * terminate.
 *
 * Each run must create its own instance of the module, as they shall not
 * share global variables. Though, instances share the compiled module - fast
 * instantiation.
 * 
 * @see ProVerifRunner
 * @see proverif-worker.js
 *
 * @author Roberto Metere
 * @license GPL-2.0-or-later
 */
class ProVerifEngine {
  
  /**
   * The memory a run starts with, in bytes, as set by the build.
   *
   * @type {number}
   */
  static INITIAL_MEMORY = 33554432;

  /**
   * The largest heap of a 32 bit WebAssembly module, in bytes.
   *
   * @type {number}
   */
  static MAX_MEMORY = 4294901760;

  /**
   * The memory limit of a run when none is given, in bytes (1 GB).
   *
   * @type {number}
   */
  static DEFAULT_MEMORY = 1073741824;

  /**
   * Settings of the OCaml runtime (OCAMLRUNPARAM): a minor heap of 1M words
   * and a stack of up to 64M words, for the deep recursions of ProVerif.
   *
   * @type {string}
   */
  static RUN_PARAMS = "s=1M,l=64M";

  /**
   * Where the model and the other files of a run are written, in the file
   * system of the engine.
   *
   * @type {string}
   */
  static WORK_DIR = "/work";

  scope: any;
  module: WebAssembly.Module;
  maxMemory: number;
  onOutput: (arg0: string, arg1: string) => void;
  onMemory: (arg0: number, arg1: number) => void;
  bytes: number;
  limitReached: boolean;
  channels: { stdout: any; stderr: any; };

  /**
   * @param {Object} params The run parameters.
   * @param {Object} params.scope The global object where proverif.js
   *   defined createProVerif.
   * @param {WebAssembly.Module} params.module The compiled proverif.wasm.
   * @param {number} params.maxMemory The memory limit in bytes, 0 for as
   *   much as the module can address (4 GB), or null for DEFAULT_MEMORY.
   * @param {function(string, string):void} params.onOutput Receives the
   *   channel ("stdout" or "stderr") and a chunk of text, line by line.
   * @param {function(number, number):void} params.onMemory Receives the size
   *   of the heap and the limit, in bytes, each time the heap grows.
   */
  constructor(params?: { scope?: any; module?: WebAssembly.Module; maxMemory?: number; onOutput?: ((arg0: string, arg1: string) => void); onMemory?: ((arg0: number, arg1: number) => void) }) {
    const defaults = {
        scope: globalThis
      , module: null
      , maxMemory: ProVerifEngine.DEFAULT_MEMORY
      , onOutput: () => {}
      , onMemory: () => {}
    };
    params = {...defaults, ...params};
    this.scope = params.scope;
    this.module = params.module;
    this.maxMemory = ProVerifEngine.clampMemory(typeof params.maxMemory === "number" ? params.maxMemory : ProVerifEngine.DEFAULT_MEMORY);
    this.onOutput = params.onOutput;
    this.onMemory = params.onMemory;
    this.bytes = ProVerifEngine.INITIAL_MEMORY;
    this.limitReached = false;
    this.channels = {
        stdout: ProVerifEngine.channel()
      , stderr: ProVerifEngine.channel()
    };
  }

  /**
   * Brings a limit within what the module can use.
   *
   * @param {number} bytes The wanted limit, zero or less for the largest.
   * @return {number} A multiple of 64 KB between the initial memory and
   *   the largest heap.
   */
  static clampMemory(bytes: number): number {
    const wanted = bytes > 0 ? bytes : ProVerifEngine.MAX_MEMORY;
    const pages = Math.floor(Math.min(wanted, ProVerifEngine.MAX_MEMORY) / 65536);
    
    return Math.max(ProVerifEngine.INITIAL_MEMORY, pages*65536);
  }

  /**
   * @return {Object} An empty output channel: pending bytes and a decoder.
   */
  static channel() {
    return {
        bytes: new Uint8Array(8192)
      , length: 0
      , decoder: new TextDecoder("utf-8")
    };
  }

  /**
   * Gives a file name that the file system of the engine accepts.
   *
   * @param {string} name A file name.
   * @return {string} The name, with every character other than letters,
   *   digits, dots, dashes and underscores replaced by an underscore.
   */
  static safeName(name: string): string {
    return String(name).replace(/[^A-Za-z0-9._-]/g, "_");
  }

  /**
   * Runs ProVerif on one model.
   *
   * @param {string} source The model.
   * @param {string} fileName The file name, whose extension tells ProVerif
   *   the input language (".pv" for the typed pi calculus). ProVerif sees it
   *   in WORK_DIR, and names it so in its messages.
   * @param {Array<string>} args Extra command line arguments, before the
   *   file name.
   * @param {Array<Object>} files Other files for the run, {name, text}, also
   *   written in WORK_DIR: for instance the libraries given with -lib.
   * @return {Promise<Object>} Resolves with the status ("done", "memory" or
   *   "error"), the exit code, a message, the largest heap and the limit
   *   in bytes, and the duration in milliseconds.
   */
  run(source: string, fileName: string = "model.pv", args: string[] = [], files: any[] = []): Promise<any> {
    const started = Date.now();
    if (typeof this.scope.createProVerif !== "function") {
      return Promise.resolve(this.result("error", 0, "The ProVerif engine is not loaded (proverif.js).", started));
    }
    if (!this.module) {
      return Promise.resolve(this.result("error", 0, "The ProVerif engine is not compiled (proverif.wasm).", started));
    }

    return this.instantiate()
      .then(engine => {
        const path = ProVerifEngine.WORK_DIR + "/" + ProVerifEngine.safeName(fileName);
        engine.FS.mkdir(ProVerifEngine.WORK_DIR);
        engine.FS.writeFile(path, source);
        files.forEach(file => engine.FS.writeFile(ProVerifEngine.WORK_DIR + "/" + ProVerifEngine.safeName(file.name), file.text));
        return this.call(engine, ["proverif"].concat(args, [path]));
      })
      .then(exitCode => {
        this.flush();
        if (this.limitReached && exitCode !== 0) {
          return this.result("memory", exitCode, "Memory limit reached.", started);
        }
        return this.result("done", exitCode, "", started);
      })
      .catch(error => {
        this.flush();
        if (this.limitReached) {
          return this.result("memory", 0, "Memory limit reached.", started);
        }
        return this.result("error", 0, String(error && error.message || error), started);
      });
  }

  /**
   * Creates a new instance of the engine, with its own heap.
   *
   * @return {Promise<Object>} Resolves with the Emscripten module.
   */
  instantiate(): Promise<any> {
    const compiled = this.module; // to avoid issues with "this" later
    
    return this.scope.createProVerif({
        memoryLimit: this.maxMemory
      , instantiateWasm: (imports, receive) => {
          WebAssembly.instantiate(compiled, imports).then(instance => receive(instance, compiled));
          return {};
        }
      , stdin: () => 10
      , stdout: byte => this.write("stdout", byte)
      , stderr: byte => this.write("stderr", byte)
      , quit: (status, toThrow) => {
          throw toThrow;
        }
      , onMemoryGrowth: bytes => {
          this.bytes = Math.max(this.bytes, bytes);
          this.onMemory(bytes, this.maxMemory);
        }
      , onMemoryLimit: () => {
          this.limitReached = true;
        }
      , print: text => this.onOutput("stdout", text + "\n")
      , printErr: text => this.onOutput("stderr", text + "\n")
    });
  }

  /**
   * Calls the entry point of the engine with a command line.
   *
   * @param {Object} engine The Emscripten module.
   * @param {Array<string>} argv The command line, program name first.
   * @return {number} The exit code.
   * @throws {Error} When the engine stops without exiting.
   */
  call(engine: any, argv: string[]): number {
    const pointers = argv.map(arg => engine.allocateUTF8(arg));
    const array = engine._malloc(4*(pointers.length + 1));
    pointers.forEach((pointer, i) => {
      engine.HEAP32[(array >> 2) + i] = pointer;
    });
    engine.HEAP32[(array >> 2) + pointers.length] = 0;
    const runParams = engine.allocateUTF8(ProVerifEngine.RUN_PARAMS);
    try {
      engine._proverif_main(pointers.length, array, runParams);
      return 0;
    } catch (error: any) {
      if (error && error.name === "ExitStatus") {
        return error.status;
      }
      throw error;
    }
  }

  /**
   * Receives one byte of output, and passes the text on line by line.
   *
   * @param {string} name The channel, "stdout" or "stderr".
   * @param {number} byte The byte.
   */
  write(name: string, byte: number) {
    const channel = this.channels[name];
    channel.bytes[channel.length++] = byte;
    if (byte === 10 || channel.length === channel.bytes.length) {
      this.flushChannel(name);
    }
  }

  /**
   * Passes on the pending output of one channel.
   *
   * @param {string} name The channel, "stdout" or "stderr".
   */
  flushChannel(name: string) {
    const channel = this.channels[name];
    if (channel.length > 0) {
      const text = channel.decoder.decode(channel.bytes.subarray(0, channel.length), { stream: true });
      channel.length = 0;
      if (text !== "") {
        this.onOutput(name, text);
      }
    }
  }

  /**
   * Passes on the pending output of both channels.
   */
  flush() {
    this.flushChannel("stdout");
    this.flushChannel("stderr");
  }

  /**
   * @param {string} status "done", "memory" or "error".
   * @param {number} exitCode The exit code of ProVerif.
   * @param {string} message A message for the user.
   * @param {number} started When the run started, in milliseconds.
   * @return {Object} The result of a run.
   */
  result(status: string, exitCode: number, message: string, started: number) {
    return {
        status: status
      , exitCode: exitCode
      , message: message
      , bytes: this.bytes
      , limit: this.maxMemory
      , ms: Date.now() - started
    };
  }

  /**
   * Decodes the module embedded in proverif-wasm.js, for pages opened from
   * disk (file:// protocol), where proverif.wasm won't be fetched by browsers.
   *
   * @param {string} base64 The module, in base64.
   * @return {Uint8Array} The bytes of the module.
   */
  static decode(base64: string): Uint8Array<ArrayBuffer> {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
// ----------------------------------------------------------------
