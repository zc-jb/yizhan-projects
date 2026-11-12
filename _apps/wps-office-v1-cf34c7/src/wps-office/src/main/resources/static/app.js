/* ============================================================
 * WPS 表格仿真 · 前端应用（Vue3 Options API，无构建）
 * ============================================================ */
const { createApp } = Vue;
const E = window.WpsEngine;

const RIBBON_TABS = [
  { k: 'home', name: '开始' },
  { k: 'insert', name: '插入' },
  { k: 'formula', name: '公式' },
  { k: 'data', name: '数据' },
  { k: 'view', name: '视图' }
];

const NUM_FORMATS = [
  { v: '', t: '常规' },
  { v: 'currency', t: '货币 ¥' },
  { v: 'percent', t: '百分比' },
  { v: 'num2', t: '两位小数' },
  { v: 'int', t: '整数' },
  { v: 'thousand', t: '千分位' }
];

createApp({
  data() {
    return {
      token: localStorage.getItem('wps_token') || '',
      user: JSON.parse(localStorage.getItem('wps_user') || 'null'),
      loading: false,
      loginForm: { username: 'admin', password: '123456' },
      loginErr: '',

      page: 'home',
      workbooks: [],
      wb: null,
      activeSheetId: '',

      tabs: RIBBON_TABS,
      ribbonTab: 'home',

      active: { r: 0, c: 0 },
      sel: { r1: 0, c1: 0, r2: 0, c2: 0 },
      dragging: false,
      dragStarted: false,
      editing: null,
      editInput: '',
      formulaText: '',
      vmCache: {},
      clip: null,

      dirty: false,
      saving: false,
      lastSaved: '',
      saveTimer: null,

      fillColor: '#fff2c2',
      fontColor: '#c0392b',
      numFmtSel: '',

      showGrid: true,
      showFormulas: false,

      drawer: false,
      drawerTab: 'func',
      funcPick: 'VLOOKUP',
      funcParams: {},
      picking: '',
      outCell: '',
      preview: null,

      month: { dateRange: '', valueRange: '', agg: 'sum' },
      monthPreview: null,

      sheetModal: { on: false, mode: 'add', value: '' },
      confirmBox: { on: false, title: '', text: '', action: null },

      funcGroups: E.FUNC_LIBRARY,
      numFormats: NUM_FORMATS,

      toastMsg: '',
      toastShow: false,
      toastTimer: null
    };
  },

  computed: {
    sheet() {
      if (!this.wb) return null;
      return this.wb.sheets.find(s => s.id === this.activeSheetId) || this.wb.sheets[0];
    },
    sheetIndex() {
      return this.wb ? this.wb.sheets.findIndex(s => s.id === this.activeSheetId) : 0;
    },
    colLabels() {
      const n = this.sheet ? this.sheet.cols : 0;
      return Array.from({ length: n }, (_, i) => E.colLetter(i));
    },
    rowLabels() {
      const n = this.sheet ? this.sheet.rows : 0;
      return Array.from({ length: n }, (_, i) => i + 1);
    },
    cellAddr() {
      return E.rcToAddr(this.active.r, this.active.c);
    },
    selRef() {
      if (!this.sheet) return '';
      const a = E.rcToAddr(this.sel.r1, this.sel.c1);
      const b = E.rcToAddr(this.sel.r2, this.sel.c2);
      return this.sheet.name + '!' + (a === b ? a : a + ':' + b);
    },
    selSize() {
      return (Math.abs(this.sel.r2 - this.sel.r1) + 1) + ' 行 × ' + (Math.abs(this.sel.c2 - this.sel.c1) + 1) + ' 列';
    },
    selStats() {
      const m = this.vmCache[this.sheet ? this.sheet.id : ''] || [];
      const r1 = Math.min(this.sel.r1, this.sel.r2), r2 = Math.max(this.sel.r1, this.sel.r2);
      const c1 = Math.min(this.sel.c1, this.sel.c2), c2 = Math.max(this.sel.c1, this.sel.c2);
      let sum = 0, count = 0, min = Infinity, max = -Infinity;
      for (let r = r1; r <= r2; r++) {
        const row = m[r] || [];
        for (let c = c1; c <= c2; c++) {
          const v = row[c];
          if (typeof v === 'number' && isFinite(v)) {
            sum += v; count++;
            if (v < min) min = v;
            if (v > max) max = v;
          }
        }
      }
      return { sum, count, avg: count ? sum / count : 0, min: count ? min : 0, max: count ? max : 0 };
    },
    curFunc() {
      for (const g of this.funcGroups) {
        const hit = g.items.find(i => i.k === this.funcPick);
        if (hit) return hit;
      }
      return this.funcGroups[0].items[0];
    },
    flatFuncs() {
      const out = [];
      this.funcGroups.forEach(g => g.items.forEach(i => out.push(i)));
      return out;
    },
    todayText() {
      const d = new Date();
      const w = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
      return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · ' + w;
    }
  },

  watch: {
    activeSheetId() {
      this.syncFormula();
      this.editing = null;
      this.preview = null;
    }
  },

  mounted() {
    document.addEventListener('mouseup', this.endDrag);
    window.addEventListener('keydown', this.onWindowKey);
    if (this.token) this.init();
  },

  beforeUnmount() {
    document.removeEventListener('mouseup', this.endDrag);
    window.removeEventListener('keydown', this.onWindowKey);
  },

  methods: {
    /* ---------------- 通用 ---------------- */
    async api(path, opts = {}) {
      const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      if (this.token) headers['X-Token'] = this.token;
      const res = await fetch(path, Object.assign({}, opts, { headers }));
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

    clearSession() {
      this.token = '';
      this.user = null;
      this.wb = null;
      this.page = 'home';
      localStorage.removeItem('wps_token');
      localStorage.removeItem('wps_user');
    },

    async login() {
      this.loginErr = '';
      if (!this.loginForm.username || !this.loginForm.password) {
        this.loginErr = '请输入账号和密码';
        return;
      }
      this.loading = true;
      try {
        const d = await this.api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify(this.loginForm)
        });
        this.token = d.token;
        this.user = d.user;
        localStorage.setItem('wps_token', d.token);
        localStorage.setItem('wps_user', JSON.stringify(d.user));
        await this.init();
      } catch (e) {
        this.loginErr = e.message;
      } finally {
        this.loading = false;
      }
    },

    async logout() {
      try { await this.api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
      this.clearSession();
      this.toast('已退出登录');
    },

    async init() {
      try {
        await this.loadWorkbooks();
      } catch (e) {
        this.toast(e.message);
      }
    },

    /* ---------------- 首页：工作簿 ---------------- */
    async loadWorkbooks() {
      this.workbooks = await this.api('/api/workbooks');
    },

    dt(v) {
      if (!v) return '';
      const s = String(v).replace('T', ' ');
      return s.slice(5, 16);
    },

    async newWorkbook() {
      try {
        const d = await this.api('/api/workbooks', {
          method: 'POST',
          body: JSON.stringify({ name: '新建工作簿' })
        });
        await this.openWorkbook(d.id, { blank: true });
      } catch (e) { this.toast(e.message); }
    },

    async openDemo() {
      try {
        const d = await this.api('/api/workbooks', {
          method: 'POST',
          body: JSON.stringify({ name: '示例：销售数据分析' })
        });
        await this.openWorkbook(d.id, { blank: false, rename: '示例：销售数据分析' });
      } catch (e) { this.toast(e.message); }
    },

    askDeleteWorkbook(w) {
      this.confirmBox = {
        on: true,
        title: '删除工作簿',
        text: '确定删除「' + w.name + '」吗？删除后不可恢复。',
        action: async () => {
          try {
            await this.api('/api/workbooks/' + w.id, { method: 'DELETE' });
            await this.loadWorkbooks();
            this.toast('已删除');
          } catch (e) { this.toast(e.message); }
        }
      };
    },

    runConfirm() {
      const cb = this.confirmBox.action;
      this.confirmBox = { on: false, title: '', text: '', action: null };
      if (cb) cb();
    },

    async openWorkbook(id, opt = {}) {
      try {
        const d = await this.api('/api/workbooks/' + id);
        const data = d.data || {};
        let sheets = Array.isArray(data.sheets) ? data.sheets : [];
        let seed = false;
        if (!sheets.length) {
          if (opt.blank) {
            sheets = [E.blankSheet('Sheet1')];
          } else {
            sheets = E.buildDemoWorkbook().sheets;
            seed = true;
          }
        }
        this.wb = {
          id: d.id,
          name: opt.rename || d.name || '工作簿',
          sheets: sheets.map(s => this.normalizeSheet(s))
        };
        this.activeSheetId = this.wb.sheets[0].id;
        this.page = 'editor';
        this.active = { r: 0, c: 0 };
        this.sel = { r1: 0, c1: 0, r2: 0, c2: 0 };
        this.drawer = false;
        this.preview = null;
        this.monthPreview = null;
        this.recalc();
        this.syncFormula();
        this.$nextTick(() => this.focusGrid());
        if (seed) await this.saveNow(true);
      } catch (e) {
        this.toast(e.message);
      }
    },

    normalizeSheet(s) {
      const rows = Math.max(20, parseInt(s.rows, 10) || 60);
      const cols = Math.max(8, parseInt(s.cols, 10) || 16);
      const data = [];
      for (let r = 0; r < rows; r++) {
        const src = (s.data && s.data[r]) || [];
        const row = new Array(cols).fill('');
        for (let c = 0; c < cols; c++) row[c] = src[c] == null ? '' : src[c];
        data.push(row);
      }
      return {
        id: s.id || ('s_' + Math.random().toString(36).slice(2, 9)),
        name: s.name || 'Sheet1',
        rows: rows,
        cols: cols,
        data: data,
        fmts: s.fmts && typeof s.fmts === 'object' ? s.fmts : {}
      };
    },

    async saveNow(silent) {
      if (!this.wb || this.saving) return;
      this.saving = true;
      try {
        await this.api('/api/workbooks/' + this.wb.id, {
          method: 'PUT',
          body: JSON.stringify({
            name: this.wb.name,
            data: { sheets: this.wb.sheets },
            sheetCount: this.wb.sheets.length
          })
        });
        this.dirty = false;
        const d = new Date();
        const p = n => String(n).padStart(2, '0');
        this.lastSaved = p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
        if (!silent) this.toast('已保存到 MySQL');
      } catch (e) {
        this.toast('保存失败：' + e.message);
      } finally {
        this.saving = false;
      }
    },

    markDirty() {
      this.dirty = true;
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.saveNow(true), 1800);
    },

    async goHome() {
      if (this.wb && this.dirty) await this.saveNow(true);
      this.page = 'home';
      this.wb = null;
      try { await this.loadWorkbooks(); } catch (e) { /* ignore */ }
    },

    /* ---------------- 计算 ---------------- */
    recalc() {
      if (!this.wb) { this.vmCache = {}; return; }
      this.vmCache = E.recalc({ sheets: this.wb.sheets });
    },

    vmValue(r, c) {
      const m = this.sheet ? this.vmCache[this.sheet.id] : null;
      if (!m || !m[r]) return '';
      return m[r][c];
    },

    rawAt(r, c) {
      const row = this.sheet && this.sheet.data[r];
      return row ? row[c] : '';
    },

    setRaw(r, c, v) {
      const sh = this.sheet;
      if (!sh || r < 0 || c < 0 || r >= sh.rows || c >= sh.cols) return;
      let val = v == null ? '' : v;
      if (typeof val === 'string') {
        const t = val.trim();
        if (t === '') val = '';
        else if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(t)) val = Number(t);
        else val = t;
      }
      if (!sh.data[r]) sh.data[r] = new Array(sh.cols).fill('');
      sh.data[r][c] = val;
    },

    displayOf(r, c) {
      if (this.showFormulas) {
        const raw = this.rawAt(r, c);
        return raw === '' || raw == null ? '' : String(raw);
      }
      const f = this.sheet.fmts[E.rcToAddr(r, c)];
      return E.formatValue(this.vmValue(r, c), f && f.nf);
    },

    cellStyle(r, c) {
      const f = this.sheet.fmts[E.rcToAddr(r, c)] || {};
      const st = {};
      if (f.b) st.fontWeight = '700';
      if (f.i) st.fontStyle = 'italic';
      if (f.u) st.textDecoration = 'underline';
      if (f.color) st.color = f.color;
      if (f.bg) st.background = f.bg;
      const v = this.vmValue(r, c);
      st.textAlign = f.align || (typeof v === 'number' ? 'right' : 'left');
      if (typeof v === 'string' && v.charAt(0) === '#') st.color = '#d93026';
      return st;
    },

    isActive(r, c) {
      return this.active.r === r && this.active.c === c;
    },

    inSel(r, c) {
      const r1 = Math.min(this.sel.r1, this.sel.r2), r2 = Math.max(this.sel.r1, this.sel.r2);
      const c1 = Math.min(this.sel.c1, this.sel.c2), c2 = Math.max(this.sel.c1, this.sel.c2);
      return r >= r1 && r <= r2 && c >= c1 && c <= c2;
    },

    /* ---------------- 选区与编辑 ---------------- */
    focusGrid() {
      const el = this.$refs.gridwrap;
      if (el) el.focus();
    },

    selectCell(r, c) {
      this.active = { r: r, c: c };
      this.sel = { r1: r, c1: c, r2: r, c2: c };
      this.syncFormula();
    },

    onCellDown(r, c, ev) {
      if (this.editing) this.commitEdit();
      this.focusGrid();
      this.dragStarted = true;
      if (ev.shiftKey) {
        this.sel.r2 = r;
        this.sel.c2 = c;
      } else {
        this.active = { r: r, c: c };
        this.sel = { r1: r, c1: c, r2: r, c2: c };
        this.dragging = true;
      }
      this.syncFormula();
    },

    onCellEnter(r, c) {
      if (!this.dragging) return;
      this.sel.r2 = r;
      this.sel.c2 = c;
    },

    endDrag() {
      const wasDrag = this.dragStarted;
      this.dragging = false;
      this.dragStarted = false;
      if (!this.picking || !wasDrag) return;
      const r1 = Math.min(this.sel.r1, this.sel.r2), c1 = Math.min(this.sel.c1, this.sel.c2);
      const r2 = Math.max(this.sel.r1, this.sel.r2), c2 = Math.max(this.sel.c1, this.sel.c2);
      let txt = this.sheet.name + '!' + E.rcToAddr(r1, c1);
      if (r1 !== r2 || c1 !== c2) txt += ':' + E.rcToAddr(r2, c2);
      if (this.picking === '__out') {
        this.outCell = E.rcToAddr(r1, c1);
        this.toast('结果写入位置：' + this.outCell);
      } else if (this.picking === 'monthDate') {
        this.month.dateRange = txt;
        this.toast('日期列：' + txt);
      } else if (this.picking === 'monthValue') {
        this.month.valueRange = txt;
        this.toast('数值列：' + txt);
      } else {
        this.funcParams[this.picking] = txt;
        this.preview = null;
        this.toast('已填入：' + txt);
      }
      this.picking = '';
    },

    startEdit(r, c, initial) {
      if (!this.sheet) return;
      if (this.picking) return;
      this.editing = { r: r, c: c };
      const raw = this.rawAt(r, c);
      this.editInput = initial != null ? initial : (raw == null ? '' : String(raw));
      this.formulaText = this.editInput;
      this.$nextTick(() => {
        const el = document.querySelector('.cell-input');
        if (el) {
          el.focus();
          if (initial == null) el.select();
          else { el.setSelectionRange(el.value.length, el.value.length); }
        }
      });
    },

    commitEdit(move) {
      if (!this.editing) return;
      const { r, c } = this.editing;
      this.editing = null;
      this.setRaw(r, c, this.editInput);
      this.recalc();
      this.markDirty();
      if (move === 'down') this.selectCell(Math.min(r + 1, this.sheet.rows - 1), c);
      else if (move === 'right') this.selectCell(r, Math.min(c + 1, this.sheet.cols - 1));
      else this.selectCell(r, c);
      this.$nextTick(() => this.focusGrid());
    },

    cancelEdit() {
      this.editing = null;
      this.syncFormula();
      this.$nextTick(() => this.focusGrid());
    },

    syncFormula() {
      if (this.editing) return;
      const raw = this.rawAt(this.active.r, this.active.c);
      this.formulaText = raw == null ? '' : String(raw);
    },

    commitFormulaBar() {
      this.setRaw(this.active.r, this.active.c, this.formulaText);
      this.recalc();
      this.markDirty();
      this.selectCell(this.active.r, this.active.c);
      this.toast('已写入 ' + this.cellAddr);
    },

    onWindowKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && this.page === 'editor') {
        e.preventDefault();
        this.saveNow();
      }
    },

    onGridKey(e) {
      if (this.editing) return;
      const k = e.key;
      if (e.ctrlKey || e.metaKey) {
        if (k.toLowerCase() === 'c') { e.preventDefault(); this.copySel(); }
        else if (k.toLowerCase() === 'v') { e.preventDefault(); this.pasteSel(); }
        else if (k.toLowerCase() === 'a') { e.preventDefault(); this.selectAll(); }
        return;
      }
      const maxR = this.sheet.rows - 1, maxC = this.sheet.cols - 1;
      const { r, c } = this.active;
      if (k === 'ArrowUp') { e.preventDefault(); this.selectCell(Math.max(0, r - 1), c); }
      else if (k === 'ArrowDown') { e.preventDefault(); this.selectCell(Math.min(maxR, r + 1), c); }
      else if (k === 'ArrowLeft') { e.preventDefault(); this.selectCell(r, Math.max(0, c - 1)); }
      else if (k === 'ArrowRight') { e.preventDefault(); this.selectCell(r, Math.min(maxC, c + 1)); }
      else if (k === 'Tab') { e.preventDefault(); this.selectCell(r, Math.min(maxC, c + 1)); }
      else if (k === 'Enter') { e.preventDefault(); this.startEdit(r, c); }
      else if (k === 'F2') { e.preventDefault(); this.startEdit(r, c); }
      else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.clearContent(); }
      else if (k.length === 1 && !e.altKey) { e.preventDefault(); this.startEdit(r, c, k); }
    },

    selectAll() {
      this.sel = { r1: 0, c1: 0, r2: this.sheet.rows - 1, c2: this.sheet.cols - 1 };
      this.syncFormula();
    },

    moveActive(dr, dc) {
      this.selectCell(
        Math.min(Math.max(0, this.active.r + dr), this.sheet.rows - 1),
        Math.min(Math.max(0, this.active.c + dc), this.sheet.cols - 1)
      );
    },

    copySel() {
      const { r1, r2, c1, c2 } = this.sel;
      const rA = Math.min(r1, r2), rB = Math.max(r1, r2);
      const cA = Math.min(c1, c2), cB = Math.max(c1, c2);
      const clip = [];
      for (let r = rA; r <= rB; r++) {
        const row = [];
        for (let c = cA; c <= cB; c++) row.push(this.rawAt(r, c));
        clip.push(row);
      }
      this.clip = clip;
      this.toast('已复制 ' + (rB - rA + 1) + ' 行 × ' + (cB - cA + 1) + ' 列');
    },

    pasteSel() {
      if (!this.clip) { this.toast('剪贴板为空，请先复制'); return; }
      const { r, c } = this.active;
      this.clip.forEach((row, i) => row.forEach((v, j) => this.setRaw(r + i, c + j, v)));
      this.recalc();
      this.markDirty();
      this.toast('已粘贴 ' + this.clip.length + ' 行');
    },

    /* ---------------- 行列 / 工作表 ---------------- */
    blankRow() {
      return new Array(this.sheet.cols).fill('');
    },

    insertRow() {
      const r = Math.min(this.sel.r1, this.sel.r2);
      this.sheet.data.splice(r, 0, this.blankRow());
      this.sheet.data.pop();
      this.recalc();
      this.markDirty();
      this.toast('已在第 ' + (r + 1) + ' 行前插入一行');
    },

    deleteRow() {
      const r1 = Math.min(this.sel.r1, this.sel.r2), r2 = Math.max(this.sel.r1, this.sel.r2);
      this.sheet.data.splice(r1, r2 - r1 + 1);
      while (this.sheet.data.length < this.sheet.rows) this.sheet.data.push(this.blankRow());
      this.recalc();
      this.markDirty();
      this.toast('已删除 ' + (r2 - r1 + 1) + ' 行');
    },

    insertCol() {
      const c = Math.min(this.sel.c1, this.sel.c2);
      this.sheet.data.forEach(row => {
        row.splice(c, 0, '');
        row.length = this.sheet.cols;
      });
      this.recalc();
      this.markDirty();
      this.toast('已在第 ' + E.colLetter(c) + ' 列前插入一列');
    },

    deleteCol() {
      const c1 = Math.min(this.sel.c1, this.sel.c2), c2 = Math.max(this.sel.c1, this.sel.c2);
      this.sheet.data.forEach(row => {
        row.splice(c1, c2 - c1 + 1);
        while (row.length < this.sheet.cols) row.push('');
      });
      this.recalc();
      this.markDirty();
      this.toast('已删除 ' + (c2 - c1 + 1) + ' 列');
    },

    switchSheet(id) {
      this.activeSheetId = id;
      this.active = { r: 0, c: 0 };
      this.sel = { r1: 0, c1: 0, r2: 0, c2: 0 };
      this.recalc();
      this.syncFormula();
    },

    openSheetModal(mode) {
      this.sheetModal = {
        on: true,
        mode: mode,
        value: mode === 'add' ? ('Sheet' + (this.wb.sheets.length + 1)) : (this.sheet ? this.sheet.name : '')
      };
      this.$nextTick(() => {
        const el = document.querySelector('.sheet-modal-input');
        if (el) { el.focus(); el.select(); }
      });
    },

    confirmSheetModal() {
      const m = this.sheetModal;
      const v = (m.value || '').trim();
      if (!v) { this.toast('请输入工作表名称'); return; }
      if (m.mode === 'add') {
        if (this.wb.sheets.some(s => s.name === v)) { this.toast('工作表名称已存在'); return; }
        const sh = E.blankSheet(v);
        this.wb.sheets.push(sh);
        this.activeSheetId = sh.id;
        this.recalc();
        this.markDirty();
        this.toast('已新增工作表「' + v + '」');
      } else if (m.mode === 'rename') {
        if (this.wb.sheets.some(s => s.name === v && s.id !== this.sheet.id)) { this.toast('工作表名称已存在'); return; }
        this.sheet.name = v;
        this.markDirty();
        this.toast('已重命名为「' + v + '」');
      }
      this.sheetModal.on = false;
    },

    askDeleteSheet() {
      if (this.wb.sheets.length <= 1) { this.toast('至少保留一个工作表'); return; }
      const name = this.sheet.name, idx = this.sheetIndex;
      this.confirmBox = {
        on: true,
        title: '删除工作表',
        text: '确定删除工作表「' + name + '」吗？',
        action: () => {
          this.wb.sheets.splice(idx, 1);
          this.activeSheetId = this.wb.sheets[Math.max(0, idx - 1)].id;
          this.recalc();
          this.markDirty();
          this.toast('已删除工作表「' + name + '」');
        }
      };
    },

    /* ---------------- 格式 ---------------- */
    setFmt(r, c, patch) {
      const key = E.rcToAddr(r, c);
      const cur = this.sheet.fmts[key] || {};
      this.sheet.fmts[key] = Object.assign({}, cur, patch);
    },

    selCells() {
      const out = [];
      const r1 = Math.min(this.sel.r1, this.sel.r2), r2 = Math.max(this.sel.r1, this.sel.r2);
      const c1 = Math.min(this.sel.c1, this.sel.c2), c2 = Math.max(this.sel.c1, this.sel.c2);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) out.push({ r: r, c: c });
      return out;
    },

    toggleFmt(key) {
      const cells = this.selCells();
      const allOn = cells.every(({ r, c }) => (this.sheet.fmts[E.rcToAddr(r, c)] || {})[key]);
      cells.forEach(({ r, c }) => this.setFmt(r, c, { [key]: allOn ? 0 : 1 }));
      this.markDirty();
    },

    isBold() {
      return this.selCells().every(({ r, c }) => (this.sheet.fmts[E.rcToAddr(r, c)] || {}).b);
    },

    setAlign(v) {
      this.selCells().forEach(({ r, c }) => this.setFmt(r, c, { align: v }));
      this.markDirty();
    },

    applyFontColor() {
      this.selCells().forEach(({ r, c }) => this.setFmt(r, c, { color: this.fontColor }));
      this.markDirty();
    },

    applyFill() {
      this.selCells().forEach(({ r, c }) => this.setFmt(r, c, { bg: this.fillColor }));
      this.markDirty();
    },

    applyNumFmt() {
      this.selCells().forEach(({ r, c }) => this.setFmt(r, c, { nf: this.numFmtSel }));
      this.markDirty();
    },

    clearFormat() {
      this.selCells().forEach(({ r, c }) => { delete this.sheet.fmts[E.rcToAddr(r, c)]; });
      this.markDirty();
      this.toast('已清除格式');
    },

    clearContent() {
      this.selCells().forEach(({ r, c }) => this.setRaw(r, c, ''));
      this.recalc();
      this.markDirty();
      this.toast('已清除内容');
    },

    /* ---------------- 数据操作 ---------------- */
    autoSum() {
      const r1 = Math.min(this.sel.r1, this.sel.r2), r2 = Math.max(this.sel.r1, this.sel.r2);
      const c1 = Math.min(this.sel.c1, this.sel.c2), c2 = Math.max(this.sel.c1, this.sel.c2);
      const outR = r2 + 1, outC = c2;
      if (outR >= this.sheet.rows) { this.toast('下方没有空白行可写入合计'); return; }
      const f = '=SUM(' + E.rcToAddr(r1, c1) + ':' + E.rcToAddr(r2, c2) + ')';
      this.setRaw(outR, outC, f);
      this.recalc();
      this.markDirty();
      this.selectCell(outR, outC);
      this.toast('已插入自动求和公式');
    },

    sortSel(dir) {
      const r1 = Math.min(this.sel.r1, this.sel.r2), r2 = Math.max(this.sel.r1, this.sel.r2);
      const c1 = Math.min(this.sel.c1, this.sel.c2);
      if (r2 - r1 < 1) { this.toast('请先选择一个包含多行的区域'); return; }
      const rows = [];
      for (let r = r1; r <= r2; r++) rows.push({ row: this.sheet.data[r], key: this.sheet.data[r][c1] });
      rows.sort((a, b) => {
        const x = a.key, y = b.key;
        const nx = parseFloat(String(x).replace(/,/g, '')), ny = parseFloat(String(y).replace(/,/g, ''));
        let cmp;
        if (!isNaN(nx) && !isNaN(ny)) cmp = nx - ny;
        else cmp = String(x).localeCompare(String(y), 'zh-CN');
        return dir === 'asc' ? cmp : -cmp;
      });
      rows.forEach((o, i) => { this.sheet.data[r1 + i] = o.row; });
      this.recalc();
      this.markDirty();
      this.toast('已按 ' + E.colLetter(c1) + ' 列' + (dir === 'asc' ? '升序' : '降序') + '排序');
    },

    removeDup() {
      const r1 = Math.min(this.sel.r1, this.sel.r2), r2 = Math.max(this.sel.r1, this.sel.r2);
      const c1 = Math.min(this.sel.c1, this.sel.c2), c2 = Math.max(this.sel.c1, this.sel.c2);
      if (r2 - r1 < 1) { this.toast('请先选择包含多行的区域'); return; }
      const seen = new Set();
      let removed = 0;
      const kept = [];
      for (let r = r1; r <= r2; r++) {
        const key = this.sheet.data[r].slice(c1, c2 + 1).map(v => String(v)).join('\u0001');
        if (seen.has(key)) removed++;
        else { seen.add(key); kept.push(this.sheet.data[r]); }
      }
      for (let i = 0; i < r2 - r1 + 1; i++) {
        this.sheet.data[r1 + i] = i < kept.length ? kept[i] : this.blankRow();
      }
      this.recalc();
      this.markDirty();
      this.toast('已删除 ' + removed + ' 行重复数据');
    },

    /* ---------------- 函数向导 ---------------- */
    openDrawer(tab) {
      this.drawer = true;
      this.drawerTab = tab || 'func';
      if (tab === 'func' && !Object.keys(this.funcParams).length) this.chooseFunc('VLOOKUP');
      if (tab === 'month') this.previewMonth();
    },

    chooseFunc(k) {
      this.funcPick = k;
      const def = this.flatFuncs.find(f => f.k === k);
      const p = {};
      if (def) def.fields.forEach(f => { p[f.k] = f.def || ''; });
      this.funcParams = p;
      this.preview = null;
      this.picking = '';
    },

    startPick(key) {
      this.picking = key;
      this.preview = null;
      this.toast('请在左侧表格中拖选区域');
      this.focusGrid();
    },

    /* 把区域文本解析成含工作表对象的范围 */
    resolveRef(text) {
      const r = E.parseRefText(text);
      if (!r) return null;
      const name = r.sheetName || this.sheet.name;
      const sh = this.wb.sheets.find(s => s.name === name);
      if (!sh) return null;
      return Object.assign({}, r, { sheetName: name, sheet: sh });
    },

    refOf(rng, row, col) {
      return rng.sheetName + '!' + E.rcToAddr(row, col == null ? rng.c1 : col);
    },

    valueAt(sheetName, r, c) {
      const sh = this.wb.sheets.find(s => s.name === sheetName);
      if (!sh) return '';
      const m = this.vmCache[sh.id];
      if (!m || !m[r]) return '';
      return m[r][c];
    },

    displayAt(sheetName, r, c) {
      return E.formatValue(this.valueAt(sheetName, r, c));
    },

    lit(s) {
      const v = String(s == null ? '' : s).trim();
      if (v === '') return '""';
      if (/^(TRUE|FALSE)$/i.test(v)) return v.toUpperCase();
      if (/^-?\d+(\.\d+)?$/.test(v)) return v;
      if (/^[A-Za-z0-9_\u4e00-\u9fa5]+\$?[A-Z]{1,3}\$?\d+(:\$?[A-Z]{1,3}\$?\d+)?$/.test(v)) return v;
      return '"' + v.replace(/"/g, '""') + '"';
    },

    runPreview() {
      this.preview = this.buildPreview();
      if (!this.preview.ok) this.toast(this.preview.error);
    },

    buildPreview() {
      const err = m => ({ ok: false, error: m });
      const cur = this.sheet;
      const k = this.funcPick;
      const p = this.funcParams;
      const out = E.addrToRC(this.outCell);
      if (!out) return err('请填写「结果写入」位置，例如 J2');
      if (out.r >= cur.rows || out.c >= cur.cols) return err('结果写入位置超出表格范围');
      const maxRows = cur.rows - out.r;
      const outAddr = E.rcToAddr(out.r, out.c);

      if (k === 'VLOOKUP') {
        const lookup = this.resolveRef(p.lookup);
        const table = this.resolveRef(p.table);
        if (!lookup) return err('查找值区域不正确，例如 销售明细!C2:C43');
        if (!table) return err('查找区域不正确，例如 客户档案!A2:D11');
        const cols = table.c2 - table.c1 + 1;
        const col = Math.max(1, Math.round(Number(p.col) || 1));
        if (col > cols) return err('查找区域只有 ' + cols + ' 列，无法返回第 ' + col + ' 列');
        const exact = p.mode !== 'approx';
        const total = lookup.r2 - lookup.r1 + 1;
        const cnt = Math.min(total, maxRows);
        if (cnt < total) return err('结果区域行数不足（需要 ' + total + ' 行，仅剩 ' + maxRows + ' 行），请调整写入位置');
        const formulas = [];
        const rows = [];
        let okCount = 0;
        for (let i = 0; i < cnt; i++) {
          const lRef = this.refOf(lookup, lookup.r1 + i, lookup.c1);
          const f = 'VLOOKUP(' + lRef + ',' + p.table.trim() + ',' + col + ',' + (exact ? 'FALSE' : 'TRUE') + ')';
          formulas.push(f);
          const v = E.evalFormula(f, this.wb, cur);
          const hit = !(typeof v === 'string' && v.charAt(0) === '#');
          if (hit) okCount++;
          rows.push({
            cell: E.rcToAddr(out.r + i, out.c),
            input: this.displayAt(lookup.sheetName, lookup.r1 + i, lookup.c1),
            value: E.formatValue(v)
          });
        }
        return {
          ok: true, formulas: formulas, count: cnt,
          rows: rows.slice(0, 8),
          summary: '将向「' + cur.name + '」' + outAddr + ' 向下写入 ' + cnt + ' 个 VLOOKUP 公式，预计匹配成功 ' + okCount + ' 个',
          formula: '=' + formulas[0]
        };
      }

      if (k === 'SUM' || k === 'AVERAGE' || k === 'MAX' || k === 'MIN' || k === 'COUNT') {
        const rng = this.resolveRef(p.range);
        if (!rng) return err('请选择或填写数据区域');
        const f = k + '(' + p.range.trim() + ')';
        const v = E.evalFormula(f, this.wb, cur);
        return {
          ok: true,
          formulas: [f], count: 1,
          rows: [{ cell: outAddr, input: p.range.trim(), value: E.formatValue(v) }],
          summary: '将在「' + cur.name + '」' + outAddr + ' 写入 ' + k + ' 公式，结果 ' + E.formatValue(v),
          formula: '=' + f
        };
      }

      if (k === 'SUMIF' || k === 'COUNTIF' || k === 'AVERAGEIF') {
        const cr = this.resolveRef(p.critRange);
        if (!cr) return err('请选择条件区域');
        let f;
        if (k === 'COUNTIF') {
          f = 'COUNTIF(' + p.critRange.trim() + ',' + this.lit(p.criteria) + ')';
        } else {
          const sumKey = k === 'SUMIF' ? 'sumRange' : 'avgRange';
          const sr = this.resolveRef(p[sumKey]);
          if (!sr) return err('请选择' + (k === 'SUMIF' ? '求和' : '求平均') + '区域');
          f = k + '(' + p.critRange.trim() + ',' + this.lit(p.criteria) + ',' + p[sumKey].trim() + ')';
        }
        const v = E.evalFormula(f, this.wb, cur);
        return {
          ok: true,
          formulas: [f], count: 1,
          rows: [{ cell: outAddr, input: p.criteria, value: E.formatValue(v) }],
          summary: '将在「' + cur.name + '」' + outAddr + ' 写入 ' + k + ' 公式，结果 ' + E.formatValue(v),
          formula: '=' + f
        };
      }

      if (k === 'SUMIFS' || k === 'COUNTIFS') {
        const keys = k === 'SUMIFS'
          ? ['sumRange', 'critRange1', 'critRange2']
          : ['critRange1', 'critRange2'];
        for (const key of keys) {
          if (!this.resolveRef(p[key])) return err('区域「' + key + '」不正确，请重新框选');
        }
        let f;
        if (k === 'SUMIFS') {
          f = 'SUMIFS(' + p.sumRange.trim() + ',' + p.critRange1.trim() + ',' + this.lit(p.criteria1) + ',' + p.critRange2.trim() + ',' + this.lit(p.criteria2) + ')';
        } else {
          f = 'COUNTIFS(' + p.critRange1.trim() + ',' + this.lit(p.criteria1) + ',' + p.critRange2.trim() + ',' + this.lit(p.criteria2) + ')';
        }
        const v = E.evalFormula(f, this.wb, cur);
        return {
          ok: true,
          formulas: [f], count: 1,
          rows: [{ cell: outAddr, input: p.criteria1 + ' + ' + p.criteria2, value: E.formatValue(v) }],
          summary: '将在「' + cur.name + '」' + outAddr + ' 写入 ' + k + ' 公式，结果 ' + E.formatValue(v),
          formula: '=' + f
        };
      }

      if (k === 'IF') {
        if (!p.cond || p.cond.trim() === '') return err('请填写条件表达式，例如 E2>=5');
        const f = 'IF(' + p.cond + ',' + this.lit(p.yes) + ',' + this.lit(p.no) + ')';
        const v = E.evalFormula(f, this.wb, cur);
        return {
          ok: true,
          formulas: [f], count: 1,
          rows: [{ cell: outAddr, input: p.cond, value: E.formatValue(v) }],
          summary: '将在「' + cur.name + '」' + outAddr + ' 写入 IF 公式，结果 ' + E.formatValue(v),
          formula: '=' + f
        };
      }

      if (k === 'ROUND' || k === 'MONTH' || k === 'TEXT') {
        const rng = this.resolveRef(p.range);
        if (!rng) return err('请选择或填写数据区域');
        const total = rng.r2 - rng.r1 + 1;
        const cnt = Math.min(total, maxRows);
        if (cnt < total) return err('结果区域行数不足（需要 ' + total + ' 行），请调整写入位置');
        const formulas = [], rows = [];
        for (let i = 0; i < cnt; i++) {
          const ref = this.refOf(rng, rng.r1 + i);
          let f;
          if (k === 'ROUND') f = 'ROUND(' + ref + ',' + (Math.round(Number(p.digits) || 0)) + ')';
          else if (k === 'MONTH') f = 'MONTH(' + ref + ')';
          else f = 'TEXT(' + ref + ',"' + (p.fmt || 'yyyy-mm') + '")';
          formulas.push(f);
          rows.push({
            cell: E.rcToAddr(out.r + i, out.c),
            input: this.displayAt(rng.sheetName, rng.r1 + i, rng.c1),
            value: E.formatValue(E.evalFormula(f, this.wb, cur))
          });
        }
        return {
          ok: true, formulas: formulas, count: cnt,
          rows: rows.slice(0, 8),
          summary: '将向「' + cur.name + '」' + outAddr + ' 向下写入 ' + cnt + ' 个 ' + k + ' 公式',
          formula: '=' + formulas[0]
        };
      }

      if (k === 'CONCAT') {
        const rng = this.resolveRef(p.range);
        if (!rng) return err('请选择或填写数据区域');
        const sep = String(p.sep == null ? '' : p.sep);
        const f = 'TEXTJOIN("' + sep.replace(/"/g, '""') + '",TRUE,' + p.range.trim() + ')';
        const v = E.evalFormula(f, this.wb, cur);
        return {
          ok: true,
          formulas: [f], count: 1,
          rows: [{ cell: outAddr, input: p.range.trim(), value: E.formatValue(v) }],
          summary: '将在「' + cur.name + '」' + outAddr + ' 写入合并文本公式',
          formula: '=' + f
        };
      }

      return err('该函数暂不支持预览');
    },

    applyWizard() {
      const pv = this.preview;
      if (!pv || !pv.ok) return;
      const out = E.addrToRC(this.outCell);
      const sh = this.sheet;
      pv.formulas.forEach((f, i) => {
        const r = out.r + i;
        if (r < sh.rows) this.setRaw(r, out.c, '=' + f);
      });
      this.recalc();
      this.markDirty();
      this.selectCell(out.r, out.c);
      this.toast('已写入 ' + pv.formulas.length + ' 个公式，结果已计算');
      this.drawer = false;
      this.preview = null;
    },

    quickVlookup() {
      const sales = this.wb.sheets.find(s => s.name === '销售明细') || this.sheet;
      this.activeSheetId = sales.id;
      this.recalc();
      this.drawer = true;
      this.drawerTab = 'func';
      this.chooseFunc('VLOOKUP');
      this.funcParams.lookup = sales.name + '!C2:C43';
      const cust = this.wb.sheets.find(s => s.name === '客户档案');
      if (cust) this.funcParams.table = cust.name + '!A2:D11';
      this.funcParams.col = '2';
      this.funcParams.mode = 'exact';
      this.outCell = 'J2';
      this.runPreview();
      this.toast('已按「客户名称 → 客户等级」自动填好参数，可直接写入');
    },

    quickMonth() {
      const sales = this.wb.sheets.find(s => s.name === '销售明细') || this.sheet;
      this.activeSheetId = sales.id;
      this.recalc();
      this.drawer = true;
      this.drawerTab = 'month';
      const last = this.findLastRow(sales, 0);
      this.month.dateRange = sales.name + '!A2:A' + last;
      this.month.valueRange = sales.name + '!G2:G' + last;
      this.month.agg = 'sum';
      this.previewMonth();
    },

    findLastRow(sh, col) {
      for (let r = sh.rows - 1; r >= 0; r--) {
        const v = sh.data[r] && sh.data[r][col];
        if (v !== '' && v != null) return r + 1;
      }
      return 1;
    },

    /* ---------------- 按月统计 ---------------- */
    previewMonth() {
      const d = this.resolveRef(this.month.dateRange);
      if (!d) { this.monthPreview = { ok: false, error: '请选择日期列，例如 销售明细!A2:A43' }; return; }
      const v = this.month.valueRange ? this.resolveRef(this.month.valueRange) : null;
      if (this.month.valueRange && !v) {
        this.monthPreview = { ok: false, error: '数值列不正确，请重新框选' };
        return;
      }
      let n = d.r2 - d.r1 + 1;
      if (v) n = Math.min(n, v.r2 - v.r1 + 1);
      const agg = this.month.agg;
      const buckets = [];
      for (let i = 0; i < 12; i++) buckets.push({ m: i + 1, sum: 0, count: 0, max: 0 });
      let year = null, totalSum = 0, totalCount = 0, skipped = 0;
      for (let i = 0; i < n; i++) {
        const dv = this.valueAt(d.sheetName, d.r1 + i, d.c1);
        const dt = E.parseDateValue(dv);
        if (!dt) { skipped++; continue; }
        if (!year) year = dt.getFullYear();
        if (dt.getFullYear() !== year) continue;
        const b = buckets[dt.getMonth()];
        b.count++;
        totalCount++;
        const val = v ? E.toNumber(this.valueAt(v.sheetName, v.r1 + i, v.c1)) : 0;
        b.sum += val;
        totalSum += val;
        if (val > b.max) b.max = val;
      }
      const rows = buckets.map(b => {
        let total = b.sum;
        if (agg === 'count') total = b.count;
        else if (agg === 'avg') total = b.count ? b.sum / b.count : 0;
        else if (agg === 'max') total = b.max;
        return { m: b.m, total: Math.round(total * 100) / 100, count: b.count, sum: b.sum };
      });
      let grand = totalSum;
      if (agg === 'count') grand = totalCount;
      else if (agg === 'avg') grand = totalCount ? totalSum / totalCount : 0;
      else if (agg === 'max') grand = Math.max.apply(null, rows.map(r => r.total));
      const max = Math.max.apply(null, rows.map(r => Math.abs(r.total))) || 1;
      this.monthPreview = {
        ok: true, year: year || new Date().getFullYear(),
        rows: rows, grand: Math.round(grand * 100) / 100,
        max: max, agg: agg, totalCount: totalCount,
        skipped: skipped, count: n
      };
    },

    monthBar(v) {
      const pv = this.monthPreview;
      if (!pv || !pv.ok) return '0%';
      return Math.max(2, Math.round(Math.abs(Number(v) || 0) / pv.max * 100)) + '%';
    },

    applyMonth() {
      const pv = this.monthPreview;
      if (!pv || !pv.ok) return;
      let target = this.wb.sheets.find(s => s.name === '月度统计');
      if (!target) {
        target = E.blankSheet('月度统计');
        this.wb.sheets.push(target);
      } else {
        for (let r = 0; r < target.rows; r++) {
          for (let c = 0; c < target.cols; c++) target.data[r][c] = '';
        }
        target.fmts = {};
      }
      const write = (r, c, val, fmt) => {
        target.data[r][c] = val;
        if (fmt) target.fmts[E.rcToAddr(r, c)] = fmt;
      };
      write(0, 0, pv.year + ' 年按月统计', { b: 1, color: '#0b7a43' });
      const heads = ['月份', '销售金额', '订单笔数', '占比'];
      heads.forEach((h, i) => write(1, i, h, { b: 1, bg: '#e7f6ee', color: '#0b7a43', align: 'center' }));
      pv.rows.forEach((row, i) => {
        const rr = 2 + i;
        write(rr, 0, row.m + '月', { align: 'center' });
        write(rr, 1, row.total, { nf: 'thousand', align: 'right' });
        write(rr, 2, row.count, { align: 'right' });
        write(rr, 3, '=IFERROR(B' + (rr + 1) + '/B15,0)', { nf: 'percent', align: 'right' });
      });
      write(14, 0, '合计', { b: 1, align: 'center' });
      write(14, 1, '=SUM(B3:B14)', { b: 1, nf: 'thousand', align: 'right' });
      write(14, 2, '=SUM(C3:C14)', { b: 1, align: 'right' });
      write(14, 3, '=IFERROR(B15/B15,0)', { b: 1, nf: 'percent', align: 'right' });

      this.activeSheetId = target.id;
      this.recalc();
      this.markDirty();
      this.selectCell(0, 0);
      this.drawer = false;
      this.toast('已生成「月度统计」工作表');
    }
  }
}).mount('#app');
