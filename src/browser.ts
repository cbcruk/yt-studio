/**
 * The entry point for places without a file system — browsers and edge runtimes.
 *
 * Of everything the main `yt-studio` entry (`index.ts`) does, the only part
 * that needs Node is **where to pick the schema up from** — env var, working
 * directory, the file shipped with the package. Peel off that one layer and
 * the rest is pure. So this file is the real substance, and `index.ts` is file
 * reading layered on top of it.
 *
 * Here you **pass the schema directly.** There is nowhere to look it up, so it
 * doesn't ask.
 *
 * @example Fetching the schema
 * ```ts
 * import { studio } from 'yt-studio/browser';
 *
 * const yt = studio(await (await fetch('/yt-studio.schema.json')).json());
 * yt.ytdlp('https://youtu.be/abc').extractAudio().build();
 * ```
 *
 * @module
 */
import { buildSchema, checkRawSchema } from './core/schema.js';
import { lintCommand as lintWith, nearestFlags as nearestWith } from './core/lint.js';
import { explainCommand as explainWith, suggestNext as suggestWith } from './core/explain.js';
import { scanCommand as scanWith } from './core/command.js';
import { makeYtdlp } from './core/build.js';
import { TYPES_VERSION } from './core/options.gen.js';
import type { RawSchema, Schema } from './core/schema.js';
import type { Ytdlp } from './core/build.js';
import type { Item } from './core/command.js';
import type { Explained, Suggestion } from './core/explain.js';
import type { LintResult, Values } from './core/lint.js';

/** Where the schema was read from. */
export type SchemaOrigin =
  /** Wherever `YT_STUDIO_SCHEMA` points */
  | 'env'
  /** `yt-studio.schema.json` in the working directory */
  | 'local'
  /** The one shipped with the package */
  | 'bundled'
  /** Handed over directly by users — never looked up */
  | 'given';

/**
 * What the checker is currently checking against.
 *
 * This package has two layers, and **they may come from different sources.**
 *
 * - The **runtime** (`lint`, `ytdlp()` methods) looks at the schema it was
 *   given, so it can see the yt-dlp you installed.
 * - The **types** (`.d.ts`, autocomplete) were baked in when the package was
 *   built. They can't change.
 *
 * `stale` being true means the two have diverged — check results are right for
 * your yt-dlp, but the list your editor offers is based on `typesVersion`.
 */
export interface SchemaSource {
  /** Where the schema was read from. */
  from: SchemaOrigin;
  /** Absolute path of the file actually read. If passed directly, it says so. */
  path: string;
  /** The yt-dlp version the checker checks against. */
  version: string;
  /** The yt-dlp version the types and autocomplete came from. Baked into the package. */
  typesVersion: string;
  /** Whether the two differ. If true, autocomplete can't be trusted. */
  stale: boolean;
}

/**
 * A handle bound to a single schema. The entry point of this package.
 *
 * Everything here sees **the same schema**. Build two handles and you can hold
 * two schemas side by side without them touching each other.
 */
export interface Ytstudio {
  /** Checks a command string, wherever it came from. */
  lint(text: string): LintResult;
  /** Writes a command in code. */
  ytdlp(...urls: string[]): Ytdlp;
  /** Command string → sequence of items. */
  scan(text: string): { head: string | null; items: Item[] };
  /** Which option each token is. */
  explain(items: Item[]): Explained[];
  /** What would come next for the current combination. */
  suggest(values: Values, limit?: number): Suggestion[];
  /** If it's a typo, what was meant. */
  nearest(flag: string, limit?: number): string[];
  /** What this handle checks against. */
  readonly source: SchemaSource;
  /** The schema with its indexes. Only when you need to dig through it yourself. */
  readonly schema: Schema;
}

/**
 * One handle per schema.
 *
 * You can pass the origin (`source`) along — when `index.ts` found the schema
 * in a file, it attaches where it found it here. Omitted, it means "passed
 * directly".
 */
export function studio(raw: RawSchema, source?: SchemaSource): Ytstudio {
  // Typed as RawSchema, but it usually comes from `fetch(…).json()` — check what arrived.
  const schema = buildSchema(checkRawSchema(raw));
  const ytdlpOf = makeYtdlp(schema);

  return {
    lint: text => lintWith(schema, text),
    ytdlp: (...urls) => ytdlpOf(...urls),
    scan: text => scanWith(schema, text),
    explain: items => explainWith(schema, items),
    suggest: (values, limit) => suggestWith(schema, values, limit),
    nearest: (flag, limit) => nearestWith(schema, flag, limit),
    source: source ?? given(raw),
    schema,
  };
}

/** The origin of a schema handed over directly, never looked up. */
export const given = (raw: RawSchema): SchemaSource => ({
  from: 'given',
  path: '(직접 준 것)',
  version: raw.ytdlp_version,
  typesVersion: TYPES_VERSION,
  stale: raw.ytdlp_version !== TYPES_VERSION,
});

/** The yt-dlp version autocomplete and the `.d.ts` came from. Baked in when the package is built. */
export { TYPES_VERSION } from './core/options.gen.js';

/** Things that don't look at the schema — they only handle strings. */
export { tokenize, quote } from './core/command.js';
export { distance, LEVELS } from './core/lint.js';
export { previewFilename, DEFAULT_OUTTMPL } from './core/explain.js';
export { SchemaError, checkRawSchema } from './core/schema.js';

export type { Issue, Level, LintResult, Values } from './core/lint.js';
export type { FilePreview, Explained, Suggestion } from './core/explain.js';
export type { Item, UnknownWhy } from './core/command.js';
export type { Opt, OptKind, RawSchema, Schema, SchemaFrom, Stage } from './core/schema.js';

/**
 * Types of expressions and pieces.
 *
 * Not exported as values — `f.bv()` and `t.title` already build them, so users
 * never need to `new` one. They do need to write them in helper function
 * signatures, so the types go out.
 */
export type { Expr, FormatFactory, OutTag, Piece, Template, Ytdlp } from './core/build.js';
export type {
  Arg, Conversion, FieldPiece, Filter, Filters, FormatNode, NumCond, OutField,
  OutNode, OutType, PathMap, Selector, StrCond, Version,
} from './core/build.js';
