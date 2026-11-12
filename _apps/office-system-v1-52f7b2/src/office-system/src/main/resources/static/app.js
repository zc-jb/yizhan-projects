/* Workplace--Office Software · Vue3 前端（Options API，无构建步骤） */
const { createApp } = Vue;

const API = '';

const MENUS = [
  { k: 'dashboard', icon: '📊', label: '工作台', desc: '办公数据总览与快捷入口' },
  { k: 'reports', icon: '📄', label: '报表月报', desc: '月度办公费用报表管理与自动汇总' },
  { k: 'formula', icon: '🧮', label: '公式实验室', desc: '常用办公公式与函数即时计算' },
  { k: 'tips', icon: '💡', label: '办公技巧', desc: '快捷键、Excel 函数与电脑操作技巧' }
];

function fmtMoney(v) {
  const n = Number(v || 0);
  return '¥' + n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

createApp({
  data() {
    return {
      token: localStorage.getItem('ow_token') || '',
      user: JSON.parse(localStorage.getItem('ow_user') || 'null'),
      loading: false,
      loginForm: { username: 'admin', password: '123456' },
      loginErr: '',

      page: 'dashboard',
      menus: MENUS,
      stats: null,
      reports: [],
      reportQ: '',
      reportStatus: '全部',

      editing: null,
      saving: false,

      tips: [],
      tipCats: [],
      tipCat: '全部',
      tipQ: '',
      activeTip: null,

      expr: 'ROUND(PERCENT(11350,12000),2)',
      quickExprs: ['SUM(12800,8600,3600)', 'AVG(88,92,79,95)', 'IF(92>=90,1,0)', 'ROUND(1234.5678,2)', 'MOD(17,5)'],
      formulaResult: '',
      formulaErr: '',
      funcs: [],
      history: [],

      toastMsg: '',
      toastShow: false,
      toastTimer: null
    };
  },

  computed: {
    currentMenu() {
      return this.menus.find(m => m.k === this.page) || this.menus[0];
    },
    today() {
      const d = new Date();
      const w = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
      return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${w}`;
    },
    greeting() {
      const h = new Date().getHours();
      if (h < 6) return '夜深了';
      if (h < 12) return '早上好';
      if (h < 14) return '中午好';
      if (h < 18) return '下午好';
      return '晚上好';
    },
    filteredReports() {
      const q = this.reportQ.trim().toLowerCase();
      return this.reports.filter(r => {
        const okStatus = this.reportStatus === '全部' || r.status === this.reportStatus;
        const okQ = !q || (r.title || '').toLowerCase().includes(q) || (r.dept || '').toLowerCase().includes(q);
        return okStatus && okQ;
      });
    },
    filteredTips() {
      const q = this.tipQ.trim().toLowerCase();
      return this.tips.filter(t => {
        const okCat = this.tipCat === '全部' || t.category === this.tipCat;
        const okQ = !q || (t.title + t.summary + (t.shortcut || '')).toLowerCase().includes(q);
        return okCat && okQ;
      });
    },
    editBudget() {
      if (!this.editing) return 0;
      return this.editing.rows.reduce((s, r) => s + (Number(r.budget) || 0), 0);
    },
    editActual() {
      if (!this.editing) return 0;
      return this.editing.rows.reduce((s, r) => s + (Number(r.actual) || 0), 0);
    },
    editRate() {
      if (!this.editBudget) return 0;
      return Math.round((this.editActual / this.editBudget) * 10000) / 100;
    }
  },

  methods: {
    /* ---------- 通用 ---------- */
    async api(path, opts = {}) {
      const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      if (this.token) headers['X-Token'] = this.token;
      const res = await fetch(API + path, Object.assign({}, opts, { headers }));
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (!res.ok) {
        if (res.status === 401) this.clearSession();
        throw new Error((data && data.error) || ('请求失败（' + res.status + '）'));
      }
      return data;
    },

    toast(msg) {
      this.toastMsg = msg;
      this.toastShow = true;
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => { this.toastShow = false; }, 2200);
    },

    money: fmtMoney,

    short(v) {
      const n = Number(v || 0);
      return n >= 10000 ? (n / 10000).toFixed(1) + 'w' : String(Math.round(n));
    },

    barH(v) {
      const list = (this.stats && this.stats.trend) || [];
      const max = Math.max.apply(null, list.map(i => Number(i.value) || 0).concat([1]));
      return Math.max(6, Math.round((Number(v) || 0) / max * 100)) + '%';
    },

    statusClass(s) {
      if (s === '已归档') return 'done';
      if (s === '已提交') return 'sub';
      return 'draft';
    },

    go(page) {
      this.page = page;
      if (page === 'reports') this.loadReports();
      if (page === 'tips') this.loadTips();
      if (page === 'formula') this.loadFormula();
      if (page === 'dashboard') this.loadStats();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    /* ---------- 登录 ---------- */
    async login() {
      this.loginErr = '';
      if (!this.loginForm.username || !this.loginForm.password) {
        this.loginErr = '请输入账号和密码';
        return;
      }
      this.loading = true;
      try {
        const data = await this.api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify(this.loginForm)
        });
        this.token = data.token;
        this.user = data.user;
        localStorage.setItem('ow_token', data.token);
        localStorage.setItem('ow_user', JSON.stringify(data.user));
        await this.boot();
        this.toast('登录成功，欢迎回来');
      } catch (e) {
        this.loginErr = e.message;
      } finally {
        this.loading = false;
      }
    },

    logout() {
      try { this.api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
      this.clearSession();
    },

    clearSession() {
      this.token = '';
      this.user = null;
      this.editing = null;
      this.page = 'dashboard';
      localStorage.removeItem('ow_token');
      localStorage.removeItem('ow_user');
    },

    /* ---------- 数据加载 ---------- */
    async boot() {
      try {
        await Promise.all([this.loadStats(), this.loadReports(), this.loadFormula(), this.loadTips()]);
      } catch (e) {
        this.toast(e.message);
      }
    },

    async loadStats() {
      this.stats = await this.api('/api/stats');
    },

    async loadReports() {
      this.reports = await this.api('/api/reports');
    },

    async loadTips() {
      const [cats, list] = await Promise.all([
        this.api('/api/tips/categories'),
        this.api('/api/tips')
      ]);
      this.tipCats = cats || [];
      this.tips = list || [];
    },

    async loadFormula() {
      const [funcs, history] = await Promise.all([
        this.api('/api/formula/functions'),
        this.api('/api/formula/history')
      ]);
      this.funcs = funcs || [];
      this.history = history || [];
    },

    /* ---------- 报表 ---------- */
    defaultRows() {
      return ['办公耗材', '打印复印', '快递物流', '差旅交通', '会议接待', '软件订阅', '水电物业', '其他杂项']
        .map(name => ({ name, budget: 0, actual: 0, note: '' }));
    },

    newReport() {
      const d = new Date();
      const period = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      this.editing = {
        id: null,
        title: period + ' 办公费用月报',
        period,
        dept: '综合行政部',
        status: '草稿',
        rows: this.defaultRows()
      };
      this.page = 'editor';
    },

    async openReport(id) {
      try {
        const r = await this.api('/api/reports/' + id);
        let rows = [];
        try { rows = (JSON.parse(r.dataJson || '{}').rows) || []; } catch (e) { rows = []; }
        if (!rows.length) rows = this.defaultRows();
        this.editing = {
          id: r.id,
          title: r.title,
          period: r.period,
          dept: r.dept,
          status: r.status,
          rows: rows.map(x => ({
            name: x.name || '',
            budget: Number(x.budget) || 0,
            actual: Number(x.actual) || 0,
            note: x.note || ''
          }))
        };
        this.page = 'editor';
        window.scrollTo({ top: 0 });
      } catch (e) {
        this.toast(e.message);
      }
    },

    rowRate(row) {
      const b = Number(row.budget) || 0;
      const a = Number(row.actual) || 0;
      if (!b) return 0;
      return Math.round((a / b) * 10000) / 100;
    },

    addRow() {
      if (!this.editing) return;
      this.editing.rows.push({ name: '新科目', budget: 0, actual: 0, note: '' });
    },

    removeRow(i) {
      if (!this.editing) return;
      this.editing.rows.splice(i, 1);
      if (!this.editing.rows.length) this.editing.rows.push({ name: '新科目', budget: 0, actual: 0, note: '' });
    },

    async saveReport() {
      if (!this.editing) return;
      if (!this.editing.title.trim()) { this.toast('请填写报表标题'); return; }
      this.saving = true;
      try {
        const payload = {
          title: this.editing.title.trim(),
          period: this.editing.period,
          dept: this.editing.dept,
          status: this.editing.status,
          data: { rows: this.editing.rows }
        };
        let saved;
        if (this.editing.id) {
          saved = await this.api('/api/reports/' + this.editing.id, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
          saved = await this.api('/api/reports', { method: 'POST', body: JSON.stringify(payload) });
        }
        this.editing.id = saved.id;
        await Promise.all([this.loadReports(), this.loadStats()]);
        this.toast('报表已保存');
        this.page = 'reports';
      } catch (e) {
        this.toast(e.message);
      } finally {
        this.saving = false;
      }
    },

    async copyReport(r) {
      try {
        let rows = [];
        try { rows = (JSON.parse(r.dataJson || '{}').rows) || []; } catch (e) { rows = []; }
        await this.api('/api/reports', {
          method: 'POST',
          body: JSON.stringify({
            title: r.title + '（副本）',
            period: r.period,
            dept: r.dept,
            status: '草稿',
            data: { rows }
          })
        });
        await Promise.all([this.loadReports(), this.loadStats()]);
        this.toast('已复制为新草稿');
      } catch (e) {
        this.toast(e.message);
      }
    },

    async removeReport(r) {
      if (!window.confirm('确定删除「' + r.title + '」吗？')) return;
      try {
        await this.api('/api/reports/' + r.id, { method: 'DELETE' });
        await Promise.all([this.loadReports(), this.loadStats()]);
        this.toast('已删除');
      } catch (e) {
        this.toast(e.message);
      }
    },

    /* ---------- 公式 ---------- */
    async calc() {
      this.formulaErr = '';
      this.formulaResult = '';
      if (!this.expr.trim()) { this.formulaErr = '请输入公式'; return; }
      try {
        const data = await this.api('/api/formula/eval', {
          method: 'POST',
          body: JSON.stringify({ expr: this.expr })
        });
        this.formulaResult = data.result;
        await Promise.all([this.loadFormula(), this.loadStats()]);
      } catch (e) {
        this.formulaErr = e.message;
      }
    },

    /* ---------- 技巧 ---------- */
    async previewTip(id) {
      try {
        this.activeTip = await this.api('/api/tips/' + id);
        await this.loadTips();
        if (this.stats) this.loadStats();
      } catch (e) {
        this.toast(e.message);
      }
    }
  },

  async mounted() {
    if (this.token) {
      await this.boot();
    }
  }
}).mount('#app');
