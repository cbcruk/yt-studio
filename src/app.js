/**
 * 캔버스 · 렌더 · 포인터 · 배선.
 *
 * DOM 을 아는 층은 전부 여기 있다. 문법·그래프 대수·레이아웃 계산은
 * core/ 에, 노드와 그래프 종류의 선언은 ui/ 의 레지스트리에 있다.
 */
import { SCHEMA } from './core/schema-data.js';
import {
  BY_ID,
  BY_STAGE,
  OPTS,
  STAGE,
  STAGES,
  STAGE_ORDER,
  initSchema,
  stageIdx,
} from './core/schema.js';
import { connect, disconnect, removeNode, valuesOf } from './core/graph.js';
import { emitTree, parseFormat } from './core/format-grammar.js';
import { FOUT, blankFormat } from './core/format-graph.js';
import { OOUT, blankOutput } from './core/output-graph.js';
import { POUT, blankPaths } from './core/paths-graph.js';
import {
  blankPipeline,
  commandString,
  confString,
  parseCommand,
  scanCommand,
  spliceIntoChain,
  stageNode,
} from './core/pipeline.js';
import { freeSpot } from './core/layout.js';
import {
  STORE_KEY, VIEW_KEY, loadDraft, loadHistory, loadRaw, loadView, pushHistory,
  restore, saveDraft, saveHistory, snapshot,
} from './core/persist.js';
import { lintCommand } from './core/lint.js';
import {
  AskError, DEFAULT_MODEL, KEY_STORE, MODEL_STORE,
  ask, extractCommand, systemBlocks, userText,
} from './core/ask.js';
import { protectedIds, widthOfType } from './ui/node-kinds.js';
import { installBodies } from './ui/bodies.js';
import {
  addFormatNode, fmtExpr, installGraphBehavior, outExpr, pathExpr,
} from './ui/graph-behavior.js';
import {
  applyCanvasView,
  canvasRect,
  fitCanvas,
  focusCanvasOn,
  installCanvas,
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
  mountChrome,
  renderPalette,
} from './ui/chrome.js';
import { $ } from './ui/dom.js';
import { allGraphKinds, graphKind } from './ui/graph-kinds.js';
import { askTemplate, installAsk } from './ui/ask.js';
import { blankBrowse, installBrowse } from './ui/browse.js';
import { installReport } from './ui/report.js';
import { renderTpl } from './ui/tpl.js';

/* ══ 스키마 파생 ═════════════════════════════ */
// 색인·검색·KO 사전은 core/schema.js 에 있다.
initSchema(SCHEMA);

/* ══ 그래프 상태 ═════════════════════════════ */
const NODE_W = 300;
const PROTECTED = protectedIds();   // 각 그래프의 고정 끝점

let state, seq;
const ui = {
  view: 'ask',                        // 'ask' 가 첫 화면이다 — 그래프는 고칠 때 연다
  mode: 'pipeline', lit: null, sel: null, picker: null,
  unknown: [], drag: null, wire: null, pan: null, fmtWarn: '',
};

/**
 * 프롬프트 화면의 상태.
 *
 * command 가 이 앱의 원본이다. 그래프는 이걸 풀어 놓은 편집기이고,
 * 그래프에서 나올 때 다시 여기로 접힌다.
 */
const ak = {
  prompt: '', command: '', note: '', error: '', busy: false,
  key: '', model: DEFAULT_MODEL, history: [], browse: blankBrowse(),
};

const blankState = () => Object.assign(blankPipeline(),
  { format: blankFormat(), output: blankOutput(), paths: blankPaths() });

function resetState() {
  state = blankState();
  seq = 1;
  ui.mode = 'pipeline';
  ui.unknown = []; ui.sel = null; ui.picker = null; ui.fmtWarn = '';
}
resetState();

/** 지금 편집 중인 그래프와 그 종류. 차이는 전부 ui/graph-kinds.js 가 안다. */
const KIND = () => graphKind(ui.mode);
const graph = () => KIND().graphOf(state);

const nid = () => 'n' + (seq++);
const nodeList = (g = graph()) => Object.values(g.nodes);
const stageOf = sid => stageNode(state, sid);

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
/* ══ 명령어 조립 ═════════════════════════════ */
// 조립·해석은 core/pipeline.js 에 있다. 여기서는 현재 상태를 넘기기만 한다.

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

installGraphBehavior({
  state: () => state,
  graph: () => graph(),
  kind: () => KIND(),
  nid,
  render: () => render(),
  addStage: (sid, x, y) => addStageNode(sid, x, y),
});

