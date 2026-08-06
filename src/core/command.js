/**
 * 명령어 문자열 ↔ 항목 수열.
 *
 * 명령어를 읽는 길은 이 저장소에 하나뿐이다. 검증기도 빌더도 같은
 * `scanCommand` 를 지나므로 둘이 서로 다른 명령어를 볼 수가 없다.
 *
 * 쓰는 쪽이 쓰는 것은 `quote` 하나다 — 셸에 붙여넣을 한 줄을 만들 때.
 */
import { BY_FLAG } from './schema.js';

/* ── 쓰기 ────────────────────────────────── */
const SAFE = /^[A-Za-z0-9._:,\/=+@%^-]+$/;
export const quote = v => SAFE.test(v) ? v : '"' + String(v).replace(/([\\"$`])/g, '\\$1') + '"';

/* ── 읽기 ────────────────────────────────── */
/** 셸 인용을 존중하며 토큰으로 쪼갠다. */
export function tokenize(s) {
  const out = []; let cur = '', q = null, open = false;
  // `open` 이 따로 필요하다 — `""` 는 빈 토큰이지 토큰이 없는 게 아니다.
  // (`--sub-langs ""` 를 삼키면 값이 빈 것을 아무도 못 본다.)
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"') { cur += s[++i] ?? ''; }
      else if (c === q) q = null;
      else cur += c;
    } else if (c === '"' || c === "'") { q = c; open = true; }
    else if (/\s/.test(c)) { if (open) { out.push(cur); cur = ''; open = false; } }
    else { cur += c; open = true; }
  }
  if (open) out.push(cur);
  return out;
}

/**
 * 명령어 문자열 → 항목 수열. 순서와 원문을 그대로 지킨다.
 *
 * 검증기(core/lint.js)도 빌더(core/build.ts)도 이 하나를 지난다. 파서가 둘이면
 * "검증기가 본 명령어"와 "빌더가 낸 명령어"가 갈린다.
 *
 * 항목은 셋 중 하나다.
 *   { kind:'url',     raw }
 *   { kind:'opt',     raw, flag, opt, negated, value }   value 는 flag 면 null
 *   { kind:'unknown', raw, flag, value, why }            스키마가 모르거나 값이 빈 것
 */
export function scanCommand(text) {
  const toks = tokenize((text || '').replace(/\\\n/g, ' '));
  const head = (toks[0] && /yt-dlp|youtube-dl/.test(toks[0])) ? toks.shift() : null;

  const items = [];
  for (let i = 0; i < toks.length; i++) {
    const raw0 = toks[i];
    if (!raw0.startsWith('-') || raw0 === '-') { items.push({ kind: 'url', raw: raw0 }); continue; }

    let flag = raw0, inline = null;
    if (raw0.startsWith('--') && raw0.includes('=')) {
      const k = raw0.indexOf('=');
      flag = raw0.slice(0, k); inline = raw0.slice(k + 1);
    }
    const hit = BY_FLAG[flag];
    if (!hit) { items.push({ kind: 'unknown', raw: raw0, flag, value: null, why: 'no-flag' }); continue; }

    const { opt, negated } = hit;
    if (opt.kind === 'flag') {
      // `--flag=값` 은 플래그에 값을 준 것이다 — 조용히 삼키지 않는다.
      if (inline != null) { items.push({ kind: 'unknown', raw: raw0, flag, value: inline, why: 'flag-took-value' }); continue; }
      items.push({ kind: 'opt', raw: raw0, flag, opt, negated, value: null });
      continue;
    }
    if (inline != null) { items.push({ kind: 'opt', raw: raw0, flag, opt, negated, value: inline }); continue; }

    const v = toks[i + 1];
    // 다음 토큰이 또 플래그면 값이 빠진 것이다. 음수(-1)와 `-` 는 값일 수 있다.
    const looksFlag = v !== undefined && v.startsWith('-') && v.length > 1 && !/^-?\d/.test(v);
    if (v === undefined || looksFlag) {
      items.push({ kind: 'unknown', raw: raw0, flag, value: null, why: 'no-value' });
      continue;
    }
    i++;
    items.push({ kind: 'opt', raw: raw0 + ' ' + quote(v), flag, opt, negated, value: v });
  }
  return { head, items };
}
