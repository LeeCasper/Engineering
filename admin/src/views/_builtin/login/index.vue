<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { getPaletteColorByNumber, mixColor } from '@sa/color';
import { useThemeStore } from '@/store/modules/theme';
import { useBrandingStore } from '@/store/modules/branding';
import PwdLogin from './modules/pwd-login.vue';

defineOptions({ name: 'LoginPage' });

const route = useRoute();
const themeStore = useThemeStore();
const branding = useBrandingStore();

/**
 * 租户专属登录地址 `/t/:tenantCode/login` 与平台入口 `/login`
 * 共用这个页面组件，靠路由参数区分门户。租户标识不再让用户手工输入 ——
 * 它来自平台开通租户时生成的地址，输错地址就不该能登录。
 */
const tenantCode = computed(() => String(route.params.tenantCode || ''));
const isTenantPortal = computed(() => Boolean(tenantCode.value));

const bgThemeColor = computed(() =>
  themeStore.darkMode ? getPaletteColorByNumber(themeStore.themeColor, 600) : themeStore.themeColor
);

const bgColor = computed(() => {
  const COLOR_WHITE = '#ffffff';

  const ratio = themeStore.darkMode ? 0.5 : 0.2;

  return mixColor(COLOR_WHITE, themeStore.themeColor, ratio);
});
</script>

<template>
  <div class="relative size-full flex-center overflow-hidden" :style="{ backgroundColor: bgColor }">
    <WaveBg :theme-color="bgThemeColor" />
    <ElCard class="relative z-4 w-auto rd-12px">
      <div class="w-420px lt-sm:w-320px">
        <header class="relative flex-col items-center">
          <ThemeSchemaSwitch
            :theme-schema="themeStore.themeScheme"
            :show-tooltip="false"
            class="absolute right-0 top-0 text-20px"
            @switch="themeStore.toggleThemeScheme"
          />
          <SystemLogo class="size-64px lt-sm:size-52px" :src="branding.logoUrl" />
          <h2 class="max-w-full truncate px-4 pt-10px text-26px text-primary font-600 lt-sm:text-22px">
            {{ branding.name }}
          </h2>
          <p class="pt-4px text-13px text-#86909c">
            {{ isTenantPortal ? '租户管理员登录' : '平台运营登录' }}
          </p>
          <ElTag v-if="isTenantPortal" class="mt-10px" type="info" effect="plain">
            租户标识：{{ tenantCode }}
          </ElTag>
        </header>

        <main class="pt-28px">
          <PwdLogin :tenant-code="tenantCode" />
        </main>

        <footer class="pt-20px text-center text-12px text-#86909c">
          {{ branding.name }} · 让装修工程更透明、更可控
        </footer>
      </div>
    </ElCard>
  </div>
</template>

<style scoped></style>
