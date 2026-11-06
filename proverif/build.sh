#!/bin/bash
#
# This script builds ProVerif for WebAssembly:
#  - dist/proverif.wasm, the WebAssembly module,
#  - dist/proverif.js, its Emscripten loader, and 
#  - dist/proverif-wasm.js, the same module in base64 for pages opened from disk.
#
# Usage:
#   ./build.sh                    with the sources in ../upstream/
#   ./build.sh PROVERIF OCAML     with other sources, each a folder or an
#                                 archive (proverif2.xx.tar.gz, ocaml-5.4.x)
#   BUILD_DIR=folder ./build.sh   keeps the intermediate files in folder
#
# Requirements: ocamlc, ocamlfind, ocamllex and ocamlyacc of the same version
# as the OCaml sources, and Emscripten. On Ubuntu 26 (my system):
#   sudo apt install ocaml-findlib emscripten
#
# SPDX-License-Identifier: GPL-2.0-or-later

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
WASM_DIR="$ROOT/wasm"
OUT="$ROOT/dist"
if [ $# -eq 0 ]; then
  # TODO Hardcoded versions for now - ocaml matches my system
  set -- "$ROOT/../upstream/proverif2.05.tar.gz" "$ROOT/../upstream/ocaml-5.4.0.tar.xz"
fi
if [ $# -ne 2 ]; then
  echo "Usage: $0 [path/to/proverif2.xx(.tar.gz) path/to/ocaml-5.4.x(.tar.xz)]"
  exit 1
fi
# -------------------------------------------------------------

# Dependencies check
for dep in ocamlc ocamlfind ocamllex ocamlyacc emcc patch tar sha256sum base64; do
  if ! command -v "$dep" > /dev/null; then
    echo "$dep is not installed/found"
    exit 1
  fi
done
# -------------------------------------------------------------

# If build directory is specified, do not accept a non-empty one
if [ -n "$BUILD_DIR" ]; then
  mkdir -p "$BUILD_DIR"
  WORK="$(cd "$BUILD_DIR" && pwd)"
  if [ -n "$(ls -A "$WORK")" ]; then
    echo "$WORK is not empty"
    exit 1
  fi
else # If not specified, create a temporary one
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
fi
JOBS="$(nproc 2>/dev/null || echo 1)" # Optimize for parallel compilation
STARTED=$(date +%s)
# -------------------------------------------------------------

# Unpacks a source tree, given as a folder or an archive
unpack() {
  mkdir "$2"
  if [ -d "$1" ]; then
    cp -r "$1"/. "$2"
  else
    tar xf "$1" -C "$2" --strip-components=1
  fi
}
# -------------------------------------------------------------

# Do it then
unpack "$1" "$WORK/proverif"
unpack "$2" "$WORK/ocaml"
PV_SRC="$WORK/proverif/src"
OC_SRC="$WORK/ocaml"
VERSION="$(sed -n 's/.*version *= *"\([^"]*\)".*/\1/p' "$PV_SRC/version.ml" | head -1)"
OCAML_VERSION="$(head -1 "$OC_SRC/VERSION" | sed 's/+.*//')"
EM_VERSION="$(emcc --version | head -1 | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1)"
if [ "$OCAML_VERSION" != "$(ocamlc -version)" ]; then
  echo "The OCaml sources ($OCAML_VERSION) and ocamlc ($(ocamlc -version)) differ"
  exit 1
fi
echo "ProVerif $VERSION, OCaml $OCAML_VERSION, Emscripten $EM_VERSION"
# exit 1

# Extract authors and the copyright of ProVerif from the source
# TODO hardcoded authors for now
PV_AUTHORS="$(sed -n '/Cryptographic protocol verifier/{n;n;p;q}' "$PV_SRC/version.ml" | sed 's/^ *\* *//; s/ *\* *$//')"
PV_COPYRIGHT="$(sed -n 's/^ *\* *Copyright (C) \(.*[0-9]\) *\* *$/\1/p' "$PV_SRC/version.ml" | head -1)"
PV_AUTHORS="${PV_AUTHORS:-the ProVerif authors}"
PV_COPYRIGHT="${PV_COPYRIGHT:-INRIA, CNRS}"

echo "Configuring the OCaml runtime"
(
  cd "$OC_SRC" && ./configure \
    --disable-native-compiler \
    --disable-ocamldoc \
    --disable-ocamltest \
    --disable-debugger \
    --disable-instrumented-runtime \
    --disable-shared \
    --without-zstd \
    > "$WORK/configure.log" 2>&1
) || { # show errors?
  tail -20 "$WORK/configure.log"
  exit 1
}

make -s -C "$OC_SRC" runtime/caml/opnames.h runtime/caml/jumptbl.h runtime/build_config.h > /dev/null
RT="$OC_SRC/runtime"

# Remove definitions with arguments
sed -i \
  -e 's/^#define ARCH_SIXTYFOUR 1/#undef ARCH_SIXTYFOUR/' \
  -e 's/^#define SIZEOF_LONG 8/#define SIZEOF_LONG 4/' \
  -e 's/^#define SIZEOF_PTR 8/#define SIZEOF_PTR 4/' \
  -e 's/^#define HAS_ARCH_CODE32 1/#undef HAS_ARCH_CODE32/' \
  -e 's/^#define FUNCTION_SECTIONS 1/#undef FUNCTION_SECTIONS/' \
  -e 's/^#define SUPPORTS_TREE_VECTORIZE 1/#undef SUPPORTS_TREE_VECTORIZE/' "$RT/caml/m.h"

# Remove flags
for feature in HAS_STACK_OVERFLOW_DETECTION HAS_HUGE_PAGES HUGE_PAGE_SIZE HAS_MMAP \
    HAS_GETHOSTBYNAME_R HAS_GETHOSTBYADDR_R HAS_ACCEPT4 HAS_EXECVPE HAS_POSIX_SPAWN \
    HAS_SYSTEM HAS_SYS_SHM_H HAS_SHMAT HAS_GETAUXVAL HAS_SECURE_GETENV HAS_WAIT4 \
    HAS_SETITIMER HAS_SIGWAIT HAS_NICE HAS_DUP3 HAS_PIPE2 HAS_LOCKF HAS_MKFIFO \
    HAS_GETGROUPS HAS_SETGROUPS HAS_INITGROUPS HAS_TERMIOS HAS_STRTOD_L HAS_LOCALE_H \
    HAS_GNU_GETAFFINITY_NP HAS_BSD_GETAFFINITY_NP POSIX_SIGNALS USE_MMAP_MAP_STACK; do
  sed -i "s/^#define $feature\b.*/#undef $feature/" "$RT/caml/s.h"
done

# Memory is committed without mmap or mprotect (wasm has neither), for one domain
patch -s -p1 -d "$RT" < "$WASM_DIR/runtime-wasm.patch"

# Keep setjmp out of the interpreter loop, to optimize
patch -s -p1 -d "$RT" < "$WASM_DIR/interp-setjmp.patch"
# -------------------------------------------------------------

# The flags of OCaml's own build of its runtime, and a prefix map, so that
# the paths of this folder do not end up in the module
CFLAGS=(-O3 -fno-strict-aliasing -fwrapv -D_FILE_OFFSET_BITS=64 -DCAML_NAME_SPACE -DCAMLDLLIMPORT= "-ffile-prefix-map=$WORK=." -I"$RT")
RUNTIME="meta gc_ctrl obj skiplist str frame_descriptors fail roots fix_code debugger extern instrtrace ints sys startup_aux finalise io major_gc callback runtime_events signals lf_skiplist sak shared_heap bigarray addrmap unix tsan prng domain platform gc_stats startup_byt backtrace alloc parsing codefrag afl dynlink memory printexc misc intern interp lexing compare custom hash weak minor_gc blake2 sync globroots md5 backtrace_byt memprof array fiber floats fail_byt clambda_checks zstd" # args 5.4.0
# RUNTIME="interp misc stacks fix_code startup_aux startup_byt freelist major_gc minor_gc
#   memory alloc roots_byt globroots fail_byt signals signals_byt printexc backtrace_byt
#   backtrace compare ints eventlog floats str array io extern intern hash sys meta parsing
#   gc_ctrl md5 obj lexing callback debugger weak compact finalise custom dynlink afl unix
#   bigarray memprof domain skiplist codefrag" # args 4.14.1

echo "Compiling the OCaml runtime with Emscripten"
mkdir -p "$WORK/obj/runtime" "$WORK/obj/unix" "$WORK/obj/str"
echo $RUNTIME | tr ' ' '\n' | xargs -P "$JOBS" -I{} \
  emcc -c "${CFLAGS[@]}" "$RT/{}.c" -o "$WORK/obj/runtime/{}.o" 2> "$WORK/runtime.log" \
|| { # Show errors otherwise
  grep -E "error" "$WORK/runtime.log"
  exit 1
}

# Emscripten should compile only configured *.c files
UNIX_PLAN="$WORK/unix.make-plan"
make -C "$OC_SRC/otherlibs/unix" -Bn >"$UNIX_PLAN" 2>&1

mapfile -t UNIX_SRCS < <(
  awk '
    /\.b\.o[[:space:]]+-c[[:space:]]+/ {
      for (i = 1; i < NF; i++)
        if ($i == "-c" && $(i + 1) ~ /\.c$/) print $(i + 1)
    }
  ' "$UNIX_PLAN" | sort -u
)

if [ "${#UNIX_SRCS[@]}" -eq 0 ]; then
  echo "No bytecode Unix C sources found in Makefile dry run" # This shouldn't happen
  exit 1
fi

for src in "${UNIX_SRCS[@]}"; do
  emcc -c "${CFLAGS[@]}" -DCAML_BUILDING_UNIX \
    "$OC_SRC/otherlibs/unix/$src" \
    -o "$WORK/obj/unix/${src%.c}.o" \
    >>"$WORK/unix.log" 2>&1 \
  || {
    grep -E 'error:' "$WORK/unix.log"
    exit 1
  }
done

emcc -c "${CFLAGS[@]}" "$OC_SRC/otherlibs/str/strstubs.c" -o "$WORK/obj/str/strstubs.o"
# -------------------------------------------------------------


echo "Compiling ProVerif $VERSION to bytecode"
MODULES="$(sed -n 's/^SRC="\(.*\)"$/\1/p' "$WORK/proverif/build" | head -1)"
MODULES="${MODULES//columns.c/}" # We patch columns.c
if [ -z "$MODULES" ]; then
  echo "Cannot read the list of modules from the build script of ProVerif"
  exit 1
fi
(
  cd "$PV_SRC"
  for p in parser piparser pitparser; do
    ocamlyacc "$p.mly" 2> /dev/null
  done
  for l in lexer pilexer pitlexer; do
    ocamllex -q "$l.mll"
  done
  # WARNING: -output-obj makes sure that ocamlc leaves out std_exit,
  # the module that runs the at_exit functions (and flushes the output
  ocamlfind ocamlc -package unix,str -linkpkg -w -a -output-obj -o "$WORK/proverif_code.c" $MODULES std_exit.cmo
)

# The module. Its initial memory (32 MB) is the smallest limit a run can
# have; Emscripten's own growth is replaced by wasm/heap.js
echo "Linking the WebAssembly module"
OBJECTS=()
for f in $RUNTIME; do
  OBJECTS+=("$WORK/obj/runtime/$f.o")
done

# DEBUG only
  # -Wl,--trace-symbol=caml_startup \
  # -Wl,--trace-symbol=caml_raise \
  # -Wl,--trace-symbol=main \
  # -sASSERTIONS=2 \
emcc "${CFLAGS[@]}" "$WORK/proverif_code.c" "$WASM_DIR/main.c" "$WASM_DIR/columns.c" \
  "$WASM_DIR/stubs.c" "${OBJECTS[@]}" "$WORK"/obj/unix/*.o "$WORK/obj/str/strstubs.o" \
  -o "$WORK/proverif.js" \
  -sMODULARIZE=1 -sEXPORT_NAME=createProVerif -sENVIRONMENT=web,worker \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sMAXIMUM_MEMORY=4GB -sABORTING_MALLOC=0 \
  -sTOTAL_STACK=8388608 -sEXIT_RUNTIME=1 -sFORCE_FILESYSTEM=1 -sDYNAMIC_EXECUTION=0 \
  -sEXPORTED_FUNCTIONS=_proverif_main,_malloc,_free -sEXPORTED_RUNTIME_METHODS=FS,allocateUTF8 \
  --js-library "$WASM_DIR/heap.js" -lm 2> "$WORK/link.log" \
|| {
  grep -E "error" "$WORK/link.log" || cat "$WORK/link.log"
  exit 1
}

mkdir -p "$OUT"
{
  echo "/* ProVerif $VERSION for WebAssembly: the loader of proverif.wasm, generated by Emscripten $EM_VERSION."
  echo "   ProVerif is by $PV_AUTHORS, copyright $PV_COPYRIGHT, this build of ProVerif for WebAssembly is curated by Roberto Metere. */" # TODO hardcoded author, what if others will contribute
  cat "$WORK/proverif.js"
} > "$OUT/proverif.js"
cp "$WORK/proverif.wasm" "$OUT/proverif.wasm"
chmod 644 "$OUT/proverif.wasm"

# The same module for pages opened from disk, where it cannot be fetched
{
  echo "/* ProVerif $VERSION for WebAssembly: proverif.wasm as base64, for pages opened from disk"
  echo "   (see proverif.js for the authors and the licences). */"
  echo -n "self.proverifWasm = \""
  base64 -w 0 "$WORK/proverif.wasm"
  echo "\";"
} > "$OUT/proverif-wasm.js"

cp "$WORK/proverif/LICENSE" "$OUT/COPYING"
cp "$OC_SRC/LICENSE" "$OUT/LICENSE-OCaml.txt"
cp "$WASM_DIR/LICENSE-Emscripten.txt" "$OUT/LICENSE-Emscripten.txt"
echo "$VERSION" > "$OUT/VERSION"
(
  cd "$OUT"
  sha256sum proverif.js proverif.wasm proverif-wasm.js > SHA256SUMS
)

echo "Wrote dist/proverif.wasm ($(du -h "$OUT/proverif.wasm" | cut -f1)), proverif.js and proverif-wasm.js in $(( $(date +%s) - STARTED )) s"
cat "$OUT/SHA256SUMS"
