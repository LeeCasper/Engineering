<template>
  <view class="page">
    <view class="nav" :style="{ paddingTop: `${safeTop + 6}px` }">
      <view class="nav-back" @tap="goBack">
        <image class="nav-back-icon" src="/static/images/icon-back.png" mode="aspectFit" />
      </view>
      <view class="nav-title-wrap">
        <text class="nav-title">门锁密码</text>
        <text v-if="projectName" class="nav-sub">{{ projectName }}</text>
      </view>
    </view>

    <view v-if="loading && !loaded" class="state-block">
      <text class="state-text">加载中…</text>
    </view>

    <view v-else-if="loadError" class="state-block">
      <image class="state-icon" src="/static/images/icon-lock-gray.png" mode="aspectFit" />
      <text class="state-title">{{ errorTitle }}</text>
      <text class="state-text">{{ loadError }}</text>
      <button class="state-btn" @tap="goBack">返回项目</button>
    </view>

    <template v-else>
      <view class="content" :class="{ 'content--owner': canManage }">
        <view class="notice-card">
          <view class="notice-icon-wrap">
            <image class="notice-icon" src="/static/images/icon-lock-gray.png" mode="aspectFit" />
          </view>
          <view class="notice-main">
            <text class="notice-title">
              {{ canManage ? '仅用于装修期间临时保管' : '业主已设置的临时门锁密码' }}
            </text>
            <text class="notice-text">{{ disclaimer }}</text>
          </view>
        </view>

        <view v-if="!codes.length" class="empty-card">
          <image class="empty-icon" src="/static/images/icon-lock-gray.png" mode="aspectFit" />
          <text class="empty-title">{{ canManage ? '还没有设置门锁密码' : '业主还没有设置门锁密码' }}</text>
          <text class="empty-text">
            {{
              canManage
                ? '设置后，本项目已确认的工长与监理可以直接查看。'
                : '业主设置后，你可以在本页面直接看到明文密码。'
            }}
          </text>
          <button v-if="canManage" class="empty-btn" @tap="openCreate">新增门锁密码</button>
        </view>

        <view v-else class="code-list">
          <view v-for="item in codes" :key="item.id" class="code-card">
            <view class="code-head">
              <view class="code-icon-wrap">
                <image class="code-icon" src="/static/images/icon-lock-gray.png" mode="aspectFit" />
              </view>
              <view class="code-title-wrap">
                <text class="code-name">{{ item.name }}</text>
                <text class="code-time">设置于 {{ formatTime(item.createdAt) }}</text>
              </view>
              <text class="code-status">可用</text>
            </view>

            <view class="code-value-row">
              <text v-if="item.available" class="code-value">{{ item.code }}</text>
              <text v-else class="code-unavailable">该密码暂不可用，请联系业主重新设置</text>
            </view>

            <text v-if="item.remark" class="code-remark">备注：{{ item.remark }}</text>

            <view v-if="canManage" class="code-actions">
              <button class="code-action" @tap="openEdit(item)">修改</button>
              <button class="code-action code-action--danger" @tap="confirmRevoke(item)">失效</button>
            </view>
          </view>
        </view>
      </view>

      <view v-if="canManage" class="bottom-bar">
        <button class="log-btn" @tap="openAccessLog">访问记录</button>
        <button class="add-btn" @tap="openCreate">新增密码</button>
      </view>
    </template>

    <!-- 新增 / 修改 -->
    <view v-if="formOpen" class="sheet-mask" @tap="closeForm">
      <view class="sheet" @tap.stop>
        <view class="sheet-handle" />
        <view class="sheet-head">
          <view>
            <text class="sheet-title">{{ editingId ? '修改门锁密码' : '新增门锁密码' }}</text>
            <text class="sheet-sub">
              {{ editingId ? '密码留空表示不修改，只更新名称或备注' : '设置后工长与监理可以立即查看' }}
            </text>
          </view>
          <view class="sheet-close" @tap="closeForm">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="field">
          <text class="field-label">条目名称</text>
          <input
            v-model="form.name"
            class="field-input"
            maxlength="50"
            placeholder="例如：入户门 / 单元门"
            placeholder-class="field-placeholder"
          />
        </view>

        <view class="field">
          <text class="field-label">门锁密码</text>
          <view class="code-input-row">
            <input
              v-model="form.code"
              class="field-input code-input"
              :password="!showCodeInput"
              maxlength="64"
              :placeholder="editingId ? '不修改请留空' : '请输入门锁密码'"
              placeholder-class="field-placeholder"
            />
            <text class="show-toggle" @tap="showCodeInput = !showCodeInput">
              {{ showCodeInput ? '隐藏' : '显示' }}
            </text>
          </view>
          <text class="field-hint">支持数字、字母与空格；首尾空白会被去掉，中间空格保留。</text>
        </view>

        <view class="field">
          <text class="field-label">备注（选填）</text>
          <input
            v-model="form.remark"
            class="field-input"
            maxlength="200"
            placeholder="例如：装修期间使用"
            placeholder-class="field-placeholder"
          />
        </view>

        <view class="sheet-actions">
          <button class="sheet-cancel" @tap="closeForm">取消</button>
          <button class="sheet-save" :disabled="submitting" @tap="submitForm">
            {{ submitting ? '保存中…' : editingId ? '保存修改' : '保存密码' }}
          </button>
        </view>
      </view>
    </view>

    <!-- 访问记录 -->
    <view v-if="logOpen" class="sheet-mask" @tap="logOpen = false">
      <view class="sheet sheet--log" @tap.stop>
        <view class="sheet-handle" />
        <view class="sheet-head">
          <view>
            <text class="sheet-title">访问记录</text>
            <text class="sheet-sub">谁在什么时候查看过门锁密码</text>
          </view>
          <view class="sheet-close" @tap="logOpen = false">
            <image class="sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view v-if="logLoading" class="sheet-state">加载中…</view>
        <view v-else-if="!logList.length" class="sheet-state">还没有人查看过密码</view>
        <view v-else class="log-list">
          <view v-for="row in logList" :key="row.id" class="log-row">
            <view class="log-dot" />
            <view class="log-main">
              <view class="log-title-row">
                <text class="log-name">{{ row.userName || '项目成员' }}</text>
                <text class="log-code">{{ row.codeName }}</text>
              </view>
              <text class="log-time">{{ formatTime(row.viewedAt) }}</text>
              <text v-if="row.ip" class="log-ip">IP：{{ row.ip }}</text>
            </view>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app'
