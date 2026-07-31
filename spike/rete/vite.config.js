import path from 'node:path';

export default {
  server: { port: 5210, strictPort: true },
  resolve: {
    dedupe: ['lit', '@lit/reactive-element', 'lit-html'],
    alias: [
      // 본 앱의 템플릿 어댑터를 lit 판으로 바꿔치기한다 (tpl-lit.js 주석 참고).
      { find: /src\/ui\/tpl\.js$/, replacement: path.resolve(process.cwd(), 'tpl-lit.js') },
    ],
  },
};
