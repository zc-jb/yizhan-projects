/* 技术驿站 SPA：哈希路由 + Markdown 渲染 + 全功能前端 */
(function () {
'use strict';
const $ = s => document.querySelector(s);
const app = $('#app');
const PAGE_SIZE = 6;

/* ---------- 工具 ---------- */
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
};
const readTime = md => Math.max(1, Math.round(md.replace(/[\x00-\x7F]/g,'').length / 400));
const byDate = (a,b) => b.date.localeCompare(a.date);
const SORTED = [...POSTS].sort(byDate);

/* ---------- Markdown 解析 ---------- */
function hl(code, lang) {
  let s = esc(code);
  const K = {
    js:'\\b(const|let|var|function|return|if|else|for|while|await|async|new|class|import|export|from|try|catch|throw|typeof|of|in|this|null|true|false)\\b',
    python:'\\b(def|return|if|elif|else|for|while|import|from|as|class|try|except|with|lambda|None|True|False|print|in|not|and|or)\\b',
    bash:'\\b(cd|ls|mkdir|rm|cp|mv|cat|grep|find|sudo|chmod|chown|curl|docker|git|npm|pip|tail|top|df|du|free|ps|kill|tar|echo|export|ss|ping|man|sort|uniq|head|xargs|awk|less|systemctl)\\b',
    sql:'\\b(SELECT|FROM|WHERE|CREATE|INDEX|ON|INSERT|UPDATE|DELETE|JOIN|ORDER|BY|GROUP|EXPLAIN|AND|OR|LIKE|DATE)\\b',
    css:'([.#]?[a-zA-Z-]+(?=\\s*[:{]))',
    yaml:'^\\s*([a-zA-Z_]+)(?=:)',
    dockerfile:'\\b(FROM|WORKDIR|COPY|RUN|EXPOSE|CMD)\\b',
    http:'\\b(GET|POST|PUT|DELETE|HTTP/1.1|HTTP/2|Host|Content-Type|Content-Length|Set-Cookie)\\b'
  };
  s = s.replace(/(&quot;.*?&quot;|".*?"|'.*?'|`.*?`)/g, '<span class="tok-s">$1</span>');
  s = s.replace(/(#[^\n]*|\/\/[^\n]*)/g, '<span class="tok-c">$1</span>');
  const kw = K[lang];
  if (kw) s = s.replace(new RegExp(kw, 'g'), '<span class="tok-k">$1</span>');
  s = s.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-n">$1</span>');
  return s;
}

function md(src) {
  const lines = src.replace(/\r/g,'').split('\n');
  let html = '', inCode = false, codeLang = '', codeBuf = [], inList = 0, inTable = false;
  const inline = t => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const closeList = () => { if (inList) { html += inList===1?'</ul>':'</ol>'; inList = 0; } };
  const closeTable = () => { if (inTable) { html += '</table>'; inTable = false; } };

  for (let line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        html += `<div class="codeblock"><span class="code-lang">${codeLang}</span><button class="copy-btn">复制</button><pre><code>${hl(codeBuf.join('\n'), codeLang)}</code></pre></div>`;
        inCode = false; codeBuf = [];
      } else { closeList(); closeTable(); inCode = true; codeLang = line.trim().slice(3) || 'text'; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    const t = line.trim();
    if (!t) { closeList(); closeTable(); continue; }

    if (/^\|.+\|$/.test(t)) {
      if (/^\|[\s:-]+\|$/.test(t)) continue; // 分隔行
      closeList();
      const cells = t.slice(1,-1).split('|').map(c => inline(c.trim()));
      if (!inTable) { inTable = true; html += '<table><tr>' + cells.map(c=>`<th>${c}</th>`).join('') + '</tr>'; }
      else html += '<tr>' + cells.map(c=>`<td>${c}</td>`).join('') + '</tr>';
      continue;
    }
    closeTable();

    let m;
    if (m = t.match(/^(#{1,4})\s+(.*)/)) {
      closeList();
      const lv = m[1].length, txt = inline(m[2]);
      const id = 'h-' + Math.random().toString(36).slice(2,8);
      html += `<h${lv} id="${id}">${txt}</h${lv}>`;
    } else if (/^---+$/.test(t)) { closeList(); html += '<hr>'; }
    else if (m = t.match(/^>\s?(.*)/)) { closeList(); html += `<blockquote>${inline(m[1])}</blockquote>`; }
    else if (m = t.match(/^[-*]\s+(.*)/)) {
      if (inList !== 1) { closeList(); html += '<ul>'; inList = 1; }
      html += `<li>${inline(m[1])}</li>`;
    } else if (m = t.match(/^\d+[.)]\s+(.*)/)) {
      if (inList !== 2) { closeList(); html += '<ol>'; inList = 2; }
      html += `<li>${inline(m[1])}</li>`;
    } else {
      closeList();
      html += `<p>${inline(t)}</p>`;
    }
  }
  closeList(); closeTable();
  return html;
}

/* ---------- 主题 ---------- */
const themeBtn = $('#themeBtn');
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
  store.set('blog-theme', t);
}
applyTheme(store.get('blog-theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
themeBtn.onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

/* ---------- 顶栏 ---------- */
$('#menuBtn').onclick = () => $('#nav').classList.toggle('open');
/* 实时中国本地时间 */
const cnFmtT = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const cnFmtD = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' });
const tickCn = () => { const el = $('#cnTime'); if (el) { const n = new Date(); el.innerHTML = `<b>${cnFmtT.format(n)}</b><i>${cnFmtD.format(n)}</i>`; } };
tickCn(); setInterval(tickCn, 1000);
$('#postCount').textContent = POSTS.length;
window.addEventListener('scroll', () => {
  const h = document.documentElement;
  const p = h.scrollTop / (h.scrollHeight - h.clientHeight || 1);
  $('#progress').style.width = (p * 100) + '%';
  $('#toTop').classList.toggle('show', h.scrollTop > 400);
});
$('#toTop').onclick = () => scrollTo({ top: 0, behavior: 'smooth' });

/* ---------- 宽屏两侧悬浮栏 ---------- */
const scrollToConsult = () => {
  const card = $('#consultCard');
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.remove('flash');
  void card.offsetWidth;
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 1500);
};
const railGo = $('#railGo');
if (railGo) railGo.onclick = scrollToConsult;

/* ---------- 违规告知通知（取管理台禁言账号） ---------- */
const noticeOverlay = $('#noticeOverlay');
let noticeData = null;
const setNotice = d => {
  const m = d && d.muted;
  $('#rvType').textContent = m ? '内容违规' : '暂无违规记录';
  $('#rvAccount').textContent = m ? m.name : '暂无禁言账号';
  $('#rvTime').textContent = m ? (m.time || '较早记录') : '—';
  const punish = $('#rvPunish');
  punish.textContent = m ? '限制发布内容（评论/留言）' : '无';
  punish.classList.toggle('red', !!m);
  $('#rvDetail').textContent = m
    ? '该账号发布的内容包含违反社区规范的信息，经系统审核判定为违规行为，已限制其发布内容。'
    : `当前共有 ${d && d.count ? d.count : 0} 个账号处于禁言状态，社区秩序良好。`;
  const tip = $('#rvAppealTip');
  if (tip) {
    tip.className = 'rv-appeal';
    const ap = d && d.appeal;
    if (m && ap && ap.status === 'pending') {
      tip.classList.add('on', 'pending');
      tip.textContent = '申诉审核中：您的申诉已提交，工作人员将在 3 个工作日内完成审核。';
    } else if (m && ap && ap.status === 'rejected') {
      tip.classList.add('on', 'rejected');
      tip.textContent = `申诉未通过${ap.time ? `（${ap.time}）` : ''}：经复核违规行为成立，处罚继续有效。如已整改或补充材料，可再次提交申诉。`;
    }
  }
};
const openNotice = async () => {
  noticeOverlay.classList.add('on');
  document.body.classList.add('notice-open');
  noticeData = await Api.notice();
  setNotice(noticeData);
};
const closeNotice = () => {
  noticeOverlay.classList.remove('on');
  document.body.classList.remove('notice-open');
};
if ($('#railNotice')) $('#railNotice').onclick = openNotice;
if (noticeOverlay) {
  noticeOverlay.addEventListener('click', e => { if (!e.target.closest('.rv-modal')) closeNotice(); });
  $('#noticeClose').onclick = closeNotice;
  $('#noticeOk').onclick = closeNotice;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && noticeOverlay.classList.contains('on')) closeNotice();
  });
}

/* ---------- 违规申诉 ---------- */
const appealOverlay = $('#appealOverlay');
let apReason = '内容无违规';
let apImages = [];

const apRenderThumbs = () => {
  const empty = $('#apUpEmpty');
  if (empty) empty.style.display = apImages.length ? 'none' : '';
  $('#apThumbs').innerHTML = apImages.map((src, i) =>
    `<div class="ap-thumb"><img src="${src}" alt="凭证${i + 1}"><button data-del="${i}" title="移除">✕</button></div>`
  ).join('') + (apImages.length && apImages.length < 9
    ? '<div class="ap-add">＋<span>添加</span></div>'
    : '');
};

const readImage = file => new Promise(resolve => {
  if (!file.type.startsWith('image/')) return resolve('');
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 900;
      let w = img.width, h = img.height;
      if (w > max || h > max) {
        const s = Math.min(max / w, max / h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = () => resolve('');
    img.src = fr.result;
  };
  fr.onerror = () => resolve('');
  fr.readAsDataURL(file);
});

const openAppeal = d => {
  if (!d || !d.muted) { toast('当前没有需要申诉的禁言账号'); return; }
  closeNotice();
  apReason = '内容无违规';
  apImages = [];
  $$('#apChips button').forEach(b => b.classList.toggle('on', b.dataset.reason === apReason));
  $('#apText').value = '';
  $('#apCount').textContent = '0/500';
  apRenderThumbs();
  $('#apType').textContent = '内容违规';
  const punish = $('#apPunish');
  punish.textContent = '限制发布内容（评论/留言）';
  punish.classList.add('red');
  $('#apTime').textContent = d.muted.time || '较早记录';
  appealOverlay.classList.add('on');
  document.body.classList.add('appeal-open');
};
const closeAppeal = () => {
  appealOverlay.classList.remove('on');
  document.body.classList.remove('appeal-open');
};
if ($('#noticeAppeal')) $('#noticeAppeal').onclick = () => openAppeal(noticeData);
if ($('#apChips')) $('#apChips').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  apReason = b.dataset.reason;
  $$('#apChips button').forEach(x => x.classList.toggle('on', x === b));
};
if ($('#apText')) $('#apText').addEventListener('input', e => {
  $('#apCount').textContent = e.target.value.length + '/500';
});
if ($('#apThumbs')) $('#apThumbs').onclick = e => {
  const b = e.target.closest('button[data-del]');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  apImages.splice(Number(b.dataset.del), 1);
  apRenderThumbs();
};
if ($('#apFiles')) $('#apFiles').onchange = async e => {
  const room = 9 - apImages.length;
  const files = [...e.target.files].slice(0, room);
  if (e.target.files.length > room) toast('最多上传 9 张凭证');
  for (const f of files) {
    const src = await readImage(f);
    if (src) apImages.push(src);
  }
  e.target.value = '';
  apRenderThumbs();
};
if ($('#apSubmit')) $('#apSubmit').onclick = async () => {
  const content = $('#apText').value.trim();
  if (!content) { toast('请填写补充说明'); $('#apText').focus(); return; }
  if (!apImages.length) { toast('请至少上传 1 张凭证'); return; }
  const btn = $('#apSubmit');
  btn.disabled = true;
  btn.textContent = '提交中…';
  const r = await Api.submitAppeal({ reason: apReason, content, images: apImages });
  btn.disabled = false;
  btn.textContent = '提交申诉';
  if (r.error) { toast(r.error); return; }
  closeAppeal();
  toast('申诉已提交，工作人员将在 3 个工作日内审核');
};
if ($('#appealClose')) $('#appealClose').onclick = closeAppeal;
if (appealOverlay) {
  appealOverlay.addEventListener('click', e => { if (!e.target.closest('.ap-modal')) closeAppeal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && appealOverlay.classList.contains('on')) closeAppeal();
  });
}

