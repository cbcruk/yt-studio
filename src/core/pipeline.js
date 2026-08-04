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
    extras: [],          // 스키마가 모르는 토큰 — 원문 그대로 왕복한다
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

/**
 * 스키마가 모르는 토큰. 명령어가 원본이므로 왕복에서 사라지면 안 된다 —
 * 그래프에 실을 자리는 없지만 문자열에는 원문 그대로 남는다.
 */
export const extraList = g => (g.extras || []).filter(Boolean);

export const commandString = g =>
  ['yt-dlp', ...buildTokens(g).map(t => t.text), ...extraList(g),
   ...urlList(g).map(quote)].join(' ');

export const confString = g =>
  [...buildTokens(g).map(t => t.text), ...extraList(g)].join('\n') + '\n';

/* ── 역방향: 명령어 → 값 ─────────────────── */
/** 셸 인용을 존중하며 토큰으로 쪼갠다. */
export function tokenize(s) {
  const out = []; let cur = '', q = null, open = false;
  // `open` 이 따로 필요하다 — `""` 는 빈 토큰이지 토큰이 없는 게 아니다.
  // (`--sub-langs ""` 를 삼키면 값이 빈 것을 아무도 못 본다.)
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') { cur += s[++i] ?? ''; }
      else if (c === q) q = null;
      else cur += c;
    } else if (c === '"' || c === "'") { q = c; open = true; }
    else if (/\s/.test(c)) { if (open) { out.push(cur); cur = ''; open = false; } }
    else { cur += c; open = true; }
  }
  if (open) out.push(cur);
  return out;
}

/**
 * 명령어 문자열 → 항목 수열. 순서와 원문을 그대로 지킨다.
 *
 * parseCommand 는 이 위에 얹혀 있고, 진단(core/lint.js)도 같은 것을 본다 —
 * 파서가 둘이면 "검증기가 본 명령어"와 "그래프가 실은 명령어"가 갈린다.
 *
 * 항목은 셋 중 하나다.
 *   { kind:'url',     raw }
 *   { kind:'opt',     raw, flag, opt, negated, value }   value 는 flag 면 null
 *   { kind:'unknown', raw, flag, value, why }            스키마가 모르거나 값이 빈 것
 */
export function scanCommand(text) {
  const toks = tokenize((text || '').replace(/\\\n/g, ' '));
  const head = (toks[0] && /yt-dlp|youtube-dl/.test(toks[0])) ? toks.shift() : null;

  const items = [];
  for (let i = 0; i < toks.length; i++) {
    const raw0 = toks[i];
    if (!raw0.startsWith('-') || raw0 === '-') { items.push({ kind: 'url', raw: raw0 }); continue; }

    let flag = raw0, inline = null;
    if (raw0.startsWith('--') && raw0.includes('=')) {
      const k = raw0.indexOf('=');
      flag = raw0.slice(0, k); inline = raw0.slice(k + 1);
    }
    const hit = BY_FLAG[flag];
    if (!hit) { items.push({ kind: 'unknown', raw: raw0, flag, value: null, why: 'no-flag' }); continue; }

    const { opt, negated } = hit;
    if (opt.kind === 'flag') {
      // `--flag=값` 은 플래그에 값을 준 것이다 — 조용히 삼키지 않는다.
      if (inline != null) { items.push({ kind: 'unknown', raw: raw0, flag, value: inline, why: 'flag-took-value' }); continue; }
      items.push({ kind: 'opt', raw: raw0, flag, opt, negated, value: null });
      continue;
    }
    if (inline != null) { items.push({ kind: 'opt', raw: raw0, flag, opt, negated, value: inline }); continue; }

    const v = toks[i + 1];
    // 다음 토큰이 또 플래그면 값이 빠진 것이다. 음수(-1)와 `-` 는 값일 수 있다.
    const looksFlag = v !== undefined && v.startsWith('-') && v.length > 1 && !/^-?\d/.test(v);
    if (v === undefined || looksFlag) {
      items.push({ kind: 'unknown', raw: raw0, flag, value: null, why: 'no-value' });
      continue;
    }
    i++;
    items.push({ kind: 'opt', raw: raw0 + ' ' + quote(v), flag, opt, negated, value: v });
  }
  return { head, items };
}

/**
 * yt-dlp 명령어 문자열 → { urls, picked, unknown, extras }.
 *
 * picked 는 stage → { optId: value }. 그래프도 DOM 도 건드리지 않는다.
 * extras 는 우리가 모르는 토큰의 **원문**이다 — 그래프에 실을 수는 없어도
 * 명령어에는 그대로 남아야 하므로 buildTokens 와 나란히 다시 나간다.
 */
export function parseCommand(text) {
  const urls = [], picked = {}, unknown = [], extras = [];
  for (const it of scanCommand(text).items) {
    if (it.kind === 'url') { urls.push(it.raw); continue; }
    if (it.kind === 'unknown') { unknown.push(it.flag); extras.push(it.raw); continue; }
    const { opt, negated, value } = it;
    const bag = (picked[opt.stage] ||= {});
    if (opt.kind === 'flag') { bag[opt.id] = !negated; continue; }
    if (opt.kind === 'repeatable' && bag[opt.id]) bag[opt.id] += '\n' + value;
    else bag[opt.id] = value;
  }
  return { urls, picked, unknown, extras };
}
