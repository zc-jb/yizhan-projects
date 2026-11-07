import dotenv from 'dotenv';
import path from 'node:path';
import url from 'node:url';

/* 应用根目录：测试服是 tech-blog/，正式服是 tech-blog/releases/prod/
   各自的 .env 与代码放在一起，互不干扰 */
export const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

dotenv.config({ path: path.join(ROOT, '.env') });
