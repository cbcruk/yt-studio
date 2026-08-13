/**
 * 공개 API.
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
 *
 * **이 파일이 얹는 것은 스키마를 어디서 집을까 한 겹뿐이다.** 알맹이는
 * `browser.ts` 에 있고 여기서 전부 다시 내보낸다 — 그쪽은 파일 시스템을 모르므로
 * 브라우저에서도 돈다(`ytstudio/browser`).
 *
 * **로컬 우선**이다 — 작업 디렉터리에 `ytstudio.schema.json` 이 있으면 그걸 보고,
 * 없으면 패키지에 실려 온 것을 본다. 자세한 것은 `SchemaSource`.
 *
 * 스키마는 **값**이라 손잡이(`ytstudio()`)가 들고 다닌다. 평평한 함수들
 * (`lintCommand` 등)은 게으르게 만든 기본 손잡이에 얹혀 있다 — 편의일 뿐
 * 특별한 것이 아니라서, 손잡이를 직접 만들면 스키마 둘을 나란히 들 수 있다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { studio, TYPES_VERSION } from './browser.js';
import type { SchemaOrigin, SchemaSource, Ytstudio } from './browser.js';
import type { RawSchema } from './core/schema.js';
import type { Ytdlp } from './core/build.js';
import type { Item } from './core/command.js';
import type { Explained, Suggestion } from './core/explain.js';
import type { LintResult, Values } from './core/lint.js';

export * from './browser.js';

/**
 * 로컬 스키마 파일 이름.
 *
 * 그냥 `schema.json` 이면 남의 프로젝트 루트에서 JSON Schema 와 부딪힌다 —
 * 흔한 이름이다. 이름에 패키지를 박아 두면 그 자리에 있는 이유가 파일 이름에
 * 적혀 있다.
 */
const SCHEMA_FILE = 'ytstudio.schema.json';

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

/**
 * 패키지에 실려 온 스키마 그대로.
 *
 * **타입이 나온 자리**라서 `ytstudio types` 가 기준선으로 쓴다 — 만드는 `.d.ts`
 * 가 이걸 확장하므로, "새 옵션"은 늘 이것 대비여야 한다. 지금 켜진 스키마를
 * 기준으로 잡으면 두 번째 실행부터 어긋난다.
 */
export const BUNDLED: RawSchema = readBundled();

/** 스키마를 어디서 찾을지. 안 주면 프로세스의 것을 쓴다. */
export interface Where {
  /** `ytstudio.schema.json` 을 찾을 디렉터리. */
  cwd?: string;
  /** `YTSTUDIO_SCHEMA` 대신 쓸 경로. */
  env?: string;
}

/**
 * 로컬 우선, 없으면 패키지에 실린 것.
 *
 * 순서가 이런 이유는 검증기의 값어치가 **설치된 실물과 대조하는 것**에 있어서다.
 * 패키지에 실린 스키마는 이 저장소를 구울 때의 yt-dlp 이지 당신 것이 아니다.
 *
 * 순수 함수다 — 부르면 결과를 주고 아무것도 안 바꾼다. 그리고 **작업 디렉터리와
 * 환경변수를 인자로 받는다.** 안 주면 프로세스 것을 쓴다. 검사가 그 둘을 넘길
 * 수 있어야 `process.chdir` 로 프로세스 전체를 흔들지 않는다.
 */
export function resolveSchema(at: Where = {}): { source: SchemaSource; raw: RawSchema } {
  const found = (from: SchemaOrigin, path: string, raw: RawSchema) => ({
    source: {
      from, path,
      version: raw.ytdlp_version,
      typesVersion: TYPES_VERSION,
      stale: raw.ytdlp_version !== TYPES_VERSION,
    },
    raw,
  });

  const env = at.env ?? process.env.YTSTUDIO_SCHEMA;
  if (env) {
    // 명시적으로 가리킨 것이 안 읽히면 조용히 넘어가지 않는다. 그건 오타이고,
    // 조용히 넘어가면 엉뚱한 버전으로 검사해 놓고 통과했다고 말하게 된다.
    const path = resolve(env);
    const raw = readSchema(path);
    if (!raw) throw new Error(`YTSTUDIO_SCHEMA 가 가리키는 스키마를 읽지 못했다: ${path}`);
    return found('env', path, raw);
  }

  const path = resolve(at.cwd ?? process.cwd(), SCHEMA_FILE);
  const raw = readSchema(path);
  if (raw) return found('local', path, raw);

  return found('bundled', bundledPath, BUNDLED);
}

/**
 * 손잡이를 만든다.
 *
 * 인자가 없으면 `resolveSchema()` 로 찾는다(환경변수 → 작업 디렉터리 → 내장).
 * 스키마를 직접 주면 그걸 쓴다 — 검사가 그 길로 프로세스를 안 갈라도 된다.
 */
export function ytstudio(opts: Where & { raw?: RawSchema } = {}): Ytstudio {
  if (opts.raw) return studio(opts.raw);
  const { source, raw } = resolveSchema(opts);
  return studio(raw, source);
}

/**
 * 기본 손잡이. 평평한 함수들이 여기 얹혀 있다.
 *
 * **게으르다** — 처음 쓸 때 만든다. 모듈 본문에서 만들면 import 만 해도 파일
 * 시스템을 뒤지게 되고, 스키마를 직접 주려던 사람에게도 그 값을 물린다.
 */
let fallback: Ytstudio | null = null;
const def = (): Ytstudio => (fallback ??= ytstudio());

/**
 * 검증기 — 어디서 왔든 명령어 문자열을 본다.
 *
 * 빌더가 못 하는 일이다. 빌더는 빌더로 쓴 것만 보지만, 블로그에서 주웠거나
 * 동료가 붙여넣었거나 LLM 이 준 명령어는 문자열로 온다.
 */
export const lintCommand = (text: string): LintResult => def().lint(text);

/** 새 명령어를 시작한다. 메서드 188개는 스키마에서 자란다. */
export const ytdlp = (...urls: string[]): Ytdlp => def().ytdlp(...urls);

/** 명령어를 사람 말로 — 토큰별 설명 · 다음 걸음. */
export const explainCommand = (items: Item[]): Explained[] => def().explain(items);
export const suggestNext = (values: Values, limit?: number): Suggestion[] =>
  def().suggest(values, limit);

/** 명령어 문자열을 읽는 밑바닥. 직접 다뤄야 할 때만. */
export const scanCommand = (text: string): { head: string | null; items: Item[] } =>
  def().scan(text);

/** 오타라면 무엇을 쓰려던 건가. */
export const nearestFlags = (flag: string, limit?: number): string[] =>
  def().nearest(flag, limit);

/**
 * 기본 손잡이가 무엇에 대조하는지.
 *
 * 함수다 — 상수로 두면 import 만 해도 파일 시스템을 뒤지게 되고, 무엇보다
 * **어느 손잡이의 것이냐**에 답할 수가 없다. 손잡이를 만들었으면 `yt.source`.
 */
export const schemaSource = (): SchemaSource => def().source;

/** 토큰 하나만 읽어 준다. 여럿이면 `explainCommand`. */
export const explainItem = (item: Item): Explained => def().explain([item])[0]!;
