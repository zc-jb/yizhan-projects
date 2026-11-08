import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execSync } from 'node:child_process';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');          // 测试服源码目录（唯一编辑入口）
const OUT = path.join(SRC, 'releases', 'prod'); // 正式服运行目录

/* 随代码一起发布的文件/目录 */
const ITEMS = ['server', 'js', 'css', 'img', 'index.html', 'admin.html', 'vip.html', 'rss.xml', '.nojekyll', 'package.json'];

const log = (...a) => console.log('  ', ...a);

if (!fs.existsSync(path.join(SRC, '.env.prod'))) {
  console.error('✖ 缺少 .env.prod，无法发布');
  process.exit(1);
}
const prodEnv = fs.readFileSync(path.join(SRC, '.env.prod'), 'utf8');
const PORT = Number((prodEnv.match(/^PORT=(\d+)/m) || [])[1] || 3000);
const DB = (prodEnv.match(/^DB_NAME=(.+)$/m) || [])[1] || '?';

console.log('\n发布到正式服');
log('目标目录:', OUT);
log('端口:', PORT, '| 数据库:', DB.trim());

/* 1. 只覆盖需要发布的文件，保留 out 目录里的 prod.log 等运行产物 */
fs.mkdirSync(OUT, { recursive: true });
for (const item of ITEMS) {
  const from = path.join(SRC, item);
  if (!fs.existsSync(from)) continue;
  const to = path.join(OUT, item);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  log('已复制', item);
}

/* 2. 写入正式服环境变量 */
fs.copyFileSync(path.join(SRC, '.env.prod'), path.join(OUT, '.env'));
log('已写入 .env');

/* 3. 停掉旧的正式服进程 */
let pid = '';
try {
  pid = execSync(
    `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess"`,
    { stdio: 'pipe' }
  ).toString().trim();
} catch {}
if (pid) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' });
    log('已停止旧进程 PID', pid);
  } catch {}
}

/* 4. 启动正式服：交给计划任务，彻底脱离当前终端控制台 */
const bat = path.join(OUT, 'start-prod.bat');
fs.writeFileSync(bat, [
  '@echo off',
  'cd /d "%~dp0"',
  `echo. >> prod.log`,
  'node server\\index.js >> prod.log 2>&1',
].join('\r\n'));

const TASK = 'TechBlogProd';
try {
  execSync(
    `powershell -NoProfile -Command "schtasks /Create /TN ${TASK} /TR '${bat}' /SC ONLOGON /F"`,
    { stdio: 'pipe' }
  );
} catch (e) {
  log('计划任务更新被拒绝，改用已存在的任务启动');
}
execSync(`schtasks /Run /TN ${TASK}`, { stdio: 'pipe' });
log('已通过计划任务启动正式服');

/* 5. 等待健康检查 */
const deadline = Date.now() + 20000;
let ok = false;
while (Date.now() < deadline) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
    if (r.ok) { ok = true; break; }
  } catch {}
  await new Promise(r => setTimeout(r, 500));
}
if (ok) {
  console.log(`\n✔ 发布完成：http://localhost:${PORT}（数据库 ${DB.trim()}）\n`);
} else {
  console.error(`\n✖ 正式服启动失败，请查看 ${path.join(OUT, 'prod.log')}\n`);
  process.exit(1);
}
