import { createRouter, createWebHashHistory } from 'vue-router';
import Layout from './components/Layout.vue';
import Login from './views/Login.vue';
import Dashboard from './views/Dashboard.vue';
import RoomTypes from './views/RoomTypes.vue';
import Rooms from './views/Rooms.vue';
import Guests from './views/Guests.vue';
import Reservations from './views/Reservations.vue';
import Bills from './views/Bills.vue';

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/login', component: Login, meta: { public: true } },
    {
      path: '/',
      component: Layout,
      redirect: '/dashboard',
      children: [
        { path: 'dashboard', component: Dashboard, meta: { title: '经营概览' } },
        { path: 'room-types', component: RoomTypes, meta: { title: '房型管理' } },
        { path: 'rooms', component: Rooms, meta: { title: '房间管理' } },
        { path: 'guests', component: Guests, meta: { title: '客人管理' } },
        { path: 'reservations', component: Reservations, meta: { title: '预订与入住' } },
        { path: 'bills', component: Bills, meta: { title: '账单与营收' } }
      ]
    }
  ]
});

router.beforeEach(to => {
  const token = localStorage.getItem('hotel-token');
  if (!to.meta.public && !token) return '/login';
  if (to.path === '/login' && token) return '/dashboard';
  return true;
});

export default router;
