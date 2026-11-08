import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT } from './env.js';
import { pool, initSchema, ensureDatabase } from './db.js';
import { clientIp, limiter, sameOrigin, makeAdminGuard } from './guard.js';

const PORT = Number(process.env.PORT || 3000);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

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
const WORKS = ['poster', 'video', 'hotel', 'library'];

app.get('/api/works/status', needLogin, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT work_key, plan, remaining, expires_at FROM entitlements WHERE user_id=?',
    [req.user.id]
  );
  const out = {};
  const now = Date.now();
  for (const key of WORKS) {
    const row = rows.find(r => r.work_key === key) || { plan: 'free', remaining: 1, expires_at: null };
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
      [req.user.id, key, 'free', 0]
    );
    await conn.commit();
    res.json({ ok: true, free: true, left: 0 });
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
/* 包名规则：支持中文等 Unicode 名称，必须以 .zip 结尾，禁止路径分隔符与通配符 */
const PKG_BAD = /[\\/:*?"<>|\x00-\x1f]/;
function pkgName(n) {
  const f = String(n || '').trim();
  if (f.length < 5 || f.length > 80) return '';
  if (!/\.zip$/i.test(f)) return '';
  if (f.startsWith('.') || f.includes('..')) return '';
  if (PKG_BAD.test(f)) return '';
  return f;
}
try { fs.mkdirSync(PKG_DIR, { recursive: true }); } catch (_) {}

function pkgManifest() {
  try { return JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'manifest.json'), 'utf8')); }
  catch (_) { return { packages: [] }; }
}

function pkgList() {
  const man = pkgManifest();
  const meta = new Map((man.packages || []).map(p => [p.file, p]));
  let files = [];
  try { files = fs.readdirSync(PKG_DIR).filter(f => pkgName(f)); } catch (_) {}
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
  const f = pkgName(req.params.file);
  if (!f) return res.status(400).json({ error: '包名不合法' });
  const abs = path.join(PKG_DIR, f);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: '该部署包不存在' });
  res.download(abs, f);
});

app.post('/api/admin/works/packages/:file', needAdmin, express.raw({ type: '*/*', limit: '200mb' }), (req, res) => {
  const f = pkgName(req.params.file);
  if (!f) return res.status(400).json({ error: '包名不合法：需以 .zip 结尾，且不能含 \\ / : * ? " < > |' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: '未收到包内容' });
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4B) return res.status(400).json({ error: '仅支持 zip 压缩包' });
  fs.writeFileSync(path.join(PKG_DIR, f), buf);
  res.json({ ok: true, file: f, size: buf.length });
});

