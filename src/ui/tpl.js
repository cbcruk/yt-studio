/**
 * 템플릿 엔진 어댑터.
 *
 * 개발에서는 lit-html 을 그대로 import 하고, 배포에서는 build.py 가 이 파일을
 * 미리 구워 둔 vendor/lit-html.iife.js + 별칭 몇 줄로 갈아 끼운다.
 * schema-data.js 와 같은 수법이라, 배포 빌드는 여전히 파이썬만으로 돈다.
 */
import { html as _html, render as _render, nothing as _nothing } from 'lit-html';
import { repeat as _repeat } from 'lit-html/directives/repeat.js';

export const html = _html;
export const renderTpl = _render;
export const nothing = _nothing;
export const repeat = _repeat;
