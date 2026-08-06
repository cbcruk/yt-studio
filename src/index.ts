/**
 * 공개 API.
 *
 * `core/` 는 파일 시스템을 모른다는 규칙이 있어서, 스키마를 읽어 넣는 일은
 * 여기서 한다.
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

import { initSchema } from './core/schema.js';

const raw = JSON.parse(
  readFileSync(new URL('../schema.json', import.meta.url), 'utf8'),
);
initSchema(raw);

/** 이 타입과 메서드가 나온 yt-dlp 버전. */
export const YTDLP_VERSION: string = raw.ytdlp_version;

/**
 * 빌더 — `ytdlp()` 와 그것이 쓰는 타입 전부.
 *
 * 옵션 메서드 188개는 `schema.json` 에서 자라므로 여기 이름이 하나씩 적혀
 * 있지 않다. 무엇이 있는지는 에디터가 안다.
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
