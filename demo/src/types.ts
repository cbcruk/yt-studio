/**
 * 에디터가 보는 타입 — **저장소가 실제로 배포하는 `.d.ts` 그대로.**
 *
 * 여기가 이 데모의 요점이다. 자동완성 목록을 손으로 적거나 스키마에서 다시
 * 만들어 낼 수도 있었지만, 그러면 `옵션 카탈로그 → 타입` 구현이 저장소에
 * 둘이 되고 둘은 반드시 갈린다. 대신 `tsc` 가 뱉은 `lib/**` 를 통째로 집어
 * 브라우저 안의 타입스크립트에 그대로 먹인다. 그래서 이 페이지에서 뜨는
 * 자동완성은 `npm i ytstudio` 한 사람의 에디터에 뜨는 것과 같은 파일에서 나온다.
 *
 * `?raw` 로 읽으므로 빌드 시점에 문자열로 박힌다 — 런타임 fetch 가 없다.
 */
const DTS = import.meta.glob('../../lib/**/*.d.ts', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

/** 패키지 안에서의 상대 경로(`lib/core/build.d.ts`)로 되돌린다. */
const rel = (p: string): string => `lib/${p.split('/lib/')[1]}`;

/**
 * 가상 `node_modules/ytstudio`.
 *
 * 브라우저 안 타입스크립트도 노드와 같은 방식으로 모듈을 찾는다. 그래서
 * `import { ytdlp } from 'ytstudio'` 가 풀리게 하려면 **package.json 이 있어야
 * 한다** — `exports` 맵을 보고 `lib/index.d.ts` 로 간다. 저장소의 것을 그대로
 * 옮겨 적지 않고 여기서 최소한만 적는 이유는, 에디터에게 필요한 것이
 * 타입 진입점 두 개뿐이라서다.
 */
const PKG = JSON.stringify({
  name: 'ytstudio',
  version: '0.1.0',
  type: 'module',
  types: './lib/index.d.ts',
  exports: {
    '.': { types: './lib/index.d.ts', import: './lib/index.js' },
    './browser': { types: './lib/browser.d.ts', import: './lib/browser.js' },
  },
});

export interface Lib { path: string; content: string }

/** 에디터에 얹을 파일들. `file:///` 경로가 곧 가상 파일 시스템의 자리다. */
export const libs: Lib[] = [
  { path: 'file:///node_modules/ytstudio/package.json', content: PKG },
  ...Object.entries(DTS).map(([p, content]) => ({
    path: `file:///node_modules/ytstudio/${rel(p)}`,
    content,
  })),
];