installCanvas({
  graph: () => graph(),
  kind: () => KIND(),
  live: () => liveIds(),
  ui,
  view: () => KIND().viewOf(state),   // 그래프마다 따로다
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
  addNode: (key, x, y) => KIND().addNode(key, x, y),
  centerSpot: () => centerSpot(),
  focusNode: id => focusNode(id),
});

/* ══ 프롬프트 화면 ═══════════════════════════
   원본은 ak.command 다. 그래프는 그걸 풀어 놓는 편집기이고, 검증은
   core/lint.js 가 스키마와 진짜 파서로 한다 — 모델의 말은 안 믿는다. */

/** 명령어 문자열에 토큰 하나를 끼운다. URL 앞에 둔다 — 뒤로 가면 읽기 나쁘다. */
function addToken(text) {
  const t = String(text).trim();
  if (!t) return;
  const cur = ak.command.trim();
  if (!cur) { ak.command = 'yt-dlp ' + t; return; }
  const { head, items } = scanCommand(cur);
  ak.command = [
    head || 'yt-dlp',
    ...items.filter(i => i.kind !== 'url').map(i => i.raw),
    t,
    ...items.filter(i => i.kind === 'url').map(i => i.raw),
  ].join(' ');
}

/** 오타 제안을 눌렀을 때. 플래그 자리만 갈아 끼우고 값은 그대로 둔다. */
function replaceFlag(from, to) {
  const esc = String(from).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  ak.command = ak.command.replace(new RegExp(`(^|\\s)${esc}(?=[\\s=]|$)`, 'g'), `$1${to}`);
}

installBrowse({ state: ak.browse, render: () => render(), add: addToken });
installReport({ render: () => render(), add: addToken, replaceFlag });
installAsk({
  state: ak,
  render: () => render(),
  run: () => runAsk(),
  toGraph: () => enterGraph(),
  copy: (text, btn) => copy(text, btn),
  lint: text => lintCommand(text),
  openPack: () => openPack(),
  openKey: () => openKeyDialog(),
});

/* ── 모델에게 묻기 ───────────────────────── */
const systemFor = () => systemBlocks(SCHEMA.ytdlp_version, STAGES, BY_STAGE);

async function runAsk() {
  const want = ak.prompt.trim();
  if (!want || ak.busy) return;
  if (!ak.key) { openPack(); return; }

  ak.busy = true; ak.error = ''; render();
  try {
    const { text } = await ask({
      key: ak.key,
      model: ak.model,
      system: systemFor(),
      user: userText(want, ak.command.trim()),
    });
    const { command, note } = extractCommand(text);
    if (!command) {
      ak.error = '답에서 명령어를 찾지 못했다 — 프롬프트 복사로 직접 물어볼 것';
    } else {
      ak.command = command;
      ak.note = note;
      ak.prompt = '';
      ak.history = pushHistory(ak.history, { command, prompt: want });
    }
  } catch (e) {
    ak.error = e instanceof AskError ? e.message : `실패했다 — ${e.message}`;
  } finally {
    ak.busy = false; render();
  }
}

/** 키 없이 쓰는 길. 시스템 프롬프트와 요구를 한 덩어리로 만들어 준다. */
function packText() {
  const sys = systemFor().map(b => b.text).join('\n\n');
  const want = ak.prompt.trim() || '(여기에 무엇을 받고 싶은지 쓴다)';
  return `${sys}\n\n---\n\n${userText(want, ak.command.trim())}`;
}

function openPack() {
  $('#pack-ver').textContent = SCHEMA.ytdlp_version;
  $('#pack-text').value = packText();
  $('#dlg-pack').showModal();
}

function openKeyDialog() {
  $('#key-input').value = ak.key;
  $('#dlg-key').showModal();
}

/* ── 명령어 ↔ 그래프 ─────────────────────── */
/** 명령어를 그래프로 풀어 놓고 캔버스로 간다. */
function enterGraph() {
  if (ak.command.trim()) importCommand(ak.command);
  ui.view = 'graph';
  render();
  fitView();
}

/** 그래프에서 나오면 다시 문자열로 접는다 — 원본은 늘 명령어다. */
function leaveGraph() {
  ak.command = commandString(state);
  ak.note = '';
  ui.view = 'ask';
  render();
}


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

