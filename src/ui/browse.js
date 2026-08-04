/**
 * 옵션 191개를 보여주는 문제.
 *
 * 평평한 191개는 아무도 안 읽는다. 단계로 나눠도 "접속 36개"가 남고, 검색은
 * **찾을 말을 이미 알 때만** 통한다. 프롬프트로 시작하는 흐름에서는 그 말을
 * 모르는 사람이 오므로 검색이 첫 화면일 수 없다.
 *
 * 그래서 넓은 것부터 좁혀 간다.
 *
 *   의도 16개  →  그 의도의 핵심 3~7개  →  관련 전체  →  단계별 191개
 *
 * 처음 보이는 건 16개뿐이고, 대부분 거기서 끝난다. 축은 core/catalog.js 의
 * INTENTS 가 갖고, 여기는 그리기와 값 넣기만 한다.
 *
 * 값이 있는 옵션은 눌러도 바로 안 들어간다 — 값 칸이 먼저 열린다. choices 가
 * 있으면 고르는 칸으로, 없으면 metavar 를 힌트로 단 입력 칸으로.
 */
import { BY_STAGE, STAGES, search } from '../core/schema.js';
import { INTENTS, intentCore, intentMore } from '../core/catalog.js';
import { quote } from '../core/pipeline.js';
import { html, nothing } from './tpl.js';
import { STAGE_ACCENT } from './node-kinds.js';

let repaint = () => {};
let addToken = () => {};
let bs = {};

/** 앱이 호스트를 넘긴다. */
export function installBrowse(host) {
  bs = host.state;
  repaint = host.render;
  addToken = host.add;
}

export const blankBrowse = () => ({
  open: false,      // 패널이 열려 있나
  intent: null,     // 고른 의도
  more: false,      // 관련 전체까지 폈나
  stages: false,    // 단계별 전체를 폈나
  stage: null,      // 편 단계
  q: '',            // 패널 안 검색
  editing: null,    // 값 칸이 열린 옵션 id
  draft: '',
});

/* ── 값 넣기 ─────────────────────────────── */
function commit(o) {
  const v = bs.draft.trim();
  addToken(v ? `${o.short || o.flag} ${quote(v)}` : (o.short || o.flag));
  bs.editing = null; bs.draft = '';
  repaint();
}

function pick(o) {
  if (o.kind === 'flag') { addToken(o.short || o.flag); repaint(); return; }
  bs.editing = bs.editing === o.id ? null : o.id;
  bs.draft = o.choices ? o.choices[0] : '';
  repaint();
}

/** 값 칸. choices 가 있으면 고르게 하고, 없으면 metavar 를 힌트로 준다. */
const valueBox = o => html`
  <div class="br-val">
    ${o.choices
      ? html`<select .value=${bs.draft} @change=${e => { bs.draft = e.target.value; }}>
          ${o.choices.map(c => html`<option value=${c} ?selected=${c === bs.draft}>${c}</option>`)}
        </select>`
      : html`<input type="text" .value=${bs.draft} spellcheck="false"
               placeholder=${o.metavar || '값'}
               @input=${e => { bs.draft = e.target.value; }}
               @keydown=${e => { if (e.key === 'Enter') { e.preventDefault(); commit(o); } }}>`}
    <button class="btn" type="button" @click=${() => commit(o)}>넣기</button>
  </div>`;

const optRow = o => html`
  <div class="br-row${bs.editing === o.id ? ' open' : ''}">
    <button class="br-pick" type="button" @click=${() => pick(o)}
            title=${o.help || ''}>
      <span class="br-flag">${o.flag}${o.short ? html` <em>${o.short}</em>` : nothing}
        ${o.kind === 'flag' ? nothing : html`<span class="br-arg">${o.metavar || 'VALUE'}</span>`}</span>
      <span class="br-help">${(o.help || '').replace(/\s+/g, ' ')}</span>
    </button>
    <span class="br-stage" style=${`color:${STAGE_ACCENT[o.stage] || 'inherit'}`}>${o.stage}</span>
    ${bs.editing === o.id ? valueBox(o) : nothing}
  </div>`;

/* ── 층층이 ──────────────────────────────── */
const intentChips = () => html`
  <div class="br-chips">
    ${INTENTS.map(i => html`
      <button class="br-chip${bs.intent === i.key ? ' on' : ''}" type="button"
              @click=${() => { bs.intent = bs.intent === i.key ? null : i.key; bs.more = false; bs.editing = null; repaint(); }}>
        ${i.label}
      </button>`)}
  </div>`;

function intentBody() {
  if (!bs.intent) return nothing;
  const core = intentCore(bs.intent);
  const more = intentMore(bs.intent);
  return html`
    <div class="br-list">${core.map(optRow)}</div>
    ${more.length ? html`
      <button class="br-more" type="button" @click=${() => { bs.more = !bs.more; repaint(); }}>
        ${bs.more ? '관련 옵션 접기' : `관련 옵션 ${more.length}개 더 보기`}
      </button>` : nothing}
    ${bs.more ? html`<div class="br-list dim">${more.map(optRow)}</div>` : nothing}`;
}

function stageBody() {
  if (!bs.stages) return nothing;
  return html`
    <div class="br-stages">
      ${STAGES.map(s => {
        const opts = BY_STAGE[s.id] || [];
        const on = bs.stage === s.id;
        return html`
          <button class="br-sh${on ? ' on' : ''}" type="button"
                  @click=${() => { bs.stage = on ? null : s.id; bs.editing = null; repaint(); }}>
            <span class="dot" style=${`background:${STAGE_ACCENT[s.id] || 'currentColor'}`}></span>
            <b>${s.label}</b><span class="br-blurb">${s.blurb}</span><span class="n">${opts.length}</span>
          </button>
          ${on ? html`<div class="br-list">${opts.map(optRow)}</div>` : nothing}`;
      })}
    </div>`;
}

function searchBody() {
  const hits = search(bs.q) || [];
  return html`
    <div class="br-list">${hits.slice(0, 40).map(optRow)}</div>
    ${hits.length > 40 ? html`<div class="br-note">${hits.length}개 중 40개만 보인다 — 검색어를 좁힐 것</div>` : nothing}
    ${hits.length ? nothing : html`<div class="br-note">걸리는 옵션이 없다</div>`}`;
}

export const browseTemplate = () => {
  if (!bs.open) {
    return html`
      <button class="br-open" type="button" @click=${() => { bs.open = true; repaint(); }}>
        옵션 찾아보기 <span>— 하고 싶은 것부터 고른다</span>
      </button>`;
  }
  const searching = !!bs.q.trim();
  return html`
    <div class="br">
      <div class="br-top">
        <b>옵션 찾아보기</b>
        <input class="br-q" type="text" .value=${bs.q} spellcheck="false"
               placeholder="이름을 알면 바로 검색 (자막 · sub · 403 …)"
               @input=${e => { bs.q = e.target.value; bs.editing = null; repaint(); }}>
        <button class="br-x" type="button" title="닫기"
                @click=${() => { bs.open = false; repaint(); }}>✕</button>
      </div>
      ${searching ? searchBody() : html`
        ${intentChips()}
        ${intentBody()}
        <button class="br-more" type="button"
                @click=${() => { bs.stages = !bs.stages; repaint(); }}>
          ${bs.stages ? '단계별 전체 접기' : '단계별로 전체 보기'}
        </button>
        ${stageBody()}`}
    </div>`;
};
