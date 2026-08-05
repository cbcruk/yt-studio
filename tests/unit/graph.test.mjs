/**
 * 그래프 원시 연산 · 표현식 그래프 · 레이아웃 · 저장.
 * 전부 DOM 없이 돈다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  adjacency, reach, connect, disconnect, removeNode, createsCycle, topoOrder, hasEdge,
} from '../../src/core/graph.js';
import {
  blankFormat, treeToGraph, graphToTree, formatExpr, formatIssues, operands, formatLive, FOUT,
} from '../../src/core/format-graph.js';
import { parseFormat } from '../../src/core/format-grammar.js';
import { tidyColumns, bounds, fitTo, zoomAt, freeSpot } from '../../src/core/layout.js';
import { snapshot, restore } from '../../src/core/persist.js';
import { blankOutput, OOUT } from '../../src/core/output-graph.js';
import { blankPaths, POUT } from '../../src/core/paths-graph.js';

/** a→b→c 사슬. */
const chain = () => ({
  nodes: { a: { id: 'a', x: 0, y: 0 }, b: { id: 'b', x: 100, y: 0 }, c: { id: 'c', x: 200, y: 0 } },
  edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
});

let n = 0;
const nid = () => 'n' + (++n);

/* ── graph.js ────────────────────────────── */
test('도달성은 방향을 따른다', () => {
  const g = chain();
  const { out, inn } = adjacency(g);
  assert.deepEqual([...reach('a', out)].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...reach('c', out)].sort(), ['c']);
  assert.deepEqual([...reach('c', inn)].sort(), ['a', 'b', 'c']);
});

test('순환은 잇기 전에 막는다', () => {
  const g = chain();
  assert.equal(createsCycle(g, 'a', 'c'), false);
  assert.equal(createsCycle(g, 'c', 'a'), true);
  assert.equal(connect(g, 'c', 'a'), false, '순환이 허용됐다');
  assert.equal(g.edges.length, 2);
});

test('자기 자신 · 중복 · 없는 노드는 잇지 않는다', () => {
  const g = chain();
  assert.equal(connect(g, 'a', 'a'), false);
  assert.equal(connect(g, 'a', 'b'), false, '중복이 허용됐다');
  assert.equal(connect(g, 'a', 'zzz'), false);
  assert.equal(g.edges.length, 2);
});

test('exclusiveIn 은 입력을 하나만 남긴다', () => {
  const g = chain();
  g.nodes.d = { id: 'd', x: 50, y: 50 };
  const ex = new Set(['c']);
  assert.equal(connect(g, 'd', 'c', { exclusiveIn: ex }), true);
  assert.deepEqual(g.edges.filter(e => e.to === 'c').map(e => e.from), ['d']);
});

test('노드를 지우면 앞뒤가 다시 이어진다', () => {
  const g = chain();
  assert.equal(removeNode(g, 'b'), true);
  assert.ok(hasEdge(g, 'a', 'c'), 'a→c 로 다시 이어지지 않았다');
  assert.equal(g.nodes.b, undefined);
});

test('보호된 노드는 지워지지 않는다', () => {
  const g = chain();
  assert.equal(removeNode(g, 'a', { protectedIds: new Set(['a']) }), false);
  assert.ok(g.nodes.a);
});

test('disconnect 는 그 엣지만 끊는다', () => {
  const g = chain();
  assert.equal(disconnect(g, 'a', 'b'), true);
  assert.equal(disconnect(g, 'a', 'b'), false, '없는 엣지를 끊었다고 한다');
  assert.equal(g.edges.length, 1);
});

test('위상 정렬은 같은 층에서 cmp 로 갈린다', () => {
  const g = {
    nodes: { r: { id: 'r', x: 0 }, p: { id: 'p', x: 30 }, q: { id: 'q', x: 10 } },
    edges: [{ from: 'r', to: 'p' }, { from: 'r', to: 'q' }],
  };
  const byX = (a, b) => g.nodes[a].x - g.nodes[b].x;
  assert.deepEqual(topoOrder(['r', 'p', 'q'], g, byX), ['r', 'q', 'p']);
});

/* ── format-graph.js ─────────────────────── */
test('문자열 → 그래프 → 문자열 왕복', () => {
  for (const s of ['bv+ba', 'bv*[height<=720]+ba/b', 'bv[ext=mp4]+ba/wv+wa/b', 'best']) {
    const g = treeToGraph(parseFormat(s), { nid });
    assert.equal(formatExpr(g), s, s);
  }
});

