import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * 데모 페이지 빌드.
 *
 * `base` 는 GitHub Pages 의 `/<repo>/` 하위 경로 때문에 필요하다. 로컬에서
 * `vite dev` 로 볼 때는 `/` 라야 하므로 환경변수로 가른다.
 *
 * **저장소가 만들어 낸 것**만 읽는다 — `lib/` 의 컴파일 산출물과
 * `ytstudio.schema.json`. `src/` 를 바로 읽으면 손님이 설치해서 받는 물건이
 * 아니라 그 재료를 보여 주는 셈이 되고, 손으로 옮겨 적은 사본을 두면 그
 * 순간부터 데모가 거짓말을 시작한다. 그래서 `bun run build` 가 선행이다.
 *
 * 별칭으로 잇는 이유는 형제 디렉터리라서다. `"ytstudio": "file:.."` 로 두면
 * bun 이 저장소를 **통째로 복사해** 넣는데(gitignore 된 `lib/` 는 빼고),
 * 그러면 정작 필요한 것이 빠지고 사본은 곧 낡는다.
 */
export default defineConfig({
  base: process.env.DEMO_BASE ?? '/',
  resolve: {
    alias: { 'ytstudio/browser': at('../lib/browser.js') },
  },
  server: { fs: { allow: ['..'] } },
  build: {
    outDir: 'dist',
    // monaco 의 타입스크립트 워커가 통째로 한 덩이라 기본 문턱(500KB)에
    // 반드시 걸린다. 게으르게 받아 가는 워커라서 첫 화면을 안 막는다.
    chunkSizeWarningLimit: 8192,
  },
});
