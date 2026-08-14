/**
 * `--cookies-from-browser` — 자리가 넷인 값.
 *
 *     BROWSER[+KEYRING][:PROFILE][::CONTAINER]
 *
 * `-f` · `-o` 처럼 값 자체가 구조라 손으로 적는 층인데, **어휘는 스키마가
 * 들고 온다.** 그 둘을 한 파일에 두었다가 `-o` 종류 표가 조용히 갈린 적이 있어서다.
 *
 * 아래 문자열들은 진짜 yt-dlp(2026.07.04)의 정규식에 넣어 결과를 대조한 것이다.
 * `firefox::Personal`(프로필 없이 컨테이너만)이 특히 헷갈리는 자리다.
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';

const { parseCookieSource, emitCookieSource, CookieError } =
  await import('../../src/core/cookies.js');
const { lintCommand, ytdlp } = await import('../../src/index.js');

const V = {
  browser: ['brave', 'chrome', 'chromium', 'edge', 'firefox', 'opera', 'safari', 'vivaldi', 'whale'],
  keyring: ['BASICTEXT', 'GNOMEKEYRING', 'KWALLET', 'KWALLET5', 'KWALLET6'],
};

test('네 자리를 갈라 읽는다', () => {
  assert.deepEqual(parseCookieSource('firefox', V),
    { browser: 'firefox', keyring: null, profile: null, container: null });

  assert.deepEqual(parseCookieSource('chrome+GNOMEKEYRING', V),
    { browser: 'chrome', keyring: 'GNOMEKEYRING', profile: null, container: null });

  // 프로필 없이 컨테이너만 — `:` 하나와 `::` 를 갈라야 한다
  assert.deepEqual(parseCookieSource('firefox::Personal', V),
    { browser: 'firefox', keyring: null, profile: null, container: 'Personal' });

  assert.deepEqual(parseCookieSource('brave:/home/me/profile::Work', V),
    { browser: 'brave', keyring: null, profile: '/home/me/profile', container: 'Work' });
});

// yt-dlp 가 `.lower()` · `.upper()` 로 정규화한다. 안 따라가면 `Firefox` 가
// 오류로 잡히는데, 그건 yt-dlp 가 받는 값이다.
test('대소문자를 yt-dlp 와 같게 맞춘다', () => {
  assert.equal(parseCookieSource('Firefox', V).browser, 'firefox');
  assert.equal(parseCookieSource('chrome+gnomekeyring', V).keyring, 'GNOMEKEYRING');
});

test('어휘 밖은 자리마다 다르게 말한다', () => {
  assert.throws(() => parseCookieSource('chrom', V), /쿠키를 읽을 수 있는 브라우저가 아니다/);
  assert.throws(() => parseCookieSource('firefox+NOPE', V), /아는 키링이 아니다/);
  assert.throws(() => parseCookieSource('chrom', V), CookieError);
});

// 어휘를 안 주면 모양만 본다 — 스키마 없이도 쓸 수 있어야 한다.
test('어휘 없이는 모양만 본다', () => {
  assert.equal(parseCookieSource('nosuchbrowser').browser, 'nosuchbrowser');
});

test('읽은 것을 다시 뱉으면 같다', () => {
  for (const s of ['firefox', 'chrome+GNOMEKEYRING', 'firefox::Personal',
    'brave:/home/me/profile::Work', 'edge+KWALLET6:default']) {
    assert.equal(emitCookieSource(parseCookieSource(s, V)), s, s);
  }
});

test('검증기가 이걸로 본다', () => {
  const err = (t: string): string =>
    lintCommand(t).issues.filter(i => i.level === 'error').map(i => i.msg).join(' | ');

  assert.equal(lintCommand('yt-dlp --cookies-from-browser firefox https://x/y').counts.error, 0);
  assert.equal(lintCommand('yt-dlp --cookies-from-browser firefox::Personal https://x/y').counts.error, 0);
  assert.match(err('yt-dlp --cookies-from-browser chrom https://x/y'), /chrom 는/);
  assert.match(err('yt-dlp --cookies-from-browser firefox+NOPE https://x/y'), /NOPE 는/);
});

// 자리마다 이름을 붙인 이유가 이것이다 — 문자열로 이으면 `::` 와 `:` 를
// 헷갈린다. 아래 넷은 진짜 yt-dlp 의 정규식으로 결과를 대조했다.
test('빌더가 자리를 제대로 잇는다', () => {
  const U = 'https://youtu.be/abc';
  const cmd = (c: { build(): string }): string => c.build().replace(`yt-dlp `, '').replace(` ${U}`, '');

  assert.equal(cmd(ytdlp(U).cookiesFromBrowser('firefox')), '--cookies-from-browser firefox');
  assert.equal(cmd(ytdlp(U).cookiesFromBrowser('chrome', { keyring: 'GNOMEKEYRING' })),
    '--cookies-from-browser chrome+GNOMEKEYRING');
  assert.equal(cmd(ytdlp(U).cookiesFromBrowser('firefox', { container: 'Personal' })),
    '--cookies-from-browser firefox::Personal');
  assert.equal(cmd(ytdlp(U).cookiesFromBrowser('brave', { profile: '/home/me/p', container: 'Work' })),
    '--cookies-from-browser brave:/home/me/p::Work');
  // 셸이 건드릴 글자가 들어가면 따옴표가 붙는다 (`~` 는 홈으로 펴진다)
  assert.equal(cmd(ytdlp(U).cookiesFromBrowser('firefox', { profile: '~/.mozilla/firefox/x' })),
    '--cookies-from-browser "firefox:~/.mozilla/firefox/x"');

  // 빌더가 낸 것을 제 검증기가 받아야 한다
  assert.equal(ytdlp(U).cookiesFromBrowser('firefox', { container: 'Personal' }).lint().ok, true);
});

// 어휘가 손으로 적혀 있었다면 yt-dlp 가 브라우저를 하나 더 지원할 때 조용히
// 갈렸을 것이다. 스키마에서 온다는 것을 못 박는다.
test('어휘는 스키마에서 온다', async () => {
  const { BUNDLED } = await import('../../src/index.js');
  const o = BUNDLED.options.find(x => x.id === 'cookies-from-browser')!;
  assert.deepEqual(Object.keys(o.vocabs ?? {}).sort(), ['browser', 'keyring']);
  assert.ok(o.vocabs!['browser']!.includes('firefox'));
  assert.ok(o.vocabs!['keyring']!.includes('KWALLET6'));
});
