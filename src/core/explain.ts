/**
 * 명령어를 사람 말로 되돌린다.
 *
 * 검증기가 "틀렸다"를 말한다면 여기는 **"이게 무슨 뜻이다"** 를 말한다.
 * 프롬프트로 받은 명령어는 내가 쓴 것이 아니라 남이 준 것이라, 돌리기 전에
 * 읽을 수 있어야 한다. 그게 이 흐름에서 신뢰가 생기는 유일한 자리다.
 *
 *   · 토큰마다 무슨 옵션이고 어느 단계에 속하는지
 *   · 이 명령어가 만들 **파일명**이 어떤 모양인지
 *   · 지금 옵션 조합에 이어서 줄 만한 것이 무엇인지
 */

import { previewTemplate, parseTemplate, splitType } from './output-template.js';
import { splitEntry } from './paths.js';
import type { Opt, Schema } from './schema.js';
import type { Item } from './command.js';
import type { Values } from './lint.js';

/** 이 명령어가 만들 파일명. `-o` 를 못 읽었으면 `ok` 가 거짓이고 원문이 그대로 온다. */
export interface FilePreview {
  ok: boolean;
  /** `-o` 앞에 붙은 종류 접두어(`thumbnail:` 의 `thumbnail`). */
  type: string;
  text: string;
  /** `-o` 가 없어서 yt-dlp 기본 템플릿을 쓴 경우. */
  dflt?: boolean;
}

/** 토큰 하나를 한 줄로 읽은 것. */
export interface Explained {
  kind: Item['kind'];
  text: string;
  ko: string;
  id?: string;
  stage?: string;
  stageLabel?: string;
  value?: string | null;
}

/** 이어서 줄 만한 옵션 하나와 그 이유. */
export interface Suggestion {
  opt: Opt;
  why: string;
}

/** -o 를 안 주면 yt-dlp 가 쓰는 기본 출력 템플릿. */
export const DEFAULT_OUTTMPL = '%(title)s [%(id)s].%(ext)s';

/**
 * 이 명령어가 만들 파일명.
 *
 * 값을 모르므로 필드는 ‹제목› 처럼 자리표시자로 둔다. -P home 이 있으면
 * 앞에 붙인다 — "어디에 무엇이 놓이는가"가 한 줄로 보여야 한다.
 */
export function previewFilename(values: Values): FilePreview {
  const rawOut = (Array.isArray(values.output) ? values.output[0] : values.output) as string | null;
  const { type, template } = splitType(rawOut || DEFAULT_OUTTMPL);
  let body: string;
  try { body = previewTemplate(parseTemplate(template)); }
  catch { return { ok: false, text: rawOut || DEFAULT_OUTTMPL, type }; }

  let home = '';
  if (values.paths) {
    for (const line of ([] as string[]).concat(values.paths as string | string[])) {
      const e = splitEntry(line);
      if (!e.type || e.type === 'home') home = e.path;
    }
  }
  const sep = home && !/[/\\]$/.test(home) ? '/' : '';
  return { ok: true, type, text: home + sep + body, dflt: !rawOut };
}

/** 토큰 하나를 한 줄로 설명한다. */
export function explainItem(schema: Schema, it: Item): Explained {
  if (it.kind === 'url') return { kind: 'url', text: it.raw, ko: '받을 대상' };
  if (it.kind === 'unknown') return { kind: 'unknown', text: it.raw, ko: '읽지 못한 토큰' };
  const { opt, negated, value } = it;
  const help = (opt.help || '').replace(/\s+/g, ' ').trim();
  return {
    kind: 'opt',
    id: opt.id,
    text: it.raw,
    stage: opt.stage,
    stageLabel: schema.stage[opt.stage]?.label || opt.stage,
    value,
    ko: negated ? `${help} — 끄기` : help,
  };
}

export const explainCommand = (schema: Schema, items: Item[]): Explained[] =>
  items.map(it => explainItem(schema, it));

/**
 * 지금 조합에서 자연스럽게 따라오는 옵션들.
 *
 * "191개 중 아무거나"가 아니라 **지금 명령어가 부르는 것**만 낸다. 목록을
 * 훑게 하는 대신 다음 한 걸음을 놓아 주는 쪽이 옵션이 많을 때 유일하게
 * 통한다. 규칙은 손으로 정한다 — 스키마에는 이런 이웃 관계가 없다.
 */
const RULES: { when: (v: Values) => unknown; ids: string[]; why: string }[] = [
  { when: v => v['extract-audio'], ids: ['audio-format', 'audio-quality', 'embed-thumbnail', 'embed-metadata'],
    why: '음원만 뽑을 때 대개 같이 준다' },
  { when: v => v['write-subs'] || v['write-auto-subs'], ids: ['sub-langs', 'embed-subs', 'sub-format'],
    why: '자막을 받을 때 이어지는 것' },
  { when: v => typeof v.format === 'string' && v.format.includes('+'), ids: ['merge-output-format'],
    why: '합칠 컨테이너를 정한다' },
  { when: v => v['download-sections'], ids: ['force-keyframes-at-cuts', 'split-chapters'],
    why: '구간을 자를 때 이어지는 것' },
  { when: v => v.output || v.paths, ids: ['restrict-filenames', 'windows-filenames', 'trim-filenames'],
    why: '파일명이 깨지는 걸 막는다' },
  { when: v => v.cookies || v['cookies-from-browser'], ids: ['sleep-requests', 'impersonate'],
    why: '로그인 상태로 긁을 때 차단을 덜 부른다' },
  { when: v => v['sponsorblock-remove'] || v['sponsorblock-mark'], ids: ['sponsorblock-chapter-title'],
    why: '표시 이름을 정한다' },
];

/** 아무 규칙도 안 걸릴 때. 처음 만든 명령어에도 다음 걸음이 있어야 한다. */
const STARTERS = ['format', 'output', 'paths', 'download-archive', 'embed-metadata'];

export function suggestNext(schema: Schema, values: Values, limit = 6): Suggestion[] {
  const out: Suggestion[] = [];
  const push = (id: string, why: string): void => {
    const o = schema.byId[id];
    if (!o || id in values || out.some(x => x.opt.id === id)) return;
    out.push({ opt: o, why });
  };
  for (const r of RULES) { if (r.when(values)) r.ids.forEach(id => push(id, r.why)); }
  if (!out.length) STARTERS.forEach(id => push(id, '거의 모든 명령어가 결국 쓴다'));
  return out.slice(0, limit);
}
