/* 
 * The Unix library of OCaml calls this function, but that Emscripten
 * does not provide.
 * ProVerif never calls them; but apparently they have to link (I couldn't
 * find my way around it).
 */
/* SPDX-License-Identifier: GPL-2.0-or-later */
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
