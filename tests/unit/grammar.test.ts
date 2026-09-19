/**
 * -f format selector grammar.
 *
 * Parser and compiler are a pair, so they are tested by round trip — emitting what
 * was read must give the same thing, and parentheses must appear only where needed.
 */
import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { Result } from 'effect';

import type { FormatNode } from '../../src/core/format-grammar.js';

const { PREC, parseFormat: parseFormatResult, emitTree, parseFilterBody: parseFilterBodyResult, emitFilter } =
  await import('../../src/core/format-grammar.js');
const { GrammarError } = await import('../../src/core/grammar-error.js');

// Most tests here are about what gets read, so these unwrap — a failure throws the GrammarError.
const parseFormat = (s: string): FormatNode | null => Result.getOrThrow(parseFormatResult(s));
const parseFilterBody = (s: string) => Result.getOrThrow(parseFilterBodyResult(s));

/** The reason a parse failed. Fails the test if it read, or failed with anything but {@linkcode GrammarError}. */
const failure = (r: Result.Result<unknown, unknown>): string => {
  assert.ok(Result.isFailure(r), '통과해버림');
  assert.ok(r.failure instanceof GrammarError);
  return r.failure.message;
};

/** Read and emit again. The round trip is the core property of this grammar. */
const round = (s: string): string => emitTree(parseFormat(s));

/** Takes the parse result assuming there is one. Fails right there if not. */
const tree = (s: string): FormatNode => {
  const t = parseFormat(s);
  assert.ok(t, `${s} 를 못 읽었다`);
  return t;
};

/** Takes the children assuming an operator node. */
const kids = (n: FormatNode): FormatNode[] => {
  assert.notEqual(n.t, 'sel', '연산자 노드가 아니다');
  return (n as { kids: FormatNode[] }).kids;
};

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
  const t = tree('bv+ba/b');
  assert.equal(t.t, 'fallback');
  assert.deepEqual(kids(t).map(k => k.t), ['merge', 'sel']);

  const u = tree('b/bv+ba');
  assert.equal(u.t, 'fallback');
  assert.deepEqual(kids(u).map(k => k.t), ['sel', 'merge']);
});

test(', 가 가장 약하게 묶인다', () => {
  const t = tree('bv+ba,b/w');
  assert.equal(t.t, 'multi');
  assert.deepEqual(kids(t).map(k => k.t), ['merge', 'fallback']);
});

test('우선순위가 낮은 자식에는 괄호가 자동으로 붙는다', () => {
  // Build the tree by hand without the parser — look at emitTree alone
  const sel = (name: string): FormatNode => ({ t: 'sel', name, filters: [] });
  const hand: FormatNode = {
    t: 'merge',
    kids: [{ t: 'fallback', kids: [sel('bv'), sel('wv')] }, sel('ba')],
  };
  assert.equal(emitTree(hand), '(bv/wv)+ba');
  assert.equal(round('(bv/wv)+ba'), '(bv/wv)+ba');
});

test('불필요한 괄호는 다시 뱉을 때 사라진다', () => {
  assert.equal(round('(bv+ba)/b'), 'bv+ba/b');
  assert.equal(round('((best))'), 'best');
});

test('망가진 입력은 이유를 담아 거부한다', () => {
  const bad = ['bv+', '(bv+ba', 'bv[height<=]x', 'bv+ba)', 'bv[unclosed'];
  for (const s of bad) {
    assert.ok(Result.isFailure(parseFormatResult(s)), `통과해버림: ${s}`);
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
  // Without a filter, parentheses follow precedence
  assert.equal(round('(bv,ba)+x'), '(bv,ba)+x');
  // With a filter, those parentheses are the group — must not become ((…))+x
  assert.equal(round('(bv,ba)[fps>30]+x'), '(bv,ba)[fps>30]+x');
});

test('연산자가 하나면 괄호가 풀리고 필터만 남는다', () => {
  // (bv)[height<480] and bv[height<480] mean the same thing
  assert.equal(round('(bv)[height<480]'), 'bv[height<480]');
  assert.equal(round('((bv+ba)[fps>30])[height<480]'), '(bv+ba)[fps>30][height<480]');
});

test('그룹 필터에도 닫힘 검사는 그대로 걸린다', () => {
  assert.match(failure(parseFormatResult('(bv+ba)[height')), /'\]' 가 닫히지 않았다/);
  assert.match(failure(parseFormatResult('()')), /셀렉터를 찾지 못했다/);
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
  const t = tree(s);
  assert.equal(t.filters?.[0]?.loose, true);
  assert.equal(t.filters?.[1]?.loose, false);
  assert.equal(emitTree(t), s);
});

test('필터를 다시 뱉는 규칙', () => {
  assert.equal(emitFilter({ key: 'ext', op: '=', value: 'mp4' }), '[ext=mp4]');
  assert.equal(emitFilter({ key: 'height', op: '<=', loose: true, value: '720' }), '[height<=?720]');
  assert.equal(emitFilter({ key: 'format_note', op: 'has', value: '' }), '[format_note]');
  assert.equal(emitFilter({ key: 'format_note', op: 'hasnot', value: '' }), '[!format_note]');
});

test('우선순위 표는 sel > merge > fallback > multi', () => {
  assert.ok(PREC.sel > PREC.merge);
  assert.ok(PREC.merge > PREC.fallback);
  assert.ok(PREC.fallback > PREC.multi);
});


// Bad input must fail with GrammarError and nothing else, and never throw — any other
// exception is a parser bug and must not be dressed up as a verdict.
test('잘못된 입력은 GrammarError 로만 실패한다', async () => {
  const { parseCookieSource } = await import('../../src/core/cookies.js');
  const { parseTemplate } = await import('../../src/core/output-template.js');
  let seed = 7;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const junk = (alpha: string): string =>
    Array.from({ length: Math.floor(rnd() * 16) }, () => alpha[Math.floor(rnd() * alpha.length)]).join('');

  const cases: [string, (v: string) => Result.Result<unknown, unknown>, string][] = [
    ['-f', parseFormatResult, 'bvwa*+/,()[]<>=!?^$~ h1_.-'],
    ['-o', parseTemplate, '%()sdj>|.0-5 abcS'],
    ['--cookies-from-browser', v => parseCookieSource(v, { browser: ['firefox'], keyring: ['KWALLET'] }), 'firefox+:KWALLET :: x'],
  ];
  for (const [name, parse, alpha] of cases) {
    for (let k = 0; k < 3000; k++) {
      const v = junk(alpha);
      const r = parse(v);
      if (Result.isFailure(r)) assert.ok(r.failure instanceof GrammarError, `${name} ${JSON.stringify(v)} → ${r.failure}`);
    }
  }
});

// This one used to be "-f 값을 읽지 못했다 — Maximum call stack size exceeded".
test('괄호가 너무 깊으면 스택 대신 문법 오류로 말한다', async () => {
  const { lintCommand } = await import('../../src/index.js');
  const deep = '('.repeat(20000) + 'b' + ')'.repeat(20000);
  const msg = lintCommand(`yt-dlp -f "${deep}" https://x/y`).issues.map(i => i.msg).join(' | ');
  assert.match(msg, /괄호가 64겹보다 깊다/);
  assert.doesNotThrow(() => parseFormat('('.repeat(64) + 'b' + ')'.repeat(64)));
});
