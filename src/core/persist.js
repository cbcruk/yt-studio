/**
 * 저장·복원과 버전 마이그레이션.
 *
 * 저장물은 사용자의 것이다. 형식을 바꿀 때마다 옛 스냅샷을 읽어 주는
 * 경로를 여기 한곳에 모아 둔다.
 */
import { pruneEdges } from './graph.js';

export const STORE_KEY = 'ytstudio.graph.v3';
export const LEGACY_KEYS = ['ytstudio.graph.v2'];

/** 직렬화 전에 걷어낼 내부 전용 필드. 저장물로 새면 안 된다. */
const TRANSIENT = ['_tidy'];

export function snapshot(state, seq, mode) {
  const clean = JSON.parse(JSON.stringify(state));
  // 내부 전용 플래그는 저장물로 새면 안 된다. 서브그래프가 몇 개든 훑는다.
  for (const g of [clean, ...Object.values(clean).filter(v => v && v.nodes)])
    for (const k of TRANSIENT) delete g[k];
  return { v: 3, seq, mode, state: clean };
}

/**
 * 스냅샷 → { state, seq, mode }. 읽을 수 없으면 null.
 * deps: { subgraphs: [{ key, root, blank }], isValidStage }
 */
export function restore(data, { subgraphs = [], isValidStage } = {}) {
  if (!data) return null;

  // v2 는 { v:2, seq, view, nodes, edges } 로 서브그래프가 아예 없었다.
  let s = data.state;
  if (!s && data.nodes) s = { nodes: data.nodes, edges: data.edges || [], view: data.view };
  if (!s || !s.nodes || !s.nodes.src || !s.nodes.out) return null;

  if (isValidStage) {
    for (const id of Object.keys(s.nodes)) {
      const n = s.nodes[id];
      if (n.type === 'stage' && !isValidStage(n.stage)) delete s.nodes[id];
    }
  }
  pruneEdges(s);
  s.view = Object.assign({ x: 0, y: 0, k: 1 }, s.view);

  let extra = 0;
  for (const { key, root, blank } of subgraphs) {
    const g = s[key];
    if (!g || !g.nodes || !g.nodes[root]) { s[key] = blank(); }
    else {
      pruneEdges(g);
      g.view = Object.assign({ x: 0, y: 0, k: 1 }, g.view);
    }
    extra += Object.keys(s[key].nodes).length;
  }

  const seq = data.seq || (Object.keys(s.nodes).length + extra + 1);
  const modes = new Set(['pipeline', ...subgraphs.map(x => x.key)]);
  const mode = modes.has(data.mode) ? data.mode : 'pipeline';
  return { state: s, seq, mode };
}

/** v3 를 먼저 보고, 없으면 옛 키를 훑는다. */
export function loadRaw(storage) {
  for (const key of [STORE_KEY, ...LEGACY_KEYS]) {
    try {
      const raw = storage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch { /* 깨진 저장물은 없는 셈 친다 */ }
  }
  return null;
}
