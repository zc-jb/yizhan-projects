<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../api';

const loading = ref(false);
const list = ref([]);
const rooms = ref([]);
const dialog = ref(false);
const saving = ref(false);
const editing = ref(null);
const form = ref({ name: '', price: 199, capacity: 2, bedType: '', description: '' });

const roomCount = computed(() => {
  const map = {};
  rooms.value.forEach(r => { map[r.typeId] = (map[r.typeId] || 0) + 1; });
  return map;
});

const load = async () => {
  loading.value = true;
  try {
    const [types, roomList] = await Promise.all([http.get('/room-types'), http.get('/rooms')]);
    list.value = types;
    rooms.value = roomList;
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  editing.value = null;
  form.value = { name: '', price: 199, capacity: 2, bedType: '', description: '' };
  dialog.value = true;
};

const openEdit = (row) => {
  editing.value = row;
  form.value = { ...row };
  dialog.value = true;
};

const save = async () => {
  if (!form.value.name?.trim()) return ElMessage.warning('请填写房型名称');
  if (Number(form.value.price) <= 0) return ElMessage.warning('价格必须大于 0');
  if (Number(form.value.capacity) <= 0) return ElMessage.warning('可住人数必须大于 0');
  saving.value = true;
  try {
    const payload = {
      name: form.value.name.trim(),
      price: Number(form.value.price),
      capacity: Number(form.value.capacity),
      bedType: form.value.bedType,
      description: form.value.description
    };
    if (editing.value) await http.put(`/room-types/${editing.value.id}`, payload);
    else await http.post('/room-types', payload);
    ElMessage.success(editing.value ? '房型已更新' : '房型已创建');
    dialog.value = false;
    await load();
  } finally {
    saving.value = false;
  }
};

const remove = async (row) => {
  try {
    await ElMessageBox.confirm(`确定删除房型「${row.name}」吗？`, '删除确认', { type: 'warning' });
  } catch { return; }
  await http.delete(`/room-types/${row.id}`);
  ElMessage.success('已删除');
  await load();
};

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2>房型管理</h2>
        <p>维护房型价格与容量，房价按「房型单价 × 入住晚数」自动计算</p>
      </div>
      <el-button type="primary" @click="openCreate">新增房型</el-button>
    </div>

    <el-table v-loading="loading" :data="list" stripe class="card-table">
      <el-table-column prop="name" label="房型名称" min-width="140" />
      <el-table-column label="单价 / 晚" width="130">
        <template #default="{ row }"><span class="price">¥{{ Number(row.price).toLocaleString() }}</span></template>
      </el-table-column>
      <el-table-column prop="capacity" label="可住人数" width="110" />
      <el-table-column prop="bedType" label="床型" width="150" />
      <el-table-column label="房间数" width="100">
        <template #default="{ row }">{{ roomCount[row.id] || 0 }}</template>
      </el-table-column>
      <el-table-column prop="description" label="说明" min-width="200" show-overflow-tooltip />
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty><el-empty description="暂无房型" :image-size="70" /></template>
    </el-table>

    <el-dialog v-model="dialog" :title="editing ? '编辑房型' : '新增房型'" width="480px">
      <el-form label-width="90px">
        <el-form-item label="房型名称" required>
          <el-input v-model="form.name" placeholder="如：标准间 / 豪华间" />
        </el-form-item>
        <el-form-item label="单价 / 晚" required>
          <el-input-number v-model="form.price" :min="1" :step="20" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="可住人数" required>
          <el-input-number v-model="form.capacity" :min="1" :max="10" style="width: 100%" />
        </el-form-item>
        <el-form-item label="床型">
          <el-input v-model="form.bedType" placeholder="如：1.8m 大床 / 双床" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.description" type="textarea" :rows="2" maxlength="200" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
