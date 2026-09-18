import { Result } from 'effect';

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

/**
 * Runs a throwing reader and puts a {@linkcode GrammarError} in the failure channel.
 *
 * Recursive descent keeps throwing inside — threading `Result` through every
 * `atom` · `merge` would double the parser for no reader's benefit. Only the
 * parser's entry turns it into a value. Any other exception is rethrown as-is.
 */
export function readGrammar<A>(read: () => A): Result.Result<A, GrammarError> {
  try { return Result.succeed(read()); }
  catch (e) {
    if (e instanceof GrammarError) return Result.fail(e);
    throw e;
  }
}
