/**
 * 손님이 쓴 코드 → 명령어 → 검사 → 설명.
 *
 * 이 페이지에서 도는 것은 **진짜 라이브러리**다. `ytstudio/browser` 는 파일
 * 시스템을 안 보므로 그대로 브라우저에서 돌고, 스키마는 저장소의
 * `ytstudio.schema.json` 을 빌드 때 그대로 박은 것이다. 그래서 여기 뜨는
 * 명령어와 검사 결과는 같은 코드를 노드에서 돌린 것과 같다.
 *
 * 평가는 `new Function` 이다 — 손님 브라우저에서 손님이 쓴 코드가 도는 것이라
 * 새로 생기는 위험이 없다. 서버로 보내지 않는다.
 */
import {
  studio, previewFilename, tokenize, quote, distance, DEFAULT_OUTTMPL,
} from 'ytstudio/browser';
import type { LintResult, Explained, FilePreview } from 'ytstudio/browser';
import raw from '../../ytstudio.schema.json';

/** 데모가 대조하는 것 — 저장소가 배포하는 그 스키마 한 벌. */
export const yt = studio(raw as Parameters<typeof studio>[0]);

export interface Result {
  command: string;
  lint: LintResult;
  explained: Explained[];
  file: FilePreview;
}

/** 코드가 명령어까지 못 간 이유. 타입 오류와는 다르다 — 이건 돌리다 난 것이다. */
export class RunError extends Error {}

/**
 * 트랜스파일된 ESM 을 이 페이지에서 부를 수 있는 몸통으로 바꾼다.
 *
 * `import` 와 `export` 는 `new Function` 안에서 문법 오류다. 데모가 권하는
 * 모양이 정해져 있으므로(`import … from 'ytstudio'` 한 줄, `export default`
 * 한 번) 그 둘만 바꾼다. 다른 모양이면 아래 `evaluate` 가 그렇다고 말한다.
 */
function toBody(js: string): string {
  return js
    .replace(/^\s*import\s+([\s\S]*?)\s+from\s+['"]ytstudio(?:\/browser)?['"];?\s*$/gm,
      (_m, clause: string) => `const ${clause.trim()} = __ytstudio;`)
    .replace(/^\s*export\s+default\s+/m, 'return ');
}

/** `.build()` 를 부를 수 있는 것인가. */
const buildable = (v: unknown): v is { build(): string } =>
  typeof (v as { build?: unknown } | null)?.build === 'function';

/**
 * 명령어 하나를 뽑아낸다.
 *
 * 빌더를 그대로 내도 되고(`export default ytdlp('…').extractAudio()`)
 * 이미 `.build()` 한 문자열을 내도 된다. 앞엣것이 짧아서 예제가 그 모양이다.
 */
export function evaluate(js: string): Result {
  const body = toBody(js);
  if (/^\s*(import|export)\s/m.test(body)) {
    throw new RunError('import 는 ytstudio 한 줄만, 내보내기는 export default 하나만 된다');
  }

  let value: unknown;
  try {
    value = new Function('__ytstudio', `"use strict";\n${body}`)(api);
  } catch (e) {
    throw new RunError(e instanceof Error ? e.message : String(e));
  }

  const command = buildable(value) ? value.build() : value;
  if (typeof command !== 'string' || !command) {
    throw new RunError('export default 로 빌더나 명령어 문자열을 내야 한다');
  }

  const lint = yt.lint(command);
  return {
    command,
    lint,
    explained: yt.explain(lint.items),
    file: previewFilename(lint.values),
  };
}

/** 손님 코드에 `ytstudio` 라는 이름으로 들어가는 것. */
const api = {
  ytdlp: (...urls: string[]) => yt.ytdlp(...urls),
  lintCommand: (text: string) => yt.lint(text),
  scanCommand: (text: string) => yt.scan(text),
  explainCommand: (items: Parameters<typeof yt.explain>[0]) => yt.explain(items),
  suggestNext: (values: Parameters<typeof yt.suggest>[0], limit?: number) => yt.suggest(values, limit),
  nearestFlags: (flag: string, limit?: number) => yt.nearest(flag, limit),
  studio, previewFilename, tokenize, quote, distance, DEFAULT_OUTTMPL,
};
