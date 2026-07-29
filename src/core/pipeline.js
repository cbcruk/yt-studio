/**
 * 파이프라인 그래프의 의미론과 명령어 조립.
 *
 *   · 소스에서 명령어 노드까지 이어진 노드만 결과에 들어간다
 *   · 플래그 순서는 그래프의 위상 정렬 순서를 따른다 (같은 층이면 x 좌표 순)
 */
import { adjacency, reach, topoOrder } from './graph.js';
import { BY_STAGE, BY_FLAG, stageIdx } from './schema.js';

export const SRC = 'src';
export const OUT = 'out';

export function blankPipeline() {
  return {
    nodes: {
      [SRC]: { id: SRC, type: 'source', x: 60,  y: 190, urls: '' },
      [OUT]: { id: OUT, type: 'sink',   x: 700, y: 190 },
    },
    edges: [{ from: SRC, to: OUT }],
    view: { x: 0, y: 0, k: 1 },
  };
}

export const stageNode = (g, sid) =>
  Object.values(g.nodes).find(n => n.type === 'stage' && n.stage === sid);

/** src 에서 출발해 out 까지 실제로 도달하는 노드들을, 실행 순서대로. */
export function livePath(g) {
  const { out, inn } = adjacency(g);
  const fwd = reach(SRC, out), bwd = reach(OUT, inn);
  const live = Object.keys(g.nodes).filter(id => fwd.has(id) && bwd.has(id));
  const cmp = (a, b) => (g.nodes[a].x - g.nodes[b].x)
    || (stageIdx(g.nodes[a].stage) - stageIdx(g.nodes[b].stage));
  return topoOrder(live, g, cmp);
}
export const pipelineLive = g => new Set(livePath(g));

/** 새 단계 노드를 단계 순서에 맞는 자리에 끼워 넣는다. 단순 사슬이 아니면 손대지 않는다. */
export function spliceIntoChain(g, node) {
  const chain = [];
  const { out } = adjacency(g);
  let cur = SRC;
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    if (cur === OUT) break;
    const next = (out[cur] || []).filter(id => id !== node.id);
    if (next.length !== 1) return false;      // 사슬이 아니다 → 손으로 잇게 둔다
    cur = next[0];
  }
  if (chain[chain.length - 1] !== OUT) return false;

  const rank = id => id === SRC ? -1 : id === OUT ? 99 : stageIdx(g.nodes[id].stage);
  let i = 0;
  while (i < chain.length - 1 && rank(chain[i + 1]) < stageIdx(node.stage)) i++;
  const prev = chain[i], next = chain[i + 1];
  g.edges = g.edges.filter(e => !(e.from === prev && e.to === next));
  g.edges.push({ from: prev, to: node.id }, { from: node.id, to: next });
  return true;
}

/* ── 명령어 조립 ─────────────────────────── */
const SAFE = /^[A-Za-z0-9._:,\/=+@%^-]+$/;
export const quote = v => SAFE.test(v) ? v : '"' + String(v).replace(/([\\"$`])/g, '\\$1') + '"';

/** 살아 있는 경로를 순서대로 훑으며 토큰을 뽑는다. */
export function buildTokens(g) {
  const toks = [];
  for (const id of livePath(g)) {
    const n = g.nodes[id];
    if (n.type !== 'stage') continue;
    const vals = n.values || {};
    for (const o of BY_STAGE[n.stage]) {
      if (!(o.id in vals) || vals[o.id] === '') continue;
      const v = vals[o.id];
      if (v === true) toks.push({ node: n.id, opt: o, text: o.short || o.flag });
      else if (v === false) { if (o.negation) toks.push({ node: n.id, opt: o, text: o.negation }); }
      else if (o.kind === 'repeatable') {
        for (const line of String(v).split('\n').map(s => s.trim()).filter(Boolean))
          toks.push({ node: n.id, opt: o, text: (o.short || o.flag) + ' ' + quote(line) });
      } else toks.push({ node: n.id, opt: o, text: (o.short || o.flag) + ' ' + quote(String(v)) });
    }
  }
  return toks;
}

export const urlList = g =>
  ((g.nodes[SRC] && g.nodes[SRC].urls) || '').split('\n').map(s => s.trim()).filter(Boolean);

export const commandString = g =>
  ['yt-dlp', ...buildTokens(g).map(t => t.text), ...urlList(g).map(quote)].join(' ');

export const confString = g => buildTokens(g).map(t => t.text).join('\n') + '\n';

/* ── 역방향: 명령어 → 값 ─────────────────── */
/** 셸 인용을 존중하며 토큰으로 쪼갠다. */
export function tokenize(s) {
  const out = []; let cur = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') { cur += s[++i] ?? ''; }
      else if (c === q) q = null;
      else cur += c;
    } else if (c === '"' || c === "'") q = c;
    else if (/\s/.test(c)) { if (cur) { out.push(cur); cur = ''; } }
    else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * yt-dlp 명령어 문자열 → { urls, picked, unknown }.
 * picked 는 stage → { optId: value }. 그래프도 DOM 도 건드리지 않는다.
 */
export function parseCommand(text) {
  const toks = tokenize((text || '').replace(/\\\n/g, ' '));
  if (toks[0] && /yt-dlp|youtube-dl/.test(toks[0])) toks.shift();

  const urls = [], picked = {}, unknown = [];
  for (let i = 0; i < toks.length; i++) {
    let t = toks[i];
    if (!t.startsWith('-')) { urls.push(t); continue; }
    let inline = null;
    if (t.includes('=') && t.startsWith('--')) { const k = t.indexOf('='); inline = t.slice(k + 1); t = t.slice(0, k); }
    const hit = BY_FLAG[t];
    if (!hit) { unknown.push(t); continue; }
    const { opt, negated } = hit;
    const bag = (picked[opt.stage] ||= {});
    if (opt.kind === 'flag') { bag[opt.id] = !negated; continue; }
    const v = inline ?? toks[++i];
    if (v === undefined) { unknown.push(t); continue; }
    if (opt.kind === 'repeatable' && bag[opt.id]) bag[opt.id] += '\n' + v;
    else bag[opt.id] = v;
  }
  return { urls, picked, unknown };
}
