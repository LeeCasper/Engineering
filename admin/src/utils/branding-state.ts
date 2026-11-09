import { ref } from 'vue';

const DEFAULT_NAME = import.meta.env.VITE_APP_TITLE || '工程宝管理后台';

/**
 * 全局品牌状态。
 *
 * ── 为什么不直接让标题工具 import Pinia store ──
 * 标题守卫在 router 初始化时加载，而 branding store 依赖请求层，
 * 请求层又依赖 auth store → router。直接引用会形成
 * router → guard → document-title → store → request → auth → router 的环。
 * 这里只放三个 ref，store 负责加载并写入，标题工具和展示组件直接读 ref。
 */
export const brandingState = {
  name: ref(DEFAULT_NAME),
  logoUrl: ref(''),
  faviconUrl: ref('')
};
