import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { ROOT } from './env.js';
import { pool, initSchema, ensureDatabase } from './db.js';
import { clientIp, limiter, sameOrigin, makeAdminGuard } from './guard.js';

const PORT = Number(process.env.PORT || 3000);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));

/* ---- 防抓取：来源校验 + 分级限流 ---- */
app.use('/api', sameOrigin);
app.use('/api', limiter({ max: 180, windowMs: 60 * 1000 }));
app.use('/api/auth/login', limiter({ max: 12, windowMs: 60 * 1000 }));
app.use('/api/auth/register', limiter({ max: 8, windowMs: 60 * 1000 }));
app.use('/api/auth/guest', limiter({ max: 20, windowMs: 60 * 1000 }));
app.use('/api/admin', limiter({ max: 100, windowMs: 60 * 1000 }));
app.use('/api/admin', (req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });

/* 统一捕获异步异常，避免单个请求失败导致整个服务退出 */
['get', 'post', 'put', 'delete'].forEach(m => {
  const raw = app[m].bind(app);
  app[m] = (p, ...handlers) =>
    raw(p, ...handlers.map(h =>
      typeof h === 'function' && h.length < 4
        ? (req, res, next) => Promise.resolve(h(req, res, next)).catch(next)
        : h));
});

/* ---------------- 工具 ---------------- */
const hashPass = p => {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(p, salt, 32).toString('hex');
};
const verifyPass = (p, stored) => {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const calc = crypto.scryptSync(p, salt, 32).toString('hex');
  return calc.length === h.length && crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(h));
};
const newToken = () => crypto.randomBytes(32).toString('hex');

const fmt = d => {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/* ---------------- 开通码规则（与服务端一致，防绕过） ---------------- */
const PLAN_MS = { once: 0, week: 7 * 864e5, month: 30 * 864e5, year: 365 * 864e5 };
const CODE_TTL_DAYS = 15;    // 开通码有效期：生成后 15 天未兑换自动作废
const CODE_REMIND_DAYS = 3;  // 到期前 3 天提醒
const CODE_PLAN = { 6: 'once', 18: 'week', 59: 'month', 666: 'year' };
const codeDeadline = issued => new Date(new Date(issued).getTime() + CODE_TTL_DAYS * 864e5);
const RE_BOUND = /^YZ(6|18|59|666)-([A-Z]{2})(\d{3})(\d)$/;
const RE_COMMON = /^YZ(6|18|59|666)-(\d{3})(\d)$/;

function acc2code(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i) * (i + 1)) % 676;
  return String.fromCharCode(65 + Math.floor(h / 26)) + String.fromCharCode(65 + (h % 26));
}

function parseCode(code, username) {
  let m = RE_BOUND.exec(code);
  if (m) {
    const sum = (+m[3][0] + +m[3][1] + +m[3][2] + m[2].charCodeAt(0) + m[2].charCodeAt(1)) % 10;
    if (sum !== +m[4]) return { err: '开通码无效，请核对后再试' };
    if (m[2] !== acc2code(username)) return { err: '该开通码不属于当前账号，无法使用' };
    return { plan: CODE_PLAN[m[1]] };
  }
  m = RE_COMMON.exec(code);
  if (m) {
    const sum = (+m[2][0] + +m[2][1] + +m[2][2]) % 10;
    if (sum !== +m[3]) return { err: '开通码无效，请核对后再试' };
    return { plan: CODE_PLAN[m[1]] };
  }
  return { err: '开通码无效，请核对后再试' };
}

