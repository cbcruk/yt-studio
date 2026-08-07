/**
 * 스키마 → 옵션 메서드의 타입 선언.
 *
 * 같은 일을 하는 자리가 둘이라 여기 모았다.
 *
 *   · `gen_options.ts` 가 저장소를 구울 때 — 옵션 191개 전부를 `Options` 로
 *   · `ytstudio types` 가 손님 환경에서 — **번들과 달라진 것만** 확장 선언으로
 *
 * 둘이 같은 이름과 같은 시그니처를 내야 한다. 규칙이 두 벌이면 타입은 있는데
 * 메서드는 없는 칸이 생긴다 — 그래서 `methodName` 도 여기 하나만 둔다.
 *
 * 이 모듈은 아무것도 import 하지 않는다(타입만 빼고). 생성기가 이걸 쓰는데
 * 생성물에 기대면 `options.gen.ts` 가 없을 때 생성기가 못 돈다.
 */
import type { Opt } from './schema.js';

/** `--embed-subs` → `embedSubs`. 짧은 플래그는 안 쓴다 — 코드는 읽으라고 있다. */
export const methodName = (flag: string): string =>
  String(flag).replace(/^--?/, '').replace(/-+([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** `bv*` → `bvStar`. 새 이름을 지어내면 yt-dlp 문서와 대조가 안 된다. */
export const selMethod = (sel: string): string => sel.replace('*', 'Star');

/**
 * 도움말을 JSDoc 안에 안전하게 넣는다.
 *
 * 닫는 기호가 그대로 들어오면 주석이 거기서 끝나 버린다 — 예전에 생성기가
 * 그것 때문에 한 번 깨졌다.
 */
export const doc = (s: string): string =>
  String(s || '').replace(/\*\//g, '*\\/').replace(/\s+/g, ' ').trim();

export const union = (xs: readonly string[]): string => xs.map(x => `'${x}'`).join(' | ');

/** `-f` · `-o` · `-P` 는 값 자체가 구조라 `build.ts` 가 손으로 쓴 시그니처를 갖는다. */
export const HAND_WRITTEN = new Set(['format', 'output', 'paths']);

/** 옵션 하나의 메서드 선언. JSDoc 까지 붙는다 — 자동완성에 뜨는 도움말이 이것이다. */
export function optionMethod(o: Opt, extra?: string): string {
  const name = methodName(o.flag);
  const alias = [o.short, ...(o.aliases || [])].filter(Boolean);
  const lines = [
    '  /**',
    `   * \`${o.flag}\`${alias.length ? ` (${alias.join(' · ')})` : ''} — ${doc(o.help)}`,
    '   *',
    `   * @stage ${o.stage} · ${doc(o.group)}`,
  ];
  if (o.negation) lines.push(`   * @remarks \`.${name}(false)\` → \`${o.negation}\``);
  if (extra) lines.push(`   * ${extra}`);
  lines.push('   */');

  const sig = o.kind === 'flag' ? 'on?: boolean'
    : o.kind === 'choice' ? `value: ${union(o.choices ?? [])}`
      : o.kind === 'repeatable' ? '...values: Arg[]'
        : `value: Arg`;
  lines.push(`  ${name}(${sig}): this;`);
  return lines.join('\n');
}

export interface EnvTypes {
  /** 손님이 깐 yt-dlp 버전. */
  version: string;
  /** 번들에 없던 옵션 — 이것들이 메서드로 생긴다. */
  added: Opt[];
  /** 번들에 있었는데 사라진 옵션 — 지울 수는 없어서 취소선만 긋는다. */
  removed: Opt[];
}

/**
 * 프로젝트 루트에 놓을 `ytstudio-env.d.ts` 한 장.
 *
 * **맨 위 `import 'ytstudio'` 가 없으면 안 된다.** 그게 없으면 이 파일이 모듈이
 * 아니라서 `declare module` 이 확장이 아니라 **앰비언트 선언**이 되고, 진짜
 * 패키지를 통째로 가려 버린다(`has no exported member 'ytdlp'`).
 *
 * 확장은 **더하기만** 된다. 사라진 옵션을 지울 방법은 없으므로 같은 시그니처로
 * 다시 선언하면서 `@deprecated` 를 붙인다 — 에디터가 취소선을 긋는다.
 */
export function emitEnvTypes(e: EnvTypes): string {
  // optionMethod 는 최상위 인터페이스(Options)용이라 2칸이다. 여기서는 확장
  // 블록 안이라 한 단계 더 들어간다.
  const body = [
    ...e.added.filter(o => !HAND_WRITTEN.has(o.id)).map(o => optionMethod(o)),
    ...e.removed.filter(o => !HAND_WRITTEN.has(o.id)).map(o =>
      optionMethod(o, `@deprecated yt-dlp ${e.version} 에 없는 옵션이다`)),
  ].map(m => m.split('\n').map(l => `  ${l}`).join('\n'));

  return `// 이 파일은 \`ytstudio types\` 가 만든다. 손으로 고치지 말 것.
// yt-dlp ${e.version} · --help 리플렉션 · 새로 ${e.added.length} · 사라짐 ${e.removed.length}
//
// tsconfig.json 의 include 가 이 파일을 덮어야 먹는다. 안 덮으면 조용히 무시된다.
import 'ytstudio';

declare module 'ytstudio' {
  interface Ytdlp {${body.length ? `\n${body.join('\n\n')}\n  ` : ''}}
}
`;
}
