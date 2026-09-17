/**
 * Page assembly — one pane of editor, one pane of preview.
 *
 * When the text changes: transpile, run, check the resulting command, and redraw the
 * four panes. It runs continuously while a person types, so it is throttled a little.
 */
import { mount } from './editor.js';
import { EXAMPLES } from './examples.js';
import { evaluate, RunError, yt } from './run.js';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  meta: $('meta'), tabs: $('tabs'), note: $('note'),
  diags: $<HTMLUListElement>('diags'), command: $('command'),
  verdict: $('verdict'), issues: $<HTMLUListElement>('issues'),
  explain: $<HTMLUListElement>('explain'), file: $('file'),
  copy: $<HTMLButtonElement>('copy'),
};

els.meta.textContent =
  `yt-dlp ${yt.source.version} · 옵션 ${yt.schema.opts.length}개 · 이 목록은 설치된 yt-dlp 를 리플렉션해서 만든 것이다`;

const editor = mount($('editor'), EXAMPLES[0]!.code);

// ── Example tabs ──
EXAMPLES.forEach((ex, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = ex.name;
  b.className = i === 0 ? 'on' : '';
  b.onclick = () => {
    for (const o of els.tabs.children) o.className = '';
    b.className = 'on';
    els.note.textContent = ex.note;
    editor.set(ex.code);
  };
  els.tabs.append(b);
});
els.note.textContent = EXAMPLES[0]!.note;

// ── Rendering ──
const text = (tag: string, cls: string, s: string): HTMLElement => {
  const el = document.createElement(tag);
  el.className = cls;
  el.textContent = s;
  return el;
};

function fill(ul: HTMLUListElement, rows: HTMLElement[]): void {
  ul.replaceChildren(...rows);
}

async function render(): Promise<void> {
  const errors = await editor.errors();
  els.diags.hidden = errors.length === 0;
  fill(els.diags, errors.map(e => text('li', '', e)));

  let out;
  try {
    out = evaluate(await editor.emit());
  } catch (e) {
    // If a type error is already shown, that is the cause, so do not say it twice.
    if (!errors.length) {
      els.diags.hidden = false;
      fill(els.diags, [text('li', '', e instanceof RunError ? e.message : String(e))]);
    }
    return;
  }

  els.command.firstElementChild!.textContent = out.command;

  const { counts } = out.lint;
  els.verdict.textContent = out.lint.ok && !counts.warn
    ? '확인됨'
    : [counts.error && `오류 ${counts.error}`, counts.warn && `경고 ${counts.warn}`]
      .filter(Boolean).join(' · ');
  els.verdict.className = `hint ${counts.error ? 'bad' : counts.warn ? 'warn' : 'good'}`;

  fill(els.issues, out.lint.issues.map(i => {
    const li = document.createElement('li');
    li.className = i.level;
    li.append(text('span', 'lv', i.level === 'error' ? '오류' : i.level === 'warn' ? '경고' : '참고'));
    li.append(text('span', 'msg', i.msg));
    return li;
  }));

  fill(els.explain, out.explained.map(e => {
    const li = document.createElement('li');
    li.append(text('code', 'tok', e.text));
    li.append(text('span', 'ko', e.ko));
    if (e.stageLabel) li.append(text('span', 'stage', e.stageLabel));
    return li;
  }));

  els.file.textContent = out.file.dflt
    ? `${out.file.text}  (yt-dlp 기본값 — -o 를 안 줬다)`
    : out.file.text;
}

// Hitting the worker on every keystroke makes the screen stutter.
let timer: ReturnType<typeof setTimeout>;
const schedule = (): void => {
  clearTimeout(timer);
  timer = setTimeout(() => void render(), 180);
};

editor.onChange(schedule);
void render();

els.copy.onclick = () => {
  const cmd = els.command.textContent ?? '';
  void navigator.clipboard.writeText(cmd).then(() => {
    els.copy.textContent = '복사됨';
    setTimeout(() => { els.copy.textContent = '복사'; }, 1200);
  });
};