/* ---------------- 认证中间件 ---------------- */
app.use('/api', async (req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  req.user = null;
  if (token) {
    try {
      const [rows] = await pool.query(
        `SELECT u.id, u.username, u.is_guest, u.muted FROM sessions s
         JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
        [token]
      );
      if (rows[0]) req.user = { id: rows[0].id, name: rows[0].username, guest: !!rows[0].is_guest, muted: !!rows[0].muted };
    } catch (_) {}
  }
  next();
});

const needLogin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  next();
};

/* ---------------- 健康检查 ---------------- */
app.get('/api/health', (req, res) => res.json({ ok: true, backend: 'node', db: 'mysql' }));

/* ---------------- 认证 ---------------- */
app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));

app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body.username || '').trim();
  const pass = String(req.body.password || '');
  if (!name || name.length > 16) return res.status(400).json({ error: '账号需 1-16 个字符' });
  if (pass.length < 4) return res.status(400).json({ error: '密码至少 4 位' });
  try {
    const [r] = await pool.query(
      'INSERT INTO users (username, pass_hash, is_guest) VALUES (?, ?, 0)',
      [name, hashPass(pass)]
    );
    const token = newToken();
    await pool.query('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [token, r.insertId]);
    res.json({ token, user: { name, guest: false } });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '该账号已被注册，请直接登录' });
    res.status(500).json({ error: '注册失败，请稍后重试' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const name = String(req.body.username || '').trim();
  const pass = String(req.body.password || '');
  if (!name || !pass) return res.status(400).json({ error: '请输入账号和密码' });
  const [rows] = await pool.query(
    'SELECT id, username, pass_hash, is_guest FROM users WHERE username = ? AND is_guest = 0',
    [name]
  );
  if (!rows[0]) return res.status(404).json({ error: '账号不存在，请先注册' });
  if (!verifyPass(pass, rows[0].pass_hash)) return res.status(401).json({ error: '密码不正确，请重试' });
  const token = newToken();
  await pool.query('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [token, rows[0].id]);
  res.json({ token, user: { name: rows[0].username, guest: false } });
});

app.post('/api/auth/guest', async (req, res) => {
  const name = '游客_' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const [r] = await pool.query(
    'INSERT INTO users (username, pass_hash, is_guest) VALUES (?, ?, 1)',
    [name, hashPass(crypto.randomUUID())]
  );
  const token = newToken();
  await pool.query('INSERT INTO sessions (token, user_id) VALUES (?, ?)', [token, r.insertId]);
  res.json({ token, user: { name, guest: true } });
});

app.post('/api/auth/logout', async (req, res) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (token) await pool.query('DELETE FROM sessions WHERE token = ?', [token]);
  res.json({ ok: true });
});

/* ---------------- 评论 / 留言 ---------------- */
const COMMENTS_SQL = `SELECT c.id, c.parent_id, c.username, c.body, c.created_at, c.user_id,
       (SELECT COUNT(*) FROM likes l WHERE l.target='comment' AND l.target_id=c.id) AS likes,
       (SELECT COUNT(*) FROM likes l2 WHERE l2.target='comment' AND l2.target_id=c.id AND l2.user_id=?) AS liked
     FROM comments c WHERE c.scope=? AND c.slug=? ORDER BY c.id ASC`;

app.get('/api/comments', async (req, res) => {
  const scope = req.query.scope === 'guest' ? 'guest' : 'post';
  const slug = String(req.query.slug || (scope === 'guest' ? 'guest' : ''));
  const uid = req.user ? req.user.id : 0;
  const [rows] = await pool.query(COMMENTS_SQL, [uid, scope, slug]);
  const now = Date.now();
  const map = new Map();
  const roots = [];
  for (const r of rows) {
    const item = {
      id: r.id,
      n: r.username,
      x: r.body,
      t: fmt(new Date(r.created_at)),
      ts: new Date(r.created_at).getTime(),
      likes: Number(r.likes),
      liked: !!Number(r.liked),
      mine: r.user_id === uid,
      canDel: r.user_id === uid && now - new Date(r.created_at).getTime() < 3 * 60 * 1000,
      r: [],
    };
    map.set(r.id, item);
    if (r.parent_id) {
      const p = map.get(r.parent_id);
      if (p) { item.to = p.n; p.r.push(item); }
      else roots.push(item);
    } else roots.push(item);
  }
  res.json({ list: roots });
});

app.post('/api/comments', needLogin, async (req, res) => {
  if (req.user.muted) return res.status(403).json({ error: '该账号已被管理员禁用评论/留言功能' });
  const scope = req.body.scope === 'guest' ? 'guest' : 'post';
  const slug = String(req.body.slug || (scope === 'guest' ? 'guest' : ''));
  const body = String(req.body.body || '').trim();
  const parentId = req.body.parentId ? Number(req.body.parentId) : null;
  if (!body) return res.status(400).json({ error: '内容不能为空' });
  if (body.length > 1000) return res.status(400).json({ error: '内容太长' });
  if (parentId) {
    const [p] = await pool.query('SELECT id FROM comments WHERE id=? AND scope=? AND slug=?', [parentId, scope, slug]);
    if (!p[0]) return res.status(400).json({ error: '被回复的评论不存在' });
  }
  const [r] = await pool.query(
    'INSERT INTO comments (scope, slug, parent_id, user_id, username, body) VALUES (?,?,?,?,?,?)',
    [scope, slug, parentId, req.user.id, req.user.name, body]
  );
  res.json({ id: r.insertId });
});

app.delete('/api/comments/:id', needLogin, async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT user_id, created_at FROM comments WHERE id=?', [id]);
  if (!rows[0]) return res.status(404).json({ error: '评论不存在' });
  if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: '只能删除自己的评论' });
  if (Date.now() - new Date(rows[0].created_at).getTime() > 3 * 60 * 1000)
    return res.status(403).json({ error: '已超过 3 分钟，无法删除' });
  await pool.query('DELETE FROM likes WHERE target=? AND target_id=?', ['comment', id]);
  await pool.query('DELETE FROM comments WHERE parent_id=?', [id]);
  await pool.query('DELETE FROM comments WHERE id=?', [id]);
  res.json({ ok: true });
});

app.post('/api/comments/:id/like', needLogin, async (req, res) => {
  const id = Number(req.params.id);
  const [rows] = await pool.query('SELECT id FROM comments WHERE id=?', [id]);
  if (!rows[0]) return res.status(404).json({ error: '评论不存在' });
  const [ex] = await pool.query(
    'SELECT id FROM likes WHERE target=? AND target_id=? AND user_id=?',
    ['comment', id, req.user.id]
  );
  if (ex[0]) await pool.query('DELETE FROM likes WHERE id=?', [ex[0].id]);
  else await pool.query('INSERT INTO likes (target, target_id, user_id) VALUES (?,?,?)', ['comment', id, req.user.id]);
  const [cnt] = await pool.query('SELECT COUNT(*) AS n FROM likes WHERE target=? AND target_id=?', ['comment', id]);
  res.json({ liked: !ex[0], likes: Number(cnt[0].n) });
});

/* ---------------- 作品权限 ---------------- */
const WORKS = ['poster', 'video'];

app.get('/api/works/status', needLogin, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT work_key, plan, remaining, expires_at FROM entitlements WHERE user_id=?',
    [req.user.id]
  );
  const out = {};
  const now = Date.now();
  for (const key of WORKS) {
    const row = rows.find(r => r.work_key === key) || { plan: 'free', remaining: 3, expires_at: null };
    const until = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    if (row.plan !== 'free' && ((row.plan === 'once' && row.remaining > 0) || (row.plan !== 'once' && until > now))) {
      out[key] = { type: 'vip', plan: row.plan, left: row.remaining, until };
    } else {
      out[key] = { type: 'free', left: Math.max(0, row.remaining), until: 0 };
    }
  }
  res.json(out);
});

app.post('/api/works/:key/use', needLogin, async (req, res) => {
  const key = req.params.key;
  if (!WORKS.includes(key)) return res.status(400).json({ error: '作品不存在' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      'SELECT plan, remaining, expires_at FROM entitlements WHERE user_id=? AND work_key=? FOR UPDATE',
      [req.user.id, key]
    );
    const row = rows[0];
    const now = Date.now();
    if (row) {
      const until = row.expires_at ? new Date(row.expires_at).getTime() : 0;
      if (row.plan === 'once' && row.remaining > 0) {
        await conn.query('UPDATE entitlements SET remaining=remaining-1 WHERE user_id=? AND work_key=?', [req.user.id, key]);
        await conn.commit();
        return res.json({ ok: true, vip: true, left: row.remaining - 1 });
      }
      if (row.plan !== 'free' && row.plan !== 'once' && until > now) {
        await conn.commit();
        return res.json({ ok: true, vip: true, until });
      }
      if (row.remaining > 0) {
        await conn.query('UPDATE entitlements SET remaining=remaining-1 WHERE user_id=? AND work_key=?', [req.user.id, key]);
        await conn.commit();
        return res.json({ ok: true, free: true, left: row.remaining - 1 });
      }
      await conn.commit();
      return res.status(402).json({ error: '免费体验次数已用完，请开通套餐' });
    }
    await conn.query(
      'INSERT INTO entitlements (user_id, work_key, plan, remaining) VALUES (?,?,?,?)',
      [req.user.id, key, 'free', 2]
    );
    await conn.commit();
    res.json({ ok: true, free: true, left: 2 });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: '操作失败，请稍后重试' });
  } finally {
    conn.release();
  }
});

app.post('/api/works/:key/redeem', needLogin, async (req, res) => {
  const key = req.params.key;
  if (!WORKS.includes(key)) return res.status(400).json({ error: '作品不存在' });
  const code = String(req.body.code || '').trim().toUpperCase();
  const parsed = parseCode(code, req.user.name);
  if (parsed.err) return res.status(400).json({ error: parsed.err });
  if (req.user.guest && parsed.plan !== 'once') {
    return res.status(400).json({ error: '游客账号仅可购买单次套餐，其他套餐请注册正式账号后购买' });
  }

  const [used] = await pool.query('SELECT code FROM codes WHERE code=?', [code]);
  if (used[0]) return res.status(409).json({ error: '该开通码已被使用，每个码仅限一次' });

  const [issued] = await pool.query('SELECT issued_at FROM issued_codes WHERE code=? LIMIT 1', [code]);
  if (issued[0] && Date.now() > codeDeadline(issued[0].issued_at).getTime()) {
    return res.status(400).json({ error: `该开通码已超过 ${CODE_TTL_DAYS} 天有效期，已自动作废，请联系客服重新生成` });
  }

  try {
    await pool.query('INSERT INTO codes (code, plan, user_id) VALUES (?,?,?)', [code, parsed.plan, req.user.id]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '该开通码已被使用，每个码仅限一次' });
    throw e;
  }

  const [rows] = await pool.query(
    'SELECT plan, remaining, expires_at FROM entitlements WHERE user_id=? AND work_key=?',
    [req.user.id, key]
  );
  const cur = rows[0] || { plan: 'free', remaining: 3, expires_at: null };
  if (parsed.plan === 'once') {
    const remaining = (cur.plan === 'once' ? cur.remaining : 0) + 1;
    await pool.query(
      'INSERT INTO entitlements (user_id, work_key, plan, remaining) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE plan=?, remaining=?',
      [req.user.id, key, 'once', remaining, 'once', remaining]
    );
  } else {
    const base = cur.expires_at ? Math.max(Date.now(), new Date(cur.expires_at).getTime()) : Date.now();
    const until = new Date(base + PLAN_MS[parsed.plan]);
    await pool.query(
      'INSERT INTO entitlements (user_id, work_key, plan, remaining, expires_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE plan=?, expires_at=?',
      [req.user.id, key, parsed.plan, 0, until, parsed.plan, until]
    );
  }
  res.json({ ok: true, plan: parsed.plan });
});

/* 我的未兑换开通码（用于到期前提醒） */
app.get('/api/codes/mine', needLogin, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT i.code, i.plan, i.issued_at FROM issued_codes i
     WHERE i.username = ? AND NOT EXISTS (SELECT 1 FROM codes c WHERE c.code = i.code)
     ORDER BY i.issued_at ASC`,
    [req.user.name]
  );
  const now = Date.now();
  const list = [];
  for (const r of rows) {
    const end = codeDeadline(r.issued_at);
    const daysLeft = Math.ceil((end.getTime() - now) / 864e5);
    if (now > end.getTime()) continue; // 已作废的不再提醒
    list.push({
      code: r.code, plan: r.plan, expires_at: end,
      days_left: daysLeft, remind: daysLeft <= CODE_REMIND_DAYS,
    });
  }
  res.json({ list, ttlDays: CODE_TTL_DAYS, remindDays: CODE_REMIND_DAYS });
});

/* ---------------- 违规告知（取管理台禁言账号） ---------------- */
const maskName = n => {
  const s = String(n || '');
  if (s.length <= 2) return (s.slice(0, 1) || '匿名') + '***';
  return s.slice(0, 3) + '***';
};
app.get('/api/notice', async (req, res) => {
  let it = null;
  let count = 0;
  if (req.user && req.user.muted) {
    const [own] = await pool.query('SELECT id, username, muted_at FROM users WHERE id = ?', [req.user.id]);
    it = own[0] || null;
  }
  if (!it) {
    const [rows] = await pool.query(
      'SELECT id, username, muted_at FROM users WHERE muted = 1 ORDER BY muted_at DESC, id DESC LIMIT 1'
    );
    it = rows[0] || null;
  }
  const [cnt] = await pool.query('SELECT COUNT(*) AS n FROM users WHERE muted = 1');
  count = Number(cnt[0].n);
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  let appeal = null;
  if (it) {
    const [ap] = await pool.query(
      'SELECT status, handled_at FROM appeals WHERE user_id = ? ORDER BY id DESC LIMIT 1',
      [it.id]
    );
    if (ap[0]) {
      appeal = {
        status: ap[0].status,
        time: ap[0].handled_at ? fmt(new Date(ap[0].handled_at)) : '',
      };
    }
  }
  const d = it && it.muted_at ? new Date(it.muted_at) : null;
  res.json({
    muted: it ? {
      name: maskName(it.username),
      time: d ? fmt(d) : '',
    } : null,
    count,
    appeal,
  });
});

/* ---------------- 违规申诉 ---------------- */
const APPEAL_REASONS = ['内容无违规', '误判申诉', '恶意举报', '已删除/整改', '账号被盗用', '其他原因'];
app.post('/api/appeals', limiter({ max: 10, windowMs: 60 * 1000 }), async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  const content = String(req.body.content || '').trim();
  const images = Array.isArray(req.body.images) ? req.body.images : [];
  if (!APPEAL_REASONS.includes(reason)) return res.status(400).json({ error: '请选择申诉理由' });
  if (!content) return res.status(400).json({ error: '请填写补充说明' });
  if (content.length > 500) return res.status(400).json({ error: '补充说明不能超过 500 字' });
  if (images.length > 9) return res.status(400).json({ error: '最多上传 9 张凭证' });
  if (!images.length) return res.status(400).json({ error: '请至少上传 1 张凭证' });
  const badImg = images.some(x => typeof x !== 'string' || !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(x));
  if (badImg) return res.status(400).json({ error: '凭证图片格式不支持' });

  let target = null;
  if (req.user && req.user.muted) target = { id: req.user.id, username: req.user.name };
  else {
    const [rows] = await pool.query(
      'SELECT id, username FROM users WHERE muted = 1 ORDER BY muted_at DESC, id DESC LIMIT 1'
    );
    target = rows[0] || null;
  }
  if (!target) return res.status(400).json({ error: '当前没有需要申诉的禁言账号' });

  const [dup] = await pool.query("SELECT id FROM appeals WHERE user_id = ? AND status = 'pending'", [target.id]);
  if (dup[0]) return res.status(409).json({ error: '该账号已有待审核的申诉，请耐心等待' });

  const [r] = await pool.query(
    'INSERT INTO appeals (user_id, username, reason, content, images) VALUES (?,?,?,?,?)',
    [target.id, target.username, reason, content, images.length ? JSON.stringify(images) : null]
  );
  res.json({ ok: true, id: r.insertId });
});

/* ---------------- 站长：签发开通码（服务端校验） ---------------- */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const adminGuard = makeAdminGuard({ maxFails: 8, lockMs: 10 * 60 * 1000 });

const needAdmin = (req, res, next) => {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: '未配置 ADMIN_TOKEN，发码功能不可用' });
  const ip = clientIp(req);
  if (adminGuard.locked(ip)) {
    return res.status(429).json({ error: '口令错误次数过多，已临时锁定 10 分钟' });
  }
  const a = Buffer.from(String(req.headers['x-admin-token'] || ''));
  const b = Buffer.from(ADMIN_TOKEN);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const left = adminGuard.fail(ip);
    return res.status(401).json({
      error: left > 0 ? `站长口令不正确（还可尝试 ${left} 次）` : '站长口令错误次数过多，已临时锁定 10 分钟',
    });
  }
  adminGuard.clear(ip);
  next();
};

