/**
 * 캔버스 밖 화면.
 *
 * 팔레트 · 검색 결과 · 하단 명령어와 노트 · 브레드크럼. 캔버스 안쪽(노드와
 * 와이어)은 app.js 가 그리고, 그 바깥 틀은 전부 여기 있다.
 *
 * bodies.js 와 같은 방식이다 — 전부 lit-html 템플릿이고, 앱에서 받아 오는
 * 것은 installChrome 으로 넘기는 여섯 가지뿐이다.
 *
 *   state → stateOf()    지금 상태. 앱이 다시 대입하므로 게터로 받는다
 *   ui → uiState         편집 중인 UI 상태 (강조 중인 옵션, 읽지 못한 토큰)
 *   render → repaint()   전체 렌더
 *   addStage → addStage()   단계 노드를 만든다 (검색 결과에서 고를 때)
 *   centerSpot → spot()     화면 가운데의 빈 자리
 *   focusNode → focusOn()   그 노드로 화면을 옮긴다
 *
 * 예전에는 이 네 함수가 innerHTML 로 문자열을 조립했다. 그래서 손으로 만든
 * escapeHtml 이 필요했고, 보간을 하나 더 넣을 때마다 그걸 잊을 자리가 생겼다.
 * 템플릿으로 옮기면서 통째로 없어졌다 — lit 이 텍스트 위치를 알아서
 * 이스케이프한다. 일부러 HTML 을 넣는 자리(레지스트리의 안내 문구)만
 * innerHTML 로 남고, 거기엔 사용자 문자열이 오지 않는다.
 */
import { STAGE, STAGES, expand, search } from '../core/schema.js';
import { valuesOf } from '../core/graph.js';
import { buildTokens, quote, stageNode, urlList } from '../core/pipeline.js';
import { html, nothing, renderTpl } from './tpl.js';
import { STAGE_ACCENT, badgeOf, paletteItems } from './node-kinds.js';
import { graphKind } from './graph-kinds.js';
import { $ } from './dom.js';

/* ══ 앱에서 받아 오는 것 ══════════════════════ */
// app.js 에도 있는 이름은 쓰지 않는다 — 배포 빌드가 한 스코프로 합친다.
let stateOf = () => null;
let uiState = {};
let repaint = () => {};
let addStage = () => null;
let spot = () => [0, 0];
let focusOn = () => {};

/** 앱이 호스트를 넘긴다. app.js 가 한 번 부른다. */
export function installChrome(host) {
  stateOf = host.state;
  uiState = host.ui;
  repaint = host.render;
  addStage = host.addStage;
  spot = host.centerSpot;
  focusOn = host.focusNode;
}

// app.js 에도 같은 파생이 있지만 이름을 갈라 둔다 — 한 스코프로 합쳐지므로.
const kind = () => graphKind(uiState.mode);
const stageAt = sid => stageNode(stateOf(), sid);

/* ══ 팔레트 ══════════════════════════════════ */
/** 항목도, 표기도, 색도 전부 레지스트리에서 나온다. */
export const paletteTemplate = () =>
  html`${paletteItems(uiState.mode, STAGES).map(paletteItem)}`;

export function renderPalette() {
  const k = kind();
  $('#pal-head').textContent = k.palette.head;
  // 안내 문구는 레지스트리가 <b> 를 넣어 둔 HTML 이다 — 일부러 그대로 쓴다.
  $('#pal-hint').innerHTML = k.palette.hint;
  $('#autowire').hidden = !k.canAutowire;
  renderTpl(paletteTemplate(), $('#pal-list'));
}

function paletteItem(item) {
  const placed = item.kind === 'stage' ? stageAt(item.key) : null;
  const n = placed ? badgeOf(placed) : 0;
  const stage = item.kind === 'stage';
  return html`
    <button class="pal-item${placed ? ' placed' : ''}" type="button"
            data-key=${item.key}
            data-stage=${stage ? item.key : nothing}
            data-fnode=${stage ? nothing : item.key}
            style=${`--a:${item.accent}`}
            title=${item.blurb + (placed ? ' · 이미 캔버스에 있다' : '')}>
      <span class="dot"></span>
      <span class="tag">[<b>${item.tag}</b>]<span class="ko">${item.label}</span></span>
      ${n ? html`<span class="n">${n}</span>` : html`<span></span>`}
    </button>`;
}

/* ══ 검색 결과 ═══════════════════════════════ */

/**
 * 일치한 조각에 <mark> 를 씌운다.
 *
 * 예전에는 이스케이프한 HTML 문자열에 정규식 치환을 걸었다. 그러면 이미
 * 만들어진 엔티티 안쪽(`&amp;` 의 amp)까지 맞아 버린다. 여기서는 텍스트를
 * 조각으로 잘라 <mark> 를 엘리먼트로 끼우므로 그럴 일이 없다.
 */
