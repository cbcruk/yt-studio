/**
 * 캔버스 · 렌더 · 포인터 · 배선.
 *
 * DOM 을 아는 층은 전부 여기 있다. 문법·그래프 대수·레이아웃 계산은
 * core/ 에, 노드와 그래프 종류의 선언은 ui/ 의 레지스트리에 있다.
 */
import { SCHEMA } from './core/schema-data.js';
import { html, nothing, renderTpl, repeat } from './ui/tpl.js';
import {
  BY_ID,
  KO,
  OPTS,
  STAGE,
  STAGES,
  STAGE_ORDER,
  initSchema,
  stageIdx,
} from './core/schema.js';
import { connect, disconnect, hasEdge, removeNode, valuesOf } from './core/graph.js';
import { FORMAT_OPS, emitTree, parseFormat } from './core/format-grammar.js';
import {
  FOUT,
  blankFormat,
  formatExpr,
  graphToTree,
  operands,
  treeToGraph,
} from './core/format-graph.js';
import {
  OOUT,
  blankOutput,
  outputExpr,
  outputPieces,
  piecesToGraph,
} from './core/output-graph.js';
import { POUT, blankPaths, pathsExpr, pathsToGraph } from './core/paths-graph.js';
import {
  blankPipeline,
  buildTokens,
  commandString,
  confString,
  livePath,
  parseCommand,
  spliceIntoChain,
  stageNode,
  urlList,
} from './core/pipeline.js';
import {
  bounds,
  chainLayout,
  fitTo,
  freeSpot,
  orphansOf,
  tidyColumns,
  zoomAt,
} from './core/layout.js';
import { STORE_KEY, loadRaw, restore, snapshot } from './core/persist.js';
import {
  accentOf,
  badgeOf,
  blurbOf,
  bodyOf,
  bypassLabelOf,
  hasIn,
  hasOut,
  isIO,
  labelOf,
  paletteItems,
  protectedIds,
  tagOf,
  widthOf,
  widthOfType,
} from './ui/node-kinds.js';
import { installBodies } from './ui/bodies.js';
import {
  flashNote,
  installChrome,
  renderCmd,
  renderCrumb,
  renderHits,
  renderPalette,
} from './ui/chrome.js';
import { $ } from './ui/dom.js';
import { allGraphKinds, defineGraphBehavior, graphKind } from './ui/graph-kinds.js';

/* ══ 스키마 파생 ═════════════════════════════ */
// 색인·검색·KO 사전은 core/schema.js 에 있다.
initSchema(SCHEMA);

/* ══ 그래프 상태 ═════════════════════════════ */
const NODE_W = 300, HEAD_H = 34;
const PROTECTED = protectedIds();   // 각 그래프의 고정 끝점

let state, view, seq;
const ui = {
  mode: 'pipeline', lit: null, sel: null, picker: null,
  unknown: [], drag: null, wire: null, pan: null, fmtWarn: '',
};

const blankState = () => Object.assign(blankPipeline(),
  { format: blankFormat(), output: blankOutput(), paths: blankPaths() });

function resetState() {
  state = blankState();
  seq = 1;
  ui.mode = 'pipeline';
  view = state.view;
  ui.unknown = []; ui.sel = null; ui.picker = null; ui.fmtWarn = '';
}
resetState();

/** 지금 편집 중인 그래프와 그 종류. 차이는 전부 ui/graph-kinds.js 가 안다. */
const KIND = () => graphKind(ui.mode);
const graph = () => KIND().graphOf(state);

const nid = () => 'n' + (seq++);
const nodeList = (g = graph()) => Object.values(g.nodes);
const stageOf = sid => stageNode(state, sid);
/** 렌더된 노드의 실제 높이. 레이아웃 계산에 넘겨 준다. */
const measuredHeight = id => {
  const el = document.querySelector(`.node[data-id="${id}"]`);
  return el ? el.offsetHeight : 190;
};
const setCount = n => badgeOf(n);

/* ── 그래프 질의 (모드 공용) ─────────────── */
// 원시 연산은 core/graph.js, 의미론은 core/pipeline.js · core/format-graph.js.
// 여기 남는 건 "지금 어느 모드냐"를 아는 얇은 층뿐이다.

/** 살아 있는 노드 — "결과에 기여하는가"의 정의는 그래프 종류가 갖는다. */
const liveIds = () => KIND().live(graph());

/** 입력을 하나만 받는 노드도 종류마다 다르다 (-f 출력은 표현식 하나). */
const exclusiveIn = () => new Set(KIND().exclusiveIn);
const wire = (from, to, g = graph()) => connect(g, from, to, { exclusiveIn: exclusiveIn() });
const unwire = (from, to, g = graph()) => disconnect(g, from, to);

