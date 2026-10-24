<template>
  <view class="admin-page">
    <AdminNav title="成员管理" :fallback="`/pages/admin/project/detail?id=${projectId}`">
      <template #right>
        <text v-if="canWrite" class="admin-nav-action" @tap="openInvite">邀请</text>
      </template>
    </AdminNav>

    <view class="admin-content">
      <AdminPageState
        :loading="loading && !project"
        :error="error"
        :empty="false"
        @retry="load"
      >
        <template v-if="project">
          <view class="admin-card">
            <view class="admin-section-head">
              <view>
                <text class="admin-section-title">{{ project.name }}</text>
                <text class="admin-section-sub">{{ compositionHint }}</text>
              </view>
              <text class="admin-badge" :class="composition.meetsRequirement ? 'admin-badge--green' : 'admin-badge--orange'">
                {{ composition.meetsRequirement ? '已配齐' : '待配齐' }}
              </text>
            </view>

            <view class="composition-row">
              <view class="composition-item">
                <text class="composition-value">{{ composition.foremanCount }}</text>
                <text class="composition-label">工长</text>
              </view>
              <view class="composition-item">
                <text class="composition-value">{{ composition.ownerCount }}</text>
                <text class="composition-label">业主</text>
              </view>
              <view class="composition-item">
                <text class="composition-value composition-value--text">
                  {{ composition.primaryForemanName || '未指定' }}
                </text>
                <text class="composition-label">主工长</text>
              </view>
              <view class="composition-item">
                <text class="composition-value composition-value--text">
                  {{ composition.primaryOwnerName || '未指定' }}
                </text>
                <text class="composition-label">主业主</text>
              </view>
            </view>
          </view>

          <view v-if="!members.length" class="admin-card">
            <text class="admin-empty-inline">还没有成员</text>
          </view>

          <view v-else class="admin-list">
            <view v-for="member in members" :key="member.id" class="member-card">
              <view class="member-top">
                <view class="member-avatar">{{ (member.nickname || member.roleLabel || '成').slice(0, 1) }}</view>
                <view class="member-main">
                  <view class="member-name-row">
                    <text class="member-name">{{ member.nickname || member.phoneMasked || '待确认用户' }}</text>
                    <text class="admin-badge" :class="roleTone(member.role)">{{ member.roleLabel }}</text>
                    <text v-if="member.isPrimaryForeman" class="admin-badge admin-badge--green">主工长</text>
                    <text
                      v-if="member.isPrimaryOwner"
                      class="admin-badge admin-badge--accent"
                    >
                      {{ member.status === 'active' ? '主业主' : '确认后成为主业主' }}
                    </text>
                    <text
                      v-else-if="member.ownerType === 'temporary' && member.status !== 'removed'"
                      class="admin-badge admin-badge--gray"
                    >
                      临时业主
                    </text>
                    <text v-if="member.status !== 'active'" class="admin-badge admin-badge--gray">
                      {{ member.statusLabel }}
                    </text>
                  </view>
                  <text class="member-phone">{{ member.phoneMasked || '未绑定手机号' }}</text>
                </view>
              </view>

              <view v-if="canWrite" class="member-actions">
                <button
                  v-if="member.role === 'foreman' && member.status === 'active' && !member.isPrimaryForeman"
                  class="admin-btn admin-btn--ghost admin-btn--small"
                  @tap="setPrimary(member)"
                >
                  设为主工长
                </button>
                <button
                  v-if="
                    !member.isPrimaryForeman &&
                    member.status !== 'removed' &&
                    !(member.isPrimaryOwner && member.status === 'active')
                  "
                  class="admin-btn admin-btn--danger admin-btn--small"
                  @tap="removeMember(member)"
                >
                  移除
                </button>
                <text v-else-if="member.isPrimaryForeman" class="member-lock-hint">
                  先改指主工长后可移除
                </text>
                <text
                  v-else-if="member.isPrimaryOwner && member.status === 'active'"
                  class="member-lock-hint"
                >
                  主业主不可移除
                </text>
              </view>
            </view>
          </view>

          <view v-if="canWrite" class="admin-note member-note">
            成员邀请按手机号发送；角色由账号固定，业主可参与多个项目。对方确认后才会成为 active 成员，pending 不计入人员配置。
          </view>
          <view v-else class="admin-note member-note">项目已归档，成员只读。</view>
        </template>
      </AdminPageState>
    </view>

    <view v-if="inviteOpen" class="admin-sheet-mask" @tap="closeInvite">
      <view class="admin-sheet" @tap.stop>
        <view class="admin-sheet-handle" />
        <view class="admin-sheet-head">
          <view>
            <text class="admin-sheet-title">邀请成员</text>
            <text class="admin-sheet-sub">按手机号邀请；角色由账号固定，工长 / 监理不能在项目间改变</text>
          </view>
          <view class="admin-sheet-close" @tap="closeInvite">
            <image class="admin-sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="admin-form-group invite-field">
          <text class="admin-form-label">手机号</text>
          <input
            v-model="invite.phone"
            class="admin-input"
            type="number"
            maxlength="11"
            placeholder="请输入 11 位手机号"
            placeholder-class="admin-placeholder"
          />
        </view>

        <view class="admin-form-group invite-field">
          <text class="admin-form-label">角色</text>
          <view class="role-options">
            <view
              v-for="option in INVITE_ROLES"
              :key="option.key"
              class="admin-chip"
              :class="{ 'admin-chip--active': invite.role === option.key }"
              @tap="invite.role = option.key"
            >
              {{ option.label }}
            </view>
          </view>
        </view>

        <text v-if="invite.role === 'owner'" class="invite-owner-hint">
          {{
            hasPrimaryOwnerSlot
              ? '项目已有主业主（含待确认邀请），本次将添加为临时业主。临时业主可查看项目、账目、联系人与门锁密码，但不能确认验收、付款与对账。'
              : '该邀请确认后将成为主业主。主业主身份不可更改、不可移除，且只有主业主能确认验收、付款与对账。'
          }}
        </text>

        <text v-if="inviteError" class="invite-error">{{ inviteError }}</text>

        <view class="admin-sheet-actions">
          <button class="admin-btn admin-btn--ghost" @tap="closeInvite">取消</button>
          <button
            class="admin-btn"
            :class="{ 'admin-btn--disabled': inviteSubmitting }"
            :disabled="inviteSubmitting"
            @tap="submitInvite"
          >
            {{ inviteSubmitting ? '提交中…' : '发送邀请' }}
          </button>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { onLoad, onShow, onPullDownRefresh } from '@dcloudio/uni-app'