/* ---------- 技术交流面板（真实留言数据） ---------- */
const tpOverlay = $('#techOverlay');
let tpData = [], tpSort = 'new', tpSig = '', tpTimer = null, tpLoading = false;

const tpAva = n => `<span class="tp-ava a${(String(n).length % 6) + 1}" title="${esc(n)}">${esc(String(n).slice(0, 1))}</span>`;

const tpRender = () => {
  const msgs = $('#tpMsgs');
  if (!msgs) return;
  const list = tpSort === 'hot' ? tpData.slice().sort((a, b) => (b.likes || 0) - (a.likes || 0)) : tpData;
  msgs.innerHTML = list.map(c => {
    const reps = (c.r || []).length
      ? `<div class="tp-reps">${c.r.map(r => `<div class="tp-rep"><b>${esc(r.n)}</b>${esc(r.x)}</div>`).join('')}</div>`
      : '';
    return `<div class="tp-msg">
      ${tpAva(c.n)}
      <div class="tp-body">
        <div class="tp-meta"><b>${esc(c.n)}</b><time>${esc(c.t || '')}</time>
          <button class="tp-like${c.liked ? ' on' : ''}" data-like="${c.id}">👍 ${c.likes || 0}</button>
        </div>
        <p>${esc(c.x || '')}</p>
        ${reps}
      </div>
    </div>`;
  }).join('');

  const empty = $('#tpEmpty');
  if (empty) {
    empty.classList.toggle('on', !list.length);
    empty.textContent = tpLoading ? '正在加载留言…' : '还没有人发言，来发布第一条技术观点吧。';
  }

  const names = [...new Set(tpData.map(c => c.n))];
  const likes = tpData.reduce((s, c) => s + (c.likes || 0), 0);
  const users = $('#tpUsers');
  if (users) users.innerHTML = names.slice(0, 6).map(tpAva).join('');
  const usersMeta = $('#tpUsersMeta');
  if (usersMeta) usersMeta.textContent = names.length ? `共 ${names.length} 位技术人参与` : '暂无参与者';
  if ($('#tpMsgCount')) $('#tpMsgCount').textContent = tpData.length;
  if ($('#tpLikeCount')) $('#tpLikeCount').textContent = likes;
  if ($('#tpSub')) $('#tpSub').textContent = `已同步 ${tpData.length} 条讨论 · 共 ${names.length} 人参与`;
};

const tpLoad = async silent => {
  if (!silent) { tpLoading = true; tpRender(); }
  const list = await Api.comments('guest', 'guest');
  const s = JSON.stringify(list.map(c => [c.id, c.likes, c.liked, (c.r || []).map(r => [r.id, r.x])]));
  tpLoading = false;
  if (!list.length && !tpSig) { tpData = []; tpRender(); return; }
  if (silent && s === tpSig) return;
  tpSig = s; tpData = list; tpRender();
};

const openTech = async () => {
  tpOverlay.classList.add('on');
  document.body.classList.add('tech-open');
  await tpLoad();
  const msgs = $('#tpMsgs');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
  setTimeout(() => $('#tpText').focus(), 120);
  clearInterval(tpTimer);
  tpTimer = setInterval(() => {
    if (!tpOverlay.classList.contains('on')) { clearInterval(tpTimer); return; }
    tpLoad(true);
  }, 10000);
};
const closeTech = () => {
  tpOverlay.classList.remove('on');
  document.body.classList.remove('tech-open');
  clearInterval(tpTimer);
};
if ($('#railTech')) $('#railTech').onclick = openTech;
if ($('#techFab')) $('#techFab').onclick = openTech;
if ($('#techClose')) $('#techClose').onclick = closeTech;
tpOverlay.addEventListener('click', e => { if (!e.target.closest('.tp-modal')) closeTech(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && tpOverlay.classList.contains('on')) closeTech();
});
$('#tpTabs').addEventListener('click', e => {
  const b = e.target.closest('.tp-tab');
  if (!b) return;
  tpSort = b.dataset.sort;
  $$('#tpTabs .tp-tab').forEach(x => x.classList.toggle('on', x === b));
  tpRender();
});
$('#tpMsgs').addEventListener('click', async e => {
  const like = e.target.closest('[data-like]');
  if (!like) return;
  const r = await Api.likeComment(+like.dataset.like);
  if (!r) { toast('请先登录后再点赞'); return; }
  tpLoad(true);
});

const tpSend = async () => {
  const el = $('#tpText');
  if (!el) return;
  const t = el.value.trim();
  if (!t) return;
  el.value = '';
  const err = await Api.addComment('guest', 'guest', t, null);
  if (err) { el.value = t; toast(err); return; }
  await tpLoad();
  const msgs = $('#tpMsgs');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
};
if ($('#tpSend')) $('#tpSend').onclick = tpSend;
if ($('#tpText')) $('#tpText').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tpSend(); } });

