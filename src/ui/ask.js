/**
 * 첫 화면 — 프롬프트를 받아 명령어를 낸다.
 *
 * 원본은 **명령어 문자열**이다. 그래프가 아니다. 모델이 준 것이든 손으로 고친
 * 것이든 히스토리에서 꺼낸 것이든 전부 같은 칸으로 들어오고, 그 칸이 바뀔
 * 때마다 core/lint.js 가 다시 돈다.
 *
 * 모델은 이 흐름에서 갈아 끼울 수 있는 부품이다 — 키가 있으면 브라우저에서
 * 바로 부르고, 없으면 프롬프트를 만들어 주고 답을 붙여넣게 한다. 어느 쪽이든
 * 검증기와 판독 화면은 똑같이 돈다.
 */
import { MODELS, maskKey } from '../core/ask.js';
import { html, nothing } from './tpl.js';
import { browseTemplate } from './browse.js';
import { reportTemplate } from './report.js';

let ak = {};
let repaint = () => {};
let run = () => {};
let toGraph = () => {};
let copyText = () => {};
let lintOf = () => null;
let openPack = () => {};
let openKey = () => {};

export function installAsk(host) {
  ak = host.state;
  repaint = host.render;
  run = host.run;
  toGraph = host.toGraph;
  copyText = host.copy;
  lintOf = host.lint;
  openPack = host.openPack;
  openKey = host.openKey;
}

/** 처음 온 사람에게 "이렇게 쓰는 것"을 한 줄로 보여 준다. */
const EXAMPLES = [
  '1080p 이하로 받고 한국어 자막을 영상에 넣어 줘',
  '음원만 mp3 로 뽑고 표지랑 태그도 넣어 줘',
  '재생목록 전체를 채널 이름 폴더에 번호 붙여서 저장',
  '광고 구간 잘라 내고 챕터는 남겨 줘',
];

/* ── 프롬프트 ────────────────────────────── */
const promptTemplate = () => html`
  <div class="ak-put">
    <textarea id="prompt" spellcheck="false" .value=${ak.prompt}
      placeholder=${ak.command ? '이 명령어를 어떻게 고칠까 (예: 자막도 넣어 줘)'
                               : '무엇을 받고 싶은지 한국어로 쓴다'}
      @input=${e => { ak.prompt = e.target.value; repaint(); }}
      @keydown=${e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); } }}></textarea>

    <div class="ak-bar">
      <select class="ak-model" .value=${ak.model} title="쓸 모델"
              @change=${e => { ak.model = e.target.value; repaint(); }}>
        ${MODELS.map(([id, label]) => html`<option value=${id} ?selected=${id === ak.model}>${label}</option>`)}
      </select>
      <button class="btn" type="button" @click=${() => openKey()}
              title=${ak.key ? '키를 바꾸거나 지운다' : '브라우저에만 저장된다'}>
        ${ak.key ? html`키 ${maskKey(ak.key)}` : '키 넣기'}
      </button>
      <button class="btn" type="button" @click=${() => openPack()}
              title="쓰던 LLM 에 그대로 붙여넣을 프롬프트를 만든다">프롬프트 복사</button>
      <span class="ak-spacer"></span>
      <button class="btn primary" type="button" ?disabled=${ak.busy || !ak.prompt.trim()}
              @click=${() => run()}>
        ${ak.busy ? '묻는 중…' : ak.command ? '고치기' : '명령어 만들기'}
      </button>
    </div>

    ${!ak.prompt && !ak.command ? html`
      <div class="ak-egs">
        ${EXAMPLES.map(t => html`
          <button class="ak-eg" type="button"
                  @click=${() => { ak.prompt = t; repaint(); }}>${t}</button>`)}
      </div>` : nothing}

    ${ak.error ? html`<div class="ak-err">${ak.error}</div>` : nothing}
    ${ak.note ? html`<div class="ak-note">${ak.note}</div>` : nothing}
  </div>`;

/* ── 명령어 ──────────────────────────────── */
const commandTemplate = () => html`
  <div class="ak-cmd">
    <div class="ak-cmd-head">
      <h2>명령어</h2>
      <span class="ak-hint">여기가 원본이다 — 손으로 고쳐도 아래가 다시 검사한다</span>
      <span class="ak-spacer"></span>
      <button class="btn" type="button" @click=${e => copyText(ak.command, e.target)}>복사</button>
      <button class="btn" type="button" @click=${() => toGraph()}
              title="플래그를 단계 노드로 풀어 놓고 -f · -o · -P 는 서브그래프로 연다">그래프에서 고치기</button>
    </div>
    <textarea class="ak-cmd-box" spellcheck="false" .value=${ak.command}
      placeholder="yt-dlp … — 직접 붙여넣어도 된다"
      @input=${e => { ak.command = e.target.value; repaint(); }}></textarea>
  </div>`;

/* ── 히스토리 ────────────────────────────── */
const historyTemplate = () => {
  if (!ak.history.length) return nothing;
  return html`
    <details class="ak-hist">
      <summary>지난 명령어 ${ak.history.length}개</summary>
      <ul>
        ${ak.history.map(h => html`
          <li>
            <button type="button" @click=${() => { ak.command = h.command; ak.prompt = ''; ak.note = h.prompt || ''; repaint(); }}>
              <code>${h.command}</code>
              ${h.prompt ? html`<span class="ak-hp">${h.prompt}</span>` : nothing}
            </button>
          </li>`)}
      </ul>
      <button class="btn" type="button" @click=${() => { ak.history = []; repaint(); }}>비우기</button>
    </details>`;
};

/* ── 전체 ────────────────────────────────── */
export const askTemplate = () => {
  const lint = ak.command.trim() ? lintOf(ak.command) : null;
  return html`
    ${promptTemplate()}
    ${commandTemplate()}
    ${lint ? html`<div class="ak-report">${reportTemplate(lint)}</div>` : nothing}
    <div class="ak-browse">${browseTemplate()}</div>
    ${historyTemplate()}`;
};
