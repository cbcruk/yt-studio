/**
 * ytstudio.schema.json → src/core/options.gen.ts
 *
 * gen_schema.py 가 설치된 yt-dlp 를 리플렉션해서 ytstudio.schema.json 을
 * 떨구고, 이 파일이 그걸 **타입**으로 옮긴다. 그래서 자동완성에 뜨는 옵션 =
 * 이 저장소를 구울 때의 yt-dlp 옵션이다. 모델의 기억에서 나온 게 아니다.
 *
 * 검증기는 런타임에 로컬 스키마를 집을 수 있지만(src/index.ts) 타입은 못
 * 바꾼다 — 여기서 나온 파일이 그대로 .d.ts 가 되어 배포된다.
 *
 * 검증기가 런타임에 하던 일의 절반이 여기서 컴파일 타임으로 올라간다 —
 * 없는 플래그는 없는 메서드가 되고, choices 는 유니온이 된다.
 *
 * 내는 것은 타입뿐이다. 런타임 메서드는 build.ts 가 같은 스키마에서 기른다.
 * 한 곳(ytstudio.schema.json)에서 둘이 같이 나오므로 어긋날 수가 없다.
 *
 *   bun gen_options.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';

// 이름 규칙 · JSDoc 이스케이프 · 메서드 시그니처는 여기 한 벌만 있다.
// `ytstudio types` 도 같은 것을 쓴다 — 두 생성기가 같은 모양을 내야 한다.
import { HAND_WRITTEN, doc, optionMethod, selMethod, union } from './src/core/env-types.js';
import { FKEYS, SELECTORS, SEL_HELP } from './src/core/format-grammar.js';
import { CONVERSIONS, FIELDS, FIELD_HELP, OUT_TYPES } from './src/core/output-template.js';
import type { RawSchema } from './src/core/schema.js';

const SCHEMA: RawSchema = JSON.parse(
  readFileSync(new URL('./ytstudio.schema.json', import.meta.url), 'utf8'),
);


// 어휘 표들은 손으로 적는 층이다(format-grammar.ts · output-template.ts).
// 자동완성에 뜨는 한국어 설명이 전부 거기서 나온다.
/** 스키마가 들고 온 자리별 어휘. 없으면 그 자리에서 죽는다 — 조용히 빈 유니온이
 * 되면 `Browser` 가 `never` 가 되고, 멀쩡한 코드가 전부 타입 오류가 된다. */
const vocabOf = (id: string, slot: string): string[] => {
  const v = SCHEMA.options.find(o => o.id === id)?.vocabs?.[slot];
  if (!v?.length) throw new Error(`스키마에 ${id} 의 ${slot} 어휘가 없다`);
  return v;
};

const SELS = SELECTORS.flatMap(([, items]) => items.map(([k]) => k));
const OUT_FIELDS = FIELDS.flatMap(([, items]) => items.map(([k]) => k));
const TYPES = OUT_TYPES.map(([v]) => v).filter(Boolean);

const fkeyDoc = (k: string): string => doc((FKEYS.find(([n]) => n === k) || ['', ''])[1]);
const filterProps = FKEYS.map(([k, , t]) =>
  `  /** ${fkeyDoc(k)} */\n  ${k}?: ${t === 'num' ? 'number | NumCond' : 'string | StrCond'} | boolean;`,
).join('\n');

// map 에 그대로 넘기면 안 된다 — optionMethod 의 둘째 인자에 인덱스가 꽂힌다.
const optionMethods = SCHEMA.options
  .filter(o => !HAND_WRITTEN.has(o.id))
  .map(o => optionMethod(o)).join('\n\n');

const out = `// 이 파일은 gen_options.ts 가 ytstudio.schema.json 에서 만든다. 손으로 고치지 말 것.
//
//   yt-dlp ${SCHEMA.ytdlp_version} · 옵션 ${SCHEMA.options.length}개
//   bun gen_options.ts

/** 이 타입들이 나온 yt-dlp 버전. */
export type Version = '${SCHEMA.ytdlp_version}';

/**
 * 같은 것을 **값으로도** 낸다.
 *
 * 타입만으로는 런타임에 "자동완성이 어느 버전에서 나왔나"에 답할 수가 없다.
 * 예전에는 그 답을 패키지에 실린 스키마 파일을 읽어서 냈는데, 그러면 파일
 * 시스템이 없는 곳(브라우저)에서는 물어볼 수조차 없었다. 생성된 값이라
 * 위의 타입과 어긋날 수가 없다.
 */
export const TYPES_VERSION: Version = '${SCHEMA.ytdlp_version}';

/** 값을 받는 옵션에 줄 수 있는 것. */
export type Arg = string | number;

/** \`--cookies-from-browser\` 가 쿠키를 읽을 수 있는 브라우저. */
export type Browser = ${union(vocabOf('cookies-from-browser', 'browser'))};

/** 리눅스에서 크로미움 계열 쿠키를 푸는 키체인. */
export type Keyring = ${union(vocabOf('cookies-from-browser', 'keyring'))};

/** \`-f\` 가 받는 셀렉터. 빌더에서는 \`f.bv()\` 처럼 메서드가 된다. */
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

/** \`-o\` 템플릿에 자주 쓰는 필드. 나머지는 \`t.field('이름')\` 으로. */
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

/** \`-P\` 에 줄 수 있는 경로. \`home\` 만 접두어 없이 나간다. */
export interface PathMap {
  /** 받은 파일이 최종적으로 놓일 곳. */
  home?: string;
  /** 받는 동안 쓰는 임시 자리. */
  temp?: string;
${TYPES.map(t => `  ${t}?: string;`).join('\n')}
}

/**
 * 설치된 yt-dlp 의 옵션 전부.
 *
 * \`Ytdlp\` 클래스와 선언 병합된다 — 런타임 메서드는 build.ts 가 같은
 * ytstudio.schema.json 에서 기르므로 이 인터페이스와 늘 짝이 맞는다.
 */
export interface Options {
${optionMethods}
}
`;

writeFileSync(new URL('./src/core/options.gen.ts', import.meta.url), out);
console.log(`options.gen.ts — 옵션 ${SCHEMA.options.length}개 · yt-dlp ${SCHEMA.ytdlp_version}`);
