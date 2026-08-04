/**
 * 판독 화면 — 받아 온 명령어를 읽을 수 있게 만드는 쪽.
 *
 * 프롬프트로 받은 명령어는 내가 쓴 것이 아니다. 그래서 "돌려도 되는가"를
 * 먼저 답해야 한다. 여기 나오는 것은 전부 로컬에서 결정적으로 계산된다 —
 * 모델이 뭐라 했는지는 하나도 안 쓴다.
 *
 *   배지     오류·경고 몇 개인지, 191개 중 몇 개를 썼는지
 *   문제     심각한 것부터. 오타는 고칠 후보까지
 *   파일명   이 명령어가 실제로 만들 이름
 *   설명     토큰마다 무슨 옵션인지
 *   다음     이 조합이 부르는 다음 한 걸음
 */
import { previewFilename, explainCommand, suggestNext } from '../core/explain.js';
import { html, nothing } from './tpl.js';
import { STAGE_ACCENT } from './node-kinds.js';

let repaint = () => {};
let addToken = () => {};
let replaceFlag = () => {};

export function installReport(host) {
  repaint = host.render;
  addToken = host.add;
  replaceFlag = host.replaceFlag;
}

/* ── 배지 ────────────────────────────────── */
export const verdictTemplate = lint => {
  const { error, warn, info, opts, total } = lint.counts;
  const cls = error ? 'bad' : warn ? 'iffy' : 'good';
  const label = error ? `오류 ${error}개` : warn ? `경고 ${warn}개` : '확인됨';
  return html`
    <div class="rp-verdict ${cls}">
      <span class="rp-mark">${error ? '✗' : warn ? '!' : '✓'}</span>
      <b>${label}</b>
      ${error && warn ? html`<span>· 경고 ${warn}개</span>` : nothing}
      ${!error && info ? html`<span>· 참고 ${info}개</span>` : nothing}
      <span class="rp-count">옵션 ${opts}개 사용 · 스키마 ${total}개 대조</span>
    </div>`;
};

/* ── 문제 ────────────────────────────────── */
const issueRow = it => html`
  <li class="rp-issue ${it.level}">
    <span class="rp-dot"></span>
    <span>${it.msg}</span>
    ${it.fixes && it.fixes.length ? html`
      <span class="rp-fixes">${it.fixes.map(f => html`
        <button class="rp-fix" type="button" @click=${() => { replaceFlag(it.flag, f); repaint(); }}
                title=${`${it.flag} → ${f} 로 바꾼다`}>${f}</button>`)}</span>` : nothing}
  </li>`;

export const issuesTemplate = lint => lint.issues.length
  ? html`<ul class="rp-issues">${lint.issues.map(issueRow)}</ul>`
  : html`<div class="rp-clean">스키마와 문법에 어긋나는 곳이 없다.</div>`;

/* ── 파일명 ──────────────────────────────── */
export function filenameTemplate(lint) {
  const p = previewFilename(lint.values);
  return html`
    <div class="rp-file">
      <span class="rp-k">만들 파일</span>
      <code class=${p.ok ? '' : 'bad'}>${p.text}</code>
      ${p.dflt ? html`<span class="rp-hint">-o 가 없어 yt-dlp 기본값</span>` : nothing}
      ${p.type ? html`<span class="rp-hint">${p.type} 파일에만 적용</span>` : nothing}
    </div>`;
}

/* ── 토큰 설명 ───────────────────────────── */
export function explainTemplate(lint) {
  const rows = explainCommand(lint.items).filter(r => r.kind !== 'url');
  if (!rows.length) return nothing;
  return html`
    <ul class="rp-explain">
      ${rows.map(r => html`
        <li class=${r.kind === 'unknown' ? 'unknown' : ''}>
          <code>${r.text}</code>
          ${r.kind === 'opt'
            ? html`<span class="rp-stage" style=${`color:${STAGE_ACCENT[r.stage] || 'inherit'}`}>${r.stageLabel}</span>` : nothing}
          <span class="rp-ko">${r.ko}</span>
        </li>`)}
    </ul>`;
}

/* ── 다음 걸음 ───────────────────────────── */
export function nextTemplate(lint) {
  const picks = suggestNext(lint.values);
  if (!picks.length) return nothing;
  return html`
    <div class="rp-next">
      <span class="rp-k">이어서</span>
      ${picks.map(p => html`
        <button class="rp-sug" type="button" title=${`${p.why} — ${p.opt.help || ''}`}
                @click=${() => { addToken(p.opt.kind === 'flag'
                    ? (p.opt.short || p.opt.flag)
                    : `${p.opt.short || p.opt.flag} ""`); repaint(); }}>
          ${p.opt.flag}
        </button>`)}
    </div>`;
}

/** 판독 전체. 명령어가 비어 있으면 아무것도 그리지 않는다. */
export const reportTemplate = lint => html`
  ${verdictTemplate(lint)}
  ${issuesTemplate(lint)}
  ${filenameTemplate(lint)}
  ${nextTemplate(lint)}
  <details class="rp-more">
    <summary>토큰별로 읽기</summary>
    ${explainTemplate(lint)}
  </details>`;