export function mark(text, terms) {
  const ts = terms.filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!ts.length) return String(text);
  // 캡처가 있는 split 은 [사이, 일치, 사이, 일치, …] 를 준다 — 홀수가 일치다.
  const pieces = String(text).split(new RegExp('(' + ts.join('|') + ')', 'gi'));
  if (pieces.length === 1) return pieces[0];        // 일치 없음 — 글자 그대로
  return pieces.map((piece, i) => (i % 2 ? html`<mark>${piece}</mark>` : piece));
}

export const hitsTemplate = (hits, terms) => html`
  <div class="hits-head">${hits.length}개 일치 · 고르면 해당 단계 노드에 들어간다</div>
  ${hits.slice(0, 80).map(o => hitRow(o, terms))}`;

export function renderHits() {
  const box = $('#hits');
  const q = $('#q').value;
  const hits = kind().search ? search(q) : null;
  if (!hits) { box.hidden = true; renderTpl(nothing, box); return; }

  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean).flatMap(expand);
  box.hidden = false;
  renderTpl(hitsTemplate(hits, terms), box);
}

function hitRow(o, terms) {
  const holder = stageAt(o.stage);
  const on = !!(holder && o.id in valuesOf(holder));
  return html`
    <button class="hit" type="button" @click=${() => place(o)}>
      <span>
        <span class="hit-flag">${mark(o.flag, terms)}${o.short
          ? html` <span class="short">${o.short}</span>` : nothing}</span>
        <span class="hit-help">${mark(o.help, terms)}</span>
      </span>
      ${on
        ? html`<span class="hit-on">✓ 배치됨</span>`
        : html`<span class="hit-stage"
                     style=${`color:${STAGE_ACCENT[o.stage]}`}>${o.stage}</span>`}
    </button>`;
}

/** 검색 결과를 고르면 그 옵션이 속한 단계 노드를 만들어 넣고 그리로 옮긴다. */
function place(o) {
  const n = addStage(o.stage, ...spot());
  valuesOf(n)[o.id] = o.kind === 'flag' ? true : '';
  $('#q').value = '';
  renderHits();
  repaint();
  focusOn(n.id);
}

/* ══ 하단 명령어 · 노트 ══════════════════════ */

/** `.cmd` 는 white-space:pre-wrap 이다 — 토큰 사이 공백은 정확히 한 칸이어야
 *  한다. 그래서 정적 문자열에 줄바꿈을 넣지 않는다(줄바꿈은 `${}` 안쪽에만). */
const tokenSpan = t => html` <span class="tok${uiState.lit === t.opt.id ? ' lit' : ''}" data-opt=${t.opt.id} data-node=${t.node} title=${`${t.opt.flag} — [${t.opt.stage}] ${STAGE[t.opt.stage].label} 노드`}>${t.text}</span>`;

export const cmdTemplate = (toks, urls) =>
  html`<span class="prompt">$ </span><span>yt-dlp</span>${
    toks.map(tokenSpan)}${
    urls.map(u => html` <span class="tok url">${quote(u)}</span>`)}`;

export function renderCmd() {
  const toks = buildTokens(stateOf());
  renderTpl(cmdTemplate(toks, urlList(stateOf())), $('#cmd'));
  renderTpl(notesTemplate(toks), $('#notes'));
}

export function notesTemplate(toks) {
  const parts = [];
  if (uiState.unknown.length) parts.push(html`<b>읽지 못한 토큰:</b> ${uiState.unknown.join(' · ')}`);
  if (uiState.fmtWarn) parts.push(html`<b>${uiState.fmtWarn}</b>`);

  // 무엇을 보고할지는 그래프 종류가 안다.
  for (const note of kind().statusNotes(kind().graphOf(stateOf()), { tokens: toks, unknown: uiState.unknown })) {
    parts.push(note.label ? html`<b>${note.label}:</b> ${note.body}` : html`${note.body}`);
  }
  return html`${parts.map((p, i) => html`${i ? ' · ' : ''}${p}`)}`;
}

/** 잠깐 띄우는 알림. 조금 뒤에 노트가 제자리로 돌아온다. */
let noteTimer = null;
export function flashNote(msg) {
  renderTpl(html`<b>${msg}</b>`, $('#notes'));
  clearTimeout(noteTimer);
  noteTimer = setTimeout(renderCmd, 2200);
}

/* ══ 브레드크럼 ══════════════════════════════ */
export function renderCrumb() {
  const k = kind();
  const c = $('#crumb');
  c.hidden = !k.chrome.crumb;
  $('#field-q').hidden = !k.search;
  $('#viewport').classList.toggle('sub', !!k.chrome.sub);
  if (!k.chrome.crumb) return;

  c.style.setProperty('--fmt', STAGE_ACCENT.format);
  const detail = k.crumbDetail ? k.crumbDetail(stateOf()) : '';
  // 공백을 정적 문자열이 아니라 값에 붙인다 — 텍스트 노드가 갈리면 자간이
  // 미세하게 달라진다.
  renderTpl(html`${k.label + ' '}<code id="crumb-expr">${detail ? '· ' + detail : ''}</code>`,
            c.querySelector('.here'));
}
