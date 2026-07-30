/**
 * 캔버스 밖 화면.
 *
 * 팔레트 · 검색 결과 · 하단 명령어와 노트를 브라우저 없이 검사한다. 이게
 * 가능해진 건 innerHTML 문자열 조립을 걷어내고 템플릿으로 옮긴 뒤부터다.
 *
 * 가장 중요한 검사는 마지막 것이다 — 사용자 문자열이 정적 조각(strings)에
 * 섞여 들어가지 않는지. 값(values) 자리에만 있으면 lit 이 이스케이프한다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { initSchema, BY_ID } from '../../src/core/schema.js';
import { blankPipeline, buildTokens } from '../../src/core/pipeline.js';
import { blankFormat } from '../../src/core/format-graph.js';
import { blankOutput } from '../../src/core/output-graph.js';
import { blankPaths } from '../../src/core/paths-graph.js';

initSchema(JSON.parse(await readFile(new URL('../../schema.json', import.meta.url), 'utf8')));
const chrome = await import('../../src/ui/chrome.js');
const { installChrome, mark, paletteTemplate, hitsTemplate, cmdTemplate, notesTemplate } = chrome;

const state = Object.assign(blankPipeline(),
  { format: blankFormat(), output: blankOutput(), paths: blankPaths() });
const ui = { mode: 'pipeline', lit: null, unknown: [], fmtWarn: '' };
const host = {
  state: () => state,
  ui,
  render: () => {},
  addStage: () => ({ id: 'n1', values: {} }),
  centerSpot: () => [0, 0],
  focusNode: () => {},
};
installChrome(host);

/* ── 템플릿을 들여다보는 도구 ─────────────── */

/** 정적 조각만 이어 붙인다 — 개발자가 쓴 마크업. */
function statics(tpl, out = []) {
  if (Array.isArray(tpl)) { tpl.forEach(t => statics(t, out)); return out; }
  if (!tpl || !Array.isArray(tpl.strings)) return out;
  out.push(...tpl.strings);
  tpl.values.forEach(v => statics(v, out));
  return out;
}

/** 값 자리에 들어간 것만 모은다 — 데이터. lit 이 이스케이프해 주는 쪽. */
function values(tpl, out = []) {
  if (Array.isArray(tpl)) { tpl.forEach(t => values(t, out)); return out; }
  if (tpl && Array.isArray(tpl.strings)) { tpl.values.forEach(v => values(v, out)); return out; }
  if (typeof tpl === 'string' || typeof tpl === 'number') out.push(String(tpl));
  return out;
}

/** 둘을 원래 순서로 다시 엮는다 — 브라우저가 만들 마크업에 가까운 것.
 *  속성 인용부호나 이벤트 값은 빠지므로 '들어 있나' 확인용으로만 쓴다. */
function flat(tpl) {
  if (Array.isArray(tpl)) return tpl.map(flat).join('');
  if (tpl && Array.isArray(tpl.strings)) {
    return tpl.strings.map((str, i) => str + (i < tpl.values.length ? flat(tpl.values[i]) : '')).join('');
  }
  return typeof tpl === 'string' || typeof tpl === 'number' ? String(tpl) : '';
}

/* ── 팔레트 ──────────────────────────────── */
test('팔레트에 9개 단계가 레지스트리 순서대로 나온다', () => {
  const t = flat(paletteTemplate());
  for (const stage of ['run', 'connect', 'extract', 'select', 'format', 'download',
                       'process', 'store', 'report']) {
    assert.ok(t.includes(stage), '빠진 단계: ' + stage);
  }
});

test('이미 캔버스에 있는 단계는 placed 로 표시된다', () => {
  assert.ok(!flat(paletteTemplate()).includes('pal-item placed'));
  state.nodes.n9 = { id: 'n9', type: 'stage', stage: 'format', x: 0, y: 0, values: { format: 'bv' } };
  assert.ok(flat(paletteTemplate()).includes('pal-item placed'), 'placed 클래스가 안 붙었다');
  delete state.nodes.n9;
});

