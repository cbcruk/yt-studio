/**
 * 캔버스 — Rete.js 어댑터.
 *
 * 팬·줌·노드 드래그·포트 드래그로 잇기·와이어 경로 계산은 Rete 가 한다.
 * 이 파일이 하는 일은 그 위에 우리 의미론을 얹는 것뿐이다.
 *
 * **state 가 원본이고 Rete 는 뷰다.** Rete 가 이벤트를 내면 우리 그래프를
 * 고치고, 그 결과로 Rete 를 다시 맞춘다(sync). 반대 방향은 없다. 그래서
 * "이어도 되는가"(순환·중복·입력 하나만 받는 노드) 같은 규칙은 전부 예전처럼
 * core/graph.js 가 정하고, Rete 는 그 결정에 따라온다.
 *
 * 앱에서 받아 오는 것은 installCanvas 로 넘기는 아홉 가지다.
 */
import { ClassicPreset, NodeEditor } from 'rete';
import { AreaExtensions, AreaPlugin } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { LitPlugin, Presets as LitPresets } from '@retejs/lit-plugin';
import { LitElement, css, html } from 'lit';

import {
  accentOf, badgeOf, blurbOf, bodyOf, bypassLabelOf, hasIn, hasOut, isIO,
  labelOf, protectedIds, tagOf, widthOf,
} from './node-kinds.js';

/* ══ 앱에서 받아 오는 것 ══════════════════════ */
const H = {
  graph: () => ({ nodes: {}, edges: [] }),   // 지금 편집 중인 그래프
  kind: () => ({}),                          // 그 그래프의 종류 서술자
  live: () => new Set(),                     // 살아 있는 노드
  ui: {},                                    // 편집 중인 UI 상태 (sel · lit)
  view: () => ({ x: 0, y: 0, k: 1 }),        // 그래프마다 따로인 화면 변환
  wire: () => false,                         // 이어라 — 되는지는 core 가 정한다
  unwire: () => {},
  dropNode: () => {},
  redraw: () => {},                          // 전체 렌더
  note: () => {},                            // 잠깐 띄우는 알림
};

export function installCanvas(host) { Object.assign(H, host); }

const PROTECTED = protectedIds();
const socket = new ClassicPreset.Socket('flow');
let editor = null, area = null, applying = false;

/* ══ 노드 ════════════════════════════════════
   플러그인의 렌더러가 슬롯의 첫 엘리먼트에 프로퍼티를 꽂고 requestUpdate() 를
   부른다. 그래서 노드는 템플릿이 아니라 LitElement 여야 한다. 그림자 DOM 은
   쓰지 않는다 — app.css 가 그대로 닿아야 하므로. */
class YtNode extends LitElement {
  static properties = { data: {}, emit: {} };
  createRenderRoot() { return this; }

  render() {
    const rn = this.data;
    const n = H.graph().nodes[rn.id];
    if (!n) return null;
    const live = H.live();
    const cls = 'node' + (isIO(n) ? ' io' : '') + (live.has(n.id) ? '' : ' bypass')
      + (H.ui.sel === n.id ? ' sel' : '') + (n.collapsed ? ' collapsed' : '');
    const badge = badgeOf(n);
    const stop = e => e.stopPropagation();
    const toggle = () => {
      n.collapsed = !n.collapsed;
      if (H.ui.picker && H.ui.picker.node === n.id) H.ui.picker = null;
      H.redraw();
    };

    return html`
      <div class=${cls} data-id=${n.id}
           style=${`--a:${accentOf(n)};--node-w:${widthOf(n)}px`}
           @pointerdown=${() => { H.ui.sel = n.id; H.redraw(); }}>
        <div class="node-head" title=${blurbOf(n)} @dblclick=${toggle}>
          <span class="node-tag">[${tagOf(n)}]</span>
          <span class="node-ko">${labelOf(n)}<span class="node-badge">${bypassLabelOf(n)}</span></span>
          <span class="node-n" data-n=${badge}>${badge}</span>
          <button class="node-x" type="button" title=${n.collapsed ? '펴기' : '접기'}
                  @pointerdown=${stop} @click=${toggle}>${n.collapsed ? '▸' : '▾'}</button>
          ${PROTECTED.has(n.id) ? html`<span></span>` : html`
            <button class="node-x" type="button" title="노드 지우기"
                    @pointerdown=${stop}
                    @click=${() => { H.dropNode(n.id); H.redraw(); }}>✕</button>`}
        </div>

        ${n.collapsed ? '' : html`
          <div class="node-body" @pointerdown=${stop}>${bodyOf(n.type)(n)}</div>`}

        ${hasIn(n) ? html`
          <span class="port in" title="입력"><rete-ref .emit=${this.emit} .data=${{
            type: 'socket', side: 'input', key: 'in', nodeId: rn.id,
            payload: rn.inputs.in.socket,
          }}></rete-ref></span>` : ''}
        ${hasOut(n) ? html`
          <span class="port out" title="출력 — 여기서 끌어다 다른 노드 입력에 놓아라"
          ><rete-ref .emit=${this.emit} .data=${{
            type: 'socket', side: 'output', key: 'out', nodeId: rn.id,
            payload: rn.outputs.out.socket,
          }}></rete-ref></span>` : ''}
      </div>`;
  }
}
customElements.define('yt-node', YtNode);

