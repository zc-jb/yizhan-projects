<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

const menus = [
  { path: '/dashboard', label: '经营概览', icon: '📊' },
  { path: '/room-types', label: '房型管理', icon: '🏷️' },
  { path: '/rooms', label: '房间管理', icon: '🛏️' },
  { path: '/guests', label: '客人管理', icon: '👥' },
  { path: '/reservations', label: '预订与入住', icon: '📅' },
  { path: '/bills', label: '账单与营收', icon: '💰' }
];

const user = computed(() => {
  try { return JSON.parse(localStorage.getItem('hotel-user') || '{}'); } catch { return {}; }
});
const activeIndex = computed(() => route.path);
const logout = () => {
  localStorage.removeItem('hotel-token');
  localStorage.removeItem('hotel-user');
  router.push('/login');
};
</script>

<template>
  <el-container class="shell">
    <el-aside width="224px" class="aside">
      <div class="brand">
        <div class="brand-mark">🏨</div>
        <div class="brand-text">
          <b>云栖酒店</b>
          <span>HOTEL CONSOLE</span>
        </div>
      </div>
      <el-menu :default-active="activeIndex" router class="menu">
        <el-menu-item v-for="m in menus" :key="m.path" :index="m.path">
          <span class="m-icon">{{ m.icon }}</span>{{ m.label }}
        </el-menu-item>
      </el-menu>
      <div class="aside-foot">
        <p>MySQL 8.0 主库</p>
        <p>Redis 缓存加速</p>
      </div>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="head-left">
          <h1>{{ route.meta.title || '酒店管理' }}</h1>
          <span class="head-sub">业务数据实时落盘 MySQL，概览统计经 Redis / 本地缓存加速</span>
        </div>
        <div class="head-right">
          <el-tag effect="plain" round>{{ user.role === 'ADMIN' ? '管理员' : '前台' }}</el-tag>
          <span class="user-name">{{ user.name || user.username || '未登录' }}</span>
          <el-button size="small" @click="logout">退出登录</el-button>
        </div>
      </el-header>

      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>
