/**
 * `--cookies-from-browser` 한 줄 읽기.
 *
 *     BROWSER[+KEYRING][:PROFILE][::CONTAINER]
 *     firefox
 *     chrome+GNOMEKEYRING
 *     firefox:~/snap/firefox/common/.mozilla/firefox/default-release
 *     firefox::Personal
 *
 * `-f` · `-o` 처럼 값 자체가 구조라 손으로 적는 층이다. 다만 **어휘는 안 적는다** —
 * 브라우저 9개와 키링 5개는 스키마가 들고 온다(`opt.vocabs`). 이 저장소는 그
 * 둘을 한 파일에 두었다가 `-o` 종류 표가 조용히 갈린 적이 있다.
 *
 * 문법은 yt-dlp 의 정규식을 그대로 옮겼다(`yt_dlp/__init__.py`).
 *
 *   · 브라우저는 `+` 와 `:` 를 못 쓴다      `[^+:]+`
 *   · 키링은 `:` 를 못 쓴다                `[^:]+`
 *   · 프로필은 `::` 앞에서 멈춘다          `(?!:)(.+?)`
 *   · 컨테이너는 나머지 전부              `(.+)`
 *
 * 대소문자는 yt-dlp 가 정규화한다 — 브라우저는 소문자로, 키링은 대문자로.
 * 그러니 `Firefox` 도 `FIREFOX` 도 맞는 값이다.
 */

/** 읽어 낸 네 자리. 안 준 자리는 `null`. */
export interface CookieSource {
  browser: string;
  keyring: string | null;
  profile: string | null;
  container: string | null;
}

/** 자리마다의 어휘. 스키마의 `opt.vocabs` 가 이 모양이다. */
export interface CookieVocabs {
  browser?: string[];
  keyring?: string[];
}

const SHAPE = /^([^+:]+)(?:\s*\+\s*([^:]+))?(?:\s*:\s*(?!:)(.+?))?(?:\s*::\s*(.+))?$/;

/** 값 하나가 못 읽히는 이유. 사람이 읽을 한국어 한 줄. */
export class CookieError extends Error {}

/**
 * 문자열 → 네 자리. 못 읽으면 `CookieError` 를 던진다.
 *
 * 어휘를 안 주면 모양만 본다 — 스키마 없이도 쓸 수 있어야 해서다.
 */
export function parseCookieSource(value: string, vocabs: CookieVocabs = {}): CookieSource {
  const m = SHAPE.exec(String(value ?? '').trim());
  if (!m) throw new CookieError('BROWSER[+KEYRING][:PROFILE][::CONTAINER] 모양이 아니다');

  const browser = m[1]!.trim().toLowerCase();
  const keyring = m[2] === undefined ? null : m[2].trim().toUpperCase();

  const known = vocabs.browser;
  if (known?.length && !known.includes(browser)) {
    throw new CookieError(`${browser} 는 쿠키를 읽을 수 있는 브라우저가 아니다 (${known.join(' · ')})`);
  }
  const rings = vocabs.keyring;
  if (keyring !== null && rings?.length && !rings.includes(keyring)) {
    throw new CookieError(`${keyring} 는 아는 키링이 아니다 (${rings.join(' · ')})`);
  }

  return {
    browser,
    keyring,
    profile: m[3] === undefined ? null : m[3].trim(),
    container: m[4] === undefined ? null : m[4].trim(),
  };
}

/** 네 자리 → 문자열. `parseCookieSource` 와 왕복한다. */
export function emitCookieSource(s: CookieSource): string {
  return s.browser
    + (s.keyring ? `+${s.keyring}` : '')
    + (s.profile ? `:${s.profile}` : '')
    + (s.container ? `::${s.container}` : '');
}
