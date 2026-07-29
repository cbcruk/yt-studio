#!/usr/bin/env node
/**
 * 전체 테스트 실행기.
 *
 *   node tests/run.mjs            전부
 *   node tests/run.mjs format     이름에 'format' 이 든 것만
 *
 * 앱을 먼저 굽고(build.py) 그 산출물을 상대로 돌린다.
 */
import { execFileSync } from 'node:child_process';
import { runSuite, ROOT } from './harness.mjs';

const only = process.argv.slice(2);
const wanted = f => !only.length || only.some(o => f.includes(o));

console.log('· 빌드');
try {
  const out = execFileSync('python3', ['build.py'], { cwd: ROOT, encoding: 'utf8' });
  console.log('  ' + out.trim());
} catch (e) {
  console.error('빌드 실패:', e.stderr || e.message);
  process.exit(1);
}

const SUITES = ['e2e/pipeline.mjs', 'e2e/format.mjs', 'e2e/output.mjs', 'e2e/paths.mjs'].filter(wanted);
const totals = [];

for (const file of SUITES) {
  const mod = await import('./' + file);
  totals.push(await runSuite(mod.name || file, mod.default));
}

console.log('\n' + '─'.repeat(52));
let pass = 0, fail = 0, noise = 0;
for (const t of totals) {
  pass += t.passed; fail += t.failed; noise += t.consoleErrors.length;
  console.log(`  ${t.failed ? '✗' : '✓'} ${t.name}: ${t.passed} 통과${t.failed ? ` · ${t.failed} 실패` : ''}`);
}
console.log('─'.repeat(52));
console.log(`  합계 ${pass} 통과 · ${fail} 실패 · 콘솔 에러 ${noise}`);

process.exit(fail || noise ? 1 : 0);
