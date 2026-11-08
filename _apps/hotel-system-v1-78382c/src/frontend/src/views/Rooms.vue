<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../api';

const loading = ref(false);
const list = ref([]);
const types = ref([]);
const statusFilter = ref('');
const typeFilter = ref(null);

const dialog = ref(false);
const saving = ref(false);
const editing = ref(null);
const form = ref({ no: '', floor: 1, typeId: null });

const statusMeta = {
  IDLE: { text: '空闲', type: 'success' },
  OCCUPIED: { text: '在住', type: 'warning' },
  CLEANING: { text: '待清洁', type: 'info' },
  MAINTENANCE: { text: '维修中', type: 'danger' }
};
const statusOptions = Object.entries(statusMeta).map(([value, m]) => ({ value, label: m.text }));

const typeName = computed(() => {
  const map = {};
  types.value.forEach(t => { map[t.id] = t; });
  return map;
});

const filtered = computed(() => list.value.filter(r =>
  (!statusFilter.value || r.status === statusFilter.value) &&
  (!typeFilter.value || r.typeId === typeFilter.value)
));

const counts = computed(() => {
  const c = { IDLE: 0, OCCUPIED: 0, CLEANING: 0, MAINTENANCE: 0 };
  list.value.forEach(r => { if (c[r.status] != null) c[r.status]++; });
  return c;
});

const load = async () => {
  loading.value = true;
  try {
    const [rooms, roomTypes] = await Promise.all([http.get('/rooms'), http.get('/room-types')]);
    list.value = rooms;
    types.value = roomTypes;
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  editing.value = null;
  form.value = { no: '', floor: 1, typeId: types.value[0]?.id ?? null };
  dialog.value = true;
};

const openEdit = (row) => {
  editing.value = row;
  form.value = { no: row.no, floor: row.floor, typeId: row.typeId };
  dialog.value = true;
};

const save = async () => {
  if (!form.value.no?.trim()) return ElMessage.warning('请填写房间号');
  if (!form.value.typeId) return ElMessage.warning('请选择房型');
  saving.value = true;
  try {
    const payload = { no: form.value.no.trim(), floor: Number(form.value.floor), typeId: form.value.typeId };
    if (editing.value) await http.put(`/rooms/${editing.value.id}`, payload);
    else await http.post('/rooms', payload);
    ElMessage.success(editing.value ? '房间已更新' : '房间已创建');
    dialog.value = false;
    await load();
  } finally {
    saving.value = false;
  }
};

const changeStatus = async (row, status) => {
  await http.put(`/rooms/${row.id}/status`, { status });
  ElMessage.success(`房间 ${row.no} 状态已改为「${statusMeta[status].text}」`);
  await load();
};

const remove = async (row) => {
  try {
    await ElMessageBox.confirm(`确定删除房间 ${row.no} 吗？`, '删除确认', { type: 'warning' });
  } catch { return; }
  await http.delete(`/rooms/${row.id}`);
  ElMessage.success('已删除');
  await load();
};

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2>房间管理</h2>
        <p>共 {{ list.length }} 间房 · 空闲 {{ counts.IDLE }} / 在住 {{ counts.OCCUPIED }} / 待清洁 {{ counts.CLEANING }} / 维修 {{ counts.MAINTENANCE }}</p>
      </div>
      <el-button type="primary" @click="openCreate">新增房间</el-button>
    </div>

    <div class="toolbar">
      <el-select v-model="statusFilter" placeholder="全部状态" clearable style="width: 150px">
        <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
      </el-select>
      <el-select v-model="typeFilter" placeholder="全部房型" clearable style="width: 160px">
        <el-option v-for="t in types" :key="t.id" :label="t.name" :value="t.id" />
      </el-select>
      <el-button @click="load">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="filtered" stripe class="card-table">
      <el-table-column prop="no" label="房间号" width="110">
        <template #default="{ row }"><b>{{ row.no }}</b></template>
      </el-table-column>
      <el-table-column prop="floor" label="楼层" width="90">
        <template #default="{ row }">{{ row.floor }} 层</template>
      </el-table-column>
      <el-table-column label="房型" min-width="130">
        <template #default="{ row }">{{ typeName[row.typeId]?.name || '未知房型' }}</template>
      </el-table-column>
      <el-table-column label="单价" width="110">
        <template #default="{ row }">
          <span class="price">¥{{ Number(typeName[row.typeId]?.price || 0).toLocaleString() }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="statusMeta[row.status]?.type || 'info'" effect="light" round>
            {{ statusMeta[row.status]?.text || row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="250" fixed="right">
        <template #default="{ row }">
          <el-dropdown trigger="click" @command="(s) => changeStatus(row, s)">
            <el-button link type="primary">改状态</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item v-for="s in statusOptions" :key="s.value" :command="s.value" :disabled="row.status === s.value">
                  {{ s.label }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty><el-empty description="暂无房间" :image-size="70" /></template>
    </el-table>

    <el-dialog v-model="dialog" :title="editing ? '编辑房间' : '新增房间'" width="440px">
      <el-form label-width="80px">
        <el-form-item label="房间号" required>
          <el-input v-model="form.no" placeholder="如：501" />
        </el-form-item>
        <el-form-item label="楼层" required>
          <el-input-number v-model="form.floor" :min="0" :max="60" style="width: 100%" />
        </el-form-item>
        <el-form-item label="房型" required>
          <el-select v-model="form.typeId" placeholder="选择房型" style="width: 100%">
            <el-option v-for="t in types" :key="t.id" :label="`${t.name}（¥${Number(t.price).toLocaleString()} / 晚）`" :value="t.id" />
          </el-select>
        </el-form-item>
        <p class="muted" style="font-size: 12px; margin: 0 0 0 80px">新房间默认为「空闲」状态，可在列表中修改。</p>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
