/**
 * 개발 서버 전용 설정.
 *
 * 배포 산출물은 vite build 가 아니라 build.py 가 만든다(의존성 0 의 HTML 한 장).
 * 그래서 outDir 을 dist 밖으로 빼 두어 실수로 덮어쓰지 않게 한다.
 */
export default {
  server: { port: 5173, open: false },
  build: { outDir: '.vite-build' },
};
