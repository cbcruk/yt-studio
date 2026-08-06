/**
 * `-P` 항목 한 줄 읽기.
 *
 * `-P` 는 `[TYPES:]PATH` 다. 종류가 앞에 붙는데 윈도 경로(`C:/dl`)를 종류로
 * 오인하면 안 되므로, **아는 종류일 때만** 자른다.
 */
import { OUT_TYPES } from './output-template.js';

/** `-P` 가 받는 종류. `-o` 의 종류에 저장 전용인 home·temp 가 더 붙는다. */
const PATH_TYPES = ['home', 'temp', ...OUT_TYPES.map(([v]) => v).filter(Boolean)];
const PATH_TYPE_SET = new Set(PATH_TYPES);

export function splitEntry(line: string): { type: string; path: string } {
  const s = (line || '').trim();
  const i = s.indexOf(':');
  if (i > 0 && PATH_TYPE_SET.has(s.slice(0, i))) {
    return { type: s.slice(0, i), path: s.slice(i + 1) };
  }
  return { type: '', path: s };
}