function dropNode(id, g = graph()) {
  const ok = removeNode(g, id, { protectedIds: PROTECTED, exclusiveIn: exclusiveIn() });
  if (!ok) return false;
  if (ui.sel === id) ui.sel = null;
  if (ui.picker && ui.picker.node === id) ui.picker = null;
  return true;
}
/* ── 파이프라인 전용 ─────────────────────── */
function addStageNode(sid, x, y) {
  const found = stageNode(state, sid);
  if (found) return found;
  const n = { id: nid(), type: 'stage', stage: sid, x, y, values: {} };
  state.nodes[n.id] = n;
  spliceIntoChain(state, n);
  return n;
}
/* ── 서브그래프 전용 ─────────────────────── */
// 서브그래프가 컴파일한 값. 문법·트리 변환은 core/ 의 해당 모듈에 있다.
const fmtExpr = () => formatExpr(state.format);
const outExpr = () => outputExpr(state.output);
const pathExpr = () => pathsExpr(state.paths);

function addPathNode(type, x, y, extra) {
  const n = Object.assign({ id: nid(), type, x, y }, extra || {});
  if (type === 'path') { n.pathType = n.pathType ?? 'home'; n.path = n.path ?? ''; }
  state.paths.nodes[n.id] = n;
  return n;
}
/** 파이프라인의 --paths 값을 서브그래프가 컴파일한 결과로 덮어쓴다. 한 줄에 -P 하나. */
function syncPathsValue() {
  const n = stageOf('store');
  if (n) valuesOf(n).paths = pathExpr();
}

function addOutputNode(type, x, y, extra) {
  const n = Object.assign({ id: nid(), type, x, y }, extra || {});
  if (type === 'text') n.text = n.text ?? ' - ';
  if (type === 'field') { n.name = n.name || 'title'; n.conv = n.conv || 's'; n.fmt = n.fmt || ''; }
  state.output.nodes[n.id] = n;
  return n;
}

/** 파이프라인의 --output 값을 서브그래프가 컴파일한 결과로 덮어쓴다. */
function syncOutputValue() {
  const n = stageOf('store');
  if (n) valuesOf(n).output = outExpr();
}

function addFormatNode(type, x, y, extra) {
  const n = Object.assign({ id: nid(), type, x, y }, extra || {});
  if (type === 'stream') { n.sel = n.sel || 'bv'; n.filters = n.filters || []; }
  state.format.nodes[n.id] = n;
  return n;
}

/** 파이프라인의 --format 값을 서브그래프가 컴파일한 결과로 덮어쓴다. */
function syncFormatValue() {
  const n = stageNode(state, 'format');
  if (n) valuesOf(n).format = fmtExpr();
}
/* ── 좌표 변환 ───────────────────────────── */
const vp = () => $('#viewport').getBoundingClientRect();
function toWorld(clientX, clientY) {
  const r = vp();
  return { x: (clientX - r.left - view.x) / view.k, y: (clientY - r.top - view.y) / view.k };
}
const portPos = n => ({ inX: n.x, outX: n.x + widthOf(n), y: n.y + HEAD_H / 2 });
const hasInPort = hasIn, hasOutPort = hasOut;

/* ══ 명령어 조립 ═════════════════════════════ */
// 조립·해석은 core/pipeline.js 에 있다. 여기서는 현재 상태를 넘기기만 한다.
const tokensNow = () => buildTokens(state);
const urlsNow = () => urlList(state);
/* ══ 렌더 ════════════════════════════════════ */
function applyView() {
  $('#node-layer').style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  $('#wire-layer').setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
  const el = $('#viewport');
  el.style.backgroundSize = (22 * view.k) + 'px ' + (22 * view.k) + 'px';
  el.style.backgroundPosition = view.x + 'px ' + view.y + 'px';
  $('#zoom-label').textContent = Math.round(view.k * 100) + '%';
}
function wirePath(x1, y1, x2, y2) {
  const dx = Math.max(34, Math.min(150, Math.abs(x2 - x1) * 0.5));
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}
const svgEl = t => document.createElementNS('http://www.w3.org/2000/svg', t);

