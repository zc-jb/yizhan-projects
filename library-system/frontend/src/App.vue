<script setup>
import { ref, reactive, computed } from 'vue';
import { api, getToken, setToken, clearToken } from './api';

const logged = ref(!!getToken());
const loginForm = reactive({ username: 'admin', password: '123456' });
const loginError = ref('');
const userName = ref(sessionStorage.getItem('lib_user') || '');
const tab = ref('dashboard');
const loading = ref(false);
const toast = ref('');
let toastTimer = null;

const stats = reactive({ bookTitles: 0, totalCopies: 0, availableCopies: 0, borrowedCopies: 0, readerCount: 0, categoryCount: 0, activeBorrows: 0, overdue: 0, today: '' });
const books = ref([]);
const categories = ref([]);
const readers = ref([]);
const borrows = ref([]);
const bookKeyword = ref('');
const categoryFilter = ref('');
const borrowFilter = ref('active');
const readerKeyword = ref('');

const modal = ref('');
const saving = ref(false);
const formError = ref('');
const bookForm = reactive({ id: null, title: '', author: '', isbn: '', publisher: '', publishYear: 2024, categoryId: null, total: 3 });
const categoryForm = reactive({ id: null, name: '', description: '' });
const readerForm = reactive({ id: null, name: '', gender: '男', phone: '', cardNo: '' });
const borrowForm = reactive({ bookId: null, readerId: null });

function notify(msg) {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ''), 2600);
}

async function login() {
  loginError.value = '';
  try {
    const res = await api.login({ username: loginForm.username, password: loginForm.password });
    setToken(res.token);
    sessionStorage.setItem('lib_user', res.name);
    userName.value = res.name;
    logged.value = true;
    await loadAll();
  } catch (e) {
    loginError.value = e.message;
  }
}

function logout() {
  clearToken();
  sessionStorage.removeItem('lib_user');
  logged.value = false;
}

async function loadAll() {
  loading.value = true;
  try {
    const [s, c] = await Promise.all([api.stats(), api.categories()]);
    Object.assign(stats, s);
    categories.value = c;
    await Promise.all([loadBooks(), loadReaders(), loadBorrows()]);
  } catch (e) {
    notify(e.message);
    if (!getToken()) logged.value = false;
  } finally {
    loading.value = false;
  }
}

async function loadBooks() {
  const params = {};
  if (bookKeyword.value.trim()) params.keyword = bookKeyword.value.trim();
  if (categoryFilter.value) params.categoryId = categoryFilter.value;
  books.value = await api.books(params);
}

async function loadReaders() {
  const params = {};
  if (readerKeyword.value.trim()) params.keyword = readerKeyword.value.trim();
  readers.value = await api.readers(params);
}

async function loadBorrows() {
  borrows.value = await api.borrows(borrowFilter.value);
}

async function switchTab(t) {
  tab.value = t;
  if (t === 'books') await loadBooks();
  if (t === 'readers') await loadReaders();
  if (t === 'borrows') await loadBorrows();
  if (t === 'dashboard') await loadAll();
}

function categoryName(id) {
  const hit = categories.value.find((c) => c.id === id);
  return hit ? hit.name : '未分类';
}

const categoryChart = computed(() => {
  const list = categories.value.map((c) => ({
    name: c.name,
    count: books.value.filter((b) => b.categoryId === c.id).length,
  }));
  const max = Math.max(1, ...list.map((i) => i.count));
  return list.map((i) => ({ ...i, percent: Math.round((i.count / max) * 100) }));
});

const availableBooks = computed(() => books.value.filter((b) => (b.available || 0) > 0));

function openBook(book) {
  formError.value = '';
  Object.assign(bookForm, book
    ? { id: book.id, title: book.title, author: book.author, isbn: book.isbn || '', publisher: book.publisher || '', publishYear: book.publishYear || 2024, categoryId: book.categoryId, total: book.total }
    : { id: null, title: '', author: '', isbn: '', publisher: '', publishYear: 2024, categoryId: categories.value[0]?.id ?? null, total: 3 });
  modal.value = 'book';
}

