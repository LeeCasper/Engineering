<template>
  <view class="admin-page">
    <AdminNav title="修改密码" fallback="/pages/admin/login/index" />

    <view class="admin-content">
      <view class="admin-card">
        <view class="admin-section-head">
          <view>
            <text class="admin-section-title">{{ firstLogin ? '请修改初始密码' : '修改管理密码' }}</text>
            <text class="admin-section-sub">
              {{ firstLogin ? '首次登录必须修改初始密码后才能进入管理端' : '修改后所有已登录设备与微信免密绑定都会失效' }}
            </text>
          </view>
        </view>

        <view class="admin-form-group">
          <text class="admin-form-label">原密码</text>
          <input
            v-model="form.oldPassword"
            class="admin-input"
            type="password"
            maxlength="72"
            placeholder="请输入当前密码"
            placeholder-class="admin-placeholder"
          />
        </view>

        <view class="admin-form-group">
          <text class="admin-form-label">新密码</text>
          <input
            v-model="form.newPassword"
            class="admin-input"
            type="password"
            maxlength="72"
            placeholder="至少 8 位，包含字母与数字"
            placeholder-class="admin-placeholder"
          />
        </view>

        <view class="admin-form-group">
          <text class="admin-form-label">确认新密码</text>
          <input
            v-model="form.confirmPassword"
            class="admin-input"
            type="password"
            maxlength="72"
            placeholder="再次输入新密码"
            placeholder-class="admin-placeholder"
          />
        </view>

        <view class="admin-note">
          新密码不能与原密码相同。修改成功后当前管理员 token 立即失效，需要重新登录；
          已绑定的微信也会自动解除，需要重新绑定。
        </view>

        <text v-if="error" class="form-error">{{ error }}</text>

        <button
          class="admin-btn admin-btn--block"
          :class="{ 'admin-btn--disabled': submitting }"
          :disabled="submitting"
          @tap="submit"
        >
          {{ submitting ? '提交中…' : '确认修改' }}
        </button>
      </view>
    </view>
  </view>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import AdminNav from '../../../components/admin/AdminNav.vue'
import { changeAdminPassword } from '../../../api/admin/auth'
import { getAdminToken, clearAdminSession, setBindingHint } from '../../../store/adminSession'
import { redirectToAdminLogin } from '../../../api/admin/request'
import { showAdminError } from '../../../utils/admin'

defineOptions({ name: 'AdminChangePasswordPage' })

const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const submitting = ref(false)
const error = ref('')
const firstLogin = ref(false)

onLoad((options) => {
  firstLogin.value = Boolean(options && options.first === '1')
  if (!getAdminToken()) {
    redirectToAdminLogin('login_required')
  }
})

function validate() {
  if (!form.oldPassword) return '请输入原密码'
  if (!form.newPassword) return '请输入新密码'
  if (form.newPassword.length < 8) return '新密码至少 8 位'
  if (!/[A-Za-z]/.test(form.newPassword) || !/\d/.test(form.newPassword)) {
    return '新密码需要同时包含字母和数字'
  }
  if (form.newPassword !== form.confirmPassword) return '两次输入的新密码不一致'
  if (form.newPassword === form.oldPassword) return '新密码不能与原密码相同'
  return ''
}

async function submit() {
  if (submitting.value) return
  error.value = validate()
  if (error.value) return

  submitting.value = true
  try {
    await changeAdminPassword({
      oldPassword: form.oldPassword,
      newPassword: form.newPassword,
    })
    clearAdminSession()
    setBindingHint(0)
    uni.showModal({
      title: '密码已修改',
      content: '请使用新密码重新登录管理端。',
      showCancel: false,
      success: () => redirectToAdminLogin('password_changed'),
    })
  } catch (err) {
    if (err.statusCode === 401) return
    error.value = err.message || '修改失败'
    showAdminError(err, '修改失败')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped lang="scss">
.form-error {
  display: block;
  margin: dp(2) 0 dp(10);
  color: #f53f3f;
  font-size: dp(11);
  line-height: 1.5;
}
</style>
