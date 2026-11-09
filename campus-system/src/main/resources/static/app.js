/* ==========================================================
   青禾校园 · 前端逻辑（原生 ES6，无构建依赖）
   所有请求均使用相对路径 ./api/...，便于反代到任意子路径
   ========================================================== */

const API = './api';
const TAB_PAGES = ['home', 'students', 'courses', 'scores', 'notices', 'profile'];
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#4f46e5,#06b6d4)',
  'linear-gradient(135deg,#7c3aed,#ec4899)',
  'linear-gradient(135deg,#0ea5e9,#22d3ee)',
  'linear-gradient(135deg,#f59e0b,#ef4444)',
  'linear-gradient(135deg,#10b981,#06b6d4)',
  'linear-gradient(135deg,#6366f1,#a855f7)'
];

const state = {
  token: localStorage.getItem('campus.token') || '',
  user: safeParse(localStorage.getItem('campus.user')),
  page: 'home',
  stats: null,
  students: null,
  courses: null,
  teachers: null,
  notices: null,
  scoreStudentId: null,
  studentKeyword: ''
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/* ---------------------------- 工具函数 ---------------------------- */

function safeParse(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function initials(name) {
  const text = String(name || '?').trim();
  return escapeHtml(text.slice(0, 1) || '?');
}

function pad2(num) {
  return num < 10 ? '0' + num : String(num);
}

function todayLabel() {
  const now = new Date();
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
  return (now.getMonth() + 1) + '月' + now.getDate() + '日 · ' + week;
}

function greetingLabel() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '上午好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function showToast(message, type) {
  const toast = $('#toast');
  $('#toast-icon').textContent = type === 'error' ? '⚠️' : '✅';
  $('#toast-text').textContent = message;
  toast.className = 'toast show' + (type === 'error' ? ' toast-error' : '');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(function () {
    toast.classList.remove('show');
  }, 2300);
}

function setBtnLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.dataset.original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span><span>处理中</span>';
  } else {
    btn.disabled = false;
    if (btn.dataset.original) {
      btn.innerHTML = btn.dataset.original;
      delete btn.dataset.original;
    }
  }
}

function skeletonRows(count) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += '<div class="skeleton-row">' +
      '<div class="skeleton skeleton-avatar"></div>' +
      '<div class="skeleton-lines">' +
      '<div class="skeleton skeleton-line" style="width:' + (55 + i * 6) + '%"></div>' +
      '<div class="skeleton skeleton-line short"></div>' +
      '</div></div>';
  }
  return html;
}

function skeletonBlocks(count) {
  let html = '';
  for (let i = 0; i < count; i++) {
    html += '<div class="skeleton skeleton-block"></div>';
  }
  return html;
}

function emptyState(icon, title, sub) {
  return '<div class="empty"><span class="empty-icon">' + icon + '</span>' +
    '<div class="empty-title">' + escapeHtml(title) + '</div>' +
    '<div class="empty-sub">' + escapeHtml(sub || '') + '</div></div>';
}

/* ---------------------------- 请求封装 ---------------------------- */

async function request(path, options) {
  options = options || {};
  const headers = { Accept: 'application/json' };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (state.token) {
    headers['X-Token'] = state.token;
  }

  let response;
  try {
    response = await fetch(API + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: 'no-store'
    });
  } catch (e) {
    throw new Error('网络连接失败，请检查服务是否已启动');
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') {
      handleSessionExpired();
    }
    const message = data && data.error ? data.error : '请求失败（' + response.status + '）';
    throw new Error(message);
  }
  return data;
}

/* ---------------------------- 登录态 ---------------------------- */

function setSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('campus.token', token);
  localStorage.setItem('campus.user', JSON.stringify(user));
}

function clearSession() {
  state.token = '';
  state.user = null;
  state.stats = null;
  state.students = null;
  state.courses = null;
  state.teachers = null;
  state.notices = null;
  state.scoreStudentId = null;
  localStorage.removeItem('campus.token');
  localStorage.removeItem('campus.user');
}

function handleSessionExpired() {
  clearSession();
  showLogin();
  showToast('登录已过期，请重新登录', 'error');
}

function showLoginError(message) {
  const box = $('#login-error');
  box.textContent = message;
  box.classList.remove('hidden');
}

function hideLoginError() {
  $('#login-error').classList.add('hidden');
}

function showLogin() {
  $('#app-shell').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
  $('#login-password').value = '';
  hideLoginError();
}

async function showApp() {
  $('#login-screen').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');
  applyRoleUI();
  renderSessionHeader();
  await navigate('home');
}

function applyRoleUI() {
  const isAdmin = state.user && state.user.role === 'ADMIN';
  $$('.admin-only').forEach(function (el) {
    el.classList.toggle('hidden', !isAdmin);
  });
}

