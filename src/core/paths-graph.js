/**
 * --paths 서브그래프 ↔ 경로 항목들.
 *
 * -o 와 달리 값 안에 템플릿이 없다. 대신 `TYPES:PATH` 를 여러 줄 준다.
 *
 *     -P home:/dl  -P temp:/tmp/yt  -P subtitle:/dl/subs
 *
 * 그래서 그래프는 수열도 트리도 아니고 **집합**이다. 항목끼리 순서가 의미를
 * 갖지 않으므로(TYPES 가 키다) 세로 위치로만 안정된 순서를 준다.
 */
import { adjacency, reach } from './graph.js';
import { OUT_TYPES } from './output-template.js';

export const POUT = 'pout';

/** -o 의 TYPES 전부 + 경로에만 있는 home·temp. */
export const PATH_TYPES = [
  ['home', 'home — 최종 파일이 놓일 곳 (기본)'],
  ['temp', 'temp — 받는 동안 쓰는 임시 폴더'],
  ...OUT_TYPES.filter(([v]) => v),
];
const PATH_TYPE_SET = new Set(PATH_TYPES.map(([v]) => v));

export function blankPaths(x = 620, y = 200) {
  return {
    nodes: { [POUT]: { id: POUT, type: 'pout', x, y } },
    edges: [],
    view: { x: 0, y: 0, k: 1 },
  };
}

/** `[TYPES:]PATH` 한 줄 → { type, path }. 아는 TYPES 만 잘라 낸다. */
export function splitEntry(line) {
  const s = (line || '').trim();
  const i = s.indexOf(':');
  if (i > 0 && PATH_TYPE_SET.has(s.slice(0, i))) {
    return { type: s.slice(0, i), path: s.slice(i + 1) };
  }
  return { type: '', path: s };
}
export const joinEntry = ({ type, path }) => (type ? type + ':' : '') + (path || '');

/** -P 출력에 닿는 노드. */
export const pathsLive = g => reach(POUT, adjacency(g).inn);

/** 항목 노드들. 세로 순, 같으면 가로 순. */
export function entryNodes(g) {
  return g.edges.filter(e => e.to === POUT)
    .map(e => g.nodes[e.from]).filter(Boolean)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

/** 서브그래프가 컴파일하는 --paths 값. 한 줄에 하나 — 조립기가 -P 를 줄마다 붙인다. */
export const pathsExpr = g =>
  entryNodes(g).map(n => joinEntry({ type: n.pathType, path: n.path })).join('\n');

/** 사람이 읽는 요약. */
export function pathsPreview(g) {
  const ns = entryNodes(g);
  if (!ns.length) return '';
  const home = ns.find(n => !n.pathType || n.pathType === 'home');
  return (home ? home.path || '(빈 경로)' : ns[0].path) + (ns.length > 1 ? ` 외 ${ns.length - 1}개` : '');
}

export function pathsIssues(g, tagOf = t => t) {
  const live = pathsLive(g);
  const out = [];
  const seen = new Map();
  for (const id in g.nodes) {
    const n = g.nodes[id];
    if (n.id === POUT) continue;
    if (!live.has(n.id)) { out.push(`[${tagOf(n.type)}] 항목이 -P 출력에 이어지지 않았다`); continue; }
    if (!n.path) out.push('경로가 비어 있는 항목이 있다');
  }
  // TYPES 가 키다. 같은 키를 두 번 주면 뒤엣것이 이긴다.
  for (const n of entryNodes(g)) {
    const key = n.pathType || 'home';
    if (seen.has(key)) out.push(`${key} 경로가 두 번 있다 — 아래쪽 것만 쓰인다`);
    seen.set(key, n.id);
  }
  return [...new Set(out)];
}

/** 여러 줄 문자열 → 서브그래프. 위에서 아래로 늘어놓는다. */
export function pathsToGraph(raw, { nid, nodeW = 300, gapY = 150, y = 80 } = {}) {
  const lines = String(raw || '').split('\n').map(s => s.trim()).filter(Boolean);
  const g = blankPaths();
  g._tidy = true;

  lines.forEach((line, i) => {
    const { type, path } = splitEntry(line);
    const id = nid();
    g.nodes[id] = { id, type: 'path', pathType: type, path, x: 0, y: y + i * gapY };
    g.edges.push({ from: id, to: POUT });
  });

  g.nodes[POUT].x = nodeW + 120;
  g.nodes[POUT].y = y + Math.max(0, (lines.length - 1)) * gapY / 2;
  return g;
}
