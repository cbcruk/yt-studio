/**
 * 파일 시스템이 없는 곳에서 쓰는 입구 — 브라우저 · 엣지 런타임.
 *
 *     import { studio } from 'ytstudio/browser';
 *
 *     const yt = studio(await (await fetch('/ytstudio.schema.json')).json());
 *     yt.ytdlp('https://youtu.be/abc').extractAudio().build();
 *
 * `ytstudio` 본체(`index.ts`)가 하는 일 가운데 노드가 필요한 것은 **스키마를
 * 어디서 집을까**뿐이다 — 환경변수, 작업 디렉터리, 패키지에 실린 파일. 그
 * 한 겹만 걷어내면 나머지는 전부 순수하다. 그래서 이 파일이 진짜 알맹이고
 * `index.ts` 는 여기에 파일 읽기를 얹은 것이다.
 *
 * 여기서는 스키마를 **직접 준다.** 찾아 줄 곳이 없으니 물어보지 않는다.
 */
import { buildSchema } from './core/schema.js';
import { lintCommand as lintWith, nearestFlags as nearestWith } from './core/lint.js';
import { explainCommand as explainWith, suggestNext as suggestWith } from './core/explain.js';
import { scanCommand as scanWith } from './core/command.js';
import { makeYtdlp } from './core/build.js';
import { TYPES_VERSION } from './core/options.gen.js';
import type { RawSchema, Schema } from './core/schema.js';
import type { Ytdlp } from './core/build.js';
import type { Item } from './core/command.js';
import type { Explained, Suggestion } from './core/explain.js';
import type { LintResult, Values } from './core/lint.js';

/** 스키마를 어디서 읽었나. */
export type SchemaOrigin =
  /** `YTSTUDIO_SCHEMA` 가 가리킨 곳 */
  | 'env'
  /** 작업 디렉터리의 `ytstudio.schema.json` */
  | 'local'
  /** 패키지에 같이 실려 온 것 */
  | 'bundled'
  /** 손님이 손에 들고 넘긴 것 — 찾은 적이 없다 */
  | 'given';

/**
 * 지금 검증기가 무엇에 대조하고 있는지.
 *
 * 이 패키지에는 층이 둘인데 **둘의 출처가 다를 수 있다.**
 *
 *   · **런타임** (`lint` · `ytdlp()` 메서드) 은 넘겨받은 스키마를 보므로
 *     당신이 깐 yt-dlp 를 볼 수 있다.
 *   · **타입** (`.d.ts` · 자동완성) 은 패키지를 구울 때 이미 박혔다. 바꿀 수 없다.
 *
 * `stale` 이 참이면 그 둘이 갈렸다는 뜻이다 — 검사 결과는 당신의 yt-dlp 기준으로
 * 맞지만, 에디터가 주는 목록은 `typesVersion` 기준이라 어긋난다.
 */
export interface SchemaSource {
  from: SchemaOrigin;
  /** 실제로 읽은 파일의 절대 경로. 직접 준 것이면 그렇다고 적힌다. */
  path: string;
  /** 검증기가 대조하는 yt-dlp 버전. */
  version: string;
  /** 타입과 자동완성이 나온 yt-dlp 버전. 패키지에 박혀 있다. */
  typesVersion: string;
  /** 둘이 다른가. 참이면 자동완성을 믿을 수 없다. */
  stale: boolean;
}

/**
 * 스키마 하나에 묶인 손잡이. 이 패키지의 입구다.
 *
 * 여기 있는 것 전부가 **같은 스키마**를 본다. 손잡이를 둘 만들면 스키마 둘을
 * 나란히 들 수 있고, 서로를 안 건드린다.
 */
export interface Ytstudio {
  /** 어디서 왔든 명령어 문자열을 검사한다. */
  lint(text: string): LintResult;
  /** 코드로 명령어를 만든다. */
  ytdlp(...urls: string[]): Ytdlp;
  /** 명령어 문자열 → 항목 수열. */
  scan(text: string): { head: string | null; items: Item[] };
  /** 토큰마다 무슨 옵션인지. */
  explain(items: Item[]): Explained[];
  /** 지금 조합에서 이어서 줄 만한 것. */
  suggest(values: Values, limit?: number): Suggestion[];
  /** 오타라면 무엇을 쓰려던 건가. */
  nearest(flag: string, limit?: number): string[];
  /** 이 손잡이가 무엇에 대조하는지. */
  readonly source: SchemaSource;
  /** 색인까지 붙은 스키마. 직접 뒤져야 할 때만. */
  readonly schema: Schema;
}

/**
 * 스키마 한 벌에 손잡이 하나.
 *
 * 출처(`source`)를 같이 줄 수 있다 — `index.ts` 가 파일에서 찾아왔을 때
 * 어디서 찾았는지를 여기 얹는다. 안 주면 "직접 준 것"이다.
 */
export function studio(raw: RawSchema, source?: SchemaSource): Ytstudio {
  const schema = buildSchema(raw);
  const ytdlpOf = makeYtdlp(schema);

  return {
    lint: text => lintWith(schema, text),
    ytdlp: (...urls) => ytdlpOf(...urls),
    scan: text => scanWith(schema, text),
    explain: items => explainWith(schema, items),
    suggest: (values, limit) => suggestWith(schema, values, limit),
    nearest: (flag, limit) => nearestWith(schema, flag, limit),
    source: source ?? given(raw),
    schema,
  };
}

/** 찾은 적 없이 손에 들고 온 스키마의 출처. */
export const given = (raw: RawSchema): SchemaSource => ({
  from: 'given',
  path: '(직접 준 것)',
  version: raw.ytdlp_version,
  typesVersion: TYPES_VERSION,
  stale: raw.ytdlp_version !== TYPES_VERSION,
});

/** 자동완성과 `.d.ts` 가 나온 yt-dlp 버전. 패키지를 구울 때 박힌다. */
export { TYPES_VERSION } from './core/options.gen.js';

/** 스키마를 안 보는 것들 — 문자열만 다룬다. */
export { tokenize, quote } from './core/command.js';
export { distance, LEVELS } from './core/lint.js';
export { previewFilename, DEFAULT_OUTTMPL } from './core/explain.js';

export type { Issue, Level, LintResult, Values } from './core/lint.js';
export type { FilePreview, Explained, Suggestion } from './core/explain.js';
export type { Item, UnknownWhy } from './core/command.js';
export type { Opt, OptKind, RawSchema, Schema, SchemaFrom, Stage } from './core/schema.js';

/**
 * 식과 조각의 타입.
 *
 * 값으로는 안 내보낸다 — `f.bv()` 와 `t.title` 이 이미 만들어서 주므로 손님이
 * `new` 할 일이 없다. 대신 헬퍼 함수 시그니처에 적을 일은 있어서 타입은 낸다.
 */
export type { Expr, FormatFactory, OutTag, Piece, Template, Ytdlp } from './core/build.js';
export type {
  Arg, Conversion, FieldPiece, Filter, Filters, FormatNode, NumCond, OutField,
  OutNode, OutType, PathMap, Selector, StrCond, Version,
} from './core/build.js';