function renderWires() {
  const g = graph();
  const layer = $('#wire-layer');
  const live = liveIds();
  layer.innerHTML = '';

  // 연산자 노드는 입력 순서가 의미를 가지므로 와이어에 번호를 붙인다.
  // 피연산자 순서가 의미를 갖는 그래프에서만 와이어에 번호를 붙인다.
  const ordinal = {};
  if (KIND().wireOrdinals) {
    for (const n of nodeList(g)) {
      if (!FORMAT_OPS.includes(n.type)) continue;
      KIND().operandsOf(g, n.id).forEach((k, i) => { ordinal[k.id + '>' + n.id] = i + 1; });
    }
  }

  for (const e of g.edges) {
    const a = g.nodes[e.from], b = g.nodes[e.to];
    if (!a || !b) continue;
    const pa = portPos(a), pb = portPos(b);
    const d = wirePath(pa.outX, pa.y, pb.inX, pb.y);
    const on = live.has(e.from) && live.has(e.to);
    const grp = svgEl('g');
    grp.setAttribute('class', 'wire-g');
    grp.style.pointerEvents = 'auto';
    // 삭제는 viewport 의 pointerdown 에서 처리한다. 팬이 포인터를 캡처해 버리면
    // click 이 viewport 로 되돌아가기 때문에 여기에 onclick 을 달면 안 걸린다.
    grp.dataset.from = e.from;
    grp.dataset.to = e.to;
    const hit = svgEl('path');
    hit.setAttribute('class', 'wire-hit'); hit.setAttribute('d', d);
    hit.innerHTML = '<title>클릭해서 연결 끊기</title>';
    const p = svgEl('path');
    p.setAttribute('class', 'wire' + (on ? '' : ' dead'));
    p.setAttribute('d', d);
    if (on) p.style.stroke = accentOf(a);
    grp.append(hit, p);

    const ord = ordinal[e.from + '>' + e.to];
    if (ord) {
      const t = svgEl('text');
      t.setAttribute('class', 'wire-ord');
      t.setAttribute('x', pb.inX - 16);
      t.setAttribute('y', pb.y - 6);
      t.setAttribute('text-anchor', 'end');
      t.textContent = ord;
      grp.append(t);
    }
    layer.append(grp);
  }

  if (ui.wire) {
    const p = svgEl('path');
    p.setAttribute('class', 'wire-temp');
    p.setAttribute('d', wirePath(ui.wire.x1, ui.wire.y1, ui.wire.x2, ui.wire.y2));
    layer.append(p);
  }
}

/* ── UI 모듈에 앱을 넘긴다 ───────────────── */
// 노드 안쪽은 ui/bodies.js, 캔버스 밖 틀은 ui/chrome.js 가 그린다. 앱은 그쪽이
// 필요한 것만 넘긴다 — state 는 다시 대입되므로 값이 아니라 게터로 넘긴다.
installBodies({
  state: () => state,
  ui,
  render: () => render(),
  enterSubgraph: id => enterSubgraph(id),
  paintLit: () => paintLit(),
});

installChrome({
  state: () => state,
  ui,
  render: () => render(),
  addStage: (sid, x, y) => addStageNode(sid, x, y),
  centerSpot: () => centerSpot(),
  focusNode: id => focusNode(id),
});

/* ── 노드 ────────────────────────────────── */
/**
 * 노드 하나. 머리·본문·포트가 전부 한 템플릿이다.
 *
 * 예전에는 렌더마다 노드 엘리먼트를 새로 만들어 갈아 끼웠다. 그래서 입력
 * 중 포커스가 날아갔고, 포커스와 캐럿을 담았다 되돌리는 기구와 조합(IME)
 * 중인 노드를 비켜 가는 예외가 따로 필요했다. 지금은 lit 이 같은 DOM 을
 * 재사용하므로 그 기구가 통째로 없다 — 브라우저가 알아서 지킨다.
 */
