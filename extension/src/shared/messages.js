// 메시지 타입의 단일 정의. 이 파일에는 MSG만 둔다(검사기가 대문자 상수를 MSG로 읽는다).
// 콘텐츠 스크립트(src/content/page-agent.js)에 같은 값의 복사본이 있다. 바꾸면 함께 바꾼다.
export const MSG = Object.freeze({
  MANUAL_UPDATED: 'MANUAL_UPDATED',
  GET_CURRENT_MANUAL: 'GET_CURRENT_MANUAL',
  REFRESH_MANUAL: 'REFRESH_MANUAL',
  REGENERATE_MANUAL: 'REGENERATE_MANUAL',
  EXTRACT_PAGE: 'EXTRACT_PAGE',
  HIGHLIGHT: 'HIGHLIGHT',
  CLEAR_HIGHLIGHT: 'CLEAR_HIGHLIGHT',
});