app.delete('/api/admin/works/packages/:file', needAdmin, (req, res) => {
  const f = pkgName(req.params.file);
  if (!f) return res.status(400).json({ error: '包名不合法' });
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

/* ---------------- 作品上线 / 在线体验 ---------------- */
const APPS_DIR = path.resolve(ROOT, '..', '_apps');
const APPS_STORE = path.join(APPS_DIR, 'apps.json');
try { fs.mkdirSync(APPS_DIR, { recursive: true }); } catch (_) {}

const APP_MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.bmp': 'image/bmp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

const MODE_LABEL = {
  static: '静态站点', node: 'Node 服务', jar: 'Java Jar', 'java-web': 'Java Web / Spring Boot', pending: '未部署', unknown: '未知类型',
};

/* 部分文件名不友好，上线时补一份展示用标题（manifest 里有则以 manifest 为准） */
const APP_TITLES = {
  '图书馆管理系统源码+sql(1).zip': {
    title: '图书馆管理系统（JSP/Servlet + MySQL）',
    desc: '经典 JSP + Servlet + MySQL 图书借阅系统：管理员后台、图书/分类/读者管理、借还书与借阅历史，包内附建库 SQL。',
    stack: 'JSP / Servlet + MySQL',
    version: 'v1.0',
  },
};

function appsRead() {
  try {
    const d = JSON.parse(fs.readFileSync(APPS_STORE, 'utf8'));
    if (Array.isArray(d.apps)) return d;
  } catch (_) {}
  return { apps: [] };
}
function appsWrite(data) {
  try {
    fs.writeFileSync(APPS_STORE, JSON.stringify({ updated_at: new Date().toISOString(), apps: data.apps }, null, 2));
  } catch (_) {}
}
function appSlug(file) {
  const base = String(file).replace(/\.zip$/i, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 22);
  const h = crypto.createHash('md5').update(String(file)).digest('hex').slice(0, 6);
  return (base || 'app') + '-' + h;
}
function appFind(slug) { return appsRead().apps.find(a => a.slug === slug) || null; }
function appPatch(slug, patch) {
  const d = appsRead();
  const a = d.apps.find(x => x.slug === slug);
  if (!a) return null;
  Object.assign(a, patch);
  appsWrite(d);
  return a;
}
const relFromApps = abs => path.relative(APPS_DIR, abs).split(path.sep).join('/');

/* 服务重启后，上次遗留的运行状态复位；但若端口仍被外部进程占用则保留 running */
const portAlive = port => new Promise(resolve => {
  if (!port) return resolve(false);
  const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
  s.setTimeout(1200, () => { s.destroy(); resolve(false); });
});
try {
  const d = appsRead();
  for (const a of d.apps) {
    if (a.mode !== 'static' && a.status === 'running' && !(await portAlive(a.port))) {
      a.status = 'stopped'; a.note = '服务已重启，进程已结束，请重新启动';
    }
  }
  appsWrite(d);
} catch (_) {}

/* ---------- PowerShell 辅助 ---------- */
function psRun(cmd, env) {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], {
      env: Object.assign({}, process.env, env || {}), windowsHide: true,
    });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

async function unzipTo(zipAbs, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const r = await psRun('Expand-Archive -LiteralPath $env:YZ_SRC -DestinationPath $env:YZ_DEST -Force', { YZ_SRC: zipAbs, YZ_DEST: dest });
  if (r.code !== 0) throw new Error('解压失败：' + (r.err || r.out || '未知错误'));
}

async function zipAdd(zipAbs, entries) {
  if (!entries.length) return;
  const specPath = path.join(os.tmpdir(), 'yz-zip-' + crypto.randomBytes(6).toString('hex') + '.json');
  fs.writeFileSync(specPath, JSON.stringify({ entries }, null, 2), 'utf8');
  try {
    const r = await psRun('& $env:YZ_PS1', {
      YZ_ZIP: zipAbs, YZ_SPEC: specPath,
      YZ_PS1: path.join(ROOT, 'server', 'zip-add.ps1'),
    });
    if (r.code !== 0) throw new Error('回写压缩包失败：' + (r.err || r.out || '未知错误'));
  } finally {
    try { fs.unlinkSync(specPath); } catch (_) {}
  }
}

/* ---------- 包结构探测 ---------- */
const dirOf = (root, rel) => {
  const seg = rel.split('/').slice(0, -1);
  return seg.length ? path.join(root, ...seg) : root;
};

function detectApp(root) {
  const files = [];
  const skip = /^(node_modules|\.git|\.idea|classes|target|out)$/i;
  (function go(dir, rel, depth) {
    if (depth > 6) return;
    let items = [];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const it of items) {
      const r = rel ? rel + '/' + it.name : it.name;
      if (it.isDirectory()) { if (!skip.test(it.name)) go(path.join(dir, it.name), r, depth + 1); continue; }
      let size = 0;
      try { size = fs.statSync(path.join(dir, it.name)).size; } catch (_) {}
      files.push({ rel: r, abs: path.join(dir, it.name), name: it.name, size, depth });
    }
  })(root, '', 0);
  const lv = f => f.rel.split('/').length;

  const webXml = files.filter(f => /(^|\/)WEB-INF\/web\.xml$/i.test(f.rel)).sort((a, b) => lv(a) - lv(b))[0];
  const jsp = files.filter(f => /\.jsp$/i.test(f.name)).sort((a, b) => lv(a) - lv(b))[0];
  if (webXml || jsp) {
    const anchor = webXml || jsp;
    const seg = anchor.rel.split('/');
    const wi = seg.findIndex(s => s.toUpperCase() === 'WEB-INF');
    let webRel = wi >= 0 ? seg.slice(0, wi).join('/') : seg.slice(0, -1).join('/');
    let projRel = webRel;
    const base = webRel.split('/').pop() || '';
    if (/src\/main\/webapp$/i.test(webRel)) projRel = webRel.replace(/\/?src\/main\/webapp$/i, '');
    else if (/^(WebContent|webapp|WebRoot)$/i.test(base)) projRel = webRel.split('/').slice(0, -1).join('/');
    const abs = r => (r ? path.join(root, ...r.split('/')) : root);
    return { mode: 'java-web', kind: 'jsp', projAbs: abs(projRel), webRel, anchor: anchor.rel, files };
  }

  const jar = files.filter(f => /\.jar$/i.test(f.name) && !/WEB-INF/i.test(f.rel) && lv(f) <= 3 && f.size > 1024 * 1024)
    .sort((a, b) => lv(a) - lv(b))[0];
  if (jar) return { mode: 'jar', entryRel: jar.rel, projAbs: dirOf(root, jar.rel), anchor: jar.rel, files };

  const pom = files.filter(f => /pom\.xml$/i.test(f.name) && lv(f) <= 3).sort((a, b) => lv(a) - lv(b))[0];
  if (pom) return { mode: 'java-web', kind: 'spring', projAbs: dirOf(root, pom.rel), anchor: pom.rel, files };

  const pkg = files.filter(f => f.name === 'package.json' && lv(f) <= 3).sort((a, b) => lv(a) - lv(b))[0];
  if (pkg) {
    let start = '';
    try { start = (JSON.parse(fs.readFileSync(pkg.abs, 'utf8')).scripts || {}).start || ''; } catch (_) {}
    if (start) return { mode: 'node', projAbs: dirOf(root, pkg.rel), anchor: pkg.rel, files, start };
  }

  const idx = files.filter(f => /^index\.html?$/i.test(f.name)).sort((a, b) => lv(a) - lv(b))[0];
  if (idx) return { mode: 'static', rootAbs: dirOf(root, idx.rel), anchor: idx.rel, files };

  return { mode: 'unknown', projAbs: root, files };
}

/* ---------- 自动补全部署文件 ---------- */
function writeGen(projAbs, files) {
  const added = [];
  for (const f of files) {
    const abs = path.join(projAbs, f.name);
    if (fs.existsSync(abs)) continue;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content, 'utf8');
    added.push(abs);
  }
  return added;
}