function nodeTemplate(n, live) {
  const cls = 'node' + (isIO(n) ? ' io' : '')
    + (live.has(n.id) ? '' : ' bypass') + (ui.sel === n.id ? ' sel' : '')
    + (n.collapsed ? ' collapsed' : '');
  const style = `--a:${accentOf(n)};--node-w:${widthOf(n)}px;`
    + `left:${n.x}px;top:${n.y}px`;
  const badge = setCount(n);
  const toggle = () => {
    n.collapsed = !n.collapsed;
    if (ui.picker && ui.picker.node === n.id) ui.picker = null;
    render();
  };

  return html`
    <div class=${cls} data-id=${n.id} style=${style}
         @pointerdown=${() => { ui.sel = n.id; paintSel(); }}>
      <div class="node-head" title=${blurbOf(n)} @dblclick=${toggle}>
        <span class="node-tag">[${tagOf(n)}]</span>
        <span class="node-ko">${labelOf(n)}<span class="node-badge">${bypassLabelOf(n)}</span></span>
        <span class="node-n" data-n=${badge}>${badge}</span>
        <button class="node-x" type="button" title=${n.collapsed ? '펴기' : '접기'}
                @click=${ev => { ev.stopPropagation(); toggle(); }}
        >${n.collapsed ? '▸' : '▾'}</button>
        ${PROTECTED.has(n.id) ? html`<span></span>` : html`
          <button class="node-x" type="button" title="노드 지우기"
                  @click=${ev => { ev.stopPropagation(); dropNode(n.id); render(); }}>✕</button>`}
      </div>
      ${n.collapsed ? nothing : html`
        <div class="node-body">${bodyOf(n.type)(n)}</div>`}
      ${hasInPort(n) ? html`
        <span class="port in" data-node=${n.id} data-side="in" title="입력"></span>` : nothing}
      ${hasOutPort(n) ? html`
        <span class="port out" data-node=${n.id} data-side="out"
              title="출력 — 여기서 끌어다 다른 노드 입력에 놓아라"></span>` : nothing}
    </div>`;
}

/** 옵션 검색창은 열린 그 순간에만 포커스를 가져간다. 그 뒤로는 DOM 이
 *  살아 있으므로 다시 건드릴 필요가 없다. */
let pickerFocused = null;
function focusPicker(layer) {
  const at = ui.picker ? ui.picker.node : null;
  if (at === pickerFocused) return;
  pickerFocused = at;
  if (!at) return;
  const inp = layer.querySelector(`.node[data-id="${at}"] .picker input`);
  if (inp) inp.focus();
}

function renderNodes() {
  const layer = $('#node-layer');
  const g = graph();
  const live = liveIds();

  // id 로 키를 잡아 두면 노드가 늘고 줄어도 남는 노드의 DOM 은 그대로다.
  renderTpl(html`${repeat(nodeList(g), n => n.id, n => nodeTemplate(n, live))}`, layer);
  focusPicker(layer);

  const hint = $('#hint');
  hint.hidden = !KIND().isEmpty(g);
  hint.innerHTML = `<div>${KIND().emptyHint}</div>`;
}

function paintLit() {
  for (const el of document.querySelectorAll('.tok[data-opt]'))
    el.classList.toggle('lit', el.dataset.opt === ui.lit);
  for (const el of document.querySelectorAll('.row'))
    el.classList.toggle('lit', el.dataset.opt === ui.lit);
  const holder = ui.lit ? KIND().holderOf(state, ui.lit) : null;
  for (const el of document.querySelectorAll('.node'))
    el.classList.toggle('lit', !!holder && el.dataset.id === holder.id);
}
function paintSel() {
  for (const el of document.querySelectorAll('.node'))
    el.classList.toggle('sel', el.dataset.id === ui.sel);
}

function render() {
  KIND().sync();
  renderCrumb(); renderNodes(); renderWires(); renderCmd(); renderPalette(); applyView(); save();
}

/* ══ 그래프 종류의 DOM 쪽 동작 ═══════════════
   선언은 ui/graph-kinds.js 에 있고, 캔버스를 실제로 만지는 일만 여기서 얹는다. */

defineGraphBehavior('pipeline', {
  addNode: (key, x, y) => addStageNode(key, x, y),
  sync() {},                       // 파이프라인은 자기가 원본이라 되돌릴 곳이 없다
  tidy() {},
  relayout() {
    chainLayout(state, livePath(state), { nodeW: NODE_W });
    fitView(); render();
  },
});

defineGraphBehavior('format', {
  // 그래프를 고칠 때마다 컴파일해 --format 문자열로 돌려놓는다.
  // -f 출력 노드와 브레드크럼은 render 가 알아서 따라온다.
  addNode: (key, x, y) => addFormatNode(key, x, y),
  sync() { syncFormatValue(); },
  tidy() { tidyColumns(state.format, measuredHeight, { operandsOf: operands }); },
  relayout() {
    const g = graph();
    // 표현식은 트리다. 컴파일한 결과를 다시 펼치면 그게 곧 정돈된 배치다.
    const fresh = treeToGraph(graphToTree(g), { nid, nodeW: NODE_W });
    // 트리에 안 잡힌(끊긴) 노드는 아래쪽에 남겨 둔다.
    const orphans = orphansOf(g, FOUT);
    const maxY = Math.max(0, ...nodeList(fresh).map(n => n.y));
    orphans.forEach((n, i) => { n.x = i * (NODE_W + 90); n.y = maxY + 190; fresh.nodes[n.id] = n; });
    const dead = new Set(orphans.map(n => n.id));
    for (const e of g.edges)
      if (fresh.nodes[e.from] && fresh.nodes[e.to] && dead.has(e.from)
          && !hasEdge(fresh, e.from, e.to)) fresh.edges.push(e);
    fresh.view = g.view;
    delete fresh._tidy;
    state.format = fresh;
    view = state.format.view;
    render();            // 실측하려면 일단 그려야 한다
    KIND().tidy();
    render();
    fitView();
  },
});

