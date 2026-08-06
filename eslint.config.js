/**
 * 린트는 딱 하나를 위해 있다 — **선언 안 된 이름을 쓰는 것**.
 *
 * src/ 는 전부 TypeScript 라 tsc 가 본다(`npm run check:types`). 여기 남는 건
 * 빌드 전에 도는 생성기와, 컴파일 결과를 상대로 도는 테스트뿐이다.
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
    files: ['gen_options.mjs', 'tests/**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: node },
    rules,
  },
];
