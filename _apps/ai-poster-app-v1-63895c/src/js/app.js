/* ================= 应用层：UI / AI / 存储 / 导出 ================= */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- 设置 ---------- */
const Settings = {
  data: { apiUrl: '', apiKey: '', model: 'gpt-4o-mini', pexelsKey: '', watermarkOn: false, watermarkText: 'Made with AI海报工坊' },
  load() { try { Object.assign(this.data, JSON.parse(localStorage.getItem('aiposter_settings') || '{}')); } catch (e) { } },
  save() { localStorage.setItem('aiposter_settings', JSON.stringify(this.data)); },
};

/* ---------- Toast ---------- */
function toast(msg, ok = true) {
  const t = document.createElement('div');
  t.className = 'toast' + (ok ? '' : ' err');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2200);
}

/* =============================================================
   面板：模板
============================================================= */
function renderTemplatePanel() {
  const box = $('#panel-template');
  box.innerHTML = '';
  const count = document.createElement('div');
  count.className = 'tips'; count.id = 'tplCount';
  box.appendChild(count);
  const chips = document.createElement('div');
  chips.className = 'chips';
  const cats = ['全部', ...TEMPLATE_CATS];
  cats.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'chip' + (i === 0 ? ' on' : '');
    b.textContent = c;
    b.onclick = () => { [...chips.children].forEach(x => x.classList.remove('on')); b.classList.add('on'); renderTplGrid(c); };
    chips.appendChild(b);
  });
  box.appendChild(chips);
  const grid = document.createElement('div');
  grid.className = 'tpl-grid'; grid.id = 'tplGrid';
  box.appendChild(grid);
  renderTplGrid('全部');
}
function renderTplGrid(cat) {
  const grid = $('#tplGrid'); grid.innerHTML = '';
  const list = TMPL.filter(t => cat === '全部' || t.cat === cat);
  $('#tplCount').textContent = `共 ${list.length} 套模板 · 风格聚合自全网主流海报`;
  for (const t of list) {
    const card = document.createElement('div');
    card.className = 'tpl-card';
    const cvs = document.createElement('canvas');
    const tw = 150, th = Math.round(tw * t.h / t.w);
    cvs.width = tw * 2; cvs.height = th * 2;
    cvs.style.height = th + 'px';
    card.appendChild(cvs);
    const cap = document.createElement('div');
    cap.className = 'tpl-cap';
    cap.innerHTML = `<b>${t.name}</b><span>${t.w}×${t.h}</span>`;
    card.appendChild(cap);
    card.onclick = () => applyTemplate(t);
    grid.appendChild(card);
    // 异步渲染缩略图
    setTimeout(() => {
      try {
        const c2 = cvs.getContext('2d');
        const scale = tw * 2 / t.w;
        const draw = () => {
          const scene = { canvas: { w: t.w, h: t.h, bg: clone(t.bg) }, objects: t.els.map(convertTplEl) };
          if (t.bg.t === 'i') scene.canvas.bg._img = t.bg._img;
          Engine.drawScene(c2, scene, scale);
        };
        if (t.bg.t === 'i' && !t.bg._img) Engine.loadImg(t.bg.src).then(im => { t.bg._img = im; draw(); }).catch(() => { draw(); });
        else draw();
      } catch (e) { }
    }, 30);
  }
}
function drawTplPreview(c2, t, scale) {
  const scene = { canvas: clone(t.bg), objects: t.els.map(convertTplEl) };
  Engine.drawScene(c2, scene, scale);
}
/* 模板元素 → 引擎对象 */
function convertTplEl(e) {
  const o = clone(e);
  if (o.t === 'text') {
    if (o.stroke) { o.strokeW = o.stroke.w; o.strokeC = o.stroke.c; delete o.stroke; }
    if (!o.role) {
      // 无角色时按启发式标注，供 AI 一键填充
      o.role = 'body';
    }
  }
  return o;
}
function applyTemplate(t) {
  const bg = clone(t.bg);
  Engine.S.canvas = { w: t.w, h: t.h, bg, texture: 'none', overlay: null };
  if (bg.t === 'i') Engine.loadImg(bg.src).then(im => { Engine.S.canvas.bg._img = im; Engine.render(); }).catch(() => toast('模板背景图加载失败，已用纯色兜底', false));
  Engine.S.objects = t.els.map(convertTplEl).map(o => (o.id = uid(), o));
  Engine.S.objects.forEach(o => { if (o.t === 'text') Engine.measureText(o); });
  for (const o of Engine.S.objects) if (o.src) Engine.loadImg(o.src).then(im => { o._img = im; Engine.render(); }).catch(() => { });
  Engine.S.sel = [];
  Engine.fit(); Engine.setHistBase();
  UI.onSelection(); UI.onLayers();
  toast(`已应用模板「${t.name}」`);
  if (window.innerWidth < 900) UI.closeSheets();
}

