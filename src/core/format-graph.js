/**
 * 포맷 셀렉터 서브그래프 ↔ 표현식 트리.
 *
 * 그래프 쪽 의미론은 두 가지뿐이다.
 *   · -f 출력(fout)에 닿는 노드만 표현식에 들어간다
 *   · 연산자의 피연산자 순서는 노드의 세로 위치를 따른다
 */
import { adjacency, reach } from './graph.js';
import { emitTree, FORMAT_OPS } from './format-grammar.js';

export const FOUT = 'fout';

export function blankFormat(x = 560, y = 210) {
  return {
    nodes: { [FOUT]: { id: FOUT, type: 'fout', x, y } },
    edges: [],
    view: { x: 0, y: 0, k: 1 },
  };
}

/** 연산자의 피연산자들. 세로 위치 순, 같으면 가로 순. */
export function operands(g, id) {
  return g.edges.filter(e => e.to === id)
    .map(e => g.nodes[e.from]).filter(Boolean)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

/** -f 출력에 닿는 노드 집합. 나머지는 표현식에 기여하지 않는다. */
export const formatLive = g => reach(FOUT, adjacency(g).inn);

/** 서브그래프 → 표현식 트리. 비어 있으면 null. */
export function graphToTree(g, id = FOUT, seen = new Set()) {
  const n = g.nodes[id];
  if (!n || seen.has(id)) return null;
  seen.add(id);
  if (n.type === 'stream') {
    if (!n.sel) return null;
    return { t: 'sel', name: n.sel, filters: (n.filters || []).filter(f => f.key) };
  }
  const kids = operands(g, id)
    .map(k => graphToTree(g, k.id, new Set(seen)))
    .filter(Boolean);
  if (n.type === 'fout') return kids[0] || null;
  if (!kids.length) return null;
  if (kids.length === 1) return kids[0];     // 피연산자가 하나면 연산자는 통과시킨다
  return { t: n.type, kids };
}

/** 서브그래프가 컴파일하는 --format 값. */
export const formatExpr = g => emitTree(graphToTree(g));

/** 사람이 고칠 만한 문제들. tagOf 로 노드 종류의 표기를 받는다. */
export function formatIssues(g, tagOf = t => t) {
  const live = formatLive(g);
  const out = [];
  for (const id in g.nodes) {
    const n = g.nodes[id];
    if (n.id === FOUT) continue;
    if (!live.has(n.id)) { out.push(`[${tagOf(n.type)}] 노드가 -f 출력에 이어지지 않았다`); continue; }
    if (n.type === 'stream' && !n.sel) out.push('스트림 노드에 셀렉터가 비어 있다');
    if (FORMAT_OPS.includes(n.type)) {
      const k = operands(g, n.id).length;
      if (k < 2) out.push(`[${tagOf(n.type)}] 노드에 이어진 입력이 ${k}개뿐이다 — 그냥 통과된다`);
    }
  }
  return [...new Set(out)];
}

/**
 * 표현식 트리 → 서브그래프.
 * 오른쪽 끝이 -f 출력, 왼쪽으로 갈수록 깊어진다. 열 간격은 노드 폭보다 넓어야 겹치지 않는다.
 */
export function treeToGraph(tree, { nid, nodeW = 300, gapX = 90, gapY = 200 } = {}) {
  const g = blankFormat();
  g._tidy = true;                   // DOM 이 생기면 실측해서 다시 정돈하라는 표시
  if (!tree) return g;

  const PX = nodeW + gapX;
  const depthOf = n => n.t === 'sel' ? 0 : 1 + Math.max(...n.kids.map(depthOf));
  const maxDepth = depthOf(tree);
  let slot = 0;

  const walk = (n, depth) => {
    if (n.t === 'sel') {
      const id = nid();
      g.nodes[id] = { id, type: 'stream', sel: n.name, filters: n.filters || [], x: 0, y: slot++ * gapY, _d: depth };
      return id;
    }
    const kids = n.kids.map(k => walk(k, depth + 1));
    const id = nid();
    const y = kids.reduce((a, k) => a + g.nodes[k].y, 0) / kids.length;
    g.nodes[id] = { id, type: n.t, x: 0, y, _d: depth };
    for (const k of kids) g.edges.push({ from: k, to: id });
    return id;
  };

  const rootId = walk(tree, 0);
  for (const id in g.nodes) {
    const n = g.nodes[id];
    if (n.id === FOUT) continue;
    n.x = (maxDepth - n._d) * PX;
    n.y = Math.round(n.y) + 60;
    delete n._d;
  }
  g.nodes[FOUT].x = (maxDepth + 1) * PX;
  g.nodes[FOUT].y = Math.round(g.nodes[rootId].y);
  g.edges.push({ from: rootId, to: FOUT });
  return g;
}
