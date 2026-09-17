/**
 * The one error a value parser throws when the **input** is wrong.
 *
 * Parsers used to throw plain `Error`s, and the checker turned every exception
 * into a user-facing message. So a bug in a parser — a `TypeError`, a stack
 * overflow — would have shown up as "couldn't read the -f value" and exit 1: a
 * crash dressed up as a verdict. Deeply nested `-f` did exactly that
 * (`Maximum call stack size exceeded`).
 *
 * Now parsers throw only this for bad input, and callers catch only this.
 * Anything else is a bug and propagates.
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

/** Returns the message when `e` is a {@linkcode GrammarError}; rethrows anything else. */
export function grammarMessage(e: unknown): string {
  if (e instanceof GrammarError) return e.message;
  throw e;
}
