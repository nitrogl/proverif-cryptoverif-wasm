# ProVerif and CryptoVerif for WebAssembly

![ProVerif](https://img.shields.io/badge/ProVerif-2.05-005f73)
![CryptoVerif](https://img.shields.io/badge/CryptoVerif-2.13-de10e5)
![OCaml](https://img.shields.io/badge/OCaml-5.4.0-f29000)
![Emscripten](https://img.shields.io/badge/Emscripten-3.1.69-c2d836)

[ProVerif](https://bblanche.gitlabpages.inria.fr/proverif/) 2.05 and [CryptoVerif](https://bblanche.gitlabpages.inria.fr/CryptoVerif/) 2.13, the verifiers of cryptographic protocols by Bruno Blanchet and their co-authors, compiled from their sources to WebAssembly.

Inspired by the disclaimer of both tools' demo pages "there is no security mechanism to protect the confidentiality of your data", this project provides **full confidentiality** as **your models never leave your machine**.

They run in a web browser, on the user's own computer and with no server, under Node, or as commands, and they give the same output as the tools on the command line, byte for byte on their own examples. Each run has a memory limit, and in a page it can be stopped at any time.

They are published so that anyone can use them: in a course, in an editor, in a page that explains a protocol. They are the verifiers of [PieStudio](https://github.com/nitrogl/piestudio) and [CryStudio](https://github.com/nitrogl/crystudio), visual editors of ProVerif and CryptoVerif models.

**[Documentation](https://nitrogl.github.io/proverif-cryptoverif-wasm/docs/)** &middot; [Using the engines](docs/library.md) &middot; [Building them](docs/building.md) &middot; [ProVerif manual](docs/manuals/proverif/index.md) &middot; [CryptoVerif manual](docs/manuals/cryptoverif/index.md) &middot; try [ProVerif](https://nitrogl.github.io/proverif-cryptoverif-wasm/proverif/example/) or [CryptoVerif](https://nitrogl.github.io/proverif-cryptoverif-wasm/cryptoverif/example/) in a page

> This is not an official release of ProVerif or CryptoVerif, and their authors are not involved in it. Please report problems with this build here, not to them; and if you publish results obtained with it, cite the tools themselves.

## In your web page

### Local copy

Copy the content of `proverif/dist/` next to your page, e.g., into a `proverif/` subdirectory, and include the following just before `</body>:

```html
<script src="proverif/ProVerifRunner.js"></script>
<script>
  new ProVerifRunner().run(model, {
      fileName: "nspk.pv"
    , onOutput: (channel, text) => console.log(text)
  }).then(result => console.log(result.status, result.exitCode));
</script>
```

CryptoVerif is the same with `cryptoverif/dist/` and `CryptoVerifRunner`. Each run happens in a web worker when the page is served, even by the simplest static server, and in the page when it is opened from disk. [Using the engines](docs/library.md) has the options, the files of a run, the interactive mode of CryptoVerif, the worker, and what the licences ask.

## Build them yourself (delicate)

Everything that is not written by hand is built from the sources in `upstream/`, with free tools (OCaml 5.4.0 and Emscripten 3.1.69, in Ubuntu 26):

```sh
sudo apt install build-essential ocaml ocaml-findlib emscripten
npm install          # TypeScript, the types of Node, and Playwright for the checks of the pages
npm run build        # proverif/build.sh && cryptoverif/build.sh, then npm run build:ts
npm test             # the type check, then the examples of both tools against their native outputs, and more
```

This is my first project where I decided to give TypeScript a go, in `proverif/src/` and `cryptoverif/src/`. And the first time I use Emscripten too.
I attempted some workaround by searching the web and querying language models when I was stuck.

[Building them yourself](docs/building.md) explains every step.

## What is here

| Resource | Content |
|:--|:--|
| `upstream/`              | the sources: ProVerif 2.05, CryptoVerif 2.13 and OCaml 5.4.0 |
| `proverif/`              | ProVerif for WebAssembly (GNU GPL, version 2 or later) |
| `  src/`                 | the TypeScript of the scripts of dist/ and node/ |
| `  build.sh, wasm/`      | the build, and the files it adds to the sources |
| `  example/, tests/`     | a page that verifies a model, and the checks |
| `cryptoverif/`           | CryptoVerif for WebAssembly (CeCILL-B), laid out the same way |
| `docs/`                  | the documentation, with the manuals of both tools, in Markdown (and →HTML) |
| `tools/`                 | the build of the HTML of the documentation (pandoc), and the check of its links |
| `tsconfig.json`          | the TypeScript projects of both tools (tsconfig.node.json: the type check of the checks) |


## The documentation

The pages of `docs/` are Markdown artificially derived from the official manuals, and manually curated by me (work-in-progress).
I use [pandoc](https://pandoc.org/) with a template to convert to HTML.
This is an attempt to significantly improve their accessibility.
GitHub Pages serves the repository, so the HTML, the example pages and the engines themselves are all online at `https://nitrogl.github.io/proverif-cryptoverif-wasm/`.

## Authors and licences

My understanding from the [Wiki entry of CeCILL](https://en.wikipedia.org/wiki/CeCILL) is that CeCILL-B is not entirely compatible with GPL-2. ProVerif is licensed by the latter, CryptoVerif by the former. To avoid accidental inconsistencies, I decided to keep the two clearly separate (at the cost of code/script redundancy).

- **ProVerif** is by Bruno Blanchet, Vincent Cheval and Marc Sylvestre (INRIA, CNRS), under the GNU GPL, version 2 or later.
- **CryptoVerif** is by Bruno Blanchet, Pierre Boutry, David Cad&eacute;, Christian Doczkal, Aymeric Fromherz, Charlie Jacomme, Benjamin Lipp and Pierre-Yves Strub (ENS, CNRS, INRIA, MPI-SP, Ecole Polytechnique), under the CeCILL-B licence.
- The **runtime of OCaml**, by the OCaml developers (INRIA), is under the LGPL 2.1 with the OCaml static linking exception.
- The parts of **Emscripten** in the modules are under the MIT licence.
- The WebAssembly builds, the scripts and the documentation are by Roberto Metere. As  [LICENSE.md](LICENSE.md) says which licence covers what.
