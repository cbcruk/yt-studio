/**
 * 노드에서 쓰는 입구.
 *
 * `core/` 는 파일 시스템을 모른다는 규칙이 있어서, 스키마를 읽어 넣는 일은
 * 여기서 한다. 브라우저 앱은 같은 일을 `core/schema-data.js` 로 한다 —
 * 번들러가 JSON 을 값으로 박아 넣는다.
 *
 *     import { ytdlp } from 'ytstudio';
 *
 *     ytdlp('https://youtu.be/abc')
 *       .format(f => f.bv({ height: { lte: 1080 } }).plus(f.ba()).or(f.b()))
 *       .output(t => t`${t.title} [${t.id}].${t.ext}`)
 *       .embedSubs()
 *       .build();
 */
import { readFileSync } from 'node:fs';

import { initSchema } from './core/schema.js';

const raw = JSON.parse(
  readFileSync(new URL('../schema.json', import.meta.url), 'utf8'),
);
initSchema(raw);

/** 이 타입과 메서드가 나온 yt-dlp 버전. */
export const YTDLP_VERSION: string = raw.ytdlp_version;

export * from './core/build.js';
