/**
 * --paths 서브그래프. 값 안에 템플릿이 없고, 여러 줄이 곧 여러 개의 -P 다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitEntry, joinEntry, blankPaths, pathsToGraph, pathsExpr, pathsPreview,
  pathsIssues, pathsLive, entryNodes, PATH_TYPES, POUT,
} from '../../src/core/paths-graph.js';

let seq = 0;
const nid = () => 'p' + (++seq);
const round = s => pathsExpr(pathsToGraph(s, { nid }));

test('여러 줄이 글자 그대로 왕복한다', () => {
  const cases = [
    'home:/dl',
    '/dl',
    'home:/dl\ntemp:/tmp/yt',
    'home:/dl\nsubtitle:/dl/subs\nthumbnail:/dl/thumbs',
    'temp:/mnt/scratch',
  ];
  for (const s of cases) assert.equal(round(s), s, s);
});

test('아는 TYPES 만 잘라 낸다 — 윈도 경로를 오인하지 않는다', () => {
  assert.deepEqual(splitEntry('home:/dl'), { type: 'home', path: '/dl' });
  assert.deepEqual(splitEntry('temp:/tmp'), { type: 'temp', path: '/tmp' });
  assert.deepEqual(splitEntry('C:/dl/videos'), { type: '', path: 'C:/dl/videos' });
  assert.deepEqual(splitEntry('/plain/path'), { type: '', path: '/plain/path' });
  assert.equal(round('C:/dl/videos'), 'C:/dl/videos');
});

test('자르고 붙이면 원문이다', () => {
  for (const line of ['home:/a', '/a', 'C:/a', 'temp:', 'subtitle:/a/b'])
    assert.equal(joinEntry(splitEntry(line)), line, line);
});

test('home 과 temp 는 경로에만 있는 TYPES 다', () => {
  const keys = PATH_TYPES.map(([v]) => v);
  assert.ok(keys.includes('home') && keys.includes('temp'));
  assert.ok(keys.includes('subtitle'), '-o 의 TYPES 도 함께 쓴다');
  assert.ok(!keys.includes(''), '빈 항목이 섞였다');
});

test('빈 그래프는 빈 값', () => {
  assert.equal(pathsExpr(blankPaths()), '');
  assert.deepEqual(entryNodes(blankPaths()), []);
});

test('순서는 세로 위치를 따른다', () => {
  const g = pathsToGraph('home:/dl\ntemp:/tmp', { nid });
  assert.equal(pathsExpr(g), 'home:/dl\ntemp:/tmp');
  const tmp = Object.values(g.nodes).find(n => n.pathType === 'temp');
  tmp.y = Math.min(...Object.values(g.nodes).map(n => n.y)) - 300;
  assert.equal(pathsExpr(g), 'temp:/tmp\nhome:/dl');
});

test('-P 출력에서 끊긴 항목은 빠지고 보고된다', () => {
  const g = pathsToGraph('home:/dl\ntemp:/tmp', { nid });
  const tmp = Object.values(g.nodes).find(n => n.pathType === 'temp');
  g.edges = g.edges.filter(e => e.from !== tmp.id);
  assert.equal(pathsExpr(g), 'home:/dl');
  assert.ok(!pathsLive(g).has(tmp.id));
  assert.ok(pathsIssues(g).some(m => m.includes('이어지지')));
});

test('같은 TYPES 가 두 번이면 알려 준다 — 뒤엣것만 쓰인다', () => {
  const g = pathsToGraph('home:/a\nhome:/b', { nid });
  assert.ok(pathsIssues(g).some(m => m.includes('두 번')), JSON.stringify(pathsIssues(g)));
  const ok = pathsToGraph('home:/a\ntemp:/b', { nid });
  assert.ok(!pathsIssues(ok).some(m => m.includes('두 번')));
});

test('TYPES 를 안 쓴 항목은 home 으로 친다', () => {
  const g = pathsToGraph('/a\nhome:/b', { nid });
  assert.ok(pathsIssues(g).some(m => m.includes('두 번')), '기본이 home 인 걸 못 알아챘다');
});

test('빈 경로를 보고한다', () => {
  const g = pathsToGraph('home:/dl', { nid });
  Object.values(g.nodes).find(n => n.type === 'path').path = '';
  assert.ok(pathsIssues(g).some(m => m.includes('비어')));
});

test('미리보기는 home 경로와 나머지 개수를 보여 준다', () => {
  assert.equal(pathsPreview(pathsToGraph('home:/dl', { nid })), '/dl');
  assert.equal(pathsPreview(pathsToGraph('home:/dl\ntemp:/tmp', { nid })), '/dl 외 1개');
  assert.equal(pathsPreview(blankPaths()), '');
});

test('항목이 세로로 겹치지 않게 놓인다', () => {
  const g = pathsToGraph('home:/a\ntemp:/b\nsubtitle:/c', { nid });
  const ys = Object.values(g.nodes).filter(n => n.id !== POUT).map(n => n.y).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 120, `세로 간격 ${ys[i] - ys[i - 1]}`);
});