import { getToken } from '../../store/session'
import {
  createDoorCode,
  fetchDoorCodeAccessLog,
  fetchDoorCodes,
  revokeDoorCode,
  updateDoorCode,
} from '../../api/doorCode'

defineOptions({ name: 'ProjectDoorCodePage' })

const safeTop = ref(12)
const projectId = ref(0)
const projectName = ref('')
const loading = ref(false)
const loaded = ref(false)
const loadError = ref('')
const errorTitle = ref('门锁密码不可用')

const codes = ref([])
const canManage = ref(false)
const disclaimer = ref('')

const formOpen = ref(false)
const editingId = ref(null)
const showCodeInput = ref(false)
const submitting = ref(false)
const form = reactive({ name: '', code: '', remark: '' })

const logOpen = ref(false)
const logLoading = ref(false)
const logList = ref([])

onLoad((options) => {
  const info = uni.getSystemInfoSync()
  safeTop.value = info.statusBarHeight || 12

  if (!getToken()) {
    uni.redirectTo({ url: '/pages/login/index' })
    return
  }

  projectId.value = options && options.projectId ? Number(options.projectId) : 0
  const rawName = (options && options.name) || ''
  try {
    projectName.value = rawName ? decodeURIComponent(rawName) : ''
  } catch {
    // 参数可能已经被框架解码过；含 % 时再次解码会抛错，直接使用原值
    projectName.value = rawName
  }

  if (!projectId.value) {
    loadError.value = '缺少项目 ID'
    return
  }

  load()
})

onPullDownRefresh(async () => {
  try {
    await load()
  } finally {
    uni.stopPullDownRefresh()
  }
})