test('그룹에 붙은 필터도 그래프를 왕복한다', () => {
  for (const s of [
    '(mp4,webm)[height<480]',
    '(bv+ba)[height<=720]',
    '(bv[height<=1080]+ba)[filesize<500M]',
    '(mp4,webm)[height<480]+ba',
  ]) {
    const g = treeToGraph(parseFormat(s), { nid });
    assert.equal(formatExpr(g), s, s);
  }
});

test('필터는 연산자 노드가 들고 있다', () => {
  const g = treeToGraph(parseFormat('(bv+ba)[height<=720]'), { nid });
  const merge = Object.values(g.nodes).find(n => n.type === 'merge');
  assert.deepEqual(merge.filters, [{ key: 'height', op: '<=', loose: false, value: '720' }]);
  // 필터를 빼면 괄호도 같이 사라진다
  merge.filters = [];
  assert.equal(formatExpr(g), 'bv+ba');
});

test('통과되는 연산자의 필터는 피연산자로 흘러내린다', () => {
  const g = treeToGraph(parseFormat('bv+ba'), { nid });
  const merge = Object.values(g.nodes).find(n => n.type === 'merge');
  // ba 를 떼면 입력이 하나 — 연산자는 통과되지만 필터는 남아야 한다
  const ba = Object.values(g.nodes).find(n => n.sel === 'ba');
  g.edges = g.edges.filter(e => e.from !== ba.id);
  merge.filters = [{ key: 'height', op: '<=', value: '720' }];
  assert.equal(formatExpr(g), 'bv[height<=720]');
});

test('키가 빈 필터는 아직 고르는 중이라 표현식에 안 들어간다', () => {
  const g = treeToGraph(parseFormat('bv+ba'), { nid });
  const merge = Object.values(g.nodes).find(n => n.type === 'merge');
  merge.filters = [{ key: '', op: '<=', value: '720' }];
  assert.equal(formatExpr(g), 'bv+ba');
});

test('빈 그래프는 빈 표현식', () => {
  assert.equal(formatExpr(blankFormat()), '');
  assert.equal(graphToTree(blankFormat()), null);
});

test('-f 출력에서 끊기면 표현식에 안 들어간다', () => {
  const g = treeToGraph(parseFormat('bv+ba'), { nid });
  g.edges = g.edges.filter(e => e.to !== FOUT);
  assert.equal(formatExpr(g), '');
  assert.ok(formatIssues(g).some(m => m.includes('이어지지')));
});

test('피연산자 순서는 세로 위치를 따른다', () => {
  const g = treeToGraph(parseFormat('bv+ba/b'), { nid });
  assert.equal(formatExpr(g), 'bv+ba/b');
  // b 스트림을 맨 위로 올리면 폴백 순서가 뒤집힌다
  const b = Object.values(g.nodes).find(x => x.sel === 'b');
  b.y = Math.min(...Object.values(g.nodes).map(x => x.y)) - 500;
  assert.equal(formatExpr(g), 'b/bv+ba');
});

test('피연산자가 하나뿐인 연산자는 통과되고, 그렇다고 알려 준다', () => {
  const g = treeToGraph(parseFormat('bv+ba'), { nid });
  const ba = Object.values(g.nodes).find(x => x.sel === 'ba');
  g.edges = g.edges.filter(e => e.from !== ba.id);
  assert.equal(formatExpr(g), 'bv');
  assert.ok(formatIssues(g).some(m => m.includes('그냥 통과')));
});

test('셀렉터가 빈 스트림은 표현식에서 빠지고 보고된다', () => {
  const g = treeToGraph(parseFormat('bv+ba'), { nid });
  Object.values(g.nodes).find(x => x.sel === 'bv').sel = '';
  assert.ok(formatIssues(g).some(m => m.includes('셀렉터가 비어')));
});

test('operands 는 세로 · 가로 순', () => {
  const g = blankFormat();
  g.nodes.p = { id: 'p', type: 'stream', sel: 'a', x: 0, y: 100 };
  g.nodes.q = { id: 'q', type: 'stream', sel: 'b', x: 0, y: 0 };
  g.edges.push({ from: 'p', to: FOUT }, { from: 'q', to: FOUT });
  assert.deepEqual(operands(g, FOUT).map(x => x.id), ['q', 'p']);
});

test('treeToGraph 의 열 간격은 노드 폭보다 넓다', () => {
  const g = treeToGraph(parseFormat('bv+ba/b'), { nid, nodeW: 300 });
  const xs = [...new Set(Object.values(g.nodes).map(x => x.x))].sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) {
    assert.ok(xs[i] - xs[i - 1] >= 300, `열 간격 ${xs[i] - xs[i - 1]} 가 노드 폭보다 좁다`);
  }
});

