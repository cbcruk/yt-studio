/**
 * 프롬프트 화면의 흐름.
 *
 * 상태 하나(`ak`)와 그 상태를 움직이는 일들 — 모델에게 묻기, 키 없이 쓸
 * 프롬프트 만들기, 키 보관, 저장·복원. 그리는 일은 `ui/ask.js` · `ui/report.js` ·
 * `ui/browse.js` 가 하고, 여기는 무엇을 눌렀을 때 무슨 일이 나는지만 안다.
 *
 * **`ak.command` 가 이 앱의 원본이다.** 모델이 준 것이든 손으로 고친 것이든
 * 히스토리에서 꺼낸 것이든 전부 이 칸으로 들어오고, 바뀔 때마다 core/lint.js 가
 * 다시 돈다. 그래프는 이걸 풀어 놓는 편집기다.
 *
 * app.js 에서 받아 오는 것은 셋뿐이다.
 *
 *   render → repaint()   전체 렌더
 *   toGraph → toCanvas() 명령어를 그래프로 풀어 놓고 캔버스로 (그래프 쪽 일이다)
 *   copy → toClipboard() 클립보드
 */
import { BY_STAGE, STAGES, VERSION } from './core/schema.js';
import { addToken, replaceFlag } from './core/edit.js';
import { lintCommand } from './core/lint.js';
import {
  AskError, DEFAULT_MODEL, KEY_STORE, MODEL_STORE,
  ask, extractCommand, systemBlocks, userText,
} from './core/ask.js';
import {
  loadDraft, loadHistory, pushHistory, saveDraft, saveHistory,
} from './core/persist.js';
import { askTemplate, installAsk } from './ui/ask.js';
import { blankBrowse, installBrowse } from './ui/browse.js';
import { installReport } from './ui/report.js';
import { renderTpl } from './ui/tpl.js';
import { $ } from './ui/dom.js';

/** 프롬프트 화면의 상태 전부. app.js 는 `command` 와 `note` 만 들여다본다. */
export const ak = {
  prompt: '', command: '', note: '', error: '', busy: false,
  key: '', model: DEFAULT_MODEL, history: [], browse: blankBrowse(),
};

/* ══ 앱에서 받아 오는 것 ══════════════════════ */
// app.js 에도 있는 이름은 쓰지 않는다 — 배포 빌드가 한 스코프로 합친다.
let repaint = () => {};
let toCanvas = () => {};
let toClipboard = () => {};

/** 명령어를 고치는 길은 전부 이 하나를 지난다 — 문자열 규칙은 core/edit.js 에 있다. */
const putToken = text => { ak.command = addToken(ak.command, text); };

export function installAskFlow(host) {
  repaint = host.render;
  toCanvas = host.toGraph;
  toClipboard = host.copy;

  installBrowse({ state: ak.browse, render: () => repaint(), add: putToken });
  installReport({
    render: () => repaint(),
    add: putToken,
    replaceFlag: (from, to) => { ak.command = replaceFlag(ak.command, from, to); },
  });
  installAsk({
    state: ak,
    render: () => repaint(),
    run: () => runModel(),
    toGraph: () => toCanvas(),
    copy: (text, btn) => toClipboard(text, btn),
    lint: text => lintCommand(text),
    openPack: () => openPack(),
    openKey: () => openKeyDialog(),
  });
}

/** DOM 에 붙는 일은 따로 둔다 — installAskFlow 는 브라우저 없이도 불릴 수 있게. */
export function mountAskFlow() {
  $('#key-save').onclick = () => {
    ak.key = $('#key-input').value.trim();
    try { localStorage.setItem(KEY_STORE, ak.key); } catch { /* 저장 못 해도 이번 세션은 쓴다 */ }
    $('#dlg-key').close(); repaint();
  };
  $('#key-clear').onclick = () => {
    ak.key = ''; $('#key-input').value = '';
    try { localStorage.removeItem(KEY_STORE); } catch { /* 없으면 그만 */ }
    $('#dlg-key').close(); repaint();
  };
  $('#pack-copy').onclick = e => toClipboard($('#pack-text').value, e.target);
}

export const renderAsk = () => renderTpl(askTemplate(), $('#ask'));

/* ── 모델에게 묻기 ───────────────────────── */
const systemFor = () => systemBlocks(VERSION, STAGES, BY_STAGE);

async function runModel() {
  const want = ak.prompt.trim();
  if (!want || ak.busy) return;
  if (!ak.key) { openPack(); return; }        // 키가 없으면 복붙으로 가는 길을 연다

  ak.busy = true; ak.error = ''; repaint();
  try {
    const { text } = await ask({
      key: ak.key,
      model: ak.model,
      system: systemFor(),
      user: userText(want, ak.command.trim()),
    });
    const { command, note } = extractCommand(text);
    if (!command) {
      ak.error = '답에서 명령어를 찾지 못했다 — 프롬프트 복사로 직접 물어볼 것';
    } else {
      ak.command = command;
      ak.note = note;
      ak.prompt = '';
      ak.history = pushHistory(ak.history, { command, prompt: want });
    }
  } catch (e) {
    ak.error = e instanceof AskError ? e.message : `실패했다 — ${e.message}`;
  } finally {
    ak.busy = false; repaint();
  }
}

/** 키 없이 쓰는 길. 시스템 프롬프트와 요구를 한 덩어리로 만들어 준다. */
export function packText() {
  const sys = systemFor().map(b => b.text).join('\n\n');
  const want = ak.prompt.trim() || '(여기에 무엇을 받고 싶은지 쓴다)';
  return `${sys}\n\n---\n\n${userText(want, ak.command.trim())}`;
}

function openPack() {
  $('#pack-ver').textContent = VERSION;
  $('#pack-text').value = packText();
  $('#dlg-pack').showModal();
}

function openKeyDialog() {
  $('#key-input').value = ak.key;
  $('#dlg-key').showModal();
}

/* ── 저장물 ──────────────────────────────── */
// 키와 모델은 그래프 스냅샷과 수명이 다르므로 각자 키를 쓴다.

export function loadAsk(storage) {
  try {
    ak.key = storage.getItem(KEY_STORE) || '';
    ak.model = storage.getItem(MODEL_STORE) || DEFAULT_MODEL;
  } catch { /* 저장소가 막혀 있어도 이번 세션은 쓴다 */ }
  ak.history = loadHistory(storage);
  const draft = loadDraft(storage);
  if (draft) Object.assign(ak, draft);
}

export function saveAsk(storage) {
  saveDraft(storage, { prompt: ak.prompt, command: ak.command, note: ak.note });
  saveHistory(storage, ak.history);
  try { storage.setItem(MODEL_STORE, ak.model); } catch { /* 다음에 다시 고르면 된다 */ }
}