/* ---------- 视图 ---------- */
function card(p) {
  return `<article class="card post-card">
    <div class="cover">${p.cover}</div>
    <h2><a href="#/post/${p.slug}">${esc(p.title)}</a></h2>
    <p class="desc">${esc(p.desc)}</p>
    <div class="meta"><span>📅 ${p.date}</span><span>📂 ${esc(p.cat)}</span><span>⏱ ${readTime(p.md)} 分钟</span></div>
    <div class="meta">${p.tags.map(t=>`<a class="tag" href="#/tag/${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>
  </article>`;
}

let homeState = { q: '', cat: '', page: 1 };

function vHome() {
  const cats = [...new Set(POSTS.map(p => p.cat))];
  const tagTotal = new Set(POSTS.flatMap(p => p.tags)).size;
  const navTotal = (typeof TOOL_NAV !== 'undefined' ? TOOL_NAV : []).reduce((s, g) => s + g.links.length, 0);
  app.innerHTML = `
    <section class="hero">
      <div class="hero-in">
        <span class="hero-badge">⚡ Tech Station · 技术驿站</span>
        <h1>把复杂的技术，<em>讲得简单</em></h1>
        <div class="hero-marquee" aria-label="100+ 作品在线体验">
          <div class="hero-marquee-track">
            <span class="hm"><b>100+</b>作品在线体验</span><i class="hm-sep"></i>
            <span class="hm"><b>100+</b>作品在线体验</span><i class="hm-sep"></i>
            <span class="hm"><b>100+</b>作品在线体验</span><i class="hm-sep"></i>
            <span class="hm"><b>100+</b>作品在线体验</span><i class="hm-sep"></i>
            <span class="hm"><b>100+</b>作品在线体验</span><i class="hm-sep"></i>
            <span class="hm"><b>100+</b>作品在线体验</span><i class="hm-sep"></i>
            <span class="hm"><b>100+</b>作品在线体验</span><i class="hm-sep"></i>
            <span class="hm"><b>100+</b>作品在线体验</span><i class="hm-sep"></i>
          </div>
        </div>
        <div class="hero-stats">
          <div><b>${POSTS.length}</b><span>技术长文</span></div>
          <div><b>${cats.length}</b><span>内容方向</span></div>
          <div><b>${tagTotal}</b><span>技术标签</span></div>
        </div>
        <div class="hero-actions">
          <button type="button" class="hero-btn pri" id="heroRead">开始阅读 →</button>
          <button type="button" class="hero-btn" id="heroConsult">技术咨询</button>
        </div>
      </div>
      <div class="hero-art" aria-hidden="true">
        <div class="art-window" id="artCodeWin">
          <div class="art-bar"><i></i><i></i><i></i><span>station.js</span></div>
          <div class="art-code">
            <p><b>const</b> station = <em>await</em> init();</p>
            <p><b>station</b>.posts(<span>${POSTS.length}</span>);</p>
            <p><b>station</b>.tags(<span>${tagTotal}</span>);</p>
            <p><b>station</b>.ready(<span>true</span>);</p>
          </div>
          <div class="art-badge">● ONLINE · ALWAYS SHIPPING</div>
        </div>
        <div class="art-window art-about" id="artAbout" hidden>
          <div class="art-bar"><i></i><i></i><i></i><span>about.md</span></div>
          <div class="about-lines" id="aboutLines"></div>
          <a class="art-enter" id="artEnter" href="#/archive" hidden>进入文章归档 →</a>
        </div>
      </div>
    </section>
    <div class="feature-row">
      <a class="feat-card" href="#/tags">
        <span class="feat-ic" style="background:linear-gradient(135deg,#4f46e5,#7c3aed)">🏷</span>
        <div class="feat-txt"><b>技术图谱</b><span>${tagTotal} 个技术栈 · 按方向浏览</span></div>
      </a>
      <a class="feat-card" href="#/tools">
        <span class="feat-ic" style="background:linear-gradient(135deg,#06b6d4,#3b82f6)">🧰</span>
        <div class="feat-txt"><b>精品工具集</b><span>${navTotal || 800}+ 个在线工具随用随走</span></div>
      </a>
      <a class="feat-card" href="#/works">
        <span class="feat-ic" style="background:linear-gradient(135deg,#f59e0b,#ec4899)">🚀</span>
        <div class="feat-txt"><b>我的作品</b><span>自研工具 · 登录即免费体验</span></div>
      </a>
    </div>
    <div class="sec-head"><h2>最新文章</h2><span>共 ${POSTS.length} 篇 · 持续更新</span></div>
    <div class="toolbar">
      <div class="search">🔍<input id="q" placeholder="搜索标题 / 简介 / 标签…" value="${esc(homeState.q)}"></div>
      <div class="chips" id="catChips">
        <span class="chip ${!homeState.cat?'on':''}" data-cat="">全部</span>
        ${cats.map(c=>`<span class="chip ${homeState.cat===c?'on':''}" data-cat="${esc(c)}">${esc(c)}</span>`).join('')}
      </div>
    </div>
    <div class="post-list" id="list"></div>
    <div class="pager" id="pager"></div>`;
  $('#q').oninput = e => { homeState.q = e.target.value; homeState.page = 1; drawList(); };
  $('#catChips').onclick = e => {
    const c = e.target.dataset.cat; if (c == null) return;
    homeState.cat = c; homeState.page = 1;
    $$('#catChips .chip').forEach(x => x.classList.toggle('on', x.dataset.cat === c));
    drawList();
  };

  /* 点击「开始阅读」：在右侧面板中逐条呈现「关于本站」内容 */
  const heroRead = $('#heroRead');
  if (heroRead) heroRead.addEventListener('click', () => {
    const codeWin = $('#artCodeWin'), about = $('#artAbout');
    if (!codeWin || !about) return;
    if (matchMedia('(max-width:1000px)').matches) { location.hash = '#/archive'; return; }
    if (about.dataset.on === '1') { location.hash = '#/archive'; return; }
    about.dataset.on = '1';
    codeWin.hidden = true;
    about.hidden = false;
    const lines = $('#aboutLines');
    const rows = [
      ['h', '📚 内容方向'],
      ['t', '前端 · 后端 · 运维 · 数据库 · AI'],
      ['t', '开发工具 · 计算机网络 · 人工智能'],
      ['h', '🛠 本站功能'],
      ['t', '全文搜索 · 标签筛选 · 文章归档'],
      ['t', '目录导航 · 代码高亮 · 一键复制'],
      ['t', '深色模式 · 评论 · 留言板 · RSS'],
      ['h', '✍️ 写作理念'],
      ['t', '把复杂的东西讲简单'],
      ['t', '能跑通 · 看得懂 · 用得上']
    ];
    rows.forEach(([kind, text], i) => setTimeout(() => {
      if (!lines || !lines.isConnected) return;
      const row = document.createElement('div');
      row.className = 'about-line' + (kind === 'h' ? ' head' : '');
      row.innerHTML = (kind === 'h' ? '' : '<i></i>') + esc(text);
      lines.appendChild(row);
    }, 160 + i * 280));
    setTimeout(() => {
      if (!about.isConnected) return;
      const enter = $('#artEnter');
      if (enter) enter.hidden = false;
      if (heroRead.isConnected) heroRead.textContent = '进入文章归档 →';
    }, 160 + rows.length * 280 + 120);
  });

  /* 点击「技术咨询」：平滑滚动到页脚技术咨询卡片 */
  const heroConsult = $('#heroConsult');
  if (heroConsult) heroConsult.addEventListener('click', () => {
    const card = $('#consultCard');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 1500);
  });

  drawList();
}
function $$(s){ return [...document.querySelectorAll(s)]; }

function drawList() {
  const q = homeState.q.trim().toLowerCase();
  let list = SORTED.filter(p =>
    (!homeState.cat || p.cat === homeState.cat) &&
    (!q || (p.title + p.desc + p.tags.join('')).toLowerCase().includes(q)));
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  homeState.page = Math.min(homeState.page, pages);
  const cur = list.slice((homeState.page-1)*PAGE_SIZE, homeState.page*PAGE_SIZE);
  $('#list').innerHTML = cur.length ? cur.map(card).join('') : '<div class="empty">没有找到相关文章 🔍</div>';
  $('#pager').innerHTML = pages <= 1 ? '' :
    `<button ${homeState.page===1?'disabled':''} data-p="-1">‹ 上一页</button>` +
    Array.from({length: pages}, (_,i)=>`<button class="${i+1===homeState.page?'on':''}" data-p="${i+1}">${i+1}</button>`).join('') +
    `<button ${homeState.page===pages?'disabled':''} data-p="+1">下一页 ›</button>`;
  $('#pager').onclick = e => {
    const p = e.target.dataset.p; if (!p) return;
    homeState.page = p==='-1' ? homeState.page-1 : p==='+1' ? homeState.page+1 : +p;
    drawList(); scrollTo({top: 0, behavior:'smooth'});
  };
}

function vPost(slug) {
  const p = POSTS.find(x => x.slug === slug);
  if (!p) { app.innerHTML = '<div class="empty">文章不存在</div>'; return; }
  const body = md(p.md);
  const idx = SORTED.indexOf(p);
  const prev = SORTED[idx-1], next = SORTED[idx+1];
  const rel = SORTED.filter(x => x.slug!==slug && (x.cat===p.cat || x.tags.some(t=>p.tags.includes(t)))).slice(0,3);
  // TOC
  const tmp = document.createElement('div'); tmp.innerHTML = body;
  const heads = [...tmp.querySelectorAll('h2,h3')];
  const toc = heads.map(h=>`<a class="${h.tagName.toLowerCase()}" href="#${h.id}" data-anchor="${h.id}">${h.textContent}</a>`).join('');

  app.innerHTML = `<div class="post-page">
    <article class="card post-main">
      <div class="post-head">
        <h1>${p.cover} ${esc(p.title)}</h1>
        <div class="meta"><span>📅 ${p.date}</span><span>📂 <a href="#/cat/${encodeURIComponent(p.cat)}">${esc(p.cat)}</a></span>
        <span>⏱ ${readTime(p.md)} 分钟阅读</span></div>
        <div class="meta">${p.tags.map(t=>`<a class="tag" href="#/tag/${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>
      </div>
      <div class="article">${body}</div>
      <div class="post-nav">
        ${prev?`<a class="card" href="#/post/${prev.slug}"><span class="arrow">‹ 上一篇</span>${esc(prev.title)}</a>`:'<span></span>'}
        ${next?`<a class="card" style="text-align:right" href="#/post/${next.slug}"><span class="arrow">下一篇 ›</span>${esc(next.title)}</a>`:'<span></span>'}
      </div>
      ${rel.length?`<h3 style="margin-bottom:12px">📌 相关阅读</h3><div class="rel-list">${rel.map(r=>`<a class="card" href="#/post/${r.slug}">${r.cover} ${esc(r.title)}</a>`).join('')}</div>`:''}
      <section class="comments" id="comments">
        <h3>💬 评论（<span id="cmtCount">0</span>）</h3>
        <div class="cmt-form">
          <p class="muted" style="font-size:13px">以 <b>${esc(Auth.user() || '')}</b> 的身份发表</p>
          <textarea id="cmtText" placeholder="写下你的想法…" maxlength="500"></textarea>
          <button class="btn" id="cmtBtn">发表评论</button>
        </div>
        <div id="cmtList"></div>
      </section>
    </article>
    <aside class="card toc"><b>📑 目录</b>${toc || '<span class="muted">无目录</span>'}</aside>
  </div>`;

  // TOC 平滑滚动
  $$('.toc a').forEach(a => a.onclick = e => {
    e.preventDefault();
    document.getElementById(a.dataset.anchor)?.scrollIntoView({behavior:'smooth'});
  });
  // TOC 滚动高亮当前章节
  const tocLinks = $$('.toc a[data-anchor]');
  if (tocLinks.length) {
    const spy = () => {
      let cur = tocLinks[0];
      tocLinks.forEach(a => {
        const el = document.getElementById(a.dataset.anchor);
        if (el && el.getBoundingClientRect().top < 120) cur = a;
      });
      tocLinks.forEach(a => a.classList.toggle('on', a === cur));
    };
    if (window.__tocSpy) window.removeEventListener('scroll', window.__tocSpy);
    window.__tocSpy = spy;
    window.addEventListener('scroll', spy, { passive: true });
    spy();
  }
  // 复制代码
  $$('.copy-btn').forEach(b => b.onclick = () => {
    const code = b.parentElement.querySelector('code').innerText;
    (navigator.clipboard?.writeText(code) || Promise.reject()).then(
      () => { b.textContent = '已复制 ✓'; setTimeout(()=>b.textContent='复制',1500); },
      () => { b.textContent = '失败'; });
  });
  // 评论（后端存储，发表后 3 分钟内可删除）
  const draw = async () => {
    const list = await Api.comments('post', slug);
    $('#cmtCount').textContent = list.reduce((s, c) => s + 1 + (c.r || []).length, 0);
    $('#cmtList').innerHTML = list.map(c => {
      const reps = (c.r || []).map(r => `<div class="cmt reply"><span class="who">${esc(r.n)}</span>${r.to ? `<span class="to">回复 @${esc(r.to)}</span>` : ''}<span class="when">${r.t}</span>${r.canDel ? `<button class="cmt-del" data-id="${r.id}">删除</button>` : ''}<button class="cmt-rep" data-id="${c.id}" data-to="${esc(r.n).replace(/"/g,'&quot;')}">回复</button><button class="cmt-like${r.liked ? ' on' : ''}" data-id="${r.id}">👍 ${r.likes || 0}</button><p class="what">${esc(r.x)}</p></div>`).join('');
      return `<div class="cmt"><span class="who">${esc(c.n)}</span><span class="when">${c.t}</span>${c.canDel ? `<button class="cmt-del" data-id="${c.id}">删除</button>` : ''}<button class="cmt-rep" data-id="${c.id}" data-to="">回复</button><button class="cmt-like${c.liked ? ' on' : ''}" data-id="${c.id}">👍 ${c.likes || 0}</button><p class="what">${esc(c.x)}</p>${reps}<div class="rep-form" id="repForm${c.id}" style="display:none"><textarea class="rep-text" placeholder="写下你的回复…" maxlength="300"></textarea><button class="btn rep-send" data-id="${c.id}">发表回复</button></div></div>`;
    }).join('') || '<p class="muted" style="padding:12px 0">还没有评论，来抢沙发～</p>';
    document.querySelectorAll('#cmtList .cmt-like').forEach(b => b.onclick = async () => {
      const r = await Api.likeComment(+b.dataset.id);
      if (!r) { toast('请先登录后再点赞'); return; }
      draw();
    });
    document.querySelectorAll('#cmtList .cmt-del').forEach(b => b.onclick = async () => {
      if (!confirm('确定删除吗？')) return;
      const err = await Api.delComment(+b.dataset.id);
      if (err) { toast(err); return; }
      draw();
    });
    document.querySelectorAll('#cmtList .cmt-rep').forEach(b => b.onclick = () => {
      const f = $('#repForm' + b.dataset.id);
      const open = f.style.display !== 'none';
      document.querySelectorAll('#cmtList .rep-form').forEach(x => x.style.display = 'none');
      if (!open) { f.style.display = 'flex'; f.dataset.to = b.dataset.to || ''; f.querySelector('.rep-text').placeholder = b.dataset.to ? `回复 @${b.dataset.to}…` : '写下你的回复…'; f.querySelector('.rep-text').focus(); }
    });
    document.querySelectorAll('#cmtList .rep-send').forEach(b => b.onclick = async () => {
      const f = $('#repForm' + b.dataset.id);
      const x = f.querySelector('.rep-text').value.trim();
      if (!x) { alert('请填写内容'); return; }
      const err = await Api.addComment('post', slug, x, +b.dataset.id);
      if (err) { toast(err); return; }
      f.style.display = 'none';
      draw();
    });
  };
  $('#cmtBtn').onclick = async () => {
    const x = $('#cmtText').value.trim();
    if (!x) { alert('请填写内容'); return; }
    const err = await Api.addComment('post', slug, x, null);
    if (err) { toast(err); return; }
    $('#cmtText').value = '';
    draw();
  };
  draw();
  scrollTo(0, 0);
}

function vList(title, list) {
  app.innerHTML = `<div class="card page-box"><h1>${title}</h1>
    ${list.length ? list.map(p => `<div class="arch-item"><time>${p.date}</time><a href="#/post/${p.slug}">${p.cover} ${esc(p.title)}</a></div>`).join('') : '<div class="empty">暂无文章</div>'}
  </div>`;
}

function vArchive() {
  const groups = {};
  SORTED.forEach(p => { const k = p.date.slice(0,7); (groups[k] = groups[k] || []).push(p); });
  app.innerHTML = `<div class="card page-box"><h1>🗂 文章归档</h1>` +
    Object.keys(groups).sort().reverse().map(k =>
      `<div class="arch-group"><h3>${k}（${groups[k].length} 篇）</h3>` +
      groups[k].map(p => `<div class="arch-item"><time>${p.date}</time><a href="#/post/${p.slug}">${p.cover} ${esc(p.title)}</a></div>`).join('') + '</div>'
    ).join('') + '</div>';
}

function vTags() {
  const PALETTE = ['#4f6ef7','#8b5cf6','#ec4899','#f59e0b','#10b981','#06b6d4','#f43f5e','#6366f1','#84cc16','#fb923c'];
  const CICON = { '前端':'🎨','后端':'⚙️','运维':'🚀','数据库':'🗄️','AI':'🤖','网络':'🌐','工具':'🧰','算法':'🧮' };
  const colorOf = t => { let h = 0; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
  const groups = {};
  POSTS.forEach(p => (groups[p.cat] = groups[p.cat] || new Map()) && p.tags.forEach(t => groups[p.cat].set(t, (groups[p.cat].get(t) || 0) + 1)));
  const total = new Set(POSTS.flatMap(p => p.tags)).size;
  app.innerHTML = `<div class="card page-box">
    <h1>🏷 全部技术栈</h1>
    <p class="muted" style="margin-bottom:6px">共 ${Object.keys(groups).length} 个方向 · ${total} 个技术栈，点击标签查看相关文章</p>` +
    Object.keys(groups).map(cat => `
      <div class="tag-cat">${Object.keys(CICON).find(k => cat.includes(k)) ? CICON[Object.keys(CICON).find(k => cat.includes(k))] : '📂'} ${esc(cat)}<span class="tag-cat-n">${groups[cat].size}</span></div>
      <div class="tag-cloud2">` +
      [...groups[cat].entries()].sort((a,b)=>b[1]-a[1]).map(([t,n]) =>
        `<a class="tag-pill" href="#/tag/${encodeURIComponent(t)}" style="background:${colorOf(t)}">${esc(t)}<span class="n">${n}</span></a>`
      ).join('') + `</div>`
    ).join('') + `</div>`;
}

function vGuest() {
  const state = { tab: 'all', sort: 'new', q: '' };
  let favs = store.get('blog-guest-favs', []);
  let data = [], sig = '';

  app.innerHTML = `<div class="mb">
    <aside class="mb-side">
      <div class="mb-brand">留言板<span>Message Board</span></div>
      <nav class="mb-nav" id="mbNav">
        <button class="on" data-tab="all">💬 全部留言</button>
        <button data-tab="mine">🙋 我的留言</button>
        <button data-tab="fav">⭐ 我的收藏</button>
        <button data-tab="hot">🔥 精华留言</button>
      </nav>
    </aside>
    <section class="mb-main">
      <div class="mb-top">
        <h1>留言板</h1>
        <div class="mb-search">🔍<input id="mbQ" placeholder="搜索留言、用户" value="${esc(state.q)}"></div>
        <button class="mb-write" id="mbWrite">✎ 写留言</button>
      </div>
      <div class="mb-toolbar">
        <div class="mb-sorts" id="mbSort">
          <button class="on" data-sort="new">最新</button>
          <button data-sort="hot">热门</button>
        </div>
        <span class="mb-count" id="mbCount"></span>
      </div>
      <div class="mb-list" id="mbList"><div class="mb-loading">正在加载留言…</div></div>
      <div class="mb-composer">
        <textarea id="mbText" maxlength="500" placeholder="写下你的想法……"></textarea>
        <button class="mb-pub" id="mbPub">发布</button>
      </div>
    </section>
    <aside class="mb-right">
      <div class="mb-widget"><div class="mb-wtitle">👥 活跃用户</div><div class="mb-users" id="mbUsers"></div></div>
      <div class="mb-widget"><div class="mb-wtitle">🏷 热门话题</div><div class="mb-topics" id="mbTopics"></div></div>
      <div class="mb-widget"><div class="mb-wtitle">📢 公告</div><p class="mb-note">欢迎来到技术交流区：友善发言、分享问题与想法，一起把技术聊明白。</p></div>
    </aside>
  </div>`;

  const ava = n => `<span class="mb-ava v${(String(n).length % 6) + 1}">${esc(String(n).slice(0, 1))}</span>`;
  const isFav = id => favs.includes(id);
  const item = c => {
    const reps = (c.r || []).map(r => `<div class="mb-rep"><b>${esc(r.n)}</b>${esc(r.x)}<time> · ${esc(r.t)}</time>${r.canDel ? `<button class="mb-rep-del" data-del="${r.id}">删除</button>` : ''}</div>`).join('');
    return `<article class="mb-item" data-id="${c.id}">
      ${ava(c.n)}
      <div class="mb-ib">
        <div class="mb-imeta"><b>${esc(c.n)}</b><time>${esc(c.t)}</time>${c.canDel ? `<button class="mb-del" data-del="${c.id}">删除</button>` : ''}</div>
        <p class="mb-text">${esc(c.x)}</p>
        <div class="mb-iact">
          <button data-like="${c.id}" class="${c.liked ? 'liked' : ''}">👍 ${c.likes || 0}</button>
          <button data-reply="${c.id}">💬 回复 ${(c.r || []).length}</button>
          <button data-fav="${c.id}" class="${isFav(c.id) ? 'faved' : ''}">⭐ ${isFav(c.id) ? '已收藏' : '收藏'}</button>
        </div>
        ${reps ? `<div class="mb-reps">${reps}</div>` : ''}
        <div class="mb-repform" hidden><textarea placeholder="写下你的回复…" maxlength="300"></textarea><button data-send="${c.id}">发送</button></div>
      </div>
    </article>`;
  };

  const filtered = () => {
    let list = data.slice();
    const q = state.q.trim().toLowerCase();
    if (state.tab === 'mine') list = list.filter(c => c.n === Auth.user());
    if (state.tab === 'fav') list = list.filter(c => isFav(c.id));
    if (state.tab === 'hot') list = list.filter(c => (c.likes || 0) > 0);
    if (q) list = list.filter(c => (c.n + c.x).toLowerCase().includes(q));
    if (state.sort === 'hot' || state.tab === 'hot') list.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    return list;
  };

  const render = () => {
    const list = filtered();
    $('#mbList').innerHTML = list.length ? list.map(item).join('') : '<div class="mb-loading">没有找到相关留言</div>';
    $('#mbCount').textContent = `共 ${list.length} 条留言`;
    const byUser = {};
    data.forEach(c => { byUser[c.n] = (byUser[c.n] || 0) + 1; });
    const users = Object.entries(byUser).sort((a, b) => b[1] - a[1]).slice(0, 5);
    $('#mbUsers').innerHTML = users.length
      ? users.map(([n, cnt]) => `<div class="mb-user">${ava(n)}<b>${esc(n)}</b><span>${cnt} 条</span></div>`).join('')
      : '<p class="mb-note">暂无用户发言</p>';
    const KW = ['前端', '后端', '数据库', 'AI', '运维', '性能', '安全', '开源', '工具'];
    const topics = KW.map(k => [k, data.filter(c => (c.x || '').toLowerCase().includes(k.toLowerCase())).length]).filter(x => x[1] > 0).slice(0, 6);
    $('#mbTopics').innerHTML = topics.length
      ? topics.map(([k, n]) => `<span class="mb-topic">${k} ${n}</span>`).join('')
      : '<p class="mb-note">暂无热门话题</p>';
  };

  const load = async silent => {
    const list = await Api.comments('guest', 'guest');
    const s = JSON.stringify(list.map(c => [c.id, c.likes, c.canDel, (c.r || []).map(r => [r.id, r.likes, r.x])]));
    if (silent && s === sig) return;
    sig = s; data = list; render();
  };

  $('#mbList').onclick = async e => {
    const del = e.target.closest('[data-del]');
    if (del) {
      if (!confirm('确定删除吗？')) return;
      const err = await Api.delComment(+del.dataset.del);
      if (err) { toast(err); return; }
      load(); return;
    }
    const like = e.target.closest('[data-like]');
    if (like) {
      const r = await Api.likeComment(+like.dataset.like);
      if (!r) { toast('请先登录后再点赞'); return; }
      load(); return;
    }
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      const id = +fav.dataset.fav;
      favs = favs.includes(id) ? favs.filter(x => x !== id) : [id, ...favs];
      store.set('blog-guest-favs', favs); render(); return;
    }
    const rep = e.target.closest('[data-reply]');
    if (rep) {
      const f = rep.closest('.mb-item').querySelector('.mb-repform');
      f.hidden = !f.hidden;
      if (!f.hidden) f.querySelector('textarea').focus();
      return;
    }
    const send = e.target.closest('[data-send]');
    if (send) {
      const f = send.closest('.mb-repform');
      const x = f.querySelector('textarea').value.trim();
      if (!x) return;
      const err = await Api.addComment('guest', 'guest', x, +send.dataset.send);
      if (err) { toast(err); return; }
      f.hidden = true; load();
    }
  };

  $('#mbNav').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    state.tab = b.dataset.tab;
    $$('#mbNav button').forEach(x => x.classList.toggle('on', x === b));
    render();
  };
  $('#mbSort').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    state.sort = b.dataset.sort;
    $$('#mbSort button').forEach(x => x.classList.toggle('on', x === b));
    render();
  };
  $('#mbQ').oninput = e => { state.q = e.target.value; render(); };
  $('#mbWrite').onclick = () => {
    $('#mbText').focus();
    $('#mbText').scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  $('#mbPub').onclick = async () => {
    const x = $('#mbText').value.trim();
    if (!x) { toast('请填写内容'); return; }
    const err = await Api.addComment('guest', 'guest', x, null);
    if (err) { toast(err); return; }
    $('#mbText').value = '';
    load();
  };

  load();
  if (window.__mbTimer) clearInterval(window.__mbTimer);
  window.__mbTimer = setInterval(() => {
    if (!document.getElementById('mbList')) { clearInterval(window.__mbTimer); return; }
    load(true);
  }, 10000);
}

const WORK_PLANS = [
  { k: 'once', n: '单次', p: '¥2.5', d: '1 次使用', ms: 0 },
  { k: 'week', n: '包周', p: '¥16.66', d: '7 天不限次', ms: 7 * 864e5 },
  { k: 'month', n: '包月', p: '¥39.99', d: '30 天不限次', ms: 30 * 864e5 },
  { k: 'year', n: '包年', p: '¥398', d: '365 天不限次', ms: 365 * 864e5 },
];
// 开通码规则：YZ<套餐>-<3位数字><校验位>，校验位 = 前3位数字之和 % 10
// 例：YZ6-1236（1+2+3=6）为单次码；YZ18-8086（8+0+8=16→6）为包周码。站长可随时编新码，每码限用一次
const WORK_CODE_RE = /^YZ(6|18|59|666)-(\d{3})(\d)$/;
const CODE_PLAN = { '6': 'once', '18': 'week', '59': 'month', '666': 'year' };
function parseCode(code) {
  const m = WORK_CODE_RE.exec(code);
  if (!m) return null;
  const sum = (m[2].charCodeAt(0) + m[2].charCodeAt(1) + m[2].charCodeAt(2) - 144) % 10;
  if (sum !== +m[3]) return null;
  return CODE_PLAN[m[1]];
}
// 新版账号绑定码：YZ<套餐>-<2位账号码><3位数字><校验位>，校验位 = (3位数字之和 + 2位账号码ASCII) % 10
const WORK_CODE_RE2 = /^YZ(6|18|59|666)-([A-Z]{2})(\d{3})(\d)$/;
function acc2code(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * (i + 1)) % 676;
  return String.fromCharCode(65 + Math.floor(h / 26)) + String.fromCharCode(65 + (h % 26));
}
function parseCode2(code) {
  const m = WORK_CODE_RE2.exec(code);
  if (!m) return null;
  const sum = (+m[3][0] + +m[3][1] + +m[3][2] + m[2].charCodeAt(0) + m[2].charCodeAt(1)) % 10;
  if (sum !== +m[4]) return null;
  return { plan: CODE_PLAN[m[1]], acc: m[2] };
}

