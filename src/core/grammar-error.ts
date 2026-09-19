/**
 * The one error a value parser fails with when the **input** is wrong.
 *
 * Parsers used to throw plain `Error`s, and the checker turned every exception
 * into a user-facing message. So a bug in a parser — a `TypeError`, a stack
 * overflow — would have shown up as "couldn't read the -f value" and exit 1: a
 * crash dressed up as a verdict. Deeply nested `-f` did exactly that
 * (`Maximum call stack size exceeded`).
 *
 * Then parsers threw only this for bad input and every caller caught only this —
 * but telling the two apart was on each caller to remember, and the signature
 * said nothing. Now the parsers return `Result<T, GrammarError>`: bad input is a
 * value in the type, and anything else is a bug that propagates (#34).
 *
 * Nothing catches it any more. The parsers read with `Result.gen` all the way down
 * (#39), so this is only ever **failed with** — the `try`/`catch` that had to
 * remember which exceptions were input errors is gone.
 */
export class GrammarError extends Error {
  /** 0-based index in the parsed string near where reading failed, when known. */
  readonly at: number | undefined;

  constructor(message: string, at?: number) {
    super(message);
    this.name = 'GrammarError';
    this.at = at;
  }
}
