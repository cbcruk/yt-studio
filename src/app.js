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
  KO,
  OPTS,
  STAGE,
  STAGES,
  STAGE_ORDER,
  expand,
  initSchema,
  search,
  stageIdx,
} from './core/schema.js';
import { connect, disconnect, hasEdge, removeNode } from './core/graph.js';
import {
  EXIST_OPS,
  FKEYS,
  FKEY_TYPE,
  FORMAT_OPS,
  NUM_OPS,
  SELECTORS,
  SEL_HELP,
  SEL_SET,
  STR_OPS,
  emitTree,
  parseFormat,
} from './core/format-grammar.js';
import {
  FOUT,
  blankFormat,
  formatExpr,
  formatIssues,
  graphToTree,
  operands,
  treeToGraph,
} from './core/format-graph.js';
import {
  CONVERSIONS,
  FIELDS,
  FIELD_HELP,
  FIELD_SET,
  OUT_TYPES,
  STRF_PRESETS,
  emitPiece,
} from './core/output-template.js';
import {
  OOUT,
  blankOutput,
  outputExpr,
  outputIssues,
  outputPieces,
  outputPreview,
  piecesToGraph,
} from './core/output-graph.js';
import {
  PATH_TYPES,
  POUT,
  blankPaths,
  joinEntry,
  pathsExpr,
  pathsIssues,
  pathsToGraph,
} from './core/paths-graph.js';
import {
  blankPipeline,
  buildTokens,
  commandString,
  confString,
  livePath,
  parseCommand,
  quote,
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
  STAGE_ACCENT,
  accentOf,
  badgeOf,
  blurbOf,
  bodyOf,
  bypassLabelOf,
  defineBody,
  defineKind,
  hasIn,
  hasOut,
  isIO,
  labelOf,
  paletteItems,
  protectedIds,
  tagOf,
  tagOfType,
  widthOf,
  widthOfType,
} from './ui/node-kinds.js';
import {
  allGraphKinds,
  defineGraphBehavior,
  graphKind,
  subgraphFor,
} from './ui/graph-kinds.js';

/* ══ 스키마 파생 ═════════════════════════════ */
// 색인·검색·KO 사전은 core/schema.js 에 있다.
initSchema(SCHEMA);

const $ = s => document.querySelector(s);

const ACCENT = STAGE_ACCENT;   // 단계 색은 레지스트리가 갖는다
/* ══ 포맷 셀렉터 문법 ════════════════════════
   파서·컴파일러·어휘는 core/format-grammar.js,
   노드 종류의 표기·색·포트는 ui/node-kinds.js 에 있다. */
const FOP_TYPES = FORMAT_OPS;
/* ══ 그래프 상태 ═════════════════════════════ */
const NODE_W = 300, HEAD_H = 34;
const PROTECTED = protectedIds();   // 각 그래프의 고정 끝점

let state, view, seq;
const ui = {
  mode: 'pipeline', lit: null, sel: null, picker: null, composing: false,
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
const valuesOf = n => (n.values ||= {});
/** 렌더된 노드의 실제 높이. 레이아웃 계산에 넘겨 준다. */
const measuredHeight = id => {
  const el = document.querySelector(`.node[data-id="${id}"]`);
  return el ? el.offsetHeight : 190;
};
const filtersOf = n => (n.filters ||= []);

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
/* ── 포맷 서브그래프 전용 ────────────────── */
// 트리 ↔ 그래프 변환과 문제 진단은 core/format-graph.js 에 있다.
const opsOf = id => operands(state.format, id);
const fmtIssues = () => formatIssues(state.format, tagOfType);
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
      if (!FOP_TYPES.includes(n.type)) continue;
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

/* ── 파이프라인 옵션 행 ──────────────────── */
function triControl(n, o) {
  const cur = valuesOf(n)[o.id];
  const tri = document.createElement('div');
  tri.className = 'tri';
  const states = o.negation
    ? [['켜기', true, o.flag], ['끄기', false, o.negation]]
    : [['켜기', true, o.flag]];
  for (const [label, val, tip] of states) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.title = tip;
    b.dataset.ctl = `tri:${o.id}:${val}`;
    b.setAttribute('aria-pressed', String(cur === val));
    b.onclick = () => { valuesOf(n)[o.id] = val; render(); };
    tri.append(b);
  }
  return tri;
}