function jspPom(meta) {
  const artifact = String(meta.slug || 'library').replace(/[^a-z0-9-]/g, '-');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<project xmlns="http://maven.apache.org/POM/4.0.0"',
    '         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">',
    '  <modelVersion>4.0.0</modelVersion>',
    '  <groupId>com.yizhan</groupId>',
    '  <artifactId>' + artifact + '</artifactId>',
    '  <version>1.0</version>',
    '  <packaging>war</packaging>',
    '  <name>' + (meta.title || artifact) + '</name>',
    '  <properties>',
    '    <maven.compiler.source>1.8</maven.compiler.source>',
    '    <maven.compiler.target>1.8</maven.compiler.target>',
    '    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>',
    '  </properties>',
    '  <dependencies>',
    '    <dependency>',
    '      <groupId>javax.servlet</groupId>',
    '      <artifactId>javax.servlet-api</artifactId>',
    '      <version>4.0.1</version>',
    '      <scope>provided</scope>',
    '    </dependency>',
    '    <dependency>',
    '      <groupId>javax.servlet.jsp</groupId>',
    '      <artifactId>javax.servlet.jsp-api</artifactId>',
    '      <version>2.3.3</version>',
    '      <scope>provided</scope>',
    '    </dependency>',
    '    <dependency>',
    '      <groupId>mysql</groupId>',
    '      <artifactId>mysql-connector-java</artifactId>',
    '      <version>5.1.49</version>',
    '      <scope>provided</scope>',
    '    </dependency>',
    '  </dependencies>',
    '  <build>',
    '    <finalName>' + artifact + '</finalName>',
    '    <sourceDirectory>src</sourceDirectory>',
    '    <plugins>',
    '      <plugin>',
    '        <groupId>org.apache.maven.plugins</groupId>',
    '        <artifactId>maven-compiler-plugin</artifactId>',
    '        <version>3.11.0</version>',
    '      </plugin>',
    '      <plugin>',
    '        <groupId>org.apache.maven.plugins</groupId>',
    '        <artifactId>maven-war-plugin</artifactId>',
    '        <version>3.4.0</version>',
    '        <configuration>',
    '          <warSourceDirectory>WebContent</warSourceDirectory>',
    '          <failOnMissingWebXml>false</failOnMissingWebXml>',
    '        </configuration>',
    '      </plugin>',
    '    </plugins>',
    '  </build>',
    '</project>',
  ].join('\n');
}

function jspDockerfile() {
  return [
    'FROM maven:3.9-eclipse-temurin-8 AS build',
    'WORKDIR /src',
    'COPY . .',
    'RUN mvn -B -DskipTests package',
    '',
    'FROM tomcat:9-jdk8-temurin',
    'RUN rm -rf /usr/local/tomcat/webapps/*',
    'COPY --from=build /src/target/*.war /usr/local/tomcat/webapps/ROOT.war',
    'EXPOSE 8080',
    'CMD ["catalina.sh", "run"]',
    '',
  ].join('\n');
}

function jspCompose() {
  return [
    'services:',
    '  db:',
    '    image: mysql:5.7',
    '    command: --character-set-server=utf8 --collation-server=utf8_general_ci',
    '    environment:',
    '      MYSQL_ROOT_PASSWORD: root',
    '      MYSQL_DATABASE: books',
    '    ports:',
    '      - "33060:3306"',
    '    volumes:',
    '      - ./database/books.sql:/docker-entrypoint-initdb.d/books.sql:ro',
    '  web:',
    '    build: .',
    '    ports:',
    '      - "8088:8080"',
    '    depends_on:',
    '      - db',
    '',
  ].join('\n');
}

function jspReadme(meta, info) {
  const hasPom = fs.existsSync(path.join(info.projAbs, 'pom.xml'));
  return [
    '# ' + (meta.title || 'Java Web 项目') + '',
    '',
    '> 本部署说明由「技术驿站 · 作品上线」自动补齐（' + new Date().toLocaleString('zh-CN') + '），可直接照着跑。',
    '',
    '## 环境要求',
    '- JDK 8 或更高版本',
    '- Maven 3.6+（本包已自动补 `pom.xml`）',
    '- MySQL 5.5 ~ 5.7（建库脚本：`database/books.sql`）',
    '- Tomcat 9（或直接用下面的 Docker 方式）',
    '',
    '## 1. 初始化数据库',
    '```',
    'mysql -uroot -proot < database/books.sql',
    '```',
    '默认库名 `books`，账号 `root / root`。若与本机不同，请修改 `src/com/rain/util/DBUtil.java` 中的 url / username / password。',
    '',
    '## 2. 构建并启动（Tomcat）',
    '```',
    (hasPom ? 'mvn clean package' : 'mvn clean package   # pom.xml 缺失时可先用包内已生成的配置'),
    'copy target\\*.war  %TOMCAT_HOME%\\webapps\\ROOT.war   # Windows',
    '```',
    '启动 Tomcat 后访问 <http://localhost:8080>。',
    '',
    '## 3. 一键容器运行（推荐）',
    '```',
    'docker compose up -d',
    '```',
    '访问 <http://localhost:8088>。容器内数据库地址为 `db:3306`，如连接失败请把 `DBUtil.java` 的 `localhost` 改成 `db` 后重新 `docker compose up -d --build`。',
    '',
    '## 目录结构',
    '- `WebContent/`：JSP 页面、`WEB-INF`、静态资源',
    '- `src/`：Servlet / DAO / Bean / 工具类源码',
    '- `database/`：建库 SQL',
    '- `pom.xml`、`Dockerfile`、`docker-compose.yml`：自动补齐的构建与容器配置',
    '',
  ].join('\n');
}

