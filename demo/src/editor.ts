/**
 * 브라우저 안의 타입스크립트.
 *
 * monaco 는 에디터이면서 **타입스크립트 언어 서비스**를 워커로 들고 있다.
 * 그래서 이 파일 하나로 두 가지를 다 얻는다 — 자동완성·마우스오버·오류
 * 표시가 진짜 타입 검사에서 나오고, 같은 워커에게 **트랜스파일**도 시킬 수
 * 있다(`getEmitOutput`). 손으로 만든 자동완성 목록도, 따로 얹은 컴파일러도
 * 없다.
 *
 * `monaco-editor` 를 통째로 import 하면 80개 남짓한 언어의 문법 강조가 전부
 * 딸려 온다. 여기 필요한 것은 타입스크립트 하나뿐이라 조각으로 가져온다.
 */
import { editor, Uri } from 'monaco-editor/editor/editor.api';

// `editor.api` 는 껍데기다. 기능은 하나씩 붙는다 — `editor.main` 을 부르면
// 전부(찾기 · 접기 · diff · 코드렌즈 …) 딸려 온다. 플레이그라운드에 필요한
// 것만 고른다. **suggest 와 hover 가 이 데모의 주인공이다** — 자동완성 목록과
// 그 옆에 뜨는 JSDoc 이 곧 `.d.ts` 가 무엇을 담고 있는지 보여 주는 자리다.
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
  // 노드 방식. `'ytstudio'` 는 가상 package.json 의 `types` 로 풀리고, 그
  // 안의 `./core/schema.js` 같은 배포용 상대 경로는 타입스크립트가 `.d.ts` 로
  // 바꿔 가며 찾는다.
  moduleResolution: ModuleResolutionKind.NodeJs,
  strict: true,
  noEmitOnError: false,
  allowNonTsExtensions: true,
  lib: ['esnext'],
});
typescriptDefaults.setEagerModelSync(true);

for (const { path, content } of libs) typescriptDefaults.addExtraLib(content, path);

editor.defineTheme('ytstudio', {
  base: 'vs-dark', inherit: true, rules: [],
  colors: { 'editor.background': '#141821', 'editorLineNumber.foreground': '#3d4657' },
});

const MODEL = Uri.parse('file:///demo/main.ts');

export interface Editor {
  /** 지금 글을 자바스크립트로 옮긴 것. 타입 오류가 있어도 낼 수 있는 만큼 낸다. */
  emit(): Promise<string>;
  /** 타입 검사에서 나온 것들. */
  errors(): Promise<string[]>;
  /** 글이 바뀔 때마다. */
  onChange(fn: () => void): void;
  set(code: string): void;
}

export function mount(el: HTMLElement, code: string): Editor {
  const model = editor.createModel(code, 'typescript', MODEL);
  const ed = editor.create(el, {
    model,
    theme: 'ytstudio',
    fontSize: 13,
    lineHeight: 21,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    padding: { top: 14, bottom: 14 },
    renderLineHighlight: 'none',
    tabSize: 2,
    // 자동완성이 이 데모의 주인공이라 곧바로 뜨게 둔다. 문자열 안에서도 켠다 —
    // 옵션 **값**의 목록(`convertSubs('srt')`)이 거기서 뜬다.
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestOnTriggerCharacters: true,
  });

  const uri = model.uri.toString();

  /**
   * 언어 서비스는 **모델이 생긴 뒤에 게으르게** 붙는다 — monaco 가
   * `onLanguage('typescript')` 에서 tsMode 를 동적으로 받아 온다. 그래서 첫
   * 그리기가 그보다 빠르면 "TypeScript not registered!" 로 튕긴다. 한 번
   * 튕기고 마는 대신 붙을 때까지 기다린다.
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
