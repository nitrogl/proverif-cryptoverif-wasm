/* 
 * The Unix library of OCaml calls this function, but that Emscripten
 * does not provide.
 * I haven't found another way as it appears linking even it never gets called.
 */
/* SPDX-License-Identifier: CECILL-B */
#define CAML_INTERNALS
#include <errno.h>
#include <signal.h>
#include <caml/mlvalues.h>

/**
 * Overload of Unix.sigsuspend
 * 
 * We can safely return -1: there are no signals in a browser.
 */
int sigsuspend(const sigset_t *mask)
{
  (void) mask;
  errno = ENOSYS;
  return -1;
}