/* ---------------- 作品部署包管理 ---------------- */
const PKG_DIR = path.resolve(ROOT, '..', '_packages');
const PKG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}\.zip$/;
try { fs.mkdirSync(PKG_DIR, { recursive: true }); } catch (_) {}

function pkgManifest() {
  try { return JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'manifest.json'), 'utf8')); }
  catch (_) { return { packages: [] }; }
}

function pkgList() {
  const man = pkgManifest();
  const meta = new Map((man.packages || []).map(p => [p.file, p]));
  let files = [];
  try { files = fs.readdirSync(PKG_DIR).filter(f => PKG_RE.test(f)); } catch (_) {}
  return files.map(f => {
    const st = fs.statSync(path.join(PKG_DIR, f));
    const m = meta.get(f) || {};
    return {
      file: f,
      id: f.replace(/\.zip$/, ''),
      title: m.title || f.replace(/\.zip$/, ''),
      desc: m.desc || '',
      stack: m.stack || '',
      version: m.version || '',
      size: st.size,
      updated: st.mtime,
    };
  }).sort((a, b) => a.file.localeCompare(b.file));
}

app.get('/api/admin/works/packages', needAdmin, (req, res) => {
  res.json({ list: pkgList() });
});

app.get('/api/admin/works/packages/:file', needAdmin, (req, res) => {
  const f = String(req.params.file || '');
  if (!PKG_RE.test(f)) return res.status(400).json({ error: '包名不合法' });
  const abs = path.join(PKG_DIR, f);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: '该部署包不存在' });
  res.download(abs, f);
});