function renderSessionHeader() {
  if (!state.user) return;
  $('#home-name').textContent = state.user.name || state.user.username || '同学';
  $('#home-avatar').textContent = state.user.role === 'ADMIN' ? '👑' : '🎓';
  $('#home-role').textContent = state.user.role === 'ADMIN' ? '管理员' : '学生';
  $('#home-date').textContent = todayLabel();
  $('#home-greeting').textContent = greetingLabel();
}

/* ---------------------------- 登录交互 ---------------------------- */

async function handleLogin(event) {
  event.preventDefault();
  const username = $('#login-username').value.trim();
  const password = $('#login-password').value;
  const btn = $('#login-btn');
  hideLoginError();

  if (!username || !password) {
    showLoginError('请输入账号和密码');
    return;
  }

  setBtnLoading(btn, true);
  try {
    const data = await request('/auth/login', {
      method: 'POST',
      body: { username: username, password: password }
    });
    setSession(data.token, data.user);
    await showApp();
    showToast('登录成功，欢迎回来');
  } catch (err) {
    showLoginError(err.message);
  } finally {
    setBtnLoading(btn, false);
  }
}

/* ---------------------------- 页面导航 ---------------------------- */

const pageLoaders = {
  home: loadHome,
  students: loadStudentsPage,
  courses: loadCoursesPage,
  scores: loadScoresPage,
  notices: loadNoticesPage,
  profile: renderProfile
};

