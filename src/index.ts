/**
 * A typed builder and command checker built by reflecting the installed yt-dlp.
 *
 * It exports two things.
 *
 * - **Builder** — writes commands in code. The types are the option catalog.
 * - **Checker** — checks a command string, wherever it came from.
 *
 * The second one must not go missing. The builder only sees what was written
 * with the builder, but commands picked up from a blog, pasted by a colleague,
 * or handed over by an LLM arrive as strings. Checking those against the
 * installed yt-dlp is the one thing only this package does.
 *
 * **All this file adds is one layer: where to pick the schema up from.** The
 * substance lives in `browser.ts` and is re-exported here in full — that side
 * knows nothing of the file system, so it runs in the browser too
 * (`yt-studio/browser`).
 *
 * **Local first** — if the working directory has `yt-studio.schema.json`, that
 * is used; otherwise the one shipped with the package. See `SchemaSource`.
 *
 * The schema is a **value**, so a handle (`ytstudio()`) carries it around. The
 * flat functions (`lintCommand` etc.) sit on a lazily built default handle —
 * that is a convenience, nothing special, so building handles yourself lets
 * you hold two schemas side by side.
 *
 * @example Build and check
 * ```ts
 * import { ytdlp, lintCommand } from 'yt-studio';
 *
 * ytdlp('https://youtu.be/abc')
 *   .format(f => f.bv({ height: { lte: 1080 } }).plus(f.ba()).or(f.b()))
 *   .output(t => t`${t.title} [${t.id}].${t.ext}`)
 *   .build();
 *
 * lintCommand('yt-dlp --write-sub https://youtu.be/abc').issues;
 * // [{ level: 'error', msg: '--write-sub 는 이 yt-dlp 버전에 없는 …' }]
 * ```
 *
 * @module
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkRawSchema, SchemaError, studio, TYPES_VERSION } from './browser.js';
import type { SchemaOrigin, SchemaSource, Ytstudio } from './browser.js';
import type { RawSchema } from './core/schema.js';
import type { Ytdlp } from './core/build.js';
import type { Item } from './core/command.js';
import type { Explained, Suggestion } from './core/explain.js';
import type { LintResult, Values } from './core/lint.js';

export * from './browser.js';

/**
 * File name of the local schema.
 *
 * Plain `schema.json` would collide with JSON Schema files at the root of other
 * people's projects — it is a common name. Baking the package into the name
 * means the file name itself says why it is there.
 */
const SCHEMA_FILE = 'yt-studio.schema.json';

/**
 * Reads a schema file: `null` when it isn't there or isn't ours, an error when it is ours but broken.
 *
 * Since we search the working directory, we may pick up someone else's JSON — one
 * without `ytdlp_version` is treated as absent. But a file that **is** ours and can't
 * be used must not be skipped silently: that would check against the bundled
 * version and report a pass. That covers two cases.
 *
 * - not JSON at all — our file name, cut off mid-write (`yt-studio types` interrupted)
 * - has `ytdlp_version` but a field is missing or wrong — {@linkcode checkRawSchema} lists them
 *
 * @throws {SchemaError} with the path in front.
 */
