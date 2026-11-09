import type { App } from 'vue';
import { createPinia } from 'pinia';
import { resetSetupStore } from './plugins';

/** Setup Vue store plugin pinia */
export function setupStore(app: App) {
  const store = createPinia();

  store.use(resetSetupStore);

  app.use(store);

  // 返回 pinia，便于在组件外（main.ts 启动阶段）使用 store
  return store;
}
