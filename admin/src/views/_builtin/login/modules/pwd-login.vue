<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchCaptcha } from '@/service/api';
import { useAuthStore } from '@/store/modules/auth';
import { useForm } from '@/hooks/common/form';

defineOptions({ name: 'PwdLogin' });

const props = defineProps<{
  /** 租户专属登录地址里的租户标识；平台入口为空 */
  tenantCode?: string;
}>();

const authStore = useAuthStore();
const router = useRouter();
const { formRef, validate } = useForm();

const isTenantPortal = computed(() => Boolean(props.tenantCode));

interface FormModel {
  userName: string;
  password: string;
  captchaAnswer: string;
}

const model = reactive<FormModel>({
  userName: '',
  password: '',
  captchaAnswer: ''
});

const captcha = ref<Api.Auth.Captcha | null>(null);

// 模板表达式里不能直接写 import.meta，先在脚本里取出来
const isDev = import.meta.env.DEV;

const captchaSrc = computed(() => {
  if (!captcha.value) return '';

  // 后端返回的是 SVG 源串。用 data URI 而不是 v-html：
  // v-html 会把 SVG 里可能存在的脚本一并注入，而图片上下文天然禁止脚本执行。
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(captcha.value.svg)}`;
});

const rules = {
  userName: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
  captchaAnswer: [{ required: true, message: '请输入验证码', trigger: 'blur' }]
};

async function loadCaptcha() {
  const { data, error } = await fetchCaptcha();

  if (!error && data) {
    captcha.value = data;
    model.captchaAnswer = '';
  }
}

onMounted(loadCaptcha);

async function handleSubmit() {
  if (authStore.loginLoading) return;

  try {
    await validate();
  } catch {
    return;
  }

  if (!captcha.value) {
    await loadCaptcha();
    return;
  }

  const pass = await authStore.login({
    username: model.userName.trim(),
    password: model.password,
    captchaId: captcha.value.captchaId,
    captchaAnswer: model.captchaAnswer.trim(),
    // 门户由地址决定，而不是让用户在一个可选框里猜：
    // 根地址只接受平台账号，/t/<code>/login 只接受该租户账号
    portal: isTenantPortal.value ? 'tenant' : 'platform',
    tenantCode: isTenantPortal.value ? props.tenantCode : undefined
  });

  // 验证码用后即失效（AC-AD02）：失败必须换一张，不能拿旧 id 再试
  if (!pass) {
    await loadCaptcha();
  }
}

function openDefaultTenantLogin() {
  router.push('/t/default/login');
}
</script>

<template>
  <ElForm
    ref="formRef"
    :model="model"
    :rules="rules"
    label-position="top"
    size="large"
    @keyup.enter="handleSubmit"
  >
    <ElFormItem label="用户名" prop="userName">
      <ElInput v-model="model.userName" placeholder="请输入后台账号" autocomplete="username" />
    </ElFormItem>

    <ElFormItem label="密码" prop="password">
      <ElInput
        v-model="model.password"
        type="password"
        show-password
        placeholder="请输入密码"
        autocomplete="current-password"
      />
    </ElFormItem>

    <ElFormItem label="验证码" prop="captchaAnswer">
      <div class="w-full flex items-center gap-10px">
        <ElInput
          v-model="model.captchaAnswer"
          class="flex-1"
          maxlength="10"
          placeholder="请输入右侧验证码"
          autocomplete="off"
        />
        <img
          v-if="captchaSrc"
          :src="captchaSrc"
          class="h-40px w-120px flex-shrink-0 cursor-pointer rd-4px border border-solid border-#dcdfe6"
          alt="验证码"
          title="看不清？点击换一张"
          @click="loadCaptcha"
        />
        <ElButton v-else class="h-40px w-120px flex-shrink-0" @click="loadCaptcha">获取验证码</ElButton>
      </div>
    </ElFormItem>

    <ElButton
      class="login-submit"
      type="primary"
      size="large"
      :loading="authStore.loginLoading"
      @click="handleSubmit"
    >
      登 录
    </ElButton>

    <div v-if="isDev" class="mt-16px text-12px text-#86909c leading-20px">
      <p v-if="captcha?.debugAnswer">开发环境验证码：<b>{{ captcha.debugAnswer }}</b></p>

      <template v-if="isTenantPortal">
        <p>当前为租户专属登录地址（{{ tenantCode }}）。</p>
        <p v-if="tenantCode === 'default'">本机种子账号：admin / Admin123456</p>
        <p v-else>请使用平台开通租户时设置的 owner 账号登录。</p>
        <p>首次登录会强制修改初始密码。</p>
      </template>

      <template v-else>
        <p>平台运营账号：platform / Platform123456</p>
        <p>租户管理员不使用这个地址，请从各自的专属链接进入。</p>
        <ElButton link type="primary" class="!h-auto !p-0" @click="openDefaultTenantLogin">
          打开本机默认租户登录页 →
        </ElButton>
      </template>
    </div>
  </ElForm>
</template>

<style scoped>
.login-submit {
  width: 100%;
  height: 44px;
  margin-top: 8px;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 2px;
}
</style>
