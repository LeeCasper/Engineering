<script>
/**
 * C 端底栏是自绘的 `ClientTabBar`，原生 tabBar 需要尽早隐藏。
 *
 * 只在组件 onMounted 里隐藏会晚一帧：登录后第一次 reLaunch 到项目页时，
 * 原生白色底栏会先画出来再被隐藏，表现为「闪一下」。因此启动、回前台、
 * 登录跳转前都先隐藏一次，组件挂载再兜底。
 */
function hideNativeTabBar() {
  // 微信端由 custom-tab-bar 原生组件承载，不存在需要隐藏的原生栏；
  // H5 仍是 uni-tabbar，进入页面前先隐藏避免闪。
  // #ifdef H5
  uni.hideTabBar({ animation: false, fail: () => {} })
  // #endif
}

export default {
  onLaunch() {
    // 登录页是入口；不在这里做静默跳转 ——
    // 用户可能是第一次打开，也可能是被邀请后回来确认。
    // 由登录页根据 /projects 的结果决定去邀请列表还是项目列表。
    // 角色由管理员邀请时固定，不在登录主路径上；登录后直接按项目成员关系进入。
    hideNativeTabBar()
  },
  onShow() {
    hideNativeTabBar()
  },
}
</script>

<style lang="scss">
@import './styles/admin.scss';

/* #ifdef H5 */
/* uni.showModal 默认 z-index 999，而管理端底部面板是 1300。
   从成员操作 / 模板编辑等面板里触发的确认框会被面板盖住，导致按钮点不到；
   统一抬高模态层。小程序原生模态在 webview 外，不受影响。 */
.uni-mask {
  z-index: 2000 !important;
}

uni-modal,
.uni-modal {
  z-index: 2001 !important;
}
/* #endif */

page {
  min-height: 100%;
  background: $color-canvas;
  color: $color-ink;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Hiragino Sans GB',
    'Microsoft YaHei', 'WenQuanYi Micro Hei', sans-serif;
  -webkit-font-smoothing: antialiased;
  font-size: dp(15);
  line-height: 1.5;
}

view,
text,
input,
button,
image {
  box-sizing: border-box;
}

button {
  margin: 0;
  padding: 0;
  background: none;
  border: none;
  font-family: inherit;
  line-height: inherit;

  &::after {
    border: none;
  }
}

/* ── 通用组件 ───────────────────────────────────────────── */
.gc-card {
  background: $color-surface;
  border-radius: $radius-lg;
  border: 1px solid $color-hairline;
}

.gc-btn-primary {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(48);
  border-radius: dp(8);
  background: $color-primary;
  color: $color-on-primary;
  font-size: dp(16);
  font-weight: 600;

  &:active {
    background: $color-primary-pressed;
  }
}

.gc-btn-secondary {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(44);
  border-radius: dp(8);
  background: $color-surface;
  color: $color-primary;
  border: 1px solid $color-hairline;
  font-size: dp(15);
  font-weight: 600;
}

.gc-chip {
  display: inline-flex;
  align-items: center;
  padding: dp(2) dp(6);
  border-radius: $radius-xs;
  font-size: dp(11);
  line-height: 1.3;
  background: $color-neutral-soft;
  color: $color-neutral-ink;
}

.gc-chip--primary {
  background: $color-primary-soft;
  color: $color-primary-pressed;
}

.gc-chip--success {
  background: $color-success-soft;
  color: $color-success-ink;
}

.gc-chip--warning {
  background: $color-warning-soft;
  color: $color-warning-ink;
}

.gc-chip--danger {
  background: $color-danger-soft;
  color: $color-danger-ink;
}

.gc-text-secondary {
  color: $color-ink-secondary;
}

.gc-text-tertiary {
  color: $color-ink-tertiary;
}


/* ── 底部弹窗把手 ─────────────────────────────────────────
 * 视觉上仍然是 36×4 的小横条，但把可触摸区域扩大到整条顶部（26px 高）。
 * 否则 4px 的把手在手机上几乎点不中，用户会觉得「下滑关闭没生效」。
 * 各页面自己的 .sheet-handle 样式用 !important 覆盖。
 */
.sheet-handle {
  width: 100% !important;
  height: dp(26) !important;
  margin: 0 auto dp(6) !important;
  border-radius: 0 !important;
  background: linear-gradient(#e8e1da, #e8e1da) center / dp(36) dp(4) no-repeat !important;
}


/* ── 底部弹窗入场 ─────────────────────────────────────────
 * 缓入缓出抬起 → 触底后轻微下坠 → 反向回弹 → 落定。
 * 只动 transform / opacity，不触发布局；结束帧不保留 fill，
 * 否则会长期盖住 useSwipeClose 写入的 inline transform，下滑手势就失效了。
 * 回弹的最大反向位移只有 0.35%（约 2px），不会在底部露出背景缝。
 */
@keyframes sheet-rise {
  0% {
    opacity: 0;
    transform: translateY(100%);
  }
  60% {
    opacity: 1;
    transform: translateY(0);
  }
  74% {
    opacity: 1;
    transform: translateY(1.6%);
  }
  86% {
    opacity: 1;
    transform: translateY(-0.35%);
  }
  94% {
    opacity: 1;
    transform: translateY(0.12%);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

.sheet {
  animation: sheet-rise 480ms cubic-bezier(0.45, 0, 0.25, 1);
}

/* 蒙层同步淡入，避免面板已经在动、背景却瞬间变黑 */
@keyframes sheet-mask-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.sheet-mask {
  animation: sheet-mask-in 220ms ease-out;
}

/* 首次加载的骨架屏容器：页面自己控制上下留白 */
.gc-loading-page {
  padding: dp(16);
}

/* ── 页面模块依次入场 ─────────────────────────────────────
 * 给容器加 .gc-stagger，直接子级会按顺序淡入上浮。
 * 用于卡片列表、内容区模块；不要加到包含固定弹窗 / 遮罩的容器上。
 */
@keyframes gc-reveal-up {
  from {
    opacity: 0;
    transform: translateY(dp(14));
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 独立分类 tab 的选中态：不是连在一起的胶囊，不能用平移，
 * 用「跳入 + 轻微过冲」：从下方缩放入场，到 55% 略放大，再落回原尺寸。
 */
@keyframes gc-tab-pop {
  0% {
    opacity: 0.35;
    transform: translateY(dp(6)) scale(0.82);
  }
  55% {
    opacity: 1;
    transform: translateY(dp(-1)) scale(1.06);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.gc-stagger > view {
  animation: gc-reveal-up 360ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
}

.gc-stagger > view:nth-child(1) {
  animation-delay: 20ms;
}
.gc-stagger > view:nth-child(2) {
  animation-delay: 60ms;
}
.gc-stagger > view:nth-child(3) {
  animation-delay: 100ms;
}
.gc-stagger > view:nth-child(4) {
  animation-delay: 140ms;
}
.gc-stagger > view:nth-child(5) {
  animation-delay: 180ms;
}
.gc-stagger > view:nth-child(6) {
  animation-delay: 220ms;
}
.gc-stagger > view:nth-child(7) {
  animation-delay: 260ms;
}
.gc-stagger > view:nth-child(8) {
  animation-delay: 300ms;
}
.gc-stagger > view:nth-child(n + 9) {
  animation-delay: 340ms;
}

@media (prefers-reduced-motion: reduce) {
  .gc-stagger > view {
    animation: none;
  }

  .tab--active,
  .filter-chip--active {
    animation: none;
  }

  .sheet,
  .sheet-mask,
  .admin-sheet,
  .admin-sheet-mask {
    animation: none;
  }
}
</style>