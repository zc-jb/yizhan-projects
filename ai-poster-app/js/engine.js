/* ================= 画布引擎：场景渲染 / 交互 / 历史 ================= */
const Engine = (() => {
  const S = {
    canvas: JSON.parse(JSON.stringify(DEFAULT_CANVAS)),
    objects: [],       // {id,t,x,y,w,h,rot,o(透明度),hidden,locked,name,...}
    sel: [],           // 选中 id 列表
    zoom: 1, panX: 0, panY: 0,
    guides: [],        // 对齐参考线 {axis:'v'|'h', pos}
    showGrid: false,
  };

  let cv, ctx, dpr = 1, hooks = {};
  let history = [], future = [], histLock = false;
  let ptrs = new Map();               // 多指
  let mode = null, startInfo = null;  // 交互状态
  let lastTap = { t: 0, id: null };
  let textPatterns = {};
  let uid = 1;

  /* ---------- 工具 ---------- */
  const nid = () => 'o' + (uid++) + '_' + Math.random().toString(36).slice(2, 6);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const clone = o => JSON.parse(JSON.stringify(o));
  const rad = d => d * Math.PI / 180;

  function loadImg(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = () => { // 降级：不带 CORS 再试一次
        if (img.crossOrigin) {
          const im2 = new Image();
          im2.onload = () => res(im2); im2.onerror = rej; im2.src = src;
        } else rej(new Error('img fail'));
      };
      img.src = src;
    });
  }

  /* ---------- 文本测量与换行 ---------- */
  function fontStr(o, s) {
    const fam = (FONTS[o.f] || FONTS.hei).f;
    const w = o.b ? (FONTS[o.f] && FONTS[o.f].weight || 700) : 400;
    return `${o.i ? 'italic ' : ''}${w} ${s}px ${fam}`;
  }
  function wrapText(c2d, o, size) {
    const txt = String(o.text ?? '');
    if (o.vertical) { // 竖排
      const chars = txt.replace(/\n/g, '');
      const lh = size * 1.2;
      const per = Math.max(1, Math.floor((o.h || 1e6) / lh));
      const cols = Math.max(1, Math.ceil(chars.length / per));
      return { lines: Array.from({ length: cols }, (_, i) => chars.slice(i * per, (i + 1) * per).split('')), lh, vertical: true, w: cols * lh };
    }
    const paras = txt.split('\n');
    if ('letterSpacing' in c2d) c2d.letterSpacing = (o.ls || 0) + 'px';
    const lines = [];
    for (const p of paras) {
      if (!p) { lines.push(''); continue; }
      let cur = '';
      for (const ch of p) {
        const test = cur + ch;
        if (c2d.measureText(test).width > o.w && cur) { lines.push(cur); cur = ch; }
        else cur = test;
      }
      lines.push(cur);
    }
    return { lines, lh: size * (o.lh || 1.4), vertical: false };
  }
  function measureText(o) { // 更新 o.h
    const c2d = measureText._c || (measureText._c = document.createElement('canvas').getContext('2d'));
    c2d.font = fontStr(o, o.s);
    const r = wrapText(c2d, o, o.s);
    const pad = o.bg ? (o.bg.pad || 0) * 2 : 0;
    if (r.vertical) { o.w = r.w + pad; o.h = o.h || Math.min(r.lh * 10, 800); }
    else o.h = r.lines.length * r.lh + pad;
    return o.h;
  }

  /* ---------- 渐变 / 纹理 ---------- */
  function gradOf(c2d, bg, x, y, w, h) {
    if (bg.t === 's') return bg.c;
    const a = rad(bg.a || 135), cx = x + w / 2, cy = y + h / 2, L = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
    const g = c2d.createLinearGradient(cx - Math.cos(a) * L, cy - Math.sin(a) * L, cx + Math.cos(a) * L, cy + Math.sin(a) * L);
    g.addColorStop(0, bg.c1); g.addColorStop(1, bg.c2); return g;
  }
  function pattern(c2d, kind, color) {
    const key = kind + color;
    if (textPatterns[key]) return textPatterns[key];
    const pc = document.createElement('canvas'); pc.width = pc.height = 36;
    const p = pc.getContext('2d'); p.strokeStyle = p.fillStyle = color;
    if (kind === 'dots') { p.beginPath(); p.arc(9, 9, 1.6, 0, 7); p.fill(); p.beginPath(); p.arc(27, 27, 1.6, 0, 7); p.fill(); }
    else if (kind === 'grid') { p.strokeRect(.5, .5, 36, 36); }
    else if (kind === 'lines') { p.lineWidth = 2; p.beginPath(); p.moveTo(-6, 42); p.lineTo(42, -6); p.stroke(); }
    else { for (let i = 0; i < 90; i++) { p.globalAlpha = Math.random() * .35; p.fillRect(Math.random() * 36, Math.random() * 36, 1.4, 1.4); } }
    const pat = c2d.createPattern(pc, 'repeat');
    textPatterns[key] = pat; return pat;
  }

  /* ---------- 场景渲染（主画布/预览/导出共用） ---------- */
  function roundRect(c2d, x, y, w, h, r) {
    r = Math.min(r || 0, w / 2, h / 2);
    c2d.beginPath();
    c2d.moveTo(x + r, y); c2d.arcTo(x + w, y, x + w, y + h, r); c2d.arcTo(x + w, y + h, x, y + h, r);
    c2d.arcTo(x, y + h, x, y, r); c2d.arcTo(x, y, x + w, y, r); c2d.closePath();
  }
  function paint(c2d, o, x, y, w, h) {
    if (o.grad) { const g = c2d.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, o.grad[0]); g.addColorStop(1, o.grad[1]); return g; }
    return o.c;
  }
  function drawObj(c2d, o) {
    if (o.hidden || o.t === 'group') return;
    c2d.save();
    const w = o.w, h = o.h == null ? (o.s ? Math.ceil(o.s * 1.5) : 0) : o.h; // 未测量文字兜底
    c2d.translate(o.x + w / 2, o.y + h / 2);
    if (o.rot) c2d.rotate(rad(o.rot));
    c2d.globalAlpha = o.o == null ? 1 : o.o;
    const x = -w / 2, y = -h / 2;
    try {
      switch (o.t) {
        case 'text': drawText(c2d, o, x, y, w, h); break;
        case 'rect': case 'shape': drawRect(c2d, o, x, y, w, h); break;
        case 'ell': c2d.fillStyle = paint(c2d, o, x, y, w, h); c2d.beginPath();
          if (o.sh) { c2d.ellipse(x + w / 2, y + h / 2, w / 2, h * .22, 0, 0, 7); } else { c2d.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 7); }
          if (o.stroke) { c2d.strokeStyle = o.stroke.c; c2d.lineWidth = o.stroke.w; c2d.stroke(); } c2d.fill(); break;
        case 'line': c2d.strokeStyle = o.c; c2d.lineWidth = o.h;
          c2d.beginPath(); c2d.moveTo(x, y + h / 2); c2d.lineTo(x + w, y + h / 2); c2d.stroke(); break;
        case 'tri': c2d.fillStyle = paint(c2d, o, x, y, w, h); c2d.beginPath(); c2d.moveTo(x + w / 2, y); c2d.lineTo(x + w, y + h); c2d.lineTo(x, y + h); c2d.closePath(); c2d.fill(); break;
        case 'star': drawStar(c2d, o, x, y, w, h); break;
        case 'arrow': drawArrow(c2d, o, x, y, w, h); break;
        case 'img': case 'qr': drawImg(c2d, o, x, y, w, h); break;
        case 'emoji': c2d.font = `${o.s}px serif`; c2d.textAlign = 'center'; c2d.textBaseline = 'middle';
          c2d.fillText(o.ch, 0, 0); break;
        case 'coupon': drawCoupon(c2d, o, x, y, w, h); break;
        case 'price': drawPrice(c2d, o, x, y, w, h); break;
        case 'follow': drawFollow(c2d, o, x, y, w, h); break;
      }
    } catch (e) { /* 单个对象渲染失败不影响整体 */ }
    c2d.restore();
  }
  function drawText(c2d, o, x, y, w, h) {
    c2d.font = fontStr(o, o.s);
    if ('letterSpacing' in c2d) c2d.letterSpacing = (o.ls || 0) + 'px';
    const r = wrapText(c2d, o, o.s);
    if (o.bg) {
      c2d.fillStyle = o.bg.c; const p = o.bg.pad || 0;
      roundRect(c2d, x - p, y - p, w + p * 2, h + p * 2, o.bg.r || 8); c2d.fill();
    }
    if (o.shadow) { c2d.shadowColor = o.shadow.c; c2d.shadowBlur = o.shadow.b || 0; c2d.shadowOffsetY = o.shadow.y || 0; c2d.shadowOffsetX = o.shadow.x || 0; }
    c2d.fillStyle = paint(c2d, o, x, y, w, h);
    c2d.textBaseline = 'top';
    if (r.vertical) {
      c2d.textAlign = 'center';
      const lh = r.lh;
      r.lines.forEach((col, i) => {
        const cx = x + w - lh / 2 - i * lh;
        col.forEach((ch, j) => c2d.fillText(ch, cx, y + j * lh + (o.h - col.length * lh) / 2));
      });
    } else {
      r.lines.forEach((ln, i) => {
        const ly = y + i * r.lh;
        if (o.align === 'center') { c2d.textAlign = 'center'; c2d.fillText(ln, x + w / 2, ly); }
        else if (o.align === 'right') { c2d.textAlign = 'right'; c2d.fillText(ln, x + w, ly); }
        else { c2d.textAlign = 'left'; c2d.fillText(ln, x, ly); }
        if (o.strokeW) { c2d.strokeStyle = o.strokeC || '#000'; c2d.lineWidth = o.strokeW; c2d.lineJoin = 'round'; c2d.strokeText(ln, o.align === 'center' ? x + w / 2 : o.align === 'right' ? x + w : x, ly); }
      });
    }
    c2d.shadowColor = 'transparent';
  }
  function drawRect(c2d, o, x, y, w, h) {
    c2d.fillStyle = paint(c2d, o, x, y, w, h);
    if (o.shadow) { c2d.shadowColor = o.shadow.c; c2d.shadowBlur = o.shadow.b || 0; c2d.shadowOffsetY = o.shadow.y || 0; }
    roundRect(c2d, x, y, w, h, o.r || 0); c2d.fill();
    c2d.shadowColor = 'transparent';
    if (o.stroke) { c2d.strokeStyle = o.stroke.c; c2d.lineWidth = o.stroke.w; roundRect(c2d, x, y, w, h, o.r || 0); c2d.stroke(); }
    if (o.dash) { c2d.strokeStyle = o.dash; c2d.setLineDash([10, 8]); c2d.lineWidth = 2; roundRect(c2d, x + 8, y + 8, w - 16, h - 16, (o.r || 0) - 8); c2d.stroke(); c2d.setLineDash([]); }
  }
  function drawStar(c2d, o, x, y, w, h) {
    const n = o.n || 5, R1 = Math.min(w, h) / 2, R2 = R1 * .45, cx = x + w / 2, cy = y + h / 2;
    c2d.fillStyle = paint(c2d, o, x, y, w, h); c2d.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + i * Math.PI / n, rr = i % 2 ? R2 : R1;
      c2d[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    c2d.closePath(); c2d.fill();
    if (o.stroke) { c2d.strokeStyle = o.stroke.c; c2d.lineWidth = o.stroke.w; c2d.stroke(); }
  }
  function drawArrow(c2d, o, x, y, w, h) {
    const hl = Math.min(h, w * .4), bh = h * .6;
    c2d.fillStyle = paint(c2d, o, x, y, w, h);
    c2d.beginPath();
    c2d.moveTo(x, y + (h - bh) / 2); c2d.lineTo(x + w - hl, y + (h - bh) / 2); c2d.lineTo(x + w - hl, y);
    c2d.lineTo(x + w, y + h / 2); c2d.lineTo(x + w - hl, y + h); c2d.lineTo(x + w - hl, y + (h + bh) / 2); c2d.lineTo(x, y + (h + bh) / 2);
    c2d.closePath(); c2d.fill();
  }
  function drawImg(c2d, o, x, y, w, h) {
    const im = o._img;
    if (o.shadow) { c2d.shadowColor = o.shadow.c; c2d.shadowBlur = o.shadow.b || 0; c2d.shadowOffsetY = o.shadow.y || 0; }
    if (o.circle) { c2d.beginPath(); c2d.ellipse(0, 0, w / 2, h / 2, 0, 0, 7); c2d.clip(); }
    else if (o.r) { roundRect(c2d, x, y, w, h, o.r); c2d.clip(); }
    if (im && im.complete && im.naturalWidth) {
      if (o.filter) c2d.filter = o.filter;
      // cover 填充
      const ir = im.naturalWidth / im.naturalHeight, br = w / h;
      let dw, dh; if (ir > br) { dh = h; dw = h * ir; } else { dw = w; dh = w / ir; }
      const fit = o.fit || 'cover';
      if (fit === 'contain') { const s = Math.min(w / im.naturalWidth, h / im.naturalHeight); dw = im.naturalWidth * s; dh = im.naturalHeight * s; }
      c2d.drawImage(im, -dw / 2, -dh / 2, dw, dh);
      c2d.filter = 'none';
    } else {
      c2d.fillStyle = 'rgba(128,128,128,.25)'; c2d.fillRect(x, y, w, h);
      c2d.fillStyle = '#888'; c2d.font = '14px sans-serif'; c2d.textAlign = 'center'; c2d.fillText('图片加载中…', 0, 0);
    }
    c2d.shadowColor = 'transparent';
    if (o.border) { c2d.strokeStyle = o.border.c; c2d.lineWidth = o.border.w; roundRect(c2d, x, y, w, h, o.r || (o.circle ? Math.min(w, h) / 2 : 0)); c2d.stroke(); }
  }
  function drawCoupon(c2d, o, x, y, w, h) {
    c2d.shadowColor = 'rgba(0,0,0,.18)'; c2d.shadowBlur = 16; c2d.shadowOffsetY = 6;
    c2d.fillStyle = '#fff'; roundRect(c2d, x, y, w, h, 20); c2d.fill(); c2d.shadowColor = 'transparent';
    c2d.fillStyle = o.c || '#e63946';
    const lw = w * .62; roundRect(c2d, x, y, lw, h, 20); c2d.fill();
    c2d.fillStyle = '#fff'; c2d.textAlign = 'left'; c2d.textBaseline = 'alphabetic';
    c2d.font = `900 ${h * .42}px ${FONTS.impact.f}`;
    c2d.fillText(o.unit || '¥', x + 26, y + h * .58);
    c2d.font = `900 ${h * .62}px ${FONTS.impact.f}`;
    c2d.fillText(String(o.amount ?? '50'), x + 26 + h * .45, y + h * .64);
    c2d.font = `500 ${h * .17}px ${FONTS.hei.f}`;
    c2d.fillText(o.cond || '满 300 可用', x + 26, y + h * .84);
    // 分割虚线 + 缺口
    c2d.fillStyle = 'rgba(0,0,0,.08)';
    c2d.setLineDash([6, 6]); c2d.strokeStyle = '#ddd'; c2d.lineWidth = 2;
    c2d.beginPath(); c2d.moveTo(x + lw, y + 10); c2d.lineTo(x + lw, y + h - 10); c2d.stroke(); c2d.setLineDash([]);
    c2d.fillStyle = '#fff';
    const pr = Math.min(o.r || 20, h / 2);
    c2d.beginPath(); c2d.arc(x + lw, y + pr * .6, pr, 0, 7); c2d.fill();
    c2d.beginPath(); c2d.arc(x + lw, y + h - pr * .6, pr, 0, 7); c2d.fill();
    // 右侧按钮
    const bw = w - lw - 24, bh = h * .5;
    c2d.fillStyle = o.c || '#e63946';
    roundRect(c2d, x + lw + 12, y + (h - bh) / 2, bw, bh, bh / 2); c2d.fill();
    c2d.fillStyle = '#fff'; c2d.font = `700 ${bh * .42}px ${FONTS.hei.f}`; c2d.textAlign = 'center';
    c2d.fillText(o.btn || '立即领取', x + lw + 12 + bw / 2, y + h / 2 + bh * .15);
  }
  function drawPrice(c2d, o, x, y, w, h) {
    c2d.fillStyle = o.c || '#e63946';
    roundRect(c2d, x, y, w, h, o.r || 12); c2d.fill();
    c2d.fillStyle = '#fff'; c2d.textBaseline = 'alphabetic';
    c2d.textAlign = 'left';
    c2d.font = `900 ${h * .5}px ${FONTS.impact.f}`;
    c2d.fillText((o.unit || '¥') + (o.price ?? '99'), x + h * .18, y + h * .68);
    if (o.orig) {
      const pw = c2d.measureText((o.unit || '¥') + (o.price ?? '')).width;
      c2d.font = `500 ${h * .26}px ${FONTS.hei.f}`; c2d.fillStyle = 'rgba(255,255,255,.85)';
      const ox = x + h * .28 + pw + h * .18;
      c2d.fillText(o.orig, ox, y + h * .62);
      const ow = c2d.measureText(o.orig).width;
      c2d.strokeStyle = 'rgba(255,255,255,.9)'; c2d.lineWidth = 2;
      c2d.beginPath(); c2d.moveTo(ox, y + h * .53); c2d.lineTo(ox + ow + 4, y + h * .53); c2d.stroke();
    }
    if (o.tag) {
      c2d.fillStyle = 'rgba(0,0,0,.22)';
      roundRect(c2d, x, y, w * .42, h * .3, (o.r || 12)); c2d.fill();
      c2d.fillStyle = '#fff'; c2d.font = `700 ${h * .18}px ${FONTS.hei.f}`; c2d.textAlign = 'center';
      c2d.fillText(o.tag, x + w * .21, y + h * .22);
    }
  }
  function drawFollow(c2d, o, x, y, w, h) {
    c2d.fillStyle = o.c || '#262626';
    roundRect(c2d, x, y, w, h, h / 2); c2d.fill();
    c2d.fillStyle = '#fff';
    c2d.beginPath(); c2d.arc(x + h * .52, y + h / 2, h * .3, 0, 7); c2d.fill();
    c2d.fillStyle = o.c || '#262626'; c2d.font = `700 ${h * .3}px ${FONTS.hei.f}`; c2d.textAlign = 'center';
    c2d.fillText('号', x + h * .52, y + h * .62);
    c2d.fillStyle = '#fff'; c2d.textAlign = 'left'; c2d.font = `700 ${h * .32}px ${FONTS.hei.f}`;
    c2d.fillText(o.text || '点击关注 · 不再迷路', x + h, y + h * .63);
    c2d.font = `400 ${h * .26}px ${FONTS.hei.f}`; c2d.fillStyle = 'rgba(255,255,255,.6)';
    c2d.textAlign = 'right'; c2d.fillText('→', x + w - h * .5, y + h * .62);
  }

  function drawScene(c2d, scene, scale) {
    const W = scene.canvas.w, H = scene.canvas.h;
    c2d.save();
    c2d.scale(scale, scale);
    c2d.beginPath(); c2d.rect(0, 0, W, H); c2d.clip();
    // 背景
    const bg = scene.canvas.bg || { t: 's', c: '#fff' };
    if (bg.t === 'i' && bg._img && bg._img.complete) {
      const im = bg._img, ir = im.naturalWidth / im.naturalHeight, br = W / H;
      let dw, dh; if (ir > br) { dh = H; dw = H * ir; } else { dw = W; dh = W / ir; }
      c2d.drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else if (bg.t === 'g') {
      c2d.fillStyle = gradOf(c2d, bg, 0, 0, W, H);
      c2d.fillRect(0, 0, W, H);
    } else {
      c2d.fillStyle = bg.c || '#2c5364';
      c2d.fillRect(0, 0, W, H);
    }
    if (scene.canvas.texture && scene.canvas.texture !== 'none') {
      c2d.fillStyle = pattern(c2d, scene.canvas.texture, scene.canvas.textureColor || 'rgba(0,0,0,.14)');
      c2d.fillRect(0, 0, W, H);
    }
    if (scene.canvas.overlay) { c2d.fillStyle = scene.canvas.overlay; c2d.fillRect(0, 0, W, H); }
    for (const o of scene.objects) drawObj(c2d, o);
    c2d.restore();
  }

  /* ---------- 视图 ---------- */
  function toWorld(px, py) { return { x: (px - S.panX) / S.zoom, y: (py - S.panY) / S.zoom }; }
  function toScreen(wx, wy) { return { x: wx * S.zoom + S.panX, y: wy * S.zoom + S.panY }; }
  function fit() {
    const box = cv.parentElement.getBoundingClientRect();
    S.zoom = Math.min((box.width - 60) / S.canvas.w, (box.height - 60) / S.canvas.h);
    S.zoom = clamp(S.zoom, .05, 5);
    S.panX = (box.width - S.canvas.w * S.zoom) / 2;
    S.panY = (box.height - S.canvas.h * S.zoom) / 2;
    render();
  }
  function resizeCanvas(w, h) {
    S.canvas.w = Math.round(w); S.canvas.h = Math.round(h);
    fit();
  }

  /* ---------- 命中检测 ---------- */
  function toLocal(o, wx, wy) {
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2, a = -rad(o.rot || 0);
    const dx = wx - cx, dy = wy - cy;
    return { x: dx * Math.cos(a) - dy * Math.sin(a) + o.w / 2, y: dx * Math.sin(a) + dy * Math.cos(a) + o.h / 2 };
  }
  function hitTest(wx, wy) {
    for (let i = S.objects.length - 1; i >= 0; i--) {
      const o = S.objects[i];
      if (o.hidden || o.locked) continue;
      const l = toLocal(o, wx, wy);
      const pad = 4;
      if (l.x < -pad || l.y < -pad || l.x > o.w + pad || l.y > o.h + pad) continue;
      if (o.t === 'ell' && !o.sh) {
        const nx = (l.x - o.w / 2) / (o.w / 2), ny = (l.y - o.h / 2) / (o.h / 2);
        if (nx * nx + ny * ny > 1.08) continue;
      }
      return o;
    }
    return null;
  }
  const HANDLES = [['nw', -1, -1], ['n', 0, -1], ['ne', 1, -1], ['e', 1, 0], ['se', 1, 1], ['s', 0, 1], ['sw', -1, 1], ['w', -1, 0]];
  function handlePositions(o) { // 返回屏幕坐标
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2, a = rad(o.rot || 0);
    const cos = Math.cos(a), sin = Math.sin(a);
    const tr = (lx, ly) => {
      const dx = lx - o.w / 2, dy = ly - o.h / 2;
      const p = toScreen(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos);
      return { ...p, wx: cx + dx * cos - dy * sin, wy: cy + dx * sin + dy * cos };
    };
    const hs = {};
    for (const [k, sx, sy] of HANDLES) hs[k] = tr((sx + 1) * o.w / 2, (sy + 1) * o.h / 2);
    const top = tr(o.w / 2, 0);
    hs.rot = { x: top.x, y: top.y - 28 };
    return hs;
  }

  /* ---------- 选择 / 编辑 ---------- */
  function select(ids) {
    S.sel = ids == null ? [] : (Array.isArray(ids) ? ids : [ids]);
    render(); hooks.onSelection && hooks.onSelection();
  }
  const getSelObjs = () => S.objects.filter(o => S.sel.includes(o.id));
  function add(obj, opts = {}) {
    obj.id = obj.id || nid();
    if (obj.t === 'text') measureText(obj);
    S.objects.push(obj);
    if (!opts.silent) pushHistory();
    if (opts.select !== false) select([obj.id]);
    render();
    return obj;
  }
  function update(id, props, opts = {}) {
    const o = S.objects.find(p => p.id === id); if (!o) return;
    Object.assign(o, props);
    if (o.t === 'text') measureText(o);
    if (!opts.silent) { render(); hooks.onSelection && hooks.onSelection(); }
  }
  function deleteSelected() {
    if (!S.sel.length) return;
    S.objects = S.objects.filter(o => !S.sel.includes(o.id));
    select([]); pushHistory();
  }
  function duplicateSelected() {
    const copies = getSelObjs().map(o => {
      const c = clone(o); c.id = nid();
      const img = c._img; delete c._img;   // 重新加载图片
      if (c.src) loadImg(c.src).then(im => { c._img = im; render(); });
      c.x += 24; c.y += 24;
      return c;
    });
    S.objects.push(...copies);
    select(copies.map(c => c.id)); pushHistory();
  }
  function reorder(id, dir) { // 'up' 'down' 'top' 'bottom'
    const i = S.objects.findIndex(o => o.id === id); if (i < 0) return;
    const [o] = S.objects.splice(i, 1);
    if (dir === 'up') S.objects.splice(Math.min(i + 1, S.objects.length), 0, o);
    else if (dir === 'down') S.objects.splice(Math.max(i - 1, 0), 0, o);
    else if (dir === 'top') S.objects.push(o);
    else S.objects.unshift(o);
    render(); hooks.onLayers && hooks.onLayers(); pushHistory();
  }
  function alignSel(kind) {
    const objs = getSelObjs(); if (!objs.length) return;
    const W = S.canvas.w, H = S.canvas.h;
    for (const o of objs) {
      switch (kind) {
        case 'l': o.x = 0; break; case 'c': o.x = (W - o.w) / 2; break; case 'r': o.x = W - o.w; break;
        case 't': o.y = 0; break; case 'm': o.y = (H - o.h) / 2; break; case 'b': o.y = H - o.h; break;
      }
    }
    render(); pushHistory(); hooks.onSelection && hooks.onSelection();
  }
  function getObj(id) { return S.objects.find(o => o.id === id); }

  /* ---------- 历史 ---------- */
  function snapshot() {
    const s = serialize();
    return JSON.stringify({ canvas: { ...s.canvas, bg: { ...s.canvas.bg, _img: undefined } }, objects: s.objects.map(o => { const c = { ...o }; delete c._img; return c; }) });
  }
  function pushHistory() {
    if (histLock) return;
    history.push(snapshot());
    if (history.length > 60) history.shift();
    future = [];
    hooks.onHistory && hooks.onHistory();
    hooks.onAutoSave && hooks.onAutoSave();
  }
  function restore(json) {
    histLock = true;
    const d = JSON.parse(json);
    S.canvas = d.canvas; S.objects = d.objects;
    if (S.canvas.bg && S.canvas.bg.t === 'i') loadImg(S.canvas.bg.src).then(im => { S.canvas.bg._img = im; render(); });
    for (const o of S.objects) if (o.src) loadImg(o.src).then(im => { o._img = im; render(); });
    select([]);
    histLock = false;
    render(); hooks.onLayers && hooks.onLayers(); hooks.onSelection && hooks.onSelection(); hooks.onHistory && hooks.onHistory();
  }
  function undo() { if (history.length <= 1) return; future.push(history.pop()); restore(history[history.length - 1]); }
  function redo() { if (!future.length) return; const j = future.pop(); history.push(j); restore(j); }

  /* ---------- 序列化 ---------- */
  function serialize() {
    const bg = { ...S.canvas.bg }; delete bg._img;
    return { canvas: { w: S.canvas.w, h: S.canvas.h, bg, texture: S.canvas.texture, textureColor: S.canvas.textureColor, overlay: S.canvas.overlay }, objects: S.objects.map(o => { const c = { ...o }; delete c._img; return c; }) };
  }
  function load(data) {
    S.canvas = JSON.parse(JSON.stringify(data.canvas));
    S.objects = JSON.parse(JSON.stringify(data.objects));
    history = []; future = [];
    S.objects.forEach(o => { if (o.t === 'text' && o.h == null) measureText(o); });
    if (S.canvas.bg && S.canvas.bg.t === 'i') loadImg(S.canvas.bg.src).then(im => { S.canvas.bg._img = im; render(); }).catch(() => { });
    for (const o of S.objects) if (o.src) loadImg(o.src).then(im => { o._img = im; render(); }).catch(() => { });
    fit(); hooks.onLayers && hooks.onLayers(); pushHistory();
  }

  /* ---------- 交互 ---------- */
  function pointerPos(e) {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function init(canvasEl, hooksObj) {
    cv = canvasEl; ctx = cv.getContext('2d'); hooks = hooksObj || {};
    pushHistory(); // 初始基线

    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('dblclick', onDbl);
    new ResizeObserver(() => render()).observe(cv.parentElement);
    render();
  }

  function onDown(e) {
    cv.setPointerCapture(e.pointerId);
    const p = pointerPos(e);
    ptrs.set(e.pointerId, p);
    if (ptrs.size === 2) { // 进入捏合
      const [a, b] = [...ptrs.values()];
      mode = 'pinch';
      startInfo = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: S.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, panX: S.panX, panY: S.panY };
      return;
    }
    if (e.button === 1 || keysDown.space) { mode = 'pan'; startInfo = { px: p.x, py: p.y, panX: S.panX, panY: S.panY }; return; }

    const w = toWorld(p.x, p.y);
    // 手柄命中（单选时）
    if (S.sel.length === 1) {
      const o = getObj(S.sel[0]);
      if (o && !o.locked) {
        const hs = handlePositions(o);
        for (const [k, pt] of Object.entries(hs)) {
          if (Math.hypot(p.x - pt.x, p.y - pt.y) < 14) {
            if (k === 'rot') {
              mode = 'rotate';
              const c = getObj(S.sel[0]);
              startInfo = { handle: k, o: clone(c), cx: c.x + c.w / 2, cy: c.y + c.h / 2, startAngle: Math.atan2(w.y - (c.y + c.h / 2), w.x - (c.x + c.w / 2)) * 180 / Math.PI, startRot: c.rot || 0 };
            } else {
              mode = 'resize';
              startInfo = { handle: k, o: clone(o), cx: o.x + o.w / 2, cy: o.y + o.h / 2 };
            }
            pushHistory();
            return;
          }
        }
      }
    }
    const hit = hitTest(w.x, w.y);
    const now = Date.now();
    if (hit) {
      // 双击进入文本编辑
      if (lastTap.id === hit.id && now - lastTap.t < 350) { hooks.onEditRequest && hooks.onEditRequest(hit); lastTap = { t: 0, id: null }; return; }
      lastTap = { t: now, id: hit.id };
      if (e.shiftKey) {
        select(S.sel.includes(hit.id) ? S.sel.filter(i => i !== hit.id) : [...S.sel, hit.id]);
        mode = null; return;
      }
      if (!S.sel.includes(hit.id)) select([hit.id]);
      mode = 'move';
      startInfo = {
        px: p.x, py: p.y, wx: w.x, wy: w.y,
        objs: getSelObjs().map(o => ({ id: o.id, x: o.x, y: o.y })),
      };
    } else {
      mode = 'pan';
      startInfo = { px: p.x, py: p.y, panX: S.panX, panY: S.panY };
      select([]);
    }
  }
  function snapMove(objs) {
    // 吸附：画布边缘/中心 + 其他对象边缘/中心
    const th = 7 / S.zoom, W = S.canvas.w, H = S.canvas.h;
    let dx = 0, dy = 0; S.guides = [];
    const moving = objs[0];
    const first = S.objects.find(o => o.id === moving.id); if (!first) return { dx: 0, dy: 0 };
    const mv = objs.map(m => S.objects.find(o => o.id === m.id)).filter(Boolean);
    const targetsX = [0, W / 2, W], targetsY = [0, H / 2, H];
    for (const o of S.objects) {
      if (mv.includes(o)) continue;
      targetsX.push(o.x, o.x + o.w / 2, o.x + o.w);
      targetsY.push(o.y, o.y + o.h / 2, o.y + o.h);
    }
    outer:
    for (const m of mv) {
      for (const edge of [m.x, m.x + m.w / 2, m.x + m.w]) {
        for (const t of targetsX) {
          if (Math.abs(edge - t) < th) {
            dx = t - edge; S.guides.push({ axis: 'v', pos: t }); if (S.guides.length > 2) break outer;
          }
        }
      }
      for (const edge of [m.y, m.y + m.h / 2, m.y + m.h]) {
        for (const t of targetsY) {
          if (Math.abs(edge - t) < th) {
            dy = t - edge; S.guides.push({ axis: 'h', pos: t }); if (S.guides.length > 2) break outer;
          }
        }
      }
    }
    return { dx, dy };
  }
  function onMove(e) {
    const p = pointerPos(e);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
    if (mode === 'pinch' && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const z = clamp(startInfo.zoom * d / startInfo.dist, .05, 5);
      const k = z / startInfo.zoom;
      S.zoom = z;
      S.panX = startInfo.cx - (startInfo.cx - startInfo.panX) * k;
      S.panY = startInfo.cy - (startInfo.cy - startInfo.panY) * k;
      render(); return;
    }
    if (mode === 'pan' && startInfo) {
      S.panX = startInfo.panX + p.x - startInfo.px;
      S.panY = startInfo.panY + p.y - startInfo.py;
      render(); return;
    }
    if (!mode || !startInfo) { updateCursor(p); return; }
    const w = toWorld(p.x, p.y);
    if (mode === 'move') {
      let dx = (p.x - startInfo.px) / S.zoom, dy = (p.y - startInfo.py) / S.zoom;
      for (const m of startInfo.objs) {
        const o = S.objects.find(q => q.id === m.id); if (!o) continue;
        o.x = m.x + dx; o.y = m.y + dy;
      }
      const { dx: sx, dy: sy } = snapMove(startInfo.objs);
      for (const m of startInfo.objs) {
        const o = S.objects.find(q => q.id === m.id); if (!o) continue;
        o.x += sx; o.y += sy;
      }
      render(); return;
    }
    if (mode === 'rotate') {
      const o = S.objects.find(q => q.id === S.sel[0]); if (!o) return;
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      let ang = Math.atan2(w.y - cy, w.x - cx) * 180 / Math.PI - startInfo.startAngle + startInfo.startRot;
      if (e.shiftKey) ang = Math.round(ang / 15) * 15;
      o.rot = Math.round(ang * 10) / 10;
      render(); return;
    }
    if (mode === 'resize') {
      const o = S.objects.find(q => q.id === startInfo.o.id); if (!o) return;
      const so = startInfo.o;
      const [, sx, sy] = HANDLES.find(h => h[0] === startInfo.handle);
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2, r = rad(o.rot || 0);
      const cos = Math.cos(r), sin = Math.sin(r);
      const Ax = -sx * so.w / 2, Ay = -sy * so.h / 2;
      const awx = so.x + so.w / 2 + Ax * cos - Ay * sin;
      const awy = so.y + so.h / 2 + Ax * sin + Ay * cos;
      const vx = w.x - awx, vy = w.y - awy;
      const lx = vx * cos + vy * sin, ly = -vx * sin + vy * cos;
      let nw = sx ? Math.max(12, sx * lx) : so.w;
      let nh = sy ? Math.max(12, sy * ly) : so.h;
      if (e.shiftKey && sx && sy && so.w && so.h) nh = nw * so.h / so.w;
      if (o.t === 'text' && !o.vertical) {
        if (sx && sy) { o.s = Math.max(8, so.s * nw / so.w); o.w = nw; }
        else if (sx) { o.w = nw; }
        else if (sy) { o.s = Math.max(8, so.s * nh / so.h); }
        measureText(o);
      } else if (o.t === 'text' && o.vertical) {
        if (sx && sy) { o.s = Math.max(8, so.s * nh / so.h); o.h = nh; }
        else if (sy) { o.s = Math.max(8, so.s * nh / so.h); }
        else if (sx) { o.h = nh; }
        measureText(o);
      } else {
        o.w = nw; o.h = nh;
      }
      const ncx = awx + (sx * o.w / 2) * cos - (sy * o.h / 2) * sin;
      const ncy = awy + (sx * o.w / 2) * sin + (sy * o.h / 2) * cos;
      o.x = ncx - o.w / 2; o.y = ncy - o.h / 2;
      render(); hooks.onSelection && hooks.onSelection(); return;
    }
  }
  function onUp(e) {
    ptrs.delete(e.pointerId);
    if (mode === 'pinch' && ptrs.size < 2) { mode = null; startInfo = null; return; }
    if (mode && mode !== 'pan') { hooks.onLayers && hooks.onLayers(); hooks.onSelection && hooks.onSelection(); }
    if (mode === 'move') hooks.onAutoSave && hooks.onAutoSave();
    mode = null; startInfo = null;
  }
  function onWheel(e) {
    e.preventDefault();
    const p = pointerPos(e);
    if (e.ctrlKey || e.metaKey || !e.shiftKey) {
      const k = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const nz = clamp(S.zoom * k, .05, 5);
      const kk = nz / S.zoom;
      S.panX = p.x - (p.x - S.panX) * kk;
      S.panY = p.y - (p.y - S.panY) * kk;
      S.zoom = nz;
    } else {
      S.panX -= e.deltaX; S.panY -= e.deltaY;
    }
    render(); hooks.onZoom && hooks.onZoom();
  }
  function onDbl(e) {
    const p = pointerPos(e);
    const w = toWorld(p.x, p.y);
    const hit = hitTest(w.x, w.y);
    if (hit && hit.t === 'text') hooks.onEditRequest && hooks.onEditRequest(hit);
  }
  function updateCursor(p) {
    if (S.sel.length === 1) {
      const o = getObj(S.sel[0]);
      if (o) {
        const hs = handlePositions(o);
        for (const [k, pt] of Object.entries(hs)) {
          if (Math.hypot(p.x - pt.x, p.y - pt.y) < 14) {
            cv.style.cursor = k === 'rot' ? 'grab' : (k === 'n' || k === 's') ? 'ns-resize' : (k === 'e' || k === 'w') ? 'ew-resize' : 'nwse-resize';
            return;
          }
        }
      }
    }
    cv.style.cursor = 'default';
  }

  const keysDown = { space: false };
  window.addEventListener('keydown', e => { if (e.code === 'Space' && !e.target.matches('input,textarea')) keysDown.space = true; });
  window.addEventListener('keyup', e => { if (e.code === 'Space') keysDown.space = false; });

  /* ---------- 主渲染 ---------- */
  function render() {
    if (!cv) return;
    const box = cv.parentElement.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    const needW = Math.round(box.width * dpr), needH = Math.round(box.height * dpr);
    if (cv.width !== needW || cv.height !== needH) { cv.width = needW; cv.height = needH; cv.style.width = box.width + 'px'; cv.style.height = box.height + 'px'; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#14161c';
    ctx.fillRect(0, 0, box.width, box.height);
    ctx.setTransform(dpr * S.zoom, 0, 0, dpr * S.zoom, S.panX * dpr, S.panY * dpr);
    // 画布投影
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 30; ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S.canvas.w, S.canvas.h); ctx.restore();
    drawScene(ctx, S, 1); // setTransform 已含 zoom，场景按设计稿 1:1 绘制
    // 参考线
    if (S.guides.length) {
      ctx.strokeStyle = '#ff4dd2'; ctx.lineWidth = 1 / S.zoom;
      for (const g of S.guides) {
        ctx.beginPath();
        if (g.axis === 'v') { ctx.moveTo(g.pos, 0); ctx.lineTo(g.pos, S.canvas.h); }
        else { ctx.moveTo(0, g.pos); ctx.lineTo(S.canvas.w, g.pos); }
        ctx.stroke();
      }
    }
    if (S.showGrid) {
      ctx.strokeStyle = 'rgba(128,128,255,.25)'; ctx.lineWidth = 1 / S.zoom;
      for (let x = S.canvas.w / 6; x < S.canvas.w; x += S.canvas.w / 6) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S.canvas.h); ctx.stroke(); }
      for (let y = S.canvas.h / 6; y < S.canvas.h; y += S.canvas.h / 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S.canvas.w, y); ctx.stroke(); }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 选中框
    for (const id of S.sel) {
      const o = getObj(id); if (!o) continue;
      const hs = handlePositions(o);
      const pts = ['nw', 'ne', 'se', 'sw'].map(k => hs[k]);
      ctx.strokeStyle = '#4d8dff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath(); ctx.stroke();
      const hsShow = S.sel.length === 1 && !o.locked;
      if (hsShow) {
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#4d8dff';
        for (const [k, pt] of Object.entries(hs)) {
          if (k === 'rot') { ctx.beginPath(); ctx.arc(pt.x, pt.y, 6, 0, 7); ctx.fill(); ctx.stroke(); }
          else { ctx.fillRect(pt.x - 5, pt.y - 5, 10, 10); ctx.strokeRect(pt.x - 5, pt.y - 5, 10, 10); }
        }
      }
    }
    hooks.onZoom && hooks.onZoom();
  }

  /* ---------- 导出渲染 ---------- */
  async function ensureLoaded() {
    const jobs = [];
    if (S.canvas.bg && S.canvas.bg.t === 'i' && !S.canvas.bg._img) jobs.push(loadImg(S.canvas.bg.src).then(im => S.canvas.bg._img = im).catch(() => { }));
    for (const o of S.objects) if (o.src && !o._img) jobs.push(loadImg(o.src).then(im => o._img = im).catch(() => { }));
    await Promise.all(jobs);
  }
  function exportCanvas(scale = 2, opts = {}) {
    const W = S.canvas.w * scale, H = S.canvas.h * scale;
    const oc = document.createElement('canvas');
    oc.width = W; oc.height = H;
    const c2 = oc.getContext('2d');
    c2.imageSmoothingQuality = 'high';
    if (!opts.transparent) { c2.fillStyle = '#fff'; c2.fillRect(0, 0, W, H); }
    drawScene(c2, S, scale);
    if (opts.watermark) {
      c2.save();
      c2.scale(scale, scale);
      c2.font = `600 ${Math.max(18, S.canvas.w * .026)}px ${FONTS.hei.f}`;
      c2.textAlign = 'right'; c2.globalAlpha = .5;
      c2.fillStyle = '#fff'; c2.shadowColor = 'rgba(0,0,0,.4)'; c2.shadowBlur = 6;
      c2.fillText(opts.watermarkText || 'Made with AI海报工坊', S.canvas.w - 24, S.canvas.h - 24);
      c2.restore();
    }
    return oc;
  }
  function screenRectOf(o) {
    const hs = handlePositions(o);
    const pts = ['nw', 'ne', 'se', 'sw'].map(k => hs[k]);
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  return {
    S, init, render, fit, loadImg, select, getObj, getSelObjs,
    add, update, deleteSelected, duplicateSelected, reorder, alignSel,
    undo, redo, pushHistory, canUndo: () => history.length > 1, canRedo: () => future.length > 0,
    serialize, load, resizeCanvas, drawScene, exportCanvas, ensureLoaded,
    screenRectOf, measureText, loadTemplateScene: null,
    setHistBase: () => { history = [snapshot()]; future = []; hooks.onHistory && hooks.onHistory(); },
  };
})();

/* build 20261102185137 */