function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove('show'), 2200);
}

function goWork(url) {
  if (url.startsWith('http') || url.startsWith('/')) window.open(url, '_blank', 'noopener');
  else location.hash = url;
}
// 从作品页跳回后刷新剩余次数/套餐显示
window.addEventListener('focus', () => { if (location.hash === '#/works' && Auth.user()) vWorks(); });

async function openWork(w) {
  if (w.free) return goWork(w.url);
  const r = await Api.useWork(w.id);
  if (r && r.ok) {
    if (r.vip) toast('已扣减 1 次使用次数');
    else toast('已使用免费体验（每个作品限 1 次）');
    /* 立即把卡片上的剩余次数改为最新值，再后台对齐服务端数据 */
    const el = document.querySelector(`.work-card[data-id="${w.id}"] .work-state`) || document.querySelector('[data-imp] .work-state');
    if (el && !r.vip && r.left != null) el.textContent = `免费体验 ${r.left}/1 次`;
    vWorks().catch(() => {});
    return goWork(w.url);
  }
  showPayModal(w);
}

function showPayModal(w) {
  const old = document.getElementById('payModal');
  if (old) old.remove();
  const guest = Auth.isGuest();
  const m = document.createElement('div');
  m.id = 'payModal';
  m.className = 'pay-mask';
  m.innerHTML = `<div class="pay-box">
    <button class="pay-x" id="payX">✕</button>
    <h3>🔒 免费体验次数已用完</h3>
    <p class="muted">「${w.name}」免费体验已用完（每件作品限 1 次），请选择套餐继续畅用</p>
    <p class="pay-acc">当前账号：<b>${esc(Auth.user() || '未登录')}</b>${Auth.isGuest() ? '（游客）' : ''} · 开通后仅该账号可享用</p>
    <div class="pay-plans">${WORK_PLANS.map((p, i) => {
      const off = guest && p.k !== 'once';
      const on = guest ? p.k === 'once' : i === 1;
      return `<label class="pay-plan${i === 1 ? ' hot' : ''}${off ? ' off' : ''}"><input type="radio" name="plan" value="${p.k}" ${on ? 'checked' : ''}${off ? ' disabled' : ''}>${i === 1 ? '<em>推荐</em>' : ''}<b>${p.n}</b><span class="pay-price">${p.p}</span><small>${p.d}${off ? ' · 游客不可' : ''}</small></label>`;
    }).join('')}</div>
    ${guest ? '<p class="pay-guest">游客账号仅可购买单次体验，其他套餐请注册正式账号后购买</p>' : ''}
    <div class="pay-tabs"><button class="pay-tab on" data-m="wx">💚 微信支付</button><button class="pay-tab" data-m="ali">💙 支付宝</button></div>
    <div class="pay-qr" id="payQr">
      <img src="img/wechat-pay.png" alt="微信收款码">
      <p class="pay-warn">⚠️ 不支持退款，谢谢合作！！！</p>
    </div>
    <div class="pay-manual">
      <div class="pay-step">① 扫码支付，<b>付款备注</b>填你的账号：<b>${esc(Auth.user() || '')}</b></div>
      <div class="pay-step">② 添加微信 <button type="button" class="pay-wx" id="payWxCopy" title="点击复制微信号">_Zc1908 📋</button> 发送<b>支付截图</b>，人工核实</div>
      <div class="pay-step">③ 核实后发放<b>专属开通码</b>（仅限你的账号使用），在下方输入即可开通</div>
    </div>
    <div class="pay-redeem">
      <input id="redeemInput" placeholder="粘贴开通码后点击开通" maxlength="20">
      <button class="btn" id="redeemBtn">立即开通</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  m.onclick = e => { if (e.target === m) m.remove(); };
  $('#payX').onclick = () => m.remove();
  m.querySelectorAll('.pay-tab').forEach(t => t.onclick = () => {
    m.querySelectorAll('.pay-tab').forEach(x => x.classList.remove('on'));
    t.classList.add('on');
    $('#payQr').innerHTML = t.dataset.m === 'wx'
      ? `<img src="img/wechat-pay.png" alt="微信收款码"><p class="pay-warn">⚠️ 不支持退款，谢谢合作！！！</p>`
      : `<img src="img/alipay-qr.png" alt="支付宝收款码"><p class="pay-warn">⚠️ 不支持退款，谢谢合作！！！</p>`;
  });
  $('#payWxCopy').onclick = () => {
    const b = $('#payWxCopy');
    const done = () => { b.textContent = '已复制 ✓'; setTimeout(() => { b.textContent = '_Zc1908 📋'; }, 1500); };
    try { navigator.clipboard.writeText('_Zc1908').then(done).catch(done); } catch (_) { done(); }
  };
  $('#redeemBtn').onclick = async () => {
    const code = $('#redeemInput').value.trim().toUpperCase();
    if (!code) { toast('请输入开通码'); return; }
    const b = $('#redeemBtn');
    if (b.disabled) return;
    b.disabled = true; b.textContent = '开通中…';
    const err = await Api.redeem(w.id, code);
    b.disabled = false; b.textContent = '立即开通';
    if (err) { toast(err); return; }
    const nb = parseCode2(code);
    const pl = WORK_PLANS.find(x => x.k === (nb ? nb.plan : parseCode(code)));
    m.remove();
    toast(`🎉 ${pl ? pl.n : ''}套餐开通成功，感谢支持！`);
    goWork(w.url);
  };
}

const AD_PLANS = [
  { k: 'once', n: '单次体验', price: '2.5', old: '6', desc: '1 次使用' },
  { k: 'week', n: '体验周卡', price: '16.66', old: '18.88', desc: '7 天 · 不限次数', hot: true },
  { k: 'month', n: '畅享月卡', price: '39.99', old: '59.99', desc: '30 天 · 不限次数' },
  { k: 'year', n: '包年会员', price: '398', old: '666', desc: '365 天 · 永久划算' }
];

/* 确认订单弹框：下单人信息 + 商品备注 */
function showOrderModal(s) {
  const old = document.getElementById('ocModal');
  if (old) old.remove();
  const name = Auth.user();
  const m = document.createElement('div');
  m.id = 'ocModal';
  m.className = 'ad-mask';
  m.innerHTML = `<div class="oc-box">
    <button class="ad-x" id="ocX" aria-label="关闭">✕</button>
    <h3>🧾 确认订单</h3>
    <div class="oc-row"><span class="oc-k">商品</span><div class="oc-v">${esc(s.title)}<small>${esc(s.stack || '')}${s.version ? ' · ' + esc(s.version) : ''}</small></div></div>
    <div class="oc-row"><span class="oc-k">下单人</span><div class="oc-v"><span class="oc-who">${esc(name || '游客')}${Auth.isGuest() ? '（游客）' : ''}</span></div></div>
    <div class="oc-row col"><span class="oc-k">商品备注</span>
      <textarea id="ocNote" maxlength="200" placeholder="补充需求：部署环境、需要的功能、联系方式等（选填）"></textarea>
    </div>
    <div class="oc-btns">
      <button class="oc-c" id="ocCancel" type="button">取消</button>
      <button class="oc-ok" id="ocOk" type="button">确认下单</button>
    </div>
  </div>`;
  document.body.appendChild(m);

  const close = () => m.remove();
  $('#ocX').onclick = close;
  $('#ocCancel').onclick = close;
  m.onclick = e => { if (e.target === m) close(); };
  $('#ocOk').onclick = async () => {
    const btn = $('#ocOk');
    btn.disabled = true;
    btn.textContent = '提交中…';
    try {
      const r = await Api.orderWork(s.slug, $('#ocNote').value.trim());
      close();
      toast(`下单成功：第 ${(r.app && r.app.orderCount) || 1} 单，后台「作品管理」可查看下单状态`);
    } catch (e) {
      toast('下单失败：' + e.message);
      btn.disabled = false;
      btn.textContent = '确认下单';
    }
  };
}

/* 进入应用前的会员广告弹框（含下单入口 + 开通码校验） */
function showAdModal(w, onEnter) {
  const old = document.getElementById('adModal');
  if (old) old.remove();

  const guest = Auth.isGuest();
  let picked = guest ? AD_PLANS[0] : AD_PLANS[1];
  let skip = 5;
  let offer = 599;
  const m = document.createElement('div');
  m.id = 'adModal';
  m.className = 'ad-mask';
  m.innerHTML = `<div class="ad-box">
    <button class="ad-x" id="adX" aria-label="关闭">✕</button>
    <div class="ad-hero">
      <span class="ad-flag">🎁 新用户专享</span>
      <h2>全站会员体验礼包</h2>
      <p class="ad-sub">「${esc(w.name)}」等全部作品，开通即无限畅用</p>
      <div class="ad-price"><span class="ad-cur">¥</span><b id="adPrice">${picked.price}</b><s id="adOld">¥${picked.old}</s><i>首单立减 · 限时特惠</i></div>
      <div class="ad-cd">优惠倒计时 <b id="adCd">09:59</b></div>
    </div>
    <div class="ad-body">
      <div class="ad-perks">
        <div><span>⚡</span><b>不限次数</b></div>
        <div><span>🧠</span><b>AI 文案配图</b></div>
        <div><span>📦</span><b>多格式导出</b></div>
        <div><span>🔐</span><b>专属开通码</b></div>
      </div>
      <div class="ad-plans">
        ${AD_PLANS.map(p => {
          const off = guest && p.k !== 'once';
          return `<button class="ad-plan${p.hot ? ' hot' : ''}${p.k === picked.k ? ' on' : ''}${off ? ' off' : ''}" data-k="${p.k}" type="button"${off ? ' disabled' : ''}>
          ${p.hot ? '<em>最划算</em>' : ''}
          <b>${p.n}</b>
          <strong>¥${p.price}</strong>
          <small>${p.desc}${off ? ' · 游客不可' : ''}</small>
          <s>原价 ¥${p.old}</s>
        </button>`;
        }).join('')}
      </div>
      ${guest ? '<p class="ad-guest-tip">游客账号仅可购买单次体验，其他套餐请注册正式账号后购买</p>' : ''}
      <div class="ad-actions">
        <button class="ad-order" id="adOrder" type="button">立即下单 · ¥${picked.price} 开通</button>
        <button class="ad-skip" id="adSkip" type="button" disabled>广告 5 秒后可跳过</button>
      </div>
      <div class="ad-pay" id="adPay" hidden>
        <div class="ad-pay-head"><b id="adPayTitle">${picked.n} · ¥${picked.price}</b><button type="button" id="adPayBack">← 换个套餐</button></div>
        <div class="ad-pay-tabs">
          <button class="on" data-m="wx" type="button">💚 微信支付</button>
          <button data-m="ali" type="button">💙 支付宝</button>
        </div>
        <img id="adQr" src="img/wechat-pay.png" alt="收款码">
        <p class="ad-pay-tip">付款备注填账号 <b>${esc(Auth.user() || '未登录')}</b>，加微信 <button type="button" class="ad-wx" id="adWx">_Zc1908 📋</button> 发支付截图核实</p>
        <p class="ad-warn">⚠️ 商品不支持退款，感谢支持</p>
        <button class="ad-done" id="adDone" type="button">我已支付，下一步 →</button>
        <div class="ad-redeem" id="adRedeem" hidden>
          <div class="ad-redeem-head"><b>输入开通码激活会员</b><button type="button" id="adRedeemBack">← 返回支付</button></div>
          <p class="ad-redeem-tip">支付后请加微信 <b>_Zc1908</b> 索取开通码，未激活前无法使用该产品</p>
          <input id="adCode" class="ad-code" placeholder="请输入开通码，如 VIP-XXXX" autocomplete="off">
          <button class="ad-verify" id="adVerify" type="button">验证并开通 →</button>
          <p class="ad-msg" id="adMsg"></p>
        </div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(m);
  document.body.classList.add('ad-open');

  const offerTimer = setInterval(() => {
    offer = Math.max(0, offer - 1);
    const mm = String(Math.floor(offer / 60)).padStart(2, '0');
    const ss = String(offer % 60).padStart(2, '0');
    const el = $('#adCd');
    if (el) el.textContent = `${mm}:${ss}`;
  }, 1000);
  const skipTimer = setInterval(() => {
    skip--;
    const b = $('#adSkip');
    if (!b) return;
    if (skip <= 0) {
      clearInterval(skipTimer);
      b.disabled = false;
      b.textContent = '跳过广告，直接体验 →';
    } else {
      b.textContent = `广告 ${skip} 秒后可跳过`;
    }
  }, 1000);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(offerTimer);
    clearInterval(skipTimer);
    m.remove();
    document.body.classList.remove('ad-open');
  };

  $('#adX').onclick = close;
  m.onclick = e => { if (e.target === m) close(); };
  $('#adSkip').onclick = () => { close(); onEnter(); };

  m.querySelectorAll('.ad-plan').forEach(p => p.onclick = () => {
    if (guest && p.dataset.k !== 'once') { toast('游客仅可购买单次体验'); return; }
    picked = AD_PLANS.find(x => x.k === p.dataset.k) || picked;
    m.querySelectorAll('.ad-plan').forEach(x => x.classList.toggle('on', x === p));
    $('#adPrice').textContent = picked.price;
    $('#adOld').textContent = `¥${picked.old}`;
    $('#adOrder').textContent = `立即下单 · ¥${picked.price} 开通`;
    $('#adPayTitle').textContent = `${picked.n} · ¥${picked.price}`;
  });

  $('#adOrder').onclick = () => {
    $('#adPay').hidden = false;
    $('#adOrder').style.display = 'none';
    $('#adPay').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  $('#adPayBack').onclick = () => {
    $('#adPay').hidden = true;
    $('#adOrder').style.display = '';
  };
  m.querySelectorAll('.ad-pay-tabs button').forEach(t => t.onclick = () => {
    m.querySelectorAll('.ad-pay-tabs button').forEach(x => x.classList.remove('on'));
    t.classList.add('on');
    $('#adQr').src = t.dataset.m === 'wx' ? 'img/wechat-pay.png' : 'img/alipay-qr.png';
  });
  $('#adWx').onclick = () => {
    const b = $('#adWx');
    const done = () => { b.textContent = '已复制 ✓'; setTimeout(() => { b.textContent = '_Zc1908 📋'; }, 1500); };
    try { navigator.clipboard.writeText('_Zc1908').then(done).catch(done); } catch (_) { done(); }
  };
  $('#adDone').onclick = () => {
    $('#adPay').hidden = true;
    $('#adRedeem').hidden = false;
    const msg = $('#adMsg');
    msg.textContent = '';
    msg.className = 'ad-msg';
    setTimeout(() => $('#adCode').focus(), 80);
  };
  $('#adRedeemBack').onclick = () => {
    $('#adRedeem').hidden = true;
    $('#adPay').hidden = false;
  };
  const verifyCode = async () => {
    const code = $('#adCode').value.trim().toUpperCase();
    const msg = $('#adMsg');
    if (!code) {
      msg.textContent = '请输入开通码后再使用该产品';
      msg.className = 'ad-msg err';
      return;
    }
    const b = $('#adVerify');
    if (b.disabled) return;
    b.disabled = true;
    b.textContent = '验证中…';
    const err = await Api.redeem(w.id, code);
    b.disabled = false;
    b.textContent = '验证并开通 →';
    if (err) {
      msg.textContent = err;
      msg.className = 'ad-msg err';
      return;
    }
    msg.textContent = '开通成功，正在进入…';
    msg.className = 'ad-msg ok';
    toast(`🎉 「${w.name}」会员已开通`);
    setTimeout(() => { close(); onEnter(); }, 800);
  };
  $('#adVerify').onclick = verifyCode;
  $('#adCode').addEventListener('keydown', e => { if (e.key === 'Enter') verifyCode(); });
}

