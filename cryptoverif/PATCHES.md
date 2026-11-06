# Deviations from upstream third-party and choices

## CryptoVerif

The sources of CryptoVerif are not changed. The default libraries of primitives (`default.cvl`, `default.ocvl`, `pq.cvl`, `pq.ocvl`) are written by `cryptogen`, as in the build of CryptoVerif, and built into the module, in `/cryptoverif`.

## OCaml

- 32-bit target: this is my way to highlight that it's an educational tool, or it should be maxed out to 4GB of memory (max for 32 bits), which is acceptable in most modern machines. After all, if you need to run complex and long verification, just use the normal CryptoVerif that is more efficient.
Pros are that pointers are shorter (less memory used if compared to 64 bits),
that some browsers wouldn't understand the 64-bit, and Emscripten is more
mature compiling 32-bit.
- No processes and signals: that simplifies it. With OCaml 5 this includes `POSIX_SIGNALS`, otherwise the runtime asks for an alternate signal stack (`sigaltstack`), which Emscripten does not have, and stops with "Failed to allocate signal stack for domain 0".
- No threads: the runtime is compiled without `-pthread`. Emscripten's threads need `SharedArrayBuffer`, which browsers give only to pages served with special headers (COOP/COEP), and never to pages opened from disk. The engine runs one domain and no `Thread`, so the stubs of Emscripten's libc are enough.
- `wasm/runtime-wasm.patch`, for OCaml 5:
  - OCaml 5 reserves the address space of its heaps with `mmap(PROT_NONE)`, then commits it with `mmap(MAP_FIXED)`. The linear memory of WebAssembly has no protection, and Emscripten refuses `MAP_FIXED`, so the first minor heap could not be allocated ("Failed to create main domain") -- it took a few days of headache to understand where the issue was, as with OCaml 4.14.1 it worked flawlessly. Committing and decommitting are made no-ops: Emscripten's `mmap` already gives usable memory.
  - It reserves a minor heap for every domain that may ever run (16 on a 32-bit target), which is 64 MB with a minor heap of 1M words, before the program allocates anything. The engine runs one domain, so the patch sets the default to 1.
- For optimization, we keep `setjmp` out of the interpreter loop. This is because Emscripten sends every call made by a function that calls setjmp through JavaScript. With OCaml 5.4 the exception context lives in the frame of a small wrapper, which calls the body again after a `longjmp`; the 84 examples take 105 s with it (`interp-setjmp_4.14.1.patch` is the same change for OCaml 4.14.1).

