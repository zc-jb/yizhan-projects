const TOKEN_KEY = 'lib_token';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers['X-Token'] = token;

  const res = await fetch('api' + path, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    throw new Error('登录已失效，请重新登录');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || '请求失败');
  return data;
}

export const api = {
  login: (body) => request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  stats: () => request('/stats'),
  books: (params = {}) => request('/books?' + new URLSearchParams(params)),
  createBook: (body) => request('/books', { method: 'POST', body: JSON.stringify(body) }),
  updateBook: (id, body) => request('/books/' + id, { method: 'PUT', body: JSON.stringify(body) }),
  deleteBook: (id) => request('/books/' + id, { method: 'DELETE' }),
  categories: () => request('/categories'),
  createCategory: (body) => request('/categories', { method: 'POST', body: JSON.stringify(body) }),
  updateCategory: (id, body) => request('/categories/' + id, { method: 'PUT', body: JSON.stringify(body) }),
  deleteCategory: (id) => request('/categories/' + id, { method: 'DELETE' }),
  readers: (params = {}) => request('/readers?' + new URLSearchParams(params)),
  createReader: (body) => request('/readers', { method: 'POST', body: JSON.stringify(body) }),
  updateReader: (id, body) => request('/readers/' + id, { method: 'PUT', body: JSON.stringify(body) }),
  deleteReader: (id) => request('/readers/' + id, { method: 'DELETE' }),
  borrows: (status = 'all') => request('/borrows?status=' + status),
  borrow: (body) => request('/borrows', { method: 'POST', body: JSON.stringify(body) }),
  giveBack: (id) => request('/borrows/' + id + '/return', { method: 'POST' }),
};
