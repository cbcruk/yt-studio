/**
 * 공개 API.
 *
 * `core/` 는 파일 시스템을 모른다는 규칙이 있어서, 스키마를 읽어 넣는 일은
 * 여기서 한다. **로컬 우선**이다 — 작업 디렉터리에 `ytstudio.schema.json` 이
 * 있으면 그걸 보고, 없으면 패키지에 실려 온 것을 본다. 자세한 것은
 * `SchemaSource`.
 *
 * 내보내는 것이 둘이다.
 *
 *   **빌더** — 코드로 명령어를 만든다. 타입이 옵션 카탈로그다.
 *   **검증기** — 어디서 왔든 명령어 문자열을 검사한다.
 *
 * 둘째가 빠지면 안 된다. 빌더는 빌더로 쓴 것만 보지만, 블로그에서 주웠거나
 * 동료가 붙여넣었거나 LLM 이 준 명령어는 문자열로 온다. 그걸 설치된 yt-dlp 에
 * 대조하는 게 이 패키지가 하는 유일무이한 일이다.
 *
 *     import { ytdlp, lintCommand } from 'ytstudio';
 *
 *     ytdlp('https://youtu.be/abc')
 *       .format(f => f.bv({ height: { lte: 1080 } }).plus(f.ba()).or(f.b()))
 *       .output(t => t`${t.title} [${t.id}].${t.ext}`)
 *       .build();
 *
 *     lintCommand('yt-dlp --write-sub https://youtu.be/abc').issues;
 *     // [{ level: 'error', msg: '--write-sub 는 이 yt-dlp 버전에 없는 …' }]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initSchema } from './core/schema.js';
import type { RawSchema } from './core/schema.js';

/**
 * 로컬 스키마 파일 이름.
 *
 * 그냥 `schema.json` 이면 남의 프로젝트 루트에서 JSON Schema 와 부딪힌다 —
 * 흔한 이름이다. 이름에 패키지를 박아 두면 그 자리에 있는 이유가 파일 이름에
 * 적혀 있다.
 */
const SCHEMA_FILE = 'ytstudio.schema.json';

/** 스키마를 어디서 읽었나. */
export type SchemaOrigin =
  /** `YTSTUDIO_SCHEMA` 가 가리킨 곳 */
  | 'env'
  /** 작업 디렉터리의 `ytstudio.schema.json` */
  | 'local'
  /** 패키지에 같이 실려 온 것 */
  | 'bundled';

/**
 * 지금 검증기가 무엇에 대조하고 있는지.
 *
 * 이 패키지에는 층이 둘인데 **둘의 출처가 다를 수 있다.**
 *
 *   · **런타임** (`lintCommand` · `ytdlp()` 메서드) 은 파일을 읽으므로
 *     당신이 깐 yt-dlp 를 볼 수 있다.
 *   · **타입** (`.d.ts` · 자동완성) 은 패키지를 구울 때 이미 박혔다. 바꿀 수 없다.
 *
 * `stale` 이 참이면 그 둘이 갈렸다는 뜻이다 — 검사 결과는 당신의 yt-dlp 기준으로
 * 맞지만, 에디터가 주는 목록은 `typesVersion` 기준이라 어긋난다.
 */
export interface SchemaSource {
  from: SchemaOrigin;
  /** 실제로 읽은 파일의 절대 경로. */
  path: string;
  /** 검증기가 대조하는 yt-dlp 버전. */
  version: string;
  /** 타입과 자동완성이 나온 yt-dlp 버전. 패키지에 박혀 있다. */
  typesVersion: string;
  /** 둘이 다른가. 참이면 자동완성을 믿을 수 없다. */
  stale: boolean;
}

/**
 * 그럴듯한 JSON 이 전부 우리 스키마는 아니다.
 *
 * 작업 디렉터리를 뒤지는 이상 남의 파일을 집을 수 있으므로, 모양을 보고
 * 아니면 없는 것으로 친다. 못 읽는 것과 우리 것이 아닌 것을 갈라 볼 이유가
 * 없다 — 둘 다 "여기엔 없다"다.
 */
