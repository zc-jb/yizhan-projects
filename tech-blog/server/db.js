import mysql from 'mysql2/promise';
import './env.js';

const useSSL = process.env.DB_SSL === 'true';
const sslConf = useSSL ? { minVersion: 'TLSv1.2' } : undefined;

export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'tech_blog',
  ssl: sslConf,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+08:00',
});

const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(32) NOT NULL UNIQUE,
    pass_hash VARCHAR(160) NOT NULL,
    is_guest TINYINT NOT NULL DEFAULT 0,
    last_login_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS sessions (
    token VARCHAR(64) PRIMARY KEY,
    user_id INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sess_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS comments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    scope VARCHAR(8) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    parent_id INT NULL,
    user_id INT NOT NULL,
    username VARCHAR(32) NOT NULL,
    body VARCHAR(1000) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cmt_lookup (scope, slug),
    INDEX idx_cmt_parent (parent_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS likes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    target VARCHAR(16) NOT NULL,
    target_id INT NOT NULL,
    user_id INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_like (target, target_id, user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS appeals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    username VARCHAR(32) NOT NULL,
    reason VARCHAR(32) NOT NULL,
    content VARCHAR(600) NOT NULL,
    images LONGTEXT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    handled_at DATETIME NULL,
    INDEX idx_appeal_status (status),
    INDEX idx_appeal_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS work_likes (
    work_key VARCHAR(20) NOT NULL,
    user_id INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (work_key, user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS entitlements (
    user_id INT NOT NULL,
    work_key VARCHAR(20) NOT NULL,
    plan VARCHAR(10) NOT NULL DEFAULT 'free',
    remaining INT NOT NULL DEFAULT 3,
    expires_at DATETIME NULL,
    PRIMARY KEY (user_id, work_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS codes (
    code VARCHAR(24) PRIMARY KEY,
    plan VARCHAR(10) NOT NULL,
    user_id INT NOT NULL,
    used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS issued_codes (
    code VARCHAR(24) PRIMARY KEY,
    username VARCHAR(32) NOT NULL,
    plan VARCHAR(10) NOT NULL,
    issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_issued_user (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS renewals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    batch VARCHAR(24) NOT NULL,
    user_id INT NOT NULL,
    scope VARCHAR(10) NOT NULL,
    work_key VARCHAR(20) NOT NULL,
    plan VARCHAR(10) NOT NULL,
    prev_plan VARCHAR(10) NULL,
    prev_remaining INT NULL,
    prev_expires_at DATETIME NULL,
    new_remaining INT NULL,
    new_expires_at DATETIME NULL,
    revoked TINYINT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_renew_user (user_id, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

export async function initSchema() {
  // 用独立连接建表后立即关闭，避免连接池的会话残留过期元数据
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'tech_blog',
    ssl: sslConf,
    charset: 'utf8mb4',
  });
  try {
    for (const sql of TABLES) await conn.query(sql);
    // 兼容旧库：补齐「禁言」字段
    const [mutedCol] = await conn.query("SHOW COLUMNS FROM users LIKE 'muted'");
    if (!mutedCol.length) {
      await conn.query('ALTER TABLE users ADD COLUMN muted TINYINT NOT NULL DEFAULT 0');
    }
    // 兼容旧库：补齐「禁言时间」字段
    const [mutedAtCol] = await conn.query("SHOW COLUMNS FROM users LIKE 'muted_at'");
    if (!mutedAtCol.length) {
      await conn.query('ALTER TABLE users ADD COLUMN muted_at DATETIME NULL');
    }
    // 兼容旧库：补齐「最近登录时间」字段（第三方登录 3 天免授权判断）
    const [lastLoginCol] = await conn.query("SHOW COLUMNS FROM users LIKE 'last_login_at'");
    if (!lastLoginCol.length) {
      await conn.query('ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL');
    }
  } finally {
    await conn.end();
  }
}

// 建库（首次运行，库不存在时自动创建）
export async function ensureDatabase() {
  const name = process.env.DB_NAME || 'tech_blog';
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
    ssl: sslConf,
    charset: 'utf8mb4',
  });
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${name}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.end();
}