const NAV_PALETTE = ['#4f6ef7','#8b5cf6','#ec4899','#f59e0b','#10b981','#06b6d4','#f43f5e','#6366f1','#84cc16','#fb923c'];

function vTools() {
  // 本站自带工具
  const navTotal = TOOL_NAV.reduce((s, g) => s + g.links.length, 0);
  app.innerHTML = `<div class="card page-box"><h1>🧰 工具集</h1>
    <p class="muted">全网精选开发者导航</p>
    <div class="nav-filter">
      <div class="search">🔍<input id="navQ" placeholder="${navTotal}个精选工具在线使用....."></div>
      <span class="muted nav-count" id="navCount" style="display:none"></span>
    </div>
    <div id="navDir">${TOOL_NAV.map((g, gi) => `
      <section class="nav-group" data-gi="${gi}">
        <div class="tag-cat nav-group-head">${esc(g.name)}<span class="tag-cat-n">${g.links.length}</span></div>
        <div class="nav-cards">${g.links.map((l, i) => {
          const c = NAV_PALETTE[i % NAV_PALETTE.length];
          let host = ''; try { host = new URL(l.u).hostname.replace(/^www\./, ''); } catch (_) { }
          return `<a class="navcard" href="${esc(l.u)}" target="_blank" rel="noopener" data-name="${esc((l.n + ' ' + host).toLowerCase())}">
            <span class="navcard-ic" style="background:linear-gradient(135deg,${c},${c}bb)">${esc(l.n.trim().charAt(0))}</span>
            <span class="navcard-t"><b>${esc(l.n)}</b><i>${esc(host)}</i></span>
          </a>`;
        }).join('')}</div>
      </section>`).join('')}</div></div>`;
  $('#navQ').oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    let shown = 0;
    $$('#navDir .nav-group').forEach(g => {
      let gv = 0;
      g.querySelectorAll('.navcard').forEach(a => {
        const hit = !q || a.dataset.name.includes(q);
        a.style.display = hit ? '' : 'none';
        if (hit) gv++;
      });
      g.style.display = gv ? '' : 'none';
      shown += gv;
    });
    $('#navCount').textContent = q ? `匹配 ${shown} / ${navTotal} 个链接` : `共 ${navTotal} 个链接`;
  };
}