app.post('/api/admin/works/packages/:file', needAdmin, express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
  const f = String(req.params.file || '');
  if (!PKG_RE.test(f)) return res.status(400).json({ error: '包名不合法，仅支持字母数字点横线下划线 + .zip' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: '未收到包内容' });
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4B) return res.status(400).json({ error: '仅支持 zip 压缩包' });
  fs.writeFileSync(path.join(PKG_DIR, f), buf);
  res.json({ ok: true, file: f, size: buf.length });
});

app.delete('/api/admin/works/packages/:file', needAdmin, (req, res) => {
  const f = String(req.params.file || '');
  if (!PKG_RE.test(f)) return res.status(400).json({ error: '包名不合法' });
  const abs = path.join(PKG_DIR, f);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: '该部署包不存在' });
  fs.unlinkSync(abs);
  res.json({ ok: true });
});

app.post('/api/admin/codes', needAdmin, async (req, res) => {
  const name = String(req.body.username || '').trim();
  const plan = String(req.body.plan || '');
  if (!CODE_PLAN[plan]) return res.status(400).json({ error: '套餐无效，可选：6 / 18 / 59 / 666' });
  if (!name) return res.status(400).json({ error: '请填写用户账号' });

  const [u] = await pool.query('SELECT is_guest FROM users WHERE username = ?', [name]);
  if (!u[0]) return res.status(404).json({ error: '该账号尚未注册，请让用户先注册再付款' });
  if (u[0].is_guest && plan !== '6') return res.status(400).json({ error: '游客账号仅可购买单次套餐，其他套餐请使用正式注册账号' });

  const X = acc2code(name);
  let code = '';
  for (let i = 0; i < 20; i++) {
    const d = String(100 + Math.floor(Math.random() * 900));
    const sum = (+d[0] + +d[1] + +d[2] + X.charCodeAt(0) + X.charCodeAt(1)) % 10;
    const c = `YZ${plan}-${X}${d}${sum}`;
    const [used] = await pool.query('SELECT 1 FROM codes WHERE code = ?', [c]);
    if (!used[0]) { code = c; break; }
  }
  if (!code) return res.status(500).json({ error: '生成失败，请重试' });

  await pool.query('INSERT INTO issued_codes (code, username, plan) VALUES (?,?,?)', [code, name, CODE_PLAN[plan]]);
  res.json({ ok: true, code, plan: CODE_PLAN[plan], username: name });
});

