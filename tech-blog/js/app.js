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
$('#postCount').textContent = POSTS.length;
window.addEventListener('scroll', () => {
  const h = document.documentElement;
  const p = h.scrollTop / (h.scrollHeight - h.clientHeight || 1);
  $('#progress').style.width = (p * 100) + '%';
  $('#toTop').classList.toggle('show', h.scrollTop > 400);
});
$('#toTop').onclick = () => scrollTo({ top: 0, behavior: 'smooth' });

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
  app.innerHTML = `
    <section class="hero"><div class="marquee"><div class="marquee-in"><span>你好！欢迎来到技术驿站，你的支持我的动力 ✦ </span><span>你好！欢迎来到技术驿站，你的支持我的动力 ✦ </span></div></div>
      <p>分享前端、后端、运维、数据库、AI 等领域的实战经验与学习笔记，共 ${POSTS.length} 篇。</p></section>
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
          <input id="cmtName" placeholder="昵称" maxlength="20">
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
  // 复制代码
  $$('.copy-btn').forEach(b => b.onclick = () => {
    const code = b.parentElement.querySelector('code').innerText;
    (navigator.clipboard?.writeText(code) || Promise.reject()).then(
      () => { b.textContent = '已复制 ✓'; setTimeout(()=>b.textContent='复制',1500); },
      () => { b.textContent = '失败'; });
  });
  // 评论（本地存储，发表后 3 分钟内可删除）
  const KEY = 'blog-cmt-' + slug;
  const LKEY = 'blog-liked-' + slug;
  const TTL = 3 * 60 * 1000;
  const draw = () => {
    const list = store.get(KEY, []);
    const liked = store.get(LKEY, []);
    $('#cmtCount').textContent = list.length;
    $('#cmtList').innerHTML = list.map((c, i) => {
      const can = !c.ts || Date.now() - c.ts < TTL;
      const cid = c.ts || ('x' + i + '_');
      const reps = (c.r || []).map((r, j) => {
        const canR = !r.ts || Date.now() - r.ts < TTL;
        const rid = r.ts || ('x' + i + '_' + j);
        return `<div class="cmt reply"><span class="who">${esc(r.n)}</span>${r.to ? `<span class="to">回复 @${esc(r.to)}</span>` : ''}<span class="when">${r.t}</span>${canR ? `<button class="cmt-del" data-i="${i}" data-j="${j}">删除</button>` : ''}<button class="cmt-rep" data-i="${i}" data-to="${esc(r.n).replace(/"/g,'&quot;')}">回复</button><button class="cmt-like${liked.includes(rid) ? ' on' : ''}" data-i="${i}" data-j="${j}">👍 ${r.likes || 0}</button><p class="what">${esc(r.x)}</p></div>`;
      }).join('');
      return `<div class="cmt"><span class="who">${esc(c.n)}</span><span class="when">${c.t}</span>${can ? `<button class="cmt-del" data-i="${i}">删除</button>` : ''}<button class="cmt-rep" data-i="${i}" data-to="">回复</button><button class="cmt-like${liked.includes(cid) ? ' on' : ''}" data-i="${i}">👍 ${c.likes || 0}</button><p class="what">${esc(c.x)}</p>${reps}<div class="rep-form" id="repForm${i}" style="display:none"><input class="rep-name" placeholder="昵称" maxlength="20"><textarea class="rep-text" placeholder="写下你的回复…" maxlength="300"></textarea><button class="btn rep-send" data-i="${i}">发表回复</button></div></div>`;
    }).join('') || '<p class="muted" style="padding:12px 0">还没有评论，来抢沙发～</p>';
    document.querySelectorAll('#cmtList .cmt-like').forEach(b => b.onclick = () => {
      const l2 = store.get(KEY, []);
      const lk = store.get(LKEY, []);
      const i = +b.dataset.i;
      const item = (b.dataset.j != null && b.dataset.j !== '') ? l2[i].r[+b.dataset.j] : l2[i];
      const id = item.ts || ('x' + i + '_' + (b.dataset.j || ''));
      const k = lk.indexOf(id);
      if (k >= 0) { lk.splice(k, 1); item.likes = Math.max(0, (item.likes || 0) - 1); }
      else { lk.push(id); item.likes = (item.likes || 0) + 1; }
      store.set(LKEY, lk);
      store.set(KEY, l2);
      draw();
    });
    document.querySelectorAll('#cmtList .cmt-del').forEach(b => b.onclick = () => {
      if (!confirm('确定删除吗？')) return;
      const l2 = store.get(KEY, []);
      if (b.dataset.j != null && b.dataset.j !== '') l2[+b.dataset.i].r.splice(+b.dataset.j, 1);
      else l2.splice(+b.dataset.i, 1);
      store.set(KEY, l2);
      draw();
    });
    document.querySelectorAll('#cmtList .cmt-rep').forEach(b => b.onclick = () => {
      const f = $('#repForm' + b.dataset.i);
      const open = f.style.display !== 'none';
      document.querySelectorAll('#cmtList .rep-form').forEach(x => x.style.display = 'none');
      if (!open) { f.style.display = 'flex'; f.dataset.to = b.dataset.to || ''; f.querySelector('.rep-text').placeholder = b.dataset.to ? `回复 @${b.dataset.to}…` : '写下你的回复…'; f.querySelector('.rep-name').focus(); }
    });
    document.querySelectorAll('#cmtList .rep-send').forEach(b => b.onclick = () => {
      const f = $('#repForm' + b.dataset.i);
      const n = f.querySelector('.rep-name').value.trim(), x = f.querySelector('.rep-text').value.trim();
      if (!n || !x) { alert('请填写昵称和内容'); return; }
      const l2 = store.get(KEY, []);
      const c = l2[+b.dataset.i];
      c.r = c.r || [];
      c.r.push({ n, x, to: f.dataset.to || '', ts: Date.now(), t: new Date().toLocaleString('zh-CN') });
      store.set(KEY, l2);
      draw();
    });
  };
  $('#cmtBtn').onclick = () => {
    const n = $('#cmtName').value.trim(), x = $('#cmtText').value.trim();
    if (!n || !x) { alert('请填写昵称和内容'); return; }
    const list = store.get(KEY, []);
    list.unshift({ n, x, ts: Date.now(), t: new Date().toLocaleString('zh-CN') });
    store.set(KEY, list);
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
  app.innerHTML = `<div class="card page-box"><h1>💌 留言板</h1>
    <p class="muted" style="margin-bottom:16px">欢迎留下你的足迹、建议或想看的主题～</p>
    <div class="cmt-form">
      <input id="gName" placeholder="昵称" maxlength="20">
      <textarea id="gText" placeholder="写点什么…" maxlength="500"></textarea>
      <button class="btn" id="gBtn">提交留言</button>
    </div>
    <div id="gList"></div></div>`;
  const KEY = 'blog-guest';
  const LKEY = 'blog-liked-guest';
  const TTL = 3 * 60 * 1000;
  const draw = () => {
    const list = store.get(KEY, []);
    const liked = store.get(LKEY, []);
    $('#gList').innerHTML = list.map((c, i) => {
      const can = !c.ts || Date.now() - c.ts < TTL;
      const cid = c.ts || ('x' + i + '_');
      const reps = (c.r || []).map((r, j) => {
        const canR = !r.ts || Date.now() - r.ts < TTL;
        const rid = r.ts || ('x' + i + '_' + j);
        return `<div class="cmt reply"><span class="who">${esc(r.n)}</span>${r.to ? `<span class="to">回复 @${esc(r.to)}</span>` : ''}<span class="when">${r.t}</span>${canR ? `<button class="cmt-del" data-i="${i}" data-j="${j}">删除</button>` : ''}<button class="cmt-rep" data-i="${i}" data-to="${esc(r.n).replace(/"/g,'&quot;')}">回复</button><button class="cmt-like${liked.includes(rid) ? ' on' : ''}" data-i="${i}" data-j="${j}">👍 ${r.likes || 0}</button><p class="what">${esc(r.x)}</p></div>`;
      }).join('');
      return `<div class="cmt"><span class="who">${esc(c.n)}</span><span class="when">${c.t}</span>${can ? `<button class="cmt-del" data-i="${i}">删除</button>` : ''}<button class="cmt-rep" data-i="${i}" data-to="">回复</button><button class="cmt-like${liked.includes(cid) ? ' on' : ''}" data-i="${i}">👍 ${c.likes || 0}</button><p class="what">${esc(c.x)}</p>${reps}<div class="rep-form" id="repForm${i}" style="display:none"><input class="rep-name" placeholder="昵称" maxlength="20"><textarea class="rep-text" placeholder="写下你的回复…" maxlength="300"></textarea><button class="btn rep-send" data-i="${i}">发表回复</button></div></div>`;
    }).join('') || '<p class="muted">还没有留言，来抢沙发～</p>';
    document.querySelectorAll('#gList .cmt-like').forEach(b => b.onclick = () => {
      const l2 = store.get(KEY, []);
      const lk = store.get(LKEY, []);
      const i = +b.dataset.i;
      const item = (b.dataset.j != null && b.dataset.j !== '') ? l2[i].r[+b.dataset.j] : l2[i];
      const id = item.ts || ('x' + i + '_' + (b.dataset.j || ''));
      const k = lk.indexOf(id);
      if (k >= 0) { lk.splice(k, 1); item.likes = Math.max(0, (item.likes || 0) - 1); }
      else { lk.push(id); item.likes = (item.likes || 0) + 1; }
      store.set(LKEY, lk);
      store.set(KEY, l2);
      draw();
    });
    document.querySelectorAll('#gList .cmt-del').forEach(b => b.onclick = () => {
      if (!confirm('确定删除吗？')) return;
      const l2 = store.get(KEY, []);
      if (b.dataset.j != null && b.dataset.j !== '') l2[+b.dataset.i].r.splice(+b.dataset.j, 1);
      else l2.splice(+b.dataset.i, 1);
      store.set(KEY, l2);
      draw();
    });
    document.querySelectorAll('#gList .cmt-rep').forEach(b => b.onclick = () => {
      const f = $('#repForm' + b.dataset.i);
      const open = f.style.display !== 'none';
      document.querySelectorAll('#gList .rep-form').forEach(x => x.style.display = 'none');
      if (!open) { f.style.display = 'flex'; f.dataset.to = b.dataset.to || ''; f.querySelector('.rep-text').placeholder = b.dataset.to ? `回复 @${b.dataset.to}…` : '写下你的回复…'; f.querySelector('.rep-name').focus(); }
    });
    document.querySelectorAll('#gList .rep-send').forEach(b => b.onclick = () => {
      const f = $('#repForm' + b.dataset.i);
      const n = f.querySelector('.rep-name').value.trim(), x = f.querySelector('.rep-text').value.trim();
      if (!n || !x) { alert('请填写昵称和内容'); return; }
      const l2 = store.get(KEY, []);
      const c = l2[+b.dataset.i];
      c.r = c.r || [];
      c.r.push({ n, x, to: f.dataset.to || '', ts: Date.now(), t: new Date().toLocaleString('zh-CN') });
      store.set(KEY, l2);
      draw();
    });
  };
  $('#gBtn').onclick = () => {
    const n = $('#gName').value.trim(), x = $('#gText').value.trim();
    if (!n || !x) { alert('请填写昵称和内容'); return; }
    const list = store.get(KEY, []);
    list.unshift({ n, x, ts: Date.now(), t: new Date().toLocaleString('zh-CN') });
    store.set(KEY, list); $('#gText').value = ''; draw();
  };
  draw();
}

