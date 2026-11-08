<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import http from '../api';

const router = useRouter();
const loading = ref(false);
const form = ref({ username: 'admin', password: '123456' });

const accounts = [
  { username: 'admin', name: '系统管理员', role: 'ADMIN', desc: '全部模块 · 房型/房间/账单', icon: '🛡️' },
  { username: 'reception', name: '前台小陈', role: 'RECEPTION', desc: '预订 · 入住 · 退房结算', icon: '🗝️' }
];

const activeAccount = computed(() => accounts.find(a => a.username === form.value.username)?.username);

const pick = (acc) => {
  form.value.username = acc.username;
  form.value.password = '123456';
};

const submit = async () => {
  if (!form.value.username || !form.value.password) {
    ElMessage.warning('请输入账号和密码');
    return;
  }
  loading.value = true;
  try {
    const data = await http.post('/auth/login', form.value);
    localStorage.setItem('hotel-token', data.token);
    localStorage.setItem('hotel-user', JSON.stringify(data.user));
    ElMessage.success(`欢迎回来，${data.user.name}`);
    router.push('/dashboard');
  } catch (e) {
    // 错误提示由 axios 拦截器统一处理
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="lg-page">
    <section class="lg-hero">
      <div class="lg-photo"></div>
      <div class="lg-veil"></div>
      <div class="lg-grid"></div>
      <div class="lg-orb one"></div>
      <div class="lg-orb two"></div>

      <div class="lg-inner">
        <div class="lg-brand">
          <span class="lg-logo">🏨</span>
          <div class="lg-brand-text">
            <b>云栖酒店</b>
            <i>YUNQI HOTEL · CONSOLE</i>
          </div>
        </div>

        <h1>把前台、房态与账单<br /><em>装进一个管理台</em></h1>
        <p class="lg-desc">
          从预订到退房结算，房态自动流转、金额自动核算。业务数据实时落盘 MySQL，统计看板由 Redis 缓存加速。
        </p>

        <div class="lg-feats">
          <div class="lg-feat"><span>🧾</span><b>预订入住</b><i>房态自动流转</i></div>
          <div class="lg-feat"><span>📊</span><b>经营看板</b><i>实时入住率</i></div>
          <div class="lg-feat"><span>💰</span><b>账单营收</b><i>自动结算</i></div>
        </div>

        <div class="lg-float">
          <div class="lf-head">
            <span>今日房态</span>
            <span class="lf-live"><i></i>LIVE</span>
          </div>
          <div class="lf-bars">
            <div class="lf-bar" style="--w: 72%; --c: #22d3ee"><span>空闲</span><b>15</b></div>
            <div class="lf-bar" style="--w: 46%; --c: #fbbf24"><span>在住</span><b>─</b></div>
            <div class="lf-bar" style="--w: 30%; --c: #34d399"><span>待清洁</span><b>─</b></div>
          </div>
          <div class="lf-foot">
            <span>4 种房型 · 15 间客房</span>
            <span class="lf-tag">MySQL 主库</span>
          </div>
        </div>
      </div>
    </section>

    <section class="lg-panel">
      <div class="lg-card">
        <div class="lg-card-head">
          <div class="lg-card-logo">🏨</div>
          <h2>欢迎回来</h2>
          <p>登录进入云栖酒店管理台</p>
        </div>

        <div class="lg-accounts">
          <button
            v-for="a in accounts"
            :key="a.username"
            class="lg-acc"
            :class="{ on: activeAccount === a.username }"
            type="button"
            @click="pick(a)"
          >
            <span class="lg-acc-icon">{{ a.icon }}</span>
            <span class="lg-acc-main">
              <b>{{ a.username }}</b>
              <i>{{ a.name }} · {{ a.desc }}</i>
            </span>
            <span class="lg-acc-check">✓</span>
          </button>
        </div>

        <el-form label-position="top" class="lg-form" @submit.prevent="submit">
          <el-form-item label="账号">
            <el-input v-model="form.username" placeholder="请输入账号" size="large" clearable>
              <template #prefix><span class="lg-input-icon">👤</span></template>
            </el-input>
          </el-form-item>
          <el-form-item label="密码">
            <el-input
              v-model="form.password"
              type="password"
              placeholder="请输入密码"
              size="large"
              show-password
              @keyup.enter="submit"
            >
              <template #prefix><span class="lg-input-icon">🔒</span></template>
            </el-input>
          </el-form-item>
          <el-button type="primary" size="large" class="lg-submit" :loading="loading" @click="submit">
            {{ loading ? '正在登录…' : '进入管理台' }}
          </el-button>
        </el-form>

        <div class="lg-tip">
          <span class="lg-dot"></span>
          预置账号密码均为 <b>123456</b>，可直接体验全部功能
        </div>
      </div>

      <div class="lg-foot">
        <span>Java 17 · Spring Boot 3</span>
        <span>Vue 3 · Element Plus</span>
        <span>MySQL 8.0 · Redis Cache</span>
      </div>
    </section>
  </div>
</template>