/* 开通码历史查询：账号 / 码 / 生成时间 / 是否已用 / 是否永久（包年） */
app.get('/api/admin/codes', needAdmin, async (req, res) => {
  const username = String(req.query.username || '').trim();
  const code = String(req.query.code || '').trim().toUpperCase();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const used = req.query.used === '1' ? 1 : req.query.used === '0' ? 0 : -1;
  const forever = req.query.forever === '1' ? 1 : req.query.forever === '0' ? 0 : -1;
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

  const where = [];
  const args = [];
  if (username) { where.push('i.username LIKE ?'); args.push('%' + username + '%'); }
  if (code) { where.push('i.code LIKE ?'); args.push('%' + code + '%'); }
  if (isDate(from)) { where.push('i.issued_at >= ?'); args.push(from); }
  if (isDate(to)) { where.push('i.issued_at < DATE_ADD(?, INTERVAL 1 DAY)'); args.push(to); }
  if (used === 1) where.push('EXISTS (SELECT 1 FROM codes c WHERE c.code = i.code)');
  if (used === 0) where.push('NOT EXISTS (SELECT 1 FROM codes c WHERE c.code = i.code)');
  if (forever === 1) where.push("i.plan = 'year'");
  if (forever === 0) where.push("i.plan <> 'year'");

  const cond = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const [cnt] = await pool.query(`SELECT COUNT(*) AS n FROM issued_codes i${cond}`, args);
  const [rows] = await pool.query(
    `SELECT i.code, i.username, i.plan, i.issued_at,
        (SELECT c.used_at FROM codes c WHERE c.code = i.code LIMIT 1) AS used_at
     FROM issued_codes i${cond} ORDER BY i.issued_at DESC, i.code DESC LIMIT 100`, args
  );
  const now = Date.now();
  res.json({
    total: Number(cnt[0].n),
    rows: rows.map(r => {
      const expires = codeDeadline(r.issued_at);
      const left = Math.ceil((expires.getTime() - now) / 864e5);
      return {
        code: r.code, username: r.username, plan: r.plan, issued_at: r.issued_at,
        used_at: r.used_at, used: !!r.used_at, forever: r.plan === 'year',
        expires_at: expires,
        days_left: r.used_at ? null : Math.max(0, left),
        expired: !r.used_at && now > expires.getTime(),
        expiring: !r.used_at && now <= expires.getTime() && left <= CODE_REMIND_DAYS,
      };
    }),
  });
});

/* 套餐价格（用于统计收入） */
const PRICES = { once: 2.5, week: 16.66, month: 39.99, year: 398 };
const PLAN_LABEL = { once: '单次', week: '包周', month: '包月', year: '包年' };

app.get('/api/admin/stats', needAdmin, async (req, res) => {
  const one = async sql => (await pool.query(sql))[0][0];

  const users = await one(`SELECT COUNT(*) AS total,
      COALESCE(SUM(is_guest=0),0) AS regular, COALESCE(SUM(is_guest=1),0) AS guest,
      COALESCE(SUM(created_at>=CURDATE()),0) AS today,
      COALESCE(SUM(created_at>=CURDATE()-INTERVAL 7 DAY),0) AS week FROM users`);
  const comments = await one(`SELECT COUNT(*) AS total,
      COALESCE(SUM(created_at>=CURDATE()),0) AS today FROM comments`);
  const issued = await one(`SELECT COUNT(*) AS total,
      COALESCE(SUM(issued_at>=CURDATE()),0) AS today FROM issued_codes`);
  const codeHealth = await one(`SELECT
      COALESCE(SUM(NOT EXISTS (SELECT 1 FROM codes c WHERE c.code=i.code)
        AND i.issued_at < DATE_SUB(NOW(), INTERVAL ${CODE_TTL_DAYS - CODE_REMIND_DAYS} DAY)
        AND i.issued_at >= DATE_SUB(NOW(), INTERVAL ${CODE_TTL_DAYS} DAY)),0) AS expiring,
      COALESCE(SUM(NOT EXISTS (SELECT 1 FROM codes c WHERE c.code=i.code)
        AND i.issued_at < DATE_SUB(NOW(), INTERVAL ${CODE_TTL_DAYS} DAY)),0) AS expired
      FROM issued_codes i`);
  const redeemed = await one(`SELECT COUNT(*) AS total,
      COALESCE(SUM(used_at>=CURDATE()),0) AS today FROM codes`);
  const active = await one(`SELECT COUNT(*) AS n FROM entitlements
      WHERE plan<>'free' AND ((plan='once' AND remaining>0) OR (expires_at IS NOT NULL AND expires_at>NOW()))`);

  const [byPlan] = await pool.query(`SELECT plan, COUNT(*) AS n FROM codes GROUP BY plan`);
  const revenue = byPlan.reduce((s, r) => s + (PRICES[r.plan] || 0) * Number(r.n), 0);

  const [userSeries] = await pool.query(
    `SELECT DATE_FORMAT(DATE(created_at),'%Y-%m-%d') AS d, COUNT(*) AS n
     FROM users WHERE created_at >= CURDATE()-INTERVAL 6 DAY GROUP BY d`
  );
  const [codeSeries] = await pool.query(
    `SELECT DATE_FORMAT(DATE(used_at),'%Y-%m-%d') AS d, COUNT(*) AS n
     FROM codes WHERE used_at >= CURDATE()-INTERVAL 6 DAY GROUP BY d`
  );

  const pad = n => String(n).padStart(2, '0');
  const days = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  const um = new Map(userSeries.map(r => [r.d, Number(r.n)]));
  const cm = new Map(codeSeries.map(r => [r.d, Number(r.n)]));

  const [recentIssued] = await pool.query(
    `SELECT i.code, i.username, i.plan, i.issued_at,
        (SELECT COUNT(*) FROM codes c WHERE c.code=i.code) AS used
     FROM issued_codes i ORDER BY i.issued_at DESC, i.code DESC LIMIT 8`
  );
  const [recentRedeemed] = await pool.query(
    `SELECT c.code, c.plan, c.used_at, u.username
     FROM codes c JOIN users u ON u.id=c.user_id
     ORDER BY c.used_at DESC LIMIT 8`
  );

  res.json({
    users,
    comments,
    codes: { issued: Number(issued.total), issuedToday: Number(issued.today),
             redeemed: Number(redeemed.total), redeemedToday: Number(redeemed.today),
             unused: Math.max(0, Number(issued.total) - Number(redeemed.total)),
             expiring: Number(codeHealth.expiring || 0), expired: Number(codeHealth.expired || 0),
             ttlDays: CODE_TTL_DAYS, remindDays: CODE_REMIND_DAYS,
             active: Number(active.n), revenue: Math.round(revenue * 100) / 100 },
    byPlan: byPlan.map(r => ({ plan: r.plan, label: PLAN_LABEL[r.plan] || r.plan, n: Number(r.n), amount: (PRICES[r.plan] || 0) * Number(r.n) })),
    series: days.map(d => ({ d, users: um.get(d) || 0, redeemed: cm.get(d) || 0 })),
    recentIssued: recentIssued.map(r => {
      const end = codeDeadline(r.issued_at);
      const left = Math.ceil((end.getTime() - Date.now()) / 864e5);
      return { ...r, used: Number(r.used),
        days_left: Number(r.used) ? null : Math.max(0, left),
        expired: !Number(r.used) && Date.now() > end.getTime() };
    }),
    recentRedeemed,
  });
});