const WORK_PLANS = [
  { k: 'once', n: '单次', p: '¥6', d: '1 次使用', ms: 0 },
  { k: 'week', n: '包周', p: '¥18.88', d: '7 天不限次', ms: 7 * 864e5 },
  { k: 'month', n: '包月', p: '¥59.99', d: '30 天不限次', ms: 30 * 864e5 },
  { k: 'year', n: '包年', p: '¥666', d: '365 天不限次', ms: 365 * 864e5 },
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
const UKEY = 'blog-work-uses', PKEY = 'blog-work-plan';

function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove('show'), 2200);
}

function goWork(url) {
  if (url.startsWith('http')) window.open(url, '_blank', 'noopener');
  else location.hash = url;
}

function openWork(w) {
  if (w.free) return goWork(w.url);
  const plans = store.get(PKEY, {});
  const p = plans[w.id];
  const now = Date.now();
  if (p && ((p.ms && p.until > now) || (!p.ms && p.credits > 0))) {
    if (!p.ms) { p.credits--; store.set(PKEY, plans); toast('已扣减 1 次使用次数'); }
    return goWork(w.url);
  }
  const uses = store.get(UKEY, {});
  const used = uses[w.id] || 0;
  if (used < 3) {
    uses[w.id] = used + 1;
    store.set(UKEY, uses);
    toast(`免费体验第 ${used + 1}/3 次`);
    return goWork(w.url);
  }
  showPayModal(w);
}

