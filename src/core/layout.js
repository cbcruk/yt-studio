/**
 * 좌표 계산.
 *
 * 노드 높이는 내용에 따라 달라서 실측이 필요하지만, 그 실측은 호출자가
 * heightOf 로 넘긴다. 그래서 이 파일은 DOM 을 모르고 단위 테스트가 된다.
 */
import { adjacency, reach } from './graph.js';

/**
 * 열마다 세로로 풀어 준다.
 * 연산자는 피연산자들의 세로 중심으로 끌어오되, 겹치면 아래로 밀어 순서는 보존한다.
 */
export function tidyColumns(g, heightOf, { gap = 26, operandsOf } = {}) {
  const all = Object.values(g.nodes);
  const cols = [...new Set(all.map(n => Math.round(n.x)))].sort((a, b) => a - b);
  for (const x of cols) {
    const col = all.filter(n => Math.round(n.x) === x);
    if (operandsOf) {
      for (const n of col) {
        const ins = operandsOf(g, n.id);
        if (ins.length) {
          const mid = ins.reduce((a, k) => a + k.y + heightOf(k.id) / 2, 0) / ins.length;
          n.y = Math.round(mid - heightOf(n.id) / 2);
        }
      }
    }
    col.sort((a, b) => a.y - b.y);
    for (let i = 1; i < col.length; i++) {
      const min = col[i - 1].y + heightOf(col[i - 1].id) + gap;
      if (col[i].y < min) col[i].y = Math.round(min);
    }
  }
  return g;
}

/** 모든 노드를 담는 세계 좌표 사각형. */
export function bounds(g, heightOf, { widthOf = () => 300, pad = 40 } = {}) {
  const ns = Object.values(g.nodes);
  if (!ns.length) return null;
  return {
    minX: Math.min(...ns.map(n => n.x)) - pad,
    maxX: Math.max(...ns.map(n => n.x + widthOf(n.id))) + pad,
    minY: Math.min(...ns.map(n => n.y)) - pad,
    maxY: Math.max(...ns.map(n => n.y + heightOf(n.id))) + pad,
  };
}

/** bounds 를 뷰포트에 맞추는 { x, y, k }. */
export function fitTo(box, vpW, vpH, { min = 0.3, max = 1.1 } = {}) {
  if (!box) return null;
  const w = box.maxX - box.minX, h = box.maxY - box.minY;
  const k = Math.max(min, Math.min(max, Math.min(vpW / w, vpH / h)));
  return {
    k,
    x: (vpW - w * k) / 2 - box.minX * k,
    y: (vpH - h * k) / 2 - box.minY * k,
  };
}

/** 커서를 고정점으로 삼는 줌. */
export function zoomAt(view, mx, my, factor, { min = 0.3, max = 2 } = {}) {
  const k = Math.max(min, Math.min(max, view.k * factor));
  return { k, x: mx - (mx - view.x) * (k / view.k), y: my - (my - view.y) * (k / view.k) };
}

/** 실행 순서를 왼쪽에서 오른쪽으로 늘어놓고, 경로 밖 노드는 아래에 남긴다. */
export function chainLayout(g, order, { nodeW = 300, gapX = 78, top = 90, stagger = 74, orphanDrop = 430 } = {}) {
  const pitch = nodeW + gapX;
  const rest = Object.keys(g.nodes).filter(id => !order.includes(id));
  order.forEach((id, i) => {
    const n = g.nodes[id];
    n.x = 40 + i * pitch;
    n.y = top + (i % 2) * stagger;
  });
  rest.forEach((id, i) => {
    const n = g.nodes[id];
    n.x = 40 + i * pitch;
    n.y = top + orphanDrop;
  });
  return g;
}

/** 겹치지 않는 빈 자리를 찾는다. 세계 좌표. */
export function freeSpot(g, x, y, { step = 34, drop = 30, near = 40, guard = 40 } = {}) {
  const taken = () => Object.values(g.nodes)
    .some(n => Math.abs(n.x - x) < near && Math.abs(n.y - y) < near);
  let i = 0;
  while (taken() && i++ < guard) { x += step; y += drop; }
  return [Math.round(x), Math.round(y)];
}

/** 표현식 그래프에서 fout 에 닿지 않는 노드들. 정렬할 때 아래로 내린다. */
export const orphansOf = (g, root) => {
  const live = reach(root, adjacency(g).inn);
  return Object.values(g.nodes).filter(n => !live.has(n.id));
};
