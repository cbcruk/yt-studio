/**
 * The layer that turns a command back into plain language.
 *
 * For a while this module's only test was an output-string assertion in
 * `tests/cli.test.ts`. That is, it looked at **the screen the CLI drew**, not the
 * logic, and could pass with a wrong rule as long as the line breaks matched.
 * Moved here.
 *
 * The hard part of this layer is drawing the filename without knowing the values —
 * fields stay as placeholders and only `-P home` is prepended.
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';

const {
  DEFAULT_OUTTMPL, previewFilename, explainCommand, explainItem, suggestNext, lintCommand,
} = await import('../../src/index.js');

// The value table and item sequence are already built by lintCommand. Imitating them
// here would test something that diverged from the real flow — the CLI takes these two as-is.
const valuesOf = (cmd: string) => lintCommand(cmd).values;
const itemsOf = (cmd: string) => lintCommand(cmd).items;

test('-o 가 없으면 yt-dlp 기본 템플릿을 쓰고 그렇다고 표시한다', () => {
  const f = previewFilename({});
  assert.equal(f.ok, true);
  assert.equal(f.dflt, true);
  assert.equal(f.text, '‹제목› [‹영상 ID›].‹확장자›');
  assert.equal(DEFAULT_OUTTMPL, '%(title)s [%(id)s].%(ext)s');
});

test('필드는 자리표시자로 둔다 — 값을 모르니까', () => {
  const f = previewFilename(valuesOf('yt-dlp -o "%(uploader)s/%(title)s.%(ext)s" https://y.be/a'));
  assert.equal(f.text, '‹업로더›/‹제목›.‹확장자›');
  assert.equal(f.dflt, false, '-o 를 줬으면 기본값이 아니다');
});

// "What lands where" must be visible in one line.
test('-P home 을 앞에 붙인다 — 구분자는 한 번만', () => {
  const one = previewFilename(valuesOf('yt-dlp -P /dl -o "%(title)s.%(ext)s" https://y.be/a'));
  assert.equal(one.text, '/dl/‹제목›.‹확장자›');

  const slash = previewFilename(valuesOf('yt-dlp -P /dl/ -o "%(title)s.%(ext)s" https://y.be/a'));
  assert.equal(slash.text, '/dl/‹제목›.‹확장자›');
});

test('home 이 아닌 -P 는 파일명에 안 붙는다', () => {
  const f = previewFilename(valuesOf('yt-dlp -P temp:/tmp/yt -o "%(title)s.%(ext)s" https://y.be/a'));
  assert.equal(f.text, '‹제목›.‹확장자›');
});

test('종류별 -o 는 종류를 따로 들고 있는다', () => {
  const f = previewFilename(valuesOf('yt-dlp -o "thumbnail:%(id)s.%(ext)s" https://y.be/a'));
  assert.equal(f.type, 'thumbnail');
  assert.equal(f.text, '‹영상 ID›.‹확장자›');
});

// If the grammar is broken, do not make things up — return the original and lower ok.
test('-o 를 못 읽으면 원문을 그대로 돌려준다', () => {
  const f = previewFilename(valuesOf('yt-dlp -o "%(title)" https://y.be/a'));
  assert.equal(f.ok, false);
  assert.equal(f.text, '%(title)');
});

test('토큰마다 무슨 옵션이고 어느 단계인지 말한다', () => {
  const rows = explainCommand(itemsOf('yt-dlp -x https://youtu.be/abc'));
  const x = rows.find(r => r.id === 'extract-audio')!;
  assert.equal(x.kind, 'opt');
  assert.equal(x.text, '-x');
  assert.equal(x.stage, 'process');
  assert.ok(x.stageLabel, '단계 이름이 있어야 한다');
  assert.ok(x.ko.length > 0);

  assert.equal(rows.at(-1)!.kind, 'url');
  assert.equal(rows.at(-1)!.ko, '받을 대상');
});

// A negated form must say it is "turned off". Reading --no-part as "use part" would
// describe the exact opposite.
test('부정형은 끈 것이라고 말한다', () => {
  const [row] = explainCommand(itemsOf('yt-dlp --no-part https://y.be/a'));
  assert.match(row!.ko, /끄기$/);
});

test('읽지 못한 토큰도 원문을 들고 한 줄을 낸다', () => {
  const rows = explainCommand(itemsOf('yt-dlp --nope https://y.be/a'));
  const u = rows.find(r => r.kind === 'unknown')!;
  assert.equal(u.text, '--nope');
  assert.equal(u.ko, '읽지 못한 토큰');
});

test('explainCommand 는 explainItem 을 순서대로 편 것이다', () => {
  const items = itemsOf('yt-dlp -x -o "%(title)s.%(ext)s" https://y.be/a');
  assert.deepEqual(explainCommand(items), items.map(explainItem));
});

// Not any of the 191, only what the current command calls for.
test('다음 걸음은 지금 조합에서 따라오는 것만 낸다', () => {
  const ids = suggestNext(valuesOf('yt-dlp -x https://y.be/a')).map(s => s.opt.id);
  assert.ok(ids.includes('audio-format'), ids.join(' '));
  assert.ok(ids.includes('embed-thumbnail'), ids.join(' '));
  assert.ok(!ids.includes('sub-langs'), '자막은 안 부르는데 나왔다');
});

test('이미 준 옵션은 다시 안 권한다', () => {
  const ids = suggestNext(valuesOf('yt-dlp -x --audio-format mp3 https://y.be/a')).map(s => s.opt.id);
  assert.ok(!ids.includes('audio-format'), ids.join(' '));
});

test('-f 에 + 가 있으면 합칠 컨테이너를 권한다', () => {
  const ids = suggestNext(valuesOf('yt-dlp -f bv+ba https://y.be/a')).map(s => s.opt.id);
  assert.ok(ids.includes('merge-output-format'), ids.join(' '));
});

// Leaving it empty when no rule matches would give a freshly written command no next step.
test('아무 규칙도 안 걸리면 시작 옵션을 낸다', () => {
  const s = suggestNext(valuesOf('yt-dlp https://y.be/a'));
  assert.ok(s.length > 0);
  assert.ok(s.every(x => x.why.length > 0), '이유 없는 제안이 있다');
});

test('limit 을 넘지 않는다', () => {
  assert.ok(suggestNext(valuesOf('yt-dlp -x https://y.be/a'), 2).length <= 2);
});