async function vWorks() {
  const works = [
    { id: 'poster', icon: '🎨', name: 'AI 海报制作', tagline: '30 秒做出一张能直接发的商业海报', desc: 'HTML / CSS / JS 的纯前端海报工坊：30+ 套模板/画布拖拽编辑/AI 文案与配图/二维码生成，一键导出 PNG、JPG、PDF，无需后端与数据库，打开网页即可使用。', features: ['30+ 模板', 'AI 文案配图', '一键导出'], accent: 'linear-gradient(135deg,#6366f1,#06b6d4)', url: 'http://127.0.0.1:5173/', tag: '在线工具', },
    { id: 'video', icon: '🎬', name: '影视快看 · 视频解析', tagline: '粘贴链接就能看，免会员高清直达', desc: 'HTML / CSS / JS 的纯前端影视聚合站：链接一键解析/全网影视搜索/剧集选集/沉浸播放，深色界面适配手机，无需后端与数据库，打开网页即可使用。', features: ['全网解析', '免会员观看', '手机适配'], accent: 'linear-gradient(135deg,#ec4899,#f59e0b)', url: 'http://127.0.0.1:3100/vip.html', tag: '在线工具', },
    { id: 'hotel', icon: '🏨', name: '酒店管理系统', tagline: '从预订到退房结算，全流程在线跑通', desc: 'Spring Boot 3 + Vue3 + MySQL 8 的酒店管理后台：房型/房间/客人/预订/入住/退房/账单一体化，房态自动流转、金额自动核算，首次启动自动生成演示数据，前端已打进 jar。', features: ['房态流转', '自动算价', '真实可体验'], accent: 'linear-gradient(135deg,#0f766e,#2563eb)', badge: '✨ 新品', newSince: '2026-11-08T00:00:00+08:00', url: 'http://127.0.0.1:8080/', tag: '全栈项目', },
  ];
  const st = await Api.worksStatus();
  const hotD = await Api.worksHot();
  const hotId = hotD.hot || '';
  const wl = await Api.workLikes();
  const likes = wl.likes || {};
  const liked = wl.liked || [];
  const isNew = w => !!(w.newSince && Date.now() - new Date(w.newSince).getTime() < 3 * 864e5);
  /* 热门由下单量决定；新品 3 天后自动取消 */
  const badgeOf = w => (hotId === w.id ? '🔥 热门' : (isNew(w) ? w.badge : ''));
  const stateOf = w => {
    if (w.free) return '<span class="work-state free">永久免费</span>';
    const s = st[w.id] || { type: 'free', left: 0 };
    if (s.type === 'vip') return `<span class="work-state vip">✨ 已开通${s.until ? ' · ' + new Date(s.until).toLocaleDateString() + ' 到期' : ' · 剩 ' + s.left + ' 次'}</span>`;
    return `<span class="work-state">免费体验 ${s.left}/1 次</span>`;
  };
  const imp = await Api.showcase().catch(() => []);
  const impRun = imp.filter(s => s.url).length;
  const impState = {
    running: { t: '可在线体验', bg: 'rgba(46,230,168,.16)', fg: '#0ea371' },
    deployed: { t: '已部署 · 待启动', bg: 'rgba(59,130,246,.16)', fg: '#3b82f6' },
    'needs-env': { t: '需本地环境', bg: 'rgba(245,158,11,.18)', fg: '#b45309' },
    error: { t: '启动异常', bg: 'rgba(239,68,68,.14)', fg: '#dc2626' },
    stopped: { t: '已停止', bg: 'rgba(100,116,139,.16)', fg: '#64748b' },
    pending: { t: '未上线', bg: 'rgba(100,116,139,.16)', fg: '#64748b' },
  };
  const modeMap = {
    static: ['静态站点', 'linear-gradient(135deg,#2563eb,#22d3ee)'],
    jar: ['运行包', 'linear-gradient(135deg,#0d9488,#22d3ee)'],
    node: ['Node 应用', 'linear-gradient(135deg,#16a34a,#0ea5e9)'],
    'java-web': ['源码工程', 'linear-gradient(135deg,#7c3aed,#2563eb)'],
  };
  /* imp 作品 slug → works key 映射，确保体验次数限制与展示一致 */
  const impWorkKey = slug => (/^library-system/i.test(slug) ? 'library' : '');
  const impStateOf = s => {
    const key = impWorkKey(s.slug);
    if (!key) return `<span class="work-state">${(modeMap[s.mode] || ['部署包'])[0]}</span>`;
    const ws = st[key] || { type: 'free', left: 0 };
    if (ws.type === 'vip') return `<span class="work-state vip">✨ 已开通${ws.until ? ' · ' + new Date(ws.until).toLocaleDateString() + ' 到期' : ' · 剩 ' + ws.left + ' 次'}</span>`;
    return `<span class="work-state">免费体验 ${ws.left}/1 次</span>`;
  };
  const impCards = imp.filter(s => s.url).map(s => {
      const st2 = impState[s.status] || impState.pending;
      const icon = s.mode === 'static' ? '🌐' : s.mode === 'jar' ? '☕' : s.mode === 'node' ? '🟢' : '🗂️';
      const [, modeAccent] = modeMap[s.mode] || ['部署包', 'linear-gradient(135deg,#475569,#64748b)'];
      const size = s.size >= 1048576 ? (s.size / 1048576).toFixed(1) + ' MB' : s.size >= 1024 ? Math.round(s.size / 1024) + ' KB' : (s.size || 0) + ' B';
      /* running 状态不再显示「可在线体验」角标 */
      const showBadge = !!s.url && s.status !== 'running';
      return `<a class="work-card${showBadge ? ' has-badge' : ''}" href="javascript:void 0" data-imp="${esc(s.slug)}" data-cat="${s.url ? 'run' : 'env'}" style="--accent:${modeAccent}">
        ${showBadge ? `<span class="work-badge" style="background:${st2.bg};color:${st2.fg}">${st2.t}</span>` : ''}
        <div class="work-top">
          <div class="work-icon">${icon}</div>
          <div class="work-info">
            <div class="work-name">${esc(s.title)}</div>
            <div class="work-meta"><span class="work-tag">${esc(s.version || 'v1.0')}</span>${impStateOf(s)}</div>
            <p class="work-tagline">${esc(s.note || '')}</p>
          </div>
        </div>
        <p class="work-desc">${esc(s.desc || '')}</p>
        <div class="work-chips"><span>✦ ${esc(s.stack || '未标注技术栈')}</span><span>✦ ${size}</span></div>
        <div class="work-foot"><span class="work-go">${s.url ? '立即体验 →' : '去下单 →'}</span></div>
      </a>`;
  }).join('');
  // 售货区：把「可体验」里的作品复制一份，只作为可下单商品展示（不提供直接体验）
  const SALE_SLUG = {
    poster: 'ai-poster-app-v1-63895c',
    video: 'video-parse',
    hotel: 'hotel-demo',
    library: 'library-system-v1-68b3d2',
  };
  const SALE_STACK = {
    poster: 'HTML / CSS / JS',
    video: 'HTML / CSS / JS',
    hotel: 'Spring Boot + Vue3 + MySQL',
    library: 'Spring Boot + Vue3 + MySQL',
  };
  /* 售货区每件商品用不同主色，避免所有卡片颜色一致 */
  const SALE_ACCENT = {
    poster: 'linear-gradient(135deg,#6366f1,#06b6d4)',
    video: 'linear-gradient(135deg,#ec4899,#f59e0b)',
    hotel: 'linear-gradient(135deg,#0f766e,#2563eb)',
    library: 'linear-gradient(135deg,#16a34a,#0ea5e9)',
  };
  const saleCopies = works.filter(w => !w.free).map(w => ({
    key: w.id, icon: w.icon, title: w.name, tagline: w.tagline, desc: w.desc,
    stack: SALE_STACK[w.id] || '', slug: SALE_SLUG[w.id] || '', accent: SALE_ACCENT[w.id] || '',
  }));
  saleCopies.push({
    key: 'library', icon: '📚', title: '图书管理系统',
    tagline: '图书/分类/读者/借阅一站式管理',
    desc: 'Spring Boot 3 + Vue3 + MySQL 8 的图书馆管理后台：图书/分类/读者/借阅与逾期统计，首次启动自动生成随机演示数据，前端已打进 jar。',
    stack: SALE_STACK.library, slug: SALE_SLUG.library, accent: SALE_ACCENT.library,
  });
  const saleCards = saleCopies.map(w => `<a class="work-card" href="javascript:void 0" data-sale="${esc(w.slug)}" data-cat="env" style="--accent:${w.accent}">
      <div class="work-top">
        <div class="work-icon">${w.icon}</div>
        <div class="work-info">
          <div class="work-name">${esc(w.title)}</div>
          <div class="work-meta">${hotId === w.key ? '<span class="work-tag" style="color:#f59e0b">🔥 热门</span>' : ''}<span class="work-tag">v1.0</span><span class="work-state">售货区 · 仅下单</span></div>
          <p class="work-tagline">${esc(w.tagline)}</p>
        </div>
      </div>
      <p class="work-desc">${esc(w.desc)}</p>
      <div class="work-chips"><span>✦ ${esc(w.stack)}</span><span>✦ 不可直接体验</span></div>
      <div class="work-foot"><span class="work-go">去下单 →</span></div>
    </a>`).join('');
  app.innerHTML = `<div class="card page-box"><h1>🧰 我的作品</h1><p class="muted">堆码不易，感谢支持！！！</p>
    <div class="wf-bar">
      <button class="wf on" data-f="run">✅ 可体验 ${impRun + works.length}</button>
      <button class="wf" data-f="env">🟡 售货区 ${saleCopies.length}</button>
    </div>
    <div class="works-grid">${impCards}${saleCards}${works.map(w => `<a class="work-card${badgeOf(w) ? ' has-badge' : ''}" href="javascript:void 0" data-id="${w.id}" data-cat="run" style="--accent:${w.accent}">
      ${badgeOf(w) ? `<span class="work-badge">${badgeOf(w)}</span>` : ''}
      <div class="work-top">
        <div class="work-icon">${w.icon}</div>
        <div class="work-info">
          <div class="work-name">${w.name}</div>
          <div class="work-meta"><span class="work-tag">${w.tag}</span>${stateOf(w)}</div>
          <p class="work-tagline">${w.tagline}</p>
        </div>
      </div>
      <p class="work-desc">${w.desc}</p>
      <div class="work-chips">${w.features.map(f => `<span>✦ ${f}</span>`).join('')}</div>
      <div class="work-foot"><span class="work-go">立即体验 →</span><button class="work-like${liked.includes(w.id) ? ' on' : ''}" data-id="${w.id}">❤️ ${likes[w.id] || 0}</button></div></a>`).join('')}</div></div>`;
  document.querySelectorAll('[data-imp]').forEach(c => c.onclick = () => {
    const s = imp.find(x => x.slug === c.dataset.imp);
    if (!s) return;
    if (s.url) {
      const key = impWorkKey(s.slug);
      if (key) { openWork({ id: key, name: s.title, url: s.url }); return; }
      window.open(s.url, '_blank', 'noopener');
      return;
    }
    if (s.status === 'pending') {
      toast('该作品还没上线，可在后台「作品管理」点击「上线体验」');
      return;
    }
    showOrderModal(s);
  });
  document.querySelectorAll('[data-sale]').forEach(c => c.onclick = () => {
    const w = saleCopies.find(x => x.slug === c.dataset.sale);
    if (!w) return;
    showOrderModal({ slug: w.slug, title: w.title, stack: w.stack, version: 'v1.0' });
  });
  const wfApply = k => {
    const cards = [...app.querySelectorAll('.works-grid > .work-card')];
    cards.forEach(el => {
      el.style.display = (k === 'all' || el.dataset.cat === k) ? '' : 'none';
    });
  };
  wfApply('run');
  document.querySelectorAll('.wf').forEach(b => b.onclick = () => {
    document.querySelectorAll('.wf').forEach(x => x.classList.toggle('on', x === b));
    wfApply(b.dataset.f);
  });
  document.querySelectorAll('.work-card[data-id]').forEach(c => c.onclick = () => {
    const w = works.find(x => x.id === c.dataset.id);
    if (!w) return;
    if (w.free) return openWork(w);
    showAdModal(w, () => openWork(w));
  });
  document.querySelectorAll('.work-like').forEach(b => b.onclick = async e => {
    e.preventDefault();
    e.stopPropagation();
    const r = await Api.toggleWorkLike(b.dataset.id);
    if (!r) { toast('请先登录后再点赞'); return; }
    vWorks();
  });
}

