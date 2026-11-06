<template>
  <view class="gc-brand-logo" :class="{ 'gc-brand-logo--loaded': loaded }">
    <!-- 本地 Logo 先垫底：远程 Logo 加载前不会出现白块 -->
    <image
      class="gc-brand-logo__img gc-brand-logo__fallback"
      :src="fallback"
      :mode="mode"
    />
    <image
      v-if="src"
      :key="src"
      class="gc-brand-logo__img gc-brand-logo__remote"
      :src="src"
      :mode="mode"
      @load="onLoad"
      @error="onError"
    />
  </view>
</template>

<script setup>
import { ref, watch } from 'vue'

defineOptions({ name: 'GcBrandLogo' })

const props = defineProps({
  /** 平台后台上传的远程 Logo；为空时只显示 fallback */
  src: { type: String, default: '' },
  /** 包内兜底 Logo，必须能立即渲染，不能是网络地址 */
  fallback: { type: String, default: '/static/images/logo.png' },
  mode: { type: String, default: 'aspectFit' },
})

const loaded = ref(false)

function onLoad() {
  loaded.value = true
}

function onError() {
  loaded.value = false
}

// 品牌 Logo 变化（例如品牌接口返回）时先回到本地兜底，避免旧图 / 白块
watch(
  () => props.src,
  () => {
    loaded.value = false
  }
)
</script>

<style scoped lang="scss">
.gc-brand-logo {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  overflow: hidden;
  /* 尺寸与圆角由外层容器决定，这里继承，避免图片直角溢出 */
  border-radius: inherit;
}

.gc-brand-logo__img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.gc-brand-logo__fallback {
  z-index: 0;
  opacity: 1;
}

.gc-brand-logo__remote {
  z-index: 1;
  opacity: 0;
}

/* 不要做交叉淡入：两层同时半透明时，底层 Logo 会透出背景色，表现为「变白」。
 * 远程图触发 load 时已经解码完成，直接整帧切换即可。 */
.gc-brand-logo--loaded .gc-brand-logo__fallback {
  opacity: 0;
}

.gc-brand-logo--loaded .gc-brand-logo__remote {
  opacity: 1;
}
</style>