import AdminNav from '../../../components/admin/AdminNav.vue'
import AdminPageState from '../../../components/admin/AdminPageState.vue'
import {
  fetchAdminProject,
  fetchAdminMembers,
  inviteAdminMember,
  setAdminPrimaryForeman,
  removeAdminMember,
} from '../../../api/admin/project'
import { requireAdminSession, showAdminError } from '../../../utils/admin'

defineOptions({ name: 'AdminProjectMembersPage' })

const INVITE_ROLES = [
  { key: 'foreman', label: '工长' },
  { key: 'owner', label: '业主（首位为主业主）' },
  { key: 'supervisor', label: '监理' },
]

const projectId = ref(null)
const project = ref(null)
const members = ref([])
const composition = ref({
  foremanCount: 0,
  ownerCount: 0,
  primaryForemanName: null,
  primaryOwnerUserId: null,
  primaryOwnerName: null,
  primaryOwnerActive: false,
  temporaryOwnerCount: 0,
  meetsRequirement: false,
})
const loading = ref(false)
const error = ref('')
const inviteOpen = ref(false)
const inviteSubmitting = ref(false)
const inviteError = ref('')
const invite = reactive({ phone: '', role: 'foreman' })

let loadedOnce = false

const canWrite = computed(() => Boolean(project.value && project.value.status !== 'archived'))
// 含 pending：一个还没确认的主业主邀请同样占着名额
const hasPrimaryOwnerSlot = computed(() =>
  members.value.some(
    (member) => member.role === 'owner' && member.ownerType === 'primary' && member.status !== 'removed'
  )
)
const compositionHint = computed(() =>
  composition.value.meetsRequirement
    ? '至少 1 名工长、1 名主工长、1 名业主与 1 名主业主，可以进入施工'
    : '进入施工前必须配齐工长、主工长、业主与主业主'
)

onLoad(async (options) => {
  const id = options && options.id ? Number(options.id) : null
  projectId.value = Number.isInteger(id) && id > 0 ? id : null
  if (!projectId.value) {
    error.value = '缺少项目 id'
    return
  }
  try {
    await requireAdminSession()
  } catch (err) {
    showAdminError(err, '管理员信息加载失败')
    return
  }
  await load()
  loadedOnce = true
})

onShow(() => {
  if (loadedOnce) load(true)
})

onPullDownRefresh(async () => {
  try {
    await load(true)
  } finally {
    uni.stopPullDownRefresh()
  }
})

async function load(silent = false) {
  if (!projectId.value) return
  if (!silent) loading.value = true
  error.value = ''
  try {
    const [projectData, memberData] = await Promise.all([
      fetchAdminProject(projectId.value),
      fetchAdminMembers(projectId.value),
    ])
    project.value = projectData
    members.value = (memberData && memberData.members) || []
    const comp = (memberData && memberData.composition) || {}
    composition.value = {
      ...comp,
      meetsRequirement:
        Number(comp.foremanCount) > 0 &&
        Boolean(comp.primaryForemanUserId) &&
        Number(comp.ownerCount) > 0 &&
        Boolean(comp.primaryOwnerActive),
    }
  } catch (err) {
    error.value = err.message || '成员加载失败'
    showAdminError(err, '成员加载失败')
  } finally {
    loading.value = false
  }
}

function roleTone(role) {
  if (role === 'owner') return 'admin-badge--accent'
  if (role === 'foreman') return 'admin-badge--green'
  return 'admin-badge--gray'
}

