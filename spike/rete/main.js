/**
 * 스파이크 — 파이프라인 캔버스를 Rete.js + lit 로 갈아 끼워 본다.
 *
 * 재는 것은 셋이다.
 *
 *   1. 노드 본문 13종(src/ui/bodies.js)을 고치지 않고 쓸 수 있는가
 *   2. 위치가 뜻을 갖는 규칙(x 좌표 = 플래그 순서)을 얹을 수 있는가
 *   3. 우리 state 를 원본으로 두고 Rete 를 뷰로만 쓸 수 있는가
 *
 * core/ 와 ui/ 는 본 앱의 것을 그대로 import 한다 — 복사본을 만들면 "맞는다"는
 * 답이 거짓이 되므로.
 */
import { NodeEditor, ClassicPreset } from 'rete';
import { AreaPlugin, AreaExtensions } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { LitPlugin, Presets as LitPresets } from '@retejs/lit-plugin';
import { LitElement, css, html } from 'lit';

import rawSchema from '../../schema.json';
import { initSchema, BY_STAGE, OPTS, STAGES } from '../../src/core/schema.js';
import { connect, disconnect, valuesOf } from '../../src/core/graph.js';
import {
  blankPipeline, buildTokens, commandString, pipelineLive, stageNode, urlList,
} from '../../src/core/pipeline.js';
import { blankFormat } from '../../src/core/format-graph.js';
import { blankOutput } from '../../src/core/output-graph.js';
import { blankPaths } from '../../src/core/paths-graph.js';
import { installBodies } from '../../src/ui/bodies.js';
import {
  accentOf, badgeOf, blurbOf, bodyOf, bypassLabelOf, hasIn, hasOut, isIO,
  labelOf, protectedIds, tagOf, widthOf,
} from '../../src/ui/node-kinds.js';

import '../../src/app.css';
import './spike.css';

initSchema(rawSchema);

/* ══ 앱 상태 — 본 앱과 같은 모양 ══════════════ */
const state = Object.assign(blankPipeline(),
  { format: blankFormat(), output: blankOutput(), paths: blankPaths() });
state.nodes.src.urls = 'https://youtu.be/spike';
let seq = 1;
const nid = () => 'n' + (seq++);
const PROTECTED = protectedIds();
const ui = { mode: 'pipeline', lit: null, sel: null, picker: null, unknown: [], fmtWarn: '' };

/** 본문이 앱에서 받아 가는 다섯 가지. 본 앱과 같은 계약이다. */
installBodies({
  state: () => state,
  ui,
  render: () => refresh(),
  enterSubgraph: () => report('서브그래프는 이 스파이크 밖이다'),
  paintLit: () => {},
});

function addStage(sid, x, y) {
  const found = stageNode(state, sid);
  if (found) return found;
  const n = { id: nid(), type: 'stage', stage: sid, x, y, values: {} };
  state.nodes[n.id] = n;
  return n;
}

/* ══ Rete ════════════════════════════════════ */
const socket = new ClassicPreset.Socket('flow');
const editor = new NodeEditor();
const area = new AreaPlugin(document.querySelector('#viewport'));
const connection = new ConnectionPlugin();
const render = new LitPlugin();

editor.use(area);
area.use(connection);
area.use(render);
connection.addPreset(ConnectionPresets.classic.setup());

/** Rete 노드 ↔ 우리 노드. id 를 그대로 쓴다. */
const reteNodes = new Map();
const ours = id => state.nodes[id];

/**
 * 노드 하나.
 *
 * 플러그인의 렌더러는 슬롯의 첫 엘리먼트에 프로퍼티를 꽂고 requestUpdate() 를
 * 부른다. 그래서 커스텀 노드는 "템플릿"이 아니라 **LitElement 하나**여야 한다
 * — 평범한 <div> 를 돌려주면 app.requestUpdate is not a function 으로 죽는다.
 *
 * 그 껍데기 안쪽은 본 앱 그대로다. bodyOf(n.type)(n) 을 고치지 않고 부른다.
 */
class YtNode extends LitElement {
  static properties = { data: {}, emit: {} };
  createRenderRoot() { return this; }        // 그림자 DOM 을 안 쓴다 → app.css 가 그대로 먹는다

