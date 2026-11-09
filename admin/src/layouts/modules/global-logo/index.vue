<script setup lang="ts">
import { useBrandingStore } from '@/store/modules/branding';

defineOptions({ name: 'GlobalLogo' });

const branding = useBrandingStore();

interface Props {
  /** Whether to show the title */
  showTitle?: boolean;
}

withDefaults(defineProps<Props>(), {
  showTitle: true
});
</script>

<template>
  <RouterLink to="/" class="w-full flex-center nowrap-hidden">
    <SystemLogo class="size-32px" :src="branding.logoUrl" />
    <h2
      v-show="showTitle"
      class="min-w-0 truncate pl-8px text-16px text-primary font-bold transition duration-300 ease-in-out"
      :title="branding.name"
    >
      {{ branding.name }}
    </h2>
  </RouterLink>
</template>

<style scoped></style>
