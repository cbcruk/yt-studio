/**
 * 노드 본문.
 *
 * 본문은 DOM 을 모른다 — 노드를 받아 템플릿을 돌려주기만 한다. 그래서
 * 브라우저 없이 여기서 돌려 볼 수 있다. 고정하는 것은 둘이다.
 *
 *   · 등록된 노드 종류마다 본문이 있다 (defineKind 만 하고 defineBody 를
 *     잊으면 그 노드를 그리다 터진다)
 *   · 본문은 앱에서 다섯 가지만 받아 온다 — 그 계약이 조용히 늘지 않게 한다
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { initSchema } from '../../src/core/schema.js';
import { blankPipeline } from '../../src/core/pipeline.js';
import { blankFormat } from '../../src/core/format-graph.js';
import { blankOutput } from '../../src/core/output-graph.js';
import { blankPaths } from '../../src/core/paths-graph.js';

initSchema(JSON.parse(await readFile(new URL('../../schema.json', import.meta.url), 'utf8')));
const { installBodies } = await import('../../src/ui/bodies.js');
const { bodyOf, allKinds } = await import('../../src/ui/node-kinds.js');
const TYPES = () => allKinds().map(k => k.type);

const state = Object.assign(blankPipeline(),
  { format: blankFormat(), output: blankOutput(), paths: blankPaths() });
const ui = { picker: null, lit: null };
const host = {
  state: () => state,
  ui,
  render: () => {},
  enterSubgraph: () => {},
  paintLit: () => {},
};
installBodies(host);

/** 각 종류를 그려 보기 위한 최소 노드. */
const SAMPLE = {
  source: { urls: 'https://a\nhttps://b' },
  sink: {},
  stage: { stage: 'format', values: { format: 'bv+ba' } },
  stream: { sel: 'bv', filters: [{ key: 'height', op: '<=', value: '1080' }] },
  merge: {}, fallback: {}, multi: {},
  fout: {},
  text: { text: '/' },
  field: { name: 'title', conv: 's', fmt: '' },
  oout: { outType: '' },
  path: { pathType: 'home', path: '/dl' },
  pout: {},
};

test('등록된 노드 종류마다 본문이 있다', () => {
  const missing = TYPES().filter(t => typeof bodyOf(t) !== 'function');
  assert.deepEqual(missing, [], '본문이 없는 종류: ' + missing.join(', '));
  // 표본도 같이 따라오게 묶어 둔다 — 종류를 늘리면 여기서 걸린다.
  assert.deepEqual(TYPES().filter(t => !(t in SAMPLE)), []);
});

test('본문은 노드를 받아 템플릿을 돌려준다 — DOM 없이 돈다', () => {
  for (const type of TYPES()) {
    const n = Object.assign({ id: 'n1', type, x: 0, y: 0 }, SAMPLE[type]);
    const tpl = bodyOf(type)(n);
    assert.ok(tpl && typeof tpl === 'object', `${type}: 템플릿이 아니다`);
    // lit 의 TemplateResult 는 정적 문자열 조각을 들고 있다.
    assert.ok(Array.isArray(tpl.strings), `${type}: TemplateResult 가 아니다`);
  }
});

test('필터가 붙은 스트림도, 조각이 없는 출력도 그려진다', () => {
  const stream = { id: 'n1', type: 'stream', sel: '', filters: [
    { key: 'format_note', op: 'has' },
    { key: 'vcodec', op: '^=', value: 'avc', loose: true },
  ] };
  assert.ok(bodyOf('stream')(stream).strings);
  assert.ok(bodyOf('oout')({ id: 'oout', type: 'oout' }).strings);
});

test('피커가 열린 단계 노드도 그려진다', () => {
  const n = { id: 'n1', type: 'stage', stage: 'store', values: {} };
  ui.picker = { node: 'n1', q: '경로' };
  assert.ok(bodyOf('stage')(n).strings);
  ui.picker = null;
});

test('앱에서 받아 오는 것은 다섯 가지뿐이다', () => {
  // 계약이 조용히 늘면 본문이 다시 앱에 얽힌다. 무엇을 꺼내 쓰는지 세어 둔다.
  const touched = new Set();
  installBodies(new Proxy(host, { get(t, k) { touched.add(k); return t[k]; } }));
  assert.deepEqual([...touched].sort(),
    ['enterSubgraph', 'paintLit', 'render', 'state', 'ui']);
  installBodies(host);
});
