/**
 * 출력 템플릿 문법과 그 서브그래프.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTemplate, emitTemplate, emitOutput, splitType, splitBody, joinBody, previewTemplate,
} from '../../src/core/output-template.js';
import {
  blankOutput, outputToGraph, outputExpr, outputPieces, outputIssues,
  outputLive, outputPreview, pieceNodes, OOUT,
} from '../../src/core/output-graph.js';

let seq = 0;
const nid = () => 'o' + (++seq);
const round = s => emitTemplate(parseTemplate(s));

test('실제로 쓰이는 템플릿이 글자 그대로 왕복한다', () => {
  const cases = [
    '%(title)s.%(ext)s',
    '%(uploader)s/%(title)s.%(ext)s',
    '%(playlist_index)03d - %(title)s.%(ext)s',
    '%(upload_date>%Y-%m-%d)s %(title)s.%(ext)s',
    '%(uploader|Unknown)s/%(title).40s.%(ext)s',
    '%(playlist_title|단일)s/%(playlist_index|0)03d.%(title)s.%(ext)s',
    '[%(id)s] %(title)s.%(ext)s',
    '%(chapter_number)02d %(chapter)s.%(ext)s',
    '%(title)s (%(resolution)s).%(ext)s',
    '%(filesize)B %(title)s.%(ext)s',
    '%(tags)l.%(ext)s',
  ];
  for (const s of cases) assert.equal(round(s), s, s);
});

test('%% 는 리터럴 % 로 풀렸다가 그대로 되돌아온다', () => {
  assert.equal(round('100%% %(title)s.%(ext)s'), '100%% %(title)s.%(ext)s');
  const [first] = parseTemplate('100%% done');
  assert.equal(first.text, '100% done', '파싱 결과에서는 % 하나여야 한다');
});

test('우리가 모르는 문법이 섞여도 문자열이 상하지 않는다', () => {
  // 객체 순회 · 산술 · 대안 — UI 로는 안 다루지만 원문은 지킨다
  for (const s of [
    '%(tags.0)s.%(ext)s',
    '%(n_entries+1-playlist_index)d.%(ext)s',
    '%(release_date,upload_date>%Y-%m-%d)s.%(ext)s',
    '%(subtitles.en.-1.ext)s',
    '%(chapters&있음|없음)s.%(ext)s',
  ]) assert.equal(round(s), s, s);
});

test('본문을 자르고 같은 순서로 붙이면 원문이다 — 어떤 조합이든', () => {
  for (const body of ['title', 'a>b', 'a|b', 'a>b|c', 'a|b>c', 'a', 'x|', '|y']) {
    assert.equal(joinBody(splitBody(body)), body, body);
  }
});

test('망가진 템플릿은 이유를 담아 거부한다', () => {
  for (const s of ['%(title', '%(title)', '%()s', '%x', '100% done']) {
    assert.throws(() => parseTemplate(s), Error, `통과해버림: ${s}`);
  }
});

test('아는 TYPES 접두어만 잘라 낸다 — 윈도 경로를 오인하지 않는다', () => {
  assert.deepEqual(splitType('chapter:%(title)s'), { type: 'chapter', template: '%(title)s' });
  assert.deepEqual(splitType('thumbnail:t/%(id)s'), { type: 'thumbnail', template: 't/%(id)s' });
  assert.deepEqual(splitType('C:/dl/%(title)s.%(ext)s'),
    { type: '', template: 'C:/dl/%(title)s.%(ext)s' });
  assert.deepEqual(splitType('%(title)s.%(ext)s'), { type: '', template: '%(title)s.%(ext)s' });
});

test('emitOutput 이 TYPES 를 다시 붙인다', () => {
  assert.equal(emitOutput('', parseTemplate('%(title)s')), '%(title)s');
  assert.equal(emitOutput('chapter', parseTemplate('%(title)s')), 'chapter:%(title)s');
});

test('미리보기는 필드를 사람 말로 바꿔 보여 준다', () => {
  const pv = previewTemplate(parseTemplate('%(uploader)s/%(title)s.%(ext)s'));
  assert.equal(pv, '‹업로더›/‹제목›.‹확장자›');
});

/* ── 그래프 ──────────────────────────────── */
test('문자열 → 그래프 → 문자열 왕복', () => {
  for (const s of [
    '%(title)s.%(ext)s',
    'chapter:%(chapter_number)02d %(chapter)s.%(ext)s',
    '%(uploader|Unknown)s/%(upload_date>%Y-%m-%d)s %(title)s.%(ext)s',
  ]) {
    const g = outputToGraph(s, { nid });
    assert.equal(outputExpr(g), s, s);
  }
});