async function load() {
  loading.value = true
  loadError.value = ''

  try {
    const data = await fetchDoorCodes(projectId.value)
    codes.value = data.list || []
    canManage.value = Boolean(data.canManage)
    disclaimer.value = data.disclaimer || ''
    loaded.value = true
  } catch (err) {
    if (err.statusCode === 401) {
      uni.redirectTo({ url: '/pages/login/index' })
      return
    }

    if (err.statusCode === 403) {
      errorTitle.value = '门锁密码不可查看'
      // 项目归档 / 非成员都可能是 403/404；直接展示后端文案，
      // 不自己猜「为什么不能看」
      loadError.value = err.message || '项目已归档或你没有查看权限'
      return
    }

    if (err.statusCode === 404) {
      errorTitle.value = '项目不可用'
      loadError.value = err.message || '项目不存在，或你已不在该项目中'
      return
    }

    loadError.value = err.message || '门锁密码加载失败'
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = null
  form.name = ''
  form.code = ''
  form.remark = ''
  showCodeInput.value = false
  formOpen.value = true
}

function openEdit(item) {
  editingId.value = item.id
  form.name = item.name || ''
  form.code = ''
  form.remark = item.remark || ''
  showCodeInput.value = false
  formOpen.value = true
}

function closeForm() {
  if (submitting.value) return
  formOpen.value = false
}

async function submitForm() {
  if (submitting.value) return

  const name = form.name.trim()
  if (!name) {
    uni.showToast({ title: '请填写条目名称', icon: 'none' })
    return
  }

  const code = form.code
  if (!editingId.value && !code.trim()) {
    uni.showToast({ title: '请输入门锁密码', icon: 'none' })
    return
  }
  if (code.length > 64) {
    uni.showToast({ title: '门锁密码不超过 64 位', icon: 'none' })
    return
  }

  submitting.value = true
  try {
    if (editingId.value) {
      await updateDoorCode(editingId.value, {
        name,
        // 留空表示只改名称/备注，不重新加密密码
        code: code.trim() ? code : undefined,
        remark: form.remark.trim(),
      })
      uni.showToast({ title: '已保存', icon: 'success' })
    } else {
      await createDoorCode(projectId.value, {
        name,
        code,
        remark: form.remark.trim(),
      })
      uni.showToast({ title: '门锁密码已设置', icon: 'success' })
    }

    formOpen.value = false
    await load()
  } catch (err) {
    uni.showToast({ title: err.message || '保存失败', icon: 'none' })
  } finally {
    submitting.value = false
  }
}

function confirmRevoke(item) {
  uni.showModal({
    title: '失效门锁密码',
    content:
      `确定失效「${item.name}」？失效后工长与监理将无法在本系统中查看。\n\n` +
      '注意：这只改变系统内的可见性，不会改变实体锁上的密码。' +
      '如果该密码已经被他人记录，建议同步更换门锁密码。',
    confirmText: '确认失效',
    confirmColor: '#F53F3F',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await revokeDoorCode(item.id)
        uni.showToast({ title: '已失效', icon: 'success' })
        await load()
      } catch (err) {
        uni.showToast({ title: err.message || '失效失败', icon: 'none' })
      }
    },
  })
}

async function openAccessLog() {
  logOpen.value = true
  logLoading.value = true
  logList.value = []

  try {
    const data = await fetchDoorCodeAccessLog(projectId.value, { page: 1, pageSize: 50 })
    logList.value = (data && data.list) || []
  } catch (err) {
    uni.showToast({ title: err.message || '访问记录加载失败', icon: 'none' })
  } finally {
    logLoading.value = false
  }
}

function formatTime(value) {
  if (!value) return '--'
  return String(value).slice(0, 16).replace(/-/g, '.')
}

function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    uni.navigateBack()
    return
  }
  uni.redirectTo({ url: '/pages/projects/index' })
}
</script>

<style scoped lang="scss">
.page {
  min-height: 100vh;
  /* 工长 / 监理没有底部操作栏；业主的 content--owner 会额外留出空间 */
  padding-bottom: dp(24);
  background: #faf7f4;
}

.content {
  padding: 0 dp(16);
}

.content--owner {
  padding-bottom: dp(84);
}

.nav {
  display: flex;
  align-items: center;
  padding-right: dp(16);
  padding-bottom: dp(10);
  padding-left: dp(8);
}

.nav-back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(40);
  height: dp(40);
  flex-shrink: 0;
}

.nav-back-icon {
  width: dp(20);
  height: dp(20);
}

