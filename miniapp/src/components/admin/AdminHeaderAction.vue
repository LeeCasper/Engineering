<template>
  <view
    class="admin-header-action"
    :class="[
      `admin-header-action--${variant}`,
      { 'admin-header-action--disabled': disabled },
    ]"
    @tap.stop="onTap"
  >
    <text v-if="prefix" class="admin-header-action-prefix">{{ prefix }}</text>
    <slot>
      <text v-if="label" class="admin-header-action-label">{{ label }}</text>
    </slot>
  </view>
</template>

<script setup>
defineOptions({ name: 'AdminHeaderAction' })

const props = defineProps({
  label: { type: String, default: '' },
  // 「+ 邀请成员」这类文字前缀；不传就只渲染 label
  prefix: { type: String, default: '' },
  // pill：文字胶囊；icon：圆形图标按钮（详情页「更多」）
  variant: { type: String, default: 'pill' },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['tap'])

function onTap() {
  if (props.disabled) return
  emit('tap')
}
</script>

<style scoped lang="scss">
/**
 * 管理端顶部右侧动作统一材质。
 *
 * 之前各页各写一套：有的只有橙色文字，有的是浅橙胶囊，宽高与圆角都不一致。
 * 这里以「编辑项目」的浅橙玻璃胶囊为基准，所有页面的顶部动作都复用本组件。
 */
.admin-header-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: dp(30);
  padding: 0 dp(12);
  border: 1px solid rgba(255, 255, 255, 0.76);
  border-radius: dp(999);
  background: linear-gradient(
    135deg,
    rgba(255, 243, 236, 0.94) 0%,
    rgba(255, 227, 214, 0.74) 100%
  );
  -webkit-backdrop-filter: blur(14px) saturate(170%);
  backdrop-filter: blur(14px) saturate(170%);
  color: #eb5c20;
  font-size: dp(12);
  font-weight: 600;
  white-space: nowrap;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.admin-header-action:active {
  background: linear-gradient(
    135deg,
    rgba(255, 236, 226, 0.98) 0%,
    rgba(255, 218, 201, 0.9) 100%
  );
}

.admin-header-action--icon {
  width: dp(30);
  height: dp(30);
  padding: 0;
  border-radius: 50%;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.92) 0%,
    rgba(255, 255, 255, 0.68) 100%
  );
  box-shadow:
    0 dp(2) dp(8) rgba(29, 33, 41, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.admin-header-action--disabled {
  opacity: 0.45;
}

.admin-header-action-prefix {
  margin-right: dp(4);
  font-size: dp(14);
  font-weight: 500;
  line-height: 1;
}

.admin-header-action-label {
  line-height: 1;
}
</style>