/* ══ 와이어 ══════════════════════════════════
   노드와 달리 연결은 플러그인의 래퍼가 그림자 DOM 안에서 그린다. 그래서
   app.css 가 못 닿고, 스타일을 컴포넌트가 직접 들어야 한다. */
class YtWire extends LitElement {
  static properties = { path: {}, accent: {}, dead: {}, ordinal: {}, onCut: {} };
  static styles = css`
    svg { position: absolute; overflow: visible; width: 1px; height: 1px; pointer-events: none; }
    .hit { fill: none; stroke: transparent; stroke-width: 16; pointer-events: auto; cursor: pointer; }
    .wire { fill: none; stroke-width: 2; pointer-events: none; }
    .dead { stroke: #C9CCC9; stroke-dasharray: 5 5; }
    text { font: 500 10px ui-monospace, monospace; fill: #8A8F8B; pointer-events: none; }
  `;
  render() {
    const end = /([-\d.]+)[, ]([-\d.]+)\s*$/.exec(this.path || '');
    return html`
      <svg>
        <path class="hit" d=${this.path} @pointerdown=${e => { e.stopPropagation(); this.onCut(); }}>
          <title>클릭해서 연결 끊기</title>
        </path>
        <path class=${'wire' + (this.dead ? ' dead' : '')} d=${this.path}
              style=${this.dead ? '' : `stroke:${this.accent}`}></path>
        ${this.ordinal && end ? html`
          <text x=${+end[1] - 16} y=${+end[2] - 6} text-anchor="end">${this.ordinal}</text>` : ''}
      </svg>`;
  }
}
customElements.define('yt-wire', YtWire);

/* ══ 세우기 ══════════════════════════════════ */
export function mountCanvas(container) {
  editor = new NodeEditor();
  area = new AreaPlugin(container);
  const connection = new ConnectionPlugin();
  const render = new LitPlugin();

  editor.use(area);
  area.use(connection);
  area.use(render);
  connection.addPreset(ConnectionPresets.classic.setup());

  render.addPreset(LitPresets.classic.setup({
    customize: {
      node: data => ({ emit }) => html`<yt-node .data=${data.payload} .emit=${emit}></yt-node>`,
      connection: data => ({ path }) => {
        const { source, target } = data.payload;
        const g = H.graph(), live = H.live();
        return html`<yt-wire data-from=${source} data-to=${target}
                             .path=${path} .dead=${!(live.has(source) && live.has(target))}
                             .accent=${g.nodes[source] ? accentOf(g.nodes[source]) : '#8A8F8B'}
                             .ordinal=${ordinalOf(source, target)}
                             .onCut=${() => { H.unwire(source, target); H.redraw(); }}></yt-wire>`;
      },
    },
  }));

  // Rete → 우리 그래프. 규칙은 core 가 정하므로 여기서는 넘기기만 한다.
  editor.addPipe(ctx => {
    if (applying) return ctx;
    if (ctx.type === 'connectioncreated') {
      const { source, target } = ctx.data;
      if (!H.wire(source, target)) H.note('이을 수 없다 — 이미 이어져 있거나 순환이 된다.');
      H.redraw();
      return;                                   // 반영은 sync 가 한다
    }
    return ctx;
  });

  // 위치가 뜻을 갖는다 — 끌어 놓을 때마다 그래프에 되돌려 쓰고 다시 조립한다.
  area.addPipe(ctx => {
    if (ctx.type === 'nodetranslated' && !applying) {
      const n = H.graph().nodes[ctx.data.id];
      if (n) { n.x = Math.round(ctx.data.position.x); n.y = Math.round(ctx.data.position.y); }
      H.redraw();
    }
    if ((ctx.type === 'translated' || ctx.type === 'zoomed') && !applying) {
      Object.assign(H.view(), area.area.transform);
      zoomLabel();
    }
    return ctx;
  });
}

