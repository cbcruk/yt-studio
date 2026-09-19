/**
 * Reading one `--cookies-from-browser` value.
 *
 *     BROWSER[+KEYRING][:PROFILE][::CONTAINER]
 *     firefox
 *     chrome+GNOMEKEYRING
 *     firefox:~/snap/firefox/common/.mozilla/firefox/default-release
 *     firefox::Personal
 *
 * Like `-f` · `-o`, the value itself is a structure, so this layer is written by
 * hand. The **vocabulary is not** — the 9 browsers and 5 keyrings come with the
 * schema (`opt.vocabs`). This repo once kept both in one file, and the `-o`
 * type table quietly drifted.
 *
 * The grammar is yt-dlp's regex carried over as-is (`yt_dlp/__init__.py`).
 *
 * - the browser can't contain `+` or `:`      `[^+:]+`
 * - the keyring can't contain `:`             `[^:]+`
 * - the profile stops before `::`             `(?!:)(.+?)`
 * - the container is everything left          `(.+)`
 *
 * yt-dlp normalizes case — browsers to lower case, keyrings to upper case.
 * So `Firefox` and `FIREFOX` are both valid.
 */

import { Result } from 'effect';

import { GrammarError } from './grammar-error.js';

/** The four slots read out. Slots not given are `null`. */
export interface CookieSource {
  browser: string;
  keyring: string | null;
  profile: string | null;
  container: string | null;
}

/** Vocabulary per slot. The schema's `opt.vocabs` has this shape. */
export interface CookieVocabs {
  browser?: string[];
  keyring?: string[];
}

const SHAPE = /^([^+:]+)(?:\s*\+\s*([^:]+))?(?:\s*:\s*(?!:)(.+?))?(?:\s*::\s*(.+))?$/;

/**
 * String → four slots. Fails with {@linkcode GrammarError} carrying the reason when it can't be read.
 *
 * Without vocabularies only the shape is checked — it has to be usable without a schema.
 *
 * There used to be a `CookieError extends GrammarError`; no caller ever told the
 * two apart, so the failure is the same type as `-f` · `-o` (#34).
 */
export function parseCookieSource(value: string, vocabs: CookieVocabs = {}): Result.Result<CookieSource, GrammarError> {
  return Result.gen(function* () {
    const m = SHAPE.exec(String(value ?? '').trim());
    if (!m) return yield* Result.fail(new GrammarError('BROWSER[+KEYRING][:PROFILE][::CONTAINER] 모양이 아니다'));

    const browser = m[1]!.trim().toLowerCase();   // group 1 is required
    const keyring = m[2] === undefined ? null : m[2].trim().toUpperCase();

    const known = vocabs.browser;
    if (known?.length && !known.includes(browser)) {
      return yield* Result.fail(new GrammarError(`${browser} 는 쿠키를 읽을 수 있는 브라우저가 아니다 (${known.join(' · ')})`));
    }
    const rings = vocabs.keyring;
    if (keyring !== null && rings?.length && !rings.includes(keyring)) {
      return yield* Result.fail(new GrammarError(`${keyring} 는 아는 키링이 아니다 (${rings.join(' · ')})`));
    }

    return {
      browser,
      keyring,
      profile: m[3] === undefined ? null : m[3].trim(),
      container: m[4] === undefined ? null : m[4].trim(),
    };
  });
}

/** Four slots → string. Round-trips with `parseCookieSource`. */
export function emitCookieSource(s: CookieSource): string {
  return s.browser
    + (s.keyring ? `+${s.keyring}` : '')
    + (s.profile ? `:${s.profile}` : '')
    + (s.container ? `::${s.container}` : '');
}