/* =============================================================
   面板：文字
============================================================= */
const TEXT_PRESETS = [
  { name: '描边大字', css: { strokeW: 6, strokeC: '#1f1f1f', c: '#fff' } },
  { name: '霓虹发光', css: { c: '#fff', shadow: { c: '#00e5ff', b: 26, y: 0 } } },
  { name: '金色立体', css: { c: '#ffd54f', strokeW: 2, strokeC: '#8a5a00', shadow: { c: 'rgba(0,0,0,.4)', b: 8, y: 6 } } },
  { name: '渐变紫', css: { grad: ['#667eea', '#f107a3'] } },
  { name: '白底色块', css: { bg: { c: '#ffffff', pad: 14, r: 10 }, c: '#111' } },
  { name: '黑底标签', css: { bg: { c: '#111111', pad: 14, r: 999 }, c: '#fff' } },
  { name: '清新阴影', css: { c: '#fff', shadow: { c: 'rgba(0,0,0,.45)', b: 14, y: 5 } } },
  { name: '红色强调', css: { c: '#e63946', b: 1 } },
];
function renderTextPanel() {
  const box = $('#panel-text');
  box.innerHTML = `
    <div class="sec-t">添加文字</div>
    <div class="btn-grid">
      <button data-add="title">大标题</button><button data-add="sub">副标题</button>
      <button data-add="body">正文段落</button><button data-add="vertical">竖排文字</button>
      <button data-add="num">数字大促</button><button data-add="en">英文装饰</button>
    </div>
    <div class="sec-t">艺术字样式（选中后点击）</div>
    <div class="btn-grid" id="styleGrid"></div>
    <div class="sec-t">字体（选中后选择）</div>
    <select id="quickFont" class="inp"></select>
    <div class="sec-t">透明度 / 旋转 快捷</div>
    <div class="row">
      <button class="mini" onclick="UI.act('rot0')">旋转归零</button>
      <button class="mini" onclick="UI.act('center')">水平居中</button>
      <button class="mini" onclick="UI.act('middle')">垂直居中</button>
    </div>`;
  const sg = box.querySelector('#styleGrid');
  TEXT_PRESETS.forEach(p => {
    const b = document.createElement('button');
    b.textContent = p.name;
    b.onclick = () => {
      const o = Engine.getSelObjs()[0];
      if (!o) return toast('请先选中一个元素', false);
      Engine.update(o.id, clone(p.css)); Engine.pushHistory();
    };
    sg.appendChild(b);
  });
  const sel = box.querySelector('#quickFont');
  sel.innerHTML = Object.entries(FONTS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
  sel.onchange = () => {
    const o = Engine.getSelObjs()[0];
    if (!o) return toast('请先选中元素', false);
    Engine.update(o.id, { f: sel.value }); Engine.pushHistory();
  };
  box.querySelectorAll('[data-add]').forEach(b => b.onclick = () => addText(b.dataset.add));
}
function addText(kind) {
  const W = Engine.S.canvas.w, H = Engine.S.canvas.h;
  const base = { t: 'text', x: W * .1, f: 'hei', align: 'left' };
  const map = {
    title: { text: '点击编辑标题', s: Math.round(W * .13), c: '#ffffff', b: 1, w: W * .8, y: H * .12, shadow: { c: 'rgba(0,0,0,.35)', b: 16, y: 6 } },
    sub: { text: '副标题：一句话说清卖点', s: Math.round(W * .05), c: '#ffffff', w: W * .8, y: H * .28 },
    body: { text: '这里是正文内容，\n双击文字即可直接编辑，\n支持多行自动换行。', s: Math.round(W * .04), c: '#ffffff', w: W * .8, y: H * .45, lh: 1.7 },
    vertical: { text: '竖排文字效果', s: Math.round(W * .07), c: '#ffffff', vertical: true, h: H * .4, x: W * .78, y: H * .12 },
    num: { text: '¥99', s: Math.round(W * .16), c: '#ffe600', b: 1, f: 'impact', w: W * .6, y: H * .6 },
    en: { text: 'AWESOME POSTER', s: Math.round(W * .045), c: '#ffffff', f: 'mono', w: W * .8, y: H * .08 },
  };
  const o = Object.assign(base, map[kind]);
  Engine.add(o);
}

/* =============================================================
   面板：图片（上传 / URL / AI生图 / 网络图库）
============================================================= */
function renderImagePanel() {
  const box = $('#panel-image');
  box.innerHTML = `
    <div class="sec-t">本地上传</div>
    <button class="pri" id="upBtn">📷 选择本地图片</button>
    <input type="file" id="upInput" accept="image/*" multiple hidden>
    <div class="sec-t">网络图片 URL</div>
    <input class="inp" id="urlInp" placeholder="粘贴任意网页图片链接…">
    <button class="pri ghost" id="urlBtn">添加到画布</button>
    <div class="sec-t">AI 生成图片</div>
    <input class="inp" id="aiImgInp" placeholder="描述想要的画面，如：赛博朋克城市夜景">
    <div class="row">
      <select class="inp" id="aiImgSize" style="flex:1">
        <option value="auto">尺寸随画布</option>
        <option value="square_hd">方形 1:1</option>
        <option value="portrait_4_3">竖版 3:4</option>
        <option value="portrait_16_9">竖版 9:16</option>
        <option value="landscape_4_3">横版 4:3</option>
        <option value="landscape_16_9">横版 16:9</option>
      </select>
    </div>
    <div class="row">
      <button class="pri" id="aiImgBtn" style="flex:1">生成并插入</button>
      <button class="pri ghost" id="aiImgBgBtn" style="flex:1">设为背景</button>
    </div>
    <div class="sec-t">全网图库 · 关键词搜图</div>
    <div class="row">
      <input class="inp" id="kwInp" placeholder="关键词，如 美食 / 城市" style="flex:2">
      <button class="pri ghost" id="kwBtn" style="flex:1">搜图</button>
    </div>
    <div class="tips" id="libTip">默认使用开放图源；在「设置」中填入 Pexels Key 可搜高清正版图。</div>
    <div class="img-grid" id="imgGrid"></div>`;
  box.querySelector('#upBtn').onclick = () => box.querySelector('#upInput').click();
  box.querySelector('#upInput').onchange = e => {
    [...e.target.files].forEach(f => {
      const rd = new FileReader();
      rd.onload = () => addImageObj(rd.result, f.name);
      rd.readAsDataURL(f);
    });
  };
  box.querySelector('#urlBtn').onclick = () => {
    const v = box.querySelector('#urlInp').value.trim();
    if (!v) return; addImageObj(v); box.querySelector('#urlInp').value = '';
  };
  box.querySelector('#aiImgBtn').onclick = () => aiGenImage(box, false);
  box.querySelector('#aiImgBgBtn').onclick = () => aiGenImage(box, true);
  box.querySelector('#kwBtn').onclick = () => searchWebImages(box.querySelector('#kwInp').value.trim());
  // 支持粘贴图片 / 拖拽图片
  box.querySelector('#upInput').value = '';
}
function addImageObj(src, name) {
  const W = Engine.S.canvas.w;
  Engine.loadImg(src).then(im => {
    const maxW = W * .7;
    const s = Math.min(1, maxW / im.naturalWidth);
    Engine.add({ t: 'img', src, name: name || '图片', x: (W - im.naturalWidth * s) / 2, y: Engine.S.canvas.h * .2, w: Math.round(im.naturalWidth * s), h: Math.round(im.naturalHeight * s), _img: im, r: 0 });
    toast('图片已添加');
  }).catch(() => toast('图片加载失败（可能有跨域限制）', false));
}
function imgSizeFor(ratio, preset) {
  if (preset && preset !== 'auto') return preset;
  const r = Engine.S.canvas.w / Engine.S.canvas.h;
  if (r > 1.2) return r > 1.6 ? 'landscape_16_9' : 'landscape_4_3';
  if (r < 0.85) return r < 0.65 ? 'portrait_16_9' : 'portrait_4_3';
  return 'square_hd';
}
function aiGenImage(box, asBg) {
  const prompt = box.querySelector('#aiImgInp').value.trim();
  if (!prompt) return toast('先描述一下想要的画面', false);
  const size = imgSizeFor(0, box.querySelector('#aiImgSize').value);
  const url = `https://trae-api-cn.mchost.guru/api/ide/v1/tool_text_to_image?prompt=${encodeURIComponent(prompt)}&image_size=${size}`;
  toast('AI 生成中，约 5-15 秒…');
  box.querySelector('#aiImgBtn').disabled = box.querySelector('#aiImgBgBtn').disabled = true;
  Engine.loadImg(url).then(im => {
    box.querySelector('#aiImgBtn').disabled = box.querySelector('#aiImgBgBtn').disabled = false;
    if (asBg) { setBgImage(url); return; }
    const W = Engine.S.canvas.w, H = Engine.S.canvas.h;
    const s = Math.min(W * .8 / im.naturalWidth, H * .6 / im.naturalHeight);
    Engine.add({ t: 'img', src: url, name: 'AI生成', x: (W - im.naturalWidth * s) / 2, y: H * .2, w: Math.round(im.naturalWidth * s), h: Math.round(im.naturalHeight * s), _img: im, r: 16 });
    toast('AI 图片已插入');
  }).catch(() => {
    box.querySelector('#aiImgBtn').disabled = box.querySelector('#aiImgBgBtn').disabled = false;
    toast('生成失败，请稍后重试', false);
  });
}
async function searchWebImages(kw) {
  const grid = $('#imgGrid'); grid.innerHTML = '';
  if (Settings.data.pexelsKey) {
    try {
      const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(kw || 'poster')}&per_page=12`, { headers: { Authorization: Settings.data.pexelsKey } });
      const d = await r.json();
      (d.photos || []).forEach(p => grid.appendChild(imgCard(p.src.medium, p.src.large2x || p.src.large)));
      if (!(d.photos || []).length) grid.innerHTML = '<div class="tips">无结果，试试其他关键词</div>';
      return;
    } catch (e) { /* 落到开放图源 */ }
  }
  const seeds = Array.from({ length: 8 }, (_, i) => `${encodeURIComponent(kw || 'random')}-${Math.floor(Math.random() * 9999)}-${i}`);
  seeds.forEach(s => grid.appendChild(imgCard(`https://loremflickr.com/400/300/${encodeURIComponent(kw || 'nature')}?lock=${s.length * 7}`, `https://loremflickr.com/1200/900/${encodeURIComponent(kw || 'nature')}?lock=${s.length * 7}`)));
  grid.appendChild(imgCard(`https://picsum.photos/seed/${kw || 'x'}/400/300`, `https://picsum.photos/seed/${kw || 'x'}/1200/900`));
}
function imgCard(small, full) {
  const d = document.createElement('div');
  d.className = 'img-card';
  d.innerHTML = `<img src="${small}" loading="lazy" alt="">`;
  d.onclick = () => addImageObj(full);
  d.onerror = () => d.remove();
  return d;
}

/* =============================================================
   面板：背景
============================================================= */
const BG_PRESETS = [
  ['#ff512f', '#dd2476', 135], ['#667eea', '#764ba2', 135], ['#f7971e', '#ffd200', 160],
  ['#134e5e', '#71b280', 140], ['#1a2980', '#26d0ce', 130], ['#c31432', '#8e0e2c', 150],
  ['#0f0c29', '#7b2ff7', 150], ['#43cea2', '#185a9d', 140], ['#232526', '#414345', 135],
  ['#ffe0b2', '#ffcc80', 135], ['#141e30', '#3a4a63', 160], ['#f4f6fb', '#dbe4ff', 135],
];
const SIZE_PRESETS = [
  ['手机海报', 1242, 2208], ['公众号首图', 900, 383], ['公众号次图', 383, 383],
  ['小红书竖图', 1242, 1660], ['小红书方图', 1080, 1080], ['朋友圈', 1080, 1920],
  ['电商主图', 800, 800], ['视频封面', 1280, 720], ['A4 纵向', 1240, 1754], ['名片', 900, 540],
];
function renderBgPanel() {
  const box = $('#panel-bg');
  box.innerHTML = `
    <div class="sec-t">画布尺寸</div>
    <div class="chips" id="sizeChips"></div>
    <div class="row" style="margin-top:8px">
      <input class="inp" id="cwInp" type="number" style="flex:1" placeholder="宽">
      <input class="inp" id="chInp" type="number" style="flex:1" placeholder="高">
      <button class="pri ghost" id="sizeBtn">应用</button>
    </div>
    <div class="sec-t">纯色背景</div>
    <input type="color" id="bgSolid" class="color-inp" value="#ffffff">
    <div class="sec-t">渐变背景（预设 / 自定义）</div>
    <div class="grad-grid" id="gradGrid"></div>
    <div class="row">
      <input type="color" id="gc1" class="color-inp" value="#667eea">
      <input type="color" id="gc2" class="color-inp" value="#764ba2">
      <input type="range" id="gAngle" min="0" max="360" value="135" style="flex:1">
      <button class="pri ghost" id="gApply">应用</button>
    </div>
    <div class="sec-t">图片背景</div>
    <button class="pri ghost" id="bgUpBtn">📷 上传背景图</button>
    <input type="file" id="bgUpInput" accept="image/*" hidden>
    <button class="pri ghost" id="bgAiBtn" style="margin-top:8px">✨ AI 生成背景（用图片面板的描述）</button>
    <div class="sec-t">纹理叠加</div>
    <div class="chips" id="texChips"></div>
    <input type="color" id="texColor" class="color-inp" value="rgba(0,0,0,.14)" style="margin-top:8px">
    <div class="sec-t">蒙层（图片背景压暗）</div>
    <input type="range" id="ovlRange" min="0" max="80" value="0">
    <button class="pri ghost danger" id="bgClear" style="margin-top:12px">清除背景（纯白）</button>`;
  // 尺寸
  const chips = box.querySelector('#sizeChips');
  SIZE_PRESETS.forEach(([n, w, h]) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = `${n}`;
    b.onclick = () => { Engine.resizeCanvas(w, h); toast(`画布：${w}×${h}`); };
    chips.appendChild(b);
  });
  box.querySelector('#sizeBtn').onclick = () => {
    const w = +box.querySelector('#cwInp').value, h = +box.querySelector('#chInp').value;
    if (w > 50 && h > 50 && w <= 5000 && h <= 8000) { Engine.resizeCanvas(w, h); toast(`画布：${w}×${h}`); }
    else toast('尺寸不合法', false);
  };
  box.querySelector('#bgSolid').oninput = e => { Engine.S.canvas.bg = { t: 's', c: e.target.value }; Engine.render(); };
  box.querySelector('#bgSolid').onchange = () => Engine.pushHistory();
  const gg = box.querySelector('#gradGrid');
  BG_PRESETS.forEach(([c1, c2, a]) => {
    const d = document.createElement('div');
    d.className = 'grad-item';
    d.style.background = `linear-gradient(${a}deg, ${c1}, ${c2})`;
    d.onclick = () => { Engine.S.canvas.bg = { t: 'g', c1, c2, a }; Engine.render(); Engine.pushHistory(); };
    gg.appendChild(d);
  });
  const applyG = () => {
    Engine.S.canvas.bg = { t: 'g', c1: box.querySelector('#gc1').value, c2: box.querySelector('#gc2').value, a: +box.querySelector('#gAngle').value };
    Engine.render(); Engine.pushHistory();
  };
  box.querySelector('#gApply').onclick = applyG;
  box.querySelector('#bgUpBtn').onclick = () => box.querySelector('#bgUpInput').click();
  box.querySelector('#bgUpInput').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => setBgImage(rd.result);
    rd.readAsDataURL(f);
  };
  box.querySelector('#bgAiBtn').onclick = () => {
    const p = $('#aiImgInp') && $('#aiImgInp').value.trim();
    if (!p) return toast('先在「图片」面板填写 AI 描述', false);
    aiGenImage({ querySelector: s => s === '#aiImgInp' ? $('#aiImgInp') : { value: 'auto' } }, true);
  };
  const texs = ['none', 'noise', 'dots', 'grid', 'lines'];
  const tc = box.querySelector('#texChips');
  texs.forEach(t => {
    const b = document.createElement('button');
    b.className = 'chip' + (t === 'none' ? ' on' : '');
    b.textContent = { none: '无', noise: '噪点', dots: '圆点', grid: '网格', lines: '斜线' }[t];
    b.onclick = () => {
      Engine.S.canvas.texture = t; Engine.render(); Engine.pushHistory();
      [...tc.children].forEach(x => x.classList.remove('on')); b.classList.add('on');
    };
    tc.appendChild(b);
  });
  box.querySelector('#texColor').onchange = e => {
    Engine.S.canvas.textureColor = hexA(e.target.value); Engine.render(); Engine.pushHistory();
  };
  box.querySelector('#ovlRange').oninput = e => {
    const v = +e.target.value;
    Engine.S.canvas.overlay = v ? `rgba(0,0,0,${v / 100})` : null;
    Engine.render();
  };
  box.querySelector('#ovlRange').onchange = () => Engine.pushHistory();
  box.querySelector('#bgClear').onclick = () => {
    Engine.S.canvas.bg = { t: 's', c: '#ffffff' }; Engine.S.canvas.overlay = null; Engine.S.canvas.texture = 'none';
    Engine.render(); Engine.pushHistory();
  };
}
function setBgImage(src) {
  Engine.S.canvas.bg = { t: 'i', src };
  Engine.loadImg(src).then(im => { Engine.S.canvas.bg._img = im; Engine.render(); Engine.pushHistory(); toast('背景已设置'); }).catch(() => toast('背景图加载失败', false));
}
function hexA(hex) { // #rrggbb → rgba(.15)
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},.14)`;
}

/* =============================================================
   面板：贴纸 / 组件 / 配色
============================================================= */
function renderStickerPanel() {
  const box = $('#panel-sticker');
  box.innerHTML = '';
  for (const [cat, list] of Object.entries(EMOJI)) {
    const t = document.createElement('div'); t.className = 'sec-t'; t.textContent = cat;
    box.appendChild(t);
    const g = document.createElement('div'); g.className = 'emoji-grid';
    list.forEach(ch => {
      const b = document.createElement('button');
      b.textContent = ch;
      b.onclick = () => {
        const W = Engine.S.canvas.w;
        Engine.add({ t: 'emoji', ch, s: Math.round(W * .1), w: Math.round(W * .14), h: Math.round(W * .14), x: W * .42, y: Engine.S.canvas.h * .3 });
      };
      g.appendChild(b);
    });
    box.appendChild(g);
  }
}
function qrSrc(content, color) {
  // 本地离线生成二维码（makeQrSrc 定义在 data.js）
  return makeQrSrc(content || 'https://example.com', 400, color || '#000000', '#ffffff');
}
function renderCompPanel() {
  const box = $('#panel-comp');
  box.innerHTML = `
    <div class="sec-t">营销组件（点击添加到画布中央）</div>
    <div class="btn-grid">
      <button data-c="coupon">🎟️ 优惠券</button><button data-c="price">🏷️ 价格标签</button>
      <button data-c="follow">🔔 关注引导条</button><button data-c="qr">🔲 二维码</button>
    </div>
    <div class="sec-t">优惠券参数</div>
    <input class="inp" id="cpAmount" placeholder="金额，如 50" value="50">
    <input class="inp" id="cpCond" placeholder="使用条件" value="满 300 可用">
    <input class="inp" id="cpBtn" placeholder="按钮文字" value="立即领取">
    <div class="sec-t">价格标签参数</div>
    <input class="inp" id="prPrice" placeholder="现价" value="99">
    <input class="inp" id="prOrig" placeholder="原价（可空）" value="¥199">
    <input class="inp" id="prTag" placeholder="角标（可空）" value="限时">
    <div class="sec-t">二维码内容</div>
    <input class="inp" id="qrContent" placeholder="链接或文本" value="https://example.com">`;
  const W = () => Engine.S.canvas.w;
  const cx = () => (Engine.S.canvas.w - 560) / 2, cy = () => Engine.S.canvas.h * .6;
  box.querySelectorAll('[data-c]').forEach(b => b.onclick = () => {
    const k = b.dataset.c;
    if (k === 'coupon') Engine.add({ t: 'coupon', x: cx(), y: cy(), w: 560, h: 160, amount: box.querySelector('#cpAmount').value, cond: box.querySelector('#cpCond').value, btn: box.querySelector('#cpBtn').value, c: '#e63946', r: 20 });
    if (k === 'price') Engine.add({ t: 'price', x: cx() + 100, y: cy(), w: 300, h: 96, price: box.querySelector('#prPrice').value, orig: box.querySelector('#prOrig').value, tag: box.querySelector('#prTag').value, c: '#e63946', r: 12 });
    if (k === 'follow') Engine.add({ t: 'follow', x: (Engine.S.canvas.w - Math.min(600, W() * .8)) / 2, y: Engine.S.canvas.h * .82, w: Math.min(600, W() * .8), h: 88, text: '点击关注 · 不再迷路', c: '#262626' });
    if (k === 'qr') {
      const content = box.querySelector('#qrContent').value || 'https://example.com';
      const src = qrSrc(content);
      Engine.loadImg(src).then(im => Engine.add({ t: 'qr', src, content, x: (Engine.S.canvas.w - 240) / 2, y: Engine.S.canvas.h * .6, w: 240, h: 240, r: 8, _img: im }));
    }
  });
}
function renderPalettePanel() {
  const box = $('#panel-palette');
  box.innerHTML = `<div class="sec-t">主题配色（点击色块应用到选中元素）</div><div id="palList"></div>
    <div class="sec-t">AI 智能配色</div>
    <div class="row"><input class="inp" id="palTheme" placeholder="主题，如 美食促销" style="flex:2">
    <button class="pri" id="palBtn" style="flex:1">推荐</button></div>
    <div class="tips">推荐后自动高亮匹配色板，并可一键应用到背景。</div><div id="palAi"></div>`;
  const list = box.querySelector('#palList');
  PALETTES.forEach((p, pi) => {
    const row = document.createElement('div');
    row.className = 'pal-row';
    const n = document.createElement('span'); n.className = 'pal-name'; n.textContent = p.name;
    row.appendChild(n);
    p.c.forEach(c => {
      const d = document.createElement('div');
      d.className = 'pal-c'; d.style.background = c;
      d.title = c;
      d.onclick = () => {
        const o = Engine.getSelObjs()[0];
        if (!o) return toast('请先选中元素', false);
        if (o.t === 'text' || o.t === 'rect' || o.t === 'shape' || o.t === 'ell' || o.t === 'line' || o.t === 'tri' || o.t === 'star' || o.t === 'arrow') Engine.update(o.id, { c, grad: null });
        else toast('该元素不支持填充色', false);
      };
      row.appendChild(d);
    });
    const apply = document.createElement('button');
    apply.className = 'mini'; apply.textContent = '设背景';
    apply.onclick = () => {
      Engine.S.canvas.bg = { t: 'g', c1: p.c[0], c2: p.c[1], a: 135 };
      Engine.render(); Engine.pushHistory(); toast('背景已应用配色');
    };
    row.appendChild(apply);
    list.appendChild(row);
  });
  box.querySelector('#palBtn').onclick = () => {
    const th = box.querySelector('#palTheme').value.trim();
    let idx = 11;
    for (const m of THEME_PALETTE) if (m.k.some(k => th.includes(k))) { idx = m.p; break; }
    const row = list.children[idx];
    [...list.children].forEach(r => r.classList.remove('hl'));
    row.classList.add('hl');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(`为你推荐：${PALETTES[idx].name}`);
  };
}

/* =============================================================
   面板：AI
============================================================= */
function renderAiPanel() {
  const box = $('#panel-ai');
  box.innerHTML = `
    <div class="sec-t">✨ AI 一键海报</div>
    <input class="inp" id="aiTheme" placeholder="主题，如：奶茶店冬季上新">
    <div class="row">
      <select class="inp" id="aiCat" style="flex:2">${TEMPLATE_CATS.map(c => `<option>${c}</option>`).join('')}</select>
      <button class="pri" id="aiGoBtn" style="flex:1">生成</button>
    </div>
    <div class="tips">自动完成：文案生成 → 挑选模板 → 智能填充。生成后可自由修改。</div>
    <div class="sec-t">AI 文案生成</div>
    <input class="inp" id="aiCopyTheme" placeholder="主题，如：火锅店周年庆">
    <div class="btn-grid" id="copyBtns">
      <button data-k="title">标题</button><button data-k="sub">副标题</button>
      <button data-k="body">正文</button><button data-k="cta">行动号召</button>
      <button data-k="all">全部文案</button>
    </div>
    <div class="sec-t">AI 接口（可选 · OpenAI 兼容）</div>
    <input class="inp" id="setApi" placeholder="API 地址，如 https://api.xx.com/v1/chat/completions">
    <input class="inp" id="setKey" placeholder="API Key（留空使用本地词库生成）" type="password">
    <input class="inp" id="setModel" placeholder="模型名，如 gpt-4o-mini">
    <div class="row"><button class="pri ghost" id="setSave" style="flex:1">保存接口配置</button></div>
    <div class="tips">不配置时使用内置文案引擎（离线可用）。配置后自动调用大模型生成更优质文案。</div>`;
  box.querySelector('#aiGoBtn').onclick = aiOneClickPoster;
  box.querySelector('#copyBtns').querySelectorAll('button').forEach(b => b.onclick = () => aiFillCopy(b.dataset.k));
  const s = Settings.data;
  box.querySelector('#setApi').value = s.apiUrl; box.querySelector('#setKey').value = s.apiKey; box.querySelector('#setModel').value = s.model;
  box.querySelector('#setSave').onclick = () => {
    s.apiUrl = box.querySelector('#setApi').value.trim();
    s.apiKey = box.querySelector('#setKey').value.trim();
    s.model = box.querySelector('#setModel').value.trim() || 'gpt-4o-mini';
    Settings.save(); toast('AI 接口配置已保存');
  };
}
/* 本地文案引擎 */
function localCopy(theme, cat) {
  const w = WORDS[cat] || WORDS['促销营销'];
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const t = theme || cat;
  return {
    title: pick(w.titles).replaceAll('{t}', t),
    sub: pick(w.subs).replaceAll('{t}', t),
    body: pick(w.bodies).replaceAll('{t}', t),
    cta: pick(w.ctas),
    tags: w.tags.slice(0, 3),
  };
}
async function aiCopy(theme, cat) {
  const fallback = localCopy(theme, cat);
  if (!Settings.data.apiUrl || !Settings.data.apiKey) return fallback;
  try {
    const r = await fetch(Settings.data.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Settings.data.apiKey}` },
      body: JSON.stringify({
        model: Settings.data.model,
        messages: [
          { role: 'system', content: '你是海报文案专家。只输出JSON：{"title":"主标题(<=10字)","sub":"副标题(<=16字)","body":"正文(2-4行,用\\n分隔)","cta":"行动号召(<=6字)","tags":["标签","标签","标签"]}' },
          { role: 'user', content: `海报主题：${theme}；类型：${cat}；风格：吸引眼球、朗朗上口` },
        ],
        temperature: .8,
      }),
    });
    const d = await r.json();
    let txt = d.choices?.[0]?.message?.content || '';
    txt = txt.replace(/```json|```/g, '').trim();
    const j = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    return { title: j.title || fallback.title, sub: j.sub || fallback.sub, body: j.body || fallback.body, cta: j.cta || fallback.cta, tags: j.tags || fallback.tags };
  } catch (e) {
    toast('AI 接口调用失败，已用本地文案兜底', false);
    return fallback;
  }
}
async function aiOneClickPoster() {
  const theme = $('#aiTheme').value.trim() || '新品上市';
  const cat = $('#aiCat').value;
  toast('AI 正在生成海报…');
  const copy = await aiCopy(theme, cat);
  const list = TMPL.filter(t => t.cat === cat);
  const t = list[Math.floor(Math.random() * list.length)] || TMPL[0];
  applyTemplate(t);
  // 智能填充：按字号与内容启发式分配
  const texts = Engine.S.objects.filter(o => o.t === 'text').sort((a, b) => b.s - a.s);
  if (!texts.length) return;
  texts[0].text = copy.title;
  const ctaRe = /立即|马上|扫码|抢|报名|领取|关注|购买|投递|下载|预约|进入|去|GO|→/;
  let subDone = false, bodyDone = false, tagI = 0;
  for (let i = 1; i < texts.length; i++) {
    const o = texts[i];
    if (ctaRe.test(o.text) && o.text.length <= 12) { o.text = copy.cta; continue; }
    if (!bodyDone && (o.text.includes('\n') || o.text.length > 18)) { o.text = copy.body; bodyDone = true; continue; }
    if (!subDone && o.s >= texts[0].s * .3 && o.text.length <= 20 && !bodyDone) { o.text = copy.sub; subDone = true; continue; }
    if (tagI < copy.tags.length && o.text.length <= 8) { o.text = copy.tags[tagI++]; continue; }
  }
  Engine.S.objects.forEach(o => { if (o.t === 'text') Engine.measureText(o); });
  Engine.render(); Engine.pushHistory(); UI.onLayers();
  toast('海报生成完成，双击文字可继续编辑');
}
async function aiFillCopy(kind) {
  const theme = $('#aiCopyTheme').value.trim();
  const cat = $('#aiCat') ? $('#aiCat').value : '促销营销';
  const sel = Engine.getSelObjs()[0];
  const copy = await aiCopy(theme, cat);
  const apply = o => { if (o && o.t === 'text') { o.text = kind === 'title' ? copy.title : kind === 'sub' ? copy.sub : kind === 'body' ? copy.body : copy.cta; Engine.measureText(o); Engine.update(o.id, {}); Engine.pushHistory(); toast('已填充'); } };
  if (kind === 'all') {
    const texts = Engine.S.objects.filter(o => o.t === 'text').sort((a, b) => b.s - a.s);
    if (texts[0]) texts[0].text = copy.title;
    if (texts[1]) texts[1].text = copy.sub;
    const body = texts.find(o => o.text.includes('\n') || o.text.length > 18);
    if (body) body.text = copy.body;
    Engine.S.objects.forEach(o => o.t === 'text' && Engine.measureText(o));
    Engine.render(); Engine.pushHistory(); toast('全部文案已填充');
    return;
  }
  if (!sel) {
    // 无选中：按类型新增
    const W = Engine.S.canvas.w;
    const add = (text, s, y) => Engine.add({ t: 'text', text, s, c: '#fff', w: W * .8, x: W * .1, y });
    if (kind === 'title') add(copy.title, W * .13, Engine.S.canvas.h * .12);
    else if (kind === 'sub') add(copy.sub, W * .05, Engine.S.canvas.h * .3);
    else if (kind === 'body') add(copy.body, W * .04, Engine.S.canvas.h * .45);
    else add(copy.cta, W * .05, Engine.S.canvas.h * .7);
    return;
  }
  apply(sel);
}

