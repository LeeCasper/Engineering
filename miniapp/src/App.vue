<script>
export default {
  onLaunch() {
    // 登录页是入口；不在这里做静默跳转 ——
    // 用户可能是第一次打开，也可能是被邀请后回来确认。
    // 由登录页统一决定去邀请列表、角色选择还是项目列表。
  },
}
</script>

<style lang="scss">
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
</style>
