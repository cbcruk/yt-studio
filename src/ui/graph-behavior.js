/**
 * 그래프 종류마다 다른 동작 — 정렬 · 되돌려쓰기 · 새 노드.
 *
 * "무엇이 살아 있는가", "순서는 무엇으로 정하는가" 같은 선언은
 * graph-kinds.js 에 있다. 여기 있는 것은 그 선언만으로는 안 되는 것들이다.
 *
 *   addNode    팔레트에서 놓은 것을 그 그래프의 노드로 만든다
 *   sync       서브그래프가 컴파일한 값을 파이프라인 옵션에 되돌려 쓴다
 *   tidy       실측한 높이로 겹치지 않게 세로를 맞춘다
 *   relayout   "정렬" — 그래프의 대수에 맞게 통째로 다시 늘어놓는다
 *
 * 앱에서 받아 오는 것은 여섯 가지다.
 */
import { valuesOf } from '../core/graph.js';
import { livePath, stageNode } from '../core/pipeline.js';
import { chainLayout, orphansOf, tidyColumns } from '../core/layout.js';
import { hasEdge } from '../core/graph.js';
import { FOUT, formatExpr, graphToTree, operands, treeToGraph } from '../core/format-graph.js';
import { OOUT, outputExpr, outputPieces, piecesToGraph } from '../core/output-graph.js';
import { POUT, pathsExpr, pathsToGraph } from '../core/paths-graph.js';
import { defineGraphBehavior } from './graph-kinds.js';
import { widthOfType } from './node-kinds.js';
import { fitCanvas, measuredHeight } from './canvas.js';

const NODE_W = 300;

/* ══ 앱에서 받아 오는 것 ══════════════════════ */
let S = () => null;          // 지금 상태
let graph = () => null;      // 지금 편집 중인 그래프
let kind = () => ({});       // 그 그래프의 종류 서술자
let nid = () => 'n0';        // 새 노드 id
let render = () => {};       // 전체 렌더
let addStage = () => null;   // 단계 노드 (파이프라인 전용)

export function installGraphBehavior(host) {
  S = host.state;
  graph = host.graph;
  kind = host.kind;
  nid = host.nid;
  render = host.render;
  addStage = host.addStage;
}

const stageAt = sid => stageNode(S(), sid);
const nodeList = g => Object.values(g.nodes);
const fitView = () => fitCanvas();

// 서브그래프가 컴파일한 값. 문법·트리 변환은 core/ 의 해당 모듈에 있다.
export const fmtExpr = () => formatExpr(S().format);
export const outExpr = () => outputExpr(S().output);
export const pathExpr = () => pathsExpr(S().paths);

function addPathNode(type, x, y, extra) {
  const n = Object.assign({ id: nid(), type, x, y }, extra || {});
  if (type === 'path') { n.pathType = n.pathType ?? 'home'; n.path = n.path ?? ''; }
  S().paths.nodes[n.id] = n;
  return n;
}
/** 파이프라인의 --paths 값을 서브그래프가 컴파일한 결과로 덮어쓴다. 한 줄에 -P 하나. */
function syncPathsValue() {
  const n = stageAt('store');
  if (n) valuesOf(n).paths = pathExpr();
}

function addOutputNode(type, x, y, extra) {
  const n = Object.assign({ id: nid(), type, x, y }, extra || {});
  if (type === 'text') n.text = n.text ?? ' - ';
  if (type === 'field') { n.name = n.name || 'title'; n.conv = n.conv || 's'; n.fmt = n.fmt || ''; }
  S().output.nodes[n.id] = n;
  return n;
}

/** 파이프라인의 --output 값을 서브그래프가 컴파일한 결과로 덮어쓴다. */
function syncOutputValue() {
  const n = stageAt('store');
  if (n) valuesOf(n).output = outExpr();
}

export function addFormatNode(type, x, y, extra) {
  const n = Object.assign({ id: nid(), type, x, y }, extra || {});
  if (type === 'stream') { n.sel = n.sel || 'bv'; n.filters = n.filters || []; }
  S().format.nodes[n.id] = n;
  return n;
}

/** 파이프라인의 --format 값을 서브그래프가 컴파일한 결과로 덮어쓴다. */
function syncFormatValue() {
  const n = stageNode(S(), 'format');
  if (n) valuesOf(n).format = fmtExpr();
}

/* ══ 그래프 종류마다 다른 동작 ═══════════════
   선언은 graph-kinds.js 에 있고, 캔버스를 실제로 만지는 일만 여기서 얹는다. */

defineGraphBehavior('pipeline', {
  addNode: (key, x, y) => addStage(key, x, y),
  sync() {},                       // 파이프라인은 자기가 원본이라 되돌릴 곳이 없다
  tidy() {},
  relayout() {
    chainLayout(S(), livePath(S()), { nodeW: NODE_W });
    fitView(); render();
  },
});

defineGraphBehavior('format', {
  // 그래프를 고칠 때마다 컴파일해 --format 문자열로 돌려놓는다.
  // -f 출력 노드와 브레드크럼은 render 가 알아서 따라온다.
  addNode: (key, x, y) => addFormatNode(key, x, y),
  sync() { syncFormatValue(); },
  tidy() { tidyColumns(S().format, measuredHeight, { operandsOf: operands }); },
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
    S().format = fresh;
    render();            // 실측하려면 일단 그려야 한다
    kind().tidy();
    render();
    fitView();
  },
});

defineGraphBehavior('paths', {
  addNode: (key, x, y) => addPathNode(key, x, y),
  sync() { syncPathsValue(); },
  tidy() { tidyColumns(S().paths, measuredHeight, {}); },
  relayout() {
    const g = graph();
    const fresh = pathsToGraph(pathExpr(), { nid, nodeW: NODE_W });
    const orphans = orphansOf(g, POUT);
    const maxY = Math.max(0, ...nodeList(fresh).map(n => n.y));
    orphans.forEach((n, i) => { n.x = 0; n.y = maxY + 190 + i * 150; fresh.nodes[n.id] = n; });
    fresh.view = g.view;
    delete fresh._tidy;
    S().paths = fresh;
    render(); kind().tidy(); render();
    fitView();
  },
});

defineGraphBehavior('output', {
  // 조각을 고칠 때마다 이어 붙여 --output 문자열로 돌려놓는다.
  addNode: (key, x, y) => addOutputNode(key, x, y),
  sync() { syncOutputValue(); },
  // 조각은 한 줄로 늘어서므로 같은 열에 겹칠 일이 없다. 세로만 맞춰 준다.
  tidy() { tidyColumns(S().output, measuredHeight, {}); },
  relayout() {
    const g = graph();
    // 수열이다. 지금 순서 그대로 다시 늘어놓으면 그게 정돈된 배치다.
    const fresh = piecesToGraph(outputPieces(g), g.nodes[OOUT].outType, { nid, widthOf: widthOfType });
    // 이어지지 않은 조각은 아래쪽에 남겨 둔다.
    const orphans = orphansOf(g, OOUT);
    orphans.forEach((n, i) => { n.x = i * (NODE_W + 40); n.y = 380; fresh.nodes[n.id] = n; });
    fresh.view = g.view;
    delete fresh._tidy;
    S().output = fresh;
    render(); kind().tidy(); render();
    fitView();
  },
});