defineGraphBehavior('paths', {
  addNode: (key, x, y) => addPathNode(key, x, y),
  sync() { syncPathsValue(); },
  tidy() { tidyColumns(state.paths, measuredHeight, {}); },
  relayout() {
    const g = graph();
    const fresh = pathsToGraph(pathExpr(), { nid, nodeW: NODE_W });
    const orphans = orphansOf(g, POUT);
    const maxY = Math.max(0, ...nodeList(fresh).map(n => n.y));
    orphans.forEach((n, i) => { n.x = 0; n.y = maxY + 190 + i * 150; fresh.nodes[n.id] = n; });
    fresh.view = g.view;
    delete fresh._tidy;
    state.paths = fresh;
    view = state.paths.view;
    render(); KIND().tidy(); render();
    fitView();
  },
});

defineGraphBehavior('output', {
  // 조각을 고칠 때마다 이어 붙여 --output 문자열로 돌려놓는다.
  addNode: (key, x, y) => addOutputNode(key, x, y),
  sync() { syncOutputValue(); },
  // 조각은 한 줄로 늘어서므로 같은 열에 겹칠 일이 없다. 세로만 맞춰 준다.
  tidy() { tidyColumns(state.output, measuredHeight, {}); },
  relayout() {
    const g = graph();
    // 수열이다. 지금 순서 그대로 다시 늘어놓으면 그게 정돈된 배치다.
    const fresh = piecesToGraph(outputPieces(g), g.nodes[OOUT].outType, { nid, widthOf: widthOfType });
    // 이어지지 않은 조각은 아래쪽에 남겨 둔다.
    const orphans = orphansOf(g, OOUT);
    const maxX = Math.max(0, ...nodeList(fresh).map(n => n.x));
    orphans.forEach((n, i) => { n.x = i * (NODE_W + 40); n.y = 380; fresh.nodes[n.id] = n; });
    fresh.view = g.view;
    delete fresh._tidy;
    state.output = fresh;
    view = state.output.view;
    render(); KIND().tidy(); render();
    fitView();
  },
});

/* ══ 모드 전환 ═══════════════════════════════ */
function setMode(m) {
  if (m === ui.mode) return;
  ui.mode = m;
  view = KIND().viewOf(state);
  ui.sel = null; ui.picker = null; ui.lit = null;
  $('#hits').hidden = true;
  render();
}

/** --format 문자열을 서브그래프로 풀어 놓고 들어간다.
 *  이미 같은 값을 만들어 내는 그래프가 있으면 배치를 그대로 재사용한다. */
/** 옵션 문자열을 서브그래프로 풀어 놓고 들어간다.
 *  이미 같은 값을 만들어 내는 그래프가 있으면 배치를 그대로 재사용한다. */
function enterSubgraph(kindId) {
  const k = graphKind(kindId);
  const holder = stageOf(BY_ID[k.opensFrom.option].stage);
  const raw = holder ? String(valuesOf(holder)[k.opensFrom.option] ?? '') : '';
  ui.fmtWarn = '';

  if (k.compile(state) !== raw.trim()) {
    let built = null, err = null;
    try { built = k.fromString(raw, { nid, nodeW: NODE_W, widthOf: widthOfType }); }
    catch (e) { err = e; }
    if (err) {
      const keep = confirm(
        `"${raw}" 를 그래프로 읽지 못했다.\n\n${err.message}\n\n` +
        `빈 서브그래프에서 새로 시작할까? (취소하면 문자열을 그대로 두고 돌아간다)`);
      if (!keep) return;
      built = k.blank();
      const opt = BY_ID[k.opensFrom.option];
      ui.fmtWarn = `읽지 못한 ${opt.short || opt.flag} 문자열을 그래프가 덮어썼다: ` + raw;
    }
    k.adopt(state, built);
  }
  setMode(kindId);
  const g = graph();
  if (g._tidy) { delete g._tidy; k.tidy(); render(); }
  fitView();
}

