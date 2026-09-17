/**
 * Value types — a layer painted over the reflection.
 *
 * The **list** of options is decided by the schema. All this file decides is
 * what shape the value each option takes has. If this file vanished entirely,
 * the methods would still be there — they would just all take `Arg`.
 *
 * Until now every value-taking option took `Arg = string | number`. That is
 * **wrong in both directions** — it accepts a number for a file path, and any
 * string for seconds.
 *
 *     ytdlp(u).cookies(42)            // a number for a path
 *     ytdlp(u).socketTimeout('fast')   // letters for seconds
 *
 * One thing to hold when narrowing: **never reject a value yt-dlp accepts.**
 * That is worse than failing to catch something. So everything written here
 * was checked by feeding it to yt-dlp's own parser.
 */
import type { Opt } from './schema.js';

/**
 * Metavars whose value can never be a number.
 *
 * optparse's `type` can't tell these apart — all 86 value-taking options are
 * `string`. Naturally, since everything on a command line is a string. So they
 * have to be separated from "things where a number is natural"
 * (`--audio-quality 0` · `--max-filesize 1024`), and **only the certain ones**
 * are listed. If in doubt, leave it out.
 */
const NEVER_NUMBER = new Set([
  'FILE', 'PATH', 'DIR', 'CERTFILE', 'KEYFILE',
  'URL', 'IP',
  'USERNAME', 'PASSWORD', 'TWOFACTOR', 'NETRC_CMD',
]);

/**
 * Value type per metavar. The names listed here are emitted by `options.gen.ts` too.
 *
 * All three were checked against yt-dlp's parser.
 *
 * - `SIZE` · `RATE` — `parse_bytes` accepts `<number>[KMGTPEZY]` case-insensitively,
 *   decimals included (`44.6M`). It **rejects** `50KB` — not a unit in its table.
 * - `RETRIES` — a number, or `infinite`.
 */
const BY_METAVAR: Record<string, string> = {
  SIZE: 'Size',
  RATE: 'Size',
  RETRIES: 'Retries',
};

/**
 * Name of the type of value this option takes. `null` when unknown — it then becomes `Arg`.
 *
 * Order matters. Shapes known from the metavar come first (`SIZE`), then
 * optparse's `type` (`int` · `float`), and last "can't be a number".
 */
export function argType(o: Opt): string | null {
  const mv = o.metavar ?? '';
  const named = BY_METAVAR[mv];
  if (named) return named;

  // optparse records that it reads these as numbers. It rejects anything else.
  if (o.valueType === 'int' || o.valueType === 'float') return 'number';

  if (NEVER_NUMBER.has(mv)) return 'string';
  return null;
}

/** Every metavar `arg-types.ts` knows. A test checks them against the schema. */
export const KNOWN_METAVARS: string[] = [...Object.keys(BY_METAVAR), ...NEVER_NUMBER];