async function navigate(page) {
  if (!state.token) {
    showLogin();
    return;
  }
  if (TAB_PAGES.indexOf(page) === -1) page = 'home';
  state.page = page;

  $$('.page').forEach(function (section) {
    section.classList.toggle('active', section.dataset.page === page);
  });
  $$('.tab').forEach(function (tab) {
    tab.classList.toggle('active', tab.dataset.goto === page);
  });

  window.scrollTo(0, 0);
  try {
    await pageLoaders[page]();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ---------------------------- 首页 ---------------------------- */

async function loadHome() {
  renderSessionHeader();
  $('#stat-grid').innerHTML = skeletonBlocks(4);
  $('#home-notices').innerHTML = skeletonRows(2);
  $('#cache-hint').textContent = '';

  const results = await Promise.all([
    request('/dashboard/stats'),
    request('/notices')
  ]);
  state.stats = results[0];
  state.notices = results[1];

  renderStats(state.stats);
  renderQuickActions();
  renderHomeNotices(state.notices.slice(0, 3));
}

function renderStats(stats) {
  if (!stats) return;
  const items = [
    { key: 'studentCount', label: '学生总数', icon: '🎓', tint: '', unit: '人' },
    { key: 'teacherCount', label: '教师总数', icon: '🧑‍🏫', tint: 'tint-cyan', unit: '人' },
    { key: 'courseCount', label: '开设课程', icon: '📚', tint: 'tint-violet', unit: '门' },
    { key: 'todayNoticeCount', label: '今日公告', icon: '📢', tint: 'tint-amber', unit: '条' }
  ];

  $('#stat-grid').innerHTML = items.map(function (item) {
    const value = Number(stats[item.key] || 0);
    return '<div class="stat-card ' + item.tint + '">' +
      '<div class="stat-icon">' + item.icon + '</div>' +
      '<div class="stat-num" data-count="' + value + '">0<small>' + item.unit + '</small></div>' +
      '<div class="stat-label">' + item.label + '</div>' +
      '</div>';
  }).join('');

  animateNumbers($('#stat-grid'));

  $('#cache-hint').textContent = '看板数据缓存 60 秒 · 更新于 ' + (stats.updatedAt || '—');
}

function animateNumbers(root) {
  $$('[data-count]', root).forEach(function (el) {
    const target = Number(el.dataset.count) || 0;
    const suffix = el.querySelector('small');
    const suffixHtml = suffix ? suffix.outerHTML : '';
    const start = performance.now();
    function step(now) {
      const progress = Math.min((now - start) / 680, 1);
      const value = Math.round(target * (1 - Math.pow(1 - progress, 3)));
      el.innerHTML = value + suffixHtml;
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
}

function renderQuickActions() {
  const isAdmin = state.user && state.user.role === 'ADMIN';
  const actions = isAdmin
    ? [
        { action: 'add-student', icon: '👤', label: '新增学生' },
        { action: 'publish-notice', icon: '📢', label: '发布公告' },
        { action: 'add-score', icon: '📝', label: '录入成绩' },
        { action: 'add-course', icon: '📚', label: '新建课程' }
      ]
    : [
        { action: 'scores', icon: '📈', label: '我的成绩' },
        { action: 'notices', icon: '📢', label: '校园公告' },
        { action: 'profile', icon: '👤', label: '个人中心' }
      ];

  const grid = $('#quick-grid');
  grid.className = 'quick-grid' + (actions.length === 3 ? ' cols-3' : '');
  grid.innerHTML = actions.map(function (item) {
    return '<button type="button" class="quick-item" data-quick="' + item.action + '">' +
      '<span class="quick-icon">' + item.icon + '</span>' +
      '<span class="quick-label">' + item.label + '</span>' +
      '</button>';
  }).join('');
}

function renderHomeNotices(notices) {
  const box = $('#home-notices');
  if (!notices.length) {
    box.innerHTML = emptyState('📭', '暂无公告', '有新的校园动态会显示在这里');
    return;
  }
  box.innerHTML = notices.map(function (notice) {
    return '<button type="button" class="notice-mini" data-goto="notices">' +
      '<span class="notice-dot' + (notice.important ? ' hot' : '') + '"></span>' +
      '<span class="notice-mini-main">' +
      '<b>' + escapeHtml(notice.title) + '</b>' +
      '<small>' + escapeHtml(notice.publisher) + ' · ' + escapeHtml(notice.createdAt) + '</small>' +
      '</span>' +
      '<span class="notice-mini-arrow">›</span>' +
      '</button>';
  }).join('');
}

/* ---------------------------- 学生管理 ---------------------------- */

async function loadStudentsPage() {
  if (state.students === null) {
    $('#student-list').innerHTML = skeletonRows(4);
  }
  await loadStudents(state.studentKeyword);
}

async function loadStudents(keyword) {
  $('#student-list').innerHTML = skeletonRows(4);
  const query = keyword ? '?keyword=' + encodeURIComponent(keyword) : '';
  const list = await request('/students' + query);
  state.students = list;
  renderStudentList(list);
}

function renderStudentList(list) {
  $('#student-count').textContent = list.length + ' 人';
  const box = $('#student-list');
  if (!list.length) {
    box.innerHTML = emptyState('🔍', '没有找到匹配的学生', '换个关键词试试，或新增一位学生');
    return;
  }

  const isAdmin = state.user && state.user.role === 'ADMIN';
  box.innerHTML = list.map(function (student, index) {
    const actions = isAdmin
      ? '<div class="person-actions">' +
        '<button type="button" class="icon-btn" data-edit-student="' + student.id + '" aria-label="编辑">✏️</button>' +
        '<button type="button" class="icon-btn danger" data-delete-student="' + student.id + '" aria-label="删除">🗑️</button>' +
        '</div>'
      : '';
    return '<div class="person">' +
      '<div class="avatar" style="background:' + AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length] + '">' +
      initials(student.name) + '</div>' +
      '<div class="person-main">' +
      '<div class="person-name">' + escapeHtml(student.name) +
      '<span class="mini-badge' + (student.gender === '女' ? ' girl' : '') + '">' +
      escapeHtml(student.gender || '未知') + '</span></div>' +
      '<div class="person-sub">' + escapeHtml(student.studentNo) + ' · ' +
      escapeHtml(student.className || '未分班') + ' · ' + escapeHtml(student.phone || '暂无手机号') + '</div>' +
      '</div>' + actions + '</div>';
  }).join('');
}

function openStudentModal(student) {
  const isEdit = Boolean(student);
  const formBody =
    '<div class="form-grid">' +
    '<label class="field"><span>学号 *</span><input name="studentNo" required maxlength="30" value="' +
    escapeHtml(student ? student.studentNo : '') + '" placeholder="如 stu013"></label>' +
    '<label class="field"><span>姓名 *</span><input name="name" required maxlength="50" value="' +
    escapeHtml(student ? student.name : '') + '" placeholder="学生姓名"></label>' +
    '<label class="field"><span>性别</span><select name="gender">' +
    '<option value="男"' + (student && student.gender === '男' ? ' selected' : '') + '>男</option>' +
    '<option value="女"' + (student && student.gender === '女' ? ' selected' : '') + '>女</option>' +
    '</select></label>' +
    '<label class="field"><span>入学年份</span><input name="enrollYear" type="number" min="2000" max="2100" value="' +
    escapeHtml(student && student.enrollYear ? student.enrollYear : 2023) + '"></label>' +
    '<label class="field"><span>班级</span><input name="className" maxlength="50" value="' +
    escapeHtml(student ? student.className || '' : '') + '" placeholder="如 计算机2301"></label>' +
    '<label class="field"><span>专业</span><input name="major" maxlength="50" value="' +
    escapeHtml(student ? student.major || '' : '') + '" placeholder="如 软件工程"></label>' +
    '<label class="field full"><span>手机号</span><input name="phone" maxlength="20" value="' +
    escapeHtml(student ? student.phone || '' : '') + '" placeholder="11 位手机号"></label>' +
    '<label class="field full"><span>邮箱</span><input name="email" type="email" maxlength="100" value="' +
    escapeHtml(student ? student.email || '' : '') + '" placeholder="name@campus.edu.cn"></label>' +
    '</div>';

  openFormModal({
    title: isEdit ? '编辑学生' : '新增学生',
    subtitle: isEdit ? '学号 ' + escapeHtml(student.studentNo) : '新学生默认登录密码为 123456',
    submitText: isEdit ? '保存修改' : '创建学生',
    body: formBody,
    onSubmit: async function (values) {
      const payload = {
        studentNo: values.studentNo.trim(),
        name: values.name.trim(),
        gender: values.gender,
        className: values.className.trim(),
        major: values.major.trim(),
        phone: values.phone.trim(),
        email: values.email.trim(),
        enrollYear: Number(values.enrollYear) || 2023
      };
      if (isEdit) {
        await request('/students/' + student.id, { method: 'PUT', body: payload });
      } else {
        await request('/students', { method: 'POST', body: payload });
      }
      showToast(isEdit ? '学生信息已更新' : '学生已添加');
      state.students = null;
      await loadStudents(state.studentKeyword);
    }
  });
}

function confirmDeleteStudent(id) {
  const student = (state.students || []).find(function (item) {
    return item.id === id;
  });
  if (!student) return;
  openConfirm({
    title: '删除学生',
    message: '确定删除「' + student.name + '（' + student.studentNo + '）」吗？该学生的成绩记录也会一并删除，此操作不可撤销。',
    onConfirm: async function () {
      await request('/students/' + id, { method: 'DELETE' });
      state.students = null;
      await loadStudents(state.studentKeyword);
    }
  });
}

/* ---------------------------- 课程管理 ---------------------------- */

async function loadCoursesPage() {
  if (state.courses === null) {
    $('#course-list').innerHTML = skeletonBlocks(4);
  }
  await loadCourses();
}

async function loadCourses() {
  const results = await Promise.all([
    request('/courses'),
    request('/teachers')
  ]);
  state.courses = results[0];
  state.teachers = results[1];
  renderCourseList(state.courses);
}

function renderCourseList(list) {
  $('#course-count').textContent = list.length + ' 门';
  const box = $('#course-list');
  if (!list.length) {
    box.innerHTML = emptyState('📚', '还没有课程', '点击右下角按钮创建第一门课程');
    return;
  }

  const isAdmin = state.user && state.user.role === 'ADMIN';
  box.innerHTML = list.map(function (course) {
    const removeBtn = isAdmin
      ? '<button type="button" class="icon-btn danger" data-delete-course="' + course.id + '" aria-label="删除课程">🗑️</button>'
      : '';
    return '<article class="course-card">' +
      '<div class="course-top">' +
      '<span class="course-no">' + escapeHtml(course.courseNo) + '</span>' +
      removeBtn +
      '</div>' +
      '<h3 class="course-name">' + escapeHtml(course.name) + '</h3>' +
      '<div class="course-meta">' +
      '<span class="meta-chip">🧑‍🏫 ' + escapeHtml(course.teacher) + '</span>' +
      '<span class="meta-chip">🎯 ' + escapeHtml(course.credit) + ' 学分</span>' +
      '<span class="meta-chip">🕘 ' + escapeHtml(course.schedule || '时间待定') + '</span>' +
      '<span class="meta-chip">📍 ' + escapeHtml(course.location || '地点待定') + '</span>' +
      '</div></article>';
  }).join('');
}

function openCourseModal() {
  const teachers = state.teachers || [];
  const options = teachers.map(function (teacher) {
    return '<option value="' + escapeHtml(teacher.name) + '">' + escapeHtml(teacher.name) +
      ' · ' + escapeHtml(teacher.title) + '</option>';
  }).join('');

  openFormModal({
    title: '新建课程',
    subtitle: '课程编号留空将自动生成',
    submitText: '创建课程',
    body:
      '<div class="form-grid">' +
      '<label class="field full"><span>课程名称 *</span><input name="name" required maxlength="80" placeholder="如 操作系统"></label>' +
      '<label class="field"><span>授课教师 *</span><select name="teacher" required>' + options + '</select></label>' +
      '<label class="field"><span>学分 *</span><input name="credit" type="number" step="0.5" min="0.5" max="20" value="3" required></label>' +
      '<label class="field"><span>课程编号</span><input name="courseNo" maxlength="30" placeholder="留空自动生成"></label>' +
      '<label class="field"><span>上课地点</span><input name="location" maxlength="80" placeholder="如 教学楼 A101"></label>' +
      '<label class="field full"><span>上课时间</span><input name="schedule" maxlength="80" placeholder="如 周一 08:00-09:40"></label>' +
      '</div>',
    onSubmit: async function (values) {
      await request('/courses', {
        method: 'POST',
        body: {
          name: values.name.trim(),
          teacher: values.teacher,
          credit: Number(values.credit),
          courseNo: values.courseNo.trim(),
          location: values.location.trim(),
          schedule: values.schedule.trim()
        }
      });
      showToast('课程已创建');
      state.courses = null;
      await loadCourses();
    }
  });
}

function confirmDeleteCourse(id) {
  const course = (state.courses || []).find(function (item) {
    return item.id === id;
  });
  if (!course) return;
  openConfirm({
    title: '删除课程',
    message: '确定删除课程「' + course.name + '」吗？该课程下的成绩记录也会一并删除。',
    onConfirm: async function () {
      await request('/courses/' + id, { method: 'DELETE' });
      state.courses = null;
      await loadCourses();
    }
  });
}

/* ---------------------------- 成绩管理 ---------------------------- */

async function loadScoresPage() {
  const isAdmin = state.user && state.user.role === 'ADMIN';
  const picker = $('#score-picker-wrap');

  if (!isAdmin) {
    state.scoreStudentId = state.user.id;
  } else {
    const students = await ensureStudents();
    if (!students.length) {
      $('#score-list').innerHTML = emptyState('🎓', '暂无学生', '请先在学生管理中添加学生');
      $('#score-summary').innerHTML = '';
      $('#score-count').textContent = '0 门';
      return;
    }
    let selected = state.scoreStudentId;
    if (!selected || !students.some(function (s) { return s.id === selected; })) {
      selected = students[0].id;
    }
    state.scoreStudentId = selected;
    $('#score-student-picker').innerHTML = students.map(function (student) {
      return '<option value="' + student.id + '"' + (student.id === selected ? ' selected' : '') + '>' +
        escapeHtml(student.name) + ' · ' + escapeHtml(student.studentNo) + ' · ' +
        escapeHtml(student.className || '') + '</option>';
    }).join('');
  }

  picker.classList.toggle('hidden', !isAdmin);
  $('#score-list').innerHTML = skeletonRows(4);
  const scores = await request('/scores?studentId=' + state.scoreStudentId);
  renderScores(scores);
}

async function renderScores(scores) {
  $('#score-count').textContent = scores.length + ' 门';
  renderScoreSummary(scores);

  const box = $('#score-list');
  if (!scores.length) {
    box.innerHTML = emptyState('📝', '暂无成绩记录', '点击右下角按钮录入第一门成绩');
    return;
  }

  box.innerHTML = scores.map(function (score) {
    const value = Number(score.score);
    const level = scoreLevel(value);
    const percent = Math.max(0, Math.min(100, value));
    return '<div class="score-row">' +
      '<div class="score-main">' +
      '<div class="score-course">' + escapeHtml(score.courseName) +
      '<span class="credit-tag">' + escapeHtml(score.credit) + ' 学分</span></div>' +
      '<div class="score-meta">' + escapeHtml(score.semester || '') + ' · ' + level.text + '</div>' +
      '<div class="score-bar"><i style="width:' + percent + '%"></i></div>' +
      '</div>' +
      '<div class="score-ring" style="--p:' + percent + ';--c:' + level.color + '"><span>' +
      escapeHtml(value) + '</span></div>' +
      '</div>';
  }).join('');
}

function renderScoreSummary(scores) {
  if (!scores.length) {
    $('#score-summary').innerHTML = '';
    return;
  }
  const values = scores.map(function (item) { return Number(item.score); });
  const average = values.reduce(function (a, b) { return a + b; }, 0) / values.length;
  const highest = Math.max.apply(null, values);
  $('#score-summary').innerHTML =
    '<div class="summary-item"><b>' + average.toFixed(1) + '</b><span>平均分</span></div>' +
    '<div class="summary-item"><b>' + highest + '</b><span>最高分</span></div>' +
    '<div class="summary-item"><b>' + scores.length + '</b><span>已修课程</span></div>';
}

function scoreLevel(value) {
  if (value >= 90) return { text: '优秀', color: '#0ea472' };
  if (value >= 80) return { text: '良好', color: '#4f46e5' };
  if (value >= 60) return { text: '合格', color: '#f79009' };
  return { text: '待提升', color: '#e5484d' };
}

async function openScoreModal() {
  const students = await ensureStudents();
  const courses = await ensureCourses();
  if (!students.length || !courses.length) {
    showToast('请先准备学生和课程数据', 'error');
    return;
  }

  const studentOptions = students.map(function (student) {
    return '<option value="' + student.id + '"' +
      (student.id === state.scoreStudentId ? ' selected' : '') + '>' +
      escapeHtml(student.name) + ' · ' + escapeHtml(student.studentNo) + '</option>';
  }).join('');
  const courseOptions = courses.map(function (course) {
    return '<option value="' + course.id + '">' + escapeHtml(course.name) +
      ' · ' + escapeHtml(course.credit) + ' 学分</option>';
  }).join('');

  openFormModal({
    title: '录入成绩',
    subtitle: '同一学生同一课程重复录入会覆盖原成绩',
    submitText: '保存成绩',
    body:
      '<div class="form-grid">' +
      '<label class="field full"><span>学生 *</span><select name="studentId" required>' + studentOptions + '</select></label>' +
      '<label class="field full"><span>课程 *</span><select name="courseId" required>' + courseOptions + '</select></label>' +
      '<label class="field"><span>成绩（0-100）*</span><input name="score" type="number" min="0" max="100" step="0.5" value="88" required></label>' +
      '<label class="field"><span>学期</span><input name="semester" maxlength="30" value="2025-2026-1"></label>' +
      '</div>',
    onSubmit: async function (values) {
      const studentId = Number(values.studentId);
      await request('/scores', {
        method: 'POST',
        body: {
          studentId: studentId,
          courseId: Number(values.courseId),
          score: Number(values.score),
          semester: values.semester.trim()
        }
      });
      state.scoreStudentId = studentId;
      showToast('成绩已保存');
      await loadScoresPage();
    }
  });
}

/* ---------------------------- 公告 ---------------------------- */

async function loadNoticesPage() {
  $('#notice-list').innerHTML = skeletonBlocks(4);
  const notices = await request('/notices');
  state.notices = notices;
  renderNoticeList(notices);
}

function renderNoticeList(notices) {
  const box = $('#notice-list');
  if (!notices.length) {
    box.innerHTML = emptyState('📭', '暂无公告', '管理员发布公告后会显示在这里');
    return;
  }
  box.innerHTML = notices.map(function (notice) {
    return '<article class="notice-card' + (notice.important ? ' important' : '') + '">' +
      '<div class="notice-head">' +
      (notice.important ? '<span class="notice-tag">置顶</span>' : '') +
      '<h3 class="notice-title">' + escapeHtml(notice.title) + '</h3>' +
      '</div>' +
      '<p class="notice-content">' + escapeHtml(notice.content) + '</p>' +
      '<div class="notice-foot"><span>📢 ' + escapeHtml(notice.publisher) + '</span>' +
      '<span>🕒 ' + escapeHtml(notice.createdAt) + '</span></div>' +
      '</article>';
  }).join('');
}

function openNoticeModal() {
  openFormModal({
    title: '发布公告',
    subtitle: '公告会实时展示给所有用户',
    submitText: '发布公告',
    body:
      '<div class="form-grid">' +
      '<label class="field full"><span>公告标题 *</span><input name="title" required maxlength="120" placeholder="一句话说明公告主题"></label>' +
      '<label class="field full"><span>公告内容 *</span><textarea name="content" required maxlength="1000" placeholder="请填写公告正文，最多 1000 字"></textarea></label>' +
      '</div>' +
      '<label class="checkbox-row"><input type="checkbox" name="important"> 标记为置顶公告</label>',
    onSubmit: async function (values) {
      await request('/notices', {
        method: 'POST',
        body: {
          title: values.title.trim(),
          content: values.content.trim(),
          important: values.important === 'on'
        }
      });
      showToast('公告已发布');
      state.notices = null;
      await loadNoticesPage();
    }
  });
}

/* ---------------------------- 个人中心 ---------------------------- */

function renderProfile() {
  const user = state.user;
  if (!user) return;
  const isAdmin = user.role === 'ADMIN';

  $('#profile-avatar').textContent = isAdmin ? '👑' : initials(user.name);
  $('#profile-name').textContent = user.name || user.username;
  $('#profile-role').textContent = isAdmin ? '系统管理员' : '在校学生';
  $('#profile-sub').textContent = isAdmin
    ? '拥有学生、课程、成绩与公告管理权限'
    : (user.className || '未分班') + ' · 学号 ' + (user.studentNo || user.username);

  const rows = [
    { icon: '🆔', label: '登录账号', value: user.username },
    { icon: '🏷️', label: '角色身份', value: isAdmin ? '管理员' : '学生' }
  ];
  if (!isAdmin) {
    rows.push({ icon: '🏫', label: '所属班级', value: user.className || '未分班' });
  }
  rows.push({ icon: '🗄️', label: '数据存储', value: 'MySQL 8 · Redis 自动降级' });
  rows.push({ icon: '⏱️', label: '缓存策略', value: '看板统计缓存 60 秒' });

  $('#profile-info').innerHTML = rows.map(function (row) {
    return '<div class="info-row">' +
      '<span class="info-label">' + row.icon + ' ' + escapeHtml(row.label) + '</span>' +
      '<span class="info-value">' + escapeHtml(row.value) + '</span>' +
      '</div>';
  }).join('');
}

function openAbout() {
  openInfoModal(
    '关于青禾校园',
    '<p class="confirm-text">青禾校园是一套面向校园日常管理场景的移动端演示系统，包含学生、课程、成绩与公告四大模块，支持管理员与学生两种角色。</p>' +
    '<p class="confirm-text">技术栈：Spring Boot 3.2 · Java 17 · MySQL 8 · Redis（不可用时自动降级为进程内缓存）· 原生移动端 H5。</p>' +
    '<p class="confirm-text" style="margin-bottom:4px">版本 v1.0.0 · 仅供作品集演示使用</p>'
  );
}

async function handleLogout() {
  openConfirm({
    title: '退出登录',
    message: '确定退出当前账号吗？退出后需要重新输入账号密码。',
    confirmText: '退出登录',
    danger: false,
    onConfirm: async function () {
      try {
        await request('/auth/logout', { method: 'POST' });
      } catch (e) {
        // 退出接口异常不阻塞本地清理
      }
      clearSession();
      showLogin();
    },
    successMessage: '已退出登录'
  });
}

/* ---------------------------- 弹层组件 ---------------------------- */

function openFormModal(config) {
  const root = $('#modal-root');
  root.innerHTML =
    '<div class="modal-mask">' +
    '<div class="modal-sheet" role="dialog" aria-modal="true">' +
    '<div class="sheet-bar"></div>' +
    '<div class="modal-head"><div><h3>' + escapeHtml(config.title) + '</h3>' +
    (config.subtitle ? '<p>' + config.subtitle + '</p>' : '') + '</div>' +
    '<button type="button" class="modal-close" data-modal-close aria-label="关闭">✕</button></div>' +
    '<form id="modal-form" class="modal-form">' + config.body +
    '<div class="modal-actions">' +
    '<button type="button" class="btn btn-ghost" data-modal-close>取消</button>' +
    '<button type="submit" class="btn btn-primary" id="modal-submit">' + escapeHtml(config.submitText || '保存') + '</button>' +
    '</div></form></div></div>';

  document.body.classList.add('modal-open');
  const mask = $('.modal-mask', root);

  mask.addEventListener('click', function (event) {
    if (event.target === mask) closeModal();
  });
  $$('[data-modal-close]', root).forEach(function (btn) {
    btn.addEventListener('click', closeModal);
  });

  $('#modal-form', root).addEventListener('submit', async function (event) {
    event.preventDefault();
    const submitBtn = $('#modal-submit', root);
    const values = {};
    new FormData(event.target).forEach(function (value, key) {
      values[key] = value;
    });
    setBtnLoading(submitBtn, true);
    try {
      await config.onSubmit(values);
      closeModal();
    } catch (err) {
      showToast(err.message, 'error');
      setBtnLoading(submitBtn, false);
    }
  });
}

function openConfirm(config) {
  const root = $('#modal-root');
  root.innerHTML =
    '<div class="modal-mask"><div class="modal-sheet">' +
    '<div class="sheet-bar"></div>' +
    '<div class="modal-head"><div><h3>' + escapeHtml(config.title) + '</h3></div>' +
    '<button type="button" class="modal-close" data-modal-close aria-label="关闭">✕</button></div>' +
    '<p class="confirm-text">' + escapeHtml(config.message) + '</p>' +
    '<div class="modal-actions">' +
    '<button type="button" class="btn btn-ghost" data-modal-close>取消</button>' +
    '<button type="button" class="btn ' + (config.danger === false ? 'btn-primary' : 'btn-danger solid') + '" id="confirm-btn">' +
    escapeHtml(config.confirmText || '确认删除') + '</button>' +
    '</div></div></div>';

  document.body.classList.add('modal-open');
  const mask = $('.modal-mask', root);
  mask.addEventListener('click', function (event) {
    if (event.target === mask) closeModal();
  });
  $$('[data-modal-close]', root).forEach(function (btn) {
    btn.addEventListener('click', closeModal);
  });

  $('#confirm-btn', root).addEventListener('click', async function () {
    const btn = this;
    setBtnLoading(btn, true);
    try {
      await config.onConfirm();
      closeModal();
      showToast(config.successMessage || '操作成功');
    } catch (err) {
      showToast(err.message, 'error');
      setBtnLoading(btn, false);
    }
  });
}

function openInfoModal(title, html) {
  const root = $('#modal-root');
  root.innerHTML =
    '<div class="modal-mask"><div class="modal-sheet">' +
    '<div class="sheet-bar"></div>' +
    '<div class="modal-head"><div><h3>' + escapeHtml(title) + '</h3></div>' +
    '<button type="button" class="modal-close" data-modal-close aria-label="关闭">✕</button></div>' +
    html +
    '<div class="modal-actions"><button type="button" class="btn btn-primary" data-modal-close>我知道了</button></div>' +
    '</div></div>';

  document.body.classList.add('modal-open');
  const mask = $('.modal-mask', root);
  mask.addEventListener('click', function (event) {
    if (event.target === mask) closeModal();
  });
  $$('[data-modal-close]', root).forEach(function (btn) {
    btn.addEventListener('click', closeModal);
  });
}

function closeModal() {
  $('#modal-root').innerHTML = '';
  document.body.classList.remove('modal-open');
}

/* ---------------------------- 数据辅助 ---------------------------- */

async function ensureStudents() {
  if (!state.students) {
    state.students = await request('/students');
  }
  return state.students;
}

async function ensureCourses() {
  if (!state.courses) {
    const results = await Promise.all([request('/courses'), request('/teachers')]);
    state.courses = results[0];
    state.teachers = results[1];
  }
  return state.courses;
}

/* ---------------------------- 事件绑定 ---------------------------- */

function bindEvents() {
  $('#login-form').addEventListener('submit', handleLogin);

  $$('.chip[data-account]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      $('#login-username').value = chip.dataset.account;
      $('#login-password').value = chip.dataset.password;
      hideLoginError();
    });
  });

  // 所有 data-goto 元素统一处理页面跳转
  document.addEventListener('click', function (event) {
    const target = event.target.closest('[data-goto]');
    if (target) {
      event.preventDefault();
      navigate(target.dataset.goto);
    }
  });

  $('#home-avatar').addEventListener('click', function () {
    navigate('profile');
  });

  $('#refresh-stats').addEventListener('click', function () {
    const btn = this;
    btn.disabled = true;
    loadHome()
      .then(function () { showToast('看板已刷新'); })
      .catch(function (err) { showToast(err.message, 'error'); })
      .finally(function () { btn.disabled = false; });
  });

  $('#quick-grid').addEventListener('click', function (event) {
    const item = event.target.closest('[data-quick]');
    if (!item) return;
    const action = item.dataset.quick;
    if (action === 'add-student') openStudentModal(null);
    else if (action === 'publish-notice') openNoticeModal();
    else if (action === 'add-score') {
      openScoreModal().catch(function (err) { showToast(err.message, 'error'); });
    } else if (action === 'add-course') {
      ensureCourses()
        .then(function () { openCourseModal(); })
        .catch(function (err) { showToast(err.message, 'error'); });
    } else {
      navigate(action);
    }
  });

  // 学生搜索（防抖 + 服务端查询）
  let searchTimer = null;
  $('#student-search').addEventListener('input', function (event) {
    const keyword = event.target.value.trim();
    state.studentKeyword = keyword;
    $('#student-search-clear').classList.toggle('hidden', !keyword);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      loadStudents(keyword).catch(function (err) { showToast(err.message, 'error'); });
    }, 300);
  });

  $('#student-search-clear').addEventListener('click', function () {
    $('#student-search').value = '';
    state.studentKeyword = '';
    this.classList.add('hidden');
    loadStudents('').catch(function (err) { showToast(err.message, 'error'); });
  });

  $('#student-list').addEventListener('click', function (event) {
    const edit = event.target.closest('[data-edit-student]');
    if (edit) {
      const student = (state.students || []).find(function (item) {
        return item.id === Number(edit.dataset.editStudent);
      });
      if (student) openStudentModal(student);
      return;
    }
    const remove = event.target.closest('[data-delete-student]');
    if (remove) confirmDeleteStudent(Number(remove.dataset.deleteStudent));
  });

  $('#add-student').addEventListener('click', function () {
    openStudentModal(null);
  });

  // 课程
  $('#add-course').addEventListener('click', function () {
    ensureCourses()
      .then(function () { openCourseModal(); })
      .catch(function (err) { showToast(err.message, 'error'); });
  });

  $('#course-list').addEventListener('click', function (event) {
    const remove = event.target.closest('[data-delete-course]');
    if (remove) confirmDeleteCourse(Number(remove.dataset.deleteCourse));
  });

  // 成绩
  $('#score-student-picker').addEventListener('change', function (event) {
    state.scoreStudentId = Number(event.target.value);
    loadScoresPage().catch(function (err) { showToast(err.message, 'error'); });
  });

  $('#add-score').addEventListener('click', function () {
    openScoreModal().catch(function (err) { showToast(err.message, 'error'); });
  });

  // 公告
  $('#publish-notice').addEventListener('click', openNoticeModal);

  // 个人中心
  $('#about-btn').addEventListener('click', openAbout);
  $('#logout-btn').addEventListener('click', handleLogout);

  // ESC 关闭弹层
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeModal();
  });
}

/* ---------------------------- 启动 ---------------------------- */

async function init() {
  // 反代到 /apps/xxx 且缺少尾斜杠时补全，保证 ./api 相对路径解析正确
  if (!location.pathname.endsWith('/') && !/\.[a-zA-Z0-9]+$/.test(location.pathname)) {
    try {
      history.replaceState(null, '', location.pathname + '/' + location.search + location.hash);
    } catch (e) {
      // 忽略浏览器限制
    }
  }

  bindEvents();
  $('#home-date').textContent = todayLabel();

  if (!state.token || !state.user) {
    clearSession();
    showLogin();
    return;
  }

  try {
    const data = await request('/auth/me');
    state.user = data.user;
    localStorage.setItem('campus.user', JSON.stringify(data.user));
    await showApp();
  } catch (err) {
    clearSession();
    showLogin();
  }
}

document.addEventListener('DOMContentLoaded', init);