test('fout 에 닿는 노드만 live', () => {
  const g = treeToGraph(parseFormat('bv+ba'), { nid });
  g.nodes.loose = { id: 'loose', type: 'stream', sel: 'wv', x: -400, y: 0 };
  assert.ok(!formatLive(g).has('loose'));
});

/* ── layout.js ───────────────────────────── */
test('tidyColumns 는 같은 열에서 노드를 겹치지 않게 민다', () => {
  const g = {
    nodes: {
      a: { id: 'a', x: 0, y: 0 },
      b: { id: 'b', x: 0, y: 10 },      // 겹친다
      c: { id: 'c', x: 400, y: 0 },
    },
    edges: [],
  };
  tidyColumns(g, () => 200, { gap: 20 });
  assert.ok(g.nodes.b.y >= 220, `b.y = ${g.nodes.b.y}`);
  assert.equal(g.nodes.c.y, 0, '다른 열은 건드리지 않는다');
});

test('bounds 는 실측 높이를 쓴다', () => {
  const g = { nodes: { a: { id: 'a', x: 0, y: 0 } }, edges: [] };
  const box = bounds(g, () => 500, { widthOf: () => 300, pad: 0 });
  assert.deepEqual(box, { minX: 0, maxX: 300, minY: 0, maxY: 500 });
});

test('fitTo 는 배율을 [min,max] 로 자른다', () => {
  const wide = fitTo({ minX: 0, maxX: 10000, minY: 0, maxY: 100 }, 1000, 800);
  assert.equal(wide.k, 0.3, '축소 하한을 넘었다');
  const tiny = fitTo({ minX: 0, maxX: 10, minY: 0, maxY: 10 }, 1000, 800);
  assert.equal(tiny.k, 1.1, '확대 상한을 넘었다');
});

test('zoomAt 은 커서 아래 세계 좌표를 고정한다', () => {
  const view = { x: 0, y: 0, k: 1 };
  const mx = 400, my = 300;
  const before = { x: (mx - view.x) / view.k, y: (my - view.y) / view.k };
  const next = zoomAt(view, mx, my, 1.5);
  const after = { x: (mx - next.x) / next.k, y: (my - next.y) / next.k };
  assert.ok(Math.abs(before.x - after.x) < 1e-9);
  assert.ok(Math.abs(before.y - after.y) < 1e-9);
});

test('freeSpot 은 겹치는 자리를 피한다', () => {
  const g = { nodes: { a: { id: 'a', x: 0, y: 0 } }, edges: [] };
  const [x, y] = freeSpot(g, 0, 0);
  assert.ok(Math.abs(x) >= 40 || Math.abs(y) >= 40, `여전히 겹친다 (${x}, ${y})`);
});

/* ── persist.js ──────────────────────────── */
const SUBS = { subgraphs: [
  { key: 'format', root: FOUT, blank: blankFormat },
  { key: 'output', root: OOUT, blank: blankOutput },
  { key: 'paths',  root: POUT, blank: blankPaths },
] };

const stateFixture = () => ({
  nodes: { src: { id: 'src', type: 'source', urls: 'https://a' }, out: { id: 'out', type: 'sink' } },
  edges: [{ from: 'src', to: 'out' }],
  view: { x: 1, y: 2, k: 0.5 },
  format: blankFormat(),
  output: blankOutput(),
  paths: blankPaths(),
});

test('스냅샷 왕복', () => {
  const s = stateFixture();
  const r = restore(snapshot(s, 7, 'format'), SUBS);
  assert.equal(r.seq, 7);
  assert.equal(r.mode, 'format');
  assert.equal(r.state.nodes.src.urls, 'https://a');
  assert.deepEqual(r.state.view, { x: 1, y: 2, k: 0.5 });
});

test('내부 전용 플래그는 저장물로 새지 않는다', () => {
  const s = stateFixture();
  s.format._tidy = true;
  const snap = snapshot(s, 1, 'pipeline');
  assert.equal(snap.state.format._tidy, undefined);
  assert.equal(JSON.stringify(snap).includes('_tidy'), false);
});

test('v2 스냅샷(포맷 서브그래프 이전)도 읽는다', () => {
  const v2 = {
    v: 2, seq: 3, view: { x: 0, y: 0, k: 1 },
    nodes: { src: { id: 'src', type: 'source' }, out: { id: 'out', type: 'sink' } },
    edges: [{ from: 'src', to: 'out' }],
  };
  const r = restore(v2, SUBS);
  assert.ok(r, 'v2 를 못 읽었다');
  assert.equal(r.mode, 'pipeline');
  assert.ok(r.state.format.nodes.fout, '빈 서브그래프가 채워지지 않았다');
});