/* =============================================================
   属性面板（右侧）
============================================================= */
function renderProps() {
  const box = $('#props');
  const objs = Engine.getSelObjs();
  if (!objs.length) {
    box.innerHTML = `<div class="sec-t">画布</div>
      <div class="tips">未选中元素。点击画布元素进行编辑；双击文字直接改内容。</div>
      <div class="sec-t">画布信息</div>
      <div class="kv"><span>尺寸</span><b>${Engine.S.canvas.w} × ${Engine.S.canvas.h}</b></div>
      <div class="kv"><span>元素数</span><b>${Engine.S.objects.length}</b></div>
      <div class="sec-t">快捷操作</div>
      <div class="btn-grid">
        <button onclick="UI.act('fit')">适应屏幕</button>
        <button onclick="UI.act('grid')">网格线</button>
        <button onclick="UI.act('center')">清空选择</button>
      </div>`;
    return;
  }
  const o = objs[0];
  const multi = objs.length > 1;
  const num = (label, key, step = 1) => `<div class="fld"><label>${label}</label><input type="number" step="${step}" data-k="${key}" value="${Math.round((o[key] || 0) * 10) / 10}"></div>`;
  let html = `<div class="sec-t">${multi ? `已选 ${objs.length} 个元素` : o.t === 'text' ? '文字' : o.t === 'img' ? '图片' : o.t === 'qr' ? '二维码' : o.t === 'coupon' ? '优惠券' : o.t === 'price' ? '价格标签' : o.t === 'follow' ? '关注条' : o.t === 'emoji' ? '贴纸' : '形状'}</div>`;
  html += `<div class="grid2">
    ${num('X', 'x')}${num('Y', 'y')}${num('宽', 'w')}${num('高', 'h')}
    ${num('旋转°', 'rot', 1)}${num('透明度%', 'o', 5)}
  </div>`;
  // 对齐
  html += `<div class="sec-t">对齐（相对画布）</div><div class="btn-grid">
    <button data-al="l">左</button><button data-al="c">水平中</button><button data-al="r">右</button>
    <button data-al="t">上</button><button data-al="m">垂直中</button><button data-al="b">下</button></div>`;
  html += `<div class="sec-t">层级 / 操作</div><div class="btn-grid">
    <button data-op="up">上移一层</button><button data-op="down">下移一层</button>
    <button data-op="top">置顶</button><button data-op="bottom">置底</button>
    <button data-op="dup">复制</button><button data-op="del" class="danger">删除</button></div>`;
  if (o.t === 'text' && !multi) {
    html += `<div class="sec-t">文字内容</div>
      <textarea class="inp" id="pText" rows="3">${o.text}</textarea>
      <div class="row">
        <select class="inp" id="pFont" style="flex:2">${Object.entries(FONTS).map(([k, v]) => `<option value="${k}" ${o.f === k ? 'selected' : ''}>${v.name}</option>`).join('')}</select>
        <input type="number" class="inp" id="pSize" value="${o.s}" style="flex:1" min="8" max="500">
      </div>
      <div class="row">
        <button class="mini" data-tk="b">加粗</button><button class="mini" data-tk="i">斜体</button>
        <button class="mini" data-tk="alignL">左对齐</button><button class="mini" data-tk="alignC">居中</button><button class="mini" data-tk="alignR">右对齐</button>
      </div>
      <div class="grid2">
        <div class="fld"><label>颜色</label><input type="color" id="pColor" value="${o.c && o.c.startsWith('#') ? o.c : '#ffffff'}"></div>
        <div class="fld"><label>渐变2色(可空)</label><input type="color" id="pGrad" value="${(o.grad && o.grad[1]) || '#f107a3'}"></div>
        <div class="fld"><label>行高</label><input type="number" step="0.1" id="pLh" value="${o.lh || 1.4}"></div>
        <div class="fld"><label>字间距</label><input type="number" id="pLs" value="${o.ls || 0}"></div>
        <div class="fld"><label>描边宽</label><input type="number" id="pSw" value="${o.strokeW || 0}"></div>
        <div class="fld"><label>描边色</label><input type="color" id="pSc" value="${o.strokeC || '#000000'}"></div>
      </div>
      <div class="row">
        <button class="mini" data-tk="shadow">投影${o.shadow ? '✓' : ''}</button>
        <button class="mini" data-tk="v">切换竖排${o.vertical ? '✓' : ''}</button>
        <button class="mini" data-tk="bg">底色块${o.bg ? '✓' : ''}</button>
      </div>`;
  }
  if ((o.t === 'img' || o.t === 'qr') && !multi) {
    html += `<div class="sec-t">图片调整</div><div class="grid2">
      <div class="fld"><label>圆角</label><input type="number" id="pR" value="${o.r || 0}"></div>
      <div class="fld"><label>边框宽</label><input type="number" id="pBw" value="${o.border ? o.border.w : 0}"></div>
      <div class="fld"><label>边框色</label><input type="color" id="pBc" value="${o.border ? o.border.c : '#ffffff'}"></div></div>
      <div class="sec-t">滤镜</div>
      <div class="chips" id="filterChips"></div>
      <div class="row" style="margin-top:8px">
        <button class="mini" data-op="circle">裁圆形</button>
        <button class="mini" data-op="fitcover">填充</button>
        <button class="mini" data-op="fitcontain">完整显示</button>
        <button class="mini" data-op="replace">替换图片</button>
      </div>
      <input type="file" id="pReplace" accept="image/*" hidden>`;
  }
  if (o.t === 'shape' || o.t === 'rect' || o.t === 'ell' || o.t === 'tri' || o.t === 'star' || o.t === 'arrow' || o.t === 'line') {
    html += `<div class="sec-t">形状样式</div><div class="grid2">
      <div class="fld"><label>填充色</label><input type="color" id="pColor" value="${o.c && o.c.startsWith('#') ? o.c : '#4d8dff'}"></div>
      <div class="fld"><label>圆角</label><input type="number" id="pR" value="${o.r || 0}"></div>
      <div class="fld"><label>描边宽</label><input type="number" id="pBw" value="${o.stroke ? o.stroke.w : 0}"></div>
      <div class="fld"><label>描边色</label><input type="color" id="pBc" value="${o.stroke ? o.stroke.c : '#000000'}"></div></div>`;
  }
  if (o.t === 'coupon' && !multi) html += `<div class="sec-t">优惠券内容</div>
    <input class="inp" id="cpA" value="${o.amount ?? ''}" placeholder="金额"><input class="inp" id="cpC" value="${o.cond ?? ''}" placeholder="条件"><input class="inp" id="cpB" value="${o.btn ?? ''}" placeholder="按钮">`;
  if (o.t === 'price' && !multi) html += `<div class="sec-t">价格内容</div>
    <input class="inp" id="prP" value="${o.price ?? ''}" placeholder="现价"><input class="inp" id="prO" value="${o.orig ?? ''}" placeholder="原价"><input class="inp" id="prT" value="${o.tag ?? ''}" placeholder="角标">`;
  if (o.t === 'follow' && !multi) html += `<div class="sec-t">关注条文字</div><input class="inp" id="flT" value="${o.text ?? ''}">`;
  if (o.t === 'qr' && !multi) html += `<div class="sec-t">二维码内容</div><input class="inp" id="qrC" value="${o.content ?? ''}"><button class="pri ghost" id="qrUp">更新二维码</button>`;
  box.innerHTML = html;
  // 绑定
  box.querySelectorAll('[data-k]').forEach(inp => {
    inp.onchange = () => {
      const k = inp.dataset.k; let v = +inp.value;
      if (k === 'o') v = clampN(v, 0, 100) / 100;
      objs.forEach(ob => Engine.update(ob.id, { [k]: k === 'o' ? v : v }));
      Engine.pushHistory();
    };
  });
  box.querySelectorAll('[data-al]').forEach(b => b.onclick = () => Engine.alignSel(b.dataset.al));
  box.querySelectorAll('[data-op]').forEach(b => b.onclick = () => propsOp(b.dataset.op, o));
  const t = box.querySelector('#pText');
  if (t) {
    t.oninput = () => { Engine.update(o.id, { text: t.value }, { silent: true }); Engine.render(); };
    t.onchange = () => Engine.pushHistory();
    box.querySelector('#pFont').onchange = e => { Engine.update(o.id, { f: e.target.value }); Engine.pushHistory(); };
    box.querySelector('#pSize').onchange = e => { Engine.update(o.id, { s: clampN(+e.target.value, 8, 500) }); Engine.pushHistory(); };
    box.querySelector('#pColor').oninput = e => { Engine.update(o.id, { c: e.target.value, grad: null }, { silent: true }); Engine.render(); };
    box.querySelector('#pColor').onchange = () => Engine.pushHistory();
    box.querySelector('#pGrad').onchange = e => { Engine.update(o.id, { grad: [o.c || '#667eea', e.target.value] }); Engine.pushHistory(); };
    box.querySelector('#pLh').onchange = e => { Engine.update(o.id, { lh: +e.target.value }); Engine.pushHistory(); };
    box.querySelector('#pLs').onchange = e => { Engine.update(o.id, { ls: +e.target.value }); Engine.pushHistory(); };
    box.querySelector('#pSw').onchange = e => { Engine.update(o.id, { strokeW: +e.target.value }); Engine.pushHistory(); };
    box.querySelector('#pSc').onchange = e => { Engine.update(o.id, { strokeC: e.target.value }); Engine.pushHistory(); };
    box.querySelectorAll('[data-tk]').forEach(b => b.onclick = () => {
      const k = b.dataset.tk;
      if (k === 'b') Engine.update(o.id, { b: !o.b });
      if (k === 'i') Engine.update(o.id, { i: !o.i });
      if (k === 'alignL') Engine.update(o.id, { align: 'left' });
      if (k === 'alignC') Engine.update(o.id, { align: 'center' });
      if (k === 'alignR') Engine.update(o.id, { align: 'right' });
      if (k === 'shadow') Engine.update(o.id, { shadow: o.shadow ? null : { c: 'rgba(0,0,0,.4)', b: 16, y: 6 } });
      if (k === 'v') { Engine.update(o.id, { vertical: !o.vertical }); }
      if (k === 'bg') Engine.update(o.id, { bg: o.bg ? null : { c: '#111111', pad: 12, r: 10 } });
      Engine.pushHistory(); renderProps();
    });
  }
  const img = (o.t === 'img' || o.t === 'qr') && !multi ? box.querySelector('#pR') : null;
  if (img) {
    img.onchange = e => { Engine.update(o.id, { r: +e.target.value }); Engine.pushHistory(); };
    box.querySelector('#pBw').onchange = e => { Engine.update(o.id, { border: +e.target.value ? { w: +e.target.value, c: box.querySelector('#pBc').value } : null }); Engine.pushHistory(); };
    box.querySelector('#pBc').onchange = e => { if (o.border) { Engine.update(o.id, { border: { w: o.border.w, c: e.target.value } }); Engine.pushHistory(); } };
    const filters = [['原图', ''], ['黑白', 'grayscale(1)'], ['复古', 'sepia(.7) contrast(1.1)'], ['冷色', 'hue-rotate(180deg) saturate(1.2)'], ['暖色', 'saturate(1.5) sepia(.25)'], ['高对比', 'contrast(1.5)'], ['模糊', 'blur(3px)'], ['鲜艳', 'saturate(2)']];
    const fc = box.querySelector('#filterChips');
    filters.forEach(([n, f], i) => {
      const b = document.createElement('button');
      b.className = 'chip' + ((o.filter || '') === f ? ' on' : ''); b.textContent = n;
      b.onclick = () => { Engine.update(o.id, { filter: f }); Engine.pushHistory(); [...fc.children].forEach(x => x.classList.remove('on')); b.classList.add('on'); };
      fc.appendChild(b);
    });
    box.querySelector('#pReplace').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { Engine.update(o.id, { src: rd.result, _img: null, circle: false }); Engine.loadImg(rd.result).then(im => { o._img = im; Engine.render(); }); Engine.pushHistory(); };
      rd.readAsDataURL(f);
    };
  }
  const bind = (id, k) => { const el = box.querySelector(id); if (el) el.onchange = () => { Engine.update(o.id, { [k]: el.value }); Engine.pushHistory(); }; };
  if (o.t === 'coupon') { bind('#cpA', 'amount'); bind('#cpC', 'cond'); bind('#cpB', 'btn'); }
  if (o.t === 'price') { bind('#prP', 'price'); bind('#prO', 'orig'); bind('#prT', 'tag'); }
  if (o.t === 'follow') bind('#flT', 'text');
  if (o.t === 'qr') {
    bind('#qrC', 'content');
    const up = box.querySelector('#qrUp');
    if (up) up.onclick = () => {
      const src = qrSrc(o.content);
      Engine.update(o.id, { src }); Engine.loadImg(src).then(im => { o._img = im; Engine.render(); }); Engine.pushHistory();
    };
  }
}
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
function propsOp(op, o) {
  const objs = Engine.getSelObjs();
  switch (op) {
    case 'up': case 'down': case 'top': case 'bottom': Engine.reorder(o.id, op); break;
    case 'dup': Engine.duplicateSelected(); break;
    case 'del': Engine.deleteSelected(); break;
    case 'circle': Engine.update(o.id, { circle: !o.circle }); Engine.pushHistory(); break;
    case 'fitcover': Engine.update(o.id, { fit: 'cover' }); Engine.pushHistory(); break;
    case 'fitcontain': Engine.update(o.id, { fit: 'contain' }); Engine.pushHistory(); break;
    case 'replace': $('#props #pReplace').click(); break;
  }
}

