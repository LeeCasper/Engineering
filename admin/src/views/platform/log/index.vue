<script setup lang="ts">
import { ref } from 'vue';
import OperationLogPage from '@/views/log/operation/index.vue';
import LoginLogPage from '@/views/log/login/index.vue';

defineOptions({ name: 'PlatformLogPage' });

const activeTab = ref('operation');
</script>

<template>
  <div class="pt-16px">
    <ElTabs v-model="activeTab" class="px-16px">
      <ElTabPane label="平台操作日志" name="operation" lazy>
        <OperationLogPage scope="platform" />
      </ElTabPane>
      <ElTabPane label="平台登录日志" name="login" lazy>
        <LoginLogPage scope="platform" />
      </ElTabPane>
    </ElTabs>
  </div>
</template>
