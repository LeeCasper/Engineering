<script setup lang="ts">
import { ref, watch } from 'vue';

defineOptions({ name: 'SystemLogo' });

const props = defineProps<{
  /** 平台后台上传的 Logo；为空或加载失败时回落到内置 SVG */
  src?: string;
}>();

const failed = ref(false);

watch(
  () => props.src,
  () => {
    failed.value = false;
  }
);
</script>

<template>
  <div class="app-logo">
    <img v-if="src && !failed" :src="src" class="app-logo-img" alt="" @error="failed = true" />
    <svg v-else width="100%" height="100%" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gc-logo-gradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#2575FC" />
          <stop offset="100%" stop-color="#165DFF" />
        </linearGradient>
      </defs>
      <rect width="96" height="96" rx="22" fill="url(#gc-logo-gradient)" />
      <path
        transform="translate(24,24) scale(2)"
        fill="#fff"
        d="M12 2L2 9.5V20C2 21.1 2.9 22 4 22H20C21.1 22 22 21.1 22 20V9.5L12 2ZM14.5 19H9.5V14H14.5V19ZM19.5 19H16.5V13C16.5 12.45 16.05 12 15.5 12H8.5C7.95 12 7.5 12.45 7.5 13V19H4.5V10.45L12 4.83L19.5 10.45V19Z"
      />
    </svg>
  </div>
</template>

<style scoped>
.app-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.app-logo-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 8px;
}
</style>