app.get('/api/admin/users', needAdmin, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ users: [] });
  const [rows] = await pool.query(
    `SELECT id, username, is_guest, muted, created_at FROM users WHERE username LIKE ? ORDER BY id DESC LIMIT 10`,
    ['%' + q + '%']
  );
  if (!rows.length) return res.json({ users: [] });

  const ids = rows.map(r => r.id);
  const names = rows.map(r => r.username);
  const [ents] = await pool.query(
    `SELECT user_id, work_key, plan, remaining, expires_at FROM entitlements WHERE user_id IN (?)`, [ids]
  );
  const [red] = await pool.query(
    `SELECT user_id, COUNT(*) AS n FROM codes WHERE user_id IN (?) GROUP BY user_id`, [ids]
  );
  const [iss] = await pool.query(
    `SELECT username, COUNT(*) AS n FROM issued_codes WHERE username IN (?) GROUP BY username`, [names]
  );
  const em = new Map(ents.map(e => [e.user_id, []]));
  for (const e of ents) em.get(e.user_id).push(e);
  const rm = new Map(red.map(r => [r.user_id, Number(r.n)]));
  const im = new Map(iss.map(r => [r.username, Number(r.n)]));

  res.json({
    users: rows.map(u => ({
      id: u.id,
      username: u.username,
      guest: !!u.is_guest,
      muted: !!u.muted,
      created_at: u.created_at,
      redeemed: rm.get(u.id) || 0,
      issued: im.get(u.username) || 0,
      entitlements: em.get(u.id) || [],
    })),
  });
});

/* 统计卡片下钻列表 */
app.get('/api/admin/list', needAdmin, async (req, res) => {
  const type = String(req.query.type || 'users');
  const LIMIT = 100;

  if (type === 'users' || type === 'users_today') {
    const q = String(req.query.q || '').trim();
    const cond = [];
    const args = [];
    if (type === 'users_today') cond.push('u.created_at >= CURDATE()');
    if (q) { cond.push('u.username LIKE ?'); args.push('%' + q + '%'); }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const [t] = await pool.query(`SELECT COUNT(*) AS n FROM users u ${where}`, args);
    const [rows] = await pool.query(
      `SELECT u.id, u.username, u.is_guest, u.muted, u.created_at,
         (SELECT COUNT(*) FROM codes c WHERE c.user_id = u.id) AS redeemed
       FROM users u ${where} ORDER BY u.id DESC LIMIT ${LIMIT}`, args
    );
    const ids = rows.map(r => r.id);
    const vipMap = new Map();
    if (ids.length) {
      const [ents] = await pool.query(
        `SELECT user_id, plan, remaining, expires_at FROM entitlements
         WHERE user_id IN (?) AND plan <> 'free'`, [ids]
      );
      const now = Date.now();
      const RANK = { once: 1, week: 1, month: 2, year: 3 };
      const TYPE = { once: '体验', week: '体验', month: '畅享', year: '永久' };
      for (const e of ents) {
        const active = e.plan === 'once'
          ? Number(e.remaining) > 0
          : (e.expires_at && new Date(e.expires_at).getTime() > now);
        if (!active) continue;
        const rank = RANK[e.plan] || 0;
        const cur = vipMap.get(e.user_id);
        if (!cur || rank >= cur.rank) {
          vipMap.set(e.user_id, { rank, type: TYPE[e.plan] || e.plan, until: e.expires_at });
        }
      }
    }
    return res.json({
      type,
      total: Number(t[0].n),
      rows: rows.map(r => {
        const v = vipMap.get(r.id);
        return { ...r, vip: !!v, vipType: v ? v.type : null, vipUntil: v ? v.until : null };
      }),
    });
  }

  if (type === 'comments' || type === 'comments_today') {
    const where = type === 'comments_today' ? 'WHERE created_at >= CURDATE()' : '';
    const [t] = await pool.query(`SELECT COUNT(*) AS n FROM comments ${where}`);
    const [rows] = await pool.query(
      `SELECT username, body, scope, slug, created_at FROM comments ${where} ORDER BY id DESC LIMIT ${LIMIT}`
    );
    return res.json({ type, total: Number(t[0].n), rows });
  }

  if (type === 'issued') {
    const [t] = await pool.query('SELECT COUNT(*) AS n FROM issued_codes');
    const [rows] = await pool.query(
      `SELECT i.code, i.username, i.plan, i.issued_at,
         (SELECT c.used_at FROM codes c WHERE c.code = i.code LIMIT 1) AS used_at
       FROM issued_codes i ORDER BY i.issued_at DESC, i.code DESC LIMIT ${LIMIT}`
    );
    return res.json({ type, total: Number(t[0].n), rows });
  }

  if (type === 'redeemed') {
    const [t] = await pool.query('SELECT COUNT(*) AS n FROM codes');
    const [rows] = await pool.query(
      `SELECT c.code, c.plan, c.used_at, u.username
       FROM codes c JOIN users u ON u.id = c.user_id
       ORDER BY c.used_at DESC LIMIT ${LIMIT}`
    );
    return res.json({ type, total: Number(t[0].n), rows });
  }

  res.status(400).json({ error: '未知的列表类型' });
});

/* 禁用 / 解禁账号的评论、留言功能 */
app.post('/api/admin/users/:id/mute', needAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: '账号参数无效' });
  const muted = req.body && req.body.muted ? 1 : 0;
  const [u] = await pool.query('SELECT username FROM users WHERE id = ?', [id]);
  if (!u[0]) return res.status(404).json({ error: '账号不存在' });
  await pool.query(
    'UPDATE users SET muted = ?, muted_at = ? WHERE id = ?',
    [muted, muted ? new Date() : null, id]
  );
  res.json({ ok: true, id, username: u[0].username, muted: !!muted });
});

