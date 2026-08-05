/**
 * 명령어 문자열 편집.
 *
 * 옵션을 고르는 길이 여럿(의도 칩 · 다음 걸음 · 오타 후보)인데 문자열이
 * 바뀌는 자리는 둘뿐이다. 그래서 규칙도 둘뿐이고, 여기서 그 둘만 본다.
 * 예전에는 app.js 안에 있어서 e2e 로만 간접 검증됐다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { initSchema } from '../../src/core/schema.js';

initSchema(JSON.parse(await readFile(new URL('../../schema.json', import.meta.url), 'utf8')));
const { addToken, replaceFlag } = await import('../../src/core/edit.js');

/* ── addToken ────────────────────────────── */
test('빈 명령어에는 yt-dlp 를 세워 준다', () => {
  assert.equal(addToken('', '--embed-subs'), 'yt-dlp --embed-subs');
  assert.equal(addToken('   ', '-x'), 'yt-dlp -x');
});

test('플래그는 URL 앞에 들어간다', () => {
  assert.equal(
    addToken('yt-dlp -x https://youtu.be/abc', '--embed-thumbnail'),
    'yt-dlp -x --embed-thumbnail https://youtu.be/abc');
});

test('URL 이 여럿이어도 전부 뒤에 남는다', () => {
  assert.equal(
    addToken('yt-dlp https://a https://b', '--write-subs'),
    'yt-dlp --write-subs https://a https://b');
});

test('URL 이 없으면 그냥 뒤에 붙는다', () => {
  assert.equal(addToken('yt-dlp -x', '--audio-format mp3'), 'yt-dlp -x --audio-format mp3');
});

test('빈 토큰은 아무것도 안 바꾼다', () => {
  const cmd = 'yt-dlp -x https://a';
  for (const t of ['', '   ', null, undefined]) assert.equal(addToken(cmd, t), cmd, String(t));
});

test('여러 번 눌러도 인용이 늘거나 줄지 않는다', () => {
  let c = 'yt-dlp -o "%(title)s.%(ext)s" https://a';
  for (let i = 0; i < 3; i++) c = addToken(c, '--embed-subs');
  assert.equal(c, 'yt-dlp -o "%(title)s.%(ext)s" --embed-subs --embed-subs --embed-subs https://a');
  // 값의 인용은 표준형으로 고정된다 — 붙였다 뗐다 해도 흔들리지 않는다
  assert.equal(addToken('yt-dlp -f "bv+ba" https://a', '-x'), 'yt-dlp -f bv+ba -x https://a');
});

test('모르는 토큰도 자리를 지킨다', () => {
  assert.equal(
    addToken('yt-dlp --future-flag https://a', '--embed-subs'),
    'yt-dlp --future-flag --embed-subs https://a');
});

test('yt-dlp 가 앞에 없어도 세워 준다', () => {
  assert.equal(addToken('-x https://a', '--embed-metadata'), 'yt-dlp -x --embed-metadata https://a');
});

/* ── replaceFlag ─────────────────────────── */
test('플래그만 갈아 끼우고 값은 그대로 둔다', () => {
  assert.equal(
    replaceFlag('yt-dlp --write-sub ko https://a', '--write-sub', '--write-subs'),
    'yt-dlp --write-subs ko https://a');
});

test('더 긴 플래그의 앞부분을 집지 않는다', () => {
  // 이게 이 함수가 존재하는 이유다 — 단순 치환이면 --sub-langs 가 깨진다
  assert.equal(
    replaceFlag('yt-dlp --sub --sub-langs ko https://a', '--sub', '--sub-format'),
    'yt-dlp --sub-format --sub-langs ko https://a');
});

test('--flag=값 꼴도 살려 둔다', () => {
  assert.equal(
    replaceFlag('yt-dlp --write-sub=ko https://a', '--write-sub', '--write-subs'),
    'yt-dlp --write-subs=ko https://a');
});

test('맨 앞에 있어도 바뀐다', () => {
  assert.equal(replaceFlag('--write-sub https://a', '--write-sub', '--write-subs'),
    '--write-subs https://a');
});

test('여러 번 나오면 전부 바뀐다', () => {
  assert.equal(
    replaceFlag('yt-dlp --nope a --nope b', '--nope', '--print'),
    'yt-dlp --print a --print b');
});

test('정규식 글자가 든 플래그도 글자 그대로 본다', () => {
  assert.equal(replaceFlag('yt-dlp --a.b https://x', '--a.b', '--ok'), 'yt-dlp --ok https://x');
  // --a.b 를 정규식으로 봤다면 --axb 도 걸렸을 것이다
  assert.equal(replaceFlag('yt-dlp --axb https://x', '--a.b', '--ok'), 'yt-dlp --axb https://x');
});

test('빈 인자에는 손대지 않는다', () => {
  const cmd = 'yt-dlp -x https://a';
  assert.equal(replaceFlag(cmd, '', '--x'), cmd);
  assert.equal(replaceFlag(cmd, '-x', ''), cmd);
});