function openInvite() {
  if (!canWrite.value) return
  invite.phone = ''
  invite.role = 'foreman'
  inviteError.value = ''
  inviteOpen.value = true
}

function closeInvite() {
  if (inviteSubmitting.value) return
  inviteOpen.value = false
}

function validateInvite() {
  if (!/^1[3-9]\d{9}$/.test(invite.phone.trim())) return '请输入正确的 11 位手机号'
  if (!INVITE_ROLES.some((item) => item.key === invite.role)) return '请选择成员角色'
  return ''
}

async function submitInvite() {
  if (inviteSubmitting.value) return
  inviteError.value = validateInvite()
  if (inviteError.value) return

  if (invite.role === 'owner' && !hasPrimaryOwnerSlot.value) {
    const confirmed = await new Promise((resolve) => {
      uni.showModal({
        title: '设置主业主',
        content:
          '该成员确认邀请后将成为主业主。主业主身份一经确认不可更改、不可移除，且只有主业主能确认验收、付款与对账。',
        confirmText: '确认邀请',
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false),
      })
    })
    if (!confirmed) return
  }

  inviteSubmitting.value = true
  try {
    await inviteAdminMember(projectId.value, {
      phone: invite.phone.trim(),
      role: invite.role,
    })
    uni.showToast({ title: '邀请已发送', icon: 'success' })
    inviteOpen.value = false
    await load(true)
  } catch (err) {
    inviteError.value = err.message || '邀请失败'
    showAdminError(err, '邀请失败')
  } finally {
    inviteSubmitting.value = false
  }
}

function setPrimary(member) {
  uni.showModal({
    title: '设为主工长',
    content: `确定将「${member.nickname || member.phoneMasked}」设为主工长吗？主工长只能有 1 名。`,
    success: async (res) => {
      if (!res.confirm) return
      try {
        await setAdminPrimaryForeman(projectId.value, member.id)
        uni.showToast({ title: '已设置', icon: 'success' })
        await load(true)
      } catch (err) {
        showAdminError(err, '设置失败')
      }
    },
  })
}

function removeMember(member) {
  if (member.isPrimaryOwner && member.status === 'active') {
    uni.showToast({ title: '主业主不可移除', icon: 'none' })
    return
  }
  uni.showModal({
    title: '移除成员',
    content: `确定移除「${member.nickname || member.phoneMasked}」吗？主工长不能直接移除。`,
    confirmText: '移除',
    confirmColor: '#f53f3f',
    success: async (res) => {
      if (!res.confirm) return
      try {
        await removeAdminMember(projectId.value, member.id)
        uni.showToast({ title: '已移除', icon: 'success' })
        await load(true)
      } catch (err) {
        showAdminError(err, '移除失败')
      }
    },
  })
}
</script>

<style scoped lang="scss">
.admin-nav-action {
  padding: dp(4) dp(2);
  color: #eb5c20;
  font-size: dp(13);
  font-weight: 500;
}

.composition-row {
  display: flex;
  margin-top: dp(2);
}

.composition-item {
  flex: 1;
  text-align: center;
}

.composition-value {
  display: block;
  color: #241c17;
  font-size: dp(18);
  font-weight: 700;
}

.composition-value--text {
  overflow: hidden;
  font-size: dp(12);
  line-height: 1.8;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.composition-label {
  display: block;
  margin-top: dp(3);
  color: #8b8179;
  font-size: dp(10);
}

.member-card {
  padding: dp(13);
  border: 1px solid #f0eae4;
  border-radius: dp(12);
  background: #fff;
}

.member-top {
  display: flex;
  align-items: center;
}

.member-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(36);
  height: dp(36);
  margin-right: dp(10);
  border-radius: 50%;
  background: #fdebe4;
  color: #eb5c20;
  font-size: dp(14);
  font-weight: 700;
  flex-shrink: 0;
}

.member-main {
  flex: 1;
  min-width: 0;
}

.member-name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: dp(5);
}

.member-name {
  color: #241c17;
  font-size: dp(13);
  font-weight: 600;
}

.member-phone {
  display: block;
  margin-top: dp(4);
  color: #8b8179;
  font-size: dp(10);
}

.member-actions {
  display: flex;
  justify-content: flex-end;
  gap: dp(8);
  margin-top: dp(10);
}

.member-note {
  margin-top: dp(4);
}

.member-lock-hint {
  color: #a79c92;
  font-size: dp(10);
}

.invite-field {
  margin-top: dp(12);
}

.role-options {
  display: flex;
  gap: dp(8);
}

.invite-error {
  display: block;
  margin-top: dp(8);
  color: #f53f3f;
  font-size: dp(11);
}

.invite-owner-hint {
  display: block;
  padding: dp(8) dp(10);
  margin-top: dp(10);
  color: #8a5a1f;
  font-size: dp(11);
  line-height: 1.5;
  background: #fff7e8;
  border-radius: dp(8);
}
</style>
