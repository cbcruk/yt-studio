/**
 * 그래프 종류 레지스트리.
 *
 * 캔버스는 하나지만 그 위에 사는 그래프는 둘이고, 둘은 서로 다른 대수다.
 *
 *   파이프라인 — 흐름.   src → out 으로 이어졌는가, 위상 정렬 순서는 무엇인가
 *   포맷      — 표현식. fout 에 닿는가, 피연산자 순서는 세로 위치를 따른다
 *
 * 예전에는 이 차이를 렌더 함수 13개가 각자 `if (inFormat())` 로 물었다.
 * 그 질문을 여기 표 하나로 모아, 렌더는 `kind.live(g)` 만 부르게 한다.
 *
 * 선언은 이 파일에, DOM 을 만지는 동작(정렬·되돌려쓰기)은
 * defineGraphBehavior 로 앱이 등록한다. node-kinds.js 와 같은 방식이다.
 */
import { BY_ID } from '../core/schema.js';
import { pipelineLive, livePath, stageNode, SRC, OUT } from '../core/pipeline.js';
import { formatLive, formatExpr, formatIssues, operands, FOUT } from '../core/format-graph.js';
import { tagOfType } from './node-kinds.js';

const GRAPHS = {};

/**
 * spec:
 *   label         사람에게 보일 이름
 *   graphOf(state)  상태에서 이 그래프를 꺼낸다
 *   viewOf(state)   이 그래프의 화면 변환
 *   live(g)       살아 있는 노드 집합 — "결과에 기여하는가"의 정의
 *   order(g)      실행/평가 순서
 *   exclusiveIn   입력을 하나만 받는 노드 id 들
 *   wireOrdinals  와이어에 순서 번호를 붙이는가 (연산자의 피연산자 순서)
 *   search        상단 옵션 검색을 쓰는가
 *   canAutowire   "전부 잇기"가 말이 되는가
 *   parent        Esc 로 빠져나갈 상위 그래프
 *   chrome        { crumb, sub } 캔버스 장식
 *   palette       { head, hint }
 *   isEmpty(g) / emptyHint   빈 캔버스 안내
 *   statusNotes(g, ctx)      하단 노트 → [{ label?, body }]
 *   holderOf(state, optId)   옵션을 들고 있는 노드 (상호 강조용)
 *   opensFrom     { option, label, title }  이 서브그래프로 들어가는 옵션 행
 */
export function defineGraph(id, spec) {
  GRAPHS[id] = Object.assign({ id }, spec);
  return GRAPHS[id];
}

/** 앱이 DOM 쪽 동작을 얹는다. */
export const defineGraphBehavior = (id, behavior) => Object.assign(GRAPHS[id], behavior);

export const graphKind = id => GRAPHS[id];
export const allGraphKinds = () => Object.values(GRAPHS);

/** 이 옵션 행에서 열리는 서브그래프가 있는가. */
export const subgraphFor = optId =>
  allGraphKinds().find(g => g.opensFrom && g.opensFrom.option === optId) || null;

/* ══ 등록 ════════════════════════════════════ */

defineGraph('pipeline', {
  label: '파이프라인',
  graphOf: s => s,
  viewOf: s => s.view,

  live: pipelineLive,
  order: livePath,
  endpoints: { start: SRC, end: OUT },
  exclusiveIn: [],
  wireOrdinals: false,

  search: true,
  canAutowire: true,
  parent: null,
  chrome: { crumb: false, sub: false },

  palette: {
    head: '실행 단계',
    hint: '캔버스로 끌어다 놓거나 클릭해서 노드를 만든다. '
        + '소스에서 명령어까지 <b>이어진 노드만</b> 결과에 들어간다.',
  },

  isEmpty: g => !Object.values(g.nodes).some(n => n.type === 'stage'),
  emptyHint: '캔버스가 비어 있다.<br>'
           + '왼쪽 <b>실행 단계</b>를 끌어다 놓고 <b>소스 → 명령어</b> 사이에 이어라.<br>'
           + '또는 위의 <b>명령어 읽기</b>로 기존 명령어를 그래프로 되돌려라.',

  statusNotes(g, { tokens, unknown }) {
    const out = [];
    if (tokens.length) {
      out.push({ body: `${tokens.length}개 옵션 · ${new Set(tokens.map(t => t.node)).size}개 노드 · `
                     + '플래그 순서는 그래프 순서를 따른다' });
    } else if (!unknown.length) {
      out.push({ body: '아직 잡힌 옵션이 없다. 왼쪽 단계를 캔버스에 놓고 소스 → 명령어로 이어라.' });
    }
    const live = pipelineLive(g);
    const bypassed = Object.values(g.nodes).filter(n => n.type === 'stage' && !live.has(n.id));
    if (bypassed.length) {
      out.push({
        label: '우회 중',
        body: bypassed.map(n => `[${n.stage}]`).join(' ') + ' — 경로에서 끊겨 있어 반영되지 않는다',
      });
    }
    return out;
  },

  holderOf: (state, optId) => stageNode(state, BY_ID[optId].stage),
});

defineGraph('format', {
  label: '[format] 포맷 셀렉터',
  graphOf: s => s.format,
  viewOf: s => s.format.view,

  live: formatLive,
  order: g => [...formatLive(g)],
  endpoints: { end: FOUT },
  exclusiveIn: [FOUT],          // -f 출력은 표현식 하나만 받는다
  wireOrdinals: true,
  operandsOf: operands,

  search: false,
  canAutowire: false,           // 표현식은 한 줄로 엮이지 않는다
  parent: 'pipeline',
  chrome: { crumb: true, sub: true },
  crumbDetail: s => formatExpr(s.format),
  opensFrom: {
    option: 'format',            // --format 행에 문이 달린다
    label: '그래프 ↗',
    title: '포맷 셀렉터를 노드 서브그래프로 편집한다',
  },

  palette: {
    head: '포맷 노드',
    hint: '<b>-f 출력</b>에 이어진 것만 표현식이 된다. '
        + '연산자 노드의 입력 순서는 <b>세로 위치</b>를 따른다.',
  },

  isEmpty: g => Object.keys(g.nodes).length <= 1,
  emptyHint: '포맷 셀렉터 서브그래프가 비어 있다.<br>'
           + '왼쪽에서 <b>스트림</b>을 놓고 <b>-f 출력</b>에 이어라.<br>'
           + '<b>병합 +</b> 로 영상·음성을 합치고, <b>폴백 /</b> 로 대안을 준다.',

  statusNotes(g) {
    const issues = formatIssues(g, tagOfType);
    return issues.length
      ? [{ label: '서브그래프', body: issues.join(' · ') }]
      : [{ body: '포맷 서브그래프 편집 중 · -f 값은 그래프가 컴파일한 결과로 계속 덮어쓴다' }];
  },

  holderOf: () => null,         // 명령어 토큰은 파이프라인 노드에만 매인다
});
