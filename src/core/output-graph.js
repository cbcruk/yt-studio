/**
 * 출력 템플릿 서브그래프 ↔ 조각 수열.
 *
 * 표현식이 아니라 수열이므로 트리가 아니다. 조각 노드는 전부 -o 출력으로
 * 곧장 들어가고, **가로 위치가 곧 순서**다. 노드를 왼쪽으로 끌면 파일명
 * 앞쪽으로 간다. 조각끼리는 잇지 않으므로 입력 포트가 없다.
 */
import { adjacency, reach } from './graph.js';
import { emitOutput, previewTemplate, parseTemplate, splitType } from './output-template.js';

export const OOUT = 'oout';

export function blankOutput(x = 720, y = 200) {
  return {
    nodes: { [OOUT]: { id: OOUT, type: 'oout', x, y, outType: '' } },
    edges: [],
    view: { x: 0, y: 0, k: 1 },
  };
}

/** -o 출력에 닿는 노드. 나머지는 파일명에 기여하지 않는다. */
export const outputLive = g => reach(OOUT, adjacency(g).inn);

/** 조각들을 가로 순서대로. 같으면 세로 순. */
export function pieceNodes(g) {
  return g.edges.filter(e => e.to === OOUT)
    .map(e => g.nodes[e.from]).filter(Boolean)
    .sort((a, b) => (a.x - b.x) || (a.y - b.y));
}

const toPiece = n => n.type === 'text'
  ? { t: 'text', text: n.text || '' }
  : { t: 'field', name: n.name || '', strf: n.strf || '', fallback: n.fallback ?? null,
      fmt: n.fmt || '', conv: n.conv || 's' };

export const outputPieces = g => pieceNodes(g).map(toPiece);

/** 서브그래프가 컴파일하는 -o 값. */
export const outputExpr = g => emitOutput(g.nodes[OOUT].outType || '', outputPieces(g));

/** 값을 모르는 채로 보여 주는 파일명 미리보기. */
export const outputPreview = g => previewTemplate(outputPieces(g));

/** 사람이 고칠 만한 문제들. */
export function outputIssues(g, tagOf = t => t) {
  const live = outputLive(g);
  const out = [];
  for (const id in g.nodes) {
    const n = g.nodes[id];
    if (n.id === OOUT) continue;
    if (!live.has(n.id)) { out.push(`[${tagOf(n.type)}] 조각이 -o 출력에 이어지지 않았다`); continue; }
    if (n.type === 'field' && !n.name) out.push('필드 조각에 이름이 비어 있다');
    if (n.type === 'text' && !n.text) out.push('빈 글자 조각이 있다');
  }
  const pieces = outputPieces(g);
  if (pieces.length && !pieces.some(p => p.t === 'field' && p.name === 'ext')) {
    out.push('확장자(ext) 필드가 없다 — 파일명에 확장자가 안 붙는다');
  }
  return [...new Set(out)];
}

/**
 * 조각 수열 → 서브그래프. 왼쪽에서 오른쪽으로 늘어놓는다.
 * 열 간격은 노드 폭보다 넓어야 겹치지 않는다.
 */
export function piecesToGraph(pieces, type, { nid, widthOf = () => 300, gapX = 40, y = 120 } = {}) {
  const g = blankOutput();
  g.nodes[OOUT].outType = type || '';
  g._tidy = true;

  // 조각마다 폭이 다르므로 x 를 누적한다. 글자 조각은 좁아서 훨씬 촘촘히 놓인다.
  let x = 0;
  (pieces || []).forEach(p => {
    const id = nid();
    g.nodes[id] = p.t === 'text'
      ? { id, type: 'text', text: p.text, x, y }
      : { id, type: 'field', name: p.name, strf: p.strf, fallback: p.fallback,
          fmt: p.fmt, conv: p.conv, x, y };
    g.edges.push({ from: id, to: OOUT });
    x += widthOf(p.t === 'text' ? 'text' : 'field') + gapX;
  });

  g.nodes[OOUT].x = x;
  g.nodes[OOUT].y = y;
  return g;
}

/** `[TYPES:]TEMPLATE` 문자열 → 서브그래프. 못 읽으면 던진다. */
export function outputToGraph(raw, opts) {
  const { type, template } = splitType(raw);
  return piecesToGraph(parseTemplate(template), type, opts);
}

