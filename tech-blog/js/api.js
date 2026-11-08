/* 数据层：优先走 Node 后端 /api；后端不存在时回退到浏览器本地存储 */
window.Api = (function () {
  const K = {
    users: 'tb_users', session: 'tb_session', token: 'tb_token',
    cmt: s => 'blog-cmt-' + s, liked: s => 'blog-liked-' + s,
    guest: 'blog-guest', guestLiked: 'blog-liked-guest',
    uses: 'blog-work-uses', plans: 'blog-work-plan', codes: 'blog-used-codes',
    wLikes: 'blog-work-likes', wLiked: 'blog-liked-works'
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  let online = false;
  let token = '';
  let me = null;

  /* ---------------- 网络 ---------------- */
  async function req(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const url = '/api' + path;
    let r;
    try {
      r = await fetch(url, { ...opts, headers });
    } catch (e) {
      /* 网络级失败（服务未启动/隧道抖动）：等一会重试一次 */
      await new Promise(res => setTimeout(res, 800));
      try {
        r = await fetch(url, { ...opts, headers });
      } catch (e2) {
        throw new Error('无法连接服务器，请刷新页面重试（服务可能未启动）');
      }
    }
    let body = {};
    try { body = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(body.error || ('请求失败 ' + r.status));
    return body;
  }

  async function boot() {
    token = store.get(K.token, '') || '';
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      online = r.ok;
    } catch (e) { online = false; }
    if (online) {
      try {
        const d = await req('/auth/me');
        me = d.user || null;
        if (!me && token) { token = ''; store.del(K.token); }
      } catch (e) { me = null; }
    } else {
      const s = store.get(K.session, null);
      me = s ? { name: s.name, guest: !!s.guest } : null;
    }
  }

  /* ---------------- 账号 ---------------- */
  const user = () => me;
  const isGuest = () => !!(me && me.guest);

  async function login(name, pass) {
    if (online) {
      try {
        const d = await req('/auth/login', { method: 'POST', body: JSON.stringify({ username: name, password: pass }) });
        token = d.token; store.set(K.token, token); me = d.user;
        return null;
      } catch (e) { return e.message; }
    }
    const us = store.get(K.users, []);
    const u = us.find(x => x.name === name);
    if (!u) return '账号不存在，请先注册';
    if (u.pass !== pass) return '密码不正确，请重试';
    store.set(K.session, { name, guest: false });
    me = { name, guest: false };
    return null;
  }

  async function register(name, pass) {
    if (online) {
      try {
        const d = await req('/auth/register', { method: 'POST', body: JSON.stringify({ username: name, password: pass }) });
        token = d.token; store.set(K.token, token); me = d.user;
        return null;
      } catch (e) { return e.message; }
    }
    const us = store.get(K.users, []);
    if (us.some(x => x.name === name)) return '该账号已被注册，请直接登录';
    us.push({ name, pass });
    store.set(K.users, us);
    store.set(K.session, { name, guest: false });
    me = { name, guest: false };
    return null;
  }

  async function guestLogin() {
    if (online) {
      try {
        const d = await req('/auth/guest', { method: 'POST', body: '{}' });
        token = d.token; store.set(K.token, token); me = d.user;
        return null;
      } catch (e) { return e.message; }
    }
    const name = '游客_' + Math.random().toString(36).slice(2, 6).toUpperCase();
    store.set(K.session, { name, guest: true });
    me = { name, guest: true };
    return null;
  }

  async function logout() {
    if (online) { try { await req('/auth/logout', { method: 'POST', body: '{}' }); } catch (e) {} }
    token = ''; store.del(K.token); store.del(K.session); me = null;
  }

  /* ---------------- 评论 / 留言 ---------------- */
  const keyOf = (scope, slug) => (scope === 'guest' ? K.guest : K.cmt(slug));
  const likedKeyOf = (scope, slug) => (scope === 'guest' ? K.guestLiked : K.liked(slug));

  async function comments(scope, slug) {
    if (online) {
      try {
        const q = '/comments?scope=' + scope + '&slug=' + encodeURIComponent(slug || '');
        return (await req(q)).list || [];
      } catch (e) { return []; }
    }
    const list = store.get(keyOf(scope, slug), []);
    const liked = store.get(likedKeyOf(scope, slug), []);
    const now = Date.now();
    return list.map(c => ({
      id: c.ts, n: c.n, x: c.x, t: c.t, ts: c.ts,
      likes: c.likes || 0, liked: liked.includes(c.ts), mine: true,
      canDel: !c.ts || now - c.ts < 3 * 60 * 1000,
      r: (c.r || []).map(r => ({
        id: r.ts, n: r.n, x: r.x, to: r.to, t: r.t, ts: r.ts,
        likes: r.likes || 0, liked: liked.includes(r.ts), mine: true,
        canDel: !r.ts || now - r.ts < 3 * 60 * 1000, r: []
      }))
    }));
  }

  async function addComment(scope, slug, body, parentId) {
    if (online) {
      try {
        await req('/comments', { method: 'POST', body: JSON.stringify({ scope, slug, body, parentId: parentId || null }) });
        return null;
      } catch (e) { return e.message; }
    }
    if (!me) return '请先登录';
    const list = store.get(keyOf(scope, slug), []);
    const ts = Date.now();
    const item = { n: me.name, x: body, ts, t: new Date().toLocaleString('zh-CN') };
    if (parentId) {
      const parent = list.find(c => c.ts === parentId);
      if (!parent) return '被回复的评论不存在';
      parent.r = parent.r || [];
      parent.r.push(item);
    } else list.unshift(item);
    store.set(keyOf(scope, slug), list);
    return null;
  }

  async function delComment(id) {
    if (online) {
      try { await req('/comments/' + id, { method: 'DELETE' }); return null; }
      catch (e) { return e.message; }
    }
    for (const scope of ['post', 'guest']) {
      const keys = scope === 'guest' ? [K.guest] : Object.keys(localStorage).filter(k => k.startsWith('blog-cmt-'));
      for (const k of keys) {
        const list = store.get(k, []);
        let hit = false;
        const next = list.filter(c => {
          if (c.ts === id) { hit = true; return false; }
          if (c.r) c.r = c.r.filter(r => !(r.ts === id && (hit = true)));
          return true;
        });
        if (hit) { store.set(k, next); return null; }
      }
    }
    return '评论不存在';
  }

  async function likeComment(id) {
    if (online) {
      try { return await req('/comments/' + id + '/like', { method: 'POST', body: '{}' }); }
      catch (e) { return null; }
    }
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('blog-cmt-') && k !== K.guest) continue;
      const lk = k === K.guest ? K.guestLiked : k.replace('blog-cmt-', 'blog-liked-');
      const list = store.get(k, []);
      const liked = store.get(lk, []);
      const find = arr => arr.find(x => x.ts === id);
      const item = find(list) || (list.flatMap(c => c.r || [])).find(x => x.ts === id);
      if (!item) continue;
      const i = liked.indexOf(id);
      if (i >= 0) { liked.splice(i, 1); item.likes = Math.max(0, (item.likes || 0) - 1); }
      else { liked.push(id); item.likes = (item.likes || 0) + 1; }
      store.set(lk, liked); store.set(k, list);
      return { liked: i < 0, likes: item.likes };
    }
    return null;
  }

  /* ---------------- 违规告知 ---------------- */
  async function notice() {
    if (online) {
      try { return await req('/notice'); } catch (e) {}
    }
    return { muted: null, count: 0 };
  }

  /* ---------------- 违规申诉 ---------------- */
  async function submitAppeal(payload) {
    if (!online) return { error: '当前处于离线模式，无法提交申诉' };
    try {
      await req('/appeals', { method: 'POST', body: JSON.stringify(payload) });
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  }

  /* ---------------- 作品权限 ---------------- */
  const PKEY = () => K.plans + '@' + ((me && me.name) || 'anon');
  const UKEY = () => K.uses + '@' + ((me && me.name) || 'anon');
  const PLANS = { once: 0, week: 7 * 864e5, month: 30 * 864e5, year: 365 * 864e5 };

  function acc2code(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * (i + 1)) % 676;
    return String.fromCharCode(65 + Math.floor(h / 26)) + String.fromCharCode(65 + (h % 26));
  }

  function parseCode(code, username) {
    let m = /^YZ(6|18|59|666)-([A-Z]{2})(\d{3})(\d)$/.exec(code);
    if (m) {
      const sum = (+m[3][0] + +m[3][1] + +m[3][2] + m[2].charCodeAt(0) + m[2].charCodeAt(1)) % 10;
      if (sum !== +m[4]) return { err: '开通码无效，请核对后再试' };
      if (m[2] !== acc2code(username)) return { err: '该开通码不属于当前账号，无法使用' };
      return { plan: { 6: 'once', 18: 'week', 59: 'month', 666: 'year' }[m[1]] };
    }
    m = /^YZ(6|18|59|666)-(\d{3})(\d)$/.exec(code);
    if (m) {
      const sum = (+m[2][0] + +m[2][1] + +m[2][2]) % 10;
      if (sum !== +m[3]) return { err: '开通码无效，请核对后再试' };
      return { plan: { 6: 'once', 18: 'week', 59: 'month', 666: 'year' }[m[1]] };
    }
    return { err: '开通码无效，请核对后再试' };
  }

  async function worksStatus() {
    if (online) {
      try { return await req('/works/status'); } catch (e) {}
    }
    const uses = store.get(UKEY(), {});
    const plans = store.get(PKEY(), {});
    const now = Date.now();
    const out = {};
    for (const key of ['poster', 'video']) {
      const p = plans[key];
      if (p && ((p.ms && p.until > now) || (!p.ms && p.credits > 0))) {
        out[key] = { type: 'vip', plan: p.ms ? 'timed' : 'once', left: p.credits || 0, until: p.until || 0 };
      } else out[key] = { type: 'free', left: Math.max(0, 3 - (uses[key] || 0)), until: 0 };
    }
    return out;
  }

  async function useWork(key) {
    if (online) {
      try { return await req('/works/' + key + '/use', { method: 'POST', body: '{}' }); }
      catch (e) { return { needPay: e.message }; }
    }
    const plans = store.get(PKEY(), {});
    const p = plans[key];
    const now = Date.now();
    if (p && ((p.ms && p.until > now) || (!p.ms && p.credits > 0))) {
      if (!p.ms) { p.credits--; store.set(PKEY(), plans); return { ok: true, vip: true, left: p.credits }; }
      return { ok: true, vip: true, until: p.until };
    }
    const uses = store.get(UKEY(), {});
    const used = uses[key] || 0;
    if (used < 3) {
      uses[key] = used + 1;
      store.set(UKEY(), uses);
      return { ok: true, free: true, left: 3 - uses[key] };
    }
    return { needPay: '免费体验次数已用完，请开通套餐' };
  }

  async function redeem(key, code) {
    if (online) {
      try { await req('/works/' + key + '/redeem', { method: 'POST', body: JSON.stringify({ code }) }); return null; }
      catch (e) { return e.message; }
    }
    const parsed = parseCode(code, (me && me.name) || '');
    if (parsed.err) return parsed.err;
    const used = store.get(K.codes, []);
    if (used.includes(code)) return '该开通码已被使用，每个码仅限一次';
    used.push(code); store.set(K.codes, used);
    const plans = store.get(PKEY(), {});
    const pl = PLANS[parsed.plan];
    const cur = plans[key] || { credits: 0 };
    if (pl) plans[key] = { ms: pl, until: Math.max(Date.now(), cur.until || 0) + pl };
    else plans[key] = { ms: 0, credits: (cur.credits || 0) + 1 };
    store.set(PKEY(), plans);
    return null;
  }

  /* ---------------- 开通码到期提醒 ---------------- */
  async function myCodes() {
    if (!online || !me) return [];
    try { return (await req('/codes/mine')).list || []; } catch (e) { return []; }
  }

  /* ---------------- 导入作品（在线体验） ---------------- */
  async function showcase() {
    if (!online) return [];
    try { return (await req('/works/showcase')).list || []; } catch (e) { return []; }
  }

  /* 下单（记录到后台作品管理） */
  async function orderWork(slug, note) {
    if (!online) throw new Error('当前处于离线模式，无法下单');
    return await req('/works/order', { method: 'POST', body: JSON.stringify({ slug, note: note || '' }) });
  }

  /* ---------------- 作品点赞 ---------------- */
  async function workLikes() {
    if (online) {
      try { return await req('/work-likes'); } catch (e) {}
    }
    return { likes: store.get(K.wLikes, {}), liked: store.get(K.wLiked, []) };
  }

  async function toggleWorkLike(key) {
    if (online) {
      try { return await req('/work-likes/' + key, { method: 'POST', body: '{}' }); } catch (e) { return null; }
    }
    const likes = store.get(K.wLikes, {});
    const liked = store.get(K.wLiked, []);
    const i = liked.indexOf(key);
    if (i >= 0) { liked.splice(i, 1); likes[key] = Math.max(0, (likes[key] || 0) - 1); }
    else { liked.push(key); likes[key] = (likes[key] || 0) + 1; }
    store.set(K.wLikes, likes); store.set(K.wLiked, liked);
    return { liked: i < 0, likes: likes[key] };
  }

  return {
    boot, get online() { return online; }, user, isGuest,
    login, register, guestLogin, logout,
    comments, addComment, delComment, likeComment, notice, submitAppeal,
    worksStatus, useWork, redeem, myCodes, workLikes, toggleWorkLike, acc2code,
    showcase, orderWork
  };
})();