test('빈 그래프는 빈 값', () => {
  const g = blankOutput();
  assert.equal(outputExpr(g), '');
  assert.deepEqual(outputPieces(g), []);
});

test('순서는 가로 위치를 따른다', () => {
  const g = outputToGraph('%(title)s.%(ext)s', { nid });
  assert.equal(outputExpr(g), '%(title)s.%(ext)s');
  // 확장자 필드를 맨 왼쪽으로 끌면 파일명 앞으로 온다
  const ext = Object.values(g.nodes).find(n => n.name === 'ext');
  ext.x = Math.min(...Object.values(g.nodes).map(n => n.x)) - 500;
  assert.equal(outputExpr(g), '%(ext)s%(title)s.');
});

test('-o 출력에서 끊긴 조각은 빠지고 보고된다', () => {
  const g = outputToGraph('%(title)s.%(ext)s', { nid });
  const ext = Object.values(g.nodes).find(n => n.name === 'ext');
  g.edges = g.edges.filter(e => e.from !== ext.id);
  assert.equal(outputExpr(g), '%(title)s.');
  assert.ok(!outputLive(g).has(ext.id));
  assert.ok(outputIssues(g).some(m => m.includes('이어지지')));
});

test('확장자가 없으면 알려 준다 — 흔한 실수다', () => {
  const withExt = outputToGraph('%(title)s.%(ext)s', { nid });
  assert.ok(!outputIssues(withExt).some(m => m.includes('확장자')));
  const without = outputToGraph('%(title)s', { nid });
  assert.ok(outputIssues(without).some(m => m.includes('확장자')));
  // 비어 있을 때는 잔소리하지 않는다
  assert.ok(!outputIssues(blankOutput()).some(m => m.includes('확장자')));
});

test('빈 필드 이름과 빈 글자 조각을 보고한다', () => {
  const g = outputToGraph('%(title)s.%(ext)s', { nid });
  Object.values(g.nodes).find(n => n.name === 'title').name = '';
  assert.ok(outputIssues(g).some(m => m.includes('이름이 비어')));
  Object.values(g.nodes).find(n => n.type === 'text').text = '';
  assert.ok(outputIssues(g).some(m => m.includes('빈 글자 조각')));
});

test('조각 노드의 열 간격은 노드 폭보다 넓다', () => {
  const g = outputToGraph('%(uploader)s/%(title)s.%(ext)s', { nid, widthOf: () => 300 });
  const xs = [...new Set(Object.values(g.nodes).map(n => n.x))].sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++)
    assert.ok(xs[i] - xs[i - 1] >= 300, `열 간격 ${xs[i] - xs[i - 1]}`);
});

test('TYPES 는 출력 노드가 들고 있다', () => {
  const g = outputToGraph('chapter:%(title)s.%(ext)s', { nid });
  assert.equal(g.nodes[OOUT].outType, 'chapter');
  g.nodes[OOUT].outType = 'subtitle';
  assert.equal(outputExpr(g), 'subtitle:%(title)s.%(ext)s');
});

test('미리보기가 그래프에서도 나온다', () => {
  const g = outputToGraph('%(uploader)s/%(title)s.%(ext)s', { nid });
  assert.equal(outputPreview(g), '‹업로더›/‹제목›.‹확장자›');
});
