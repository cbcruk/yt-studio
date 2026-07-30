/**
 * DOM 손잡이.
 *
 * 한 줄짜리지만 파일이 따로 있어야 한다. 배포 빌드가 모듈을 한 스코프로
 * 합치므로 두 파일에서 각자 `const $` 를 선언하면 이름이 겹쳐 빌드가 막는다.
 */
export const $ = s => document.querySelector(s);
