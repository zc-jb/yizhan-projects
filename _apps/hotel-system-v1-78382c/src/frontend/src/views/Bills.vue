<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import http from '../api';

const loading = ref(false);
const data = ref({ list: [], total: 0, count: 0 });
const range = ref([]);
const today = new Date();
const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
const fmtDate = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const initRange = () => {
  range.value = [fmtDate(monthStart), fmtDate(today)];
};
initRange();

const load = async () => {
  if (!range.value || range.value.length !== 2) return;
  loading.value = true;
  try {
    data.value = await http.get('/bills', { params: { from: range.value[0], to: range.value[1] } });
  } finally {
    loading.value = false;
  }
};

const avg = computed(() => (data.value.count ? Number(data.value.total) / data.value.count : 0));
const paymentText = { CASH: '现金', WECHAT: '微信支付', ALIPAY: '支付宝', CARD: '银行卡' };

const day = (v) => (v ? String(v).slice(0, 10) : '-');
const time = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '-');
const money = (v) => `¥${Number(v ?? 0).toLocaleString()}`;

watch(range, load);

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2>账单与营收</h2>
        <p>按下账日期区间统计已退房订单结算金额</p>
      </div>
      <el-button @click="load">刷新</el-button>
    </div>

    <div class="toolbar">
      <el-date-picker
        v-model="range"
        type="daterange"
        value-format="YYYY-MM-DD"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        style="width: 280px"
      />
      <el-tag effect="plain" round>默认当月</el-tag>
    </div>

    <div class="bill-cards">
      <div class="stat-card brand">
        <div class="label">结算总额</div>
        <div class="value">{{ money(data.total) }}</div>
        <div class="sub">{{ data.from }} 至 {{ data.to }}</div>
      </div>
      <div class="stat-card">
        <div class="label">账单笔数</div>
        <div class="value">{{ data.count }}</div>
        <div class="sub">已退房订单</div>
      </div>
      <div class="stat-card">
        <div class="label">单均收入</div>
        <div class="value">{{ money(Math.round(avg)) }}</div>
        <div class="sub">总额 / 笔数</div>
      </div>
    </div>

    <el-table v-loading="loading" :data="data.list || []" stripe class="card-table">
      <el-table-column prop="code" label="订单号" width="180" />
      <el-table-column prop="guestName" label="客人" width="110" />
      <el-table-column label="房间" width="130">
        <template #default="{ row }">
          <div class="cell-main">{{ row.roomNo }}</div>
          <div class="cell-sub">{{ row.typeName }}</div>
        </template>
      </el-table-column>
      <el-table-column label="入住 / 离店" width="210">
        <template #default="{ row }">
          <div class="cell-main">{{ day(row.checkInDate) }} → {{ day(row.checkOutDate) }}</div>
          <div class="cell-sub">退房：{{ time(row.checkedOutAt) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="支付方式" width="110">
        <template #default="{ row }">{{ paymentText[row.paymentMethod] || '现金' }}</template>
      </el-table-column>
      <el-table-column label="结算金额" width="130">
        <template #default="{ row }"><span class="price">{{ money(row.paidAmount) }}</span></template>
      </el-table-column>
      <template #empty><el-empty description="该时间段还没有已结算账单" :image-size="70" /></template>
    </el-table>
  </div>
</template>