/** 그래프 화면에만 있는 것들. 프롬프트 화면에서는 통째로 빠진다. */
function applyView() {
  const asking = ui.view === 'ask';
  $('#ask').hidden = !asking;
  $('.main').hidden = asking;
  $('.readout').hidden = asking;
  for (const id of ['pal-toggle', 'import', 'graph-io', 'reset', 'autolayout', 'autowire', 'fit'])
    $('#' + id).hidden = asking || (id === 'autowire' && !KIND().canAutowire);
  $('#field-q').hidden = asking || !KIND().search;
  $('#view-ask').setAttribute('aria-selected', String(asking));
  $('#view-graph').setAttribute('aria-selected', String(!asking));
}

function render() {
  applyView();
  if (ui.view === 'ask') { renderTpl(askTemplate(), $('#ask')); save(); return; }

  KIND().sync();
  renderCrumb();
  syncCanvas().then(focusPicker);      // 캔버스는 Rete 가 그린다 — 우리는 맞추기만
  renderHint(); renderCmd(); renderPalette(); save();
}

/* ══ 모드 전환 ═══════════════════════════════ */
function setMode(m) {
  if (m === ui.mode) return;
  ui.mode = m;
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

/* ── 명령어 ↔ 그래프 상호 강조 ───────────── */
$('#cmd').addEventListener('mouseover', e => {
  const t = e.target.closest('.tok[data-opt]');
  if (t) { ui.lit = t.dataset.opt; paintLit(); }
});
$('#cmd').addEventListener('mouseout', () => { ui.lit = null; paintLit(); });

/* ══ 역방향: 명령어 → 그래프 ═════════════════ */
function importCommand(text) {
  const { urls, picked, unknown, extras } = parseCommand(text);

  const keep = state.nodes.src.urls;
  resetState();
  state.nodes.src.urls = urls.length ? urls.join('\n') : keep;
  ui.unknown = unknown;
  // 그래프에 실을 자리는 없어도 명령어에는 남아야 한다 — 왕복에서 사라지면
  // "그래프에서 고치기"가 조용히 명령어를 깎는 셈이 된다.
  state.extras = extras;

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
    saveDraft(localStorage, { prompt: ak.prompt, command: ak.command, note: ak.note });
    saveHistory(localStorage, ak.history);
    try {
      localStorage.setItem(MODEL_STORE, ak.model);
      localStorage.setItem(VIEW_KEY, ui.view);
    } catch { /* 다음에 다시 고르면 된다 */ }
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

$('#view-ask').onclick = () => { if (ui.view !== 'ask') leaveGraph(); };
$('#view-graph').onclick = () => { if (ui.view !== 'graph') enterGraph(); };

$('#key-save').onclick = () => {
  ak.key = $('#key-input').value.trim();
  try { localStorage.setItem(KEY_STORE, ak.key); } catch { /* 저장 못 해도 이번 세션은 쓴다 */ }
  $('#dlg-key').close(); render();
};
$('#key-clear').onclick = () => {
  ak.key = ''; $('#key-input').value = '';
  try { localStorage.removeItem(KEY_STORE); } catch { /* 없으면 그만 */ }
  $('#dlg-key').close(); render();
};
$('#pack-copy').onclick = e => copy($('#pack-text').value, e.target);

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
  if (ui.view === 'ask') return;        // 캔버스 단축키는 캔버스에서만
  if (e.key === '/' && !typing && KIND().search) { e.preventDefault(); $('#q').focus(); }
  if (e.key === 'Escape') {
    if (ui.picker) { ui.picker = null; render(); }
    else if (ui.sel) { ui.sel = null; render(); }
    else if (KIND().parent) setMode(KIND().parent);
    else leaveGraph();                  // 파이프라인에서 한 번 더 = 프롬프트로
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
  get view() { return KIND().viewOf(state); },
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
mountChrome();
const fresh = !load();
if (fresh) resetState();

// 프롬프트 화면의 저장물. 키와 모델은 그래프와 수명이 다르므로 따로 둔다.
try {
  ak.key = localStorage.getItem(KEY_STORE) || '';
  ak.model = localStorage.getItem(MODEL_STORE) || DEFAULT_MODEL;
} catch { /* 저장소가 막혀 있어도 이번 세션은 쓴다 */ }
ak.history = loadHistory(localStorage);
ui.view = loadView(localStorage);
const draft = loadDraft(localStorage);
if (draft) Object.assign(ak, draft);
// 저장된 그래프가 있는데 명령어가 비어 있으면 그래프에서 접어 온다 —
// 원본이 바뀌기 전에 만들어 둔 저장물이 그런 모양이다.
if (!ak.command.trim() && !fresh) ak.command = commandString(state);

render();
if (fresh) fitView();
