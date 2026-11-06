/*
 * CryptoVerif's entry point.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later 
 */
#include <stdlib.h>
#include <emscripten.h>
#include <caml/mlvalues.h>
#include <caml/callback.h>

extern void caml_startup(char_os **argv);
extern void caml_do_exit(int retcode);

/**
 * Runs CryptoVerif with a command line (program name first) and the
 * settings of the OCaml runtime (as in OCAMLRUNPARAM).
 * When CryptoVerif calls exit, the host gets an ExitStatus exception
 * with the exit code.
 */
EMSCRIPTEN_KEEPALIVE int cryptoverif_main(int argc, char **argv, const char *runparams)
{
  (void) argc;
  
  if (runparams != NULL && runparams[0] != '\0') {
    setenv("OCAMLRUNPARAM", runparams, 1);
  }
  caml_startup(argv);
  caml_do_exit(0);
  
  return 0;
}