.nav-title-wrap {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.nav-title {
  color: #241c17;
  font-size: dp(18);
  font-weight: 700;
  letter-spacing: dp(-0.2);
}

.nav-sub {
  margin-top: dp(2);
  overflow: hidden;
  color: #8a7e73;
  font-size: dp(10);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.notice-card {
  display: flex;
  align-items: flex-start;
  padding: dp(13);
  margin-bottom: dp(12);
  background: #fff7f2;
  border: 1px solid #f7d8c8;
  border-radius: dp(14);
}

.notice-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(32);
  height: dp(32);
  margin-right: dp(10);
  background: #fdebe4;
  border-radius: dp(10);
  flex-shrink: 0;
}

.notice-icon {
  width: dp(18);
  height: dp(18);
  opacity: 0.8;
}

.notice-main {
  flex: 1;
  min-width: 0;
}

.notice-title {
  display: block;
  color: #8a3d16;
  font-size: dp(12);
  font-weight: 700;
  line-height: 1.4;
}

.notice-text {
  display: block;
  margin-top: dp(4);
  color: #8a6a58;
  font-size: dp(10);
  line-height: 1.55;
}

.code-list {
  display: flex;
  flex-direction: column;
  gap: dp(11);
}

.code-card {
  padding: dp(14);
  background: #fff;
  border: 1px solid #f0eae4;
  border-radius: dp(16);
  box-shadow: 0 dp(4) dp(20) rgba(94, 45, 22, 0.05);
}

.code-head {
  display: flex;
  align-items: center;
}

.code-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(38);
  height: dp(38);
  margin-right: dp(10);
  background: #fdeee6;
  border-radius: dp(12);
  flex-shrink: 0;
}

.code-icon {
  width: dp(20);
  height: dp(20);
  opacity: 0.75;
}

.code-title-wrap {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.code-name {
  overflow: hidden;
  color: #241c17;
  font-size: dp(15);
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.code-time {
  margin-top: dp(3);
  color: #9a8e84;
  font-size: dp(10);
}

.code-status {
  padding: dp(3) dp(8);
  border-radius: dp(999);
  background: #e8f7ee;
  color: #1f8f4e;
  font-size: dp(9);
  font-weight: 600;
  flex-shrink: 0;
}

.code-value-row {
  display: flex;
  align-items: center;
  min-height: dp(48);
  padding: dp(10) dp(12);
  margin-top: dp(12);
  background: #fbf8f5;
  border: 1px dashed #e8ddd4;
  border-radius: dp(10);
}

.code-value {
  color: #241c17;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
  font-size: dp(20);
  font-weight: 700;
  letter-spacing: dp(2);
  word-break: break-all;
  user-select: text;
}

.code-unavailable {
  color: #c62828;
  font-size: dp(11);
  line-height: 1.5;
}

.code-remark {
  display: block;
  margin-top: dp(8);
  color: #71675f;
  font-size: dp(11);
  line-height: 1.5;
}

.code-actions {
  display: flex;
  justify-content: flex-end;
  gap: dp(8);
  margin-top: dp(10);
  padding-top: dp(10);
  border-top: 1px solid #f4eee8;
}

.code-action {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(30);
  padding: 0 dp(14);
  border: 1px solid #e8ddd4;
  border-radius: dp(8);
  background: #fff;
  color: #51463e;
  font-size: dp(11);
  font-weight: 600;
}

.code-action--danger {
  border-color: #ffd6d0;
  color: #c62828;
}

.empty-card {
  display: flex;
  align-items: center;
  padding: dp(34) dp(20);
  background: #fff;
  border: 1px solid #f0eae4;
  border-radius: dp(16);
  flex-direction: column;
  text-align: center;
}

.empty-icon {
  width: dp(46);
  height: dp(46);
  opacity: 0.4;
}

.empty-title {
  margin-top: dp(12);
  color: #3a2e27;
  font-size: dp(14);
  font-weight: 700;
}

.empty-text {
  margin-top: dp(7);
  color: #9a8e84;
  font-size: dp(11);
  line-height: 1.55;
}

.empty-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(36);
  padding: 0 dp(18);
  margin-top: dp(16);
  border-radius: dp(9);
  background: #eb5c20;
  color: #fff;
  font-size: dp(12);
  font-weight: 600;
}

.bottom-bar {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
  display: flex;
  gap: dp(9);
  padding: dp(10) dp(16) calc(#{dp(10)} + env(safe-area-inset-bottom));
  background: rgba(250, 247, 244, 0.94);
  border-top: 1px solid #f0eae4;
  backdrop-filter: blur(10px);
}

.log-btn,
.add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(44);
  border-radius: dp(10);
  font-size: dp(13);
  font-weight: 600;
}

.log-btn {
  width: 34%;
  border: 1px solid #e8ddd4;
  background: #fff;
  color: #51463e;
}

.add-btn {
  flex: 1;
  background: #eb5c20;
  color: #fff;
  box-shadow: 0 dp(6) dp(14) rgba(235, 92, 32, 0.2);
}

/* ── 表单面板 ── */
.sheet-mask {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1001;
  display: flex;
  align-items: flex-end;
  background: rgba(20, 15, 12, 0.42);
}

.sheet {
  width: 100%;
  max-height: 86vh;
  padding: dp(8) dp(18) calc(#{dp(18)} + env(safe-area-inset-bottom));
  background: #fff;
  border-radius: dp(22) dp(22) 0 0;
  overflow-y: auto;
}

.sheet--log {
  max-height: 70vh;
}

.sheet-handle {
  width: dp(38);
  height: dp(4);
  margin: 0 auto dp(12);
  background: #e8ddd4;
  border-radius: dp(2);
}

.sheet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: dp(14);
}

.sheet-title {
  display: block;
  color: #241c17;
  font-size: dp(17);
  font-weight: 700;
}

.sheet-sub {
  display: block;
  margin-top: dp(3);
  color: #9a8e84;
  font-size: dp(10);
  line-height: 1.4;
}

.sheet-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(30);
  height: dp(30);
  border-radius: 50%;
  background: #f7f1ec;
  flex-shrink: 0;
}

