// pushState SPA fixture. 새로고침 없이 #app 내용만 바꾼다.
(() => {
  const app = document.getElementById('app');

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'onclick') el.addEventListener('click', v);
      else el.setAttribute(k, v);
    }
    for (const c of children.flat()) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }
  function field(id, label, input) {
    return h('div', {}, h('label', { for: id }, label), input);
  }

  function navigate(path) {
    if (path === location.pathname) return;
    history.pushState({}, '', path);
    render();
  }

  const views = {
    home: () => [
      h('h1', {}, '주문 관리 홈'),
      h('p', {}, '주문을 조회하고 새 주문을 등록하는 업무 화면입니다.'),
      h('p', { class: 'notice' }, '오늘 처리할 주문이 3건 있습니다.'),
      h('button', { id: 'btnGoOrders', type: 'button', onclick: () => navigate('/spa/orders') }, '주문 목록 보기'),
    ],
    orders: () => [
      h('h1', {}, '주문 목록'),
      field('statusFilter', '상태', h('select', { id: 'statusFilter', name: 'statusFilter' },
        h('option', {}, '전체'), h('option', {}, '접수'), h('option', {}, '출고'))),
      h('table', { id: 'orderTable' },
        h('caption', {}, '주문 목록'),
        h('thead', {}, h('tr', {}, h('th', {}, '주문번호'), h('th', {}, '고객명'), h('th', {}, '상태'))),
        h('tbody', {},
          h('tr', {}, h('td', {}, h('a', { href: '/spa/orders/1001', 'data-spa-link': '' }, '1001')), h('td', {}, '고객 A'), h('td', {}, '접수')),
          h('tr', {}, h('td', {}, h('a', { href: '/spa/orders/1002', 'data-spa-link': '' }, '1002')), h('td', {}, '고객 B'), h('td', {}, '출고')))),
      h('button', { id: 'btnNewOrder', type: 'button', onclick: () => navigate('/spa/orders/new') }, '새 주문'),
    ],
    newOrder: () => {
      const status = h('p', { id: 'saveStatus', role: 'status' });
      return [
        h('h1', {}, '새 주문 등록'),
        h('form', { id: 'orderForm' },
          field('customerName', '고객명', h('input', { id: 'customerName', name: 'customerName', type: 'text', placeholder: '고객 이름' })),
          field('productCode', '상품 코드', h('input', { id: 'productCode', name: 'productCode', type: 'text', placeholder: '예: P-001' })),
          field('quantity', '수량', h('input', { id: 'quantity', name: 'quantity', type: 'number', min: '1' })),
          field('deliveryDate', '납기일', h('input', { id: 'deliveryDate', name: 'deliveryDate', type: 'date' })),
          field('orderMemo', '메모', h('textarea', { id: 'orderMemo', name: 'orderMemo', placeholder: '전달 사항' })),
          h('small', {}, '고객명과 상품 코드는 반드시 입력합니다.'),
          h('div', {},
            h('button', { id: 'btnSave', type: 'button', onclick: () => { status.textContent = '저장되었습니다(시험용, 실제 저장 없음).'; } }, '저장'),
            h('button', { id: 'btnCancel', type: 'button', onclick: () => navigate('/spa/orders') }, '취소'))),
        status,
      ];
    },
    order: id => [
      h('h1', {}, `주문 상세 ${id}`),
      h('p', {}, '주문 정보와 처리 상태를 확인하는 화면입니다.'),
      h('button', { id: 'btnBackToList', type: 'button', onclick: () => navigate('/spa/orders') }, '목록'),
    ],
    notFound: () => [h('h1', {}, '화면을 찾을 수 없습니다')],
  };

  function route(path) {
    const p = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
    if (p === '/spa') return views.home();
    if (p === '/spa/orders') return views.orders();
    if (p === '/spa/orders/new') return views.newOrder();
    const m = p.match(/^\/spa\/orders\/([^/]+)$/);
    if (m) return views.order(m[1]);
    return views.notFound();
  }

  function render() {
    app.replaceChildren(...route(location.pathname));
    const h1 = app.querySelector('h1');
    document.title = `주문 관리 - ${h1 ? h1.textContent : ''}`;
  }

  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-spa-link]');
    if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    navigate(new URL(a.href).pathname);
  });
  window.addEventListener('popstate', render);
  render();
})();