function readSchema(path: string): RawSchema | null {
  if (!existsSync(path)) return null;
  let v: unknown;
  try { v = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { throw new SchemaError([`${path} — JSON 으로 읽지 못했다 (${(e as Error).message})`]); }
  if (typeof v !== 'object' || v === null || !('ytdlp_version' in v)) return null;
  try { return checkRawSchema(v); }
  catch (e) {
    if (e instanceof SchemaError) throw new SchemaError(e.problems.map(p => `${path}: ${p}`));
    throw e;
  }
}

const bundledPath = fileURLToPath(new URL(`../${SCHEMA_FILE}`, import.meta.url));

/** The one shipped with the package. If it is missing the types are too, so there is no recovering. */
function readBundled(): RawSchema {
  const raw = readSchema(bundledPath);
  if (!raw) throw new Error(`패키지에 ${SCHEMA_FILE} 이 없다 — 설치가 깨졌다`);
  return raw;
}

/**
 * The schema shipped with the package, as is.
 *
 * **It is where the types came from**, so `yt-studio types` uses it as the
 * baseline — the `.d.ts` it writes extends this, so "new options" must always
 * be relative to it. Using the currently active schema as the baseline would
 * drift from the second run on.
 */
export const BUNDLED: RawSchema = readBundled();

/** Where to look for the schema. Anything omitted falls back to the process's own. */
export interface Where {
  /** Directory to look for `yt-studio.schema.json` in. */
  cwd?: string;
  /** Path to use instead of `YT_STUDIO_SCHEMA`. */
  env?: string;
}

/**
 * Local first, otherwise the one shipped with the package.
 *
 * The order is this way because the checker's worth lies in **checking against
 * what is actually installed**. The shipped schema is the yt-dlp this repo was
 * built with, not yours.
 *
 * Pure function — calling it returns a result and changes nothing. And it
 * **takes the working directory and environment variable as arguments.**
 * Omitted, it uses the process's own. Tests need to pass both so they don't
 * shake the whole process with `process.chdir`.
 */
export function resolveSchema(at: Where = {}): { source: SchemaSource; raw: RawSchema } {
  const found = (from: SchemaOrigin, path: string, raw: RawSchema) => ({
    source: {
      from, path,
      version: raw.ytdlp_version,
      typesVersion: TYPES_VERSION,
      stale: raw.ytdlp_version !== TYPES_VERSION,
    },
    raw,
  });

  const env = at.env ?? process.env.YT_STUDIO_SCHEMA;
  if (env) {
    // If something explicitly pointed to can't be read, don't move on silently.
    // That is a typo, and moving on would check against the wrong version and
    // then report a pass.
    const path = resolve(env);
    const raw = readSchema(path);
    if (!raw) throw new Error(`YT_STUDIO_SCHEMA 가 가리키는 스키마를 읽지 못했다: ${path}`);
    return found('env', path, raw);
  }

  const path = resolve(at.cwd ?? process.cwd(), SCHEMA_FILE);
  const raw = readSchema(path);
  if (raw) return found('local', path, raw);

  return found('bundled', bundledPath, BUNDLED);
}

/**
 * Creates a handle bound to a single schema.
 *
 * With no arguments it finds one via {@linkcode resolveSchema} (env var →
 * working directory → bundled). Given a schema directly, it uses that — which
 * lets tests avoid forking processes.
 *
 * @example Two repos side by side
 * ```ts
 * import { ytstudio } from 'yt-studio';
 *
 * const mine = ytstudio();
 * const theirs = ytstudio({ cwd: '/other/repo' });
 * mine.source.version;    // the yt-dlp version this handle checks against
 * theirs.lint('yt-dlp -x https://youtu.be/abc').ok;
 * ```
 */
export function ytstudio(opts: Where & { raw?: RawSchema } = {}): Ytstudio {
  if (opts.raw) return studio(opts.raw);
  const { source, raw } = resolveSchema(opts);
  return studio(raw, source);
}

/**
 * The default handle. The flat functions sit on it.
 *
 * **Lazy** — built on first use. Building it in the module body would make a
 * bare import search the file system, and would charge that cost even to
 * someone about to pass a schema directly.
 */
let fallback: Ytstudio | null = null;
const def = (): Ytstudio => (fallback ??= ytstudio());

/**
 * Checks a command string against the installed yt-dlp's schema and grammar.
 *
 * This is what the builder can't do. The builder only sees what was written
 * with the builder, but commands picked up from a blog, pasted by a colleague,
 * or handed over by an LLM arrive as strings.
 *
 * @example Stopping a command someone handed you
 * ```ts
 * import { lintCommand, previewFilename } from 'yt-studio';
 *
 * const r = lintCommand('yt-dlp -P /dl -o "%(uploader)s/%(title)s.%(ext)s" https://youtu.be/abc');
 * if (!r.ok) throw new Error(r.issues.map(i => i.msg).join('\n'));
 * previewFilename(r.values).text;   // '/dl/‹업로더›/‹제목›.‹확장자›'
 * ```
 */
export const lintCommand = (text: string): LintResult => def().lint(text);

/** Starts a new command. Its 184 methods grow from the schema. */
export const ytdlp = (...urls: string[]): Ytdlp => def().ytdlp(...urls);

/** Reads a command back in plain words — per-token explanation. */
export const explainCommand = (items: Item[]): Explained[] => def().explain(items);

/**
 * Options that would naturally come next for the current combination.
 *
 * @param values Option id → value, like {@linkcode LintResult.values}.
 * @param limit Maximum count. Defaults to 6.
 */
export const suggestNext = (values: Values, limit?: number): Suggestion[] =>
  def().suggest(values, limit);

/** The bottom layer that reads a command string. Only when you need to handle it directly. */
export const scanCommand = (text: string): { head: string | null; items: Item[] } =>
  def().scan(text);

/** If it's a typo, what was meant. */
export const nearestFlags = (flag: string, limit?: number): string[] =>
  def().nearest(flag, limit);

/**
 * What the default handle checks against.
 *
 * A function — as a constant, a bare import would search the file system, and
 * above all it couldn't answer **which handle's** source it is. If you built a
 * handle, use `yt.source`.
 */
export const schemaSource = (): SchemaSource => def().source;

/** Reads just one token. For several, use `explainCommand`. */
export const explainItem = (item: Item): Explained => def().explain([item])[0]!;
