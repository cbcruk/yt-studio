/**
 * 그래프 종류 서술자.
 *
 * 두 그래프가 정말로 다른 대수인지, 그 차이가 표 하나에 다 들어 있는지 고정한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { initSchema } from '../../src/core/schema.js';
import { blankPipeline } from '../../src/core/pipeline.js';
import { blankFormat, treeToGraph, FOUT } from '../../src/core/format-graph.js';
import { blankOutput, outputToGraph } from '../../src/core/output-graph.js';
import { blankPaths, pathsToGraph } from '../../src/core/paths-graph.js';
import { parseFormat } from '../../src/core/format-grammar.js';

initSchema(JSON.parse(await readFile(new URL('../../schema.json', import.meta.url), 'utf8')));
const { graphKind, allGraphKinds, subgraphFor, defineGraphBehavior } =
  await import('../../src/ui/graph-kinds.js');

let seq = 0;
const nid = () => 'k' + (++seq);
const fullState = () => Object.assign(blankPipeline(),
  { format: blankFormat(), output: blankOutput(), paths: blankPaths() });

test('두 종류가 등록돼 있고 서술자가 빠짐없다', () => {
  assert.deepEqual(allGraphKinds().map(k => k.id).sort(),
    ['format', 'output', 'paths', 'pipeline']);
  const required = ['graphOf', 'viewOf', 'live', 'order', 'exclusiveIn', 'wireOrdinals',
                    'search', 'canAutowire', 'chrome', 'palette', 'isEmpty', 'emptyHint',
                    'statusNotes', 'holderOf'];
  for (const k of allGraphKinds())
    for (const f of required)
      assert.ok(k[f] !== undefined, `${k.id} 에 ${f} 가 없다`);
});

test('graphOf / viewOf 가 상태에서 자기 몫을 꺼낸다', () => {
  const s = fullState();
  assert.equal(graphKind('pipeline').graphOf(s), s);
  assert.equal(graphKind('format').graphOf(s), s.format);
  assert.equal(graphKind('output').graphOf(s), s.output);
  assert.equal(graphKind('paths').graphOf(s), s.paths);
  assert.equal(graphKind('pipeline').viewOf(s), s.view);
  assert.equal(graphKind('format').viewOf(s), s.format.view);
  assert.equal(graphKind('output').viewOf(s), s.output.view);
});

test('서브그래프는 문자열 ↔ 그래프 계약을 갖는다', () => {
  for (const id of ['format', 'output', 'paths']) {
    const k = graphKind(id);
    for (const f of ['compile', 'fromString', 'blank', 'adopt', 'opensFrom'])
      assert.ok(k[f], `${id} 에 ${f} 가 없다`);
  }
  // 파이프라인은 자기가 원본이라 되돌릴 문자열이 없다
  assert.equal(graphKind('pipeline').opensFrom, undefined);

  // 계약이 실제로 왕복하는가
  const s = fullState();
  graphKind('output').adopt(s, graphKind('output').fromString('%(title)s.%(ext)s', { nid }));
  assert.equal(graphKind('output').compile(s), '%(title)s.%(ext)s');
  graphKind('format').adopt(s, graphKind('format').fromString('bv+ba', { nid }));
  assert.equal(graphKind('format').compile(s), 'bv+ba');
  graphKind('paths').adopt(s, graphKind('paths').fromString('home:/dl\ntemp:/tmp', { nid }));
  assert.equal(graphKind('paths').compile(s), 'home:/dl\ntemp:/tmp');
});

test('세 서브그래프의 순서 규칙이 서로 다르다', () => {
  // 경로는 집합이라 순서에 뜻이 없지만 세로로 안정된 순서를 준다
  const pg = pathsToGraph('home:/a\ntemp:/b', { nid });
  const pys = graphKind('paths').order(pg).map(i => pg.nodes[i].y);
  assert.deepEqual(pys, [...pys].sort((a, b) => a - b), '세로 순서가 아니다');
});

test('출력 템플릿은 가로 순서, 포맷은 세로 순서', () => {
  assert.equal(graphKind('format').operandsOf.length >= 1, true);
  const og = outputToGraph('%(title)s.%(ext)s', { nid });
  const ids = graphKind('output').order(og);
  const xs = ids.map(i => og.nodes[i].x);
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b), '가로 순서가 아니다');
});

test('"살아 있다"의 정의가 종류마다 다르다', () => {
  const s = fullState();
  // 파이프라인: src → out 으로 이어져야 산다
  assert.ok(graphKind('pipeline').live(s).has('src'));
  s.edges = [];
  assert.equal(graphKind('pipeline').live(s).size, 0, '끊겼는데 살아 있다');

  // 포맷: fout 에 닿아야 산다
  const f = treeToGraph(parseFormat('bv+ba'), { nid });
  assert.ok(graphKind('format').live(f).has(FOUT));
  f.edges = f.edges.filter(e => e.to !== FOUT);
  assert.deepEqual([...graphKind('format').live(f)], [FOUT]);
});

test('exclusiveIn 은 포맷의 -f 출력에만 있다', () => {
  assert.deepEqual(graphKind('pipeline').exclusiveIn, []);
  assert.deepEqual(graphKind('format').exclusiveIn, [FOUT]);
});

test('표현식 그래프만 와이어에 순서를 매긴다', () => {
  assert.equal(graphKind('pipeline').wireOrdinals, false);
  assert.equal(graphKind('format').wireOrdinals, true);
  assert.equal(typeof graphKind('format').operandsOf, 'function');
});

test('검색과 전부-잇기는 파이프라인에서만 말이 된다', () => {
  assert.equal(graphKind('pipeline').search, true);
  assert.equal(graphKind('pipeline').canAutowire, true);
  assert.equal(graphKind('format').search, false);
  assert.equal(graphKind('format').canAutowire, false);
});

test('서브그래프만 상위를 가진다 — Esc 로 빠져나갈 곳', () => {
  assert.equal(graphKind('pipeline').parent, null);
  assert.equal(graphKind('format').parent, 'pipeline');
});

test('빈 캔버스 판정', () => {
  const s = fullState();
  assert.equal(graphKind('pipeline').isEmpty(s), true, '단계가 없으면 비었다');
  s.nodes.x = { id: 'x', type: 'stage', stage: 'format', x: 0, y: 0 };
  assert.equal(graphKind('pipeline').isEmpty(s), false);

  assert.equal(graphKind('format').isEmpty(blankFormat()), true);
  assert.equal(graphKind('format').isEmpty(treeToGraph(parseFormat('bv'), { nid })), false);
});

test('하단 노트: 파이프라인은 우회를, 포맷은 문제를 보고한다', () => {
  const s = fullState();
  s.nodes.f = { id: 'f', type: 'stage', stage: 'format', x: 100, y: 0, values: {} };
  // 이어 붙이지 않았으므로 우회 상태
  let notes = graphKind('pipeline').statusNotes(s, { tokens: [], unknown: [] });
  assert.ok(notes.some(x => x.label === '우회 중'), JSON.stringify(notes));

  const f = treeToGraph(parseFormat('bv+ba'), { nid });
  notes = graphKind('format').statusNotes(f, { tokens: [], unknown: [] });
  assert.ok(!notes.some(x => x.label === '서브그래프'), '멀쩡한데 문제라고 한다');
  f.edges = f.edges.filter(e => e.to !== FOUT);
  notes = graphKind('format').statusNotes(f, { tokens: [], unknown: [] });
  assert.ok(notes.some(x => x.label === '서브그래프'), '끊겼는데 조용하다');
});

test('노트 본문에는 HTML 이 들어 있지 않다 — 렌더가 이스케이프한다', () => {
  const s = fullState();
  s.nodes.f = { id: 'f', type: 'stage', stage: 'format', x: 0, y: 0, values: {} };
  for (const k of allGraphKinds()) {
    for (const n of k.statusNotes(k.graphOf(s), { tokens: [], unknown: [] })) {
      assert.ok(!/[<>]/.test(n.body), `${k.id}: 본문에 태그가 있다 — ${n.body}`);
      if (n.label) assert.ok(!/[<>]/.test(n.label), `${k.id}: 라벨에 태그가 있다`);
    }
  }
});

test('명령어 토큰은 파이프라인 노드에만 매인다', () => {
  const s = fullState();
  s.nodes.f = { id: 'f', type: 'stage', stage: 'format', x: 0, y: 0, values: {} };
  assert.equal(graphKind('pipeline').holderOf(s, 'format').id, 'f');
  assert.equal(graphKind('format').holderOf(s, 'format'), null);
});

test('--format 행에서 포맷 서브그래프가 열린다', () => {
  const sub = subgraphFor('format');
  assert.ok(sub, '--format 에 문이 없다');
  assert.equal(sub.id, 'format');
  assert.ok(sub.opensFrom.label);
  assert.equal(subgraphFor('output').id, 'output', '--output 에 문이 없다');
  assert.equal(subgraphFor('paths').id, 'paths', '--paths 에 문이 없다');
  assert.equal(subgraphFor('proxy'), null, '아무 옵션에나 문이 달렸다');
});

test('defineGraphBehavior 로 DOM 쪽 동작을 얹을 수 있다', () => {
  let called = 0;
  defineGraphBehavior('pipeline', { sync: () => { called++; } });
  graphKind('pipeline').sync();
  assert.equal(called, 1);
});
