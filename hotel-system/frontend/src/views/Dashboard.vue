<script setup>
import { computed, onMounted, ref } from 'vue';
import http from '../api';

const loading = ref(true);
const stats = ref({});

const statusText = {
  BOOKED: '待入住',
  CHECKED_IN: '已入住',
  CHECKED_OUT: '已退房',
  CANCELLED: '已取消'
};
const statusType = {
  BOOKED: 'warning',
  CHECKED_IN: 'success',
  CHECKED_OUT: 'info',
  CANCELLED: 'danger'
};

const cards = computed(() => [
  { label: '客房总数', value: stats.value.totalRooms ?? 0, sub: '在册房间', brand: true },
  { label: '空闲房间', value: stats.value.idleRooms ?? 0, sub: '可直接入住' },
  { label: '在住房间', value: stats.value.occupiedRooms ?? 0, sub: '已办理入住' },
  { label: '入住率', value: `${stats.value.occupancyRate ?? 0}%`, sub: '在住 / 总数' },
  { label: '待入住订单', value: stats.value.pendingBookings ?? 0, sub: '已预订未到店' },
  { label: '本月营收', value: `¥${Number(stats.value.monthRevenue ?? 0).toLocaleString()}`, sub: '已退房结算' }
]);

const load = async () => {
  loading.value = true;
  try {
    stats.value = await http.get('/dashboard');
  } finally {
    loading.value = false;
  }
};

const money = (v) => `¥${Number(v ?? 0).toLocaleString()}`;
const day = (v) => (v ? String(v).slice(0, 10) : '-');

onMounted(load);
</script>

<template>
  <div v-loading="loading">
    <div class="stat-grid dash-cards">
      <div v-for="c in cards" :key="c.label" class="stat-card" :class="{ brand: c.brand }">
        <div class="label">{{ c.label }}</div>
        <div class="value">{{ c.value }}</div>
        <div class="sub">{{ c.sub }}</div>
      </div>
    </div>

    <div class="dash-split">
      <el-card shadow="never">
        <template #header>
          <div class="card-head">
            <span>今日运营</span>
            <el-button link type="primary" @click="load">刷新</el-button>
          </div>
        </template>
        <div class="mini-grid">
          <div class="mini">
            <span>今日到店</span>
            <b>{{ stats.todayArrivals ?? 0 }}</b>
          </div>
          <div class="mini">
            <span>今日离店</span>
            <b>{{ stats.todayDepartures ?? 0 }}</b>
          </div>
          <div class="mini">
            <span>待清洁</span>
            <b>{{ stats.cleaningRooms ?? 0 }}</b>
          </div>
          <div class="mini">
            <span>维修中</span>
            <b>{{ stats.maintenanceRooms ?? 0 }}</b>
          </div>
        </div>
      </el-card>

      <el-card shadow="never">
        <template #header>
          <div class="card-head">
            <span>房型余量</span>
            <el-button link type="primary" @click="$router.push('/rooms')">管理房间</el-button>
          </div>
        </template>
        <div class="type-list">
          <div v-for="t in stats.roomTypes || []" :key="t.typeId" class="type-row">
            <div class="type-name">
              <b>{{ t.name }}</b>
              <span class="muted">{{ money(t.price) }} / 晚</span>
            </div>
            <el-progress
              :percentage="t.total ? Math.round((t.idle / t.total) * 100) : 0"
              :stroke-width="10"
              :color="t.idle ? '#0f766e' : '#dc2626'"
            />
            <span class="type-num">空闲 {{ t.idle }} / {{ t.total }}</span>
          </div>
          <el-empty v-if="!(stats.roomTypes || []).length" description="暂无房型数据" :image-size="60" />
        </div>
      </el-card>
    </div>

    <el-card shadow="never" class="dash-table">
      <template #header>
        <div class="card-head">
          <span>最近预订</span>
          <el-button link type="primary" @click="$router.push('/reservations')">查看全部</el-button>
        </div>
      </template>
      <el-table :data="stats.recentReservations || []" stripe>
        <el-table-column prop="code" label="订单号" width="190" />
        <el-table-column prop="guestName" label="客人" width="110" />
        <el-table-column prop="roomNo" label="房间" width="90" />
        <el-table-column prop="typeName" label="房型" width="110" />
        <el-table-column label="入住日期" width="120">
          <template #default="{ row }">{{ day(row.checkInDate) }}</template>
        </el-table-column>
        <el-table-column label="离店日期" width="120">
          <template #default="{ row }">{{ day(row.checkOutDate) }}</template>
        </el-table-column>
        <el-table-column label="金额" width="110">
          <template #default="{ row }"><span class="price">{{ money(row.totalAmount) }}</span></template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType[row.status]" effect="light" round>{{ statusText[row.status] }}</el-tag>
          </template>
        </el-table-column>
        <template #empty><el-empty description="还没有预订记录，去「预订与入住」新建一单" :image-size="70" /></template>
      </el-table>
    </el-card>
  </div>
</template>
