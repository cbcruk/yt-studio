/**
 * 노드 종류 레지스트리.
 *
 * 예전에는 노드 하나를 추가하려면 accentOf · setCount · headLabel ·
 * hasInPort · hasOutPort · PROTECTED · nodeEl 의 if/else · 팔레트까지
 * 일고여덟 군데를 손봐야 했다. 그 지식을 전부 여기 표 하나로 모은다.
 *
 * 선언(색·표기·포트·배지)은 이 파일에, 본문 DOM 을 그리는 일은
 * defineBody 로 앱이 등록한다. 본문은 앱 클로저를 많이 타므로 굳이
 * 여기로 끌고 오지 않는다.
 */
import { STAGE } from '../core/schema.js';
import { FORMAT_OPS } from '../core/format-grammar.js';

const call = (v, n) => (typeof v === 'function' ? v(n) : v);

/** 기본 노드 폭. 종류마다 width 로 덮어쓸 수 있다. */
export const DEFAULT_W = 300;

/** 파이프라인을 왼쪽에서 오른쪽으로 훑을 때 색이 한 바퀴 도는 순서. */
export const STAGE_ACCENT = {
  run:'#4B2ED4', connect:'#0F6FB8', extract:'#0E7C86', select:'#137A57',
  format:'#6E7A12', download:'#A66A00', process:'#B4471F', store:'#A6265E', report:'#5B5566',
};

const KINDS = {};

/**
 * spec:
 *   graph      'pipeline' | 'format'   어느 캔버스에 사는가
 *   tag,label  문자열 또는 (node)=>문자열
 *   accent     색 또는 (node)=>색
 *   blurb      한 줄 설명
 *   ports      { in, out }             포트 유무
 *   protected  true 면 지울 수 없다
 *   io         true 면 흐려지지 않는다 (계속 만져야 하는 노드)
 *   width      가로 폭(px). 없으면 DEFAULT_W
 *   badge      (node)=>number          헤더의 숫자
 *   bypass     문자열                   경로에서 끊겼을 때의 배지 문구
 *   palette    number                  팔레트 노출 순서. 없으면 안 나온다
 */
export function defineKind(type, spec) {
  KINDS[type] = Object.assign({ type, ports: { in: true, out: true }, badge: () => 0 }, spec);
  return KINDS[type];
}

export const kindOf = n => KINDS[n.type];
export const kindByType = type => KINDS[type];
export const allKinds = () => Object.values(KINDS);

export const accentOf = n => call(kindOf(n).accent, n);
export const tagOf = n => call(kindOf(n).tag, n);
export const labelOf = n => call(kindOf(n).label, n);
export const blurbOf = n => call(kindOf(n).blurb, n) || '';
export const badgeOf = n => kindOf(n).badge(n) || 0;
export const hasIn = n => kindOf(n).ports.in;
export const hasOut = n => kindOf(n).ports.out;
export const isIO = n => !!kindOf(n).io;
export const widthOf = n => kindOf(n).width || DEFAULT_W;
export const widthOfType = t => (KINDS[t] && KINDS[t].width) || DEFAULT_W;
export const bypassLabelOf = n => kindOf(n).bypass || '끊김';

/** 종류 이름만 아는 곳(문제 진단 메시지 등)을 위한 표기. */
export const tagOfType = type => {
  const k = KINDS[type];
  return k ? call(k.tag, { type }) : type;
};

/** 지울 수 없는 노드 id. 각 그래프의 고정 끝점들. */
export const protectedIds = () =>
  new Set(allKinds().filter(k => k.protected).map(k => k.fixedId).filter(Boolean));

/* ── 본문 렌더러 ─────────────────────────── */
const BODIES = {};
export const defineBody = (type, fn) => { BODIES[type] = fn; };
export const bodyOf = type => BODIES[type];

/* ── 팔레트 ──────────────────────────────── */
/**
 * 캔버스에 놓을 수 있는 것들. 파이프라인은 단계 9개가 곧 항목이고,
 * 포맷은 노드 종류 자체가 항목이다.
 */
