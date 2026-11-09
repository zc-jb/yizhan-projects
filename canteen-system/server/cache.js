'use strict';

/**
 * 缓存层（Redis + 内存自动降级）
 * ------------------------------------------------------------------
 * 设计目标：
 * 1. 存在 ioredis 且能连上本地 Redis 时，使用 Redis 做菜单缓存与订单号自增；
 * 2. 未安装 ioredis / Redis 未启动 / 运行中连接断开时，自动降级到进程内 Map，
 *    任何情况下都不能因为缓存不可用而导致服务启动失败。
 * 3. 对外只暴露简单的异步接口，业务层不需要关心底层是哪一种实现。
 */

const ORDER_SEQ_PREFIX = 'canteen:order:seq:';
const ORDER_SEQ_TTL = 60 * 60 * 24 * 2; // 订单号序列保留 2 天

const memory = new Map(); // 结构：key -> { value, expireAt }
let memorySeq = 0;
let client = null;
let mode = 'memory';

// 读取内存缓存，顺带处理过期
function memoryGet(key) {
  const item = memory.get(key);
  if (!item) return null;
  if (item.expireAt && item.expireAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return item.value;
}

// 写入内存缓存
function memorySet(key, value, ttlSeconds) {
  memory.set(key, {
    value,
    expireAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0
  });
}

// 定期清理过期键，避免长时间运行时 Map 无限增长
const cleaner = setInterval(() => {
  const now = Date.now();
  for (const [key, item] of memory) {
    if (item.expireAt && item.expireAt < now) memory.delete(key);
  }
}, 60 * 1000);
if (typeof cleaner.unref === 'function') cleaner.unref();

// Redis 运行中出错时，切换到内存模式，保证服务继续可用
function degrade(reason) {
  if (mode === 'redis') {
    console.warn('[cache] Redis 连接异常，已降级为内存缓存：', reason && reason.message ? reason.message : reason);
  }
  mode = 'memory';
  client = null;
}

async function init() {
  let Redis = null;
  try {
    // 动态加载：未安装 ioredis 时直接走降级分支，不影响启动
    Redis = require('ioredis');
  } catch (err) {
    console.log('[cache] 未安装 ioredis，使用进程内内存缓存');
    return mode;
  }

  try {
    client = new Redis({
      host: '127.0.0.1',
      port: 6379,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      connectTimeout: 1500,
      retryStrategy: () => null // 连不上就不再重连，直接降级
    });
    // 必须监听 error，否则未处理的 error 事件会让进程崩溃
    client.on('error', () => {});
    client.on('end', () => degrade('连接已关闭'));
    await client.connect();
    await client.ping();
    mode = 'redis';
    console.log('[cache] Redis 已连接，菜单缓存与订单号将使用 Redis');
  } catch (err) {
    try {
      if (client) client.disconnect();
    } catch (e) {}
    degrade(err);
    client = null;
    console.log('[cache] Redis 不可用（' + (err.message || err) + '），已降级为内存缓存');
  }
  return mode;
}

async function get(key) {
  if (mode === 'redis' && client) {
    try {
      return await client.get(key);
    } catch (err) {
      degrade(err);
    }
  }
  return memoryGet(key);
}

async function set(key, value, ttlSeconds) {
  if (mode === 'redis' && client) {
    try {
      if (ttlSeconds) await client.set(key, value, 'EX', ttlSeconds);
      else await client.set(key, value);
      return;
    } catch (err) {
      degrade(err);
    }
  }
  memorySet(key, value, ttlSeconds);
}

async function del(key) {
  if (mode === 'redis' && client) {
    try {
      await client.del(key);
    } catch (err) {
      degrade(err);
    }
  }
  memory.delete(key);
}

/**
 * 生成订单号
 * Redis 可用：使用 INCR 生成当日自增序号（原子、跨进程唯一）
 * 降级方案：日期 + 时间戳 + 进程内自增，保证单机唯一
 */
async function incrOrderNo() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const date = `${y}${m}${d}`;

  if (mode === 'redis' && client) {
    try {
      const key = ORDER_SEQ_PREFIX + date;
      const seq = await client.incr(key);
      if (seq === 1) await client.expire(key, ORDER_SEQ_TTL);
      return `C${date}${String(seq).padStart(4, '0')}`;
    } catch (err) {
      degrade(err);
    }
  }

  // 内存降级：时间戳后 6 位 + 3 位自增，重启后也不会与历史订单号冲突
  memorySeq = (memorySeq + 1) % 1000;
  return `C${date}${String(Date.now()).slice(-6)}${String(memorySeq).padStart(3, '0')}`;
}

function getMode() {
  return mode;
}

async function close() {
  if (client) {
    try {
      await client.quit();
    } catch (err) {
      try {
        client.disconnect();
      } catch (e) {}
    }
    client = null;
  }
  clearInterval(cleaner);
}

module.exports = { init, get, set, del, incrOrderNo, getMode, close };