  render() {
    const rn = this.data;
    const n = ours(rn.id);
    if (!n) return null;
    const live = pipelineLive(state);
    const cls = 'node' + (isIO(n) ? ' io' : '') + (live.has(n.id) ? '' : ' bypass');
    const badge = badgeOf(n);
    const stop = e => e.stopPropagation();     // 본문 위에서는 드래그가 시작되면 안 된다
    return html`
      <div class=${cls} style=${`--a:${accentOf(n)};--node-w:${widthOf(n)}px`} data-id=${n.id}>
        <div class="node-head" title=${blurbOf(n)}>
          <span class="node-tag">[${tagOf(n)}]</span>
          <span class="node-ko">${labelOf(n)}<span class="node-badge">${bypassLabelOf(n)}</span></span>
          <span class="node-n" data-n=${badge}>${badge}</span>
          <button class="node-x" type="button" title="옵션 하나 넣기"
                  @pointerdown=${stop} @click=${() => pickOption(n)}>+</button>
          ${PROTECTED.has(n.id) ? html`<span></span>` : html`
            <button class="node-x" type="button" title="노드 지우기"
                    @pointerdown=${stop} @click=${() => dropNode(n.id)}>✕</button>`}
        </div>

        <!-- 본 앱의 본문을 그대로 부른다. 고친 곳이 없다. -->
        <div class="node-body" @pointerdown=${stop}>${bodyOf(n.type)(n)}</div>

        ${hasIn(n) ? html`
          <span class="port in"><rete-ref .emit=${this.emit} .data=${{
            type: 'socket', side: 'input', key: 'in', nodeId: rn.id,
            payload: rn.inputs.in.socket,
          }}></rete-ref></span>` : ''}
        ${hasOut(n) ? html`
          <span class="port out"><rete-ref .emit=${this.emit} .data=${{
            type: 'socket', side: 'output', key: 'out', nodeId: rn.id,
            payload: rn.outputs.out.socket,
          }}></rete-ref></span>` : ''}
      </div>`;
  }
}
customElements.define('yt-node', YtNode);

/**
 * 와이어.
 *
 * 노드와 달리 연결은 플러그인의 <rete-connection-wrapper> 안에서 그려지는데,
 * 그 래퍼가 그림자 DOM 을 쓴다. 그래서 app.css 가 못 닿는다 — 와이어 스타일은
 * 컴포넌트가 직접 들고 있어야 한다. (노드는 우리가 light DOM 으로 만들어서
 * app.css 가 그대로 먹는다.)
 */
class YtWire extends LitElement {
  static properties = { path: {} };
  static styles = css`
    svg { position: absolute; overflow: visible; width: 1px; height: 1px; pointer-events: none; }
    path { fill: none; stroke: #8A8F8B; stroke-width: 2; pointer-events: auto; }
  `;
  render() { return html`<svg><path d=${this.path}></path></svg>`; }
}
customElements.define('yt-wire', YtWire);

render.addPreset(LitPresets.classic.setup({
  customize: {
    node: data => ({ emit }) => html`<yt-node .data=${data.payload} .emit=${emit}></yt-node>`,
    connection: () => ({ path }) => html`<yt-wire .path=${path}></yt-wire>`,
  },
}));

AreaExtensions.selectableNodes(area, AreaExtensions.selector(), {
  accumulating: AreaExtensions.accumulateOnCtrl(),
});

/* ══ state → Rete ════════════════════════════ */
/**
 * 처음 그래프를 세울 때는 Rete 가 내는 이벤트를 state 로 되돌려 쓰면 안 된다.
 * state 에 이미 있는 엣지를 "새로 이었다"로 받아 connect() 가 false 를 내고,
 * 그걸 사용자 조작으로 오해해 방금 만든 연결을 도로 지워 버린다.
 * 라이브러리를 뷰로 쓸 때 반드시 생기는 이음매다.
 */
let syncing = false;

async function build() {
  syncing = true;
  for (const n of Object.values(state.nodes)) {
    const rn = new ClassicPreset.Node(labelOf(n));
    rn.id = n.id;                                  // id 를 우리 것으로 강제
    if (hasIn(n)) rn.addInput('in', new ClassicPreset.Input(socket, '', true));
    if (hasOut(n)) rn.addOutput('out', new ClassicPreset.Output(socket, '', true));
    await editor.addNode(rn);
    await area.translate(rn.id, { x: n.x, y: n.y });
    reteNodes.set(n.id, rn);
  }
  for (const e of state.edges) {
    const a = reteNodes.get(e.from), b = reteNodes.get(e.to);
    if (a && b) await editor.addConnection(new ClassicPreset.Connection(a, 'out', b, 'in'));
  }
  syncing = false;
}

/* ══ Rete → state ════════════════════════════
   Rete 가 그래프를 갖고 있지만 컴파일의 원본은 우리 state 다.
   그래서 Rete 쪽 변화를 전부 state 로 되돌려 쓴다. */