async function saveBook() {
  saving.value = true;
  formError.value = '';
  try {
    const body = { ...bookForm };
    if (bookForm.id) await api.updateBook(bookForm.id, body);
    else await api.createBook(body);
    modal.value = '';
    notify('保存成功');
    await Promise.all([loadBooks(), refreshStats()]);
  } catch (e) {
    formError.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function removeBook(book) {
  if (!confirm(`确定删除《${book.title}》吗？`)) return;
  try {
    await api.deleteBook(book.id);
    notify('已删除');
    await Promise.all([loadBooks(), refreshStats()]);
  } catch (e) {
    notify(e.message);
  }
}

function openCategory(c) {
  formError.value = '';
  Object.assign(categoryForm, c ? { id: c.id, name: c.name, description: c.description || '' } : { id: null, name: '', description: '' });
  modal.value = 'category';
}

async function saveCategory() {
  saving.value = true;
  formError.value = '';
  try {
    const body = { name: categoryForm.name, description: categoryForm.description };
    if (categoryForm.id) await api.updateCategory(categoryForm.id, body);
    else await api.createCategory(body);
    modal.value = '';
    notify('保存成功');
    const c = await api.categories();
    categories.value = c;
    await refreshStats();
  } catch (e) {
    formError.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function removeCategory(c) {
  if (!confirm(`确定删除分类「${c.name}」吗？`)) return;
  try {
    await api.deleteCategory(c.id);
    notify('已删除');
    categories.value = await api.categories();
    await refreshStats();
  } catch (e) {
    notify(e.message);
  }
}

function openReader(r) {
  formError.value = '';
  Object.assign(readerForm, r
    ? { id: r.id, name: r.name, gender: r.gender || '男', phone: r.phone || '', cardNo: r.cardNo }
    : { id: null, name: '', gender: '男', phone: '', cardNo: '' });
  modal.value = 'reader';
}

async function saveReader() {
  saving.value = true;
  formError.value = '';
  try {
    const body = { name: readerForm.name, gender: readerForm.gender, phone: readerForm.phone, cardNo: readerForm.cardNo };
    if (readerForm.id) await api.updateReader(readerForm.id, body);
    else await api.createReader(body);
    modal.value = '';
    notify('保存成功');
    await Promise.all([loadReaders(), refreshStats()]);
  } catch (e) {
    formError.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function removeReader(r) {
  if (!confirm(`确定删除读者「${r.name}」吗？`)) return;
  try {
    await api.deleteReader(r.id);
    notify('已删除');
    await Promise.all([loadReaders(), refreshStats()]);
  } catch (e) {
    notify(e.message);
  }
}

async function openBorrow(book) {
  formError.value = '';
  await loadBooks();
  await loadReaders();
  Object.assign(borrowForm, { bookId: book ? book.id : null, readerId: null });
  modal.value = 'borrow';
}

async function submitBorrow() {
  saving.value = true;
  formError.value = '';
  try {
    await api.borrow({ bookId: borrowForm.bookId, readerId: borrowForm.readerId });
    modal.value = '';
    notify('借阅登记成功，应还日期为 30 天后');
    await Promise.all([loadBorrows(), loadBooks(), refreshStats()]);
  } catch (e) {
    formError.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function giveBack(row) {
  if (!confirm(`确认「${row.readerName}」归还《${row.bookTitle}》吗？`)) return;
  try {
    await api.giveBack(row.id);
    notify('归还成功');
    await Promise.all([loadBorrows(), loadBooks(), refreshStats()]);
  } catch (e) {
    notify(e.message);
  }
}

async function refreshStats() {
  Object.assign(stats, await api.stats());
}

const statusText = { active: '借阅中', overdue: '已逾期', returned: '已归还' };

if (logged.value) loadAll();
</script>

<template>
  <div v-if="!logged" class="login-wrap">
    <div class="login-card">
      <div class="brand-mark">图书馆</div>
      <h1>云笺图书馆 · 管理后台</h1>
      <p class="sub">Spring Boot + Vue3 + MySQL · 演示环境</p>
      <label>账号</label>
      <input v-model="loginForm.username" placeholder="admin" @keyup.enter="login" />
      <label>密码</label>
      <input v-model="loginForm.password" type="password" placeholder="123456" @keyup.enter="login" />
      <p v-if="loginError" class="error">{{ loginError }}</p>
      <button class="btn primary full" @click="login">登录系统</button>
      <p class="hint">演示账号 admin / 123456（数据由后端随机生成）</p>
    </div>
  </div>

  <div v-else class="app">
    <aside class="sidebar">
      <div class="logo"><span class="dot"></span>云笺图书馆</div>
      <nav>
        <a :class="{ active: tab === 'dashboard' }" @click="switchTab('dashboard')"><i class="ic">▦</i>概览</a>
        <a :class="{ active: tab === 'books' }" @click="switchTab('books')"><i class="ic">▤</i>图书管理</a>
        <a :class="{ active: tab === 'categories' }" @click="switchTab('categories')"><i class="ic">◈</i>分类管理</a>
        <a :class="{ active: tab === 'readers' }" @click="switchTab('readers')"><i class="ic">☺</i>读者管理</a>
        <a :class="{ active: tab === 'borrows' }" @click="switchTab('borrows')"><i class="ic">⇄</i>借阅管理</a>
      </nav>
      <div class="side-foot">数据每日自动初始化<br />仅用于演示</div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div>
          <h2>{{ { dashboard: '运营概览', books: '图书管理', categories: '分类管理', readers: '读者管理', borrows: '借阅管理' }[tab] }}</h2>
          <p class="today">今天是 {{ stats.today }}</p>
        </div>
        <div class="user">
          <span>管理员 · {{ userName }}</span>
          <button class="btn ghost" @click="logout">退出</button>
        </div>
      </header>

      <section v-if="tab === 'dashboard'" class="content">
        <div class="cards">
          <div class="card"><span>图书品种</span><strong>{{ stats.bookTitles }}</strong><em>共 {{ stats.categoryCount }} 个分类</em></div>
          <div class="card"><span>馆藏总量</span><strong>{{ stats.totalCopies }}</strong><em>可借 {{ stats.availableCopies }} 册</em></div>
          <div class="card"><span>当前在借</span><strong>{{ stats.activeBorrows }}</strong><em>已借出 {{ stats.borrowedCopies }} 册</em></div>
          <div class="card warn"><span>逾期未还</span><strong>{{ stats.overdue }}</strong><em>请及时催还</em></div>
          <div class="card"><span>注册读者</span><strong>{{ stats.readerCount }}</strong><em>有效借书证</em></div>
        </div>

        <div class="split">
          <div class="panel">
            <div class="panel-title">最近借阅记录</div>
            <table class="table">
              <thead><tr><th>图书</th><th>读者</th><th>应还日期</th><th>状态</th></tr></thead>
              <tbody>
                <tr v-for="row in borrows.slice(0, 7)" :key="row.id">
                  <td>{{ row.bookTitle }}</td>
                  <td>{{ row.readerName }}</td>
                  <td>{{ row.dueDate }}</td>
                  <td><span class="badge" :class="row.status">{{ statusText[row.status] }}</span></td>
                </tr>
                <tr v-if="!borrows.length"><td colspan="4" class="empty">暂无借阅记录</td></tr>
              </tbody>
            </table>
          </div>
          <div class="panel">
            <div class="panel-title">分类藏书分布</div>
            <div class="bars">
              <div v-for="item in categoryChart" :key="item.name" class="bar-row">
                <span class="bar-label">{{ item.name }}</span>
                <div class="bar"><i :style="{ width: item.percent + '%' }"></i></div>
                <span class="bar-num">{{ item.count }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-if="tab === 'books'" class="content">
        <div class="toolbar">
          <input v-model="bookKeyword" placeholder="搜索书名 / 作者 / ISBN" @keyup.enter="loadBooks" />
          <select v-model="categoryFilter" @change="loadBooks">
            <option value="">全部分类</option>
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
          <button class="btn" @click="loadBooks">查询</button>
          <span class="flex"></span>
          <button class="btn primary" @click="openBook(null)">新增图书</button>
          <button class="btn" @click="openBorrow(null)">借阅登记</button>
        </div>
        <div class="panel">
          <table class="table">
            <thead><tr><th>书名</th><th>作者</th><th>分类</th><th>ISBN</th><th>馆藏</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="b in books" :key="b.id">
                <td class="strong">{{ b.title }}</td>
                <td>{{ b.author }}</td>
                <td>{{ categoryName(b.categoryId) }}</td>
                <td class="mono">{{ b.isbn }}</td>
                <td><span :class="{ low: b.available === 0 }">{{ b.available }}</span> / {{ b.total }}</td>
                <td class="ops">
                  <a @click="openBook(b)">编辑</a>
                  <a :class="{ disabled: b.available === 0 }" @click="b.available > 0 && openBorrow(b)">借出</a>
                  <a class="danger" @click="removeBook(b)">删除</a>
                </td>
              </tr>
              <tr v-if="!books.length"><td colspan="6" class="empty">没有匹配的图书</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="tab === 'categories'" class="content">
        <div class="toolbar">
          <span class="count">共 {{ categories.length }} 个分类</span>
          <span class="flex"></span>
          <button class="btn primary" @click="openCategory(null)">新增分类</button>
        </div>
        <div class="panel">
          <table class="table">
            <thead><tr><th>分类名称</th><th>描述</th><th>图书数量</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="c in categories" :key="c.id">
                <td class="strong">{{ c.name }}</td>
                <td class="muted">{{ c.description || '—' }}</td>
                <td>{{ books.filter((b) => b.categoryId === c.id).length }}</td>
                <td class="ops"><a @click="openCategory(c)">编辑</a><a class="danger" @click="removeCategory(c)">删除</a></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="tab === 'readers'" class="content">
        <div class="toolbar">
          <input v-model="readerKeyword" placeholder="搜索姓名 / 借书证 / 手机号" @keyup.enter="loadReaders" />
          <button class="btn" @click="loadReaders">查询</button>
          <span class="flex"></span>
          <button class="btn primary" @click="openReader(null)">新增读者</button>
        </div>
        <div class="panel">
          <table class="table">
            <thead><tr><th>借书证号</th><th>姓名</th><th>性别</th><th>手机号</th><th>注册时间</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="r in readers" :key="r.id">
                <td class="mono">{{ r.cardNo }}</td>
                <td class="strong">{{ r.name }}</td>
                <td>{{ r.gender }}</td>
                <td>{{ r.phone }}</td>
                <td>{{ (r.createdAt || '').slice(0, 10) }}</td>
                <td class="ops"><a @click="openReader(r)">编辑</a><a class="danger" @click="removeReader(r)">删除</a></td>
              </tr>
              <tr v-if="!readers.length"><td colspan="6" class="empty">没有匹配的读者</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section v-if="tab === 'borrows'" class="content">
        <div class="toolbar">
          <button class="chip" :class="{ on: borrowFilter === 'active' }" @click="borrowFilter = 'active'; loadBorrows()">借阅中</button>
          <button class="chip" :class="{ on: borrowFilter === 'overdue' }" @click="borrowFilter = 'overdue'; loadBorrows()">已逾期</button>
          <button class="chip" :class="{ on: borrowFilter === 'returned' }" @click="borrowFilter = 'returned'; loadBorrows()">已归还</button>
          <button class="chip" :class="{ on: borrowFilter === 'all' }" @click="borrowFilter = 'all'; loadBorrows()">全部</button>
          <span class="flex"></span>
          <button class="btn primary" @click="openBorrow(null)">借阅登记</button>
        </div>
        <div class="panel">
          <table class="table">
            <thead><tr><th>图书</th><th>读者</th><th>借出日期</th><th>应还日期</th><th>归还日期</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="row in borrows" :key="row.id">
                <td class="strong">{{ row.bookTitle }}</td>
                <td>{{ row.readerName }}<small class="muted"> · {{ row.readerCardNo }}</small></td>
                <td>{{ row.borrowDate }}</td>
                <td>{{ row.dueDate }}</td>
                <td>{{ row.returnDate || '—' }}</td>
                <td><span class="badge" :class="row.status">{{ statusText[row.status] }}</span></td>
                <td class="ops"><a v-if="row.status !== 'returned'" @click="giveBack(row)">归还</a><span v-else class="muted">已完成</span></td>
              </tr>
              <tr v-if="!borrows.length"><td colspan="7" class="empty">暂无记录</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  </div>

  <transition name="fade">
    <div v-if="toast" class="toast">{{ toast }}</div>
  </transition>

  <div v-if="modal" class="mask" @click.self="modal = ''">
    <div class="dialog">
      <div class="dialog-head">
        <h3>{{ modal === 'book' ? (bookForm.id ? '编辑图书' : '新增图书') : modal === 'category' ? (categoryForm.id ? '编辑分类' : '新增分类') : modal === 'reader' ? (readerForm.id ? '编辑读者' : '新增读者') : '借阅登记' }}</h3>
        <a class="close" @click="modal = ''">×</a>
      </div>

      <div v-if="modal === 'book'" class="dialog-body">
        <label>书名</label><input v-model="bookForm.title" placeholder="请输入书名" />
        <label>作者</label><input v-model="bookForm.author" placeholder="请输入作者" />
        <div class="grid2">
          <div><label>分类</label><select v-model="bookForm.categoryId"><option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option></select></div>
          <div><label>馆藏数量</label><input v-model.number="bookForm.total" type="number" min="1" /></div>
        </div>
        <div class="grid2">
          <div><label>ISBN</label><input v-model="bookForm.isbn" placeholder="选填" /></div>
          <div><label>出版年份</label><input v-model.number="bookForm.publishYear" type="number" /></div>
        </div>
        <label>出版社</label><input v-model="bookForm.publisher" placeholder="选填" />
        <p v-if="formError" class="error">{{ formError }}</p>
        <div class="dialog-foot"><button class="btn" @click="modal = ''">取消</button><button class="btn primary" :disabled="saving" @click="saveBook">保存</button></div>
      </div>

      <div v-if="modal === 'category'" class="dialog-body">
        <label>分类名称</label><input v-model="categoryForm.name" placeholder="如：文学" />
        <label>分类描述</label><input v-model="categoryForm.description" placeholder="选填" />
        <p v-if="formError" class="error">{{ formError }}</p>
        <div class="dialog-foot"><button class="btn" @click="modal = ''">取消</button><button class="btn primary" :disabled="saving" @click="saveCategory">保存</button></div>
      </div>

      <div v-if="modal === 'reader'" class="dialog-body">
        <label>姓名</label><input v-model="readerForm.name" placeholder="请输入姓名" />
        <div class="grid2">
          <div><label>性别</label><select v-model="readerForm.gender"><option>男</option><option>女</option></select></div>
          <div><label>手机号</label><input v-model="readerForm.phone" placeholder="选填" /></div>
        </div>
        <label>借书证号</label><input v-model="readerForm.cardNo" placeholder="留空自动生成" />
        <p v-if="formError" class="error">{{ formError }}</p>
        <div class="dialog-foot"><button class="btn" @click="modal = ''">取消</button><button class="btn primary" :disabled="saving" @click="saveReader">保存</button></div>
      </div>

      <div v-if="modal === 'borrow'" class="dialog-body">
        <label>选择图书</label>
        <select v-model="borrowForm.bookId">
          <option :value="null" disabled>请选择可借图书</option>
          <option v-for="b in availableBooks" :key="b.id" :value="b.id">{{ b.title }}（可借 {{ b.available }}）</option>
        </select>
        <label>选择读者</label>
        <select v-model="borrowForm.readerId">
          <option :value="null" disabled>请选择读者</option>
          <option v-for="r in readers" :key="r.id" :value="r.id">{{ r.name }} · {{ r.cardNo }}</option>
        </select>
        <p class="hint">借期 30 天，逾期会在借阅列表中标记。</p>
        <p v-if="formError" class="error">{{ formError }}</p>
        <div class="dialog-foot"><button class="btn" @click="modal = ''">取消</button><button class="btn primary" :disabled="saving" @click="submitBorrow">确认借出</button></div>
      </div>
    </div>
  </div>
</template>
