/**
 * TypeScript inside the browser.
 *
 * monaco is an editor that also carries **the TypeScript language service** as a
 * worker. So this one file gets both — autocomplete · hover · error markers come
 * from real type checking, and the same worker can also **transpile**
 * (`getEmitOutput`). No hand-made autocomplete list, no separately bundled compiler.
 *
 * Importing `monaco-editor` whole drags in syntax highlighting for 80-odd languages.
 * Only TypeScript is needed here, so it is imported piece by piece.
 */
import { editor, Uri } from 'monaco-editor/editor/editor.api';

// `editor.api` is a stub. Features attach one by one — importing `editor.main` pulls in
// everything (find · folding · diff · code lens …). Pick only what the playground needs.
// **suggest and hover are the stars of this demo** — the autocomplete list and the JSDoc
// beside it are where it shows what the `.d.ts` contains.
import 'monaco-editor/editor/browser/coreCommands';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController';
import 'monaco-editor/editor/contrib/snippet/browser/snippetController2';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution';
import 'monaco-editor/editor/contrib/parameterHints/browser/parameterHints';
import 'monaco-editor/editor/contrib/tokenization/browser/tokenization';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations';
import 'monaco-editor/languages/definitions/typescript/register';
import {
  getTypeScriptWorker, typescriptDefaults,
  ModuleKind, ModuleResolutionKind, ScriptTarget,
} from 'monaco-editor/languages/features/typescript/register';
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker';

import { libs } from './types.js';

self.MonacoEnvironment = {
  getWorker: (_id: string, label: string) =>
    (label === 'typescript' || label === 'javascript' ? new tsWorker() : new editorWorker()),
};

typescriptDefaults.setCompilerOptions({
  target: ScriptTarget.ESNext,
  module: ModuleKind.ESNext,
  // Node-style. `'yt-studio'` resolves through the virtual package.json's `types`, and
  // shipped relative paths inside it like `./core/schema.js` are looked up by TypeScript
  // as `.d.ts`.
  moduleResolution: ModuleResolutionKind.NodeJs,
  strict: true,
  noEmitOnError: false,
  allowNonTsExtensions: true,
  lib: ['esnext'],
});
typescriptDefaults.setEagerModelSync(true);

for (const { path, content } of libs) typescriptDefaults.addExtraLib(content, path);

editor.defineTheme('yt-studio', {
  base: 'vs-dark', inherit: true, rules: [],
  colors: { 'editor.background': '#141821', 'editorLineNumber.foreground': '#3d4657' },
});

const MODEL = Uri.parse('file:///demo/main.ts');

export interface Editor {
  /** The current text as JavaScript. Emits as much as it can even with type errors. */
  emit(): Promise<string>;
  /** What type checking produced. */
  errors(): Promise<string[]>;
  /** On every text change. */
  onChange(fn: () => void): void;
  set(code: string): void;
}

export function mount(el: HTMLElement, code: string): Editor {
  const model = editor.createModel(code, 'typescript', MODEL);
  const ed = editor.create(el, {
    model,
    theme: 'yt-studio',
    fontSize: 13,
    lineHeight: 21,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    padding: { top: 14, bottom: 14 },
    renderLineHighlight: 'none',
    tabSize: 2,
    // Autocomplete is the star of this demo, so let it pop up immediately. Enable it inside
    // strings too — that is where lists of option **values** (`convertSubs('srt')`) appear.
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestOnTriggerCharacters: true,
  });

  const uri = model.uri.toString();

  /**
   * The language service attaches **lazily, after a model exists** — monaco loads tsMode
   * dynamically on `onLanguage('typescript')`. So if the first render is faster than
   * that, it bails with "TypeScript not registered!". Instead of bailing once, wait
   * until it attaches.
   */
  const client = async () => {
    for (let i = 0; ; i++) {
      try {
        return await getTypeScriptWorker().then(get => get(model.uri));
      } catch (e) {
        if (i >= 100) throw e;
        await new Promise(r => setTimeout(r, 30));
      }
    }
  };

  return {
    async emit() {
      const out = await (await client()).getEmitOutput(uri);
      return out.outputFiles[0]?.text ?? '';
    },
    async errors() {
      const c = await client();
      const ds = [...await c.getSyntacticDiagnostics(uri), ...await c.getSemanticDiagnostics(uri)];
      return ds.map(d => (typeof d.messageText === 'string' ? d.messageText : d.messageText.messageText));
    },
    onChange(fn) { model.onDidChangeContent(() => fn()); },
    set(next) { ed.setValue(next); },
  };
}