/** 피연산자 순서가 뜻을 갖는 그래프에서만 와이어에 번호를 붙인다. */
function ordinalOf(from, to) {
  const k = H.kind();
  if (!k.wireOrdinals || !k.operandsOf) return 0;
  const ins = k.operandsOf(H.graph(), to);
  const i = ins.findIndex(n => n.id === from);
  return ins.length > 1 && i >= 0 ? i + 1 : 0;
}

/* ══ 그래프 → 캔버스 ═════════════════════════
   더하고 빼고 옮기기만 한다. 남는 노드의 DOM 은 그대로 살아 있다. */

/**
 * 맞추기는 비동기고, render() 는 연달아 불린다(정렬은 세 번 부른다).
 * 겹쳐서 돌면 같은 노드를 두 번 만들어 화면이 겹친다. 한 줄로 세우고,
 * 이미 예약된 것이 있으면 거기 합친다.
 */
let queue = Promise.resolve(), pending = false;

export function syncCanvas() {
  if (pending) return queue;
  pending = true;
  queue = queue.then(() => { pending = false; return reconcile(); }).catch(() => {});
  return queue;
}

async function reconcile() {
  if (!editor) return;
  applying = true;
  const g = H.graph();

  const want = new Set(Object.keys(g.nodes));
  for (const rn of editor.getNodes())
    if (!want.has(rn.id)) {
      for (const c of editor.getConnections())
        if (c.source === rn.id || c.target === rn.id) await editor.removeConnection(c.id);
      await editor.removeNode(rn.id);
    }

  const have = new Map(editor.getNodes().map(n => [n.id, n]));
  for (const n of Object.values(g.nodes)) {
    if (!have.has(n.id)) {
      const rn = new ClassicPreset.Node(labelOf(n));
      rn.id = n.id;
      if (hasIn(n)) rn.addInput('in', new ClassicPreset.Input(socket, '', true));
      if (hasOut(n)) rn.addOutput('out', new ClassicPreset.Output(socket, '', true));
      await editor.addNode(rn);
      have.set(n.id, rn);
    }
    const view = area.nodeViews.get(n.id);
    if (view && (view.position.x !== n.x || view.position.y !== n.y))
      await area.translate(n.id, { x: n.x, y: n.y });
  }

  const key = c => c.source + '>' + c.target;
  const wanted = new Set(g.edges.map(e => e.from + '>' + e.to));
  for (const c of editor.getConnections())
    if (!wanted.has(key(c))) await editor.removeConnection(c.id);
  const present = new Set(editor.getConnections().map(key));
  for (const e of g.edges) {
    if (present.has(e.from + '>' + e.to)) continue;
    const a = have.get(e.from), b = have.get(e.to);
    if (a && b) await editor.addConnection(new ClassicPreset.Connection(a, 'out', b, 'in'));
  }

  applying = false;
  for (const id of have.keys()) await area.update('node', id);
  for (const c of editor.getConnections()) await area.update('connection', c.id);
}

/* ══ 화면 ════════════════════════════════════ */
const zoomLabel = () => {
  const el = document.querySelector('#zoom-label');
  if (el) el.textContent = Math.round(area.area.transform.k * 100) + '%';
};

/** 그래프마다 화면 변환이 따로다. 모드를 바꾸면 그 그래프 것을 얹는다. */
export async function applyCanvasView() {
  if (!area) return;
  const v = H.view();
  applying = true;
  await area.area.zoom(v.k, 0, 0);
  await area.area.translate(v.x, v.y);
  applying = false;
  zoomLabel();
}

export const fitCanvas = () => area && AreaExtensions.zoomAt(area, editor.getNodes());

export function zoomCanvasBy(f) {
  if (!area) return;
  const r = area.container.getBoundingClientRect();
  area.area.zoom(area.area.transform.k * f, r.width / 2, r.height / 2);
}

export async function focusCanvasOn(id) {
  const n = H.graph().nodes[id];
  if (!n || !area) return;
  const r = area.container.getBoundingClientRect();
  const k = area.area.transform.k;
  await area.area.translate(r.width / 2 - (n.x + widthOf(n) / 2) * k, r.height / 3 - n.y * k);
}

/** 클라이언트 좌표 → 그래프 좌표. 팔레트에서 끌어다 놓을 때 쓴다. */
export function toWorld(clientX, clientY) {
  const r = area.container.getBoundingClientRect();
  const t = area.area.transform;
  return { x: (clientX - r.left - t.x) / t.k, y: (clientY - r.top - t.y) / t.k };
}

/** 렌더된 노드의 실제 높이. 레이아웃 계산에 넘겨 준다. */
export const measuredHeight = id => {
  const el = document.querySelector(`.node[data-id="${id}"]`);
  return el ? el.offsetHeight : 190;
};

export const canvasRect = () => area.container.getBoundingClientRect();
