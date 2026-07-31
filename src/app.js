/**
 * 캔버스 · 렌더 · 포인터 · 배선.
 *
 * DOM 을 아는 층은 전부 여기 있다. 문법·그래프 대수·레이아웃 계산은
 * core/ 에, 노드와 그래프 종류의 선언은 ui/ 의 레지스트리에 있다.
 */
import { SCHEMA } from './core/schema-data.js';
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
import { emitTree, parseFormat } from './core/format-grammar.js';
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
import { chainLayout, freeSpot, orphansOf, tidyColumns } from './core/layout.js';
import { STORE_KEY, loadRaw, restore, snapshot } from './core/persist.js';
import {
  badgeOf, paletteItems, protectedIds, widthOf, widthOfType,
} from './ui/node-kinds.js';
import { installBodies } from './ui/bodies.js';
import {
  applyCanvasView,
  canvasRect,
  fitCanvas,
  focusCanvasOn,
  installCanvas,
  measuredHeight,
  mountCanvas,
  syncCanvas,
  toWorld,
  zoomCanvasBy,
} from './ui/canvas.js';
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
/* ══ 명령어 조립 ═════════════════════════════ */
// 조립·해석은 core/pipeline.js 에 있다. 여기서는 현재 상태를 넘기기만 한다.
const tokensNow = () => buildTokens(state);
const urlsNow = () => urlList(state);

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

installCanvas({
  graph: () => graph(),
  kind: () => KIND(),
  live: () => liveIds(),
  ui,
  view: () => view,
  wire: (from, to) => wire(from, to),
  unwire: (from, to) => unwire(from, to),
  dropNode: id => dropNode(id),
  redraw: () => render(),
  note: msg => flashNote(msg),
});

installChrome({
  state: () => state,
  ui,
  render: () => render(),
  addStage: (sid, x, y) => addStageNode(sid, x, y),
  centerSpot: () => centerSpot(),
  focusNode: id => focusNode(id),
});


/* ══ 렌더 ════════════════════════════════════ */
/** 옵션 ↔ 명령어 토큰 ↔ 노드 상호 강조. 클래스만 건드린다. */
function paintLit() {
  for (const el of document.querySelectorAll('.tok[data-opt]'))
    el.classList.toggle('lit', el.dataset.opt === ui.lit);
  for (const el of document.querySelectorAll('.row'))
    el.classList.toggle('lit', el.dataset.opt === ui.lit);
  const holder = ui.lit ? KIND().holderOf(state, ui.lit) : null;
  for (const el of document.querySelectorAll('.node'))
    el.classList.toggle('lit', !!holder && el.dataset.id === holder.id);
}

/** 캔버스가 빌 때의 안내. */
function renderHint() {
  const hint = $('#hint');
  hint.hidden = !KIND().isEmpty(graph());
  hint.innerHTML = `<div>${KIND().emptyHint}</div>`;
}

/** 옵션 검색창은 열린 그 순간에만 포커스를 가져간다. */
let pickerFocused = null;
function focusPicker() {
  const at = ui.picker ? ui.picker.node : null;
  if (at === pickerFocused) return;
  pickerFocused = at;
  const inp = at && document.querySelector(`.node[data-id="${at}"] .picker input`);
  if (inp) inp.focus();
}

function render() {
  KIND().sync();
  renderCrumb();
  syncCanvas().then(focusPicker);      // 캔버스는 Rete 가 그린다 — 우리는 맞추기만
  renderHint(); renderCmd(); renderPalette(); save();
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
  applyCanvasView();          // 화면 변환은 그래프마다 따로다
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
  const r = canvasRect();
  const w = toWorld(r.left + r.width / 2, r.top + r.height / 2);
  return freeSpot(graph(), w.x - NODE_W / 2, w.y - 60);   // 새 노드 폭은 만들어 봐야 안다
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
const fitView = () => fitCanvas();
const focusNode = id => focusCanvasOn(id);

/* ══ 화면 조작 ═══════════════════════════════ */
$('#zoom-in').onclick = () => zoomCanvasBy(1.2);
$('#zoom-out').onclick = () => zoomCanvasBy(1 / 1.2);
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
    const r = canvasRect();
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
    else if (ui.sel) { ui.sel = null; render(); }
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
mountCanvas($('#viewport'));
const fresh = !load();
if (fresh) resetState();
render();
if (fresh) fitView();
