<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../api';

const loading = ref(false);
const list = ref([]);
const guests = ref([]);
const types = ref([]);
const statusFilter = ref('');
const keyword = ref('');

const statusText = { BOOKED: '待入住', CHECKED_IN: '已入住', CHECKED_OUT: '已退房', CANCELLED: '已取消' };
const statusType = { BOOKED: 'warning', CHECKED_IN: 'success', CHECKED_OUT: 'info', CANCELLED: 'danger' };
const statusOptions = Object.entries(statusText).map(([value, label]) => ({ value, label }));

const dialog = ref(false);
const saving = ref(false);
const editing = ref(null);
const availableRooms = ref([]);
const roomLoading = ref(false);
const form = reactive({
  guestId: null,
  typeId: null,
  roomId: null,
  checkInDate: '',
  checkOutDate: '',
  remark: ''
});

const checkoutDialog = ref(false);
const checkoutRow = ref(null);
const checkoutForm = reactive({ paymentMethod: 'CASH' });
const payOptions = [
  { value: 'CASH', label: '现金' },
  { value: 'WECHAT', label: '微信支付' },
  { value: 'ALIPAY', label: '支付宝' },
  { value: 'CARD', label: '银行卡' }
];

const load = async () => {
  loading.value = true;
  try {
    const params = {};
    if (statusFilter.value) params.status = statusFilter.value;
    if (keyword.value) params.q = keyword.value;
    list.value = await http.get('/reservations', { params });
  } finally {
    loading.value = false;
  }
};

let timer = null;
watch(keyword, () => {
  clearTimeout(timer);
  timer = setTimeout(load, 400);
});
watch(statusFilter, load);

const loadBase = async () => {
  const [guestList, typeList] = await Promise.all([http.get('/guests'), http.get('/room-types')]);
  guests.value = guestList;
  types.value = typeList;
};

const nights = computed(() => {
  if (!form.checkInDate || !form.checkOutDate) return 0;
  const d = (new Date(form.checkOutDate) - new Date(form.checkInDate)) / 86400000;
  return d > 0 ? Math.round(d) : 0;
});
const selectedType = computed(() => types.value.find(t => t.id === form.typeId));
const estimate = computed(() => {
  if (!selectedType.value || !nights.value) return 0;
  return Number(selectedType.value.price) * nights.value;
});

const loadAvailable = async () => {
  if (!form.typeId || !form.checkInDate || !form.checkOutDate) {
    availableRooms.value = [];
    return;
  }
  if (nights.value <= 0) {
    availableRooms.value = [];
    return;
  }
  roomLoading.value = true;
  try {
    availableRooms.value = await http.get('/rooms/available', {
      params: { typeId: form.typeId, in: form.checkInDate, out: form.checkOutDate }
    });
    if (!availableRooms.value.some(r => r.id === form.roomId)) form.roomId = null;
  } finally {
    roomLoading.value = false;
  }
};

watch(() => [form.typeId, form.checkInDate, form.checkOutDate], loadAvailable);

const resetForm = () => {
  form.guestId = guests.value[0]?.id ?? null;
  form.typeId = types.value[0]?.id ?? null;
  form.roomId = null;
  form.checkInDate = new Date().toISOString().slice(0, 10);
  const t = new Date(Date.now() + 86400000);
  form.checkOutDate = t.toISOString().slice(0, 10);
  form.remark = '';
};

const openCreate = () => {
  editing.value = null;
  resetForm();
  dialog.value = true;
};

const openEdit = (row) => {
  editing.value = row;
  form.guestId = row.guestId;
  form.typeId = null;
  form.roomId = row.roomId;
  form.checkInDate = String(row.checkInDate).slice(0, 10);
  form.checkOutDate = String(row.checkOutDate).slice(0, 10);
  form.remark = row.remark || '';
  const type = types.value.find(t => t.name === row.typeName);
  form.typeId = type?.id ?? types.value[0]?.id ?? null;
  availableRooms.value = [];
  http.get('/rooms/available', {
    params: { typeId: form.typeId, in: form.checkInDate, out: form.checkOutDate }
  }).then(rows => { availableRooms.value = rows; }).catch(() => {});
  dialog.value = true;
};

const save = async () => {
  if (!form.guestId) return ElMessage.warning('请选择客人');
  if (!form.roomId) return ElMessage.warning('请选择可用房间');
  if (nights.value <= 0) return ElMessage.warning('离店日期必须晚于入住日期');
  saving.value = true;
  try {
    const payload = {
      guestId: form.guestId,
      roomId: form.roomId,
      checkInDate: form.checkInDate,
      checkOutDate: form.checkOutDate,
      remark: form.remark
    };
    if (editing.value) await http.put(`/reservations/${editing.value.id}`, payload);
    else await http.post('/reservations', payload);
    ElMessage.success(editing.value ? '订单已更新' : '预订已创建');
    dialog.value = false;
    await load();
  } finally {
    saving.value = false;
  }
};

const doCheckin = async (row) => {
  try {
    await ElMessageBox.confirm(`确认为「${row.guestName}」办理房间 ${row.roomNo} 入住吗？`, '办理入住', { type: 'info' });
  } catch { return; }
  await http.post(`/reservations/${row.id}/checkin`);
  ElMessage.success('入住办理成功，房间已置为在住');
  await load();
};

const openCheckout = (row) => {
  checkoutRow.value = row;
  checkoutForm.paymentMethod = 'CASH';
  checkoutDialog.value = true;
};

const doCheckout = async () => {
  saving.value = true;
  try {
    await http.post(`/reservations/${checkoutRow.value.id}/checkout`, { paymentMethod: checkoutForm.paymentMethod });
    ElMessage.success('退房完成，账单已生成');
    checkoutDialog.value = false;
    await load();
  } finally {
    saving.value = false;
  }
};

