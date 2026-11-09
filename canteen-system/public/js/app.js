'use strict';

/**
 * 橙味食堂 · 前端应用
 * ------------------------------------------------------------------
 * 原生 ES6 实现，无构建步骤；页面按小程序「tabBar + 页面」组织。
 * 所有接口使用相对路径，根路径与反代到 /apps/xxx/ 下都能正常工作。
 */

(function () {
  const API = './api';
  const STORAGE = {
    user: 'canteen_user',
    cart: 'canteen_cart',
    table: 'canteen_table'
  };

  const state = {
    user: null,
    cart: {},
    dishes: [],
    category: '热销',
    table: 'A01',
    route: 'home',
    orderFilter: '',
    orders: [],
    kitchenOrders: [],
    kitchenStats: null,
    stats: null,
    adminTab: 'dishes',
    adminDishes: [],
    adminOrders: [],
    submitting: false,
    ws: null,
    wsTimer: null,
    wsConnected: false,
    newOrderIds: new Set()
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ------------------------------------------------------------ 工具函数

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(value) {
    return '¥' + Number(value || 0).toFixed(2);
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function formatTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function timeAgo(iso) {
    const time = new Date(iso).getTime();
    if (!time) return '';
    const diff = Math.max(0, Date.now() - time);
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return minutes + ' 分钟前';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + ' 小时前';
    return formatTime(iso);
  }

  function statusClass(status) {
    if (status === 'cooking') return 'status-cooking';
    if (status === 'done') return 'status-done';
    return 'status-pending';
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 11) return '早上好';
    if (hour < 14) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }

  let toastTimer = null;
  function toast(message, duration = 1600) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  async function api(path, options = {}) {
    const headers = Object.assign({}, options.headers || {});
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (state.user && state.user.role === 'admin') headers['x-role'] = 'admin';

    const res = await fetch(API + path, Object.assign({}, options, { headers }));
    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      data = null;
    }
    if (!res.ok) {
      throw new Error((data && data.error) || `请求失败（${res.status}）`);
    }
    return data;
  }

  // ------------------------------------------------------------ 本地存储

  function loadStorage() {
    try {
      state.user = JSON.parse(localStorage.getItem(STORAGE.user) || 'null');
    } catch (err) {
      state.user = null;
    }
    try {
      const cart = JSON.parse(localStorage.getItem(STORAGE.cart) || '{}');
      state.cart = cart && typeof cart === 'object' ? cart : {};
    } catch (err) {
      state.cart = {};
    }
    state.table = localStorage.getItem(STORAGE.table) || 'A01';
  }

  function saveUser() {
    if (state.user) localStorage.setItem(STORAGE.user, JSON.stringify(state.user));
    else localStorage.removeItem(STORAGE.user);
  }

  function saveCart() {
    localStorage.setItem(STORAGE.cart, JSON.stringify(state.cart));
  }

  function saveTable() {
    localStorage.setItem(STORAGE.table, state.table);
  }

  // ------------------------------------------------------------ 路由

  function routeFromHash() {
    const hash = location.hash.replace(/^#\/?/, '');
    return ['home', 'orders', 'kitchen', 'mine', 'admin'].includes(hash) ? hash : 'home';
  }

  async function navigate(route) {
    let target = route;

    if (target === 'admin' && (!state.user || state.user.role !== 'admin')) {
      toast('请先使用管理员账号登录');
      target = 'mine';
      if (location.hash !== '#/mine') history.replaceState(null, '', '#/mine');
    }

    state.route = target;
    document.body.classList.remove('route-home', 'route-orders', 'route-kitchen', 'route-mine', 'route-admin');
    document.body.classList.add('route-' + target);

    $$('.page').forEach((page) => {
      page.classList.toggle('active', page.dataset.page === target);
    });

    $$('#tabbar button').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.route === target);
    });

    window.scrollTo(0, 0);
    renderCartBar();

    if (target === 'home') {
      renderDishes();
    } else if (target === 'orders') {
      loadOrders();
    } else if (target === 'kitchen') {
      loadKitchen();
    } else if (target === 'mine') {
      renderMine();
      loadStats();
    } else if (target === 'admin') {
      loadAdminAll();
    }
  }

  // ------------------------------------------------------------ 初始化

  async function init() {
    loadStorage();
    buildTableOptions();
    bindEvents();
    updateHeader();
    renderMine();
    renderCartBar();
    startClock();

    if (!/^#\/(home|orders|kitchen|mine|admin)$/.test(location.hash)) {
      history.replaceState(null, '', '#/home');
    }

    await loadDishes();
    await navigate(routeFromHash());
    connectWS();
    loadStats();

    setTimeout(() => {
      const boot = $('#boot');
      if (boot) boot.classList.add('hide');
    }, 450);
  }

  // ------------------------------------------------------------ 顶部 / 桌号

  function updateHeader() {
    const avatar = $('#headerAvatar');
    const adminEntry = $('#adminEntry');
    const tablePill = $('#tablePill');

    if (state.user) {
      avatar.textContent = state.user.role === 'admin' ? '🧑‍🍳' : '😋';
    } else {
      avatar.textContent = '👤';
    }
    adminEntry.classList.toggle('hidden', !(state.user && state.user.role === 'admin'));
    tablePill.textContent = state.table + ' 桌';

    const heroTitle = $('#heroTitle');
    if (heroTitle) {
      heroTitle.textContent = `${greeting()}，${state.user ? state.user.name + '，' : ''}想吃点什么？`;
    }
  }

  function buildTableOptions() {
    const select = $('#checkoutTable');
    if (!select) return;
    const options = [];
    for (let i = 1; i <= 12; i++) {
      const value = 'A' + String(i).padStart(2, '0');
      options.push(`<option value="${value}"${value === state.table ? ' selected' : ''}>${value} 桌</option>`);
    }
    select.innerHTML = options.join('');
  }

  function startClock() {
    const tick = () => {
      const el = $('#kitchenClock');
      if (!el) return;
      const now = new Date();
      el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    };
    tick();
    setInterval(tick, 1000);

    // 厨房卡片里的「几分钟前」每 30 秒刷新一次
    setInterval(() => {
      if (state.route === 'kitchen') renderKitchen();
    }, 30000);
  }

  // ------------------------------------------------------------ 菜品列表

  async function loadDishes() {
    try {
      const res = await api('/dishes');
      state.dishes = res.data || [];
      pruneCart();
      renderCategoryTabs();
      renderDishes();
      renderCartBar();
    } catch (err) {
      $('#dishList').innerHTML = `
        <div class="empty">
          <b>😵</b>
          <p>菜单加载失败</p>
          <span>${escapeHtml(err.message)}</span>
          <button data-retry-dishes>重新加载</button>
        </div>`;
    }
  }

  function pruneCart() {
    const valid = new Set(state.dishes.map((d) => String(d.id)));
    let changed = false;
    Object.keys(state.cart).forEach((id) => {
      if (!valid.has(id)) {
        delete state.cart[id];
        changed = true;
      }
    });
    if (changed) saveCart();
  }

  function categories() {
    const list = ['热销'];
    state.dishes.forEach((dish) => {
      if (!list.includes(dish.category)) list.push(dish.category);
    });
    return list;
  }

  function renderCategoryTabs() {
    const tabs = categories();
    if (!tabs.includes(state.category)) state.category = '热销';
    $('#categoryTabs').innerHTML = tabs
      .map(
        (cat) =>
          `<button class="cat-tab${cat === state.category ? ' active' : ''}" data-category="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
      )
      .join('');
  }

  function visibleDishes() {
    return state.dishes.filter((dish) =>
      state.category === '热销' ? dish.isHot : dish.category === state.category
    );
  }

  function renderDishes() {
    const list = visibleDishes();
    const countEl = $('#dishCount');
    if (countEl) countEl.textContent = `共 ${list.length} 道`;

    const wrap = $('#dishList');
    if (!wrap) return;

    if (!list.length) {
      wrap.innerHTML = `
        <div class="empty">
          <b>🍽️</b>
          <p>这个分类还没有菜品</p>
          <span>换个分类看看吧</span>
        </div>`;
      return;
    }

    wrap.innerHTML = list.map(dishCardHtml).join('');
  }

  function dishCardHtml(dish) {
    const qty = Number(state.cart[dish.id] || 0);
    const gradient = dish.gradient || 'linear-gradient(135deg,#ffe3c2,#ffb36b)';
    return `
      <article class="dish-card" data-dish-id="${dish.id}">
        <div class="dish-art" style="background:${escapeHtml(gradient)}">
          <span>${escapeHtml(dish.emoji || '🍽️')}</span>
        </div>
        <div class="dish-body">
          <div class="dish-name-row">
            <div class="dish-name">${escapeHtml(dish.name)}</div>
            ${dish.isHot ? '<span class="hot-badge">热销</span>' : ''}
          </div>
          <p class="dish-desc">${escapeHtml(dish.description || '')}</p>
          <div class="dish-foot">
            <div class="dish-price">
              <small>¥</small><strong>${Number(dish.price).toFixed(2)}</strong>
              <span class="dish-sales">月售 ${Number(dish.sales) || 0}</span>
            </div>
            <div class="dish-actions">
              ${qty ? `<span class="dish-picked">已选 ${qty}</span>` : ''}
              <button class="add-btn" data-add="${dish.id}" aria-label="加入购物车">+</button>
            </div>
          </div>
        </div>
      </article>`;
  }

  // ------------------------------------------------------------ 购物车

  function cartEntries() {
    return Object.keys(state.cart)
      .map((id) => {
        const dish = state.dishes.find((d) => String(d.id) === String(id));
        return { dish, qty: Number(state.cart[id]) || 0 };
      })
      .filter((item) => item.dish && item.qty > 0);
  }

  function cartSummary() {
    const entries = cartEntries();
    return entries.reduce(
      (acc, item) => {
        acc.count += item.qty;
        acc.total += Number(item.dish.price) * item.qty;
        return acc;
      },
      { count: 0, total: 0 }
    );
  }

  function addToCart(dishId) {
    const id = Number(dishId);
    const dish = state.dishes.find((d) => d.id === id);
    if (!dish) {
      toast('该菜品已下架');
      return;
    }
    const current = Number(state.cart[id] || 0);
    if (current >= 99) {
      toast('单个菜品最多 99 份');
      return;
    }
    state.cart[id] = current + 1;
    saveCart();
    renderDishes();
    renderCartBar();
    renderCartSheet();
    toast(`${dish.name} 已加入购物车`, 1100);
  }

  function changeQty(dishId, delta) {
    const id = Number(dishId);
    const next = Number(state.cart[id] || 0) + delta;
    if (next <= 0) delete state.cart[id];
    else state.cart[id] = Math.min(next, 99);
    saveCart();
    renderDishes();
    renderCartBar();
    renderCartSheet();
    if (!cartEntries().length) closeSheets();
  }

  function renderCartBar() {
    const bar = $('#cartBar');
    if (!bar) return;
    const summary = cartSummary();
    $('#cartCount').textContent = summary.count;
    $('#cartTotal').textContent = money(summary.total);
    const show = summary.count > 0 && state.route === 'home';
    bar.classList.toggle('show', show);
  }

  function renderCartSheet() {
    const wrap = $('#cartLines');
    if (!wrap) return;
    const entries = cartEntries();

    if (!entries.length) {
      wrap.innerHTML = `
        <div class="empty">
          <b>🛒</b>
          <p>购物车还是空的</p>
          <span>去挑几样喜欢的菜吧</span>
        </div>`;
      $('#sheetTotal').textContent = money(0);
      return;
    }

    wrap.innerHTML = entries
      .map(
        ({ dish, qty }) => `
        <div class="cart-line">
          <div class="cart-line-emoji">${escapeHtml(dish.emoji || '🍽️')}</div>
          <div class="cart-line-info">
            <strong>${escapeHtml(dish.name)}</strong>
            <span>${money(Number(dish.price) * qty)}</span>
          </div>
          <div class="stepper">
            <button data-minus="${dish.id}" aria-label="减少">−</button>
            <em>${qty}</em>
            <button class="plus" data-plus="${dish.id}" aria-label="增加">+</button>
          </div>
        </div>`
      )
      .join('');

    $('#sheetTotal').textContent = money(cartSummary().total);
  }

  function openCart() {
    renderCartSheet();
    openSheet('cartSheet');
  }

  function openCheckout() {
    if (!state.user) {
      closeSheets();
      toast('请先在「我的」登录后再下单');
      location.hash = '#/mine';
      return;
    }
    if (!cartEntries().length) {
      toast('购物车是空的');
      return;
    }

    const phoneEl = $('#checkoutPhone');
    if (state.user.role === 'admin') {
      phoneEl.value = '管理员';
    } else if (String(state.user.phone || '').startsWith('guest_')) {
      phoneEl.value = '游客体验身份';
    } else {
      phoneEl.value = state.user.phone || '';
    }

    $('#checkoutTable').value = state.table;
    $('#checkoutSummary').innerHTML = `
      <div>${cartEntries()
        .map((item) => `${escapeHtml(item.dish.name)} × ${item.qty}`)
        .join('　')}</div>
      <div style="margin-top:6px">共 ${cartSummary().count} 件，应付 <strong>${money(cartSummary().total)}</strong></div>`;

    openSheet('checkoutSheet');
  }

  async function submitOrder() {
    if (state.submitting) return;
    const entries = cartEntries();
    if (!entries.length) {
      toast('购物车是空的');
      return;
    }
    if (!state.user) {
      toast('请先登录');
      return;
    }

    const btn = $('#submitOrder');
    state.submitting = true;
    btn.disabled = true;
    btn.textContent = '提交中…';

    try {
      state.table = $('#checkoutTable').value || 'A01';
      saveTable();
      updateHeader();

      const res = await api('/orders', {
        method: 'POST',
        body: JSON.stringify({
          items: entries.map((item) => ({ dishId: item.dish.id, qty: item.qty })),
          tableNo: state.table,
          phone: state.user.phone || '',
          remark: $('#checkoutRemark').value.trim()
        })
      });

      state.cart = {};
      saveCart();
      $('#checkoutRemark').value = '';
      renderDishes();
      renderCartBar();
      renderCartSheet();
      closeSheets();
      toast(`下单成功，订单号 ${res.data.orderNo}`);
      state.orderFilter = '';
      if (routeFromHash() === 'orders') await loadOrders();
      else location.hash = '#/orders';
    } catch (err) {
      toast(err.message);
    } finally {
      state.submitting = false;
      btn.disabled = false;
      btn.textContent = '提交订单';
    }
  }

  // ------------------------------------------------------------ 订单页

  async function loadOrders() {
    const wrap = $('#ordersList');
    if (!wrap) return;

    if (!state.user) {
      $('#ordersSub').textContent = '登录后可查看订单进度';
      wrap.innerHTML = `
        <div class="empty">
          <b>🔐</b>
          <p>还没有登录</p>
          <span>登录后即可查看你的点餐记录</span>
          <button data-go="mine">去登录</button>
        </div>`;
      return;
    }

    $('#ordersSub').textContent = '实时同步出餐进度';

    const params = new URLSearchParams();
    params.set('phone', state.user.phone || '');
    params.set('limit', '50');
    if (state.orderFilter) params.set('status', state.orderFilter);

    try {
      const res = await api('/orders?' + params.toString());
      state.orders = res.data || [];
      renderOrders();
    } catch (err) {
      wrap.innerHTML = `
        <div class="empty">
          <b>😵</b>
          <p>订单加载失败</p>
          <span>${escapeHtml(err.message)}</span>
        </div>`;
    }
  }

  function renderOrders() {
    const wrap = $('#ordersList');
    if (!wrap) return;

    if (!state.orders.length) {
      wrap.innerHTML = `
        <div class="empty">
          <b>🧾</b>
          <p>还没有订单</p>
          <span>去点一份好吃的吧</span>
          <button data-go="home">去点餐</button>
        </div>`;
      return;
    }

    $('#ordersSub').textContent = `${state.user ? state.user.name : ''} · 共 ${state.orders.length} 单`;

    wrap.innerHTML = state.orders
      .map(
        (order) => `
        <article class="order-card" data-order-id="${order.id}">
          <div class="order-top">
            <div>
              <div class="order-table">
                <strong>${escapeHtml(order.tableNo)}</strong>
                <span>桌 · ${escapeHtml(order.orderNo)}</span>
              </div>
            </div>
            <span class="order-status ${statusClass(order.status)}">${escapeHtml(order.statusText)}</span>
          </div>
          <div class="order-items">
            ${order.items
              .map(
                (item) => `
                <div class="order-item-row">
                  <span class="oi-emoji">${escapeHtml(item.emoji)}</span>
                  <span class="oi-name">${escapeHtml(item.name)}</span>
                  <span class="oi-qty">×${item.qty}</span>
                  <span class="oi-price">${money(Number(item.price) * item.qty)}</span>
                </div>`
              )
              .join('')}
          </div>
          <div class="order-foot">
            <div class="order-meta">
              <span>下单时间 ${formatTime(order.createdAt)}</span>
              <span>${order.status === 'done' ? '已完成，祝您用餐愉快' : order.status === 'cooking' ? '后厨正在制作中…' : '已下单，等待后厨接单'}</span>
            </div>
            <div class="order-amount">合计<strong>${money(order.amount)}</strong></div>
          </div>
          ${order.remark ? `<div class="order-remark">备注：${escapeHtml(order.remark)}</div>` : ''}
        </article>`
      )
      .join('');
  }

  // ------------------------------------------------------------ 厨房看板

  async function loadKitchen() {
    try {
      const [ordersRes, statsRes] = await Promise.all([
        api('/orders?status=pending,cooking&limit=60'),
        api('/stats')
      ]);
      state.kitchenOrders = ordersRes.data || [];
      state.kitchenStats = statsRes.data;
      renderKitchen();
    } catch (err) {
      $('#kitchenList').innerHTML = `
        <div class="kitchen-empty"><b>⚠️</b>${escapeHtml(err.message)}</div>`;
    }
  }

  function renderKitchen() {
    const wrap = $('#kitchenList');
    const statsWrap = $('#kitchenStats');
    if (!wrap || !statsWrap) return;

    const stats = state.kitchenStats;
    const pending = state.kitchenOrders.filter((o) => o.status === 'pending');
    const cooking = state.kitchenOrders.filter((o) => o.status === 'cooking');

    statsWrap.innerHTML = `
      <div class="k-stat pending"><span>待制作</span><strong>${stats ? stats.orders.pending : pending.length}</strong></div>
      <div class="k-stat cooking"><span>制作中</span><strong>${stats ? stats.orders.cooking : cooking.length}</strong></div>
      <div class="k-stat done"><span>已完成</span><strong>${stats ? stats.orders.done : '--'}</strong></div>`;

    if (!pending.length && !cooking.length) {
      wrap.innerHTML = `
        <div class="kitchen-empty">
          <b>🍳</b>
          当前没有待处理订单<br/>新订单会实时出现在这里
        </div>`;
      return;
    }

    let html = '';
    if (pending.length) {
      html += `<div class="kitchen-section-label"><i></i>待制作 · ${pending.length}</div>`;
      html += pending.map(kitchenCardHtml).join('');
    }
    if (cooking.length) {
      html += `<div class="kitchen-section-label" style="margin-top:8px"><i style="background:#5fa8ff"></i>制作中 · ${cooking.length}</div>`;
      html += cooking.map(kitchenCardHtml).join('');
    }
    wrap.innerHTML = html;
  }

  function kitchenCardHtml(order) {
    const isNew = state.newOrderIds.has(order.id);
    return `
      <article class="k-order${isNew ? ' is-new' : ''}" data-order-id="${order.id}">
        ${isNew ? '<span class="k-new-badge">NEW</span>' : ''}
        <div class="k-order-top">
          <div>
            <div class="k-table"><strong>${escapeHtml(order.tableNo)}</strong><span>桌</span></div>
            <div class="k-meta">${escapeHtml(order.orderNo)} · ${timeAgo(order.createdAt)}</div>
          </div>
          <span class="k-status ${order.status}">${order.status === 'pending' ? '待制作' : '制作中'}</span>
        </div>
        <div class="k-items">
          ${order.items
            .map(
              (item) => `
              <div class="k-item">
                <span>${escapeHtml(item.emoji)}</span>
                <span class="ki-name">${escapeHtml(item.name)}</span>
                <span class="ki-qty">×${item.qty}</span>
              </div>`
            )
            .join('')}
        </div>
        ${order.remark ? `<div class="k-remark">备注：${escapeHtml(order.remark)}</div>` : ''}
        <div class="k-actions">
          ${
            order.status === 'pending'
              ? `<button class="k-btn primary" data-kitchen="cooking" data-id="${order.id}">开始制作</button>`
              : `<button class="k-btn success solid" data-kitchen="done" data-id="${order.id}">已完成</button>`
          }
        </div>
      </article>`;
  }

  async function updateKitchenStatus(id, status, btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = status === 'cooking' ? '接单中…' : '处理中…';
    }
    try {
      await api(`/orders/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status })
      });
      toast(status === 'cooking' ? '已开始制作' : '订单已完成');
      state.newOrderIds.delete(Number(id));
      await loadKitchen();
    } catch (err) {
      toast(err.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = status === 'cooking' ? '开始制作' : '已完成';
      }
    }
  }

  // ------------------------------------------------------------ 我的 / 登录

  function renderMine() {
    const profile = $('#profileCard');
    const actions = $('#mineActions');
    if (!profile || !actions) return;

    if (!state.user) {
      profile.innerHTML = `
        <div class="login-card">
          <h2 class="login-title">欢迎来到橙味食堂</h2>
          <p class="login-sub">登录后即可点餐，并实时查看出餐进度</p>
          <div class="login-tabs">
            <button class="active" data-login-tab="phone">手机号体验</button>
            <button data-login-tab="admin">管理员登录</button>
          </div>
          <div class="login-panel" id="loginPanelPhone">
            <label class="field">
              <span>手机号</span>
              <input id="loginPhone" type="tel" inputmode="numeric" maxlength="15" placeholder="输入任意手机号快速体验" />
            </label>
            <div class="login-btns">
              <button class="primary-btn" data-action="phone-login">快速进入</button>
              <button class="ghost-btn" data-action="guest-login">游客体验</button>
            </div>
          </div>
          <div class="login-panel hidden" id="loginPanelAdmin">
            <label class="field">
              <span>账号</span>
              <input id="loginUsername" value="admin" autocomplete="username" />
            </label>
            <label class="field">
              <span>密码</span>
              <input id="loginPassword" type="password" placeholder="123456" autocomplete="current-password" />
            </label>
            <button class="primary-btn block" data-action="admin-login">登录后台</button>
          </div>
          <p class="login-hint">管理员：admin / 123456<br/>顾客：任意 6-15 位数字手机号，或点击「游客体验」</p>
        </div>`;

      actions.innerHTML = `
        <button class="mine-row" data-go="kitchen">
          <span class="mine-row-icon">🍳</span>
          <span class="mine-row-text"><strong>厨房实时看板</strong><span>无需登录，围观后厨出餐</span></span>
          <span class="mine-row-arrow">›</span>
        </button>
        <button class="mine-row" data-go="home">
          <span class="mine-row-icon">🍜</span>
          <span class="mine-row-text"><strong>去点餐</strong><span>看看今天有什么好吃的</span></span>
          <span class="mine-row-arrow">›</span>
        </button>`;
      return;
    }

    const isAdmin = state.user.role === 'admin';
    const phone = String(state.user.phone || '');
    const identity = isAdmin ? '管理员' : phone.indexOf('guest_') === 0 ? '游客体验身份' : phone;

    profile.innerHTML = `
      <div class="profile-card">
        <div class="profile-top">
          <div class="profile-avatar">${isAdmin ? '🧑‍🍳' : '😋'}</div>
          <div>
            <div class="profile-name">${escapeHtml(state.user.name)}</div>
            <span class="profile-role">${isAdmin ? 'ADMIN · 管理员' : 'CUSTOMER · 顾客'}</span>
          </div>
        </div>
        <div class="profile-phone">${escapeHtml(identity)}</div>
        <div class="profile-stats">
          <div class="profile-stat"><strong data-stat="orders">--</strong><span>平台订单</span></div>
          <div class="profile-stat"><strong data-stat="online">--</strong><span>在售菜品</span></div>
          <div class="profile-stat"><strong data-stat="revenue">--</strong><span>累计营业额</span></div>
        </div>
      </div>`;

    let rows = `
      <button class="mine-row" data-go="orders">
        <span class="mine-row-icon">🧾</span>
        <span class="mine-row-text"><strong>我的订单</strong><span>查看制作进度与历史订单</span></span>
        <span class="mine-row-arrow">›</span>
      </button>
      <button class="mine-row" data-go="kitchen">
        <span class="mine-row-icon">🍳</span>
        <span class="mine-row-text"><strong>厨房实时看板</strong><span>WebSocket 实时接收新订单</span></span>
        <span class="mine-row-arrow">›</span>
      </button>`;

    if (isAdmin) {
      rows += `
        <button class="mine-row" data-go="admin">
          <span class="mine-row-icon">⚙️</span>
          <span class="mine-row-text"><strong>后台管理</strong><span>菜品维护与订单查询</span></span>
          <span class="mine-row-arrow">›</span>
        </button>`;
    }

    rows += `
      <button class="mine-row" data-action="logout">
        <span class="mine-row-icon">🚪</span>
        <span class="mine-row-text"><strong>退出登录</strong><span>切换其他体验身份</span></span>
        <span class="mine-row-arrow">›</span>
      </button>`;

    actions.innerHTML = rows;
    fillProfileStats();
  }

  function fillProfileStats() {
    if (!state.stats) return;
    const ordersEl = $('[data-stat="orders"]');
    const onlineEl = $('[data-stat="online"]');
    const revenueEl = $('[data-stat="revenue"]');
    if (ordersEl) ordersEl.textContent = state.stats.orders.total;
    if (onlineEl) onlineEl.textContent = state.stats.dishes.online;
    if (revenueEl) revenueEl.textContent = '¥' + Number(state.stats.orders.revenue).toFixed(0);
  }

  async function loadStats() {
    try {
      const res = await api('/stats');
      state.stats = res.data;
      fillProfileStats();
      if (state.route === 'admin') renderAdminOverview();
    } catch (err) {
      // 统计失败不影响主流程
    }
  }

  async function doLogin(payload) {
    try {
      const res = await api('/login', { method: 'POST', body: JSON.stringify(payload) });
      state.user = res.data;
      saveUser();
      updateHeader();
      renderMine();
      loadStats();
      toast(`欢迎，${state.user.name}`);
      if (state.user.role === 'admin') {
        setTimeout(() => {
          location.hash = '#/admin';
        }, 300);
      } else if (state.route === 'orders') {
        loadOrders();
      }
    } catch (err) {
      toast(err.message);
    }
  }

  function logout() {
    if (!state.user) return;
    if (!window.confirm('确定退出当前账号吗？')) return;
    state.user = null;
    saveUser();
    updateHeader();
    renderMine();
    toast('已退出登录');
    if (routeFromHash() === 'admin') location.hash = '#/mine';
  }

  // ------------------------------------------------------------ 后台管理

  async function loadAdminAll() {
    if (!state.user || state.user.role !== 'admin') {
      toast('请使用管理员账号登录');
      location.hash = '#/mine';
      return;
    }
    await Promise.all([loadAdminDishes(), loadAdminOrders(), loadStats()]);
  }

  async function loadAdminDishes() {
    try {
      const res = await api('/dishes?all=1');
      state.adminDishes = res.data || [];
      renderAdminDishes();
    } catch (err) {
      $('#adminDishes').innerHTML = `<div class="admin-empty">${escapeHtml(err.message)}</div>`;
    }
  }

  function renderAdminDishes() {
    const wrap = $('#adminDishes');
    if (!wrap) return;

    if (!state.adminDishes.length) {
      wrap.innerHTML = '<div class="admin-empty">还没有菜品，点击右上角「新增」添加</div>';
      return;
    }

    wrap.innerHTML = state.adminDishes
      .map(
        (dish) => `
        <article class="admin-dish" data-id="${dish.id}">
          <div class="admin-dish-top">
            <div class="admin-dish-art" style="background:${escapeHtml(dish.gradient || 'linear-gradient(135deg,#ffe3c2,#ffb36b)')}">${escapeHtml(dish.emoji)}</div>
            <div class="admin-dish-info">
              <strong>${escapeHtml(dish.name)}${dish.isHot ? ' · 热销' : ''}</strong>
              <span>${escapeHtml(dish.category)} · 月售 ${dish.sales} · ${dish.status ? '在售' : '已下架'}</span>
            </div>
            <div class="admin-dish-price">¥${Number(dish.price).toFixed(2)}</div>
          </div>
          <div class="admin-dish-actions">
            <button class="mini-btn ${dish.status ? 'online' : ''}" data-toggle-dish="${dish.id}">${dish.status ? '下架' : '上架'}</button>
            <button class="mini-btn danger" data-delete-dish="${dish.id}">删除</button>
          </div>
        </article>`
      )
      .join('');
  }

  async function toggleDish(id) {
    const dish = state.adminDishes.find((d) => d.id === Number(id));
    if (!dish) return;
    try {
      await api(`/dishes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: dish.status ? 0 : 1 })
      });
      toast(dish.status ? `「${dish.name}」已下架` : `「${dish.name}」已上架`);
      await Promise.all([loadAdminDishes(), loadDishes(), loadStats()]);
      if (state.route === 'admin') renderAdminOverview();
    } catch (err) {
      toast(err.message);
    }
  }

  async function deleteDish(id) {
    const dish = state.adminDishes.find((d) => d.id === Number(id));
    if (!dish) return;
    if (!window.confirm(`确定删除「${dish.name}」吗？历史订单不受影响。`)) return;
    try {
      await api(`/dishes/${id}`, { method: 'DELETE' });
      toast('菜品已删除');
      await Promise.all([loadAdminDishes(), loadDishes(), loadStats()]);
      if (state.route === 'admin') renderAdminOverview();
    } catch (err) {
      toast(err.message);
    }
  }

  async function loadAdminOrders() {
    try {
      const res = await api('/orders?limit=100');
      state.adminOrders = res.data || [];
      renderAdminOrders();
    } catch (err) {
      $('#adminOrders').innerHTML = `<div class="admin-empty">${escapeHtml(err.message)}</div>`;
    }
  }

  function renderAdminOrders() {
    const wrap = $('#adminOrders');
    if (!wrap) return;

    if (!state.adminOrders.length) {
      wrap.innerHTML = '<div class="admin-empty">还没有订单</div>';
      return;
    }

    wrap.innerHTML = state.adminOrders
      .map(
        (order) => `
        <article class="admin-order">
          <div class="admin-order-top">
            <span class="admin-order-no">${escapeHtml(order.orderNo)}</span>
            <span class="order-status ${statusClass(order.status)}">${escapeHtml(order.statusText)}</span>
          </div>
          <div class="admin-order-meta">
            <span>${escapeHtml(order.tableNo)} 桌</span>
            <span>${formatTime(order.createdAt)}</span>
            <span>${escapeHtml(order.phone || '未留手机号')}</span>
            <span>合计 ¥${Number(order.amount).toFixed(2)}</span>
          </div>
          <div class="admin-order-items">${order.items
            .map((item) => `${escapeHtml(item.name)} × ${item.qty}`)
            .join('　')}</div>
          ${order.remark ? `<div class="order-remark">备注：${escapeHtml(order.remark)}</div>` : ''}
        </article>`
      )
      .join('');
  }

  function renderAdminOverview() {
    const wrap = $('#adminOverview');
    if (!wrap || !state.stats) return;
    const stats = state.stats;
    wrap.innerHTML = `
      <div class="ov-card"><span>累计订单</span><strong>${stats.orders.total}<em>单</em></strong></div>
      <div class="ov-card"><span>待处理</span><strong>${stats.orders.pending + stats.orders.cooking}<em>单</em></strong></div>
      <div class="ov-card"><span>累计营业额</span><strong>¥${Number(stats.orders.revenue).toFixed(0)}</strong></div>
      <div class="ov-card"><span>在售菜品</span><strong>${stats.dishes.online}<em>/ ${stats.dishes.total}</em></strong></div>`;
  }

  function openDishSheet() {
    if (!state.user || state.user.role !== 'admin') {
      toast('无权限');
      return;
    }
    $('#dishName').value = '';
    $('#dishCategory').value = '主食';
    $('#dishPrice').value = '';
    $('#dishEmoji').value = '';
    $('#dishDesc').value = '';
    $('#dishHot').checked = false;
    openSheet('dishSheet');
  }

  async function saveDish() {
    const name = $('#dishName').value.trim();
    const price = Number($('#dishPrice').value);
    if (!name) return toast('请填写菜品名称');
    if (!Number.isFinite(price) || price <= 0) return toast('请填写正确的价格');

    const btn = $('#saveDish');
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      await api('/dishes', {
        method: 'POST',
        body: JSON.stringify({
          name,
          category: $('#dishCategory').value,
          price,
          emoji: $('#dishEmoji').value.trim() || '🍽️',
          description: $('#dishDesc').value.trim(),
          isHot: $('#dishHot').checked
        })
      });
      closeSheets();
      toast('菜品已添加');
      await Promise.all([loadAdminDishes(), loadDishes(), loadStats()]);
      if (state.route === 'admin') renderAdminOverview();
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '保存菜品';
    }
  }

  // ------------------------------------------------------------ WebSocket

  function connectWS() {
    // 避免重复建立连接（断线重连与页面重新可见可能同时触发）
    if (state.ws && (state.ws.readyState === 0 || state.ws.readyState === 1)) return;

    // 与页面同源，直接使用当前 host
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = protocol + '://' + location.host + '/ws';

    try {
      state.ws = new WebSocket(url);
    } catch (err) {
      setWsState(false);
      scheduleReconnect();
      return;
    }

    state.ws.onopen = () => setWsState(true);
    state.ws.onmessage = (event) => {
      let msg = null;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        return;
      }
      handleWsMessage(msg);
    };
    state.ws.onclose = () => {
      setWsState(false);
      scheduleReconnect();
    };
    state.ws.onerror = () => {
      try {
        state.ws.close();
      } catch (err) {}
    };
  }

  function scheduleReconnect() {
    clearTimeout(state.wsTimer);
    state.wsTimer = setTimeout(connectWS, 3500);
  }

  function setWsState(online) {
    state.wsConnected = online;
    const dot = $('#wsDot');
    const text = $('#wsText');
    if (!dot || !text) return;
    dot.classList.toggle('online', online);
    dot.classList.toggle('offline', !online);
    text.textContent = online ? '实时通道已连接 · 新订单自动推送' : '实时通道断开，正在重连…';
  }

  function handleWsMessage(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'connected') {
      setWsState(true);
      return;
    }

    if (msg.type === 'new_order' && msg.data) {
      const order = msg.data;
      state.newOrderIds.add(order.id);
      setTimeout(() => {
        state.newOrderIds.delete(order.id);
        const el = document.querySelector(`.k-order[data-order-id="${order.id}"]`);
        if (el) el.classList.remove('is-new');
      }, 15000);

      if (state.route === 'kitchen') {
        toast(`🔔 新订单：${order.tableNo} 桌`);
        loadKitchen();
      }
      if (state.route === 'orders') loadOrders();
      if (state.route === 'admin') {
        loadAdminOrders();
        loadStats();
      }
      return;
    }

    if (msg.type === 'order_update') {
      if (state.route === 'kitchen') loadKitchen();
      if (state.route === 'orders') loadOrders();
      if (state.route === 'admin') loadAdminOrders();
      return;
    }

    if (msg.type === 'dish_change') {
      loadDishes();
      if (state.route === 'admin') loadAdminDishes();
    }
  }

  // ------------------------------------------------------------ 弹层

  function openSheet(id) {
    closeSheets(true);
    const sheet = document.getElementById(id);
    if (!sheet) return;
    sheet.classList.add('open');
    $('#mask').classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  function closeSheets(keepMask) {
    $$('.sheet.open').forEach((sheet) => sheet.classList.remove('open'));
    if (!keepMask) {
      $('#mask').classList.remove('show');
      document.body.style.overflow = '';
    }
  }

  // ------------------------------------------------------------ 事件绑定

  function bindEvents() {
    // 底部 tabBar
    $('#tabbar').addEventListener('click', (event) => {
      const btn = event.target.closest('button[data-route]');
      if (!btn) return;
      const route = btn.dataset.route;
      if (routeFromHash() === route) navigate(route);
      else location.hash = '#/' + route;
    });

    window.addEventListener('hashchange', () => navigate(routeFromHash()));

    // 顶部入口
    $('#headerAvatar').addEventListener('click', () => {
      location.hash = '#/mine';
    });
    $('#adminEntry').addEventListener('click', () => {
      location.hash = '#/admin';
    });
    $('#tablePill').addEventListener('click', () => {
      toast(`当前 ${state.table} 桌，结算时可以选择桌号`, 1400);
    });

    // 分类切换
    $('#categoryTabs').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-category]');
      if (!btn) return;
      state.category = btn.dataset.category;
      renderCategoryTabs();
      renderDishes();
    });

    // 菜品加购 / 重新加载
    $('#dishList').addEventListener('click', (event) => {
      const addBtn = event.target.closest('[data-add]');
      if (addBtn) {
        addToCart(addBtn.dataset.add);
        return;
      }
      if (event.target.closest('[data-retry-dishes]')) loadDishes();
    });

    // 购物车
    $('#openCart').addEventListener('click', openCart);
    $('#goCheckout').addEventListener('click', openCheckout);
    $('#sheetCheckout').addEventListener('click', openCheckout);
    $('#clearCart').addEventListener('click', () => {
      state.cart = {};
      saveCart();
      renderDishes();
      renderCartBar();
      renderCartSheet();
      closeSheets();
      toast('购物车已清空');
    });
    $('#cartLines').addEventListener('click', (event) => {
      const minus = event.target.closest('[data-minus]');
      const plus = event.target.closest('[data-plus]');
      if (minus) changeQty(minus.dataset.minus, -1);
      if (plus) changeQty(plus.dataset.plus, 1);
    });

    // 结算
    $('#submitOrder').addEventListener('click', submitOrder);
    $('#checkoutTable').addEventListener('change', () => {
      state.table = $('#checkoutTable').value;
      saveTable();
      updateHeader();
    });

    // 订单
    $('#refreshOrders').addEventListener('click', loadOrders);
    $('#orderFilter').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-status]');
      if (!btn) return;
      state.orderFilter = btn.dataset.status;
      $$('#orderFilter button').forEach((b) => b.classList.toggle('active', b === btn));
      loadOrders();
    });

    // 厨房
    $('#kitchenList').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-kitchen]');
      if (!btn) return;
      updateKitchenStatus(Number(btn.dataset.id), btn.dataset.kitchen, btn);
    });

    // 我的 / 登录
    $('#page-mine').addEventListener('click', handleMineClick);

    // 后台
    $('#adminBack').addEventListener('click', () => {
      location.hash = '#/mine';
    });
    $('#addDishBtn').addEventListener('click', openDishSheet);
    $('#adminTabs').addEventListener('click', (event) => {
      const btn = event.target.closest('[data-tab]');
      if (!btn) return;
      state.adminTab = btn.dataset.tab;
      $$('#adminTabs button').forEach((b) => b.classList.toggle('active', b === btn));
      $('#adminDishes').classList.toggle('hidden', state.adminTab !== 'dishes');
      $('#adminOrders').classList.toggle('hidden', state.adminTab !== 'orders');
    });
    $('#adminDishes').addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-toggle-dish]');
      const del = event.target.closest('[data-delete-dish]');
      if (toggle) toggleDish(toggle.dataset.toggleDish);
      if (del) deleteDish(del.dataset.deleteDish);
    });
    $('#saveDish').addEventListener('click', saveDish);

    // 弹层关闭
    $('#mask').addEventListener('click', () => closeSheets());
    document.addEventListener('click', (event) => {
      if (event.target.closest('[data-close]')) closeSheets();
      const go = event.target.closest('[data-go]');
      if (go && go.dataset.go) location.hash = '#/' + go.dataset.go;
    });

    // 页面重新可见时，若 WebSocket 已断开则重连
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !state.wsConnected) {
        connectWS();
      }
    });
  }

  function handleMineClick(event) {
    const tab = event.target.closest('[data-login-tab]');
    if (tab) {
      $$('#page-mine [data-login-tab]').forEach((b) => b.classList.toggle('active', b === tab));
      const isAdminTab = tab.dataset.loginTab === 'admin';
      $('#loginPanelPhone').classList.toggle('hidden', isAdminTab);
      $('#loginPanelAdmin').classList.toggle('hidden', !isAdminTab);
      return;
    }

    const action = event.target.closest('[data-action]');
    if (!action) return;

    const name = action.dataset.action;
    if (name === 'phone-login') {
      const phone = ($('#loginPhone').value || '').trim();
      if (!/^\d{6,15}$/.test(phone)) return toast('请输入 6-15 位数字手机号');
      doLogin({ phone });
      return;
    }
    if (name === 'guest-login') {
      doLogin({ guest: true });
      return;
    }
    if (name === 'admin-login') {
      doLogin({
        username: ($('#loginUsername').value || '').trim(),
        password: $('#loginPassword').value || ''
      });
      return;
    }
    if (name === 'logout') {
      logout();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