function vAbout() {
  app.innerHTML = `<div class="card page-box about-box">
    <h1>👋 关于本站</h1>
    <p>「技术驿站」是一个专注分享实用技术的个人博客。它不追求大而全的技术百科，而是力求成为你在技术旅途中的一个落脚点——累了就来翻翻，总能找到一篇能跑通、能看懂、能用上的文章。</p>
    <h2>📚 内容方向</h2>
    <p>博客覆盖开发者日常涉及的多个技术领域：</p>
    <ul>
      <li><b>前端开发</b>：框架实战、UI 交互、性能优化</li>
      <li><b>后端开发</b>：服务端架构、API 设计、业务逻辑实现</li>
      <li><b>运维部署</b>：CI/CD、服务器配置、容器化实践</li>
      <li><b>数据库</b>：SQL/NoSQL 选型、查询优化、数据建模</li>
      <li><b>计算机网络</b>：协议原理、抓包分析、网络排障</li>
      <li><b>AI 人工智能</b>：模型应用、工具链集成、落地实践</li>
      <li><b>开发工具</b>：编辑器/IDE 技巧、效率工具、自动化脚本</li>
    </ul>
    <p>无论你是刚入门的新手，还是想查漏补缺的老手，都能在这里找到对口的参考内容。</p>
    <h2>🛠 本站功能</h2>
    <p>为了让你读得顺手、找得高效，「技术驿站」内置了以下功能：</p>
    <ul>
      <li><b>全文搜索</b>：快速定位任意关键词，不必翻页回溯</li>
      <li><b>分类与标签筛选</b>：按技术栈或主题聚合文章，按需浏览</li>
      <li><b>文章归档</b>：按时间线梳理全部文章，适合系统性回顾</li>
      <li><b>目录导航</b>：长文也能快速跳转到感兴趣的章节</li>
      <li><b>代码高亮与一键复制</b>：代码块语法高亮，点一下即可复制到本地运行</li>
      <li><b>深色模式</b>：长时间阅读不刺眼，夜间浏览更舒适</li>
      <li><b>评论与留言板</b>：读后有疑问或想法，可以直接交流</li>
      <li><b>RSS 订阅</b>：用你习惯的阅读器追更，不必反复访问站点</li>
      <li><b>移动端适配</b>：手机、平板、桌面均可正常阅读，通勤路上也能看</li>
    </ul>
    <h2>✍️ 写作理念</h2>
    <p><b>把复杂的东西讲简单。</b></p>
    <p>这是「技术驿站」每一篇文章的出发点。具体落地为三条标准：</p>
    <ul>
      <li><b>能跑通的代码</b>：不止贴代码，更给可复现的环境说明和运行步骤</li>
      <li><b>看得懂的图示</b>：用架构图、流程图、对比图把抽象概念具象化</li>
      <li><b>用得上的结论</b>：每篇文末给出明确的实践建议或选型参考，拒绝“仅供参考”式的空话</li>
    </ul>
    <h2>💬 交流与反馈</h2>
    <p>技术之路难免遇到卡点，也常有值得分享的心得。如果你对某篇文章有疑问、发现了笔误，或者单纯想聊聊技术，欢迎前往 <a href="#/guest">留言板</a> 留下你的声音。每一条反馈都是这个“驿站”继续运转的动力。</p>
  </div>`;
}

/* ---------- 登录认证 ---------- */
/* ---------- 登录认证（走 Api，后端在线时会话存 MySQL） ---------- */
const Auth = {
  user() { const u = Api.user(); return u ? u.name : null; },
  isGuest() { return Api.isGuest(); },
  login(name, pass) { return Api.login(name, pass); },
  register(name, pass) { return Api.register(name, pass); },
  guest() { return Api.guestLogin(); },
  logout() { return Api.logout(); }
};

function vAuth() {
  app.innerHTML = `
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-logo">⚡</div>
      <h1 class="auth-title">欢迎回来，程序猿</h1>
      <p class="auth-sub">登录或注册后，即可畅游「技术驿站」🚀</p>
      <div class="auth-tabs">
        <button class="auth-tab on" data-t="login">登 录</button>
        <button class="auth-tab" data-t="reg">注 册</button>
      </div>
      <div class="auth-form">
        <input id="auName" placeholder="👤 账号 / 昵称" maxlength="16" autocomplete="username">
        <input id="auPass" type="password" placeholder="🔒 密码（至少 4 位）" maxlength="24">
        <div class="auth-err" id="auErr"></div>
        <button class="auth-btn" id="auGo">进入驿站</button>
      </div>
      <div class="auth-div"><span>或者</span></div>
      <button class="auth-guest" id="auGuest">🚶 游客登录 · 随便逛逛</button>
      <p class="auth-tip">游客模式无需账号，数据仅保存在本机浏览器中</p>
    </div>
  </div>`;
  let mode = 'login';
  const err = $('#auErr'), go = $('#auGo');
  $$('.auth-tab').forEach(t => t.onclick = () => {
    mode = t.dataset.t;
    $$('.auth-tab').forEach(x => x.classList.toggle('on', x === t));
    go.textContent = mode === 'login' ? '进入驿站' : '注册并进入';
    err.textContent = '';
  });
  const fail = m => { err.textContent = m; err.classList.remove('shake'); void err.offsetWidth; err.classList.add('shake'); };
  const submit = async () => {
    if (go.disabled) return;
    const name = $('#auName').value.trim(), pass = $('#auPass').value;
    if (!name) return fail('请输入账号 / 昵称');
    if (!pass || pass.length < 4) return fail('密码至少 4 位');
    go.disabled = true;
    const label = go.textContent;
    go.textContent = '请稍候…';
    const e = mode === 'login' ? await Auth.login(name, pass) : await Auth.register(name, pass);
    go.disabled = false;
    go.textContent = label;
    if (e) return fail(e);
    afterLogin();
  };
  go.onclick = submit;
  $('#auName').onkeydown = e => { if (e.key === 'Enter') submit(); };
  $('#auPass').onkeydown = e => { if (e.key === 'Enter') submit(); };
  $('#auGuest').onclick = async () => {
    const g = $('#auGuest');
    if (g.disabled) return;
    g.disabled = true; g.textContent = '正在进入…';
    const e = await Auth.guest();
    if (e) { g.disabled = false; g.textContent = '🚶 游客登录 · 随便逛逛'; return fail(e); }
    afterLogin();
  };
  setTimeout(() => $('#auName').focus(), 60);
}

function renderUserChip() {
  const u = Auth.user(), chip = $('#userChip'), out = $('#logoutBtn');
  if (!chip || !out) return;
  if (u) {
    chip.style.display = '';
    chip.textContent = (Auth.isGuest() ? '🚶 ' : '👤 ') + u;
    chip.title = Auth.isGuest() ? '游客模式' : '已登录账号';
    out.style.display = '';
  } else {
    chip.style.display = 'none'; out.style.display = 'none';
  }
}

function afterLogin() {
  renderUserChip();
  route();
  checkCodeReminder();
}

/* ---------- 开通码临期提醒（未兑换 15 天作废，剩 3 天提醒） ---------- */
async function checkCodeReminder() {
  if (!Auth.user() || Auth.isGuest()) return;
  const list = await Api.myCodes().catch(() => []);
  const near = list.filter(c => c.remind);
  if (!near.length) return;
  const minDays = Math.max(0, Math.min(...near.map(c => c.days_left)));
  let el = $('#codeRemind');
  if (!el) {
    el = document.createElement('div');
    el.id = 'codeRemind';
    el.className = 'code-remind';
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      if (e.target.closest('.cr-close')) { el.classList.remove('show'); return; }
      if (e.target.closest('.cr-go')) { el.classList.remove('show'); location.hash = '#/works'; }
    });
  }
  el.innerHTML = `<span class="cr-ico">⏰</span>
    <div class="cr-txt">你有 <b>${near.length}</b> 张开通码将在 <b>${minDays}</b> 天后自动作废<small>生成后 15 天内有效，请尽快到作品页激活</small></div>
    <button class="cr-go" type="button">去激活</button>
    <button class="cr-close" type="button" title="关闭">✕</button>`;
  requestAnimationFrame(() => el.classList.add('show'));
}

