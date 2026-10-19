<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchChangePassword } from '@/service/api';
import { useAuthStore } from '@/store/modules/auth';
import { localStg } from '@/utils/storage';
import { useForm } from '@/hooks/common/form';

defineOptions({ name: 'ChangePasswordPage' });

const authStore = useAuthStore();
const router = useRouter();
const { formRef, validate } = useForm();
const submitting = ref(false);

const forced = computed(() => authStore.userInfo.mustChangePassword);

const model = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
});

const rules = {
  oldPassword: [
    { required: true, message: '请输入原密码', trigger: 'blur' }
  ],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '密码至少 8 位', trigger: 'blur' },
    {
      validator: (_rule: unknown, value: string, callback: (error?: Error) => void) => {
        // 与后端密码策略一致：必须同时包含字母与数字（B-1.6）
        if (value && (!/[A-Za-z]/.test(value) || !/\d/.test(value))) {
          callback(new Error('密码须同时包含字母与数字'));
          return;
        }
        callback();
      },
      trigger: 'blur'
    }
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_rule: unknown, value: string, callback: (error?: Error) => void) => {
        if (value !== model.newPassword) {
          callback(new Error('两次输入的密码不一致'));
          return;
        }
        callback();
      },
      trigger: 'blur'
    }
  ]
};

async function handleSubmit() {
  try {
    await validate();
  } catch {
    return;
  }

  submitting.value = true;

  try {
    const { error } = await fetchChangePassword({
      oldPassword: model.oldPassword,
      newPassword: model.newPassword
    });

    if (error) return;

    window.$message?.success('密码已修改，请使用新密码重新登录');

    // 后端改密会自增 token_version，当前 token 立即失效（AC-AD08）。
    // 这里主动清会话，避免下一次请求被 401 弹回登录页时才让用户发现。
    await authStore.resetStore();

    // 回到**本次使用的门户**，并且不要带上 redirect=/change-password ——
    // 密码刚改完，再被送回改密页只会让人以为没生效。
    // 租户管理员必须回 /t/<code>/login，平台入口会拒绝其账号。
    const tenantCode = localStg.get('loginTenantCode');
    await router.replace(tenantCode ? `/t/${encodeURIComponent(tenantCode)}/login` : '/login');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="p-16px">
    <ElAlert
      v-if="forced"
      type="warning"
      :closable="false"
      show-icon
      title="首次登录需要修改初始密码"
      description="原密码即开通时收到的初始密码。修改成功后会退出当前登录，请使用新密码重新登录。"
      class="mb-16px"
    />

    <ElCard class="max-w-560px">
      <template #header>
        <span class="font-600">修改密码</span>
      </template>

      <ElForm ref="formRef" :model="model" :rules="rules" label-width="92px" @keyup.enter="handleSubmit">
        <ElFormItem label="原密码" prop="oldPassword">
          <ElInput v-model="model.oldPassword" type="password" show-password placeholder="请输入原密码" />
        </ElFormItem>

        <ElFormItem label="新密码" prop="newPassword">
          <ElInput
            v-model="model.newPassword"
            type="password"
            show-password
            placeholder="至少 8 位，须同时包含字母与数字"
          />
        </ElFormItem>

        <ElFormItem label="确认密码" prop="confirmPassword">
          <ElInput v-model="model.confirmPassword" type="password" show-password placeholder="请再次输入新密码" />
        </ElFormItem>

        <ElFormItem>
          <ElButton type="primary" :loading="submitting" @click="handleSubmit">保存并重新登录</ElButton>
        </ElFormItem>
      </ElForm>
    </ElCard>
  </div>
</template>

<style scoped></style>
