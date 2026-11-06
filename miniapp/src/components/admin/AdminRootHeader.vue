<template>
  <view
    class="root-header"
    :class="{ 'root-header--glass': glass }"
    :style="{
      paddingTop: `${safeTop + 6}px`,
      paddingRight: rightInset ? `${rightInset}px` : undefined,
      background: glass ? undefined : background,
    }"
  >
    <view class="root-header-row">
      <view v-if="back" class="root-back" @tap="onBack">
        <image class="root-back-icon" src="/static/images/icon-back.png" mode="aspectFit" />
      </view>
      <view class="root-title-wrap">
        <text class="root-title">{{ title }}</text>
        <text v-if="subtitle" class="root-subtitle">{{ subtitle }}</text>
      </view>
      <view class="root-right">
        <slot name="right" />
      </view>
    </view>
  </view>
</template>

<script setup>
import { adminBack } from '../../utils/admin'
import { useCapsuleInsets } from '../../composables/useCapsuleInsets'

defineOptions({ name: 'AdminRootHeader' })

const props = defineProps({
  title: { type: String, default: '管理端' },
  subtitle: { type: String, default: '' },
  back: { type: Boolean, default: false },
  fallback: { type: String, default: '/pages/admin/home/index' },
  // 嵌在壳页里的视图不能用 navigateBack（页面栈里是壳页和登录页）；
  // 置 true 时不自己导航，改为抛 back 事件由父组件决定去向。
  // 不要用函数 prop：小程序自定义组件之间无法传递函数。
  backCustom: { type: Boolean, default: false },
  background: { type: String, default: '#F6F7F9' },
  // 吸顶时用液态玻璃，让滚动内容从标题下方透出；表单类页面保持纯色更稳
  glass: { type: Boolean, default: false },
})

const emit = defineEmits(['back'])

const { statusBarHeight: safeTop, rightInset } = useCapsuleInsets()

function onBack() {
  if (props.backCustom) {
    emit('back')
    return
  }
  adminBack(props.fallback)
}
</script>

<style scoped lang="scss">
.root-header {
  position: sticky;
  top: 0;
  z-index: 40;
  padding-right: dp(16);
  padding-bottom: dp(6);
  padding-left: dp(16);
}

.root-header--glass {
  background: linear-gradient(
    180deg,
    rgba(246, 247, 249, 0.92) 0%,
    rgba(246, 247, 249, 0.68) 100%
  );
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  backdrop-filter: blur(22px) saturate(180%);
  border-bottom: 1px solid rgba(255, 255, 255, 0.62);
  box-shadow:
    0 dp(6) dp(18) rgba(29, 33, 41, 0.04),
    inset 0 -1px 0 rgba(255, 255, 255, 0.4);
}

.root-header-row {
  display: flex;
  align-items: center;
  min-height: dp(52);
}

.root-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(34);
  height: dp(34);
  margin-left: dp(-8);
  margin-right: dp(2);
  flex-shrink: 0;
}

.root-back-icon {
  width: dp(20);
  height: dp(20);
}

.root-title-wrap {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
}

.root-title {
  overflow: hidden;
  color: #1d2129;
  font-size: dp(24);
  font-weight: 800;
  line-height: 1.2;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.root-subtitle {
  margin-top: dp(3);
  overflow: hidden;
  color: #86909c;
  font-size: dp(12);
  line-height: 1.3;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.root-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-left: dp(10);
  flex-shrink: 0;
}
</style>
