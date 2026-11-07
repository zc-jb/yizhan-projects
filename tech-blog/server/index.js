import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import url from 'node:url';
import dotenv from 'dotenv';
import { pool, initSchema, ensureDatabase } from './db.js';

dotenv.config();

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.json({ limit: '200kb' }));

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
const CODE_PLAN = { 6: 'once', 18: 'week', 59: 'month', 666: 'year' };
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
        `SELECT u.id, u.username, u.is_guest FROM sessions s
         JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
        [token]
      );
      if (rows[0]) req.user = { id: rows[0].id, name: rows[0].username, guest: !!rows[0].is_guest };
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

  const [used] = await pool.query('SELECT code FROM codes WHERE code=?', [code]);
  if (used[0]) return res.status(409).json({ error: '该开通码已被使用，每个码仅限一次' });

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
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/keygen.html', (req, res) => res.sendFile(path.join(ROOT, 'keygen.html')));
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
  app.listen(PORT, () => console.log(`✔ 技术驿站已启动: http://localhost:${PORT}`));
})();
