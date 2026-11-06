/* 博客文章数据：新增文章只需在数组前面加一项 */
const POSTS = [
{
slug: 'ai-llm-intro',
title: '大语言模型（LLM）工作原理浅析',
date: '2026-11-05',
cat: 'AI 人工智能',
tags: ['AI', 'LLM', 'Transformer'],
cover: '🤖',
desc: '从 Token 到 Transformer，用通俗的方式讲清楚 ChatGPT 这类大模型到底是怎么"思考"的。',
md: `
## 大模型是什么

大语言模型（Large Language Model，LLM）本质上是一个**超级条件概率函数**：给定前面的文字，预测下一个最可能出现的词（Token）。

\`\`\`
输入: "今天天气真"
输出概率: "好" 72% | "不" 9% | "是" 6% ...
\`\`\`

## 第一步：把文字变成数字

计算机不懂文字，只懂数字。分词器（Tokenizer）先把文本切成 **Token**：

\`\`\`python
"我爱编程" -> [我, 爱, 编程] -> [1203, 456, 8890]
\`\`\`

每个 Token 再映射成一个高维向量（Embedding），通常有 4096 维甚至更高。语义相近的词，向量距离也近。

## 第二步：Transformer 架构

2017 年 Google 的论文《Attention Is All You Need》提出了 Transformer，核心是**自注意力机制（Self-Attention）**：

> 每个词都会"回头看"句子里所有其他的词，并计算彼此的相关程度。

例如"苹果公司发布了新手机，**它**很受欢迎"，模型通过注意力知道"它"指的是"手机"而不是"苹果"。

\`\`\`
Attention(Q, K, V) = softmax(QK^T / √d) · V
\`\`\`

- **Q（查询）**：我在找什么
- **K（键）**：我是什么
- **V（值）**：我携带的信息

## 第三步：训练与推理

| 阶段 | 做什么 | 类比 |
|---|---|---|
| 预训练 | 读遍全网文本，学习语言规律 | 上完 12 年学 |
| 微调 SFT | 用问答数据教它对话 | 入职培训 |
| RLHF | 人类反馈强化学习 | 绩效考核 |

推理时，模型逐个生成 Token，每一步都基于之前所有内容重新计算——这就是为什么长回答生成较慢。

## 关键结论

1. 大模型**不是数据库**，它存储的是统计规律而非原文
2. 它能"推理"，是因为海量训练中涌现出的能力
3. 它会"幻觉"，因为本质上是概率预测而非事实查询

## 动手体验

\`\`\`python
from transformers import pipeline
gpt = pipeline('text-generation', model='gpt2')
print(gpt("人工智能的未来是", max_length=50))
\`\`\`

理解了"预测下一个词"这个本质，再看 Prompt Engineering、RAG、Agent 这些上层应用，就都顺理成章了。
`
},
{
slug: 'js-async-guide',
title: 'JavaScript 异步编程完全指南',
date: '2026-11-03',
cat: '前端开发',
tags: ['JavaScript', '异步', 'Promise'],
cover: '⚡',
desc: '回调、Promise、async/await、事件循环——一篇文章打通 JS 异步的任督二脉。',
md: `
## 为什么需要异步

JavaScript 是**单线程**的。如果网络请求、定时器都同步执行，页面会卡死。异步让耗时的操作"先挂起"，结果回来再处理。

## 演进路线

### 1. 回调函数（Callback）

\`\`\`js
setTimeout(() => {
  console.log('1 秒后执行');
}, 1000);
\`\`\`

缺点：多重嵌套形成"回调地狱"。

\`\`\`js
getUser(id, user => {
  getOrders(user.id, orders => {
    getDetail(orders[0].id, detail => {
      // 金字塔越来越深...
    });
  });
});
\`\`\`

### 2. Promise

Promise 把异步操作包装成一个**有三种状态的对象**：pending → fulfilled / rejected。

\`\`\`js
fetch('/api/user')
  .then(res => res.json())
  .then(user => console.log(user.name))
  .catch(err => console.error(err))
  .finally(() => console.log('结束'));
\`\`\`

常用组合：

\`\`\`js
Promise.all([p1, p2, p3]);   // 全部成功才成功
Promise.race([p1, p2]);      // 谁快用谁
Promise.allSettled([p1, p2]); // 全部结束，无论成败
\`\`\`

### 3. async / await（推荐）

Promise 的语法糖，让异步代码**看起来像同步**：

\`\`\`js
async function loadDetail(id) {
  try {
    const user   = await getUser(id);
    const orders = await getOrders(user.id);
    return orders[0];
  } catch (e) {
    console.error('加载失败', e);
  }
}
\`\`\`

## 事件循环（Event Loop）

JS 的异步由事件循环驱动：

\`\`\`
调用栈 (Call Stack)  ← 同步代码
微任务队列 (Microtasks) ← Promise.then / queueMicrotask
宏任务队列 (Macrotasks) ← setTimeout / setInterval / I/O
\`\`\`

执行顺序铁律：**同步 → 微任务 → 一个宏任务 → 微任务 → 循环**。

\`\`\`js
console.log(1);
setTimeout(() => console.log(2));
Promise.resolve().then(() => console.log(3));
console.log(4);
// 输出: 1 4 3 2
\`\`\`

## 实战建议

1. 优先 \`async/await\`，配 \`try/catch\`
2. 互不依赖的请求用 \`Promise.all\` 并发
3. 不要忘了 \`catch\`，未处理的 rejection 会静默失败
4. 耗时计算用 Web Worker，别阻塞主线程
`
},
{
slug: 'css-flex-grid',
title: 'CSS 现代布局：Flex 与 Grid 实战手册',
date: '2026-10-28',
cat: '前端开发',
tags: ['CSS', '布局', 'Flex', 'Grid'],
cover: '🎨',
desc: '告别 float！用 Flex 和 Grid 两把利器搞定 99% 的页面布局。',
md: `
## 一维用 Flex，二维用 Grid

- **Flexbox**：擅长**一个方向**上的排列（导航栏、卡片行、居中）
- **Grid**：擅长**行列同时控制**的二维布局（整页骨架、画廊）

## Flex 速查

\`\`\`css
.container {
  display: flex;
  justify-content: space-between; /* 主轴对齐 */
  align-items: center;            /* 交叉轴对齐 */
  gap: 16px;                      /* 间距（比 margin 香）*/
  flex-wrap: wrap;                /* 换行 */
}
.item {
  flex: 1;        /* 等分剩余空间 */
  flex: 0 0 200px; /* 固定 200px 不缩不放 */
}
\`\`\`

**垂直居中**（曾经的世纪难题，现在三行）：

\`\`\`css
.parent { display: flex; justify-content: center; align-items: center; }
\`\`\`

## Grid 速查

\`\`\`css
.page {
  display: grid;
  grid-template-columns: 240px 1fr;   /* 侧栏 + 主区 */
  grid-template-rows: 60px 1fr 40px;  /* 头/体/尾 */
  gap: 12px;
  min-height: 100vh;
}
\`\`\`

响应式画廊（无需媒体查询）：

\`\`\`css
.gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}
\`\`\`

\`auto-fill + minmax\`：列宽不小于 220px，空间够就自动加列。

## 经典布局对比

| 布局 | 方案 |
|---|---|
| 圣杯布局 | Grid 三行三列 |
| 导航栏 | Flex + space-between |
| 卡片列表 | Grid + auto-fill |
| 表单行 | Flex + gap |
| 居中弹窗 | \`place-items: center\` 一行搞定 |

## 实战技巧

1. 用 \`gap\` 代替 margin 控制间距
2. \`minmax(0, 1fr)\` 防止 Grid 子项内容撑破
3. 长文本截断：\`min-width: 0\` + \`text-overflow: ellipsis\`
4. 调试利器：浏览器 DevTools 的 Flex/Grid 徽章，点开就能可视化
`
},
{
slug: 'http-https',
title: 'HTTP 与 HTTPS：一次请求背后的完整旅程',
date: '2026-10-22',
cat: '计算机网络',
tags: ['HTTP', 'HTTPS', '网络'],
cover: '🌐',
desc: '从输入网址到页面渲染，中间到底发生了什么？TLS 握手又是怎么保护你的数据的？',
md: `
## 输入网址后发生了什么

\`\`\`
1. DNS 解析: 域名 -> IP 地址
2. TCP 三次握手: 建立连接
3. TLS 握手 (HTTPS): 协商加密
4. 发送 HTTP 请求
5. 服务器处理并返回响应
6. 浏览器解析渲染
\`\`\`

## HTTP 报文长什么样

\`\`\`http
POST /api/login HTTP/1.1
Host: example.com
Content-Type: application/json
Content-Length: 38

{"username":"tom","password":"123456"}
\`\`\`

响应：

\`\`\`http
HTTP/1.1 200 OK
Content-Type: application/json
Set-Cookie: session=abc123; HttpOnly

{"code":0,"msg":"登录成功"}
\`\`\`

## 必知状态码

| 状态码 | 含义 | 场景 |
|---|---|---|
| 200 | 成功 | 正常返回 |
| 301/302 | 重定向 | 域名跳转 |
| 304 | 未修改 | 缓存生效 |
| 400 | 请求有误 | 参数校验失败 |
| 401 | 未认证 | 没登录 |
| 403 | 无权限 | 登录了但没权限 |
| 404 | 不存在 | 路径错误 |
| 500 | 服务器错误 | 后端炸了 |

## HTTPS 如何保证安全

HTTP 是明文传输，中间人可以看到、篡改所有内容。HTTPS = HTTP + TLS，解决三个问题：

1. **加密**：对称密钥加密内容（AES）
2. **认证**：证书证明"你真的是你"（CA 体系）
3. **完整性**：防篡改（MAC 校验）

### TLS 握手简版

\`\`\`
Client -> Server: 支持的算法 + 随机数1
Server -> Client: 证书 + 随机数2
Client: 验证证书 -> 生成"预主密钥"
       用服务器公钥加密后发送
双方: 用 随机数1+2+预主密钥 算出会话密钥
之后: 全部用会话密钥对称加密通信
\`\`\`

> 关键点：**非对称加密只用于交换密钥**，之后通信用更快的对称加密。

## HTTP/1.1 vs HTTP/2 vs HTTP/3

- **HTTP/1.1**：keep-alive 复用连接，但有队头阻塞
- **HTTP/2**：二进制分帧、多路复用、头部压缩、服务器推送
- **HTTP/3**：基于 QUIC（UDP），彻底告别 TCP 队头阻塞，弱网更快

## 调试利器

\`\`\`bash
curl -v https://example.com   # 看完整握手和报文
\`\`\`

浏览器 DevTools 的 Network 面板：Timing 一页看清 DNS/连接/TTFB 各阶段耗时。
`
},
{
slug: 'git-workflow',
title: 'Git 实战：常用命令与团队协作工作流',
date: '2026-10-15',
cat: '开发工具',
tags: ['Git', '版本控制'],
cover: '🌿',
desc: 'clone 到 rebase，从单人开发到团队协作，Git 这一篇就够了。',
md: `
## 核心概念一张图

\`\`\`
工作区 --add--> 暂存区 --commit--> 本地仓库 --push--> 远程仓库
       <-checkout-        <-reset--           <-pull--
\`\`\`

## 日常高频命令

\`\`\`bash
git status              # 看状态（没事就敲）
git add .               # 暂存全部改动
git commit -m "说明"    # 提交
git pull                # 拉取远程更新
git push                # 推送
git log --oneline -10   # 看最近 10 条提交
git diff                # 看未暂存的改动
\`\`\`

## 分支操作

\`\`\`bash
git switch -c feature/login   # 新建并切换分支
git switch main               # 切回主线
git merge feature/login       # 合并分支
git branch -d feature/login   # 删除已合并分支
\`\`\`

## 后悔药系列

\`\`\`bash
git restore file.js          # 丢弃工作区修改
git restore --staged file.js # 取消暂存
git commit --amend           # 修改上一次提交
git reset --soft HEAD~1      # 撤销提交但保留改动
git stash / git stash pop    # 临时存一下 / 取回
\`\`\`

## 团队协作：Feature Branch 工作流

1. 从 \`main\` 切功能分支 \`feature/xxx\`
2. 开发、提交、推送
3. 发起 Pull Request，同事 Code Review
4. 合并进 \`main\`，删除功能分支

### 合并冲突怎么办

\`\`\`
<<<<<<< HEAD
我的代码
=======
别人的代码
>>>>>>> feature/xxx
\`\`\`

手动编辑保留正确内容，删掉标记，然后：

\`\`\`bash
git add .
git commit -m "解决冲突"
\`\`\`

## 好习惯清单

- 提交信息写清楚"为什么"，不只是"改了什么"
- 小步提交，一个提交只做一件事
- 不要把密码、密钥提交进仓库
- \`push\` 前先 \`pull\`
- 公共分支（main）绝不 force push
`
},
{
slug: 'docker-quickstart',
title: 'Docker 入门：10 分钟容器化你的第一个应用',
date: '2026-10-08',
cat: '运维部署',
tags: ['Docker', '容器', '部署'],
cover: '🐳',
desc: '"在我机器上能跑啊"——Docker 就是终结这句话的利器。',
md: `
## 为什么需要 Docker

开发环境能跑、线上就挂？依赖版本冲突？Docker 把**应用 + 依赖 + 环境**打包成一个镜像，真正做到"一次构建，到处运行"。

| 概念 | 类比 |
|---|---|
| 镜像 Image | 安装包 |
| 容器 Container | 运行中的程序 |
| Dockerfile | 安装说明书 |
| 仓库 Registry | 应用商店 |

## 第一条命令

\`\`\`bash
docker run -d -p 8080:80 --name web nginx
\`\`\`

一行启动一个 Nginx：\`-d\` 后台运行，\`-p\` 端口映射（本机8080→容器80）。

## 常用命令

\`\`\`bash
docker ps            # 运行中的容器
docker ps -a         # 全部容器
docker images        # 本地镜像
docker logs -f web   # 跟踪日志
docker exec -it web bash  # 进入容器
docker stop web && docker rm web
\`\`\`

## 写自己的 Dockerfile

以 Node.js 应用为例：

\`\`\`dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
\`\`\`

构建并运行：

\`\`\`bash
docker build -t myapp:1.0 .
docker run -d -p 3000:3000 myapp:1.0
\`\`\`

## docker-compose：一键编排

多容器应用（如 应用+数据库）用 compose：

\`\`\`yaml
services:
  web:
    build: .
    ports: ["3000:3000"]
    depends_on: [db]
  db:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: secret
    volumes:
      - dbdata:/var/lib/mysql
volumes:
  dbdata:
\`\`\`

\`\`\`bash
docker compose up -d    # 一键启动全家桶
docker compose down     # 一键销毁
\`\`\`

## 实战建议

1. 镜像尽量小：用 alpine 基础镜像、多阶段构建
2. 数据持久化用 volume，容器删了数据还在
3. 不要在容器里跑多个进程
4. 敏感配置走环境变量，不要写进镜像
`
},
{
slug: 'db-index-btree',
title: '数据库索引原理：B+ 树为什么这么快',
date: '2026-09-30',
cat: '数据库',
tags: ['MySQL', '索引', 'B+树'],
cover: '🗄️',
desc: '索引不是银弹。看懂 B+ 树的结构，才能明白索引什么时候有用、什么时候反而拖慢。',
md: `
## 没有索引会怎样

\`\`\`sql
SELECT * FROM users WHERE phone = '13800001234';
\`\`\`

没有索引 = **全表扫描**：1000 万行就逐行比对 1000 万次。有索引：3~4 次磁盘 IO 搞定。

## 为什么是 B+ 树

候选数据结构对比：

| 结构 | 问题 |
|---|---|
| 哈希表 | 不支持范围查询 |
| 二叉树 | 数据倾斜退化成链表 |
| B 树 | 非叶子也存数据，层数高 |

B+ 树的设计：

- **多叉**：一个节点存几百个 key，千万级数据只要 3~4 层
- **数据全在叶子节点**，叶子间用链表串联 → 范围查询飞快
- 非叶子节点只存索引 → 一层能放更多 key

## 索引实战（MySQL）

\`\`\`sql
-- 建索引
CREATE INDEX idx_phone ON users(phone);
-- 联合索引
CREATE INDEX idx_city_age ON users(city, age);
-- 查看执行计划
EXPLAIN SELECT * FROM users WHERE phone = '138...';
\`\`\`

### 最左前缀原则

联合索引 \`(city, age)\` 能加速：

\`\`\`sql
WHERE city='北京' AND age=25   ✅
WHERE city='北京'              ✅
WHERE age=25                   ❌ 跳过了最左列
\`\`\`

### 索引失效常见坑

1. 对索引列用函数：\`WHERE DATE(create_time)='2026-01-01'\`
2. 隐式类型转换：字符串列用数字查
3. \`LIKE '%abc'\` 前导通配符
4. \`OR\` 两边有一列没索引

## 覆盖索引：回表都省了

\`\`\`sql
-- 索引 (city, age)，查询只取这两列
SELECT city, age FROM users WHERE city='北京';
-- 不用回表，直接索引里拿，Extra 显示 Using index
\`\`\`

## 索引的代价

- 占磁盘空间
- **写入变慢**：每次 INSERT/UPDATE 都要维护 B+ 树

所以：不是索引越多越好，给**高频查询条件**建，给低区分度列（如性别）建索引意义不大。

## 一句话总结

> 索引是用**空间和写入性能**换**查询性能**的艺术，理解 B+ 树结构，才能让每一次 \`EXPLAIN\` 心里有数。
`
},
{
slug: 'python-quickstart',
title: 'Python 快速上手：从零到写出第一个爬虫',
date: '2026-09-21',
cat: '后端开发',
tags: ['Python', '爬虫', '入门'],
cover: '🐍',
desc: '语法极简、生态无敌。半小时跑通：语法速览 → 写脚本 → 抓取网页数据。',
md: `
## 为什么是 Python

语法接近英语，第三方库超过 40 万个：爬虫、数据分析、AI、自动化运维全都能干。

## 语法 5 分钟速览

\`\`\`python
# 变量与类型
name = "小明"
age = 18
scores = [90, 85, 77]          # 列表
info = {"name": name, "age": age}  # 字典

# 条件与循环
if age >= 18:
    print("成年人")

for s in scores:
    print(s)

# 函数
def average(nums):
    return sum(nums) / len(nums)

print(f"平均分: {average(scores):.1f}")  # f-string
\`\`\`

## 列表推导式（Python 灵魂）

\`\`\`python
squares = [x**2 for x in range(10) if x % 2 == 0]
# [0, 4, 16, 36, 64]
\`\`\`

## 第一个实用脚本：批量重命名

\`\`\`python
import os

folder = './photos'
for i, f in enumerate(os.listdir(folder)):
    if f.endswith('.jpg'):
        os.rename(f'{folder}/{f}', f'{folder}/旅行_{i:03d}.jpg')
print('重命名完成')
\`\`\`

## 第一个爬虫

\`\`\`bash
pip install requests beautifulsoup4
\`\`\`

\`\`\`python
import requests
from bs4 import BeautifulSoup

url = 'https://quotes.toscrape.com'
html = requests.get(url).text
soup = BeautifulSoup(html, 'html.parser')

for q in soup.select('.quote'):
    text = q.select_one('.text').get_text()
    author = q.select_one('.author').get_text()
    print(f'{author}: {text}')
\`\`\`

四步套路：**发请求 → 拿 HTML → 解析 → 提取数据**。

## 爬虫礼仪

1. 看 \`robots.txt\`，尊重网站规则
2. 加延时：\`time.sleep(1)\`，别把人家服务器打挂
3. 带上 User-Agent 头
4. 只取需要的，别全站扫描

## 学习路线建议

基础语法 → 文件/异常 →  requests/bs4 → pandas 数据处理 → Flask 做 Web → 选一个方向深入（AI/后端/自动化）。
`
},
{
slug: 'linux-top20',
title: '20 个最常用的 Linux 命令（附实战场景）',
date: '2026-09-12',
cat: '运维部署',
tags: ['Linux', '命令行'],
cover: '🐧',
desc: '不用背全集，掌握这 20 个命令就能应付 90% 的服务器日常。',
md: `
## 文件与目录

\`\`\`bash
ls -lh          # 列表（人类可读大小）
cd /var/log     # 切换目录
pwd             # 我在哪
mkdir -p a/b/c  # 递归建目录
cp -r src dst   # 复制
mv old new      # 移动/重命名
rm -rf tmp/     # 删除（危险！想清楚再回车）
\`\`\`

## 查看文件

\`\`\`bash
cat app.log           # 全量输出
tail -f app.log       # 实时跟踪日志（排查问题神器）
tail -n 100 app.log   # 最后 100 行
less app.log          # 翻页查看，/ 可搜索
\`\`\`

## 搜索与过滤

\`\`\`bash
grep -rn "ERROR" /var/log/     # 递归找关键字
find / -name "*.conf" 2>/dev/null  # 找文件
ps aux | grep nginx            # 找进程
\`\`\`

## 系统状态

\`\`\`bash
top               # 任务管理器（q 退出）
df -h             # 磁盘占用
du -sh *          # 各目录大小
free -h           # 内存
\`\`\`

## 网络

\`\`\`bash
curl -I https://baidu.com   # 测试请求
ss -tlnp                    # 查看端口监听
ping baidu.com              # 测连通
\`\`\`

## 权限与其他

\`\`\`bash
chmod +x run.sh       # 加执行权限
chown -R www:www html/  # 改属主
sudo systemctl restart nginx  # 重启服务
\`\`\`

## 实战组合技

**找大文件并排序**：

\`\`\`bash
du -sh /* 2>/dev/null | sort -rh | head
\`\`\`

**统计日志里各状态码次数**：

\`\`\`bash
grep -o '" [0-9]\{3\} ' access.log | sort | uniq -c | sort -rn
\`\`\`

**批量杀进程**：

\`\`\`bash
ps aux | grep node | grep -v grep | awk '{print $2}' | xargs kill
\`\`\`

## 万能钥匙

记不住参数？\`命令 --help\` 或 \`man 命令\`。命令行用熟了，效率远超图形界面。
`
},
{
slug: 'big-o-visual',
title: '算法复杂度：大 O 表示法一图流',
date: '2026-09-02',
cat: '算法基础',
tags: ['算法', '复杂度'],
cover: '📈',
desc: '为什么你的代码数据一多就卡？用直觉理解时间复杂度，写出扛得住数据量的程序。',
md: `
## 什么是大 O

大 O 描述的是：**数据量 n 增大时，运行时间增长的趋势**。不看具体几秒，只看"增长曲线"。

## 常见复杂度速览

| 复杂度 | 名字 | 典型操作 | n=100万时 |
|---|---|---|---|
| O(1) | 常数 | 数组按下标取、哈希表查 | 瞬间 |
| O(log n) | 对数 | 二分查找 | 约 20 次 |
| O(n) | 线性 | 遍历数组 | 100 万次 |
| O(n log n) | 线性对数 | 快排/归并 | 约 2000 万次 |
| O(n²) | 平方 | 双重循环、冒泡 | 1 万亿次（卡死） |
| O(2ⁿ) | 指数 | 暴力递归枚举 | 宇宙毁灭也算不完 |

## 直觉理解

### O(1)：查字典的目录

\`\`\`js
const map = { a: 1, b: 2 };
map['a'];  // 不管 map 多大，一步到
\`\`\`

### O(log n)：二分查找——每次砍一半

\`\`\`js
function binarySearch(arr, target) {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] === target) return mid;
    arr[mid] < target ? lo = mid + 1 : hi = mid - 1;
  }
  return -1;
}
\`\`\`

100 万个元素，最多比较 20 次——这就是对数的威力。

### O(n²)：人手一个排行榜比对

\`\`\`js
for (const a of list)
  for (const b of list)
    compare(a, b);  // n 个人两两比对 = n² 次
\`\`\`

n 翻倍，耗时变 4 倍；n 变 10 倍，耗时变 100 倍。**数据量一大必然翻车**。

## 实战：把 O(n²) 优化成 O(n)

需求：数组里找两个数，和为 target。

\`\`\`js
// 暴力 O(n²)
for (let i = 0; i < nums.length; i++)
  for (let j = i + 1; j < nums.length; j++)
    if (nums[i] + nums[j] === target) return [i, j];

// 哈希表 O(n)
const seen = new Map();
for (let i = 0; i < nums.length; i++) {
  const need = target - nums[i];
  if (seen.has(need)) return [seen.get(need), i];
  seen.set(nums[i], i);
}
\`\`\`

核心思想：**用空间换时间**——把查过的数放进哈希表，查询从 O(n) 变 O(1)。

## 空间复杂度

同理，算法占用的额外内存也用大 O 表示。递归的深度、额外开的数组都算。

## 记住三句话

1. 嵌套循环层数 ≈ 复杂度的次方数
2. 每次问题规模减半 → 有 log n
3. 面试/优化先问：**数据量多大？** 小数据随便写，大数据必须抠复杂度
`
},
{
slug: 'wechat-miniprogram',
title: '微信小程序开发入门：从注册到上线全流程',
date: '2026-08-25',
cat: '前端开发',
tags: ['小程序', '微信', 'Taro'],
cover: '💬',
desc: '账号注册、目录结构、页面开发、审核发布——小程序从 0 到 1 完整路线图。',
md: `
## 准备工作

1. 到 mp.weixin.qq.com 注册小程序账号（个人即可）
2. 下载"微信开发者工具"
3. 拿到 AppID（测试号也行）

## 目录结构

\`\`\`
├── app.js        # 全局逻辑
├── app.json      # 全局配置（页面路由、窗口样式）
├── app.wxss      # 全局样式
└── pages/
    └── index/
        ├── index.js    # 页面逻辑
        ├── index.json  # 页面配置
        ├── index.wxml  # 结构（类似 HTML）
        └── index.wxss  # 样式（类似 CSS）
\`\`\`

## 四个文件的分工

| 文件 | 类比 Web | 作用 |
|---|---|---|
| WXML | HTML | 结构 |
| WXSS | CSS | 样式（rpx 自适应单位）|
| JS | JS | 逻辑与数据 |
| JSON | - | 配置 |

## 数据绑定与事件

\`\`\`html
<view class="title">{{title}}</view>
<button bindtap="handleTap">点我</button>
\`\`\`

\`\`\`js
Page({
  data: { title: '你好，小程序' },
  handleTap() {
    this.setData({ title: '已点击！' });  // 改数据必须用 setData
    wx.showToast({ title: '成功' });
  }
});
\`\`\`

> 注意：直接 \`this.data.x = 1\` **不会触发视图更新**，必须 \`setData\`。

## 常用 API

\`\`\`js
wx.request({ url, success })  // 网络请求
wx.navigateTo({ url })        // 跳转页面
wx.setStorageSync('k', v)     // 本地缓存
wx.getUserProfile({...})      // 用户信息
wx.showModal({...})           // 弹窗
\`\`\`

## 生命周期

\`\`\`js
Page({
  onLoad()    {},  // 页面创建（拿参数、发首请求）
  onShow()    {},  // 每次显示
  onReady()   {},  // 首次渲染完成
  onHide()    {},
  onUnload()  {}
});
\`\`\`

## 跨端方案：一套代码多端跑

想同时支持微信/支付宝/H5？用 **Taro**（React 语法）或 **uni-app**（Vue 语法）：

\`\`\`bash
npm i -g @tarojs/cli
taro init myApp
npm run dev:weapp   # 编译到微信小程序
\`\`\`

## 上线流程

1. 开发者工具点"上传"
2. 公众平台后台提交审核（一般 1~7 天）
3. 审核通过点"发布"，全网上线

**避坑**：个人主体不能做电商/医疗等类目；网络请求域名必须提前在后台配置且必须 HTTPS。
`
},
];

/* 分类与标签由 app.js 动态统计 */
