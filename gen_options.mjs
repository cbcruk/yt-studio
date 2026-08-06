/**
 * schema.json → src/core/options.gen.ts
 *
 * gen_schema.py 가 설치된 yt-dlp 를 리플렉션해서 schema.json 을 떨구고, 이
 * 파일이 그걸 **타입**으로 옮긴다. 그래서 자동완성에 뜨는 옵션 = 당신이 깐
 * yt-dlp 의 옵션이다. 모델의 기억에서 나온 게 아니다.
 *
 * 검증기가 런타임에 하던 일의 절반이 여기서 컴파일 타임으로 올라간다 —
 * 없는 플래그는 없는 메서드가 되고, choices 는 유니온이 된다.
 *
 * 내는 것은 타입뿐이다. 런타임 메서드는 build.ts 가 같은 스키마에서 기른다.
 * 한 곳(schema.json)에서 둘이 같이 나오므로 어긋날 수가 없다.
 *
 *   node gen_options.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { FKEYS, SELECTORS, SEL_HELP } from './src/core/format-grammar.js';
import { CONVERSIONS, FIELDS, FIELD_HELP, OUT_TYPES } from './src/core/output-template.js';

const SCHEMA = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url), 'utf8'));

/* ── 이름 규칙 (build.ts 와 같아야 한다) ──── */
const methodName = flag =>
  String(flag).replace(/^--?/, '').replace(/-+([a-z0-9])/g, (_, c) => c.toUpperCase());
const selMethod = sel => sel.replace('*', 'Star');