function springDockerfile() {
  return [
    'FROM maven:3.9-eclipse-temurin-17 AS build',
    'WORKDIR /src',
    'COPY . .',
    'RUN mvn -B -DskipTests package',
    '',
    'FROM eclipse-temurin:17-jre',
    'WORKDIR /app',
    'COPY --from=build /src/target/*.jar /app/app.jar',
    'EXPOSE 8080',
    'ENTRYPOINT ["java", "-jar", "/app/app.jar"]',
    '',
  ].join('\n');
}

function springCompose() {
  return [
    'services:',
    '  db:',
    '    image: mysql:8.0',
    '    command: --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci',
    '    environment:',
    '      MYSQL_ROOT_PASSWORD: root',
    '      MYSQL_DATABASE: hotel_db',
    '    ports:',
    '      - "33061:3306"',
    '  app:',
    '    build: .',
    '    ports:',
    '      - "8089:8080"',
    '    depends_on:',
    '      - db',
    '    environment:',
    '      HOTEL_DB_HOST: db',
    '      HOTEL_DB_PORT: "3306"',
    '      HOTEL_DB_NAME: hotel_db',
    '      HOTEL_DB_USER: root',
    '      HOTEL_DB_PASS: root',
    '',
  ].join('\n');
}

function springReadme(meta) {
  return [
    '# ' + (meta.title || 'Spring Boot 项目'),
    '',
    '> 本部署说明由「技术驿站 · 作品上线」自动补齐（' + new Date().toLocaleString('zh-CN') + '）。',
    '',
    '## 环境要求',
    '- JDK 17+、Maven 3.6+、MySQL 8（Redis 可选）',
    '',
    '## 本地运行',
    '```',
    'mvn -DskipTests package',
    'java -jar target\\*.jar',
    '```',
    '默认端口 8080；数据库连接见 `src/main/resources/application.yml`，可用环境变量',
    '`HOTEL_DB_HOST` / `HOTEL_DB_PORT` / `HOTEL_DB_NAME` / `HOTEL_DB_USER` / `HOTEL_DB_PASS` 覆盖。',
    '首次启动会自动建表（`ddl-auto: update`）并写入演示数据。',
    '',
    '## 一键容器运行',
    '```',
    'docker compose up -d',
    '```',
    '访问 <http://localhost:8089>，MySQL 映射在 33061 端口。',
    '',
    '## 前端',
    '- 已构建产物位于 `src/main/resources/static`（随 jar 一起提供）',
    '- 前端源码在 `frontend/`，如需改动：`cd frontend && npm install && npm run build`',
    '',
  ].join('\n');
}

function jarDockerfile(jarRel) {
  const jarName = jarRel.split('/').pop();
  return [
    'FROM eclipse-temurin:17-jre',
    'WORKDIR /app',
    'COPY . /app',
    'ENV HOTEL_DB_HOST=db HOTEL_DB_PORT=3306 HOTEL_DB_NAME=hotel_db HOTEL_DB_USER=root HOTEL_DB_PASS=root',
    'EXPOSE 8080',
    'ENTRYPOINT ["java", "-jar", "/app/' + jarName + '"]',
    '',
  ].join('\n');
}

function jarCompose() {
  return [
    'services:',
    '  db:',
    '    image: mysql:8.0',
    '    command: --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci',
    '    environment:',
    '      MYSQL_ROOT_PASSWORD: root',
    '      MYSQL_DATABASE: hotel_db',
    '    ports:',
    '      - "33062:3306"',
    '  app:',
    '    build: .',
    '    ports:',
    '      - "8090:8080"',
    '    depends_on:',
    '      - db',
    '    environment:',
    '      HOTEL_DB_HOST: db',
    '      HOTEL_DB_PORT: "3306"',
    '      HOTEL_DB_NAME: hotel_db',
    '      HOTEL_DB_USER: root',
    '      HOTEL_DB_PASS: root',
    '',
  ].join('\n');
}

function jarReadme(meta) {
  return [
    '# ' + (meta.title || 'Java 运行版'),
    '',
    '> 本部署说明由「技术驿站 · 作品上线」自动补齐（' + new Date().toLocaleString('zh-CN') + '）。',
    '',
    '## 环境要求',
    '- JDK 17+（Spring Boot 3 需要 17 及以上）',
    '- MySQL 8（Redis 可选）',
    '',
    '## 直接启动',
    '```',
    'java -jar *.jar',
    '```',
    '默认 8080 端口；数据库地址可用环境变量 `HOTEL_DB_HOST` 等覆盖，见 `application.yml`。',
    '首次启动会自动建表并写入演示数据。',
    '',
    '## 一键容器运行',
    '```',
    'docker compose up -d',
    '```',
    '访问 <http://localhost:8090>。',
    '',
  ].join('\n');
}

function staticReadme(meta) {
  return [
    '# ' + (meta.title || '静态站点'),
    '',
    '> 本部署说明由「技术驿站 · 作品上线」自动补齐。',
    '',
    '- 纯前端站点，无需后端与数据库',
    '- 已由技术驿站托管，直接访问 `/apps/<slug>/` 即可体验',
    '- 也可把目录内文件整体复制到任意 Web 服务器根目录访问',
    '',
  ].join('\n');
}

