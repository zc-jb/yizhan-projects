/* 轻量防抓取：限流、来源校验、口令爆破锁定。全部内存态，无需额外依赖。 */

export function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/* 固定窗口限流：同一 IP 在 windowMs 内最多 max 次 */
export function limiter({ max, windowMs }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
  }, windowMs);
  if (timer.unref) timer.unref();

  return (req, res, next) => {
    const ip = clientIp(req);
    const now = Date.now();
    let rec = hits.get(ip);
    if (!rec || now > rec.reset) {
      rec = { count: 0, reset: now + windowMs };
      hits.set(ip, rec);
    }
    rec.count++;

    const left = Math.max(0, max - rec.count);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', left);

    if (rec.count > max) {
      res.setHeader('Retry-After', Math.ceil((rec.reset - now) / 1000));
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }
    next();
  };
}

/* 只允许来自本站页面的写请求，挡掉跨站批量调用 */
export function sameOrigin(req, res, next) {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'DELETE') return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  let host = '';
  try { host = new URL(origin).host; } catch (_) { return res.status(403).json({ error: '非法的请求来源' }); }
  if (host !== req.headers.host) return res.status(403).json({ error: '非法的请求来源' });
  next();
}

/* 站长口令爆破锁定：连续失败 maxFails 次后锁 lockMs */
export function makeAdminGuard({ maxFails = 8, lockMs = 10 * 60 * 1000 } = {}) {
  const fails = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of fails) if (v.count < maxFails || now > v.until) fails.delete(k);
  }, 60 * 1000);
  if (timer.unref) timer.unref();

  return {
    locked(ip) {
      const f = fails.get(ip);
      return !!f && f.count >= maxFails && Date.now() < f.until;
    },
    fail(ip) {
      const now = Date.now();
      const f = fails.get(ip) || { count: 0, until: 0 };
      if (f.until && now > f.until) { f.count = 0; f.until = 0; }
      f.count++;
      if (f.count >= maxFails) f.until = now + lockMs;
      fails.set(ip, f);
      return Math.max(0, maxFails - f.count);
    },
    clear(ip) { fails.delete(ip); },
  };
}