editor.addPipe(ctx => {
  if (syncing) return ctx;
  if (ctx.type === 'connectioncreated') {
    const { source, target } = ctx.data;
    if (!connect(state, source, target, { exclusiveIn: new Set() })) {
      report('이을 수 없다 — 순환이거나 이미 있다');
      queueMicrotask(() => editor.removeConnection(ctx.data.id));
    }
    refresh();
  }
  if (ctx.type === 'connectionremoved') {
    disconnect(state, ctx.data.source, ctx.data.target);
    refresh();
  }
  if (ctx.type === 'noderemoved') {
    delete state.nodes[ctx.data.id];
    refresh();
  }
  return ctx;
});

// 위치가 뜻을 갖는다 — 끌어 놓을 때마다 x 를 state 로 되돌려 쓰고 다시 조립한다.
area.addPipe(ctx => {
  if (ctx.type === 'nodetranslated') {
    const n = ours(ctx.data.id);
    if (n) { n.x = Math.round(ctx.data.position.x); n.y = Math.round(ctx.data.position.y); }
    renderCmd();
  }
  return ctx;
});

/* ══ 조작 ════════════════════════════════════ */
async function dropNode(id) {
  if (PROTECTED.has(id)) return;
  for (const c of editor.getConnections())
    if (c.source === id || c.target === id) await editor.removeConnection(c.id);
  await editor.removeNode(id);
}

/** 피커 전체는 스파이크 밖이다. 그 단계의 첫 옵션을 넣어 본문이 도는지만 본다. */
function pickOption(n) {
  const pool = BY_STAGE[n.stage].filter(o => !(o.id in valuesOf(n)));
  if (!pool.length) return;
  const o = pool[0];
  valuesOf(n)[o.id] = o.kind === 'flag' ? true : '';
  refresh();
}

/* ══ 다시 그리기 ═════════════════════════════ */
function renderCmd() {
  document.querySelector('#cmd').textContent = '$ ' + commandString(state);
  const toks = buildTokens(state);
  const live = pipelineLive(state);
  const bypassed = Object.values(state.nodes)
    .filter(n => n.type === 'stage' && !live.has(n.id)).map(n => `[${n.stage}]`);
  document.querySelector('#notes').textContent =
    `토큰 ${toks.length} · URL ${urlList(state).length}`
    + (bypassed.length ? ` · 우회 중: ${bypassed.join(' ')}` : '');
}

/** 본문이 값을 바꾸면 그 노드만 다시 그린다. */
async function refresh() {
  for (const id of reteNodes.keys()) await area.update('node', id);
  renderCmd();
}

function report(msg) { document.querySelector('#report').textContent = msg; }

/* ══ 시작 ════════════════════════════════════ */
document.querySelector('#ver').textContent =
  `rete + lit · 옵션 ${OPTS.length} · 단계 ${STAGES.length}`;

const fmt = addStage('format', 380, 60);
state.edges.push({ from: 'src', to: fmt.id }, { from: fmt.id, to: 'out' });
valuesOf(fmt).format = 'bv*[height<=1080]+ba/b';

document.querySelector('#add').onclick = async () => {
  const sid = ['process', 'store', 'connect'].find(s => !stageNode(state, s));
  if (!sid) return;
  const n = addStage(sid, 380, 420);
  const rn = new ClassicPreset.Node(labelOf(n));
  rn.id = n.id;
  rn.addInput('in', new ClassicPreset.Input(socket, '', true));
  rn.addOutput('out', new ClassicPreset.Output(socket, '', true));
  await editor.addNode(rn);
  await area.translate(rn.id, { x: n.x, y: n.y });
  reteNodes.set(n.id, rn);
  renderCmd();
};
document.querySelector('#fit').onclick = () => AreaExtensions.zoomAt(area, editor.getNodes());

build().then(async () => {
  // 소켓 위치는 DOM 을 재서 구한다. 개발 서버에서는 CSS 가 JS 로 나중에 꽂히므로
  // 첫 측정 때 포트가 0×0 이라 와이어가 안 그려질 수 있다. 한 프레임 뒤에 제자리로
  // 다시 옮겨 재측정을 시킨다. (배포는 <style> 이 head 에 먼저 있어 안 생기는 문제다.)
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  for (const [id, n] of [...reteNodes].map(([id]) => [id, ours(id)]))
    if (n) await area.translate(id, { x: n.x, y: n.y });

  AreaExtensions.zoomAt(area, editor.getNodes());
  renderCmd();
  report('노드 본문은 src/ui/bodies.js 를 그대로 쓴다. 노드를 끌면 x 순서가 플래그 순서에 반영된다.');
});

window.__spike = { state, editor, area, refresh };