/* ---------- 部署 ---------- */
async function appDeploy(file) {
  const f = pkgName(file);
  if (!f) throw Object.assign(new Error('包名不合法'), { status: 400 });
  const zipAbs = path.join(PKG_DIR, f);
  if (!fs.existsSync(zipAbs)) throw Object.assign(new Error('该部署包不存在'), { status: 404 });

  const slug = appSlug(f);
  const src = path.join(APPS_DIR, slug, 'src');
  appStop(slug);

  const man = pkgManifest();
  const pmeta = (man.packages || []).find(x => x.file === f) || {};
  const extra = APP_TITLES[f] || {};
  const meta = {
    slug,
    title: pmeta.title || extra.title || f.replace(/\.zip$/i, '').replace(/\(\d+\)$/, ''),
    desc: pmeta.desc || extra.desc || '',
    stack: pmeta.stack || extra.stack || '',
    version: pmeta.version || extra.version || 'v1.0',
  };

  await unzipTo(zipAbs, src);
  const info = detectApp(src);

  let added = [];
  if (info.mode === 'java-web' && info.kind === 'jsp') {
    added = writeGen(info.projAbs, [
      { name: 'pom.xml', content: jspPom(meta) },
      { name: 'Dockerfile', content: jspDockerfile() },
      { name: 'docker-compose.yml', content: jspCompose() },
      { name: '部署说明.md', content: jspReadme(meta, info) },
    ]);
  } else if (info.mode === 'java-web') {
    added = writeGen(info.projAbs, [
      { name: 'Dockerfile', content: springDockerfile() },
      { name: 'docker-compose.yml', content: springCompose() },
      { name: '部署说明.md', content: springReadme(meta) },
    ]);
  } else if (info.mode === 'jar') {
    added = writeGen(info.projAbs, [
      { name: 'Dockerfile', content: jarDockerfile(info.entryRel) },
      { name: 'docker-compose.yml', content: jarCompose() },
      { name: '部署说明.md', content: jarReadme(meta) },
    ]);
  } else if (info.mode === 'static') {
    added = writeGen(info.rootAbs, [{ name: '部署说明.md', content: staticReadme(meta) }]);
  } else if (info.mode === 'node') {
    added = writeGen(info.projAbs, [{ name: '部署说明.md', content: staticReadme(meta) }]);
  }

  /* 把自动补齐的文件写回原部署包，保证包本身也完整 */
  if (added.length) {
    try {
      await zipAdd(zipAbs, added.map(abs => ({ name: path.relative(src, abs).split(path.sep).join('/'), src: abs })));
      man.updated_at = new Date().toISOString();
      let entry = (man.packages || []).find(x => x.file === f);
      if (!entry) {
        entry = { file: f, title: meta.title, desc: meta.desc, stack: meta.stack, version: meta.version };
        man.packages = man.packages || [];
        man.packages.push(entry);
      }
      entry.gen = (entry.gen || []).concat(added.map(abs => path.basename(abs)).filter(n => !(entry.gen || []).includes(n)));
      fs.writeFileSync(path.join(PKG_DIR, 'manifest.json'), JSON.stringify(man, null, 2));
    } catch (e) {
      console.error('[APP] 回写部署包失败：', e.message);
    }
  }

  const rootSel = info.mode === 'static' ? info.rootAbs : info.projAbs;
  const rec = Object.assign({
    file: f,
    slug,
    title: meta.title,
    desc: meta.desc,
    stack: meta.stack,
    version: meta.version,
    mode: info.mode,
    kind: info.kind || '',
    root: relFromApps(rootSel),
    entry: info.entryRel || '',
    anchor: info.anchor || '',
    gen: added.map(abs => path.basename(abs)),
    port: 0,
    url: '',
    log: '',
    deployAt: new Date().toISOString(),
    startAt: '',
  }, {});

  const d = appsRead();
  const old = d.apps.findIndex(a => a.slug === slug);
  if (info.mode === 'static') {
    rec.status = 'running';
    rec.url = '/apps/' + slug + '/';
    rec.note = '静态站点已托管上线，可直接访问体验';
  } else if (info.mode === 'jar') {
    const hasJava = javaOk();
    rec.status = hasJava ? 'deployed' : 'needs-env';
    rec.note = hasJava
      ? '部署完成，点击「启动」即可运行（端口自动分配）'
      : '本机未检测到 Java 运行环境：部署文件（Dockerfile / compose / 说明）已补全，安装 JDK 17+ 后点击「启动」即可';
  } else if (info.mode === 'node') {
    rec.status = 'deployed';
    rec.note = '部署完成，点击「启动」运行 npm start（端口自动分配）';
  } else if (info.mode === 'java-web') {
    rec.status = 'needs-env';
    rec.note = info.kind === 'jsp'
      ? 'JSP / Servlet 项目：已自动补齐 pom.xml、Dockerfile、docker-compose.yml 与部署说明；需 JDK + Tomcat + MySQL 才能运行'
      : 'Spring Boot 源码：已自动补齐 Dockerfile、docker-compose.yml 与部署说明；需 JDK 17 + Maven + MySQL 才能运行';
  } else {
    rec.status = 'needs-env';
    rec.note = '未能识别项目类型，已保留完整解压目录，请参考包内部署说明';
  }

  if (old >= 0) {
    const prev = d.apps[old];
    rec.hidden = !!prev.hidden;
    rec.orderCount = prev.orderCount || 0;
    rec.lastOrderAt = prev.lastOrderAt || '';
    rec.orders = prev.orders || [];
    d.apps[old] = rec;
  } else {
    d.apps.push(rec);
  }
  appsWrite(d);
  return rec;
}