function optRow(n, o) {
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.opt = o.id;
  const top = document.createElement('div');
  top.className = 'row-top';
  top.innerHTML = `<span class="row-flag">${o.flag}`
    + (o.short ? ` <span class="short">${o.short}</span>` : '') + `</span>`;

  // 값이 그 자체로 표현식인 옵션에는 서브그래프로 들어가는 문이 달린다.
  const sub = subgraphFor(o.id);
  if (sub) {
    const b = document.createElement('button');
    b.className = 'row-sub'; b.type = 'button';
    b.textContent = sub.opensFrom.label;
    b.title = sub.opensFrom.title;
    b.onclick = ev => { ev.stopPropagation(); enterSubgraph(sub.id); };
    top.append(b);
  }

  const x = document.createElement('button');
  x.className = 'row-x'; x.type = 'button'; x.textContent = '✕';
  x.title = '이 옵션 빼기';
  x.onclick = () => { delete valuesOf(n)[o.id]; render(); };
  top.append(x);
  row.append(top);

  if (o.help) {
    const h = document.createElement('div');
    h.className = 'row-help'; h.textContent = o.help; h.title = o.help;
    row.append(h);
  }

  const ctl = document.createElement('div');
  ctl.className = 'row-ctl';
  const cur = valuesOf(n)[o.id];

  if (o.kind === 'flag') {
    ctl.append(triControl(n, o));
  } else if (o.kind === 'choice') {
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="">(기본)</option>'
      + o.choices.map(c => `<option${c === cur ? ' selected' : ''}>${c}</option>`).join('');
    sel.dataset.ctl = `opt:${o.id}`;
    sel.onchange = () => { valuesOf(n)[o.id] = sel.value; render(); };
    ctl.append(sel);
  } else {
    const el = document.createElement(o.kind === 'repeatable' ? 'textarea' : 'input');
    if (o.kind !== 'repeatable') el.type = 'text';
    el.value = cur === undefined || cur === true || cur === false ? '' : cur;
    el.placeholder = o.kind === 'repeatable'
      ? (o.metavar || 'VALUE') + ' — 한 줄에 하나'
      : (o.metavar || (o.default != null ? String(o.default) : 'VALUE'));
    el.dataset.ctl = `opt:${o.id}`;
    el.oninput = () => { valuesOf(n)[o.id] = el.value; render(); };
    ctl.append(el);
  }
  row.append(ctl);

  row.onmouseenter = () => { ui.lit = o.id; paintLit(); };
  row.onmouseleave = () => { ui.lit = null; paintLit(); };
  return row;
}

