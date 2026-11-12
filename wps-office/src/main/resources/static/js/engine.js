/* ============================================================
 * WPS 表格仿真 · 引擎层
 * 单元格地址 / 公式词法解析 / 函数计算 / 示例数据 / 函数库定义
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 地址工具 ---------- */
  function colLetter(i) {
    let s = '';
    i = i + 1;
    while (i > 0) {
      const m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  function colIndex(s) {
    let n = 0;
    for (const ch of String(s).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  const CELL_RE = /^([A-Z]{1,3})(\d+)$/;
  const RANGE_RE = /^([A-Z]{1,3})(\d+)(?::([A-Z]{1,3})(\d+))?$/;

  function addrToRC(text) {
    const m = CELL_RE.exec(String(text || '').trim().replace(/\$/g, '').toUpperCase());
    if (!m) return null;
    return { r: parseInt(m[2], 10) - 1, c: colIndex(m[1]) };
  }

  function rcToAddr(r, c) {
    return colLetter(c) + (r + 1);
  }

  /** 解析 "客户档案!A2:D11" / "A2:D11" */
  function parseRefText(text) {
    let s = String(text == null ? '' : text).trim().replace(/\$/g, '');
    if (!s) return null;
    let sheetName = null;
    const bang = s.lastIndexOf('!');
    if (bang >= 0) {
      sheetName = s.slice(0, bang).trim().replace(/^'(.*)'$/, '$1');
      s = s.slice(bang + 1).trim();
    }
    const m = RANGE_RE.exec(s.toUpperCase());
    if (!m) return null;
    const r1 = parseInt(m[2], 10) - 1;
    const c1 = colIndex(m[1]);
    const r2 = m[4] ? parseInt(m[4], 10) - 1 : r1;
    const c2 = m[3] ? colIndex(m[3]) : c1;
    return {
      sheetName,
      r1: Math.min(r1, r2), c1: Math.min(c1, c2),
      r2: Math.max(r1, r2), c2: Math.max(c1, c2),
      text: text
    };
  }

  /* ---------- 值工具 ---------- */
  function unwrap(v) {
    if (v && v.__range) return v.rows.length ? v.rows[0][0] : '';
    return v;
  }

  function toNumber(v) {
    v = unwrap(v);
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v == null) return 0;
    const n = parseFloat(String(v).replace(/[,，¥%\s]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  function toText(v) {
    v = unwrap(v);
    if (v == null) return '';
    if (typeof v === 'number') return String(Math.round(v * 1e10) / 1e10);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  }

  function truthy(v) {
    v = unwrap(v);
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (v == null) return false;
    const s = String(v).trim().toUpperCase();
    if (!s || s === 'FALSE' || s === '0') return false;
    if (s.startsWith('#')) return false;
    return true;
  }

  function flatten(args) {
    const out = [];
    for (const a of args) {
      if (a && a.__range) {
        for (const row of a.rows) for (const v of row) out.push(v);
      } else out.push(a);
    }
    return out;
  }

  function looseEq(a, b) {
    if (typeof a === 'number' || typeof b === 'number') return toNumber(a) === toNumber(b);
    return String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();
  }

  function wildcardRe(s) {
    if (!/[*?]/.test(s)) return null;
    const body = s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp('^' + body + '$', 'i');
  }

  /** 条件匹配：>=1000 / 金牌 / <>已取消 / 华* */
  function matchCrit(v, crit) {
    crit = unwrap(crit);
    if (typeof crit === 'number') return toNumber(v) === crit;
    let s = String(crit == null ? '' : crit).trim();
    const m = /^(>=|<=|<>|>|<|=)?\s*(.*)$/.exec(s);
    const op = m[1] || '=';
    const rhs = m[2].trim();
    const rhsNum = /^-?\d+(\.\d+)?$/.test(rhs);
    const vRaw = toText(v).trim();
    const vNum = parseFloat(vRaw.replace(/,/g, ''));
    if (rhsNum && !isNaN(vNum)) {
      const a = vNum, b = parseFloat(rhs);
      if (op === '>') return a > b;
      if (op === '<') return a < b;
      if (op === '>=') return a >= b;
      if (op === '<=') return a <= b;
      if (op === '<>') return a !== b;
      return a === b;
    }
    const a = vRaw.toLowerCase(), b = rhs.toLowerCase();
    if (op === '>' || op === '<' || op === '>=' || op === '<=') {
      if (op === '>') return a > b;
      if (op === '<') return a < b;
      if (op === '>=') return a >= b;
      return a <= b;
    }
    const re = wildcardRe(b);
    const hit = re ? re.test(a) : a === b;
    return op === '<>' ? !hit : hit;
  }

  /* ---------- 日期与文本格式 ---------- */
  function parseDateValue(v) {
    v = unwrap(v);
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    const s = String(v).trim();
    let m = s.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = s.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?$/);
    if (m) return new Date(+m[1], +m[2] - 1, 1);
    m = s.match(/^(\d{1,2})\s*月\s*(\d{1,2})\s*日?$/);
    if (m) return new Date(new Date().getFullYear(), +m[1] - 1, +m[2]);
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtDate(d, f) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    if (f === 'yyyy-mm-dd') return y + '-' + mo + '-' + da;
    if (f === 'yyyy/m/d') return y + '/' + (d.getMonth() + 1) + '/' + d.getDate();
    if (f === 'yyyy-mm') return y + '-' + mo;
    if (f === 'mm月') return (d.getMonth() + 1) + '月';
    if (f === 'yyyy年mm月') return y + '年' + mo + '月';
    if (f === 'm/d') return (d.getMonth() + 1) + '/' + d.getDate();
    return y + '-' + mo + '-' + da;
  }

  function fmtText(v, f) {
    if (typeof v === 'number' && f) {
      if (f === '0') return String(Math.round(v));
      let m = /^0\.(0+)$/.exec(f);
      if (m) return v.toFixed(m[1].length);
      m = /^#,##0(?:\.(0+))?$/.exec(f);
      if (m) {
        const d = m[1] ? m[1].length : 0;
        return v.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
      }
      if (f === '0%') return Math.round(v * 100) + '%';
      m = /^0\.(0+)%$/.exec(f);
      if (m) return (v * 100).toFixed(m[1].length) + '%';
    }
    const d = parseDateValue(v);
    if (d && /[yYmMdD]/.test(String(f))) return fmtDate(d, f);
    return toText(v);
  }

  /** 单元格显示：按数字格式 */
  function formatValue(v, nf) {
    v = unwrap(v);
    if (v == null || v === '') return '';
    if (typeof v === 'string' && v.startsWith('#')) return v;
    if (nf) {
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,，¥%\s]/g, ''));
      if (!isNaN(n) && isFinite(n)) {
        if (nf === 'currency') return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        if (nf === 'percent') return (n * 100).toFixed(2) + '%';
        if (nf === 'num2') return n.toFixed(2);
        if (nf === 'int') return Math.round(n).toLocaleString('zh-CN');
        if (nf === 'thousand') return n.toLocaleString('zh-CN');
      }
    }
    if (typeof v === 'number') {
      if (!isFinite(v)) return '#NUM!';
      return Math.round(v * 1e10) / 1e10;
    }
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  }

  /* ---------- 词法分析 ---------- */
  function lex(src) {
    const out = [];
    let i = 0;
    const isIdStart = ch => /[A-Za-z_\u4e00-\u9fa5]/.test(ch);
    const isId = ch => /[A-Za-z0-9_.\u4e00-\u9fa5]/.test(ch);
    while (i < src.length) {
      const ch = src[i];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { i++; continue; }
      if (ch === '"') {
        i++;
        let s = '';
        while (i < src.length) {
          if (src[i] === '"') {
            if (src[i + 1] === '"') { s += '"'; i += 2; }
            else { i++; break; }
          } else s += src[i++];
        }
        out.push({ t: 'str', v: s });
        continue;
      }
      if (ch === "'") {
        i++;
        let s = '';
        while (i < src.length && src[i] !== "'") s += src[i++];
        i++;
        if (src[i] === '!') i++;
        out.push({ t: 'sheet', v: s });
        continue;
      }
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        let s = '';
        while (i < src.length && /[0-9.]/.test(src[i])) s += src[i++];
        out.push({ t: 'num', v: parseFloat(s) });
        continue;
      }
      if (isIdStart(ch)) {
        let s = '';
        while (i < src.length && isId(src[i])) s += src[i++];
        if (src[i] === '!') { i++; out.push({ t: 'sheet', v: s }); continue; }
        if (src[i] === '(') { out.push({ t: 'func', v: s.toUpperCase() }); continue; }
        if (CELL_RE.test(s.toUpperCase())) out.push({ t: 'ref', v: s.toUpperCase() });
        else out.push({ t: 'name', v: s.toUpperCase() });
        continue;
      }
      if ('+-*/^&%'.indexOf(ch) >= 0) { out.push({ t: 'op', v: ch }); i++; continue; }
      if (ch === '=') { out.push({ t: 'op', v: '=' }); i++; continue; }
      if (ch === '<') {
        if (src[i + 1] === '=') { out.push({ t: 'op', v: '<=' }); i += 2; }
        else if (src[i + 1] === '>') { out.push({ t: 'op', v: '<>' }); i += 2; }
        else { out.push({ t: 'op', v: '<' }); i++; }
        continue;
      }
      if (ch === '>') {
        if (src[i + 1] === '=') { out.push({ t: 'op', v: '>=' }); i += 2; }
        else { out.push({ t: 'op', v: '>' }); i++; }
        continue;
      }
      if ('(),:;'.indexOf(ch) >= 0) { out.push({ t: ch, v: ch }); i++; continue; }
      throw new Error('无法识别的字符：' + ch);
    }
    return out;
  }

  /* ---------- 取值 ---------- */
  function cellValue(ctx, sheet, r, c) {
    const key = sheet.id + '!' + r + ',' + c;
    if (ctx.memo.has(key)) return ctx.memo.get(key);
    if (ctx.stack.has(key)) return '#CIRC!';
    const raw = (sheet.data[r] || [])[c];
    let val = raw == null ? '' : raw;
    if (typeof val === 'string' && val.trim().charAt(0) === '=') {
      ctx.stack.add(key);
      try {
        val = evaluate(val.trim().slice(1), { ctx: ctx, sheet: sheet });
      } catch (e) {
        val = '#ERROR!';
      }
      ctx.stack.delete(key);
      val = unwrap(val);
    }
    ctx.memo.set(key, val);
    return val;
  }

  function resolveRange(env, sheetName, a, b) {
    let sh = env.sheet;
    if (sheetName) {
      sh = env.ctx.wb.sheets.find(s => s.name === sheetName);
    }
    const A = addrToRC(a);
    const B = addrToRC(b || a);
    if (!sh || !A || !B) return { __range: true, rows: [['#REF!']] };
    const r1 = Math.min(A.r, B.r), r2 = Math.min(Math.max(A.r, B.r), sh.rows - 1);
    const c1 = Math.min(A.c, B.c), c2 = Math.min(Math.max(A.c, B.c), sh.cols - 1);
    const rows = [];
    for (let r = r1; r <= r2; r++) {
      const row = [];
      for (let c = c1; c <= c2; c++) row.push(cellValue(env.ctx, sh, r, c));
      rows.push(row);
    }
    return { __range: true, rows: rows, sheetName: sh.name, r1: r1, c1: c1, r2: r2, c2: c2 };
  }

  function applyOp(op, a, b) {
    if (op === '&') return toText(a) + toText(b);
    if (op === '=') return looseEq(a, b);
    if (op === '<>') return !looseEq(a, b);
    if (op === '>' || op === '<' || op === '>=' || op === '<=') {
      const bothNum = (typeof unwrap(a) === 'number' || /^-?\d+(\.\d+)?$/.test(toText(a).trim()))
        && (typeof unwrap(b) === 'number' || /^-?\d+(\.\d+)?$/.test(toText(b).trim()));
      let x, y;
      if (bothNum) { x = toNumber(a); y = toNumber(b); }
      else { x = toText(a).toLowerCase(); y = toText(b).toLowerCase(); }
      if (op === '>') return x > y;
      if (op === '<') return x < y;
      if (op === '>=') return x >= y;
      return x <= y;
    }
    const x = toNumber(a), y = toNumber(b);
    if (op === '+') return x + y;
    if (op === '-') return x - y;
    if (op === '*') return x * y;
    if (op === '/') return y === 0 ? '#DIV/0!' : x / y;
    if (op === '^') return Math.pow(x, y);
    return '#ERROR!';
  }

  /* ---------- 函数实现 ---------- */
  const FUNCS = {
    SUM(args) { return flatten(args).reduce((s, v) => s + toNumber(v), 0); },
    AVERAGE(args) {
      const nums = flatten(args).filter(v => v !== '' && v != null && !(typeof v === 'string' && v.trim() === ''));
      if (!nums.length) return '#DIV/0!';
      return nums.reduce((s, v) => s + toNumber(v), 0) / nums.length;
    },
    MAX(args) {
      const nums = flatten(args).map(toNumber);
      return nums.length ? Math.max.apply(null, nums) : 0;
    },
    MIN(args) {
      const nums = flatten(args).map(toNumber);
      return nums.length ? Math.min.apply(null, nums) : 0;
    },
    COUNT(args) {
      return flatten(args).filter(v => v !== '' && v != null && !isNaN(Number(String(v).replace(/[,¥%\s]/g, ''))) && typeof v !== 'boolean').length;
    },
    COUNTA(args) { return flatten(args).filter(v => v !== '' && v != null).length; },
    ROUND(args) {
      const d = Math.round(toNumber(args[1] || 0));
      const p = Math.pow(10, d);
      return Math.round(toNumber(args[0]) * p) / p;
    },
    ROUNDUP(args) {
      const d = Math.round(toNumber(args[1] || 0));
      const p = Math.pow(10, d);
      return Math.ceil(toNumber(args[0]) * p) / p;
    },
    ROUNDDOWN(args) {
      const d = Math.round(toNumber(args[1] || 0));
      const p = Math.pow(10, d);
      return Math.floor(toNumber(args[0]) * p) / p;
    },
    ABS(args) { return Math.abs(toNumber(args[0])); },
    INT(args) { return Math.floor(toNumber(args[0])); },
    MOD(args) { const b = toNumber(args[1]); return b === 0 ? '#DIV/0!' : toNumber(args[0]) % b; },
    IF(args) { return truthy(args[0]) ? unwrap(args[1]) : unwrap(args[2]); },
    IFERROR(args) {
      const v = unwrap(args[0]);
      return (typeof v === 'string' && v.charAt(0) === '#') ? unwrap(args[1]) : v;
    },
    AND(args) {
      const list = flatten(args);
      return list.length ? list.every(truthy) : false;
    },
    OR(args) {
      const list = flatten(args);
      return list.length ? list.some(truthy) : false;
    },
    NOT(args) { return !truthy(args[0]); },
    VLOOKUP(args) {
      const lv = unwrap(args[0]);
      const table = args[1];
      if (!table || !table.__range) return '#N/A';
      const col = Math.max(1, Math.round(toNumber(args[2])));
      const exact = args.length < 4 ? true : truthy(args[3]);
      const rows = table.rows;
      if (exact) {
        for (const row of rows) {
          if (looseEq(row[0], lv)) return row[col - 1] === undefined ? '#REF!' : unwrap(row[col - 1]);
        }
        return '#N/A';
      }
      let found = '#N/A';
      for (const row of rows) {
        if (toText(row[0]).toLowerCase() <= toText(lv).toLowerCase()) {
          found = row[col - 1] === undefined ? '#REF!' : unwrap(row[col - 1]);
        }
      }
      return found;
    },
    SUMIF(args) {
      const vals = flatten([args[0]]);
      const crit = args[1];
      const sums = args[2] && args[2].__range ? flatten([args[2]]) : null;
      let total = 0;
      vals.forEach((v, i) => {
        if (matchCrit(v, crit)) total += sums ? toNumber(sums[i]) : toNumber(v);
      });
      return total;
    },
    COUNTIF(args) {
      const vals = flatten([args[0]]);
      const crit = args[1];
      let n = 0;
      vals.forEach(v => { if (matchCrit(v, crit)) n++; });
      return n;
    },
    SUMIFS(args) {
      const sums = flatten([args[0]]);
      let total = 0;
      sums.forEach((v, i) => {
        let ok = true;
        for (let k = 1; k + 1 < args.length; k += 2) {
          const rng = flatten([args[k]]);
          if (!matchCrit(rng[i], args[k + 1])) { ok = false; break; }
        }
        if (ok) total += toNumber(v);
      });
      return total;
    },
    COUNTIFS(args) {
      const first = flatten([args[0]]);
      let n = 0;
      first.forEach((v, i) => {
        let ok = true;
        for (let k = 0; k + 1 < args.length; k += 2) {
          const rng = flatten([args[k]]);
          if (!matchCrit(rng[i], args[k + 1])) { ok = false; break; }
        }
        if (ok) n++;
      });
      return n;
    },
    AVERAGEIF(args) {
      const vals = flatten([args[0]]);
      const crit = args[1];
      const sums = args[2] && args[2].__range ? flatten([args[2]]) : null;
      let total = 0, n = 0;
      vals.forEach((v, i) => {
        if (matchCrit(v, crit)) {
          total += sums ? toNumber(sums[i]) : toNumber(v);
          n++;
        }
      });
      return n ? total / n : '#DIV/0!';
    },
    LEFT(args) { return toText(args[0]).slice(0, Math.round(toNumber(args[1] || 1))); },
    RIGHT(args) {
      const s = toText(args[0]);
      const n = Math.round(toNumber(args[1] || 1));
      return n <= 0 ? '' : s.slice(-n);
    },
    MID(args) {
      const s = toText(args[0]);
      const start = Math.round(toNumber(args[1] || 1));
      const n = Math.round(toNumber(args[2] || 0));
      return s.substr(Math.max(0, start - 1), n);
    },
    LEN(args) { return toText(args[0]).length; },
    TRIM(args) { return toText(args[0]).replace(/\s+/g, ' ').trim(); },
    UPPER(args) { return toText(args[0]).toUpperCase(); },
    LOWER(args) { return toText(args[0]).toLowerCase(); },
    CONCAT(args) { return flatten(args).map(toText).join(''); },
    CONCATENATE(args) { return flatten(args).map(toText).join(''); },
    TEXTJOIN(args) {
      const sep = toText(args[0]);
      const skip = truthy(args[1]);
      const vals = flatten(args.slice(2)).map(toText).filter(v => !skip || v !== '');
      return vals.join(sep);
    },
    MONTH(args) {
      const d = parseDateValue(args[0]);
      return d ? d.getMonth() + 1 : '#VALUE!';
    },
    YEAR(args) {
      const d = parseDateValue(args[0]);
      return d ? d.getFullYear() : '#VALUE!';
    },
    DAY(args) {
      const d = parseDateValue(args[0]);
      return d ? d.getDate() : '#VALUE!';
    },
    TODAY() {
      const d = new Date();
      const p = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    },
    TEXT(args) { return fmtText(unwrap(args[0]), toText(args[1])); },
    VALUE(args) { return toNumber(args[0]); }
  };

  /* ---------- 语法分析 + 求值 ---------- */
  function evaluate(src, env) {
    const tokens = lex(src);
    let i = 0;
    const peek = () => tokens[i];
    const eat = t => { if (tokens[i] && tokens[i].t === t) { i++; return true; } return false; };

    function expr() { return compare(); }

    function compare() {
      let left = concatExpr();
      while (peek() && peek().t === 'op' && ['=', '<>', '>', '<', '>=', '<='].indexOf(peek().v) >= 0) {
        const op = tokens[i++].v;
        left = applyOp(op, left, concatExpr());
      }
      return left;
    }

    function concatExpr() {
      let left = addExpr();
      while (peek() && peek().t === 'op' && peek().v === '&') {
        i++;
        left = applyOp('&', left, addExpr());
      }
      return left;
    }

    function addExpr() {
      let left = mulExpr();
      while (peek() && peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
        const op = tokens[i++].v;
        left = applyOp(op, left, mulExpr());
      }
      return left;
    }

    function mulExpr() {
      let left = unary();
      while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/' || peek().v === '^')) {
        const op = tokens[i++].v;
        left = applyOp(op, left, unary());
      }
      return left;
    }

    function unary() {
      let sign = 1;
      while (peek() && peek().t === 'op' && (peek().v === '-' || peek().v === '+')) {
        if (tokens[i++].v === '-') sign = -sign;
      }
      let v = primary();
      if (sign === -1) v = -toNumber(v);
      while (peek() && peek().t === 'op' && peek().v === '%') {
        i++;
        v = toNumber(v) / 100;
      }
      return v;
    }

    function primary() {
      const t = peek();
      if (!t) return '';
      if (t.t === 'num') { i++; return t.v; }
      if (t.t === 'str') { i++; return t.v; }
      if (t.t === '(') {
        i++;
        const v = expr();
        eat(')');
        return v;
      }
      if (t.t === 'sheet' || t.t === 'ref') {
        let sheetName = null;
        if (t.t === 'sheet') { sheetName = t.v; i++; }
        const rt = peek();
        if (!rt || rt.t !== 'ref') throw new Error('缺少单元格地址');
        i++;
        let a = rt.v, b = rt.v;
        if (peek() && peek().t === ':') {
          i++;
          const rt2 = peek();
          if (!rt2 || rt2.t !== 'ref') throw new Error('区域格式不正确');
          i++;
          b = rt2.v;
        }
        return resolveRange(env, sheetName, a, b);
      }
      if (t.t === 'name') {
        i++;
        if (t.v === 'TRUE') return true;
        if (t.v === 'FALSE') return false;
        return t.v;
      }
      if (t.t === 'func') {
        const name = t.v;
        i++;
        eat('(');
        const args = [];
        if (!(peek() && peek().t === ')')) {
          do { args.push(expr()); } while (eat(',') || eat(';'));
        }
        eat(')');
        const fn = FUNCS[name];
        if (!fn) return '#NAME?';
        try {
          return fn(args, env);
        } catch (e) {
          return '#ERROR!';
        }
      }
      throw new Error('公式语法错误');
    }

    return expr();
  }

  function evalFormula(expr, wb, sheet) {
    const ctx = { wb: wb, memo: new Map(), stack: new Set() };
    try {
      const val = evaluate(String(expr == null ? '' : expr).replace(/^\s*=/, '').replace(/\$/g, ''), { ctx: ctx, sheet: sheet });
      return unwrap(val);
    } catch (e) {
      return '#ERROR!';
    }
  }

  /** 整本工作簿重算，返回 { sheetId: 二维值矩阵 } */
  function recalc(wb) {
    const ctx = { wb: wb, memo: new Map(), stack: new Set() };
    const out = {};
    for (const sh of wb.sheets) {
      const m = [];
      for (let r = 0; r < sh.rows; r++) {
        const row = [];
        for (let c = 0; c < sh.cols; c++) row.push(cellValue(ctx, sh, r, c));
        m.push(row);
      }
      out[sh.id] = m;
    }
    return out;
  }

  /* ---------- 函数库（函数一键使用） ---------- */
  const FIELD_TYPES = ['range', 'cell', 'text', 'number', 'select'];

  const FUNC_LIBRARY = [
    {
      group: '查找匹配',
      items: [
        {
          k: 'VLOOKUP', label: 'VLOOKUP', icon: '🔎', short: '跨表匹配数据', group: '查找匹配', perRow: true,
          desc: '在查找区域的首列匹配目标值，返回该行指定列的内容，常用于两张表的数据匹配。',
          fields: [
            { k: 'lookup', label: '查找值区域', type: 'range', ph: '如 销售明细!C2:C43' },
            { k: 'table', label: '查找区域（首列须为匹配列）', type: 'range', ph: '如 客户档案!A2:D11' },
            { k: 'col', label: '返回列（自动识别）', type: 'cell', ph: '留空则按「结果写入」列的表头自动匹配' },
            {
              k: 'mode', label: '匹配方式', type: 'select', def: 'exact',
              opts: [{ v: 'exact', t: '精确匹配（FALSE）' }, { v: 'approx', t: '近似匹配（TRUE）' }]
            }
          ]
        }
      ]
    },
    {
      group: '条件统计',
      items: [
        {
          k: 'SUMIF', label: 'SUMIF', icon: 'Σ', short: '按条件求和', group: '条件统计',
          desc: '对满足单个条件的行求和，例如统计「金牌」客户的全部金额。',
          fields: [
            { k: 'critRange', label: '条件区域', type: 'range', ph: '如 销售明细!J2:J43' },
            { k: 'criteria', label: '条件', type: 'text', ph: '如 金牌 或 >=1000' },
            { k: 'sumRange', label: '求和区域', type: 'range', ph: '如 销售明细!G2:G43' }
          ]
        },
        {
          k: 'SUMIFS', label: 'SUMIFS', icon: 'Σ', short: '多条件求和', group: '条件统计',
          desc: '同时满足两个条件时求和，例如「金牌 + 华东」的销售金额。',
          fields: [
            { k: 'sumRange', label: '求和区域', type: 'range', ph: '如 销售明细!G2:G43' },
            { k: 'critRange1', label: '条件区域 1', type: 'range', ph: '如 销售明细!J2:J43' },
            { k: 'criteria1', label: '条件 1', type: 'text', ph: '如 金牌' },
            { k: 'critRange2', label: '条件区域 2', type: 'range', ph: '如 销售明细!H2:H43' },
            { k: 'criteria2', label: '条件 2', type: 'text', ph: '如 华东' }
          ]
        },
        {
          k: 'COUNTIF', label: 'COUNTIF', icon: '№', short: '按条件计数', group: '条件统计',
          desc: '统计满足条件的单元格数量，例如订单笔数、客户数量。',
          fields: [
            { k: 'critRange', label: '条件区域', type: 'range', ph: '如 销售明细!H2:H43' },
            { k: 'criteria', label: '条件', type: 'text', ph: '如 华东' }
          ]
        },
        {
          k: 'COUNTIFS', label: 'COUNTIFS', icon: '№', short: '多条件计数', group: '条件统计',
          desc: '统计同时满足两个条件的行数。',
          fields: [
            { k: 'critRange1', label: '条件区域 1', type: 'range', ph: '如 销售明细!J2:J43' },
            { k: 'criteria1', label: '条件 1', type: 'text', ph: '如 金牌' },
            { k: 'critRange2', label: '条件区域 2', type: 'range', ph: '如 销售明细!H2:H43' },
            { k: 'criteria2', label: '条件 2', type: 'text', ph: '如 华东' }
          ]
        },
        {
          k: 'AVERAGEIF', label: 'AVERAGEIF', icon: '⌀', short: '条件平均值', group: '条件统计',
          desc: '对满足条件的数值求平均。',
          fields: [
            { k: 'critRange', label: '条件区域', type: 'range', ph: '如 销售明细!H2:H43' },
            { k: 'criteria', label: '条件', type: 'text', ph: '如 华东' },
            { k: 'avgRange', label: '求平均区域', type: 'range', ph: '如 销售明细!G2:G43' }
          ]
        }
      ]
    },
    {
      group: '基础统计',
      items: [
        { k: 'SUM', label: 'SUM', icon: '∑', short: '区域求和', group: '基础统计', desc: '对选定区域的所有数值求和，忽略文本与空白。', fields: [{ k: 'range', label: '数据区域', type: 'range', ph: '如 销售明细!G2:G43' }] },
        { k: 'AVERAGE', label: 'AVERAGE', icon: '⌀', short: '区域平均', group: '基础统计', desc: '计算选定区域的平均值，只统计数值单元格。', fields: [{ k: 'range', label: '数据区域', type: 'range', ph: '如 销售明细!F2:F43' }] },
        { k: 'MAX', label: 'MAX', icon: '↑', short: '最大值', group: '基础统计', desc: '返回区域中的最大值，可用于找最高金额、最高单价。', fields: [{ k: 'range', label: '数据区域', type: 'range', ph: '如 销售明细!G2:G43' }] },
        { k: 'MIN', label: 'MIN', icon: '↓', short: '最小值', group: '基础统计', desc: '返回区域中的最小值，可用于找最低金额、最低单价。', fields: [{ k: 'range', label: '数据区域', type: 'range', ph: '如 销售明细!G2:G43' }] },
        { k: 'COUNT', label: 'COUNT', icon: '123', short: '数值计数', group: '基础统计', desc: '统计区域中数值单元格的数量，文本与空白不计入。', fields: [{ k: 'range', label: '数据区域', type: 'range', ph: '如 销售明细!E2:E43' }] },
        {
          k: 'COUNTA', label: 'COUNTA', icon: '№', short: '非空计数', group: '基础统计', tpl: 'COUNTA({range})',
          desc: '统计区域中所有非空单元格数量，文本、数字都计入，常用于统计填写条数。',
          fields: [{ k: 'range', label: '数据区域', type: 'range', ph: '如 销售明细!C2:C43' }]
        }
      ]
    },
    {
      group: '条件判断',
      items: [
        {
          k: 'IF', label: 'IF', icon: '⚖️', short: '条件判断', group: '条件判断',
          desc: '条件成立返回一个值，不成立返回另一个值，可整列批量判断大小单。',
          fields: [
            { k: 'cond', label: '条件表达式', type: 'text', ph: '如 E2>=5' },
            { k: 'yes', label: '成立时返回', type: 'text', ph: '如 大单' },
            { k: 'no', label: '不成立时返回', type: 'text', ph: '如 普通' }
          ]
        },
        {
          k: 'IFERROR', label: 'IFERROR', icon: '🛟', short: '错误兜底', group: '条件判断', tpl: 'IFERROR({expr},{t:value})',
          desc: '公式出错（如查找不到、除零）时显示替代内容，常用于 VLOOKUP 匹配失败时显示「未匹配」。',
          fields: [
            { k: 'expr', label: '被检查的公式', type: 'text', ph: '如 VLOOKUP(C2,客户档案!A2:D11,2,FALSE)' },
            { k: 'value', label: '出错时显示', type: 'text', ph: '如 未匹配', def: '未匹配' }
          ]
        },
        {
          k: 'AND', label: 'AND', icon: '✅', short: '同时满足', group: '条件判断', tpl: 'AND({cond1},{cond2})',
          desc: '两个条件同时成立时返回 TRUE，否则返回 FALSE。',
          fields: [
            { k: 'cond1', label: '条件 1', type: 'text', ph: '如 E2>=5' },
            { k: 'cond2', label: '条件 2', type: 'text', ph: '如 G2>=1000' }
          ]
        },
        {
          k: 'OR', label: 'OR', icon: '🔀', short: '任一满足', group: '条件判断', tpl: 'OR({cond1},{cond2})',
          desc: '两个条件中任意一个成立即返回 TRUE，否则返回 FALSE。',
          fields: [
            { k: 'cond1', label: '条件 1', type: 'text', ph: '如 H2="华东"' },
            { k: 'cond2', label: '条件 2', type: 'text', ph: '如 H2="华南"' }
          ]
        },
        {
          k: 'NOT', label: 'NOT', icon: '🚫', short: '条件取反', group: '条件判断', tpl: 'NOT({cond})',
          desc: '把条件结果取反：TRUE 变 FALSE，FALSE 变 TRUE。',
          fields: [
            { k: 'cond', label: '条件表达式', type: 'text', ph: '如 H2="华东"' }
          ]
        }
      ]
    },
    {
      group: '数学与取整',
      items: [
        {
          k: 'ROUND', label: 'ROUND', icon: '≈', short: '四舍五入', group: '数学与取整', perRow: true,
          desc: '按指定小数位四舍五入，可对整列批量处理金额、单价。',
          fields: [
            { k: 'range', label: '数值单元格 / 区域', type: 'range', ph: '如 销售明细!G2:G43' },
            { k: 'digits', label: '保留小数位', type: 'number', ph: '2', def: '2' }
          ]
        },
        {
          k: 'ROUNDUP', label: 'ROUNDUP', icon: '⬆️', short: '向上取整', group: '数学与取整', perRow: true, tpl: 'ROUNDUP({r},{digits})',
          desc: '无论小数大小都向上进位，例如把重量、工时不足一位的按一位计算。',
          fields: [
            { k: 'range', label: '数值单元格 / 区域', type: 'range', ph: '如 销售明细!G2:G43' },
            { k: 'digits', label: '保留小数位', type: 'number', ph: '0', def: '2' }
          ]
        },
        {
          k: 'ROUNDDOWN', label: 'ROUNDDOWN', icon: '⬇️', short: '向下取整', group: '数学与取整', perRow: true, tpl: 'ROUNDDOWN({r},{digits})',
          desc: '无论小数大小都舍去，例如计算可兑换的整数数量。',
          fields: [
            { k: 'range', label: '数值单元格 / 区域', type: 'range', ph: '如 销售明细!G2:G43' },
            { k: 'digits', label: '保留小数位', type: 'number', ph: '0', def: '2' }
          ]
        },
        {
          k: 'ABS', label: 'ABS', icon: '±', short: '绝对值', group: '数学与取整', perRow: true, tpl: 'ABS({r})',
          desc: '返回数值的绝对值，负数转正数，常用于计算差值、亏损额。',
          fields: [
            { k: 'range', label: '数值单元格 / 区域', type: 'range', ph: '如 销售明细!G2:G43' }
          ]
        },
        {
          k: 'INT', label: 'INT', icon: '🔢', short: '取整数部分', group: '数学与取整', perRow: true, tpl: 'INT({r})',
          desc: '直接去掉小数部分取整数，不进行四舍五入。',
          fields: [
            { k: 'range', label: '数值单元格 / 区域', type: 'range', ph: '如 销售明细!G2:G43' }
          ]
        },
        {
          k: 'MOD', label: 'MOD', icon: '➗', short: '求余数', group: '数学与取整', perRow: true, tpl: 'MOD({r},{n1})',
          desc: '返回两数相除的余数，常用于判断奇偶、按组编号、循环分组。',
          fields: [
            { k: 'range', label: '被除数单元格 / 区域', type: 'range', ph: '如 销售明细!E2:E43' },
            { k: 'n1', label: '除数', type: 'number', ph: '2', def: '2' }
          ]
        }
      ]
    },
    {
      group: '文本处理',
      items: [
        {
          k: 'LEFT', label: 'LEFT', icon: '◀', short: '截取左侧', group: '文本处理', perRow: true, tpl: 'LEFT({r},{n1})',
          desc: '从左侧开始截取指定个数的字符，例如提取编号前 4 位。',
          fields: [
            { k: 'range', label: '文本单元格 / 区域', type: 'range', ph: '如 销售明细!B2:B43' },
            { k: 'n1', label: '截取字符数', type: 'number', ph: '4', def: '4' }
          ]
        },
        {
          k: 'RIGHT', label: 'RIGHT', icon: '▶', short: '截取右侧', group: '文本处理', perRow: true, tpl: 'RIGHT({r},{n1})',
          desc: '从右侧开始截取指定个数的字符，例如提取编号后 3 位。',
          fields: [
            { k: 'range', label: '文本单元格 / 区域', type: 'range', ph: '如 销售明细!B2:B43' },
            { k: 'n1', label: '截取字符数', type: 'number', ph: '3', def: '3' }
          ]
        },
        {
          k: 'MID', label: 'MID', icon: '✂️', short: '中间截取', group: '文本处理', perRow: true, tpl: 'MID({r},{start},{n1})',
          desc: '从指定位置开始截取指定长度的字符，例如从订单号中提取年份。',
          fields: [
            { k: 'range', label: '文本单元格 / 区域', type: 'range', ph: '如 销售明细!B2:B43' },
            { k: 'start', label: '起始位置', type: 'number', ph: '4', def: '1' },
            { k: 'n1', label: '截取字符数', type: 'number', ph: '4', def: '4' }
          ]
        },
        {
          k: 'LEN', label: 'LEN', icon: '📏', short: '字符长度', group: '文本处理', perRow: true, tpl: 'LEN({r})',
          desc: '统计文本的字符个数，可用于检查编号、手机号长度是否规范。',
          fields: [
            { k: 'range', label: '文本单元格 / 区域', type: 'range', ph: '如 客户档案!A2:A11' }
          ]
        },
        {
          k: 'TRIM', label: 'TRIM', icon: '🧹', short: '去除多余空格', group: '文本处理', perRow: true, tpl: 'TRIM({r})',
          desc: '删除文本首尾空格并把中间连续空格压缩为一个，常用于清洗导入数据。',
          fields: [
            { k: 'range', label: '文本单元格 / 区域', type: 'range', ph: '如 销售明细!C2:C43' }
          ]
        },
        {
          k: 'UPPER', label: 'UPPER', icon: '🔠', short: '转大写', group: '文本处理', perRow: true, tpl: 'UPPER({r})',
          desc: '把英文文本全部转为大写字母。',
          fields: [
            { k: 'range', label: '文本单元格 / 区域', type: 'range', ph: '如 客户档案!A2:A11' }
          ]
        },
        {
          k: 'LOWER', label: 'LOWER', icon: '🔡', short: '转小写', group: '文本处理', perRow: true, tpl: 'LOWER({r})',
          desc: '把英文文本全部转为小写字母。',
          fields: [
            { k: 'range', label: '文本单元格 / 区域', type: 'range', ph: '如 客户档案!A2:A11' }
          ]
        },
        {
          k: 'CONCAT', label: 'CONCAT', icon: '🔗', short: '合并文本', group: '文本处理',
          desc: '把区域内的文本按分隔符合并成一串，可自定义分隔符。',
          fields: [
            { k: 'range', label: '数据区域', type: 'range', ph: '如 客户档案!A2:A11' },
            { k: 'sep', label: '分隔符', type: 'text', ph: '如 、', def: '、' }
          ]
        },
        {
          k: 'TEXTJOIN', label: 'TEXTJOIN', icon: '🧵', short: '带分隔符合并', group: '文本处理', tpl: 'TEXTJOIN({t:sep},{ignore},{range})',
          desc: '按指定分隔符合并区域文本，并可选择是否忽略空白单元格。',
          fields: [
            { k: 'range', label: '数据区域', type: 'range', ph: '如 销售明细!C2:C43' },
            { k: 'sep', label: '分隔符', type: 'text', ph: '如 ，', def: '，' },
            {
              k: 'ignore', label: '忽略空白', type: 'select', def: 'TRUE',
              opts: [{ v: 'TRUE', t: '忽略空白单元格' }, { v: 'FALSE', t: '保留空白位置' }]
            }
          ]
        }
      ]
    },
    {
      group: '日期与时间',
      items: [
        {
          k: 'MONTH', label: 'MONTH', icon: '📅', short: '提取月份', group: '日期与时间', perRow: true,
          desc: '从日期中提取月份数字（1—12），可整列批量填充，便于按月汇总。',
          fields: [
            { k: 'range', label: '日期单元格 / 区域', type: 'range', ph: '如 销售明细!A2:A43' }
          ]
        },
        {
          k: 'YEAR', label: 'YEAR', icon: '🗓️', short: '提取年份', group: '日期与时间', perRow: true, tpl: 'YEAR({r})',
          desc: '从日期中提取四位年份，例如 2026。',
          fields: [
            { k: 'range', label: '日期单元格 / 区域', type: 'range', ph: '如 销售明细!A2:A43' }
          ]
        },
        {
          k: 'DAY', label: 'DAY', icon: '📆', short: '提取日', group: '日期与时间', perRow: true, tpl: 'DAY({r})',
          desc: '从日期中提取当月第几天（1—31）。',
          fields: [
            { k: 'range', label: '日期单元格 / 区域', type: 'range', ph: '如 销售明细!A2:A43' }
          ]
        },
        {
          k: 'TODAY', label: 'TODAY', icon: '⏰', short: '今天日期', group: '日期与时间', tpl: 'TODAY()',
          desc: '返回系统当前日期，结果写入单元格后每次打开都会自动更新。',
          fields: []
        },
        {
          k: 'TEXT', label: 'TEXT', icon: '🔤', short: '日期格式化', group: '日期与时间', perRow: true,
          desc: '把日期或数字转成指定格式的文本，如 yyyy-mm、yyyy年mm月。',
          fields: [
            { k: 'range', label: '单元格 / 区域', type: 'range', ph: '如 销售明细!A2:A43' },
            { k: 'fmt', label: '格式代码', type: 'text', ph: '如 yyyy-mm', def: 'yyyy-mm' }
          ]
        },
        {
          k: 'VALUE', label: 'VALUE', icon: '🔢', short: '文本转数字', group: '日期与时间', perRow: true, tpl: 'VALUE({r})',
          desc: '把看起来像数字的文本转成真正的数值，便于继续参与求和计算。',
          fields: [
            { k: 'range', label: '文本单元格 / 区域', type: 'range', ph: '如 销售明细!E2:E43' }
          ]
        }
      ]
    }
  ];

  /* ---------- 示例工作簿 ---------- */
  const CUSTOMERS = [
    ['江南商贸', '金牌', '陈静', '138****2210'],
    ['北方电子', '银牌', '王磊', '139****7781'],
    ['西岭办公', '金牌', '李娜', '137****5566'],
    ['海川物资', '铜牌', '赵勇', '136****9032'],
    ['云图科技', '银牌', '陈静', '135****4477'],
    ['恒信实业', '金牌', '王磊', '133****6612'],
    ['天府商贸', '铜牌', '李娜', '132****8890'],
    ['东方数码', '银牌', '赵勇', '131****3345'],
    ['锦程文具', '铜牌', '陈静', '130****1123'],
    ['新元办公', '金牌', '王磊', '189****7712']
  ];

  const PRODUCTS = [
    ['笔记本电脑 Pro 14', 5999, 4520],
    ['激光打印机 M2', 1899, 1380],
    ['A4 复印纸（箱）', 158, 112],
    ['无线键鼠套装', 129, 82],
    ['人体工学椅', 899, 620],
    ['桌面显示器 27 寸', 1299, 960],
    ['文件柜（四层）', 459, 310]
  ];

  function pad2(n) { return String(n).padStart(2, '0'); }
  function pad4(n) { return String(n).padStart(4, '0'); }

  function blankMatrix(rows, cols) {
    const data = [];
    for (let r = 0; r < rows; r++) data.push(new Array(cols).fill(''));
    return data;
  }

  function styleHeader(fmts, addrRange) {
    for (const a of addrRange) {
      fmts[a] = { b: 1, bg: '#e7f6ee', color: '#0b7a43', align: 'center' };
    }
  }

  function buildDemoWorkbook() {
    const rows = 60, cols = 16;

    /* 销售明细 */
    const sales = blankMatrix(rows, cols);
    const head = ['日期', '订单号', '客户名称', '产品', '数量', '单价', '金额', '地区', '负责人', '客户等级', '备注'];
    head.forEach((h, i) => sales[0][i] = h);
    const regions = ['华东', '华南', '华北', '西南'];
    const owners = ['陈静', '王磊', '李娜', '赵勇'];
    for (let i = 0; i < 42; i++) {
      const r = i + 1;
      const month = 1 + (i % 11);
      const day = 2 + ((i * 3) % 26);
      const cust = CUSTOMERS[i % CUSTOMERS.length];
      const prod = PRODUCTS[(i * 2) % PRODUCTS.length];
      const qty = 1 + ((i * 7) % 9);
      sales[r][0] = '2026-' + pad2(month) + '-' + pad2(day);
      sales[r][1] = 'SO-2026-' + pad4(i + 1);
      sales[r][2] = cust[0];
      sales[r][3] = prod[0];
      sales[r][4] = qty;
      sales[r][5] = prod[1];
      sales[r][6] = '=E' + (r + 1) + '*F' + (r + 1);
      sales[r][7] = regions[i % regions.length];
      sales[r][8] = owners[i % owners.length];
      sales[r][9] = '';
      sales[r][10] = i % 9 === 0 ? '加急' : '';
    }
    const salesFmts = {};
    styleHeader(salesFmts, head.map((h, i) => colLetter(i) + '1'));
    for (let r = 1; r <= 42; r++) {
      salesFmts['G' + (r + 1)] = { nf: 'thousand', align: 'right' };
      salesFmts['F' + (r + 1)] = { nf: 'currency', align: 'right' };
      salesFmts['A' + (r + 1)] = { align: 'center' };
      salesFmts['E' + (r + 1)] = { align: 'center' };
    }

    /* 客户档案 */
    const cust = blankMatrix(rows, cols);
    ['客户名称', '客户等级', '负责人', '联系电话'].forEach((h, i) => cust[0][i] = h);
    CUSTOMERS.forEach((c, i) => {
      const r = i + 1;
      cust[r][0] = c[0];
      cust[r][1] = c[1];
      cust[r][2] = c[2];
      cust[r][3] = c[3];
    });
    const custFmts = {};
    styleHeader(custFmts, ['A1', 'B1', 'C1', 'D1']);
    for (let r = 1; r <= CUSTOMERS.length; r++) custFmts['B' + (r + 1)] = { align: 'center' };

    /* 产品价格表 */
    const prodSheet = blankMatrix(rows, cols);
    ['产品名称', '销售单价', '成本价', '毛利率'].forEach((h, i) => prodSheet[0][i] = h);
    PRODUCTS.forEach((p, i) => {
      const r = i + 1;
      prodSheet[r][0] = p[0];
      prodSheet[r][1] = p[1];
      prodSheet[r][2] = p[2];
      prodSheet[r][3] = '=ROUND((B' + (r + 1) + '-C' + (r + 1) + ')/B' + (r + 1) + ',3)';
    });
    const prodFmts = {};
    styleHeader(prodFmts, ['A1', 'B1', 'C1', 'D1']);
    for (let r = 1; r <= PRODUCTS.length; r++) {
      prodFmts['B' + (r + 1)] = { nf: 'currency', align: 'right' };
      prodFmts['C' + (r + 1)] = { nf: 'currency', align: 'right' };
      prodFmts['D' + (r + 1)] = { nf: 'percent', align: 'right' };
    }

    /* 使用说明 */
    const help = blankMatrix(rows, cols);
    const helpLines = [
      ['WPS 表格仿真 · 使用说明', ''],
      ['① 多表管理', '底部标签可新增、重命名、删除工作表，数据保存在 MySQL。'],
      ['② 函数一键使用', '点击顶部「公式」→「函数向导」，或右侧面板，选择函数后按「框选」在表格拖选区域。'],
      ['③ 数据匹配', 'VLOOKUP 可把「客户档案」中的等级匹配到「销售明细」的 J 列，点击「VLOOKUP 一键匹配」可自动填好参数。'],
      ['④ 按月统计', '选择日期列与金额列，一键生成 1—12 月的汇总表，自动新建「月度统计」工作表。'],
      ['⑤ 公式栏', '任意单元格可输入 =SUM(G2:G43)、=VLOOKUP(...)、=MONTH(A2) 等公式，回车立即计算。'],
      ['⑥ 保存', 'Ctrl + S 或点击右上角「保存」，工作簿整体写入 MySQL。'],
      ['', ''],
      ['示例数据', '42 条销售订单（2026 年 1—11 月）、10 个客户档案、7 个产品价格。']
    ];
    helpLines.forEach((line, i) => {
      help[i][0] = line[0];
      help[i][1] = line[1];
    });
    const helpFmts = { A1: { b: 1, color: '#0b7a43' }, A2: { b: 1 }, A3: { b: 1 }, A4: { b: 1 }, A5: { b: 1 }, A6: { b: 1 }, A7: { b: 1 }, A9: { b: 1 } };

    return {
      name: '销售数据工作簿',
      sheets: [
        { id: 's_sales', name: '销售明细', rows: rows, cols: cols, data: sales, fmts: salesFmts },
        { id: 's_cust', name: '客户档案', rows: rows, cols: cols, data: cust, fmts: custFmts },
        { id: 's_prod', name: '产品价格表', rows: rows, cols: cols, data: prodSheet, fmts: prodFmts },
        { id: 's_help', name: '使用说明', rows: rows, cols: cols, data: help, fmts: helpFmts }
      ]
    };
  }

  function blankSheet(name, id) {
    return {
      id: id || 's_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      name: name,
      rows: 100,
      cols: 16,
      data: blankMatrix(100, 16),
      fmts: {},
      merges: []
    };
  }

  global.WpsEngine = {
    colLetter: colLetter,
    colIndex: colIndex,
    addrToRC: addrToRC,
    rcToAddr: rcToAddr,
    parseRefText: parseRefText,
    toNumber: toNumber,
    toText: toText,
    formatValue: formatValue,
    parseDateValue: parseDateValue,
    evalFormula: evalFormula,
    recalc: recalc,
    FUNC_LIBRARY: FUNC_LIBRARY,
    buildDemoWorkbook: buildDemoWorkbook,
    blankSheet: blankSheet
  };
})(window);