/* 管理员续会：会员续会（全部应用）/ 应用续会（指定应用），并记录可撤销的历史 */
app.post('/api/admin/users/:id/renew', needAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: '账号参数无效' });
  const scope = req.body && req.body.scope === 'app' ? 'app' : 'member';
  const plan = String((req.body && req.body.plan) || '');
  const workKey = String((req.body && req.body.workKey) || '');
  if (!Object.prototype.hasOwnProperty.call(PLAN_MS, plan)) return res.status(400).json({ error: '套餐无效' });
  if (scope === 'app' && !WORKS.includes(workKey)) return res.status(400).json({ error: '应用无效' });
  const [u] = await pool.query('SELECT username, is_guest FROM users WHERE id = ?', [id]);
  if (!u[0]) return res.status(404).json({ error: '账号不存在' });
  if (u[0].is_guest) return res.status(400).json({ error: '游客账号不能续会，请使用正式注册账号' });

  const batch = crypto.randomBytes(6).toString('hex');
  const keys = scope === 'member' ? WORKS.slice() : [workKey];
  const works = [];
  for (const key of keys) {
    const [rows] = await pool.query(
      'SELECT plan, remaining, expires_at FROM entitlements WHERE user_id=? AND work_key=?',
      [id, key]
    );
    const cur = rows[0];
    let newRemaining = null, newExpires = null;
    if (plan === 'once') {
      newRemaining = (cur && cur.plan === 'once' ? cur.remaining : 0) + 1;
      await pool.query(
        'INSERT INTO entitlements (user_id, work_key, plan, remaining) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE plan=?, remaining=?',
        [id, key, 'once', newRemaining, 'once', newRemaining]
      );
      works.push({ workKey: key, plan: 'once', remaining: newRemaining });
    } else {
      const base = cur && cur.expires_at ? Math.max(Date.now(), new Date(cur.expires_at).getTime()) : Date.now();
      newExpires = new Date(base + PLAN_MS[plan]);
      await pool.query(
        'INSERT INTO entitlements (user_id, work_key, plan, remaining, expires_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE plan=?, expires_at=?, remaining=0',
        [id, key, plan, 0, newExpires, plan, newExpires]
      );
      works.push({ workKey: key, plan, until: newExpires });
    }
    await pool.query(
      `INSERT INTO renewals (batch, user_id, scope, work_key, plan, prev_plan, prev_remaining, prev_expires_at, new_remaining, new_expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [batch, id, scope, key, plan, cur ? cur.plan : null, cur ? cur.remaining : null, cur ? cur.expires_at : null, newRemaining, newExpires]
    );
  }
  res.json({ ok: true, id, username: u[0].username, scope, plan, batch, works });
});

/* 最近续会记录（按批次归并，便于一键撤销） */
app.get('/api/admin/users/:id/renewals', needAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: '账号参数无效' });
  const [rows] = await pool.query(
    `SELECT batch, scope, work_key, plan, prev_plan, new_remaining, new_expires_at, revoked, created_at
       FROM renewals WHERE user_id=? ORDER BY id DESC LIMIT 40`,
    [id]
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.batch)) {
      map.set(r.batch, {
        batch: r.batch, scope: r.scope, plan: r.plan, revoked: true,
        created_at: r.created_at, works: [], until: r.new_expires_at || null, remaining: r.new_remaining,
      });
    }
    const it = map.get(r.batch);
    it.works.push({ workKey: r.work_key, prevPlan: r.prev_plan });
    if (!r.revoked) it.revoked = false;
  }
  res.json({ items: [...map.values()] });
});

/* 撤销一次续会（恢复续会前的套餐 / 次数 / 到期时间） */
app.post('/api/admin/users/:id/renewals/:batch/undo', needAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const batch = String(req.params.batch || '');
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: '账号参数无效' });
  const [rows] = await pool.query('SELECT * FROM renewals WHERE user_id=? AND batch=? ORDER BY id', [id, batch]);
  if (!rows.length) return res.status(404).json({ error: '续会记录不存在' });
  if (rows.some(r => r.revoked)) return res.status(409).json({ error: '该次续会已撤销，请勿重复操作' });
  for (const r of rows) {
    const [later] = await pool.query(
      'SELECT id FROM renewals WHERE user_id=? AND work_key=? AND id>? AND revoked=0 LIMIT 1',
      [id, r.work_key, r.id]
    );
    if (later[0]) {
      return res.status(409).json({ error: `「${r.work_key}」之后已有新的续会记录，请先撤销更新的续会` });
    }
  }
  for (const r of rows) {
    if (r.prev_plan == null) {
      await pool.query('DELETE FROM entitlements WHERE user_id=? AND work_key=?', [id, r.work_key]);
    } else {
      await pool.query(
        'INSERT INTO entitlements (user_id, work_key, plan, remaining, expires_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE plan=?, remaining=?, expires_at=?',
        [id, r.work_key, r.prev_plan, r.prev_remaining == null ? 0 : r.prev_remaining, r.prev_expires_at,
         r.prev_plan, r.prev_remaining == null ? 0 : r.prev_remaining, r.prev_expires_at]
      );
    }
  }
  await pool.query('UPDATE renewals SET revoked=1 WHERE user_id=? AND batch=?', [id, batch]);
  res.json({ ok: true, batch, restored: rows.length });
});

/* 违规申诉列表 / 审核（通过即解除禁言） */
app.get('/api/admin/appeals', needAdmin, async (req, res) => {
  const status = req.query.status === 'all' ? 'all' : 'pending';
  const where = status === 'all' ? '' : "WHERE a.status = 'pending'";
  const [rows] = await pool.query(
    `SELECT a.id, a.user_id, a.username, a.reason, a.content, a.images, a.status, a.created_at,
            u.muted, u.muted_at
       FROM appeals a JOIN users u ON u.id = a.user_id
       ${where} ORDER BY a.id DESC LIMIT 50`
  );
  res.json({
    list: rows.map(r => ({
      ...r,
      images: r.images ? JSON.parse(r.images) : [],
    })),
  });
});

app.post('/api/admin/appeals/:id', needAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const action = req.body && req.body.action === 'approve' ? 'approve'
    : req.body && req.body.action === 'reject' ? 'reject' : '';
  if (!action) return res.status(400).json({ error: '处理动作无效' });
  const [rows] = await pool.query('SELECT id, user_id, status, username FROM appeals WHERE id = ?', [id]);
  if (!rows[0]) return res.status(404).json({ error: '申诉不存在' });
  if (rows[0].status !== 'pending') return res.status(400).json({ error: '该申诉已处理' });
  if (action === 'approve') {
    await pool.query('UPDATE users SET muted = 0, muted_at = NULL WHERE id = ?', [rows[0].user_id]);
    await pool.query("UPDATE appeals SET status = 'approved', handled_at = NOW() WHERE id = ?", [id]);
    return res.json({ ok: true, action, username: rows[0].username });
  }
  await pool.query("UPDATE appeals SET status = 'rejected', handled_at = NOW() WHERE id = ?", [id]);
  res.json({ ok: true, action, username: rows[0].username });
});

/* 周 / 月 / 年 统计报表 */
app.get('/api/admin/report', needAdmin, async (req, res) => {
  const raw = String(req.query.range || 'week');
  const range = ['week', 'month', 'year'].includes(raw) ? raw : 'week';
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const buckets = [];
  if (range === 'year') {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
    }
  } else {
    const n = range === 'month' ? 30 : 7;
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      buckets.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    }
  }
  const fmt = range === 'year' ? '%Y-%m' : '%Y-%m-%d';
  const start = range === 'year' ? buckets[0] + '-01' : buckets[0];

  const group = async (table, col) => {
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(${col}, '${fmt}') AS k, COUNT(*) AS n FROM ${table} WHERE ${col} >= ? GROUP BY k`,
      [start]
    );
    return new Map(rows.map(r => [r.k, Number(r.n)]));
  };

  const uMap = await group('users', 'created_at');
  const cMap = await group('comments', 'created_at');
  const iMap = await group('issued_codes', 'issued_at');
  const rMap = await group('codes', 'used_at');

  const [planRows] = await pool.query(
    `SELECT DATE_FORMAT(used_at, '${fmt}') AS k, plan, COUNT(*) AS n
     FROM codes WHERE used_at >= ? GROUP BY k, plan`, [start]
  );
  const revMap = new Map();
  for (const r of planRows) revMap.set(r.k, (revMap.get(r.k) || 0) + (PRICES[r.plan] || 0) * Number(r.n));

  const totals = { users: 0, issued: 0, redeemed: 0, comments: 0, revenue: 0 };
  const series = buckets.map(k => {
    const users = uMap.get(k) || 0;
    const issued = iMap.get(k) || 0;
    const redeemed = rMap.get(k) || 0;
    const comments = cMap.get(k) || 0;
    const revenue = Math.round((revMap.get(k) || 0) * 100) / 100;
    totals.users += users;
    totals.issued += issued;
    totals.redeemed += redeemed;
    totals.comments += comments;
    totals.revenue += revenue;
    return { d: k, users, issued, redeemed, comments, revenue };
  });
  totals.revenue = Math.round(totals.revenue * 100) / 100;

  res.json({ range, start, end: buckets[buckets.length - 1], series, totals });
});