/* =============================================================
   图层面板
============================================================= */
function renderLayers() {
  const box = $('#layers');
  const objs = [...Engine.S.objects].reverse();
  box.innerHTML = objs.length ? '' : '<div class="tips">暂无图层，先从左侧添加内容</div>';
  objs.forEach(o => {
    const row = document.createElement('div');
    row.className = 'layer-row' + (Engine.S.sel.includes(o.id) ? ' on' : '');
    const icon = { text: '🅣', img: '🖼', qr: '🔲', emoji: o.ch || '😀', rect: '▭', shape: '▭', ell: '⬭', line: '─', tri: '△', star: '☆', arrow: '➔', coupon: '🎟', price: '🏷', follow: '🔔' }[o.t] || '▫';
    row.innerHTML = `<span class="ly-ic">${icon}</span><span class="ly-name">${(o.text || o.name || o.content || ({ coupon: '优惠券', price: '价格标签', follow: '关注条' }[o.t]) || o.t).slice(0, 14)}</span>`;
    const eye = document.createElement('button'); eye.textContent = o.hidden ? '🙈' : '👁'; eye.title = '显示/隐藏';
    eye.onclick = e => { e.stopPropagation(); Engine.update(o.id, { hidden: !o.hidden }); Engine.pushHistory(); renderLayers(); };
    const lock = document.createElement('button'); lock.textContent = o.locked ? '🔒' : '🔓'; lock.title = '锁定';
    lock.onclick = e => { e.stopPropagation(); Engine.update(o.id, { locked: !o.locked }); Engine.pushHistory(); renderLayers(); };
    const del = document.createElement('button'); del.textContent = '✕'; del.title = '删除';
    del.onclick = e => { e.stopPropagation(); Engine.select([o.id]); Engine.deleteSelected(); };
    row.append(eye, lock, del);
    row.onclick = () => Engine.select([o.id]);
    box.appendChild(row);
  });
}

