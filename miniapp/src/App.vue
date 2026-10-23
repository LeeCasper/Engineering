<script>
export default {
  onLaunch() {
    // 登录页是入口；不在这里做静默跳转 ——
    // 用户可能是第一次打开，也可能是被邀请后回来确认。
    // 由登录页根据 /projects 的结果决定去邀请列表还是项目列表。
    // 角色由管理员邀请时固定，不在登录主路径上；登录后直接按项目成员关系进入。
  },
}
</script>

<style lang="scss">
@import './styles/admin.scss';

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


/* 底部弹窗入场：从底部抬起，轻微淡入。下滑手势的 transform 在动画结束后接管。 */
@keyframes sheet-rise {
  from {
    transform: translateY(100%);
    opacity: 0.65;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.sheet {
  animation: sheet-rise 260ms cubic-bezier(0.22, 0.61, 0.36, 1);
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
}
</style>