const doCancel = async (row) => {
  try {
    await ElMessageBox.confirm(`确定取消订单 ${row.code} 吗？`, '取消预订', { type: 'warning' });
  } catch { return; }
  await http.post(`/reservations/${row.id}/cancel`);
  ElMessage.success('订单已取消');
  await load();
};

const day = (v) => (v ? String(v).slice(0, 10) : '-');
const money = (v) => `¥${Number(v ?? 0).toLocaleString()}`;

onMounted(async () => {
  await loadBase();
  await load();
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2>预订与入住</h2>
        <p>新建预订 → 办理入住 → 退房结算，房间状态自动流转</p>
      </div>
      <el-button type="primary" @click="openCreate">新建预订</el-button>
    </div>

    <div class="toolbar">
      <el-select v-model="statusFilter" placeholder="全部状态" clearable style="width: 150px">
        <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <el-input v-model="keyword" placeholder="搜索订单号 / 客人 / 手机号 / 房间" clearable style="width: 280px" />
      <el-button @click="load">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="list" stripe class="card-table">
      <el-table-column prop="code" label="订单号" width="180" />
      <el-table-column label="客人" width="150">
        <template #default="{ row }">
          <div class="cell-main">{{ row.guestName }}</div>
          <div class="cell-sub">{{ row.guestPhone }}</div>
        </template>
      </el-table-column>
      <el-table-column label="房间" width="130">
        <template #default="{ row }">
          <div class="cell-main">{{ row.roomNo }}</div>
          <div class="cell-sub">{{ row.typeName }}</div>
        </template>
      </el-table-column>
      <el-table-column label="入住 / 离店" width="200">
        <template #default="{ row }">
          <div class="cell-main">{{ day(row.checkInDate) }}</div>
          <div class="cell-sub">至 {{ day(row.checkOutDate) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="金额" width="110">
        <template #default="{ row }"><span class="price">{{ money(row.totalAmount) }}</span></template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="statusType[row.status]" effect="light" round>{{ statusText[row.status] }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="230" fixed="right">
        <template #default="{ row }">
          <template v-if="row.status === 'BOOKED'">
            <el-button link type="success" @click="doCheckin(row)">入住</el-button>
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="doCancel(row)">取消</el-button>
          </template>
          <template v-else-if="row.status === 'CHECKED_IN'">
            <el-button link type="warning" @click="openCheckout(row)">退房结算</el-button>
          </template>
          <span v-else class="muted" style="font-size: 12px">已完成</span>
        </template>
      </el-table-column>
      <template #empty><el-empty description="暂无订单，点击右上角新建预订" :image-size="70" /></template>
    </el-table>

    <el-dialog v-model="dialog" :title="editing ? '编辑预订' : '新建预订'" width="540px">
      <el-form label-width="88px">
        <el-form-item label="客人" required>
          <el-select v-model="form.guestId" placeholder="选择客人" filterable style="width: 100%">
            <el-option v-for="g in guests" :key="g.id" :label="`${g.name}${g.phone ? ' · ' + g.phone : ''}`" :value="g.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="房型" required>
          <el-select v-model="form.typeId" placeholder="选择房型" style="width: 100%">
            <el-option v-for="t in types" :key="t.id" :label="`${t.name}（¥${Number(t.price).toLocaleString()} / 晚）`" :value="t.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="入住日期" required>
          <el-date-picker v-model="form.checkInDate" type="date" value-format="YYYY-MM-DD" placeholder="选择入住日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="离店日期" required>
          <el-date-picker v-model="form.checkOutDate" type="date" value-format="YYYY-MM-DD" placeholder="选择离店日期" style="width: 100%" />
        </el-form-item>
        <el-form-item label="可用房间" required>
          <el-select v-model="form.roomId" placeholder="先选择房型和日期" :loading="roomLoading" style="width: 100%">
            <el-option v-for="r in availableRooms" :key="r.id" :label="`${r.no} 号房 · ${r.floor} 层`" :value="r.id" />
          </el-select>
          <div class="muted" style="font-size: 12px; line-height: 1.6; margin-top: 4px">
            仅展示所选日期区间内空闲且未被占用的房间
          </div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="特殊要求等" />
        </el-form-item>
        <el-form-item label="预计金额">
          <div class="amount-preview">
            <b>{{ money(estimate) }}</b>
            <span class="muted">共 {{ nights }} 晚 × {{ money(selectedType?.price) }}</span>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="checkoutDialog" title="退房结算" width="420px">
      <div v-if="checkoutRow" class="checkout-box">
        <p><span class="muted">订单号</span> {{ checkoutRow.code }}</p>
        <p><span class="muted">客人</span> {{ checkoutRow.guestName }}</p>
        <p><span class="muted">房间</span> {{ checkoutRow.roomNo }} · {{ checkoutRow.typeName }}</p>
        <p><span class="muted">应结金额</span> <b class="price">{{ money(checkoutRow.totalAmount) }}</b></p>
      </div>
      <el-form label-width="80px" style="margin-top: 12px">
        <el-form-item label="支付方式">
          <el-radio-group v-model="checkoutForm.paymentMethod">
            <el-radio v-for="p in payOptions" :key="p.value" :label="p.label" :value="p.value" />
          </el-radio-group>
        </el-form-item>
      </el-form>
      <p class="muted" style="font-size: 12px">退房后房间自动置为「待清洁」，账单写入营收记录。</p>
      <template #footer>
        <el-button @click="checkoutDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="doCheckout">确认退房</el-button>
      </template>
    </el-dialog>
  </div>
</template>