test('망가진 스냅샷은 null', () => {
  assert.equal(restore(null, SUBS), null);
  assert.equal(restore({}, SUBS), null);
  assert.equal(restore({ state: { nodes: {} } }, SUBS), null);
});

test('없는 노드를 가리키는 엣지는 복원할 때 걷어낸다', () => {
  const s = stateFixture();
  s.edges.push({ from: 'src', to: 'ghost' });
  const r = restore(snapshot(s, 1, 'pipeline'), SUBS);
  assert.equal(r.state.edges.length, 1);
});

test('모르는 단계의 노드는 버린다 — 스키마가 바뀌어도 안 깨진다', () => {
  const s = stateFixture();
  s.nodes.old = { id: 'old', type: 'stage', stage: 'ghost-stage' };
  const r = restore(snapshot(s, 1, 'pipeline'), {
    ...SUBS, isValidStage: x => x !== 'ghost-stage',
  });
  assert.equal(r.state.nodes.old, undefined);
});

/* ── ui/node-kinds.js ────────────────────── */
test('노드 레지스트리가 모든 종류를 안다', async () => {
  const { initSchema } = await import('../../src/core/schema.js');
  const raw = JSON.parse(
    await (await import('node:fs/promises')).readFile(
      new URL('../../schema.json', import.meta.url), 'utf8'));
  initSchema(raw);
  const K = await import('../../src/ui/node-kinds.js');

  for (const type of ['source', 'sink', 'stage', 'stream', 'merge', 'fallback', 'multi', 'fout',
                      'text', 'field', 'oout', 'path', 'pout']) {
    assert.ok(K.kindByType(type), `${type} 이 등록되지 않았다`);
  }

  // 끝점은 지울 수 없다
  assert.deepEqual([...K.protectedIds()].sort(), ['fout', 'oout', 'out', 'pout', 'src']);

  // 포트는 그래프의 끝을 막는다
  assert.equal(K.hasIn({ type: 'source' }), false, '소스에 입력이 있다');
  assert.equal(K.hasOut({ type: 'sink' }), false, '명령어에 출력이 있다');
  assert.equal(K.hasIn({ type: 'stream' }), false, '스트림에 입력이 있다');
  assert.equal(K.hasOut({ type: 'fout' }), false, '-f 출력에 출력이 있다');
  assert.equal(K.hasIn({ type: 'text' }), false, '글자 조각에 입력이 있다');
  assert.equal(K.hasIn({ type: 'field' }), false, '필드 조각에 입력이 있다');
  assert.equal(K.hasOut({ type: 'oout' }), false, '-o 출력에 출력이 있다');
  assert.equal(K.hasIn({ type: 'path' }), false, '경로 항목에 입력이 있다');
  assert.equal(K.hasOut({ type: 'pout' }), false, '-P 출력에 출력이 있다');

  // 단계 노드는 자기 stage 에서 표기·색을 끌어온다
  const n = { type: 'stage', stage: 'format' };
  assert.equal(K.tagOf(n), 'format');
  assert.equal(K.labelOf(n), '포맷');
  assert.equal(K.accentOf(n), K.STAGE_ACCENT.format);
  assert.equal(K.bypassLabelOf(n), '우회');
  assert.equal(K.bypassLabelOf({ type: 'stream' }), '끊김');

  // 배지
  assert.equal(K.badgeOf({ type: 'stage', values: { a: 1, b: '', c: 3 } }), 2);
  assert.equal(K.badgeOf({ type: 'stream', filters: [1, 2] }), 2);
  assert.equal(K.badgeOf({ type: 'fout' }), 0);
});

test('팔레트 항목이 레지스트리에서 나온다', async () => {
  const { initSchema, STAGES } = await import('../../src/core/schema.js');
  const raw = JSON.parse(
    await (await import('node:fs/promises')).readFile(
      new URL('../../schema.json', import.meta.url), 'utf8'));
  initSchema(raw);
  const K = await import('../../src/ui/node-kinds.js');

  const pipe = K.paletteItems('pipeline', STAGES);
  assert.equal(pipe.length, 9, '단계 9개가 안 나온다');
  assert.ok(pipe.every(i => i.accent && i.label && i.tag));

  const fmt = K.paletteItems('format');
  assert.deepEqual(fmt.map(i => i.key), ['stream', 'merge', 'fallback', 'multi']);
  const out = K.paletteItems('output');
  assert.deepEqual(out.map(i => i.key), ['text', 'field']);
  // 끝점은 팔레트에 안 나온다 — 캔버스에 이미 하나씩 있다
  assert.ok(!fmt.some(i => i.key === 'fout'));
  assert.ok(!out.some(i => i.key === 'oout'));
  assert.deepEqual(K.paletteItems('paths').map(i => i.key), ['path']);
});