/* ── 검색 결과 강조 ──────────────────────── */
test('일치한 조각만 <mark> 로 감싼다', () => {
  const parts = mark('embed subtitles', ['sub']);
  assert.equal(values(parts).join(''), 'embed subtitles');   // 글자는 그대로
  assert.equal(flat(parts), 'embed <mark>sub</mark>titles');
});

test('일치가 없으면 문자열 그대로 (템플릿을 안 만든다)', () => {
  assert.equal(mark('embed subs', []), 'embed subs');
  assert.equal(mark('embed subs', ['zzz']), 'embed subs');
});

test('정규식 특수문자가 든 검색어도 글자로 취급한다', () => {
  // 예전 구현은 이스케이프한 HTML 에 정규식을 걸어서 엔티티 안쪽까지 맞았다.
  assert.equal(values(mark('a+b (c)', ['+'])).join(''), 'a+b (c)');
  assert.equal(values(mark('x & y', ['&'])).join(''), 'x & y');
  // 이스케이프한 HTML 에 정규식을 걸던 예전 구현은 &amp; 안쪽까지 맞았다.
  assert.ok(!flat(mark('x & y', ['amp'])).includes('<mark>'));
});

test('검색 결과에 플래그와 도움말과 단계가 함께 나온다', () => {
  const tpl = hitsTemplate([BY_ID['embed-subs']], ['embed']);
  // 강조 때문에 플래그가 조각으로 갈리므로 글자는 값 쪽에서 본다.
  const words = values(tpl).join('');
  assert.ok(words.includes('--embed-subs'), 'flag: ' + words);
  assert.ok(words.includes('mp4'), 'help: ' + words);
  assert.ok(words.includes('process'), 'stage: ' + words);
  const markup = flat(tpl);
  assert.ok(markup.includes('1개 일치'), 'head: ' + markup);
  assert.ok(markup.includes('<mark>embed</mark>'), '강조가 없다: ' + markup);
});

/* ── 하단 명령어 ─────────────────────────── */
test('토큰과 URL 이 순서대로 명령어가 된다', () => {
  state.nodes.src.urls = 'https://youtu.be/a';
  state.nodes.n8 = { id: 'n8', type: 'stage', stage: 'format', x: 0, y: 0,
                     values: { format: 'bv+ba' } };
  state.edges = [{ from: 'src', to: 'n8' }, { from: 'n8', to: 'out' }];
  const toks = buildTokens(state);
  const t = flat(cmdTemplate(toks, ['https://youtu.be/a']));
  assert.ok(t.includes('-f bv+ba'), '토큰: ' + t);
  assert.ok(t.indexOf('bv+ba') < t.indexOf('youtu.be'), 'URL 이 앞에 왔다: ' + t);
});

test('노트가 읽지 못한 토큰과 그래프 종류의 보고를 함께 싣는다', () => {
  ui.unknown = ['--bogus-flag'];
  const t = flat(notesTemplate(buildTokens(state)));
  assert.ok(t.includes('--bogus-flag'), '미지 토큰: ' + t);
  assert.ok(t.includes('플래그 순서는 그래프 순서를 따른다'), 'statusNotes: ' + t);
  ui.unknown = [];
});

/* ── 이게 이 분리의 값이다 ───────────────── */
test('사용자 문자열은 값 자리에만 들어간다 (이스케이프는 lit 이 한다)', () => {
  const evil = '<img src=x onerror=alert(1)>';
  ui.fmtWarn = evil;
  ui.unknown = [evil];
  state.nodes.n8.values.format = evil;

  for (const [name, tpl] of [
    ['notes', notesTemplate(buildTokens(state))],
    ['cmd', cmdTemplate(buildTokens(state), [evil])],
    // 검색어는 정규식으로만 쓰이고 그려지지 않는다 — 도움말에 심어야 그려진다.
    ['hits', hitsTemplate([{ ...BY_ID['embed-subs'], help: evil }], ['embed'])],
  ]) {
    assert.ok(!statics(tpl).join('').includes('<img'), `${name}: 마크업에 섞였다`);
    assert.ok(values(tpl).some(v => v.includes('<img')), `${name}: 값으로도 안 들어갔다`);
  }

  ui.fmtWarn = ''; ui.unknown = [];
  state.nodes.n8.values.format = 'bv+ba';
});