/* ══ 배치 ════════════════════════════════════ */
/** 화면 한가운데에서 겹치지 않는 자리. */
function centerSpot() {
  const r = vp();
  return freeSpot(graph(),
    (r.width / 2 - view.x) / view.k - NODE_W / 2,   // 새 노드 폭은 만들어 봐야 안다
    (r.height / 2 - view.y) / view.k - 60);
}
function autolayout() {
  KIND().relayout();
}

function autowire() {
  if (!KIND().canAutowire) return;
  const chain = ['src',
    ...nodeList(state).filter(n => n.type === 'stage')
      .sort((a, b) => stageIdx(a.stage) - stageIdx(b.stage)).map(n => n.id),
    'out'];
  state.edges = [];
  for (let i = 0; i < chain.length - 1; i++) state.edges.push({ from: chain[i], to: chain[i + 1] });
  render();
}
function fitView() {
  const r = vp();
  const box = bounds(graph(), measuredHeight, { widthOf: id => widthOf(graph().nodes[id]) });
  const v = fitTo(box, r.width, r.height);
  if (!v) return;
  Object.assign(view, v);
  applyView();
}
function focusNode(id) {
  const n = graph().nodes[id];
  if (!n) return;
  const r = vp();
  view.x = r.width / 2 - (n.x + NODE_W / 2) * view.k;
  view.y = r.height / 3 - n.y * view.k;
  applyView(); renderWires();
}

/* ══ 포인터: 팬 · 노드 이동 · 배선 ═══════════ */
const viewport = $('#viewport');

viewport.addEventListener('pointerdown', e => {
  const port = e.target.closest('.port');
  const head = e.target.closest('.node-head');
  const wireEl = e.target.closest('.wire-g');

  if (wireEl && !port && !head) {
    e.preventDefault();
    const { from, to } = wireEl.dataset;
    graph().edges = graph().edges.filter(x => !(x.from === from && x.to === to));
    render();
    return;
  }

  if (port) {
    e.preventDefault(); e.stopPropagation();
    const n = graph().nodes[port.dataset.node];
    const p = portPos(n);
    const side = port.dataset.side;
    const x = side === 'out' ? p.outX : p.inX;
    ui.wire = { from:n.id, side, x1:x, y1:p.y, x2:x, y2:p.y };
    viewport.classList.add('wiring');
    viewport.setPointerCapture(e.pointerId);
    renderWires();
    return;
  }

  // 헤더 위의 버튼(접기·삭제)은 자기 onclick 으로 처리한다.
  // 여기서 드래그를 시작하면 포인터 캡처가 click 을 viewport 로 가로챈다.
  if (head && e.target.closest('button')) return;

  if (head) {
    const el = head.closest('.node');
    const n = graph().nodes[el.dataset.id];
    const w = toWorld(e.clientX, e.clientY);
    ui.drag = { id:n.id, dx: w.x - n.x, dy: w.y - n.y, el };
    ui.sel = n.id; paintSel();
    viewport.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }

  if (e.target.closest('.node') || e.target.closest('.hud')) return;
  ui.pan = { x: e.clientX - view.x, y: e.clientY - view.y };
  ui.sel = null; paintSel();
  viewport.classList.add('panning');
  viewport.setPointerCapture(e.pointerId);
});

viewport.addEventListener('pointermove', e => {
  if (ui.wire) {
    const w = toWorld(e.clientX, e.clientY);
    ui.wire.x2 = w.x; ui.wire.y2 = w.y;
    for (const p of document.querySelectorAll('.port')) p.classList.remove('hot');
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const port = hit && hit.closest && hit.closest('.port');
    if (port && port.dataset.side !== ui.wire.side) port.classList.add('hot');
    renderWires();
    return;
  }
  if (ui.drag) {
    const w = toWorld(e.clientX, e.clientY);
    const n = graph().nodes[ui.drag.id];
    n.x = Math.round(w.x - ui.drag.dx);
    n.y = Math.round(w.y - ui.drag.dy);
    ui.drag.el.style.left = n.x + 'px';
    ui.drag.el.style.top = n.y + 'px';
    renderWires();
    return;
  }
  if (ui.pan) {
    view.x = e.clientX - ui.pan.x;
    view.y = e.clientY - ui.pan.y;
    applyView();
  }
});

