/**
 * 그래프 원시 연산. 어떤 종류의 그래프인지 모른다.
 *
 * 그래프는 { nodes: {id: {id, x, y, …}}, edges: [{from, to}] } 하나뿐이고,
 * "무엇이 살아 있는가 / 어떤 순서인가" 같은 의미론은 도메인이 얹는다.
 */

export function adjacency(g) {
  const out = {}, inn = {};
  for (const id in g.nodes) { out[id] = []; inn[id] = []; }
  for (const e of g.edges) {
    if (out[e.from] && inn[e.to]) { out[e.from].push(e.to); inn[e.to].push(e.from); }
  }
  return { out, inn };
}

/** start 에서 adj 를 따라 닿는 모든 노드. adj 는 out 이면 순방향, inn 이면 역방향. */
export function reach(start, adj) {
  const seen = new Set(), st = [start];
  while (st.length) {
    const v = st.pop();
    if (seen.has(v)) continue;
    seen.add(v);
    for (const w of adj[v] || []) st.push(w);
  }
  return seen;
}

export function createsCycle(g, from, to) {
  return reach(to, adjacency(g).out).has(from);   // to 에서 from 으로 돌아오면 순환
}

export const hasEdge = (g, from, to) => g.edges.some(e => e.from === from && e.to === to);

/**
 * 이을 수 있으면 잇고 true. 자기 자신·중복·순환은 거부한다.
 * exclusiveIn 에 든 노드는 입력을 하나만 받으므로 기존 것을 밀어낸다.
 */
export function connect(g, from, to, { exclusiveIn } = {}) {
  if (from === to) return false;
  if (!g.nodes[from] || !g.nodes[to]) return false;
  if (hasEdge(g, from, to)) return false;
  if (createsCycle(g, from, to)) return false;
  if (exclusiveIn && exclusiveIn.has(to)) g.edges = g.edges.filter(e => e.to !== to);
  g.edges.push({ from, to });
  return true;
}

export function disconnect(g, from, to) {
  const before = g.edges.length;
  g.edges = g.edges.filter(e => !(e.from === from && e.to === to));
  return g.edges.length !== before;
}

/**
 * 노드를 지우되 앞뒤를 다시 이어 사슬이 끊기지 않게 한다.
 * 지웠으면 true.
 */
export function removeNode(g, id, opts = {}) {
  if (opts.protectedIds && opts.protectedIds.has(id)) return false;
  if (!g.nodes[id]) return false;
  const before = g.edges.filter(e => e.to === id).map(e => e.from);
  const after = g.edges.filter(e => e.from === id).map(e => e.to);
  g.edges = g.edges.filter(e => e.from !== id && e.to !== id);
  for (const a of before) for (const b of after) connect(g, a, b, opts);
  delete g.nodes[id];
  return true;
}

/**
 * ids 를 위상 정렬한다. 같은 층에서는 cmp 가 순서를 정한다.
 * 사이클이 있으면 닿지 못한 노드는 결과에서 빠진다(connect 가 막으므로 정상 경로에선 안 생긴다).
 */
export function topoOrder(ids, g, cmp) {
  const set = new Set(ids);
  const { out, inn } = adjacency(g);
  const indeg = {};
  for (const id of ids) indeg[id] = inn[id].filter(p => set.has(p)).length;
  let q = ids.filter(id => indeg[id] === 0);
  const order = [];
  while (q.length) {
    q.sort(cmp);
    const v = q.shift();
    order.push(v);
    for (const w of out[v]) if (set.has(w) && --indeg[w] === 0) q.push(w);
  }
  return order;
}

/** 그래프에 없는 노드를 가리키는 엣지를 걷어낸다. 복원·불러오기 직후에 쓴다. */
export function pruneEdges(g) {
  g.edges = (g.edges || []).filter(e => g.nodes[e.from] && g.nodes[e.to]);
  return g;
}
