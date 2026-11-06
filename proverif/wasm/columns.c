/*
 * Replaces src/columns.c of ProVerif
 *
 * The original asks the terminal for its width, and we have no terminal.
 * We return "-1" (=unknown), mimicking its behaviour on Windows.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later */
#include <caml/mlvalues.h>

CAMLprim value get_columns(value unit)
{
  (void) unit;
  return Val_long(-1);
}
