/**
 * Where the schema is picked up from — env var, working directory, the file shipped with the package.
 *
 * The only part of `yt-studio` that touches the file system, kept apart from
 * `index.ts` so the CLI can run it as an `Effect` and see the failure type, while
 * the public functions stay plain and throw. Nothing here is re-exported except
 * {@linkcode bundledSchema} and {@linkcode Where}.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config, Data, Effect, Option } from 'effect';

import { SchemaError, TYPES_VERSION } from './browser.js';
import { decodeRawSchema } from './core/schema.js';
import type { SchemaOrigin, SchemaSource } from './browser.js';
import type { RawSchema } from './core/schema.js';

/**
 * File name of the local schema.
 *
 * Plain `schema.json` would collide with JSON Schema files at the root of other
 * people's projects — it is a common name. Baking the package into the name
 * means the file name itself says why it is there.
 */
const SCHEMA_FILE = 'yt-studio.schema.json';

/** `YT_STUDIO_SCHEMA` points at nothing we can read. */
export class SchemaMissing extends Data.TaggedError('SchemaMissing')<{ readonly path: string }> {
  override get message(): string {
    return `YT_STUDIO_SCHEMA 가 가리키는 스키마를 읽지 못했다: ${this.path}`;
  }
}

/**
 * Reads a schema file: `null` when it isn't there or isn't ours, a {@linkcode SchemaError} when it is ours but broken.
 *
 * Since we search the working directory, we may pick up someone else's JSON — one
 * without `ytdlp_version` is treated as absent. But a file that **is** ours and can't
 * be used must not be skipped silently: that would check against the bundled
 * version and report a pass. That covers two cases.
 *
 * - can't be read — no permission, or a directory under our file name
 * - not JSON at all — our file name, cut off mid-write (`yt-studio types` interrupted)
 * - has `ytdlp_version` but a field is missing or wrong — {@linkcode decodeRawSchema} lists them
 *
 * An unreadable file used to be left out of the error channel as a "defect". But
 * permissions and a stray directory are the user's environment, not a bug in this
 * code — and as a defect it took down `--help` and `yt-studio types`, the command
 * that rewrites this very file, with a stack trace and exit 1.
 */
const readSchema = (path: string): Effect.Effect<RawSchema | null, SchemaError> =>
  Effect.gen(function* () {
    if (!existsSync(path)) return null;
    const text = yield* Effect.try({
      try: () => readFileSync(path, 'utf8'),
      catch: e => new SchemaError([`${path} — 읽지 못했다 (${(e as Error).message})`]),
    });
    const v = yield* Effect.try({
      try: (): unknown => JSON.parse(text),
      catch: e => new SchemaError([`${path} — JSON 으로 읽지 못했다 (${(e as Error).message})`]),
    });
    if (typeof v !== 'object' || v === null || !('ytdlp_version' in v)) return null;
    return yield* decodeRawSchema(v).pipe(
      Effect.mapError(e => new SchemaError(e.problems.map(p => `${path}: ${p}`))),
    );
  });

const bundledPath = fileURLToPath(new URL(`../${SCHEMA_FILE}`, import.meta.url));

/** The one shipped with the package. If it is missing or broken the types are too, so there is no recovering. */
const readBundled: Effect.Effect<RawSchema> = readSchema(bundledPath).pipe(
  Effect.orDie,
  Effect.flatMap(raw => raw ? Effect.succeed(raw) : Effect.die(new Error(`패키지에 ${SCHEMA_FILE} 이 없다 — 설치가 깨졌다`))),
);

let bundled: RawSchema | undefined;

/**
 * Returns the schema shipped with the package, as is.
 *
 * **It is where the types came from**, so `yt-studio types` uses it as the
 * baseline — the `.d.ts` it writes extends this, so "new options" must always
 * be relative to it. Using the currently active schema as the baseline would
 * drift from the second run on.
 *
 * **Read on first call**, then kept. It used to be a constant, which read and
 * parsed 114KB of JSON the moment `yt-studio` was imported — even for users
 * passing their own schema, and against the lazy default handle below.
 */
export function bundledSchema(): RawSchema {
  return (bundled ??= Effect.runSync(readBundled));
}

/** Where to look for the schema. Anything omitted falls back to the process's own. */
export interface Where {
  /** Directory to look for `yt-studio.schema.json` in. */
  cwd?: string;
  /** Path to use instead of `YT_STUDIO_SCHEMA`. */
  env?: string;
}

/** A schema and where it was found. */
export interface Resolved {
  source: SchemaSource;
  raw: RawSchema;
}

/**
 * `YT_STUDIO_SCHEMA`, through Effect's `ConfigProvider` — the environment by default.
 *
 * A string that is merely absent is not an error, so the only `ConfigError` left
 * would be a broken provider. That is a defect.
 */
const schemaEnv: Effect.Effect<string | undefined> = Config.String('YT_STUDIO_SCHEMA').pipe(
  Config.option,
  Effect.map(Option.getOrUndefined),
  Effect.orDie,
);

/**
 * Finds the schema — env var, working directory, then bundled — with its failures in the type.
 *
 * `resolveSchema` in `index.ts` runs this and throws. The CLI runs it and turns a
 * failure into exit 2, while a defect still surfaces as itself.
 */
export const resolveWith = (at: Where): Effect.Effect<Resolved, SchemaError | SchemaMissing> =>
  Effect.gen(function* () {
    const found = (from: SchemaOrigin, path: string, raw: RawSchema): Resolved => ({
      source: {
        from, path,
        version: raw.ytdlp_version,
        typesVersion: TYPES_VERSION,
        stale: raw.ytdlp_version !== TYPES_VERSION,
      },
      raw,
    });

    // An empty value counts as unset — `YT_STUDIO_SCHEMA= yt-studio lint …` turns it off.
    const env = at.env ?? (yield* schemaEnv);
    if (env) {
      // If something explicitly pointed to can't be read, don't move on silently.
      // That is a typo, and moving on would check against the wrong version and
      // then report a pass.
      const path = resolve(env);
      const raw = yield* readSchema(path);
      if (!raw) return yield* new SchemaMissing({ path });
      return found('env', path, raw);
    }

    const path = resolve(at.cwd ?? process.cwd(), SCHEMA_FILE);
    const raw = yield* readSchema(path);
    if (raw) return found('local', path, raw);

    return found('bundled', bundledPath, bundledSchema());
  });
