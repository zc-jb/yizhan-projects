'use strict';

/**
 * 数据访问层
 * ------------------------------------------------------------------
 * 启动时自动：建库 canteen_db -> 建表 -> 插入演示菜品。
 * 所有 SQL 均使用 utf8mb4，保证中文与 emoji 正常存取。
 */

const mysql = require('mysql2/promise');
const cache = require('./cache');

const DB_NAME = 'canteen_db';
const CONNECTION = {
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '',
  charset: 'utf8mb4'
};

const STATUS_TEXT = {
  pending: '待制作',
  cooking: '制作中',
  done: '已完成',
  cancelled: '已取消'
};

const MENU_CACHE_KEY = 'canteen:menu:active';
const MENU_ALL_CACHE_KEY = 'canteen:menu:all';

let pool = null;

/** 演示菜品：覆盖 主食 / 小吃 / 饮品 / 套餐 四个分类，其中 4 款标记为热销 */
const SEED_DISHES = [
  ['黑椒牛柳饭', '主食', 28.0, '🥩', '现煎牛柳 · 黑椒浓香', 'linear-gradient(135deg,#ffd6a5,#ff9a62)', 1, 328],
  ['番茄鸡蛋面', '主食', 18.0, '🍜', '酸甜番茄 · 手工细面', 'linear-gradient(135deg,#ffe8b0,#ffb36b)', 0, 156],
  ['台式卤肉饭', '主食', 22.0, '🍛', '慢卤五花 · 酱香入味', 'linear-gradient(135deg,#f7c59f,#e08c48)', 1, 256],
  ['香辣鸡腿饭', '主食', 26.0, '🍗', '大块鸡腿 · 香辣过瘾', 'linear-gradient(135deg,#ffd0a1,#ff7b4a)', 0, 198],
  ['黄金脆薯条', '小吃', 12.0, '🍟', '外脆里糯 · 现炸出锅', 'linear-gradient(135deg,#ffe9a8,#ffc24d)', 0, 142],
  ['香酥鸡米花', '小吃', 16.0, '🍿', '一口一个 · 酥到掉渣', 'linear-gradient(135deg,#ffdfb0,#ffb066)', 0, 97],
  ['手工鲜肉煎饺', '小吃', 14.0, '🥟', '现包现煎 · 底部焦脆', 'linear-gradient(135deg,#ffe3c2,#f2a65a)', 0, 88],
  ['芝士烤肠', '小吃', 10.0, '🌭', '爆汁烤肠 · 芝士拉丝', 'linear-gradient(135deg,#ffd9b8,#ff9a76)', 0, 76],
  ['冰镇柠檬茶', '饮品', 9.0, '🍋', '手打柠檬 · 清爽解腻', 'linear-gradient(135deg,#e4f7b0,#a8d860)', 1, 412],
  ['鲜榨橙汁', '饮品', 12.0, '🍊', '当季鲜橙 · 无额外加糖', 'linear-gradient(135deg,#ffe0a3,#ffab3d)', 0, 205],
  ['芋泥波波奶茶', '饮品', 15.0, '🧋', '绵密芋泥 · Q弹波波', 'linear-gradient(135deg,#e6d4ff,#b79ae8)', 0, 233],
  ['双人畅享套餐', '套餐', 58.0, '🍱', '两荤一素 · 附赠饮品', 'linear-gradient(135deg,#ffcf9e,#ff8a5c)', 1, 189],
  ['一人食元气餐', '套餐', 32.0, '🍚', '荤素搭配 · 工作餐首选', 'linear-gradient(135deg,#ffe6b8,#f9b95c)', 0, 264],
  ['下午茶小食盒', '套餐', 25.0, '🍰', '三款小食 · 甜咸都有', 'linear-gradient(135deg,#ffd9e6,#ff9fbd)', 0, 71]
];

// ---------------------------------------------------------------- 初始化

