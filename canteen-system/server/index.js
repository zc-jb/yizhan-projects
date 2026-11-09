'use strict';

/**
 * 橙味食堂 · 点餐系统服务端
 * ------------------------------------------------------------------
 * Express + MySQL + WebSocket + 可选 Redis
 * 启动：npm start（等价于 node server/index.js），默认监听 8200。
 */

const path = require('path');
const http = require('http');
const express = require('express');

const cache = require('./cache');
const db = require('./db');
const { setupWebSocket } = require('./ws');

const PORT = Number(process.env.PORT) || 8200;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function isAdmin(req) {
  // 演示项目：前端登录管理员后携带 x-role: admin 头，后端据此做轻量校验
  return req.get('x-role') === 'admin';
}

function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // ---------------- 健康检查
  app.get(
    '/api/health',
    wrap(async (req, res) => {
      res.json({
        ok: true,
        service: 'canteen-system',
        cacheMode: cache.getMode(),
        wsMode: app.locals.hub ? app.locals.hub.mode : 'none',
        online: app.locals.hub ? app.locals.hub.clientCount : 0,
        time: new Date().toISOString()
      });
    })
  );

  // ---------------- 登录（管理员 / 手机号体验 / 游客）
  app.post(
    '/api/login',
    wrap(async (req, res) => {
      const body = req.body || {};

      if (body.username !== undefined || body.password !== undefined) {
        const username = String(body.username || '').trim();
        const password = String(body.password || '');
        if (username === 'admin' && password === '123456') {
          return res.json({
            data: { role: 'admin', name: '管理员', username: 'admin', phone: '' }
          });
        }
        return fail(res, 401, '账号或密码错误');
      }

      if (body.guest) {
        return res.json({
          data: {
            role: 'customer',
            name: '游客',
            phone: 'guest_' + Date.now().toString(36) + Math.floor(Math.random() * 90 + 10)
          }
        });
      }

      const phone = String(body.phone || '').trim();
      if (!/^\d{6,15}$/.test(phone)) return fail(res, 400, '请输入正确的手机号');

      return res.json({
        data: { role: 'customer', name: '顾客' + phone.slice(-4), phone }
      });
    })
  );

  // ---------------- 菜品
  app.get(
    '/api/dishes',
    wrap(async (req, res) => {
      const includeOff = req.query.all === '1' && isAdmin(req);
      let list = await db.listDishes({ includeOff });

      if (req.query.category) {
        list = list.filter((d) => d.category === req.query.category);
      }
      if (req.query.hot === '1') {
        list = list.filter((d) => d.isHot);
      }
      res.json({ data: list });
    })
  );

  app.post(
    '/api/dishes',
    wrap(async (req, res) => {
      if (!isAdmin(req)) return fail(res, 403, '无权限：请使用管理员账号登录');
      const dish = await db.createDish(req.body || {});
      broadcast(app, { type: 'dish_change', data: dish, at: Date.now() });
      res.status(201).json({ data: dish });
    })
  );

  app.put(
    '/api/dishes/:id',
    wrap(async (req, res) => {
      if (!isAdmin(req)) return fail(res, 403, '无权限：请使用管理员账号登录');
      const dish = await db.updateDish(Number(req.params.id), req.body || {});
      broadcast(app, { type: 'dish_change', data: dish, at: Date.now() });
      res.json({ data: dish });
    })
  );

  app.delete(
    '/api/dishes/:id',
    wrap(async (req, res) => {
      if (!isAdmin(req)) return fail(res, 403, '无权限：请使用管理员账号登录');
      const result = await db.deleteDish(Number(req.params.id));
      broadcast(app, { type: 'dish_change', data: result, at: Date.now() });
      res.json({ data: result });
    })
  );

  // ---------------- 订单
  app.get(
    '/api/orders',
    wrap(async (req, res) => {
      const statuses = req.query.status
        ? String(req.query.status)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : null;
      const phone = req.query.phone !== undefined ? String(req.query.phone) : null;
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

      const list = await db.listOrders({ statuses, phone, limit });
      res.json({ data: list });
    })
  );

  app.post(
    '/api/orders',
    wrap(async (req, res) => {
      const body = req.body || {};
      const order = await db.createOrder({
        items: body.items,
        tableNo: body.tableNo,
        phone: body.phone,
        remark: body.remark
      });
      // 实时推送到厨房看板与所有已连接页面
      broadcast(app, { type: 'new_order', data: order, at: Date.now() });
      res.status(201).json({ data: order });
    })
  );

  app.put(
    '/api/orders/:id/status',
    wrap(async (req, res) => {
      const status = String((req.body || {}).status || '');
      const order = await db.updateOrderStatus(Number(req.params.id), status);
      broadcast(app, { type: 'order_update', data: order, at: Date.now() });
      res.json({ data: order });
    })
  );

  // ---------------- 运营统计（演示用）
  app.get(
    '/api/stats',
    wrap(async (req, res) => {
      res.json({ data: await db.getStats() });
    })
  );

  // ---------------- 静态前端
  app.use(
    express.static(PUBLIC_DIR, {
      index: 'index.html',
      maxAge: 0,
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache')
    })
  );

  // 接口 404
  app.use('/api', (req, res) => fail(res, 404, '接口不存在'));

  // 其他未知路径回首页（便于体验页直接访问任意路径）
  app.get('*', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  // 统一错误处理：始终返回 { error: '...' }
  app.use((err, req, res, next) => {
    const status = err && err.status ? err.status : 500;
    if (status >= 500) console.error('[server] 请求异常：', err);
    if (res.headersSent) return next(err);
    res.status(status).json({ error: (err && err.message) || '服务器内部错误' });
  });

  return app;
}

function broadcast(app, payload) {
  try {
    const hub = app.locals.hub;
    if (hub) hub.broadcast(payload);
  } catch (err) {
    console.warn('[ws] 广播失败：', err.message);
  }
}

async function main() {
  await cache.init();
  await db.init();

  const app = await createApp();
  const server = http.createServer(app);
  const hub = setupWebSocket(server);
  app.locals.hub = hub;

  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('  橙味食堂 · 点餐系统已启动');
    console.log(`  本地访问：http://127.0.0.1:${PORT}`);
    console.log(`  API 健康检查：http://127.0.0.1:${PORT}/api/health`);
    console.log(`  缓存模式：${cache.getMode()}（Redis 不可用时自动内存降级）`);
    console.log(`  WebSocket：ws://127.0.0.1:${PORT}/ws（${hub.mode}）`);
    console.log('');
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] 收到 ${signal}，正在关闭服务...`);
    try {
      hub.close();
    } catch (err) {}
    server.close(async () => {
      try {
        await db.close();
        await cache.close();
      } catch (err) {}
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 3000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (err) => {
  console.error('[server] 未处理的 Promise 异常：', err);
});

main().catch((err) => {
  console.error('[server] 启动失败：', err);
  process.exit(1);
});