function endPointer(e) {
  if (ui.wire) {
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const port = hit && hit.closest && hit.closest('.port');
    if (port && port.dataset.side !== ui.wire.side) {
      const other = port.dataset.node;
      const ok = ui.wire.side === 'out'
        ? wire(ui.wire.from, other)
        : wire(other, ui.wire.from);
      if (!ok) flashNote('이을 수 없다 — 이미 이어져 있거나 순환이 된다.');
    }
    for (const p of document.querySelectorAll('.port')) p.classList.remove('hot');
    ui.wire = null;
    viewport.classList.remove('wiring');
    render();
  }
  // 세로 위치가 연산자의 피연산자 순서를 정하므로, 드래그가 끝나면 전부 다시 그린다.
  if (ui.drag) { ui.drag = null; render(); }
  if (ui.pan) { ui.pan = null; viewport.classList.remove('panning'); save(); }
}
viewport.addEventListener('pointerup', endPointer);
viewport.addEventListener('pointercancel', endPointer);

viewport.addEventListener('wheel', e => {
  e.preventDefault();
  const r = vp();
  Object.assign(view, zoomAt(view, e.clientX - r.left, e.clientY - r.top,
                             Math.exp(-e.deltaY * 0.0016)));
  applyView(); save();
}, { passive: false });

function zoomBy(f) {
  const r = vp();
  Object.assign(view, zoomAt(view, r.width / 2, r.height / 2, f));
  applyView(); save();
}
$('#zoom-in').onclick = () => zoomBy(1.2);
$('#zoom-out').onclick = () => zoomBy(1 / 1.2);
$('#zoom-reset').onclick = fitView;
$('#fit').onclick = fitView;
$('#autolayout').onclick = autolayout;
$('#autowire').onclick = autowire;
$('#crumb-back').onclick = () => setMode('pipeline');

/* ── 팔레트에서 캔버스로 끌어다 놓기 ─────── */
$('#pal-list').addEventListener('pointerdown', e => {
  const item = e.target.closest('.pal-item');
  if (!item) return;
  if (item.classList.contains('placed')) { focusNode(stageOf(item.dataset.stage).id); return; }

  const key = item.dataset.key;
  const start = { x: e.clientX, y: e.clientY };
  let ghost = null;
  item.setPointerCapture(e.pointerId);

  const move = ev => {
    if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6) {
      ghost = document.createElement('div');
      ghost.className = 'pal-ghost';
      const meta = paletteItems(ui.mode, STAGES).find(x => x.key === key);
      ghost.style.setProperty('--a', meta.accent);
      ghost.textContent = `[${meta.tag}] ${meta.label}`;
      document.body.append(ghost);
    }
    if (ghost) { ghost.style.left = (ev.clientX + 12) + 'px'; ghost.style.top = (ev.clientY + 12) + 'px'; }
  };
  const up = ev => {
    item.removeEventListener('pointermove', move);
    item.removeEventListener('pointerup', up);
    if (ghost) ghost.remove();
    const r = vp();
    const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    let pos;
    if (ghost && inside) {
      const w = toWorld(ev.clientX, ev.clientY);
      pos = [Math.round(w.x - NODE_W / 2), Math.round(w.y - HEAD_H / 2)];
    } else if (ghost) {
      return;                                    // 캔버스 밖에 떨어뜨렸다 — 없던 일로
    } else {
      pos = centerSpot();                          // 그냥 클릭 → 화면 가운데
    }
    const n = KIND().addNode(key, pos[0], pos[1]);   // 무엇을 만드는지는 그래프 종류가 안다
    ui.sel = n.id;
    render();
    $('#palette').classList.remove('open');
  };
  item.addEventListener('pointermove', move);
  item.addEventListener('pointerup', up);
});

/* ── 명령어 ↔ 그래프 상호 강조 ───────────── */
$('#cmd').addEventListener('mouseover', e => {
  const t = e.target.closest('.tok[data-opt]');
  if (t) { ui.lit = t.dataset.opt; paintLit(); }
});
$('#cmd').addEventListener('mouseout', () => { ui.lit = null; paintLit(); });

/* ══ 역방향: 명령어 → 그래프 ═════════════════ */
function importCommand(text) {
  const { urls, picked, unknown } = parseCommand(text);

  const keep = state.nodes.src.urls;
  resetState();
  state.nodes.src.urls = urls.length ? urls.join('\n') : keep;
  ui.unknown = unknown;

  for (const sid of STAGE_ORDER) {
    if (!picked[sid]) continue;
    const n = addStageNode(sid, 0, 0);
    Object.assign(valuesOf(n), picked[sid]);
  }

  // 값이 그 자체로 문법인 옵션들은 서브그래프로도 풀어 둔다.
  // 못 읽으면 문자열은 그대로 두고 알린다.
  const warns = [];
  for (const k of allGraphKinds()) {
    if (!k.opensFrom) continue;
    const opt = BY_ID[k.opensFrom.option];
    const raw = picked[opt.stage] && picked[opt.stage][opt.id];
    if (!raw) continue;
    try { k.adopt(state, k.fromString(raw, { nid, nodeW: NODE_W, widthOf: widthOfType })); }
    catch (e) {
      warns.push(`${opt.short || opt.flag} "${raw}" 는 서브그래프로 못 읽었다 (${e.message})`);
    }
  }
  if (warns.length) ui.fmtWarn = warns.join(' · ') + ' — 문자열 그대로 둔다';

  autowire();
  autolayout();
}
/* ══ 저장 ════════════════════════════════════ */
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(snapshot(state, seq, ui.mode))); } catch {}
  }, 250);
}
const snap = () => snapshot(state, seq, ui.mode);