async function init() {
  // 第一步：不指定数据库连接，创建 canteen_db
  const conn = await mysql.createConnection(CONNECTION);
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.end();

  // 第二步：创建连接池
  pool = mysql.createPool({
    ...CONNECTION,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: false
  });

  await createTables();
  await seedIfEmpty();
  console.log(`[db] ${DB_NAME} 初始化完成，菜单数据已就绪`);
}

async function createTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dish (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(60) NOT NULL,
      category VARCHAR(20) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      emoji VARCHAR(16) NOT NULL DEFAULT '🍽️',
      description VARCHAR(200) NOT NULL DEFAULT '',
      gradient VARCHAR(160) NOT NULL DEFAULT '',
      is_hot TINYINT NOT NULL DEFAULT 0,
      status TINYINT NOT NULL DEFAULT 1 COMMENT '1=上架 0=下架',
      sales INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_dish_category (category)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // order 是 MySQL 关键字，表名统一用反引号包裹
  await pool.query(`
    CREATE TABLE IF NOT EXISTS \`order\` (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      order_no VARCHAR(32) NOT NULL,
      table_no VARCHAR(20) NOT NULL DEFAULT '',
      phone VARCHAR(32) NOT NULL DEFAULT '',
      amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      remark VARCHAR(200) NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_order_no (order_no),
      KEY idx_order_status (status),
      KEY idx_order_phone (phone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // order_item 不建外键：删除菜品时历史订单明细仍需保留快照
  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_item (
      id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      order_id INT UNSIGNED NOT NULL,
      dish_id INT UNSIGNED NOT NULL,
      dish_name VARCHAR(60) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      qty INT NOT NULL DEFAULT 1,
      emoji VARCHAR(16) NOT NULL DEFAULT '',
      KEY idx_item_order (order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function seedIfEmpty() {
  const [rows] = await pool.query('SELECT COUNT(*) AS total FROM dish');
  if (rows[0].total > 0) return;

  const values = SEED_DISHES.map((d) => [...d]);
  await pool.query(
    `INSERT INTO dish (name, category, price, emoji, description, gradient, is_hot, sales)
     VALUES ?`,
    [values]
  );
  console.log(`[db] 已写入 ${values.length} 条演示菜品数据`);
}

// ---------------------------------------------------------------- 映射

function mapDish(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    emoji: row.emoji,
    description: row.description || '',
    gradient: row.gradient || '',
    isHot: !!row.is_hot,
    status: row.status,
    sales: row.sales
  };
}

function mapItem(row) {
  return {
    id: row.id,
    dishId: row.dish_id,
    name: row.dish_name,
    price: Number(row.price),
    qty: row.qty,
    emoji: row.emoji || '🍽️'
  };
}

function mapOrder(row, items) {
  return {
    id: row.id,
    orderNo: row.order_no,
    tableNo: row.table_no,
    phone: row.phone,
    amount: Number(row.amount),
    status: row.status,
    statusText: STATUS_TEXT[row.status] || row.status,
    remark: row.remark || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items || []
  };
}

// ---------------------------------------------------------------- 菜品

async function invalidateMenu() {
  await Promise.all([cache.del(MENU_CACHE_KEY), cache.del(MENU_ALL_CACHE_KEY)]);
}

async function listDishes({ includeOff = false } = {}) {
  const key = includeOff ? MENU_ALL_CACHE_KEY : MENU_CACHE_KEY;

  // 先读缓存；Redis 不可用时 cache 层内部自动走内存
  const cached = await cache.get(key);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (err) {
      // 缓存内容异常则忽略，继续查库
    }
  }

  const sql = includeOff
    ? 'SELECT * FROM dish ORDER BY is_hot DESC, id ASC'
    : 'SELECT * FROM dish WHERE status = 1 ORDER BY is_hot DESC, id ASC';
  const [rows] = await pool.query(sql);
  const data = rows.map(mapDish);

  // 菜单缓存 60 秒；菜品变更时会主动失效
  await cache.set(key, JSON.stringify(data), 60);
  return data;
}

async function getDishById(id) {
  const [rows] = await pool.query('SELECT * FROM dish WHERE id = ?', [id]);
  return rows.length ? mapDish(rows[0]) : null;
}

async function createDish(body) {
  const name = String(body.name || '').trim();
  const category = String(body.category || '').trim();
  const price = Number(body.price);

  if (!name) throw httpError(400, '请填写菜品名称');
  if (!category) throw httpError(400, '请填写菜品分类');
  if (!Number.isFinite(price) || price <= 0 || price > 9999) throw httpError(400, '菜品价格不合法');

  const row = {
    name,
    category,
    price: price.toFixed(2),
    emoji: String(body.emoji || '🍽️').slice(0, 8),
    description: String(body.description || '').slice(0, 200),
    gradient: String(body.gradient || '').slice(0, 160),
    is_hot: body.isHot ? 1 : 0,
    status: body.status === 0 ? 0 : 1
  };
  const [result] = await pool.query('INSERT INTO dish SET ?', row);
  await invalidateMenu();
  return getDishById(result.insertId);
}

async function updateDish(id, body) {
  const fields = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw httpError(400, '菜品名称不能为空');
    fields.name = name;
  }
  if (body.category !== undefined) {
    const category = String(body.category).trim();
    if (!category) throw httpError(400, '菜品分类不能为空');
    fields.category = category;
  }
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0 || price > 9999) throw httpError(400, '菜品价格不合法');
    fields.price = price.toFixed(2);
  }
  if (body.emoji !== undefined) fields.emoji = String(body.emoji || '🍽️').slice(0, 8);
  if (body.description !== undefined) fields.description = String(body.description).slice(0, 200);
  if (body.gradient !== undefined) fields.gradient = String(body.gradient).slice(0, 160);
  if (body.isHot !== undefined) fields.is_hot = body.isHot ? 1 : 0;
  if (body.status !== undefined) fields.status = Number(body.status) ? 1 : 0;

  if (!Object.keys(fields).length) throw httpError(400, '没有需要更新的字段');

  const [result] = await pool.query('UPDATE dish SET ? WHERE id = ?', [fields, id]);
  if (!result.affectedRows) throw httpError(404, '菜品不存在');

  await invalidateMenu();
  return getDishById(id);
}

async function deleteDish(id) {
  const [result] = await pool.query('DELETE FROM dish WHERE id = ?', [id]);
  if (!result.affectedRows) throw httpError(404, '菜品不存在');
  await invalidateMenu();
  return { id };
}

// ---------------------------------------------------------------- 订单

async function getOrderById(id) {
  const [rows] = await pool.query('SELECT * FROM `order` WHERE id = ?', [id]);
  if (!rows.length) return null;
  const [itemRows] = await pool.query(
    'SELECT * FROM order_item WHERE order_id = ? ORDER BY id ASC',
    [id]
  );
  return mapOrder(rows[0], itemRows.map(mapItem));
}

async function createOrder({ items, tableNo, phone, remark }) {
  // 合并相同菜品，并过滤非法数量
  const merged = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const dishId = Number(item.dishId !== undefined ? item.dishId : item.id);
    const qty = Math.floor(Number(item.qty !== undefined ? item.qty : item.quantity));
    if (!Number.isInteger(dishId) || dishId <= 0) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    merged.set(dishId, Math.min(99, (merged.get(dishId) || 0) + qty));
  }
  if (!merged.size) throw httpError(400, '购物车为空，无法下单');

  const ids = [...merged.keys()];
  const [rows] = await pool.query(
    'SELECT id, name, price, emoji, status FROM dish WHERE id IN (?)',
    [ids]
  );
  const dishMap = new Map(rows.map((r) => [r.id, r]));

  const lines = [];
  let amount = 0;
  for (const [dishId, qty] of merged) {
    const dish = dishMap.get(dishId);
    if (!dish) throw httpError(400, `菜品（ID ${dishId}）不存在`);
    if (!dish.status) throw httpError(400, `「${dish.name}」已下架，请重新选择`);
    const price = Number(dish.price);
    amount += price * qty;
    lines.push({ dishId, name: dish.name, price, qty, emoji: dish.emoji });
  }

  // 订单号：Redis INCR（降级为内存 + 时间戳）
  const orderNo = await cache.incrOrderNo();

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      'INSERT INTO `order` (order_no, table_no, phone, amount, status, remark) VALUES (?, ?, ?, ?, ?, ?)',
      [
        orderNo,
        String(tableNo || 'A01').slice(0, 20),
        String(phone || '').slice(0, 32),
        amount.toFixed(2),
        'pending',
        String(remark || '').slice(0, 200)
      ]
    );
    const orderId = result.insertId;

    const itemValues = lines.map((line) => [
      orderId,
      line.dishId,
      line.name,
      line.price.toFixed(2),
      line.qty,
      line.emoji
    ]);
    await conn.query(
      'INSERT INTO order_item (order_id, dish_id, dish_name, price, qty, emoji) VALUES ?',
      [itemValues]
    );

    for (const line of lines) {
      await conn.query('UPDATE dish SET sales = sales + ? WHERE id = ?', [line.qty, line.dishId]);
    }

    await conn.commit();
    await invalidateMenu(); // 销量变化，菜单缓存同步失效
    return await getOrderById(orderId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function listOrders({ statuses, phone, limit = 50 } = {}) {
  const where = [];
  const params = [];

  if (Array.isArray(statuses) && statuses.length) {
    where.push('status IN (?)');
    params.push(statuses);
  }
  if (phone !== undefined && phone !== null && phone !== '') {
    where.push('phone = ?');
    params.push(phone);
  }

  const sql =
    'SELECT * FROM `order`' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY id DESC LIMIT ?';
  params.push(limit);

  const [rows] = await pool.query(sql, params);
  if (!rows.length) return [];

  const ids = rows.map((r) => r.id);
  const [itemRows] = await pool.query(
    'SELECT * FROM order_item WHERE order_id IN (?) ORDER BY id ASC',
    [ids]
  );

  const grouped = new Map();
  for (const item of itemRows) {
    if (!grouped.has(item.order_id)) grouped.set(item.order_id, []);
    grouped.get(item.order_id).push(mapItem(item));
  }

  return rows.map((row) => mapOrder(row, grouped.get(row.id) || []));
}

async function updateOrderStatus(id, status) {
  if (!['pending', 'cooking', 'done'].includes(status)) {
    throw httpError(400, '订单状态不合法');
  }
  const [result] = await pool.query('UPDATE `order` SET status = ? WHERE id = ?', [status, id]);
  if (!result.affectedRows) throw httpError(404, '订单不存在');
  return getOrderById(id);
}

async function getStats() {
  const [[orderRow]] = await pool.query(`
    SELECT
      COUNT(*) AS total,
      IFNULL(SUM(status = 'pending'), 0) AS pending,
      IFNULL(SUM(status = 'cooking'), 0) AS cooking,
      IFNULL(SUM(status = 'done'), 0) AS done,
      IFNULL(SUM(CASE WHEN status <> 'cancelled' THEN amount ELSE 0 END), 0) AS revenue
    FROM \`order\`
  `);
  const [[dishRow]] = await pool.query(
    'SELECT COUNT(*) AS total, IFNULL(SUM(status = 1), 0) AS online FROM dish'
  );
  return {
    orders: {
      total: Number(orderRow.total),
      pending: Number(orderRow.pending),
      cooking: Number(orderRow.cooking),
      done: Number(orderRow.done),
      revenue: Number(orderRow.revenue)
    },
    dishes: {
      total: Number(dishRow.total),
      online: Number(dishRow.online)
    },
    cacheMode: cache.getMode()
  };
}

// ---------------------------------------------------------------- 工具

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  init,
  getStats,
  listDishes,
  getDishById,
  createDish,
  updateDish,
  deleteDish,
  createOrder,
  listOrders,
  getOrderById,
  updateOrderStatus,
  close,
  STATUS_TEXT
};