/* =============================================================
   文字编辑浮层
============================================================= */
const TextEdit = {
  ta: null, objId: null,
  open(o) {
    this.close();
    if (o.t !== 'text') return;
    this.objId = o.id;
    const stage = $('#stage');
    const ta = document.createElement('textarea');
    ta.id = 'textEdit';
    const r = Engine.screenRectOf(o);
    Object.assign(ta.style, {
      left: r.x + 'px', top: r.y + 'px',
      width: Math.max(r.w, 40) + 'px', height: Math.max(r.h, o.s * 1.6) + 'px',
      font: `700 ${o.s * Engine.S.zoom}px ${(FONTS[o.f] || FONTS.hei).f}`,
      color: o.c || '#000', lineHeight: (o.lh || 1.4),
      textAlign: o.align || 'left',
      transform: o.rot ? `rotate(${o.rot}deg)` : '',
    });
    ta.value = o.text;
    ta.oninput = () => { Engine.update(o.id, { text: ta.value }, { silent: true }); Engine.render(); };
    ta.onblur = () => { Engine.pushHistory(); this.close(); UI.onSelection(); };
    ta.onkeydown = e => { if (e.key === 'Escape') ta.blur(); e.stopPropagation(); };
    stage.appendChild(ta);
    this.ta = ta;
    setTimeout(() => { ta.focus(); ta.select(); }, 30);
  },
  close() { if (this.ta) { this.ta.remove(); this.ta = null; this.objId = null; } },
};

