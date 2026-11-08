import axios from 'axios';
import { ElMessage } from 'element-plus';

const http = axios.create({ baseURL: '/api', timeout: 20000 });

http.interceptors.request.use(config => {
  const token = localStorage.getItem('hotel-token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  res => res.data,
  err => {
    const msg = err.response?.data?.error || err.message || '请求失败';
    if (err.response?.status === 401) {
      localStorage.removeItem('hotel-token');
      localStorage.removeItem('hotel-user');
      if (location.hash !== '#/login') location.hash = '#/login';
    }
    ElMessage.error(msg);
    return Promise.reject(new Error(msg));
  }
);

export default http;