/* ---------- 运行时 ---------- */
const APP_RT = new Map();

function javaOk() {
  const r = spawnSync('java', ['-version'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
  return !r.error && r.status === 0;
}
function npmOk() {
  const r = spawnSync(process.env.ComSpec || 'cmd.exe', ['/c', 'npm -v'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
  return !r.error && r.status === 0;
}

function freePort(from = 4010) {
  return new Promise(resolve => {
    let p = from;
    const next = () => {
      if (p > 4300) return resolve(0);
      const s = net.createServer();
      s.once('error', () => { s.close(); p += 1; next(); });
      s.once('listening', () => s.close(() => resolve(p)));
      s.listen(p, '127.0.0.1');
    };
    next();
  });
}

function waitPort(port, timeout = 60000) {
  const t0 = Date.now();
  return new Promise(resolve => {
    const tick = () => {
      if (Date.now() - t0 > timeout) return resolve(false);
      const s = net.connect({ port, host: '127.0.0.1' });
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        try { s.destroy(); } catch (_) {}
        if (ok) return resolve(true);
        setTimeout(tick, 700);
      };
      s.once('connect', () => finish(true));
      s.once('error', () => finish(false));
      setTimeout(() => finish(false), 1200);
    };
    tick();
  });
}

function killTree(pid) {
  if (!pid) return;
  try { spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { timeout: 8000, windowsHide: true }); } catch (_) {}
}

function appStop(slug) {
  const rt = APP_RT.get(slug);
  if (rt) {
    if (rt.child && rt.child.pid) killTree(rt.child.pid);
    APP_RT.delete(slug);
  }
}

async function appStart(slug) {
  const d = appsRead();
  const rec = d.apps.find(a => a.slug === slug);
  if (!rec) throw Object.assign(new Error('该作品尚未部署'), { status: 404 });
  appStop(slug);

  if (rec.mode === 'static') {
    rec.status = 'running';
    rec.url = '/apps/' + slug + '/';
    rec.note = '静态站点已托管上线，可直接访问体验';
    appsWrite(d);
    return rec;
  }
  if (rec.mode === 'java-web' || rec.mode === 'unknown') {
    rec.status = 'needs-env';
    rec.note = rec.mode === 'java-web'
      ? '需 JDK + Maven/Tomcat + MySQL 环境；部署文件已自动补齐，可照包内「部署说明.md」运行'
      : '未能识别项目类型，无法自动启动';
    appsWrite(d);
    return rec;
  }
  if (rec.mode === 'jar' && !javaOk()) {
    rec.status = 'needs-env';
    rec.note = '本机未检测到 Java 运行环境，请安装 JDK 17+ 后重试（部署文件已补全）';
    appsWrite(d);
    return rec;
  }
  if (rec.mode === 'node' && !npmOk()) {
    rec.status = 'needs-env';
    rec.note = '本机未检测到 npm，请安装 Node.js 18+ 后重试';
    appsWrite(d);
    return rec;
  }

  const port = await freePort();
  if (!port) {
    rec.status = 'error';
    rec.note = '4000-4300 端口已全部占用，无法分配运行端口';
    appsWrite(d);
    return rec;
  }

  const cwd = path.join(APPS_DIR, rec.root);
  const lines = [];
  const push = s => {
    if (!s) return;
    for (const ln of String(s).split(/\r?\n/)) {
      if (ln.trim()) lines.push(ln.slice(0, 400));
    }
    while (lines.length > 300) lines.shift();
  };

  let child;
  if (rec.mode === 'jar') {
    const jarAbs = path.join(APPS_DIR, rec.root, rec.entry);
    child = spawn('java', ['-jar', jarAbs, '--server.port=' + port, '--spring.profiles.active=default'], {
      cwd, windowsHide: true, env: Object.assign({}, process.env, { SERVER_PORT: String(port) }),
    });
  } else {
    child = spawn(process.env.ComSpec || 'cmd.exe', ['/c', 'npm start'], {
      cwd, windowsHide: true,
      env: Object.assign({}, process.env, { PORT: String(port), HOST: '127.0.0.1', BROWSER: 'none' }),
    });
  }

  const rt = { child, port, lines, text: () => lines.join('\n') };
  APP_RT.set(slug, rt);
  child.stdout.on('data', d2 => push(d2.toString()));
  child.stderr.on('data', d2 => push(d2.toString()));
  child.on('error', e => { push('[spawn] ' + e.message); });
  child.on('exit', code => {
    if (APP_RT.get(slug) !== rt) return;
    APP_RT.delete(slug);
    const cur = appsRead();
    const r2 = cur.apps.find(a => a.slug === slug);
    if (r2 && r2.status === 'running') {
      r2.status = 'stopped';
      r2.note = '进程已退出（code ' + code + '），可重新启动；日志见末尾';
      r2.log = lines.slice(-40).join('\n');
      appsWrite(cur);
    }
  });

  const ok = await waitPort(port, 60000);
  const cur = appsRead();
  const r2 = cur.apps.find(a => a.slug === slug);
  if (r2) {
    Object.assign(r2, {
      port, url: '/apps/' + slug + '/',
      startAt: new Date().toISOString(),
      pid: child.pid || 0,
      status: ok ? 'running' : 'error',
      note: ok ? '运行中，端口 ' + port : '启动超时（60 秒内端口未就绪），请查看日志排查',
      log: lines.slice(-40).join('\n'),
    });
    appsWrite(cur);
  }
  return appsRead().apps.find(a => a.slug === slug);
}

/* ---------- 静态站点 / 服务代理 ---------- */
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function infoPage(rec) {
  const badges = {
    running: '🟢 运行中', deployed: '🔵 已部署 · 待启动', 'needs-env': '🟡 需环境支持', error: '🔴 启动异常', stopped: '⚪ 已停止', pending: '⚪ 未部署',
  };
  const mode = MODE_LABEL[rec.mode] || rec.mode;
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(rec.title) + '</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050a12;color:#e8f1ff;'
    + 'font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}'
    + '.c{max-width:560px;padding:28px 30px;border:1px solid rgba(77,159,255,.28);border-radius:16px;background:linear-gradient(180deg,#0e1a2b,#08111d);box-shadow:0 18px 50px rgba(0,0,0,.5)}'
    + 'h1{font-size:18px;margin:0 0 6px}p{font-size:13px;line-height:1.85;color:#8ba0bd;margin:6px 0}'
    + '.b{display:inline-block;margin:10px 0 14px;padding:4px 12px;border-radius:999px;font-size:12px;background:rgba(77,159,255,.12);border:1px solid rgba(77,159,255,.3);color:#9fc5ff}'
    + 'code{background:rgba(255,255,255,.06);padding:2px 6px;border-radius:5px;font-size:12px}</style></head><body><div class="c">'
    + '<h1>' + esc(rec.title) + '</h1>'
    + '<span class="b">' + (badges[rec.status] || rec.status) + ' · ' + esc(mode) + '</span>'
    + '<p>' + esc(rec.note || '该作品暂未上线') + '</p>'
    + (rec.desc ? '<p>' + esc(rec.desc) + '</p>' : '')
    + (rec.mode === 'java-web' ? '<p>可照包内 <code>部署说明.md</code> 运行：初始化 MySQL → <code>mvn package</code> → 部署 war/jar，或直接 <code>docker compose up -d</code>。</p>' : '')
    + '</div></body></html>';
}

function serveStaticApp(rec, req, res) {
  const root = path.join(APPS_DIR, rec.root);
  let rel = req.path || '/';
  try { rel = decodeURIComponent(rel); } catch (_) {}
  if (!rel || rel === '/') rel = '/index.html';
  const abs = path.resolve(root, '.' + rel);
  if (abs !== root && !abs.startsWith(root + path.sep)) return res.status(403).send('Forbidden');
  let st = null;
  try { st = fs.statSync(abs); } catch (_) {}
  if (st && st.isFile()) {
    res.setHeader('Content-Type', APP_MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    return fs.createReadStream(abs).pipe(res);
  }
  const idx = path.join(root, 'index.html');
  if (!path.extname(rel) && fs.existsSync(idx)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return fs.createReadStream(idx).pipe(res);
  }
  return res.status(404).type('html').send('<!DOCTYPE html><meta charset="utf-8"><p style="font-family:sans-serif">未找到该资源</p>');
}

function proxyApp(rec, req, res) {
  const prefix = '/apps/' + rec.slug;
  let p = (req.originalUrl || '/').slice(prefix.length) || '/';
  if (!p.startsWith('/')) p = '/' + p;
  const headers = Object.assign({}, req.headers, { host: '127.0.0.1:' + rec.port });
  // express.json 已经消费了请求体，这里改用缓存的原始字节转发，否则上游会一直等待 body
  const body = !['GET', 'HEAD'].includes(req.method) && Buffer.isBuffer(req.rawBody) ? req.rawBody : null;
  if (body) {
    headers['content-length'] = String(body.length);
    delete headers['transfer-encoding'];
  }
  const up = http.request({ host: '127.0.0.1', port: rec.port, path: p, method: req.method, headers }, r => {
    const h = Object.assign({}, r.headers);
    if (h.location && h.location.startsWith('/')) h.location = prefix + h.location;
    res.writeHead(r.statusCode || 502, h);
    r.pipe(res);
  });
  up.on('error', () => {
    if (!res.headersSent) res.status(502).type('html').send(infoPage(appFind(rec.slug) || rec));
    else try { res.end(); } catch (_) {}
  });
  if (body) up.end(body);
  else req.pipe(up);
}

app.use('/apps/:slug', (req, res, next) => {
  const rec = appFind(req.params.slug);
  if (!rec) return next();
  if (rec.mode === 'static') return serveStaticApp(rec, req, res);
  if (rec.mode === 'node' || rec.mode === 'jar') {
    if (rec.status === 'running' && rec.port) return proxyApp(rec, req, res);
    return res.status(200).type('html').send(infoPage(rec));
  }
  return res.status(200).type('html').send(infoPage(rec));
});

/* ---------- 我的作品：公开体验清单 ---------- */
function showcaseList() {
  const data = appsRead();
  const map = new Map(data.apps.map(a => [a.slug, a]));
  const out = [];
  for (const p of pkgList()) {
    const rec = map.get(appSlug(p.file));
    if (rec && rec.hidden) continue;
    if (!rec) {
      out.push({
        slug: appSlug(p.file), file: p.file, title: p.title, desc: p.desc, stack: p.stack,
        version: p.version, size: p.size, mode: 'pending', status: 'pending',
        url: '', port: 0, note: '已导入部署包，在「作品管理」点击「上线」即可体验',
      });
      continue;
    }
    out.push({
      slug: rec.slug, file: p.file, title: rec.title || p.title, desc: rec.desc || p.desc,
      stack: rec.stack || p.stack, version: rec.version || p.version, size: p.size,
      mode: rec.mode, status: rec.status, url: rec.status === 'running' ? '/apps/' + rec.slug + '/' : '',
      port: rec.port || 0, note: rec.note || '', deployAt: rec.deployAt || '',
    });
  }
  return out;
}

app.get('/api/works/showcase', (req, res) => res.json({ list: showcaseList() }));

/* 下单：记录到作品上，管理端「作品管理」可查看下单状态 */
app.post('/api/works/order', (req, res) => {
  const slug = String((req.body && req.body.slug) || '');
  const rec = appFind(slug);
  if (!rec) return res.status(404).json({ error: '该作品尚未部署' });
  const at = new Date().toISOString();
  const entry = { id: crypto.randomBytes(6).toString('hex'), at, user: req.user ? req.user.name : '游客', ip: String(clientIp(req) || '').replace(/^::ffff:/, ''), note: String((req.body && req.body.note) || '').trim().slice(0, 200), processed: false };
  const orders = [...(rec.orders || []).slice(-19), entry];
  const updated = appPatch(slug, {
    orders,
    orderCount: (rec.orderCount || 0) + 1,
    lastOrderAt: at,
  });
  res.json({ ok: true, app: updated });
});

/* ---------- 管理端：部署 / 启停 / 下线 ---------- */
app.get('/api/admin/apps', needAdmin, (req, res) => {
  const list = appsRead().apps.map(a => Object.assign({}, a, {
    alive: !!(APP_RT.get(a.slug) && APP_RT.get(a.slug).child),
  }));
  res.json({ list });
});

app.post('/api/admin/works/packages/:file/deploy', needAdmin, async (req, res) => {
  const rec = await appDeploy(req.params.file);
  res.json({ ok: true, app: rec });
});

app.post('/api/admin/apps/:slug/start', needAdmin, async (req, res) => {
  const rec = await appStart(req.params.slug);
  res.json({ ok: true, app: rec });
});

app.post('/api/admin/apps/:slug/stop', needAdmin, (req, res) => {
  appStop(req.params.slug);
  const rec = appPatch(req.params.slug, { status: 'deployed', port: 0, note: '已停止，可随时重新启动' });
  if (!rec) return res.status(404).json({ error: '该作品尚未部署' });
  res.json({ ok: true, app: rec });
});

app.post('/api/admin/apps/:slug/hide', needAdmin, (req, res) => {
  const hidden = !(req.body && req.body.hidden === false);
  const rec = appPatch(req.params.slug, { hidden });
  if (!rec) return res.status(404).json({ error: '该作品尚未部署' });
  res.json({ ok: true, app: rec });
});

/* 下单区：实时汇总全部作品的下单记录，处理状态由人工确认 */
const orderId = (slug, o) => o.id || (slug + '#' + o.at);

app.get('/api/admin/orders', needAdmin, (req, res) => {
  const list = [];
  for (const a of appsRead().apps) {
    for (const o of (a.orders || [])) {
      list.push({
        id: orderId(a.slug, o),
        slug: a.slug,
        title: a.title || a.file || a.slug,
        at: o.at || '',
        user: o.user || '游客',
        ip: o.ip || '',
        note: o.note || '',
        processed: !!o.processed,
      });
    }
  }
  list.sort((x, y) => String(y.at).localeCompare(String(x.at)));
  res.json({ list, total: list.length, pending: list.filter(x => !x.processed).length });
});

app.post('/api/admin/orders/:id/process', needAdmin, (req, res) => {
  const wanted = String(req.params.id);
  const processed = !(req.body && req.body.processed === false);
  const d = appsRead();
  let hit = false;
  for (const a of d.apps) {
    for (const o of (a.orders || [])) {
      if (orderId(a.slug, o) === wanted) { o.processed = processed; hit = true; }
    }
  }
  if (!hit) return res.status(404).json({ error: '下单记录不存在' });
  appsWrite(d);
  res.json({ ok: true, processed });
});

app.delete('/api/admin/apps/:slug', needAdmin, (req, res) => {
  const rec = appFind(req.params.slug);
  if (!rec) return res.status(404).json({ error: '该作品尚未部署' });
  appStop(req.params.slug);
  try { fs.rmSync(path.join(APPS_DIR, rec.slug), { recursive: true, force: true }); } catch (_) {}
  const d = appsRead();
  d.apps = d.apps.filter(a => a.slug !== rec.slug);
  appsWrite(d);
  res.json({ ok: true });
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
app.get('/works.html', noIndex, (req, res) => res.sendFile(path.join(ROOT, 'works.html')));
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