/* =============================================================
   导出 / 项目库 / 撤销撤销UI
============================================================= */
function download(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
}
async function doExport() {
  const fmt = $('#expFmt').value, scale = +$('#expScale').value;
  const wm = Settings.data.watermarkOn && $('#expWm').checked;
  await Engine.ensureLoaded();
  const cnv = Engine.exportCanvas(scale, {
    transparent: fmt === 'png' && $('#expTrans').checked,
    watermark: wm, watermarkText: Settings.data.watermarkText,
  });
  const name = ($('#projName').value || '海报').replace(/[\\/:*?"<>|]/g, '') + `.${fmt}`;
  if (fmt === 'png') download(cnv.toDataURL('image/png'), name);
  else if (fmt === 'jpg') download(cnv.toDataURL('image/jpeg', +$('#expQ').value / 100), name);
  else if (fmt === 'pdf') {
    const pdf = jpegToPdf(cnv.toDataURL('image/jpeg', .92), cnv.width, cnv.height);
    download(URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' })), name.replace('.pdf', '') + '.pdf');
  }
  closeModal('#exportModal');
  toast('导出成功 ✔');
}
function jpegToPdf(dataUrl, wPx, hPx) {
  const bin = atob(dataUrl.split(',')[1]);
  const wpt = Math.round(wPx * .75), hpt = Math.round(hPx * .75);
  const parts = [];
  const offsets = [0];
  let pos = 10; // '%PDF-1.4\n'
  parts.push('%PDF-1.4\n');
  const track = s => { pos += s.length; return s; };
  const objStart = () => offsets.push(pos);
  objStart(); parts.push(track('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'));
  objStart(); parts.push(track('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n'));
  objStart(); parts.push(track(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wpt} ${hpt}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`));
  objStart();
  parts.push(track(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${wPx} /Height ${hPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bin.length} >>\nstream\n`));
  parts.push(bin);
  parts.push(track('\nendstream\nendobj\n'));
  objStart();
  const content = `q ${wpt} 0 0 ${hpt} 0 0 cm /Im0 Do Q`;
  parts.push(track(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`));
  const xrefPos = pos;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  parts.push(xref);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { for (let i = 0; i < p.length; i++) buf[off + i] = p.charCodeAt(i) & 0xff; off += p.length; }
  return buf;
}
/* 项目库 */
const Store = {
  all() { try { return JSON.parse(localStorage.getItem('aiposter_projects') || '{}'); } catch (e) { return {}; } },
  save(id, name, data, thumb) {
    const all = this.all();
    all[id] = { id, name, data, thumb, updated: Date.now() };
    localStorage.setItem('aiposter_projects', JSON.stringify(all));
  },
  remove(id) { const all = this.all(); delete all[id]; localStorage.setItem('aiposter_projects', JSON.stringify(all)); },
};
let currentProjectId = null;
async function saveProject(silent) {
  const id = currentProjectId || ('p' + Date.now().toString(36));
  currentProjectId = id;
  const name = $('#projName').value || '未命名海报';
  try {
    await Engine.ensureLoaded();
    const thumb = Engine.exportCanvas(Math.min(1, 160 / Engine.S.canvas.w)).toDataURL('image/jpeg', .6);
    Store.save(id, name, Engine.serialize(), thumb);
    localStorage.setItem('aiposter_current', id);
    if (!silent) toast('作品已保存 ✔');
  } catch (e) { if (!silent) toast('保存失败：' + e.message, false); }
}
function openProjects() {
  const all = Object.values(Store.all()).sort((a, b) => b.updated - a.updated);
  const grid = $('#projGrid');
  grid.innerHTML = all.length ? '' : '<div class="tips">还没有作品，去创作第一张海报吧！</div>';
  all.forEach(p => {
    const d = document.createElement('div');
    d.className = 'proj-card';
    d.innerHTML = `<img src="${p.thumb}" alt=""><div class="pc-cap"><b>${p.name}</b><span>${new Date(p.updated).toLocaleString()}</span></div>`;
    const ops = document.createElement('div');
    ops.className = 'pc-ops';
    const open = document.createElement('button'); open.textContent = '打开';
    open.onclick = e => {
      e.stopPropagation();
      Engine.load(p.data);
      currentProjectId = p.id; $('#projName').value = p.name;
      closeModal('#projModal'); UI.onSelection(); UI.onLayers();
      toast(`已打开「${p.name}」`);
    };
    const del = document.createElement('button'); del.textContent = '删除'; del.className = 'danger';
    del.onclick = e => { e.stopPropagation(); Store.remove(p.id); openProjects(); toast('已删除'); };
    ops.append(open, del);
    d.appendChild(ops);
    grid.appendChild(d);
  });
  openModal('#projModal');
}
function exportJSON() {
  const data = JSON.stringify({ app: 'ai-poster', version: 1, ...Engine.serialize() });
  download(URL.createObjectURL(new Blob([data], { type: 'application/json' })), ($('#projName').value || '海报') + '.json');
}
function importJSON(file) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result);
      Engine.load(d);
      currentProjectId = null; $('#projName').value = '导入的作品';
      toast('工程导入成功');
    } catch (e) { toast('文件格式不正确', false); }
  };
  rd.readAsText(file);
}

/* ---------- 弹窗 ---------- */
function openModal(sel) { $(sel).classList.add('open'); }
function closeModal(sel) { $(sel).classList.remove('open'); }

/* =============================================================
   UI 总线 & 初始化
============================================================= */
const UI = {
  onSelection: () => { renderProps(); renderLayers(); },
  onLayers: () => renderLayers(),
  act(k) {
    switch (k) {
      case 'fit': Engine.fit(); break;
      case 'grid': Engine.S.showGrid = !Engine.S.showGrid; Engine.render(); break;
      case 'center': Engine.select([]); TextEdit.close(); break;
      case 'rot0': Engine.getSelObjs().forEach(o => Engine.update(o.id, { rot: 0 })); Engine.pushHistory(); break;
      case 'undo': Engine.undo(); break;
      case 'redo': Engine.redo(); break;
      case 'save': saveProject(); break;
      case 'zoomin': setZoom(Engine.S.zoom * 1.2); break;
      case 'zoomout': setZoom(Engine.S.zoom / 1.2); break;
    }
  },
  closeSheets() { $$('.panel').forEach(p => p.classList.remove('open')); $('#sidebar').classList.remove('open'); $('#props').classList.remove('open'); },
};
function setZoom(z) {
  Engine.S.zoom = clampN(z, .05, 5);
  Engine.render(); updateZoomLabel();
}
function updateZoomLabel() { $('#zoomVal').textContent = Math.round(Engine.S.zoom * 100) + '%'; }

function initApp() {
  Settings.load();
  Engine.init($('#cv'), {
    onSelection: () => { renderProps(); renderLayers(); },
    onLayers: () => renderLayers(),
    onHistory: () => { $('#undoBtn').disabled = !Engine.canUndo(); $('#redoBtn').disabled = !Engine.canRedo(); },
    onZoom: () => updateZoomLabel(),
    onEditRequest: o => TextEdit.open(o),
    onAutoSave: (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => saveProject(true), 1200); }; })(),
  });
  // 画布居中基准：fit 由 render 触发前设置
  setTimeout(() => Engine.fit(), 60);

  renderTemplatePanel(); renderTextPanel(); renderImagePanel(); renderBgPanel();
  renderStickerPanel(); renderCompPanel(); renderPalettePanel(); renderAiPanel();
  renderProps(); renderLayers(); updateZoomLabel();

  // 左侧 tab 切换
  $$('#rail button').forEach(b => b.onclick = () => {
    $$('#rail button').forEach(x => x.classList.remove('on')); b.classList.add('on');
    $$('.panel').forEach(p => p.classList.remove('open'));
    const p = $('#panel-' + b.dataset.p);
    p.classList.add('open');
    $('#sidebar').classList.add('open');
    if (window.innerWidth < 900) $('#props').classList.remove('open');
  });
  // 属性面板开合（移动端）
  $('#propsToggle').onclick = () => { $('#props').classList.toggle('open'); $('#sidebar').classList.remove('open'); };
  $('#sidebarClose').onclick = () => UI.closeSheets();

  // 顶栏
  $('#undoBtn').onclick = () => UI.act('undo');
  $('#redoBtn').onclick = () => UI.act('redo');
  $('#zoomOut').onclick = () => UI.act('zoomout');
  $('#zoomIn').onclick = () => UI.act('zoomin');
  $('#zoomFit').onclick = () => UI.act('fit');
  $('#saveBtn').onclick = () => UI.act('save');
  $('#projBtn').onclick = openProjects;
  $('#exportBtn').onclick = () => openModal('#exportModal');
  $('#expDo').onclick = doExport;
  $('#expJson').onclick = exportJSON;
  $('#expImport').onclick = () => $('#importFile').click();
  $('#importFile').onchange = e => { if (e.target.files[0]) importJSON(e.target.files[0]); };
  $('#settingsBtn').onclick = () => {
    $('#wmOn').checked = Settings.data.watermarkOn;
    $('#wmText').value = Settings.data.watermarkText;
    $('#setPexels').value = Settings.data.pexelsKey;
    openModal('#settingsModal');
  };
  $('#settingsSave').onclick = () => {
    Settings.data.watermarkOn = $('#wmOn').checked;
    Settings.data.watermarkText = $('#wmText').value || 'Made with AI海报工坊';
    Settings.data.pexelsKey = $('#setPexels').value.trim();
    Settings.save(); closeModal('#settingsModal'); toast('设置已保存');
  };
  $('#helpBtn').onclick = () => openModal('#helpModal');
  $$('.modal .close, .modal .cancel').forEach(b => b.onclick = e => e.target.closest('.modal').classList.remove('open'));
  $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); }));

  // 新建
  $('#newBtn').onclick = () => {
    if (!confirm('新建将清空当前画布（未保存内容会丢失），继续？')) return;
    Engine.S.canvas = clone(DEFAULT_CANVAS);
    Engine.S.objects = [];
    Engine.S.canvas.bg._img = undefined;
    currentProjectId = null; $('#projName').value = '';
    Engine.fit(); Engine.setHistBase(); UI.onSelection(); UI.onLayers();
  };

  // 键盘快捷键
  window.addEventListener('keydown', e => {
    const inInput = e.target.matches('input,textarea,select') || TextEdit.ta;
    if (inInput) return;
    const c = e.ctrlKey || e.metaKey;
    if (c && e.key === 'z') { e.preventDefault(); e.shiftKey ? Engine.redo() : Engine.undo(); }
    else if (c && e.key === 'y') { e.preventDefault(); Engine.redo(); }
    else if (c && e.key === 's') { e.preventDefault(); saveProject(); }
    else if (c && e.key === 'd') { e.preventDefault(); Engine.duplicateSelected(); }
    else if (c && e.key === 'c' && Engine.S.sel.length) { navigator.clipboard?.writeText(JSON.stringify(Engine.serialize())).catch(() => { }); toast('已复制到剪贴板'); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (Engine.S.sel.length) { e.preventDefault(); Engine.deleteSelected(); } }
    else if (e.key === 'Escape') { TextEdit.close(); Engine.select([]); $$('.modal').forEach(m => m.classList.remove('open')); }
    else if (e.key.startsWith('Arrow') && Engine.S.sel.length) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      const dx = { ArrowLeft: -d, ArrowRight: d }[e.key] || 0, dy = { ArrowUp: -d, ArrowDown: d }[e.key] || 0;
      Engine.getSelObjs().forEach(o => Engine.update(o.id, { x: o.x + dx, y: o.y + dy }, { silent: true }));
      Engine.render(); Engine.pushHistory();
    }
  });

  // 粘贴图片
  window.addEventListener('paste', e => {
    if (TextEdit.ta) return;
    for (const item of e.clipboardData?.items || []) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        const rd = new FileReader();
        rd.onload = () => addImageObj(rd.result, '粘贴图片');
        rd.readAsDataURL(f);
        return;
      }
    }
  });

  // 自动恢复上次作品
  const lastId = localStorage.getItem('aiposter_current');
  const all = Store.all();
  if (lastId && all[lastId]) {
    Engine.load(all[lastId].data);
    currentProjectId = lastId;
    $('#projName').value = all[lastId].name;
  } else {
    // 默认载入一套模板，开箱即用
    applyTemplate(TMPL[0]);
  }
  Engine.setHistBase();
  window.addEventListener('resize', () => Engine.render());
  console.log('%cAI海报工坊 已就绪', 'color:#7b2ff7;font-weight:bold');
}
window.UI = UI;
window.addEventListener('DOMContentLoaded', initApp);

/* build 20261102185137 */