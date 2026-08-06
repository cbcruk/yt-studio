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

import { lintCommand as lintRaw } from './core/lint.js';
import { previewFilename as previewRaw } from './core/explain.js';
import type { Issue } from './core/build.js';

export interface LintResult {
  /** 토큰 하나하나. `kind` 는 `url` · `opt` · `unknown`. */
  items: { kind: 'url' | 'opt' | 'unknown'; raw: string; [k: string]: unknown }[];
  urls: string[];
  /** 옵션 id → 값. 플래그는 boolean, repeatable 은 배열. */
  values: Record<string, string | boolean | string[]>;
  issues: Issue[];
  /** 오류가 하나도 없으면 참. 경고는 여기 안 센다. */
  ok: boolean;
  counts: { error: number; warn: number; info: number; opts: number; total: number };
}

/**
 * 명령어 문자열을 설치된 yt-dlp 에 대조한다.
 *
 * 빌더로 만들지 **않은** 것도 본다 — 그게 이 함수가 있는 이유다.
 */
export const lintCommand = (text: string): LintResult => lintRaw(text) as LintResult;

export interface FilePreview {
  /** `-o` 를 읽지 못했으면 거짓. 그때 `text` 는 원문 그대로다. */
  ok: boolean;
  /** `-o` 앞에 붙은 종류 접두어(`thumbnail:` 의 `thumbnail`). */
  type: string;
  text: string;
  /** `-o` 가 없어서 yt-dlp 기본 템플릿을 쓴 경우. */
  dflt?: boolean;
}

/** 이 명령어가 만들 파일명. 값은 모르므로 `‹제목›` 처럼 자리표시자로 둔다. */
export const previewFilename = (values: LintResult['values']): FilePreview =>
  previewRaw(values) as FilePreview;

export { nearestFlags, distance } from './core/lint.js';
export { explainCommand, explainItem, suggestNext, DEFAULT_OUTTMPL } from './core/explain.js';
export { scanCommand, tokenize, quote } from './core/command.js';