/** core 의 restore 결과를 앱 전역에 앉힌다. */
function adoptSnapshot(data) {
  const r = restore(data, {
    subgraphs: [{ key: 'format', root: FOUT, blank: blankFormat },
                { key: 'output', root: OOUT, blank: blankOutput },
                { key: 'paths',  root: POUT, blank: blankPaths }],
    isValidStage: s => !!STAGE[s],
  });
  if (!r) return false;
  state = r.state; seq = r.seq; ui.mode = r.mode;
  view = KIND().viewOf(state);
  ui.unknown = []; ui.sel = null; ui.picker = null; ui.fmtWarn = '';
  return true;
}
const load = () => adoptSnapshot(loadRaw(localStorage));
/* ══ 배선 ════════════════════════════════════ */
$('#ver').textContent = 'yt-dlp ' + SCHEMA.ytdlp_version + ' 스키마 · ' + OPTS.length + '개 옵션 · ' + STAGES.length + '개 단계';
$('#q').oninput = renderHits;
$('#q').onkeydown = e => { if (e.key === 'Escape') { $('#q').value = ''; renderHits(); } };
$('#q').onfocus = renderHits;
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.field') && !e.target.closest('.hits')) $('#hits').hidden = true;
}, true);

$('#reset').onclick = () => {
  if (!confirm('파이프라인과 서브그래프 셋을 전부 지운다. 계속할까?')) return;
  resetState(); render(); fitView();
};
$('#import').onclick = () => $('#dlg-import').showModal();
$('#do-import').onclick = () => { importCommand($('#paste').value); $('#dlg-import').close(); };
$('#graph-io').onclick = () => {
  $('#graph-text').value = JSON.stringify(snap(), null, 1);
  $('#dlg-graph').showModal();
};
$('#graph-load').onclick = () => {
  try {
    if (adoptSnapshot(JSON.parse($('#graph-text').value))) { render(); fitView(); $('#dlg-graph').close(); }
    else alert('그래프 형식이 아니다.');
  } catch (err) { alert('JSON을 읽지 못했다: ' + err.message); }
};
$('#graph-copy').onclick = e => copy($('#graph-text').value, e.target);
$('#pal-toggle').onclick = () => $('#palette').classList.toggle('open');

document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (e.key === '/' && !typing && KIND().search) { e.preventDefault(); $('#q').focus(); }
  if (e.key === 'Escape') {
    if (ui.picker) { ui.picker = null; render(); }
    else if (ui.sel) { ui.sel = null; paintSel(); }
    else if (KIND().parent) setMode(KIND().parent);
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && ui.sel) {
    e.preventDefault(); dropNode(ui.sel); render();
  }
});

async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.append(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  const old = btn.textContent; btn.textContent = '복사됨';
  setTimeout(() => btn.textContent = old, 1200);
}
$('#copy-cmd').onclick = e => copy(commandString(state), e.target);
$('#copy-conf').onclick = e => copy(confString(state), e.target);

addEventListener('resize', () => { applyView(); renderWires(); });

/* ══ 테스트 손잡이 ═══════════════════════════
   e2e 가 잡는 유일한 표면. 내부 이름·시그니처가 바뀌어도 여기서 흡수해서
   테스트가 리팩터링의 브레이크로 남게 한다. 앱 코드는 이걸 쓰지 않는다. */
window.__yt = {
  get state() { return state; },
  get ui() { return ui; },
  get view() { return view; },
  render,
  connect: (from, to, g) => wire(from, to, g || graph()),
  removeNode: (id, g) => dropNode(id, g || graph()),
  addFormatNode,
  formatExpr: () => fmtExpr(),
  outExpr: () => outExpr(),
  pathExpr: () => pathExpr(),
  commandString: () => commandString(state),
  confString: () => confString(state),
  parseFormat,
  emitTree,
};

/* ── 시작 ────────────────────────────────── */
const fresh = !load();
if (fresh) resetState();
render();
if (fresh) fitView();
