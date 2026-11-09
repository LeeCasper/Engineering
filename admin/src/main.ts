import { createApp } from 'vue';
import './plugins/assets';
import './plugins/ui';
import { setupAppVersionNotification, setupDayjs, setupIconifyOffline, setupLoading, setupNProgress } from './plugins';
import { setupStore } from './store';
import { useBrandingStore } from './store/modules/branding';
import { setupRouter } from './router';
import { setupI18n } from './locales';
import App from './App.vue';

async function setupApp() {
  setupLoading();

  setupNProgress();

  setupIconifyOffline();

  setupDayjs();

  const app = createApp(App);

  const pinia = setupStore(app);

  // 必须在路由挂载前加载：标题守卫首次执行时要用品牌名称，
  // 否则会先写一遍默认名称，之后不再自动修正。
  const brandingStore = useBrandingStore(pinia);
  await brandingStore.load();

  await setupRouter(app);

  setupI18n(app);

  setupAppVersionNotification();

  app.mount('#app');
}

setupApp();
