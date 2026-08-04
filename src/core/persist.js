/**
 * 저장·복원과 버전 마이그레이션.
 *
 * 저장물은 사용자의 것이다. 형식을 바꿀 때마다 옛 스냅샷을 읽어 주는
 * 경로를 여기 한곳에 모아 둔다.
 */
import { pruneEdges } from './graph.js';

export const STORE_KEY = 'ytstudio.graph.v3';
export const LEGACY_KEYS = ['ytstudio.graph.v2'];
export const HISTORY_KEY = 'ytstudio.history.v1';
export const HISTORY_MAX = 30;

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
  // extras 는 v3 중간에 생겼다. 옛 스냅샷에는 없다.
  s.extras = Array.isArray(s.extras) ? s.extras.filter(x => typeof x === 'string') : [];

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

/* ── 명령어 히스토리 ─────────────────────── */
/**
 * 원본이 그래프에서 명령어로 바뀌면서 생긴 저장물.
 *
 * 그래프 스냅샷은 "지금 편집 중인 것" 하나뿐이지만, 명령어는 만들고 버리고
 * 다시 꺼내는 물건이라 여러 개가 쌓인다. 프롬프트를 같이 남긴다 — 나중에
 * 보면 명령어보다 "무엇을 원했는지"가 먼저 기억나기 때문이다.
 */
export function loadHistory(storage) {
  try {
    const raw = storage.getItem(HISTORY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(e => e && typeof e.command === 'string') : [];
  } catch { return []; }
}

/** 같은 명령어는 위로 끌어올린다 — 목록이 같은 줄로 채워지지 않게. */
export function pushHistory(list, entry) {
  const cmd = String((entry && entry.command) || '').trim();
  if (!cmd) return list;
  const rest = list.filter(e => e.command.trim() !== cmd);
  return [{ ...entry, command: cmd }, ...rest].slice(0, HISTORY_MAX);
}

export function saveHistory(storage, list) {
  try { storage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { /* 저장 못 해도 계속 쓴다 */ }
}

/** 마지막으로 보던 화면. 그래프에서 새로고침했는데 프롬프트로 튕기면 안 된다. */
export const VIEW_KEY = 'ytstudio.view';
export const loadView = storage => {
  try { return storage.getItem(VIEW_KEY) === 'graph' ? 'graph' : 'ask'; }
  catch { return 'ask'; }
};

/* ── 편집 중인 명령어 ────────────────────── */
/** 히스토리에 넣기 전, 아직 고치는 중인 것. 새로고침으로 날아가면 안 된다. */
export const DRAFT_KEY = 'ytstudio.draft.v1';

export function loadDraft(storage) {
  try {
    const d = JSON.parse(storage.getItem(DRAFT_KEY) || 'null');
    if (!d || typeof d !== 'object') return null;
    return {
      prompt: String(d.prompt || ''),
      command: String(d.command || ''),
      note: String(d.note || ''),
    };
  } catch { return null; }
}

export function saveDraft(storage, d) {
  try { storage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* 저장 못 해도 계속 쓴다 */ }
}