function showPayModal(w) {
  const old = document.getElementById('payModal');
  if (old) old.remove();
  const m = document.createElement('div');
  m.id = 'payModal';
  m.className = 'pay-mask';
  m.innerHTML = `<div class="pay-box">
    <button class="pay-x" id="payX">✕</button>
    <h3>🔒 免费体验次数已用完</h3>
    <p class="muted">「${w.name}」已体验 3 次，请选择套餐继续畅用</p>
    <div class="pay-plans">${WORK_PLANS.map((p, i) => `<label class="pay-plan${i === 1 ? ' hot' : ''}"><input type="radio" name="plan" value="${p.k}" ${i === 1 ? 'checked' : ''}>${i === 1 ? '<em>推荐</em>' : ''}<b>${p.n}</b><span class="pay-price">${p.p}</span><small>${p.d}</small></label>`).join('')}</div>
    <div class="pay-tabs"><button class="pay-tab on" data-m="wx">💚 微信支付</button><button class="pay-tab" data-m="ali">💙 支付宝</button></div>
    <div class="pay-qr" id="payQr">
      <img src="img/wechat-pay.png" alt="微信收款码">
      <p class="pay-warn">⚠️ 不支持退款，谢谢合作！！！</p>
    </div>
    <button class="btn pay-getcode" id="getCodeBtn">✅ 我已完成支付，获取开通码</button>
    <div class="pay-gencode" id="genCodeBox" style="display:none">
      <div class="pay-gencode-label">你的专属开通码（仅可使用一次，请立即复制保存）</div>
      <div class="pay-gencode-row"><b id="genCodeText"></b><button class="pay-copy" id="copyCodeBtn">📋 复制</button></div>
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
  const selPlan = () => m.querySelector('input[name=plan]:checked').value;
  const PLAN_PREFIX = { once: '6', week: '18', month: '59', year: '666' };
  $('#getCodeBtn').onclick = () => {
    const plan = selPlan();
    const used = store.get('blog-used-codes', []);
    const issued = store.get('blog-issued-codes', []);
    let code;
    do {
      const d = String(100 + Math.floor(Math.random() * 900));
      const sum = (+d[0] + +d[1] + +d[2]) % 10;
      code = `YZ${PLAN_PREFIX[plan]}-${d}${sum}`;
    } while (used.includes(code) || issued.includes(code));
    issued.push(code);
    store.set('blog-issued-codes', issued);
    $('#genCodeText').textContent = code;
    $('#genCodeBox').style.display = 'block';
    $('#redeemInput').value = code;
    $('#copyCodeBtn').onclick = () => {
      const done = () => { $('#copyCodeBtn').textContent = '已复制 ✓'; setTimeout(() => { $('#copyCodeBtn').textContent = '📋 复制'; }, 1500); };
      try { navigator.clipboard.writeText(code).then(done).catch(() => { fallbackCopy(code); done(); }); }
      catch (_) { fallbackCopy(code); done(); }
    };
    $('#genCodeBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  function fallbackCopy(t) {
    const i = document.createElement('textarea');
    i.value = t;
    document.body.appendChild(i);
    i.select();
    try { document.execCommand('copy'); } catch (_) { }
    i.remove();
  }
  $('#redeemBtn').onclick = () => {
    const code = $('#redeemInput').value.trim().toUpperCase();
    const type = parseCode(code);
    if (!type) { toast('开通码无效，请核对后再试'); return; }
    const usedCodes = store.get('blog-used-codes', []);
    if (usedCodes.includes(code)) { toast('该开通码已被使用，每个码仅限一次'); return; }
    usedCodes.push(code);
    store.set('blog-used-codes', usedCodes);
    const plans = store.get(PKEY, {});
    const now = Date.now();
    const pl = WORK_PLANS.find(x => x.k === type);
    const cur = plans[w.id] || { credits: 0 };
    if (pl.ms) plans[w.id] = { ms: pl.ms, until: Math.max(now, cur.until || 0) + pl.ms };
    else plans[w.id] = { ms: 0, credits: (cur.credits || 0) + 1 };
    store.set(PKEY, plans);
    m.remove();
    toast(`🎉 ${pl.n}套餐开通成功，感谢支持！`);
    goWork(w.url);
  };
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

function vWorks() {
  const works = [
    { id: 'poster', icon: '🎨', name: 'AI 海报制作', desc: '在线海报设计工具：30+ 套精美模板、画布拖拽编辑、AI 智能文案与配图、二维码生成、一键导出 PNG/JPG/PDF。', url: 'https://ai-poster-yizhan.netlify.app/', tag: '在线工具' },
    { id: 'blog', icon: '⚡', name: '技术驿站', desc: '就是本站——专注实用技术的个人博客：11 篇技术长文、全文搜索、深色模式、评论互动、RSS 订阅。', url: '#/', tag: '个人博客', free: true },
  ];
  const LKEY = 'blog-work-likes', SKEY = 'blog-liked-works';
  const likes = store.get(LKEY, {});
  const liked = store.get(SKEY, []);
  const uses = store.get(UKEY, {});
  const plans = store.get(PKEY, {});
  const now = Date.now();
  const stateOf = w => {
    if (w.free) return '<span class="work-state free">永久免费</span>';
    const p = plans[w.id];
    if (p && ((p.ms && p.until > now) || (!p.ms && p.credits > 0))) return `<span class="work-state vip">✨ 已开通${p.ms ? ' · ' + new Date(p.until).toLocaleDateString() + ' 到期' : ' · 剩 ' + p.credits + ' 次'}</span>`;
    return `<span class="work-state">免费体验 ${Math.max(0, 3 - (uses[w.id] || 0))}/3 次</span>`;
  };
  app.innerHTML = `<div class="card page-box"><h1>🧰 我的作品</h1><p class="muted">堆码不易，感谢支持！！！</p>
    <div class="works-grid">${works.map(w => `<a class="work-card" href="javascript:void 0" data-id="${w.id}">
      <div class="work-icon">${w.icon}</div>
      <div class="work-info"><div class="work-name">${w.name}<span class="work-tag">${w.tag}</span>${stateOf(w)}</div>
      <p class="work-desc">${w.desc}</p>
      <div class="work-foot"><span class="work-go">立即体验 →</span><button class="work-like${liked.includes(w.id) ? ' on' : ''}" data-id="${w.id}">❤️ ${likes[w.id] || 0}</button></div></div></a>`).join('')}</div></div>`;
  document.querySelectorAll('.work-card').forEach(c => c.onclick = () => openWork(works.find(x => x.id === c.dataset.id)));
  document.querySelectorAll('.work-like').forEach(b => b.onclick = e => {
    e.preventDefault();
    e.stopPropagation();
    const id = b.dataset.id;
    const lk = store.get(LKEY, {});
    const ld = store.get(SKEY, []);
    const k = ld.indexOf(id);
    if (k >= 0) { ld.splice(k, 1); lk[id] = Math.max(0, (lk[id] || 0) - 1); }
    else { ld.push(id); lk[id] = (lk[id] || 0) + 1; }
    store.set(LKEY, lk);
    store.set(SKEY, ld);
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
const Auth = {
  users() { return store.get('tb_users', []); },
  user() { const s = store.get('tb_session', null); return s ? s.name : null; },
  isGuest() { const s = store.get('tb_session', null); return !!(s && s.guest); },
  login(name, pass) {
    const u = this.users().find(x => x.name === name);
    if (!u) return '账号不存在，请先注册';
    if (u.pass !== pass) return '密码不正确，请重试';
    store.set('tb_session', { name, guest: false });
    return null;
  },
  register(name, pass) {
    if (this.users().some(x => x.name === name)) return '该账号已被注册，请直接登录';
    const us = this.users(); us.push({ name, pass });
    store.set('tb_users', us);
    store.set('tb_session', { name, guest: false });
    return null;
  },
  guest() {
    const name = '游客_' + Math.random().toString(36).slice(2, 6).toUpperCase();
    store.set('tb_session', { name, guest: true });
  },
  logout() { try { localStorage.removeItem('tb_session'); } catch(e){} }
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
  const submit = () => {
    const name = $('#auName').value.trim(), pass = $('#auPass').value;
    if (!name) return fail('请输入账号 / 昵称');
    if (!pass || pass.length < 4) return fail('密码至少 4 位');
    const e = mode === 'login' ? Auth.login(name, pass) : Auth.register(name, pass);
    if (e) return fail(e);
    afterLogin();
  };
  go.onclick = submit;
  $('#auName').onkeydown = e => { if (e.key === 'Enter') submit(); };
  $('#auPass').onkeydown = e => { if (e.key === 'Enter') submit(); };
  $('#auGuest').onclick = () => { Auth.guest(); afterLogin(); };
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

/* ---------- 启动 ---------- */
$('#logoutBtn').onclick = () => { Auth.logout(); renderUserChip(); route(); };
renderUserChip();
route();
})();