app.get('/api/work-likes', async (req, res) => {
  const [cnt] = await pool.query('SELECT work_key, COUNT(*) AS n FROM work_likes GROUP BY work_key');
  const out = {};
  for (const r of cnt) out[r.work_key] = Number(r.n);
  let mine = [];
  if (req.user) {
    const [m] = await pool.query('SELECT work_key FROM work_likes WHERE user_id=?', [req.user.id]);
    mine = m.map(x => x.work_key);
  }
  res.json({ likes: out, liked: mine });
});

app.post('/api/work-likes/:key', needLogin, async (req, res) => {
  const key = req.params.key;
  const [ex] = await pool.query('SELECT work_key FROM work_likes WHERE work_key=? AND user_id=?', [key, req.user.id]);
  if (ex[0]) await pool.query('DELETE FROM work_likes WHERE work_key=? AND user_id=?', [key, req.user.id]);
  else await pool.query('INSERT INTO work_likes (work_key, user_id) VALUES (?,?)', [key, req.user.id]);
  const [cnt] = await pool.query('SELECT COUNT(*) AS n FROM work_likes WHERE work_key=?', [key]);
  res.json({ liked: !ex[0], likes: Number(cnt[0].n) });
});

/* ---------------- 静态资源 ---------------- */
app.use('/css', express.static(path.join(ROOT, 'css')));
app.use('/js', express.static(path.join(ROOT, 'js')));
app.use('/img', express.static(path.join(ROOT, 'img')));
app.get(['/', '/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(ROOT, 'index.html'));
});
const noIndex = (req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); };

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /api/\nDisallow: /admin.html\n');
});
app.get('/admin.html', noIndex, (req, res) => res.sendFile(path.join(ROOT, 'admin.html')));
app.get('/vip.html', (req, res) => res.sendFile(path.join(ROOT, 'vip.html')));
app.get('/rss.xml', (req, res) => res.sendFile(path.join(ROOT, 'rss.xml')));

app.use((req, res) => res.status(404).json({ error: 'Not Found' }));

/* 统一错误出口 */
app.use((err, req, res, next) => {
  console.error('[API ERROR]', err.code || '', err.message);
  res.status(500).json({ error: '服务器内部错误，请稍后重试' });
});

/* ---------------- 启动 ---------------- */
(async () => {
  try {
    await ensureDatabase();
    await initSchema();
    console.log('✔ MySQL 连接成功，数据表已就绪');
  } catch (e) {
    console.error('✖ 数据库初始化失败：', e.message);
    console.error('  请检查 .env 中的 DB_HOST / DB_USER / DB_PASS / DB_NAME');
    process.exit(1);
  }
  const mode = process.env.DB_NAME === 'tech_blog' ? '正式服' : '测试服';
  const server = app.listen(PORT, () => {
    console.log(`✔ 技术驿站已启动（${mode}）: http://localhost:${PORT}  数据库: ${process.env.DB_NAME}`);
  });
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.error(`✖ 端口 ${PORT} 已被占用，${mode}可能已经在运行。`);
      console.error(`  停止方法：PowerShell 执行  Get-NetTCPConnection -LocalPort ${PORT} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`);
      process.exit(1);
    }
    throw e;
  });
})();
