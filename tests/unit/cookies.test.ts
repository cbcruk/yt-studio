/**
 * `--cookies-from-browser` — a value with four slots.
 *
 *     BROWSER[+KEYRING][:PROFILE][::CONTAINER]
 *
 * Like `-f` · `-o`, the value itself is a structure, so this is a hand-written layer,
 * but **the vocabulary comes from the schema.** Grammar and vocabulary once lived in
 * one file and the `-o` type table quietly diverged.
 *
 * The strings below were checked against the regex of the real yt-dlp (2026.07.04).
 * `firefox::Personal` (a container without a profile) is the especially confusing case.
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { Result } from 'effect';

import type { CookieSource, CookieVocabs } from '../../src/core/cookies.js';

const { parseCookieSource: parse, emitCookieSource } = await import('../../src/core/cookies.js');
const { GrammarError } = await import('../../src/core/grammar-error.js');

/** Reads assuming it succeeds — a failure throws the GrammarError. */
const parseCookieSource = (v: string, vocabs?: CookieVocabs): CookieSource =>
  Result.getOrThrow(parse(v, vocabs));

/** The reason reading failed. Fails the test if it read, or failed with anything but GrammarError. */
const failure = (v: string, vocabs?: CookieVocabs): string => {
  const r = parse(v, vocabs);
  assert.ok(Result.isFailure(r), `통과해버림: ${v}`);
  assert.ok(r.failure instanceof GrammarError);
  return r.failure.message;
};
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

  // A container without a profile — must tell a single `:` from `::`
  assert.deepEqual(parseCookieSource('firefox::Personal', V),
    { browser: 'firefox', keyring: null, profile: null, container: 'Personal' });

  assert.deepEqual(parseCookieSource('brave:/home/me/profile::Work', V),
    { browser: 'brave', keyring: null, profile: '/home/me/profile', container: 'Work' });
});

// yt-dlp normalizes with `.lower()` · `.upper()`. If we did not follow, `Firefox` would
// be flagged as an error, yet yt-dlp accepts it.
test('대소문자를 yt-dlp 와 같게 맞춘다', () => {
  assert.equal(parseCookieSource('Firefox', V).browser, 'firefox');
  assert.equal(parseCookieSource('chrome+gnomekeyring', V).keyring, 'GNOMEKEYRING');
});

test('어휘 밖은 자리마다 다르게 말한다', () => {
  assert.match(failure('chrom', V), /쿠키를 읽을 수 있는 브라우저가 아니다/);
  assert.match(failure('firefox+NOPE', V), /아는 키링이 아니다/);
});

// Without a vocabulary only the shape is checked — it must be usable without a schema.
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

// This is why every slot got a name — joining strings confuses `::` with `:`.
// The four below were checked against the real yt-dlp regex.
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
  // Characters the shell would touch get quoted (`~` expands to home)
  assert.equal(cmd(ytdlp(U).cookiesFromBrowser('firefox', { profile: '~/.mozilla/firefox/x' })),
    '--cookies-from-browser "firefox:~/.mozilla/firefox/x"');

  // Its own checker must accept what the builder produced
  assert.equal(ytdlp(U).cookiesFromBrowser('firefox', { container: 'Personal' }).lint().ok, true);
});

// Had the vocabulary been hand-written, it would have quietly diverged when yt-dlp
// supported one more browser. Pin down that it comes from the schema.
test('어휘는 스키마에서 온다', async () => {
  const { bundledSchema } = await import('../../src/index.js');
  const BUNDLED = bundledSchema();
  const o = BUNDLED.options.find(x => x.id === 'cookies-from-browser')!;
  assert.deepEqual(Object.keys(o.vocabs ?? {}).sort(), ['browser', 'keyring']);
  assert.ok(o.vocabs!['browser']!.includes('firefox'));
  assert.ok(o.vocabs!['keyring']!.includes('KWALLET6'));
});
