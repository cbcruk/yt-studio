/**
 * 포맷 셀렉터 문법. 브라우저 없이 도는 유일한 층이다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFormat, emitTree, parseFilterBody, emitFilter, PREC,
} from '../../src/core/format-grammar.js';

const round = s => emitTree(parseFormat(s));

test('실제로 쓰이는 표현식이 글자 그대로 왕복한다', () => {
  const cases = [
    'best',
    'bv+ba',
    'bv*[height<=1080]+ba',
    'bv+ba/b',
    'bestvideo[height<=?1080][fps>30]+bestaudio/best',
    'bv[ext=mp4]+ba[ext=m4a]/bv+ba/b',
    '137+140',
    'bv,ba',
    '(bv/wv)+ba',
    'b*[vcodec^=avc1]',
    'ba[acodec!=opus]',
    'b[format_note]',
    'b[!format_note]',
    'bv[width>=1920][ext!=webm]+ba[abr>=128]/b',
    'bv*[height<=720]/wv*[height>360]',
  ];
  for (const s of cases) assert.equal(round(s), s, s);
});

test('빈 입력은 트리가 없다', () => {
  assert.equal(parseFormat(''), null);
  assert.equal(parseFormat('   '), null);
  assert.equal(emitTree(null), '');
});

test('+ 가 / 보다 강하게 묶인다 — bv+ba/b 는 (bv+ba)/b', () => {
  const t = parseFormat('bv+ba/b');
  assert.equal(t.t, 'fallback');
  assert.deepEqual(t.kids.map(k => k.t), ['merge', 'sel']);

  const u = parseFormat('b/bv+ba');
  assert.equal(u.t, 'fallback');
  assert.deepEqual(u.kids.map(k => k.t), ['sel', 'merge']);
});

test(', 가 가장 약하게 묶인다', () => {
  const t = parseFormat('bv+ba,b/w');
  assert.equal(t.t, 'multi');
  assert.deepEqual(t.kids.map(k => k.t), ['merge', 'fallback']);
});

test('우선순위가 낮은 자식에는 괄호가 자동으로 붙는다', () => {
  const sel = name => ({ t: 'sel', name, filters: [] });
  const tree = {
    t: 'merge',
    kids: [{ t: 'fallback', kids: [sel('bv'), sel('wv')] }, sel('ba')],
  };
  assert.equal(emitTree(tree), '(bv/wv)+ba');
  assert.equal(round('(bv/wv)+ba'), '(bv/wv)+ba');
});

test('불필요한 괄호는 다시 뱉을 때 사라진다', () => {
  assert.equal(round('(bv+ba)/b'), 'bv+ba/b');
  assert.equal(round('((best))'), 'best');
});

test('망가진 입력은 이유를 담아 거부한다', () => {
  const bad = ['bv+', '(bv+ba', 'bv[height<=]x', 'bv+ba)', 'bv[unclosed'];
  for (const s of bad) {
    assert.throws(() => parseFormat(s), Error, `통과해버림: ${s}`);
  }
});

test('그룹에도 필터가 붙는다 — yt-dlp 문서에 나오는 표현이다', () => {
  const cases = [
    '(mp4,webm)[height<480]',
    '(bv+ba)[height<=720]',
    '(bv[height<=1080]+ba)[filesize<500M]',
    '(mp4,webm)[height<480]+ba',
    '(mp4,webm)[height<480]/b',
  ];
  for (const s of cases) assert.equal(round(s), s, s);
});

test('필터가 붙은 그룹은 이미 괄호를 쓰므로 부모가 또 감싸지 않는다', () => {
  // 필터가 없으면 우선순위대로 괄호가 붙는다
  assert.equal(round('(bv,ba)+x'), '(bv,ba)+x');
  // 필터가 있으면 그 괄호가 곧 그룹이다 — ((…))+x 가 되면 안 된다
  assert.equal(round('(bv,ba)[fps>30]+x'), '(bv,ba)[fps>30]+x');
});

test('연산자가 하나면 괄호가 풀리고 필터만 남는다', () => {
  // (bv)[height<480] 과 bv[height<480] 은 같은 뜻이다
  assert.equal(round('(bv)[height<480]'), 'bv[height<480]');
  assert.equal(round('((bv+ba)[fps>30])[height<480]'), '(bv+ba)[fps>30][height<480]');
});

test('그룹 필터에도 닫힘 검사는 그대로 걸린다', () => {
  assert.throws(() => parseFormat('(bv+ba)[height'), /'\]' 가 닫히지 않았다/);
  assert.throws(() => parseFormat('()'), /셀렉터를 찾지 못했다/);
});

test('필터 본문: 비교 · 존재 · 부재 · ? 접미사', () => {
  assert.deepEqual(parseFilterBody('height<=1080'),
    { key: 'height', op: '<=', loose: false, value: '1080' });
  assert.deepEqual(parseFilterBody('height<=?1080'),
    { key: 'height', op: '<=', loose: true, value: '1080' });
  assert.deepEqual(parseFilterBody('vcodec^=avc1'),
    { key: 'vcodec', op: '^=', loose: false, value: 'avc1' });
  assert.deepEqual(parseFilterBody('acodec!=opus'),
    { key: 'acodec', op: '!=', loose: false, value: 'opus' });
  assert.deepEqual(parseFilterBody('format_note'),
    { key: 'format_note', op: 'has', value: '' });
  assert.deepEqual(parseFilterBody('!format_note'),
    { key: 'format_note', op: 'hasnot', value: '' });
});

test('<= 를 < 보다 먼저 읽는다', () => {
  assert.equal(parseFilterBody('height<=720').op, '<=');
  assert.equal(parseFilterBody('height<720').op, '<');
  assert.equal(parseFilterBody('height>=720').op, '>=');
  assert.equal(parseFilterBody('height>720').op, '>');
});

test('? 는 필터마다 독립이다', () => {
  const s = 'bv[height<=?1080][fps>30]';
  const t = parseFormat(s);
  assert.equal(t.filters[0].loose, true);
  assert.equal(t.filters[1].loose, false);
  assert.equal(emitTree(t), s);
});

test('필터를 다시 뱉는 규칙', () => {
  assert.equal(emitFilter({ key: 'ext', op: '=', value: 'mp4' }), '[ext=mp4]');
  assert.equal(emitFilter({ key: 'height', op: '<=', loose: true, value: '720' }), '[height<=?720]');
  assert.equal(emitFilter({ key: 'format_note', op: 'has' }), '[format_note]');
  assert.equal(emitFilter({ key: 'format_note', op: 'hasnot' }), '[!format_note]');
});

test('우선순위 표는 sel > merge > fallback > multi', () => {
  assert.ok(PREC.sel > PREC.merge);
  assert.ok(PREC.merge > PREC.fallback);
  assert.ok(PREC.fallback > PREC.multi);
});