/* ---------- 路由 ---------- */
function route() {
  const tb = document.querySelector('.topbar');
  if (!Auth.user()) {
    document.body.classList.add('lock');
    if (tb) tb.style.display = 'none';
    vAuth(); scrollTo(0, 0); return;
  }
  document.body.classList.remove('lock');
  if (tb) tb.style.display = '';
  const h = location.hash.slice(2) || '';
  const [page, arg] = h.split('/');
  $$('#nav a').forEach(a => a.classList.toggle('on',
    (page === '' && a.dataset.nav === 'home') || a.dataset.nav === page));
  $('#nav').classList.remove('open');
  if (page === '') vHome();
  else if (page === 'post') vPost(decodeURIComponent(arg || ''));
  else if (page === 'archive') vArchive();
  else if (page === 'tags') vTags();
  else if (page === 'guest') vGuest();
  else if (page === 'tools') vTools();
  else if (page === 'about') vAbout();
  else if (page === 'works') vWorks();
  else if (page === 'tag') { const t = decodeURIComponent(arg||''); vList(`🏷 标签：${t}`, SORTED.filter(p=>p.tags.includes(t))); }
  else if (page === 'cat') { const c = decodeURIComponent(arg||''); vList(`📂 分类：${c}`, SORTED.filter(p=>p.cat===c)); }
  else vHome();
}
window.addEventListener('hashchange', route);

/* ---------- 智能小精灵 · 小驿 ---------- */
(function initElf() {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <button id="elfBtn" title="智能小精灵 · 小驿">🧚</button>
  <div id="elfPanel" class="elf-panel">
    <div class="elf-head"><b>🧚 小驿</b><small>智能小助手 · 有问必答</small><button id="elfClose" title="关闭">✕</button></div>
    <div class="elf-msgs" id="elfMsgs"></div>
    <div class="elf-chips" id="elfChips"></div>
    <div class="elf-input"><input id="elfText" placeholder="问我点什么吧…" maxlength="100"><button id="elfSend">发送</button></div>
  </div>`;
  document.body.appendChild(wrap);
  const panel = $('#elfPanel'), msgs = $('#elfMsgs'), input = $('#elfText');

  const addMsg = (html, who) => {
    const d = document.createElement('div');
    d.className = 'elf-msg ' + who;
    d.innerHTML = html;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  };

  function elfAnswer(q) {
    const has = (...ks) => ks.some(k => q.toLowerCase().includes(k.toLowerCase()));
    if (has('你好','在吗','hi','hello','嗨','哈喽'))
      return '你好呀！我是小驿 🧚，本站的智能小精灵。我可以帮你：找文章、介绍功能、提供联系方式～试试点击下方快捷问题吧！';
    if (has('联系','微信','咨询','二维码','作者','博主','客服'))
      return '技术咨询微信：<b>_Zc1908</b>（页脚可一键复制）📋<br>也可以到页脚保存二维码图片，微信扫码添加～';
    if (has('搜索','怎么找','查找','检索'))
      return '首页顶部有搜索框 🔍，输入任意关键词（如「AI」「性能」「SQL」）即可全文检索标题、摘要和标签。';
    if (has('标签','技术栈','分类','专题'))
      return '点击顶部导航「<a href="#/tags">技术</a>」可查看全部技术栈，按方向分组，点击彩色标签就能看到相关文章～';
    if (has('归档','历史','时间线','所有文章'))
      return '「<a href="#/archive">归档</a>」页按时间线整理了全部文章，适合系统性回顾 📅';
    if (has('rss','订阅','追更'))
      return '本站支持 RSS 订阅 📡：<a href="rss.xml">rss.xml</a>，用你喜欢的阅读器追更即可。';
    if (has('深色','夜间','暗色','主题','护眼'))
      return '点击右上角的 🌙 按钮即可切换深色模式，夜间阅读更舒适～';
    if (has('评论','留言','回复','交流','反馈'))
      return '每篇文章底部都有评论区，「<a href="#/guest">留言板</a>」也欢迎畅所欲言 💬 发表后 3 分钟内可删除，支持互相回复～';
    if (has('复制代码','代码','高亮'))
      return '文章中的代码块都有语法高亮，点代码块右上角的「复制」按钮即可一键复制 ✅';
    if (has('推荐','有哪些文章','有什么','哪些文章','内容','看看','介绍','都有什么','文章列表')) {
      const top = SORTED.slice(0, 3);
      return '给你推荐几篇热门文章 👇<br>' + top.map(p => `<a href="#/post/${p.slug}">${p.cover} ${esc(p.title)}</a>`).join('<br>') + '<br>也可以去「<a href="#/tags">技术</a>」页按兴趣逛逛～';
    }
    const kw = q.replace(/[吗呢啊呀吧？?！!，,。.、~～\s]/g, '');
    if (kw.length >= 1) {
      const hits = POSTS.filter(p => (p.title + p.summary + p.cat + p.tags.join('')).toLowerCase().includes(kw.toLowerCase())).slice(0, 3);
      if (hits.length) return '找到这些相关文章 👇<br>' + hits.map(p => `<a href="#/post/${p.slug}">${p.cover} ${esc(p.title)}</a>`).join('<br>');
    }
    return '这个我还在学习中 😅 你可以问我：有哪些文章、如何搜索、联系方式、深色模式、RSS 订阅…';
  }

  function send(text) {
    const q = (text || input.value).trim();
    if (!q) return;
    addMsg(esc(q), 'user');
    input.value = '';
    const tip = document.createElement('div');
    tip.className = 'elf-msg bot elf-typing';
    tip.textContent = '小驿正在输入…';
    msgs.appendChild(tip);
    msgs.scrollTop = msgs.scrollHeight;
    setTimeout(() => { tip.remove(); addMsg(elfAnswer(q), 'bot'); }, 450);
  }

  $('#elfBtn').onclick = () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open') && !msgs.children.length) {
      addMsg('你好呀，我是小驿 🧚！<br>本站的问题都可以问我，比如文章推荐、功能用法、联系方式～', 'bot');
    }
  };
  $('#elfClose').onclick = () => panel.classList.remove('open');
  $('#elfSend').onclick = () => send();
  input.onkeydown = e => { if (e.key === 'Enter') send(); };
  const CHIPS = ['有哪些文章？', '如何搜索？', '联系方式', '深色模式', '留言板在哪'];
  $('#elfChips').innerHTML = CHIPS.map(c => `<button>${c}</button>`).join('');
  document.querySelectorAll('#elfChips button').forEach(b => b.onclick = () => send(b.textContent));
})();

/* ---------- 超能力.包仔（豆包风悬浮助手） ---------- */
(function initBao() {
  const BAO_ICON = '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 9c7.7 0 13.5 5.4 13.5 13S31.7 39 24 39 10.5 33.6 10.5 22 16.3 9 24 9z" fill="#fff"/><circle cx="18.8" cy="21.5" r="2.3" fill="#3b82f6"/><circle cx="29.2" cy="21.5" r="2.3" fill="#3b82f6"/><path d="M19.5 27.5c1.5 1.7 3 2.5 4.5 2.5s3-.8 4.5-2.5" stroke="#3b82f6" stroke-width="2.1" stroke-linecap="round"/><path d="M24 9V4.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="24" cy="3" r="1.9" fill="#fff"/></svg>';
  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <button id="baoBtn" title="超能力.包仔">${BAO_ICON}</button>
  <div id="baoPanel" class="bao-panel">
    <div class="elf-head"><b><span class="bao-ic">${BAO_ICON}</span> 超能力.包仔</b><small>豆包同款 · 站内向导</small><button class="bao-go" id="baoGo" title="去豆包官网聊">🚀 问豆包</button><button id="baoClose" title="关闭">✕</button></div>
    <div class="elf-msgs" id="baoMsgs"></div>
    <div class="elf-chips" id="baoChips"></div>
    <div class="elf-input"><input id="baoText" placeholder="问包仔点什么吧…" maxlength="100"><button id="baoSend">发送</button></div>
  </div>`;
  document.body.appendChild(wrap);
  const panel = $('#baoPanel'), msgs = $('#baoMsgs'), input = $('#baoText');
  const DOUBAO = '<a href="https://www.doubao.com/chat/" target="_blank" rel="noopener">🚀 去豆包官网继续聊</a>';

  const addMsg = (html, who) => {
    const d = document.createElement('div');
    d.className = 'elf-msg ' + who;
    d.innerHTML = html;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  };

  function baoAnswer(q) {
    const has = (...ks) => ks.some(k => q.toLowerCase().includes(k.toLowerCase()));
    if (has('你好','在吗','hi','hello','嗨','哈喽','包仔'))
      return '哈喽！我是<b>超能力.包仔</b> 🌱，豆包同款站内小助手～站内问题我包了，超纲的帮你转给正版豆包！';
    if (has('豆包','ai','智能','大模型'))
      return '我是包仔，驻守本站的豆包分身 🌱<br>想聊更深的（写作、代码、学习、脑洞…）？' + DOUBAO;
    if (has('搜索','怎么找','查找','检索'))
      return '首页顶部搜索框 🔍 输入关键词就能全文检索；也可以直接告诉我你想看什么主题，包仔帮你翻～';
    if (has('工具','工具集','编程工具'))
      return '「<a href="#/tools">工具集</a>」收录了 857 个精选在线工具 🧰，JSON、加解密、正则、压缩…随用随走！';
    if (has('作品','海报','视频','解析','应用'))
      return '「<a href="#/works">我的作品</a>」有站长自研的 AI 海报制作和影视解析 🎬，每个账号每件作品可免费体验 1 次～';
    if (has('联系','微信','咨询','二维码','作者','博主','站长','客服'))
      return '站长微信：<b>_Zc1908</b>（页脚可一键复制）📋 报上你的账号名，咨询/开通都快得很～';
    if (has('登录','注册','游客'))
      return '注册一个账号就能解锁全部功能 🔑 也可以选「游客登录」先进来逛逛～';
    if (has('推荐','有哪些文章','有什么','哪些文章','内容','看看','介绍','文章')) {
      const top = SORTED.slice(0, 3);
      return '包仔推荐这几篇 👇<br>' + top.map(p => `<a href="#/post/${p.slug}">${p.cover} ${esc(p.title)}</a>`).join('<br>');
    }
    const kw = q.replace(/[吗呢啊呀吧？?！!，,。.、~～\s]/g, '');
    if (kw.length >= 1) {
      const hits = POSTS.filter(p => (p.title + p.summary + p.cat + p.tags.join('')).toLowerCase().includes(kw.toLowerCase())).slice(0, 3);
      if (hits.length) return '帮你翻到这些 👇<br>' + hits.map(p => `<a href="#/post/${p.slug}">${p.cover} ${esc(p.title)}</a>`).join('<br>');
    }
    return '这题超纲啦 😆 包仔只熟站内事～<br>' + DOUBAO + '，正版豆包啥都会！';
  }

  function send(text) {
    const q = (text || input.value).trim();
    if (!q) return;
    addMsg(esc(q), 'user');
    input.value = '';
    const tip = document.createElement('div');
    tip.className = 'elf-msg bot elf-typing';
    tip.textContent = '包仔正在输入…';
    msgs.appendChild(tip);
    msgs.scrollTop = msgs.scrollHeight;
    setTimeout(() => { tip.remove(); addMsg(baoAnswer(q), 'bot'); }, 450);
  }

  $('#baoBtn').onclick = () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open') && !msgs.children.length) {
      addMsg('你好呀，我是<b>超能力.包仔</b> 🌱！<br>站内问题随便问；想聊大天？点上面「🚀 问豆包」直达官网～', 'bot');
    }
  };
  $('#baoClose').onclick = () => panel.classList.remove('open');
  $('#baoGo').onclick = () => window.open('https://www.doubao.com/chat/', '_blank', 'noopener');
  $('#baoSend').onclick = () => send();
  input.onkeydown = e => { if (e.key === 'Enter') send(); };
  const CHIPS = ['你能干什么？', '推荐文章', '工具集', '联系站长', '问豆包'];
  $('#baoChips').innerHTML = CHIPS.map(c => `<button>${c}</button>`).join('');
  document.querySelectorAll('#baoChips button').forEach(b => b.onclick = () => send(b.textContent));
})();

/* ---------- 启动 ---------- */
$('#logoutBtn').onclick = async () => {
  await Auth.logout();
  const cr = $('#codeRemind'); if (cr) cr.remove();
  renderUserChip(); route();
};
(async () => {
  await Api.boot();
  renderUserChip();
  route();
  checkCodeReminder();
})();
})();
