/**
 * 린트는 딱 하나를 위해 있다 — **선언 안 된 이름을 쓰는 것**.
 *
 * 타입 검사는 tsc 가 한다(`npm run check:types`). 그래서 여기는 .js 만 본다 —
 * 스키마에서 자란 코드와 생성기, 그리고 테스트.
 *
 * 스타일 규칙은 켜지 않는다.
 */
const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
};

const node = {
  console: 'readonly', process: 'readonly', URL: 'readonly',
  localStorage: 'readonly', TextEncoder: 'readonly',
};

export default [
  { ignores: ['lib/**', 'node_modules/**'] },   // lib 은 빌드 산출물이다
  {
    files: ['src/**/*.js', 'gen_options.mjs', 'tests/**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: node },
    rules,
  },
];
