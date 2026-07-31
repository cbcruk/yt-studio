/**
 * 개발 서버와 배포 빌드 둘 다.
 *
 * 배포물은 여전히 의존성 0 의 HTML 한 장이다. 다만 모듈을 손으로 이어 붙이는
 * 대신 vite 가 묶고, 아래 플러그인이 CSS·JS 를 index.html 안으로 밀어 넣는다.
 * 스키마는 schema-data.js 의 JSON import 를 vite 가 값으로 구워 준다.
 */
import fs from 'node:fs';
import path from 'node:path';

/** 산출물을 파일 하나로 접는다. 외부 참조가 남으면 빌드를 세운다. */
function singleFile({ out = 'ytdlp-studio.html' } = {}) {
  return {
    name: 'yt-single-file',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const htmlKey = Object.keys(bundle).find(k => k.endsWith('.html'));
      const jsKeys = Object.keys(bundle).filter(k => k.endsWith('.js'));
      const cssKeys = Object.keys(bundle).filter(k => k.endsWith('.css'));
      if (!htmlKey) throw new Error('html 산출물을 못 찾았다');

      // 파일 이름으로 그 태그만 집는다. index.html 에는 폰트 CDN <link> 도 있어서
      // "첫 stylesheet" 로 잡으면 엉뚱한 것을 갈아 끼운다.
      const tagFor = (key, re) => new RegExp(`<${re}[^>]*(?:src|href)="[^"]*${key}"[^>]*>(?:</script>)?`);

      let html = bundle[htmlKey].source;
      for (const k of cssKeys) {
        html = html.replace(tagFor(k, 'link'),
          () => '<style>\n' + String(bundle[k].source).trim() + '\n</style>');
        delete bundle[k];
      }
      for (const k of jsKeys) {
        html = html.replace(tagFor(k, 'script'),
          () => '<script type="module">\n' + bundle[k].code.trim() + '\n</script>');
        delete bundle[k];
      }

      if (/(src|href)="[^"]*(assets\/|\/src\/)/.test(html))
        throw new Error('외부 참조가 산출물에 남았다');

      delete bundle[htmlKey];
      this.emitFile({ type: 'asset', fileName: out, source: html });
    },
    writeBundle(opts) {
      const file = path.join(opts.dir, out);
      console.log(`  ${file} · ${Math.round(fs.statSync(file).size / 1024)}KB`);
    },
  };
}

export default {
  server: { port: 5173, open: false },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  plugins: [singleFile()],
};