export function paletteItems(graph, stages) {
  if (graph === 'pipeline') {
    return (stages || []).map(s => ({
      key: s.id, kind: 'stage', tag: s.id, label: s.label,
      accent: STAGE_ACCENT[s.id], blurb: s.blurb,
    }));
  }
  return allKinds()
    .filter(k => k.graph === graph && k.palette != null)
    .sort((a, b) => a.palette - b.palette)
    .map(k => ({
      key: k.type, kind: k.type, tag: call(k.tag, { type: k.type }),
      label: call(k.label, { type: k.type }), accent: k.accent, blurb: k.blurb,
    }));
}

/* ══ 등록 ════════════════════════════════════ */
const countSet = n => Object.values(n.values || {}).filter(v => v !== '').length;

defineKind('source', {
  graph: 'pipeline', fixedId: 'src', protected: true, io: true,
  tag: 'source', label: '소스', accent: '#137A57',
  blurb: '명령어 맨 뒤에 붙는 대상 URL',
  ports: { in: false, out: true },
});

defineKind('sink', {
  graph: 'pipeline', fixedId: 'out', protected: true, io: true,
  tag: 'command', label: '명령어', accent: '#141C19',
  blurb: '여기까지 이어진 노드만 명령어에 들어간다',
  ports: { in: true, out: false },
});

defineKind('stage', {
  graph: 'pipeline',
  tag: n => n.stage,
  label: n => (STAGE[n.stage] || {}).label || n.stage,
  blurb: n => (STAGE[n.stage] || {}).blurb || '',
  accent: n => STAGE_ACCENT[n.stage],
  badge: countSet,
  bypass: '우회',          // 단계는 '빠진' 게 아니라 '우회된' 것이다
});

defineKind('stream', {
  graph: 'format', palette: 0,
  tag: 'stream', label: '스트림', accent: '#137A57',
  blurb: '어떤 스트림을 고를지',
  ports: { in: false, out: true },
  badge: n => (n.filters || []).length,
});

const OP_META = {
  merge:    { tag: '+', label: '병합', accent: '#0F6FB8', blurb: '영상과 음성을 한 파일로 합친다' },
  fallback: { tag: '/', label: '폴백', accent: '#A66A00', blurb: '앞의 것이 없으면 다음 것' },
  multi:    { tag: ',', label: '동시', accent: '#A6265E', blurb: '여러 포맷을 한꺼번에 받는다' },
};
FORMAT_OPS.forEach((type, i) => {
  defineKind(type, Object.assign({
    graph: 'format', palette: i + 1,
    badge: n => (n.filters || []).length,   // 그룹에도 필터가 붙는다
  }, OP_META[type]));
});

defineKind('fout', {
  graph: 'format', fixedId: 'fout', protected: true, io: true,
  tag: 'format', label: '-f 출력', accent: '#141C19',
  blurb: '여기 이어진 표현식이 --format 값이 된다',
  ports: { in: true, out: false },
});

/* ── 출력 템플릿 조각 ────────────────────── */

defineKind('text', {
  graph: 'output', palette: 0,
  tag: 'text', label: '글자', accent: '#5B5566',
  blurb: '파일명에 그대로 들어가는 글자',
  width: 170,                  // 구분자 한두 글자에 300px 은 낭비다
  ports: { in: false, out: true },
});

defineKind('field', {
  graph: 'output', palette: 1,
  tag: 'field', label: '필드', accent: '#0E7C86',
  blurb: '영상에서 값을 꺼내 채운다',
  width: 250,
  ports: { in: false, out: true },
  badge: n => (n.fallback != null ? 1 : 0) + (n.strf ? 1 : 0),
});

defineKind('oout', {
  graph: 'output', fixedId: 'oout', protected: true, io: true,
  tag: 'output', label: '-o 출력', accent: '#141C19',
  blurb: '여기 이어진 조각들이 --output 값이 된다',
  width: 280,
  ports: { in: true, out: false },
});

/* ── 경로 항목 ───────────────────────────── */

defineKind('path', {
  graph: 'paths', palette: 0,
  tag: 'path', label: '경로', accent: '#A6265E',
  blurb: '어떤 종류의 파일을 어디에 둘지',
  width: 300,
  ports: { in: false, out: true },
});

defineKind('pout', {
  graph: 'paths', fixedId: 'pout', protected: true, io: true,
  tag: 'paths', label: '-P 출력', accent: '#141C19',
  blurb: '여기 이어진 항목이 --paths 값이 된다',
  width: 300,
  ports: { in: true, out: false },
});
