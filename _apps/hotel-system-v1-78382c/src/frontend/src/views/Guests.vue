<script setup>
import { onMounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../api';

const loading = ref(false);
const list = ref([]);
const keyword = ref('');

const dialog = ref(false);
const saving = ref(false);
const editing = ref(null);
const form = ref({ name: '', phone: '', idCard: '', gender: '男', remark: '' });

const load = async () => {
  loading.value = true;
  try {
    list.value = await http.get('/guests', { params: keyword.value ? { q: keyword.value } : {} });
  } finally {
    loading.value = false;
  }
};

let timer = null;
watch(keyword, () => {
  clearTimeout(timer);
  timer = setTimeout(load, 400);
});

const openCreate = () => {
  editing.value = null;
  form.value = { name: '', phone: '', idCard: '', gender: '男', remark: '' };
  dialog.value = true;
};

const openEdit = (row) => {
  editing.value = row;
  form.value = { name: row.name, phone: row.phone, idCard: row.idCard, gender: row.gender || '男', remark: row.remark };
  dialog.value = true;
};

const save = async () => {
  if (!form.value.name?.trim()) return ElMessage.warning('请填写客人姓名');
  saving.value = true;
  try {
    const payload = { ...form.value, name: form.value.name.trim() };
    if (editing.value) await http.put(`/guests/${editing.value.id}`, payload);
    else await http.post('/guests', payload);
    ElMessage.success(editing.value ? '客人信息已更新' : '客人已登记');
    dialog.value = false;
    await load();
  } finally {
    saving.value = false;
  }
};

const remove = async (row) => {
  try {
    await ElMessageBox.confirm(`确定删除客人「${row.name}」吗？`, '删除确认', { type: 'warning' });
  } catch { return; }
  await http.delete(`/guests/${row.id}`);
  ElMessage.success('已删除');
  await load();
};

const fmt = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '-');

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2>客人管理</h2>
        <p>共 {{ list.length }} 位客人 · 预订时可直接选择已登记客人</p>
      </div>
      <el-button type="primary" @click="openCreate">登记客人</el-button>
    </div>

    <div class="toolbar">
      <el-input v-model="keyword" placeholder="搜索姓名 / 手机号" clearable style="width: 240px" />
      <el-button @click="load">刷新</el-button>
    </div>

    <el-table v-loading="loading" :data="list" stripe class="card-table">
      <el-table-column prop="name" label="姓名" width="110">
        <template #default="{ row }"><b>{{ row.name }}</b></template>
      </el-table-column>
      <el-table-column prop="gender" label="性别" width="80" />
      <el-table-column prop="phone" label="手机号" width="140" />
      <el-table-column prop="idCard" label="证件号" min-width="190" show-overflow-tooltip />
      <el-table-column prop="remark" label="备注" min-width="180" show-overflow-tooltip />
      <el-table-column label="登记时间" width="170">
        <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty><el-empty description="暂无客人，点击右上角登记" :image-size="70" /></template>
    </el-table>

    <el-dialog v-model="dialog" :title="editing ? '编辑客人' : '登记客人'" width="480px">
      <el-form label-width="80px">
        <el-form-item label="姓名" required>
          <el-input v-model="form.name" placeholder="请输入姓名" />
        </el-form-item>
        <el-form-item label="性别">
          <el-radio-group v-model="form.gender">
            <el-radio label="男" value="男" />
            <el-radio label="女" value="女" />
          </el-radio-group>
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="form.phone" maxlength="24" placeholder="联系电话" />
        </el-form-item>
        <el-form-item label="证件号">
          <el-input v-model="form.idCard" maxlength="32" placeholder="身份证 / 护照号" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="偏好、特殊要求等" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
