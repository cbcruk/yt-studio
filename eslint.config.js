/**
 * 린트는 딱 하나를 위해 있다 — **선언 안 된 이름을 쓰는 것**.
 *
 * 예전에는 build.py 가 모듈을 손으로 이어 붙이며 최상위 이름을 검사했다.
 * 번들러로 옮기면서 그 그물이 없어졌는데, 번들러는 자유 변수를 "전역이겠지"
 * 하고 넘긴다. 임포트 한 줄을 지우면 조용히 통과했다가 그 코드가 실제로
 * 불릴 때 터진다. no-undef 가 그 자리를 메운다.
 *
 * 스타일 규칙은 켜지 않는다.
 */
import globals from 'globals';

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
};

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.js', 'vite.config.js'],
    languageOptions: {
      ecmaVersion: 2024, sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules,
  },
  {
    // e2e 는 page.evaluate 안에서 브라우저 쪽 코드를 쓴다. 테스트 손잡이도 거기 있다.
    files: ['tests/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024, sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, __yt: 'readonly' },
    },
    rules,
  },
];
