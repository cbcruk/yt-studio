/**
 * Reading one `-P` entry.
 *
 * `-P` is `[TYPES:]PATH`. The type comes first, but a Windows path (`C:/dl`)
 * must not be mistaken for a type, so it splits **only on a known type**.
 */
import { OUT_TYPES } from './output-template.js';

/** Types `-P` accepts: the `-o` types plus the storage-only home · temp. */
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
