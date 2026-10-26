// 해시 라우팅 SPA fixture. #/inbox, #/settings, 그 외는 "없는 화면".
(() => {
  const app = document.getElementById('app');

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    for (const c of children.flat()) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }

  const views = {
    '/inbox': () => [
      h('h1', {}, '받은 메시지'),
      h('ul', { id: 'messageList' }, h('li', {}, '회의 일정 안내'), h('li', {}, '보고서 제출 요청')),
      h('button', { id: 'btnCompose', type: 'button' }, '새 메시지'),
      h('button', { id: 'btnRefresh', type: 'button' }, '새로 고침'),
    ],
    '/settings': () => [
      h('h1', {}, '메시지 설정'),
      h('form', { id: 'settingsForm' },
        h('label', { for: 'displayName' }, '표시 이름'),
        h('input', { id: 'displayName', name: 'displayName', type: 'text', placeholder: '보낸 사람에 표시할 이름' }),
        h('label', {}, h('input', { id: 'notifyEmail', name: 'notifyEmail', type: 'checkbox' }), ' 이메일 알림 받기'),
        h('button', { id: 'btnSaveSettings', type: 'button' }, '설정 저장')),
    ],
  };

  function render() {
    const path = location.hash.replace(/^#!?/, '') || '/';
    const view = views[path];
    app.replaceChildren(...(view ? view() : path === '/'
      ? [h('h1', {}, '메시지함'), h('p', {}, '위 메뉴에서 화면을 고르세요.')]
      : [h('h1', {}, '없는 화면'), h('p', {}, `${path} 화면은 없습니다.`)]));
  }

  window.addEventListener('hashchange', render);
  render();
})();