function pickerList(n, q) {
  const vals = valuesOf(n);
  const pool = BY_STAGE[n.stage].filter(o => !(o.id in vals));
  return search(q, pool) || pool;
}
function renderPickerList(n, ul, q) {
  const hits = pickerList(n, q);
  ul.innerHTML = '';
  if (!hits.length) { ul.innerHTML = '<li class="none">남은 옵션이 없다.</li>'; return; }
  for (const o of hits.slice(0, 60)) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<div class="pf">${o.flag}${o.short ? ' <span class="short">' + o.short + '</span>' : ''}</div>`
      + `<div class="ph">${escapeHtml(o.help)}</div>`;
    b.onclick = () => {
      valuesOf(n)[o.id] = o.kind === 'flag' ? true : '';
      ui.picker = null;
      render();
    };
    li.append(b);
    ul.append(li);
  }
}

/* ── 포맷 노드 본문 ──────────────────────── */
function filterRow(n, f, idx) {
  const type = FKEY_TYPE[f.key] || 'str';
  const exists = f.op === 'has' || f.op === 'hasnot';
  const row = document.createElement('div');
  row.className = 'filt-row' + (exists ? ' exists' : '');

  const key = document.createElement('select');
  key.innerHTML = FKEYS.map(([k, ko]) =>
    `<option value="${k}"${k === f.key ? ' selected' : ''}>${ko}</option>`).join('');
  key.dataset.ctl = `filt:${idx}:key`;
  key.title = '필터 필드';
  key.onchange = () => {
    f.key = key.value;
    const t = FKEY_TYPE[f.key];
    const allowed = (t === 'num' ? NUM_OPS : STR_OPS).map(o => o[0]);
    if (!allowed.includes(f.op) && !['has', 'hasnot'].includes(f.op)) f.op = allowed[0];
    render();
  };

  const op = document.createElement('select');
  const opts = [...(type === 'num' ? NUM_OPS : STR_OPS), ...EXIST_OPS];
  op.innerHTML = opts.map(([v, ko]) =>
    `<option value="${v}"${v === f.op ? ' selected' : ''}>${ko}</option>`).join('');
  op.dataset.ctl = `filt:${idx}:op`;
  op.title = '비교 연산';
  op.onchange = () => { f.op = op.value; render(); };

  row.append(key, op);

  if (!exists) {
    const val = document.createElement('input');
    val.type = 'text';
    val.value = f.value || '';
    val.placeholder = type === 'num' ? '1080' : 'mp4';
    val.dataset.ctl = `filt:${idx}:val`;
    val.oninput = () => { f.value = val.value; render(); };

    // yt-dlp 의 '?' 는 필터마다 따로 붙는다 ([height<=?1080]). 노드가 아니라 행에 둔다.
    const q = document.createElement('label');
    q.className = 'filt-q';
    q.title = '이 필드 값을 모르는 포맷도 통과시킨다 (yt-dlp 의 ? 접미사)';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.ctl = `filt:${idx}:loose`;
    cb.checked = !!f.loose;
    cb.onchange = () => { f.loose = cb.checked; render(); };
    q.append(cb, document.createTextNode('?'));

    row.append(val, q);
  }

  const del = document.createElement('button');
  del.className = 'row-x'; del.type = 'button'; del.textContent = '✕';
  del.title = '필터 빼기';
  del.onclick = () => { filtersOf(n).splice(idx, 1); render(); };
  row.append(del);
  return row;
}

function streamBody(n, body) {
  const wrap = document.createElement('div');
  wrap.className = 'fsel';

  const custom = !SEL_SET.has(n.sel);
  const sel = document.createElement('select');
  sel.innerHTML = SELECTORS.map(([g, items]) =>
    `<optgroup label="${g}">` + items.map(([v]) =>
      `<option value="${v}"${v === n.sel ? ' selected' : ''}>${v}</option>`).join('') + '</optgroup>'
  ).join('') + `<option value="__custom"${custom ? ' selected' : ''}>(직접 입력 — 포맷 ID·확장자)</option>`;
  sel.dataset.ctl = 'sel';
  sel.title = '셀렉터';
  sel.onchange = () => {
    n.sel = sel.value === '__custom' ? '' : sel.value;
    render();
  };
  wrap.append(sel);

  if (custom) {
    const inp = document.createElement('input');
    inp.type = 'text'; inp.spellcheck = false;
    inp.value = n.sel || '';
    inp.placeholder = '137 · mp4 · 248 …';
    inp.dataset.ctl = 'sel-custom';
    inp.oninput = () => { n.sel = inp.value.trim(); render(); };
    wrap.append(inp);
  } else {
    const why = document.createElement('div');
    why.className = 'why';
    why.textContent = SEL_HELP[n.sel] || '';
    wrap.append(why);
  }
  body.append(wrap);

  const box = document.createElement('div');
  box.className = 'filt';
  const head = document.createElement('div');
  head.className = 'filt-head';
  head.innerHTML = '<span>필터</span>';
  const add = document.createElement('button');
  add.className = 'row-sub'; add.type = 'button'; add.textContent = '+ 필터';
  add.onclick = () => { filtersOf(n).push({ key:'height', op:'<=', value:'1080' }); render(); };
  head.append(add);
  box.append(head);

  filtersOf(n).forEach((f, i) => box.append(filterRow(n, f, i)));

  if (filtersOf(n).some(f => !['has', 'hasnot'].includes(f.op))) {
    box.insertAdjacentHTML('beforeend',
      '<div class="filt-loose"><b>?</b> = 이 값을 모르는 포맷도 통과</div>');
  }
  body.append(box);
}

function opBody(n, body) {
  const ins = opsOf(n.id);
  const box = document.createElement('div');
  box.className = 'ops';
  box.innerHTML = `<div>${blurbOf(n)} · 입력은 <b>세로 위치 순서</b>다.</div>`;
  if (!ins.length) {
    box.insertAdjacentHTML('beforeend', '<div class="warn">이어진 입력이 없다.</div>');
  } else {
    const ol = document.createElement('ol');
    for (const k of ins) {
      const li = document.createElement('li');
      li.textContent = emitTree(graphToTree(state.format, k.id)) || '(비어 있음)';
      ol.append(li);
    }
    box.append(ol);
    if (ins.length === 1) {
      box.insertAdjacentHTML('beforeend',
        `<div class="warn">입력이 하나뿐이라 <code>${tagOf(n)}</code> 는 그냥 통과된다.</div>`);
    }
  }
  body.append(box);
}

function foutBody(n, body) {
  const note = document.createElement('div');
  note.className = 'node-note';
  note.textContent = '여기 이어진 표현식이 --format 값이 된다.';
  const expr = document.createElement('div');
  expr.className = 'fout-expr';
  expr.id = 'fout-expr';
  expr.textContent = fmtExpr();
  body.append(note, expr);

  const issues = fmtIssues();
  if (issues.length) {
    const bad = document.createElement('div');
    bad.className = 'fout-issue';
    bad.id = 'fout-issue';
    bad.textContent = '· ' + issues.join('\n· ');
    bad.style.whiteSpace = 'pre-line';
    body.append(bad);
  }
}

/* ── 출력 템플릿 조각 본문 ───────────────── */

/** 글자 조각: 파일명에 그대로 들어가는 리터럴. */
function textBody(n, body) {
  const wrap = document.createElement('div');
  wrap.className = 'fsel';
  const inp = document.createElement('input');
  inp.type = 'text'; inp.spellcheck = false;
  inp.dataset.ctl = 'text';
  inp.value = n.text ?? '';
  inp.placeholder = '/  -  .';
  inp.oninput = () => { n.text = inp.value; render(); };
  const why = document.createElement('div');
  why.className = 'why';
  why.textContent = '구분자 · 경로 · 점.';
  wrap.append(inp, why);
  body.append(wrap);
}

/** 필드 조각: %(name>strf|fallback)fmt conv */
function fieldBody(n, body) {
  const wrap = document.createElement('div');
  wrap.className = 'fsel';

  const custom = !FIELD_SET.has(n.name);
  const sel = document.createElement('select');
  sel.dataset.ctl = 'field';
  sel.innerHTML = FIELDS.map(([g, items]) =>
    `<optgroup label="${g}">` + items.map(([v, ko]) =>
      `<option value="${v}"${v === n.name ? ' selected' : ''}>${v} — ${ko}</option>`).join('')
    + '</optgroup>').join('')
    + `<option value="__custom"${custom ? ' selected' : ''}>(직접 입력)</option>`;
  sel.title = '어떤 값을 꺼낼지';
  sel.onchange = () => { n.name = sel.value === '__custom' ? '' : sel.value; render(); };
  wrap.append(sel);

  if (custom) {
    const inp = document.createElement('input');
    inp.type = 'text'; inp.spellcheck = false;
    inp.dataset.ctl = 'field-custom';
    inp.value = n.name || '';
    inp.placeholder = 'tags.0 · release_date,upload_date …';
    inp.oninput = () => { n.name = inp.value.trim(); render(); };
    wrap.append(inp);
  } else {
    const why = document.createElement('div');
    why.className = 'why';
    why.textContent = FIELD_HELP[n.name] || '';
    wrap.append(why);
  }
  body.append(wrap);

  const box = document.createElement('div');
  box.className = 'filt';
  box.innerHTML = '<div class="filt-head"><span>다듬기</span></div>';

  const row = (label, el) => {
    const r = document.createElement('label');
    r.className = 'ofield-row';
    r.innerHTML = `<span>${label}</span>`;
    r.append(el);
    box.append(r);
  };

  // 날짜 서식 — 날짜 필드에서만 쓸모가 있으므로 프리셋으로 준다.
  const strf = document.createElement('select');
  strf.dataset.ctl = 'strf';
  const presets = STRF_PRESETS.slice();
  if (n.strf && !presets.some(([v]) => v === n.strf)) presets.push([n.strf, n.strf]);
  strf.innerHTML = presets.map(([v, ko]) =>
    `<option value="${escapeHtml(v)}"${v === (n.strf || '') ? ' selected' : ''}>${escapeHtml(ko)}</option>`).join('');
  strf.onchange = () => { n.strf = strf.value; render(); };
  row('날짜 서식', strf);

  // 값이 없을 때
  const fb = document.createElement('input');
  fb.type = 'text'; fb.spellcheck = false;
  fb.dataset.ctl = 'fallback';
  fb.value = n.fallback ?? '';
  fb.placeholder = '(그대로 두면 NA)';
  fb.oninput = () => { n.fallback = fb.value === '' ? null : fb.value; render(); };
  row('없을 때', fb);

  // 자릿수·자르기 — %(playlist_index)03d · %(title).40s
  const fmt = document.createElement('input');
  fmt.type = 'text'; fmt.spellcheck = false;
  fmt.dataset.ctl = 'fmt';
  fmt.value = n.fmt || '';
  fmt.placeholder = '03 · .40';
  fmt.title = '자릿수 채우기(03) 또는 길이 자르기(.40)';
  fmt.oninput = () => { n.fmt = fmt.value; render(); };
  row('자릿수·자르기', fmt);

  const conv = document.createElement('select');
  conv.dataset.ctl = 'conv';
  const convs = CONVERSIONS.slice();
  if (n.conv && !convs.some(([v]) => v === n.conv)) convs.push([n.conv, n.conv]);
  conv.innerHTML = convs.map(([v, ko]) =>
    `<option value="${v}"${v === (n.conv || 's') ? ' selected' : ''}>${ko}</option>`).join('');
  conv.onchange = () => { n.conv = conv.value; render(); };
  row('변환', conv);

  body.append(box);

  const out = document.createElement('div');
  out.className = 'why';
  out.style.marginTop = '6px';
  out.textContent = emitPiece({ t: 'field', name: n.name, strf: n.strf,
                                fallback: n.fallback, fmt: n.fmt, conv: n.conv });
  body.append(out);
}

/** -o 출력: TYPES 선택 + 완성된 문자열 + 미리보기. */
function ooutBody(n, body) {
  const wrap = document.createElement('div');
  wrap.className = 'fsel';
  const sel = document.createElement('select');
  sel.dataset.ctl = 'outtype';
  sel.innerHTML = OUT_TYPES.map(([v, ko]) =>
    `<option value="${v}"${v === (n.outType || '') ? ' selected' : ''}>${ko}</option>`).join('');
  sel.title = '어떤 종류의 파일에 적용할지';
  sel.onchange = () => { n.outType = sel.value; render(); };
  wrap.append(sel);
  body.append(wrap);

  const expr = document.createElement('div');
  expr.className = 'fout-expr';
  expr.id = 'oout-expr';
  expr.textContent = outExpr();
  const pv = document.createElement('div');
  pv.className = 'node-note';
  pv.style.paddingTop = '6px';
  pv.textContent = '미리보기 ' + (outputPreview(state.output) || '(비어 있음)');
  body.append(expr, pv);

  const issues = outputIssues(state.output, tagOfType);
  if (issues.length) {
    const bad = document.createElement('div');
    bad.className = 'fout-issue';
    bad.textContent = '· ' + issues.join('\n· ');
    bad.style.whiteSpace = 'pre-line';
    body.append(bad);
  }
}

/** 경로 항목: TYPES 선택 + 경로. */
function pathBody(n, body) {
  const wrap = document.createElement('div');
  wrap.className = 'fsel';
  const sel = document.createElement('select');
  sel.dataset.ctl = 'pathtype';
  sel.innerHTML = '<option value="">(지정 안 함 = home)</option>'
    + PATH_TYPES.map(([v, ko]) =>
        `<option value="${v}"${v === (n.pathType || '') ? ' selected' : ''}>${ko}</option>`).join('');
  sel.title = '어떤 종류의 파일을 어디에 둘지';
  sel.onchange = () => { n.pathType = sel.value; render(); };

  const inp = document.createElement('input');
  inp.type = 'text'; inp.spellcheck = false;
  inp.dataset.ctl = 'path';
  inp.value = n.path || '';
  inp.placeholder = '/downloads  ·  D:/videos';
  inp.oninput = () => { n.path = inp.value; render(); };

  const why = document.createElement('div');
  why.className = 'why';
  why.textContent = joinEntry({ type: n.pathType, path: n.path }) || '(비어 있음)';
  wrap.append(sel, inp, why);
  body.append(wrap);
}

/** -P 출력: 붙게 될 플래그들을 그대로 보여 준다. */
function poutBody(n, body) {
  const note = document.createElement('div');
  note.className = 'node-note';
  note.textContent = '이어진 항목마다 -P 가 하나씩 붙는다.';
  const expr = document.createElement('div');
  expr.className = 'fout-expr';
  expr.style.whiteSpace = 'pre-line';
  expr.textContent = pathExpr().split('\n').filter(Boolean).map(l => '-P ' + l).join('\n');
  body.append(note, expr);

  const issues = pathsIssues(state.paths, tagOfType);
  if (issues.length) {
    const bad = document.createElement('div');
    bad.className = 'fout-issue';
    bad.style.whiteSpace = 'pre-line';
    bad.textContent = '· ' + issues.join('\n· ');
    body.append(bad);
  }
}

/* ── 노드 본문 등록 ──────────────────────── */
// 노드 종류를 추가하려면 defineKind 한 줄과 defineBody 한 줄이면 된다.

defineBody('source', (n, body) => {
  const ta = document.createElement('textarea');
  ta.value = n.urls || '';
  ta.spellcheck = false;
  ta.placeholder = 'https://…  — 한 줄에 하나';
  ta.dataset.ctl = 'urls';
  ta.oninput = () => { n.urls = ta.value; render(); };
  const note = document.createElement('div');
  note.className = 'node-note';
  note.textContent = '명령어 맨 뒤에 붙는 대상 URL.';
  body.append(ta, note);
});

defineBody('sink', (n, body) => {
  const toks = tokensNow();
  const note = document.createElement('div');
  note.className = 'node-note';
  note.textContent = '여기까지 이어진 노드만 아래 명령어에 들어간다.';
  const stat = document.createElement('div');
  stat.className = 'sink-stat';
  stat.innerHTML = `<span>토큰 ${toks.length}</span>`
    + `<span>단계 ${new Set(toks.map(t => t.node)).size}</span>`
    + `<span>URL ${urlsNow().length}</span>`;
  body.append(note, stat);
});

defineBody('stage', (n, body) => {
  const vals = valuesOf(n);
  const rows = BY_STAGE[n.stage].filter(o => o.id in vals);
  if (!rows.length) {
    const note = document.createElement('div');
    note.className = 'node-note';
    note.textContent = blurbOf(n) + ' — 아직 고른 옵션이 없다.';
    body.append(note);
  }
  for (const o of rows) body.append(optRow(n, o));

  if (ui.picker && ui.picker.node === n.id) {
    const box = document.createElement('div');
    box.className = 'picker';
    const inp = document.createElement('input');
    inp.type = 'text'; inp.spellcheck = false;
    inp.placeholder = labelOf(n) + ' 옵션 검색…';
    inp.value = ui.picker.q;
    const ul = document.createElement('ul');
    inp.oninput = () => { ui.picker.q = inp.value; renderPickerList(n, ul, inp.value); };
    inp.onkeydown = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); ui.picker = null; render(); } };
    box.append(inp, ul);
    body.append(box);
    renderPickerList(n, ul, ui.picker.q);
    queueMicrotask(() => inp.focus());
  } else {
    const add = document.createElement('button');
    add.className = 'add'; add.type = 'button'; add.textContent = '+ 옵션';
    add.onclick = () => { ui.picker = { node:n.id, q:'' }; render(); };
    body.append(add);
  }
});

defineBody('stream', (n, body) => streamBody(n, body));
for (const type of FOP_TYPES) defineBody(type, (n, body) => opBody(n, body));
defineBody('fout', (n, body) => foutBody(n, body));
defineBody('text', (n, body) => textBody(n, body));
defineBody('field', (n, body) => fieldBody(n, body));
defineBody('oout', (n, body) => ooutBody(n, body));
defineBody('path', (n, body) => pathBody(n, body));
defineBody('pout', (n, body) => poutBody(n, body));

/* ── 노드 ────────────────────────────────── */
function headLabel(n) {
  const badge = bypassLabelOf(n);
  return `<span class="node-tag">[${tagOf(n)}]</span>`
       + `<span class="node-ko">${labelOf(n)}<span class="node-badge">${badge}</span></span>`;
}

function nodeEl(n, live) {
  const io = isIO(n);
  const el = document.createElement('div');
  el.className = 'node' + (io ? ' io' : '')
    + (live.has(n.id) ? '' : ' bypass') + (ui.sel === n.id ? ' sel' : '')
    + (n.collapsed ? ' collapsed' : '');
  el.dataset.id = n.id;
  el.style.setProperty('--a', accentOf(n));
  el.style.setProperty('--node-w', widthOf(n) + 'px');
  el.style.left = n.x + 'px';
  el.style.top = n.y + 'px';

  const head = document.createElement('div');
  head.className = 'node-head';
  head.innerHTML = headLabel(n) + `<span class="node-n" data-n="${setCount(n)}">${setCount(n)}</span>`;

  const toggle = () => {
    n.collapsed = !n.collapsed;
    if (ui.picker && ui.picker.node === n.id) ui.picker = null;
    render();
  };
  const fold = document.createElement('button');
  fold.className = 'node-x'; fold.type = 'button';
  fold.textContent = n.collapsed ? '▸' : '▾';
  fold.title = n.collapsed ? '펴기' : '접기';
  fold.onclick = ev => { ev.stopPropagation(); toggle(); };
  head.append(fold);

  if (!PROTECTED.has(n.id)) {
    const x = document.createElement('button');
    x.className = 'node-x'; x.type = 'button'; x.textContent = '✕';
    x.title = '노드 지우기';
    x.onclick = ev => { ev.stopPropagation(); dropNode(n.id); render(); };
    head.append(x);
  } else {
    head.append(document.createElement('span'));
  }
  head.title = blurbOf(n);
  head.ondblclick = toggle;
  el.append(head);

  const body = document.createElement('div');
  body.className = 'node-body';
  bodyOf(n.type)(n, body);          // 어떤 본문을 그릴지는 레지스트리가 안다

  if (!n.collapsed) el.append(body);

  if (hasInPort(n)) {
    const pin = document.createElement('span');
    pin.className = 'port in'; pin.dataset.node = n.id; pin.dataset.side = 'in';
    pin.title = '입력';
    el.append(pin);
  }
  if (hasOutPort(n)) {
    const pout = document.createElement('span');
    pout.className = 'port out'; pout.dataset.node = n.id; pout.dataset.side = 'out';
    pout.title = '출력 — 여기서 끌어다 다른 노드 입력에 놓아라';
    el.append(pout);
  }

  el.onpointerdown = () => { ui.sel = n.id; paintSel(); };
  return el;
}

/**
 * 노드를 id 로 짝지어 다시 그린다.
 *
 * 전에는 layer.innerHTML='' 로 전량 재생성했다. 그러면 입력 중 포커스가
 * 날아가므로 renderAfterEdit 라는 두 번째 렌더 경로가 따로 있었고, 파생
 * 표시를 추가할 때마다 양쪽에 손으로 등록해야 했다.
 *
 * 여기서 지키는 규칙은 둘이다.
 *   · data-ctl 로 같은 컨트롤을 찾아 포커스와 캐럿을 되돌려 놓는다.
 *   · 조합(IME) 중인 필드가 든 노드만 비켜 간다. 위치·상태만 갱신한다.
 */
// 한글 같은 조합 입력은 IME 가 필드 안에서 음절을 만드는 중이라, 그 사이에
// DOM 을 갈아엎으면 조합이 통째로 깨진다. 조합 중인 동안만 그 노드를 비켜 간다.
// (포커스 유무로 판단하면 같은 노드의 다른 컨트롤을 바꿔도 안 그려진다.)
addEventListener('compositionstart', () => { ui.composing = true; }, true);
addEventListener('compositionend', () => { ui.composing = false; }, true);

/** 다시 그리기 전에 어디에 포커스가 있었는지 적어 둔다. */
function captureFocus() {
  const el = document.activeElement;
  const node = el && el.closest ? el.closest('.node') : null;
  if (!node || !el.dataset || !el.dataset.ctl) return null;
  const spot = { node: node.dataset.id, ctl: el.dataset.ctl };
  if (typeof el.selectionStart === 'number') {
    spot.start = el.selectionStart;
    spot.end = el.selectionEnd;
  }
  return spot;
}
function restoreFocus(spot) {
  if (!spot) return;
  const el = document.querySelector(
    `.node[data-id="${spot.node}"] [data-ctl="${CSS.escape(spot.ctl)}"]`);
  if (!el || el === document.activeElement) return;
  el.focus();
  if (spot.start != null && typeof el.setSelectionRange === 'function') {
    try { el.setSelectionRange(spot.start, spot.end); } catch {}
  }
}

/** 다시 그리지 않고 넘어가는 노드에도 위치와 상태 클래스는 맞춰 준다. */
function touchNode(el, n, live) {
  el.style.left = n.x + 'px';
  el.style.top = n.y + 'px';
  el.classList.toggle('bypass', !live.has(n.id));
  el.classList.toggle('sel', ui.sel === n.id);
  const badge = el.querySelector('.node-n');
  if (badge) { badge.textContent = badgeOf(n); badge.dataset.n = badgeOf(n); }
}

function renderNodes() {
  const layer = $('#node-layer');
  const g = graph();
  const live = liveIds();
  const active = document.activeElement;
  const spot = captureFocus();
  const keep = new Set();

  for (const n of nodeList(g)) {
    keep.add(n.id);
    const el = layer.querySelector(`:scope > .node[data-id="${n.id}"]`);
    // 조합 중인 필드가 든 노드만 비켜 간다. 나머지는 다시 그리고 포커스를 되돌린다.
    if (el && ui.composing && el.contains(active)) { touchNode(el, n, live); continue; }
    const fresh = nodeEl(n, live);
    if (el) layer.replaceChild(fresh, el);
    else layer.append(fresh);
  }
  for (const el of [...layer.children]) if (!keep.has(el.dataset.id)) el.remove();

  restoreFocus(spot);

  const hint = $('#hint');
  hint.hidden = !KIND().isEmpty(g);
  hint.innerHTML = `<div>${KIND().emptyHint}</div>`;
}

function renderPalette() {
  const list = $('#pal-list');
  const mode = ui.mode;
  list.innerHTML = '';
  $('#pal-head').textContent = KIND().palette.head;
  $('#pal-hint').innerHTML = KIND().palette.hint;
  $('#autowire').hidden = !KIND().canAutowire;

  // 항목도, 표기도, 색도 전부 레지스트리에서 나온다.
  for (const item of paletteItems(mode, STAGES)) {
    const placed = item.kind === 'stage' ? stageOf(item.key) : null;
    const n = placed ? setCount(placed) : 0;
    const b = document.createElement('button');
    b.className = 'pal-item' + (placed ? ' placed' : '');
    b.type = 'button';
    b.dataset.key = item.key;
    if (item.kind === 'stage') b.dataset.stage = item.key;
    else b.dataset.fnode = item.key;
    b.style.setProperty('--a', item.accent);
    b.title = item.blurb + (placed ? ' · 이미 캔버스에 있다' : '');
    b.innerHTML = `<span class="dot"></span>`
      + `<span class="tag">[<b>${item.tag}</b>]<span class="ko">${item.label}</span></span>`
      + (n ? `<span class="n">${n}</span>` : '<span></span>');
    list.append(b);
  }
}

function escapeHtml(t) {
  return String(t).replace(/[&<>]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[c]));
}
function highlight(text, terms) {
  let html = escapeHtml(text);
  for (const t of terms) {
    if (!t) continue;
    html = html.replace(new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>');
  }
  return html;
}

function renderHits() {
  const box = $('#hits');
  const q = $('#q').value;
  const hits = KIND().search ? search(q) : null;
  if (!hits) { box.hidden = true; box.innerHTML = ''; return; }
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean).flatMap(expand);
  box.hidden = false;
  box.innerHTML = `<div class="hits-head">${hits.length}개 일치 · 고르면 해당 단계 노드에 들어간다</div>`;
  for (const o of hits.slice(0, 80)) {
    const holder = stageOf(o.stage);
    const on = holder && o.id in valuesOf(holder);
    const b = document.createElement('button');
    b.className = 'hit'; b.type = 'button';
    b.innerHTML = `<span><span class="hit-flag">${highlight(o.flag, terms)}`
      + (o.short ? ` <span class="short">${o.short}</span>` : '') + `</span>`
      + `<span class="hit-help">${highlight(o.help, terms)}</span></span>`
      + (on ? `<span class="hit-on">✓ 배치됨</span>`
            : `<span class="hit-stage" style="color:${ACCENT[o.stage]}">${o.stage}</span>`);
    b.onclick = () => {
      const n = addStageNode(o.stage, ...centerSpot());
      valuesOf(n)[o.id] = o.kind === 'flag' ? true : '';
      $('#q').value = ''; renderHits();
      render();
      focusNode(n.id);
    };
    box.append(b);
  }
}

function renderCmd() {
  const box = $('#cmd');
  const toks = tokensNow();
  box.innerHTML = '';
  box.append(Object.assign(document.createElement('span'), { className:'prompt', textContent:'$ ' }));
  box.append(Object.assign(document.createElement('span'), { textContent:'yt-dlp' }));
  for (const t of toks) {
    box.append(document.createTextNode(' '));
    const el = document.createElement('span');
    el.className = 'tok' + (ui.lit === t.opt.id ? ' lit' : '');
    el.dataset.opt = t.opt.id;
    el.dataset.node = t.node;
    el.textContent = t.text;
    el.title = t.opt.flag + ' — [' + t.opt.stage + '] ' + STAGE[t.opt.stage].label + ' 노드';
    box.append(el);
  }
  for (const u of urlsNow()) {
    box.append(document.createTextNode(' '));
    box.append(Object.assign(document.createElement('span'), { className:'tok url', textContent: quote(u) }));
  }

  const n = $('#notes');
  const parts = [];
  if (ui.unknown.length) parts.push('<b>읽지 못한 토큰:</b> ' + ui.unknown.map(escapeHtml).join(' · '));
  if (ui.fmtWarn) parts.push('<b>' + escapeHtml(ui.fmtWarn) + '</b>');

  // 무엇을 보고할지는 그래프 종류가 안다. 본문은 사용자 문자열일 수 있으니 이스케이프한다.
  for (const note of KIND().statusNotes(graph(), { tokens: toks, unknown: ui.unknown })) {
    parts.push((note.label ? `<b>${escapeHtml(note.label)}:</b> ` : '') + escapeHtml(note.body));
  }
  n.innerHTML = parts.join(' · ');
}

function renderCrumb() {
  const k = KIND();
  const c = $('#crumb');
  c.hidden = !k.chrome.crumb;
  $('#field-q').hidden = !k.search;
  $('#viewport').classList.toggle('sub', !!k.chrome.sub);
  if (!k.chrome.crumb) return;
  c.style.setProperty('--fmt', ACCENT.format);
  c.querySelector('.here').firstChild.textContent = k.label + ' ';
  const detail = k.crumbDetail ? k.crumbDetail(state) : '';
  $('#crumb-expr').textContent = detail ? '· ' + detail : '';
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
  if (!confirm('파이프라인과 포맷 서브그래프를 전부 지운다. 계속할까?')) return;
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

let noteTimer = null;
function flashNote(msg) {
  $('#notes').innerHTML = '<b>' + escapeHtml(msg) + '</b>';
  clearTimeout(noteTimer);
  noteTimer = setTimeout(renderCmd, 2200);
}

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