.sheet-close-icon {
  width: dp(14);
  height: dp(14);
}

.field {
  margin-bottom: dp(14);
}

.field-label {
  display: block;
  margin-bottom: dp(7);
  color: #51463e;
  font-size: dp(12);
  font-weight: 600;
}

.field-input {
  width: 100%;
  height: dp(42);
  padding: 0 dp(12);
  background: #fbf8f5;
  border: 1px solid #eee4dc;
  border-radius: dp(10);
  color: #241c17;
  font-size: dp(13);
}

.field-placeholder {
  color: #b3a69c;
}

.code-input-row {
  display: flex;
  align-items: center;
  gap: dp(8);
}

.code-input {
  flex: 1;
  min-width: 0;
}

.show-toggle {
  padding: dp(8) dp(4);
  color: #eb5c20;
  font-size: dp(11);
  font-weight: 600;
  flex-shrink: 0;
}

.field-hint {
  display: block;
  margin-top: dp(6);
  color: #a09388;
  font-size: dp(9);
  line-height: 1.5;
}

.sheet-actions {
  display: flex;
  gap: dp(9);
  margin-top: dp(4);
}

.sheet-cancel,
.sheet-save {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(42);
  border-radius: dp(10);
  font-size: dp(13);
  font-weight: 600;
}

.sheet-cancel {
  width: 34%;
  border: 1px solid #e8ddd4;
  background: #fff;
  color: #51463e;
}

.sheet-save {
  flex: 1;
  background: #eb5c20;
  color: #fff;
}

.sheet-save:disabled {
  opacity: 0.62;
}

.sheet-state {
  padding: dp(30) 0;
  color: #9a8e84;
  font-size: dp(12);
  text-align: center;
}

.log-list {
  display: flex;
  flex-direction: column;
}

.log-row {
  display: flex;
  padding: dp(10) 0;
  border-bottom: 1px solid #f4eee8;
}

.log-row:last-child {
  border-bottom: 0;
}

.log-dot {
  width: dp(8);
  height: dp(8);
  margin: dp(6) dp(10) 0 0;
  background: #eb5c20;
  border-radius: 50%;
  flex-shrink: 0;
}

.log-main {
  flex: 1;
  min-width: 0;
}

.log-title-row {
  display: flex;
  align-items: center;
  gap: dp(8);
}

.log-name {
  color: #241c17;
  font-size: dp(12);
  font-weight: 600;
}

.log-code {
  padding: dp(2) dp(6);
  background: #fdeee6;
  border-radius: dp(4);
  color: #8a3d16;
  font-size: dp(9);
}

.log-time {
  display: block;
  margin-top: dp(2);
  color: #9a8e84;
  font-size: dp(10);
}

.log-ip {
  display: block;
  margin-top: dp(2);
  color: #b3a69c;
  font-size: dp(9);
}

.state-block {
  display: flex;
  align-items: center;
  padding: dp(80) dp(28) 0;
  flex-direction: column;
  text-align: center;
}

.state-icon {
  width: dp(42);
  height: dp(42);
  margin-bottom: dp(12);
  opacity: 0.5;
}

.state-title {
  margin-bottom: dp(8);
  color: #241c17;
  font-size: dp(15);
  font-weight: 700;
}

.state-text {
  color: #8a7e73;
  font-size: dp(12);
  line-height: 1.6;
}

.state-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: dp(38);
  padding: 0 dp(18);
  margin-top: dp(16);
  border-radius: dp(9);
  background: #eb5c20;
  color: #fff;
  font-size: dp(12);
  font-weight: 600;
}
</style>