function readSchema(path: string): RawSchema | null {
  try {
    const v = JSON.parse(readFileSync(path, 'utf8'));
    if (v && typeof v.ytdlp_version === 'string' && Array.isArray(v.options)) return v;
  } catch { /* 없거나 깨졌거나 남의 것이다 */ }
  return null;
}

const bundledPath = fileURLToPath(new URL(`../${SCHEMA_FILE}`, import.meta.url));

/** 패키지에 실려 온 것. 이게 없으면 타입도 없다는 뜻이라 살릴 방법이 없다. */
function readBundled(): RawSchema {
  const raw = readSchema(bundledPath);
  if (!raw) throw new Error(`패키지에 ${SCHEMA_FILE} 이 없다 — 설치가 깨졌다`);
  return raw;
}
const bundled = readBundled();

/**
 * 로컬 우선, 없으면 패키지에 실린 것.
 *
 * 순서가 이런 이유는 검증기의 값어치가 **설치된 실물과 대조하는 것**에 있어서다.
 * 패키지에 실린 스키마는 이 저장소를 구울 때의 yt-dlp 이지 당신 것이 아니다.
 */
function pickSchema(): { from: SchemaOrigin; path: string; raw: RawSchema } {
  const env = process.env.YTSTUDIO_SCHEMA;
  if (env) {
    // 명시적으로 가리킨 것이 안 읽히면 조용히 넘어가지 않는다. 그건 오타이고,
    // 조용히 넘어가면 엉뚱한 버전으로 검사해 놓고 통과했다고 말하게 된다.
    const path = resolve(env);
    const raw = readSchema(path);
    if (!raw) throw new Error(`YTSTUDIO_SCHEMA 가 가리키는 스키마를 읽지 못했다: ${path}`);
    return { from: 'env', path, raw };
  }

  const path = resolve(process.cwd(), SCHEMA_FILE);
  const raw = readSchema(path);
  if (raw) return { from: 'local', path, raw };

  return { from: 'bundled', path: bundledPath, raw: bundled };
}

const picked = pickSchema();
initSchema(picked.raw);

/** 지금 검증기가 무엇에 대조하고 있는지. */
export const SCHEMA_SOURCE: SchemaSource = {
  from: picked.from,
  path: picked.path,
  version: picked.raw.ytdlp_version,
  typesVersion: bundled.ytdlp_version,
  stale: picked.raw.ytdlp_version !== bundled.ytdlp_version,
};

/**
 * 검증기와 빌더 메서드가 대조하는 yt-dlp 버전.
 *
 * **타입이 나온 버전과 다를 수 있다** — 로컬 스키마를 집었으면 이쪽이 당신 것을
 * 따라가고 타입은 패키지에 박힌 채로 남는다. 둘 다 보려면 `SCHEMA_SOURCE`.
 */
export const YTDLP_VERSION: string = SCHEMA_SOURCE.version;

/**
 * 빌더 — `ytdlp()` 와 그것이 쓰는 타입 전부.
 *
 * 옵션 메서드 188개는 스키마에서 자라므로 여기 이름이 하나씩 적혀 있지 않다.
 * 무엇이 있는지는 에디터가 안다.
 */
export * from './core/build.js';

/**
 * 검증기 — 어디서 왔든 명령어 문자열을 본다.
 *
 * 빌더가 못 하는 일이다. 빌더는 빌더로 쓴 것만 보지만, 블로그에서 주웠거나
 * 동료가 붙여넣었거나 LLM 이 준 명령어는 문자열로 온다.
 */
export { lintCommand, nearestFlags, distance, LEVELS } from './core/lint.js';
export type { Issue, Level, LintResult, Values } from './core/lint.js';

/** 명령어를 사람 말로 — 만들 파일명 · 토큰별 설명 · 다음 걸음. */
export {
  previewFilename, explainCommand, explainItem, suggestNext, DEFAULT_OUTTMPL,
} from './core/explain.js';
export type { FilePreview, Explained, Suggestion } from './core/explain.js';

/** 명령어 문자열을 읽고 쓰는 밑바닥. 직접 다뤄야 할 때만. */
export { scanCommand, tokenize, quote } from './core/command.js';
export type { Item, UnknownWhy } from './core/command.js';