// 도움말을 JSDoc 안에 안전하게 넣는다. 닫는 기호가 그대로 들어오면 주석이
// 거기서 끝나 버린다 — 방금 이 파일이 그것 때문에 한 번 깨졌다.
const doc = s => String(s || '').replace(/\*\//g, '*\\/').replace(/\s+/g, ' ').trim();
const union = xs => xs.map(x => `'${x}'`).join(' | ');

/* ── 어휘 ────────────────────────────────── */
const SELS = SELECTORS.flatMap(([, items]) => items.map(([k]) => k));
const OUT_FIELDS = FIELDS.flatMap(([, items]) => items.map(([k]) => k));
const TYPES = OUT_TYPES.map(([v]) => v).filter(Boolean);

const fkeyDoc = k => doc((FKEYS.find(([n]) => n === k) || [])[1]);
const filterProps = FKEYS.map(([k, , t]) =>
  `  /** ${fkeyDoc(k)} */\n  ${k}?: ${t === 'num' ? 'number | NumCond' : 'string | StrCond'} | boolean;`,
).join('\n');

/* ── 191개 옵션 ──────────────────────────── */
// -f · -o · -P 는 값 자체가 구조라 build.ts 가 손으로 쓴 시그니처를 갖는다.
const HAND_WRITTEN = new Set(['format', 'output', 'paths']);

function optionMethod(o) {
  const name = methodName(o.flag);
  const alias = [o.short, ...(o.aliases || [])].filter(Boolean);
  const lines = [
    '  /**',
    `   * \`${o.flag}\`${alias.length ? ` (${alias.join(' · ')})` : ''} — ${doc(o.help)}`,
    '   *',
    `   * @stage ${o.stage} · ${doc(o.group)}`,
  ];
  if (o.negation) lines.push(`   * @remarks \`.${name}(false)\` → \`${o.negation}\``);
  lines.push('   */');

  const sig = o.kind === 'flag' ? 'on?: boolean'
    : o.kind === 'choice' ? `value: ${union(o.choices)}`
      : o.kind === 'repeatable' ? '...values: Arg[]'
        : `value: Arg`;
  lines.push(`  ${name}(${sig}): this;`);
  return lines.join('\n');
}

const optionMethods = SCHEMA.options
  .filter(o => !HAND_WRITTEN.has(o.id))
  .map(optionMethod).join('\n\n');

/* ── 조립 ────────────────────────────────── */
const out = `/* eslint-disable */
// 이 파일은 gen_options.mjs 가 schema.json 에서 만든다. 손으로 고치지 말 것.
//
//   yt-dlp ${SCHEMA.ytdlp_version} · 옵션 ${SCHEMA.options.length}개
//   node gen_options.mjs

/** 이 타입들이 나온 yt-dlp 버전. */
export type Version = '${SCHEMA.ytdlp_version}';

/** 값을 받는 옵션에 줄 수 있는 것. */
export type Arg = string | number;

/* ── 포맷 셀렉터 (-f) ────────────────────── */
export type Selector = ${union(SELS)};

/** 셀렉터 팩토리의 메서드 이름. \`*\` 는 \`Star\` 로 옮긴다. */
export type SelMethod = ${union(SELS.map(selMethod))};

/**
 * 셀렉터 팩토리.
 *
 * 식 타입을 인자로 받는다 — build.ts 의 \`Expr\` 를 여기서 import 하면 순환이
 * 되고, 매핑 타입(\`{ [K in SelMethod]: … }\`)으로 쓰면 셀렉터마다 붙은 설명이
 * 사라진다. 그 설명이 에디터에 뜨라고 만든 파일이므로 한 줄씩 편다.
 */
export interface FormatFactory<E> {
${SELS.map(s => `  /** \`${s}\` — ${doc(SEL_HELP[s])} */\n  ${selMethod(s)}(filters?: Filters): E;`).join('\n')}
  /** 문법을 벗어나야 할 때. 검사 없이 그대로 나간다. */
  raw(selector: string): E;
}

/** 숫자 필드 비교. \`loose\` 는 그 값이 없는 포맷도 통과시킨다 (\`height<=?1080\`). */
export interface NumCond {
  lt?: number; lte?: number; gt?: number; gte?: number; eq?: number; ne?: number;
  loose?: boolean;
}

/** 문자 필드 비교. */
export interface StrCond {
  eq?: string; ne?: string;
  startsWith?: string; endsWith?: string; includes?: string; matches?: string;
  notStartsWith?: string; notEndsWith?: string; notIncludes?: string; notMatches?: string;
  loose?: boolean;
}

/**
 * 포맷 필터.
 *
 * 값을 그냥 주면 \`=\` 비교이고, \`true\`/\`false\` 는 있음/없음이다.
 *
 *     { height: { lte: 1080 }, ext: 'mp4', format_note: false }
 *     → [height<=1080][ext=mp4][!format_note]
 */
export interface Filters {
${filterProps}
}

/* ── 출력 템플릿 (-o) ────────────────────── */
export type OutField = ${union(OUT_FIELDS)};
export type OutType = ${union(TYPES)};
export type Conversion = ${union(CONVERSIONS.map(([c]) => c))};

/**
 * 템플릿 태그에 달리는 필드 접근자.
 *
 * 이름은 yt-dlp 것을 그대로 쓴다. camelCase 로 옮기면 예뻐지지만 yt-dlp
 * 문서에서 찾을 수 없는 이름이 된다.
 */
export interface OutFields<P> {
${OUT_FIELDS.map(f => `  /** \`%(${f})s\` — ${doc(FIELD_HELP[f])} */\n  readonly ${f}: P;`).join('\n')}
}

/* ── 저장 경로 (-P) ──────────────────────── */
export interface PathMap {
  /** 받은 파일이 최종적으로 놓일 곳. */
  home?: string;
  /** 받는 동안 쓰는 임시 자리. */
  temp?: string;
${TYPES.map(t => `  ${t}?: string;`).join('\n')}
}

/* ── 191개 옵션 ──────────────────────────── */
/**
 * 설치된 yt-dlp 의 옵션 전부.
 *
 * \`Ytdlp\` 클래스와 선언 병합된다 — 런타임 메서드는 build.ts 가 같은
 * schema.json 에서 기르므로 이 인터페이스와 늘 짝이 맞는다.
 */
export interface Options {
${optionMethods}
}
`;

writeFileSync(new URL('./src/core/options.gen.ts', import.meta.url), out);
console.log(`options.gen.ts — 옵션 ${SCHEMA.options.length}개 · yt-dlp ${SCHEMA.ytdlp_version}`);
