# Licences

This repository holds two programs under two licences that do not mix, the sources they are built from, and the documentation of both. Each folder keeps the licence of what it holds:

- `proverif/`, ProVerif for WebAssembly, under GPLv2 or later ([`proverif/COPYING`](proverif/COPYING))
- `cryptoverif/`, CryptoVerif for WebAssembly, under CeCILL-B ([`cryptoverif/LICENSE`](cryptoverif/LICENSE))

Additionally, we hold a copy of third party sources, in `upstream/`, each covered by their own license (that allow redistribution).

This repository also holds a conversion of the ProVerif's and CryptoVerif's manuals as *web pages* to accommodate modern learners and improve accessibility. Thus, authorship remains with their original authors, where Roberto Metere is only the curator of this particular presentation.

Parts of the runtime of Emscripten and of musl, as well as the bytecode runtime of OCaml, are included in `*/dist/` folders: the first two are under the MIT licence (`dist/LICENSE-Emscripten.txt`), the latter is under LGPL 2.1 with the OCaml static linking exception (`dist/LICENSE-OCaml.txt`)

## Otherwise, the MIT licence applies

Copyright (c) 2026 Roberto Metere

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
