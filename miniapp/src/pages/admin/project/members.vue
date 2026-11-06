<template>
  <view class="admin-page admin-page--cool">
    <AdminRootHeader
      title="成员管理"
      :subtitle="compositionHint"
      back
      :fallback="fallback"
      background="#F6F7F9"
      glass
    >
      <template #right>
        <AdminHeaderAction v-if="canWrite" label="邀请成员" prefix="+" @tap="openInvite" />
      </template>
    </AdminRootHeader>

    <view class="content">
      <view class="scope-row" @tap="compositionSheetOpen = true">
        <view class="scope-main">
          <text class="scope-text">当前项目：{{ project ? project.name : '加载中…' }}</text>
          <text v-if="project && project.status === 'archived'" class="scope-archived">已归档</text>
        </view>
        <image class="scope-caret" src="/static/images/icon-caret-down-gray.png" mode="aspectFit" />
      </view>

      <view v-if="project" class="search-box">
        <image class="search-icon" src="/static/images/icon-search.png" mode="aspectFit" />
        <input
          v-model="keyword"
          class="search-input"
          confirm-type="search"
          placeholder="搜索姓名 / 手机号 / 角色"
          placeholder-class="search-placeholder"
        />
        <text v-if="keyword" class="search-clear" @tap="keyword = ''">清除</text>
      </view>

      <view v-if="project" class="filter-row">
        <view
          v-for="item in roleOptions"
          :key="item.key || 'all'"
          class="filter-chip"
          :class="{ 'filter-chip--active': role === item.key }"
          @tap="role = item.key"
        >
          <text>{{ item.label }}</text>
          <text class="filter-count">{{ item.count }}</text>
        </view>
      </view>

      <view v-if="project && canWrite && !composition.meetsRequirement" class="compose-warning">
        {{ missingHint }}
      </view>

      <AdminPageState
        :loading="loading && !project"
        :error="error"
        :empty="!loading && !error && !!project && !filteredMembers.length"
        :empty-title="emptyTitle"
        :empty-text="emptyText"
        @retry="load"
      />

      <view v-if="filteredMembers.length" class="member-list gc-stagger">
        <view
          v-for="member in filteredMembers"
          :key="member.id"
          class="member-item"
        >
          <AdminMemberCard
            :member="member"
            :show-project="false"
            @select="openMemberSheet"
          />
        </view>
      </view>

      <view v-if="project" class="rules-card">
        <text class="rules-title">成员邀请规则</text>
        <text class="rules-text">手机号邀请 → 对方确认后生效；主工长每项目仅 1 人，主业主不可移除</text>
        <text v-if="!canWrite" class="rules-text">项目已归档，成员关系只读。</text>
      </view>
    </view>

    <!-- 人员配置 -->
    <view v-if="compositionSheetOpen" class="admin-sheet-mask" @tap="compositionSheetOpen = false">
      <view class="admin-sheet" @tap.stop>
        <view class="admin-sheet-handle" />
        <view class="admin-sheet-head">
          <view>
            <text class="admin-sheet-title">人员配置</text>
            <text class="admin-sheet-sub">进入施工前必须至少配置 1 名工长、1 名主工长、1 名业主与 1 名主业主</text>
          </view>
          <view class="admin-sheet-close" @tap="compositionSheetOpen = false">
            <image class="admin-sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view class="compose-grid">
          <view class="compose-cell">
            <text class="compose-value">{{ composition.foremanCount }}</text>
            <text class="compose-label">工长</text>
          </view>
          <view class="compose-cell">
            <text class="compose-value">{{ composition.ownerCount }}</text>
            <text class="compose-label">业主</text>
          </view>
          <view class="compose-cell">
            <text class="compose-value compose-value--text">
              {{ composition.primaryForemanName || '未指定' }}
            </text>
            <text class="compose-label">主工长</text>
          </view>
          <view class="compose-cell">
            <text class="compose-value compose-value--text">
              {{ composition.primaryOwnerName || '未指定' }}
            </text>
            <text class="compose-label">主业主</text>
          </view>
        </view>

        <text class="compose-note">
          {{
            composition.meetsRequirement
              ? '人员已配齐，项目可以进入施工中。'
              : missingHint
          }}
        </text>
      </view>
    </view>

    <!-- 成员操作 -->
    <view v-if="memberSheetOpen" class="admin-sheet-mask" @tap="closeMemberSheet">
      <view class="admin-sheet" @tap.stop>
        <view class="admin-sheet-handle" />
        <view class="admin-sheet-head">
          <view>
            <text class="admin-sheet-title">成员操作</text>
            <text class="admin-sheet-sub">{{ project ? project.name : '' }}</text>
          </view>
          <view class="admin-sheet-close" @tap="closeMemberSheet">
            <image class="admin-sheet-close-icon" src="/static/images/icon-close.png" mode="aspectFit" />
          </view>
        </view>

        <view v-if="selectedMember" class="member-sheet-card">
          <image
            v-if="selectedMember.avatar"
            class="member-sheet-avatar member-sheet-avatar--image"
            :src="resolveMediaUrl(selectedMember.avatar)"
            mode="aspectFill"
          />
          <view v-else class="member-sheet-avatar">{{ selectedMemberInitial }}</view>
          <view class="member-sheet-main">
            <view class="member-sheet-name-row">
              <text class="member-sheet-name">{{ selectedMemberName }}</text>
              <text class="member-sheet-role">{{ selectedMemberRoleText }}</text>
            </view>
            <text class="member-sheet-phone">{{ selectedMember.phoneMasked || '未绑定手机号' }}</text>
          </view>
          <text class="member-sheet-status" :class="selectedMemberStatusTone">
            {{ selectedMemberStatusText }}
          </text>
        </view>

        <view class="action-list">
          <view v-if="canSetPrimary" class="action-row" @tap="setPrimary">
            <text>设为主工长</text>
            <image class="action-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
          <view v-if="canRemove" class="action-row action-row--danger" @tap="removeMember">
            <text>移除成员</text>
            <image class="action-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
          <text v-if="memberLockHint" class="action-hint">{{ memberLockHint }}</text>
        </view>
      </view>
    </view>

    <!-- 邀请成员 -->
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
import { onLoad, onPullDownRefresh, onShow } from '@dcloudio/uni-app'
import AdminRootHeader from '../../../components/admin/AdminRootHeader.vue'
import AdminHeaderAction from '../../../components/admin/AdminHeaderAction.vue'
import AdminMemberCard from '../../../components/admin/AdminMemberCard.vue'
import AdminPageState from '../../../components/admin/AdminPageState.vue'
import { resolveMediaUrl } from '../../../api/request'
import {
  fetchAdminProject,
  fetchAdminMembers,
  inviteAdminMember,
  setAdminPrimaryForeman,
  removeAdminMember,
} from '../../../api/admin/project'
import {
  memberRoleText,
  memberStatusText,
  requireAdminSession,
  showAdminError,
} from '../../../utils/admin'

defineOptions({ name: 'AdminProjectMembersPage' })

const INVITE_ROLES = [
  { key: 'foreman', label: '工长' },
  { key: 'owner', label: '业主（首位为主业主）' },
  { key: 'supervisor', label: '监理' },
]

const ROLE_FILTERS = [
  { key: '', label: '全部' },
  { key: 'foreman', label: '工长' },
  { key: 'supervisor', label: '监理' },
  { key: 'owner', label: '业主' },
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
const keyword = ref('')
const role = ref('')

const compositionSheetOpen = ref(false)
const memberSheetOpen = ref(false)
const selectedMember = ref(null)

const inviteOpen = ref(false)
const inviteSubmitting = ref(false)
const inviteError = ref('')
const invite = reactive({ phone: '', role: 'foreman' })

let loadedOnce = false
let pendingInvite = false

const fallback = computed(() =>
  projectId.value ? `/pages/admin/project/detail?id=${projectId.value}` : '/pages/admin/home/index?tab=projects'
)

const canWrite = computed(() => Boolean(project.value && project.value.status !== 'archived'))

// 含 pending：一个还没确认的主业主邀请同样占着名额
const hasPrimaryOwnerSlot = computed(() =>
  members.value.some(
    (member) => member.role === 'owner' && member.ownerType === 'primary' && member.status !== 'removed'
  )
)

const visibleMembers = computed(() => members.value.filter((member) => member.status !== 'removed'))

const roleOptions = computed(() =>
  ROLE_FILTERS.map((item) => ({
    ...item,
    count: item.key
      ? visibleMembers.value.filter((member) => member.role === item.key).length
      : visibleMembers.value.length,
  }))
)

const filteredMembers = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return visibleMembers.value.filter((member) => {
    if (role.value && member.role !== role.value) return false
    if (!q) return true
    const haystack = [
      member.realName,
      member.nickname,
      member.phoneMasked,
      memberRoleText(member),
      member.roleLabel,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
})

const emptyTitle = computed(() =>
  keyword.value || role.value ? '没有找到成员' : '还没有成员'
)

const emptyText = computed(() =>
  keyword.value || role.value
    ? '换个关键词或角色筛选试试'
    : '点击右上角「邀请成员」，对方确认后会出现在这里'
)

const missingParts = computed(() => {
  const parts = []
  if (Number(composition.value.foremanCount) < 1) parts.push('工长')
  if (!composition.value.primaryForemanUserId) parts.push('主工长')
  if (Number(composition.value.ownerCount) < 1) parts.push('业主')
  if (!composition.value.primaryOwnerActive) parts.push('主业主')
  return parts
})

const missingHint = computed(() =>
  missingParts.value.length
    ? `人员尚未配齐，暂时不能进入施工中。还需要：${missingParts.value.join('、')}。`
    : ''
)

const compositionHint = computed(() => {
  if (!project.value) return ''
  if (composition.value.meetsRequirement) return '人员已配齐，可以进入施工'
  return '待配齐，进入施工前需补齐工长、主工长、业主与主业主'
})

const selectedMemberName = computed(() => {
  const member = selectedMember.value
  if (!member) return ''
  return member.realName || member.nickname || member.phoneMasked || '待确认用户'
})

const selectedMemberInitial = computed(() => selectedMemberName.value.slice(0, 1) || '成')
const selectedMemberRoleText = computed(() => memberRoleText(selectedMember.value))
const selectedMemberStatusText = computed(() => memberStatusText(selectedMember.value))

const selectedMemberStatusTone = computed(() => {
  const status = selectedMember.value && selectedMember.value.status
  if (status === 'active') return 'member-sheet-status--green'
  if (status === 'pending') return 'member-sheet-status--orange'
  return 'member-sheet-status--gray'
})

const canSetPrimary = computed(() => {
  const member = selectedMember.value
  return Boolean(
    canWrite.value &&
      member &&
      member.role === 'foreman' &&
      member.status === 'active' &&
      !member.isPrimaryForeman
  )
})

const canRemove = computed(() => {
  const member = selectedMember.value
  if (!canWrite.value || !member) return false
  if (member.status === 'removed' || member.isPrimaryForeman) return false
  if (member.isPrimaryOwner && member.status === 'active') return false
  return true
})

const memberLockHint = computed(() => {
  const member = selectedMember.value
  if (!member) return ''
  if (!canWrite.value) return '项目已归档，成员只读'
  if (member.isPrimaryForeman) return '先改指主工长后可移除'
  if (member.isPrimaryOwner && member.status === 'active') return '主业主不可移除'
  if (!canSetPrimary.value && !canRemove.value) return '当前成员没有可执行的操作'
  return ''
})

onLoad(async (options) => {
  const id = options && options.id ? Number(options.id) : null
  projectId.value = Number.isInteger(id) && id > 0 ? id : null
  pendingInvite = Boolean(options && options.invite === '1')
  if (!projectId.value) {
    error.value = '缺少项目 id'
    return
  }

  try {
    const profile = await requireAdminSession()
    if (!profile) return
  } catch (err) {
    showAdminError(err, '管理员信息加载失败')
    return
  }

  await load()
  loadedOnce = true
  if (pendingInvite && canWrite.value) openInvite()
})

onShow(() => {
  if (loadedOnce) load(true)
})

onPullDownRefresh(async () => {
  try {
    if (projectId.value) await load(true)
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

function openMemberSheet(member) {
  selectedMember.value = member
  memberSheetOpen.value = true
}

function closeMemberSheet() {
  memberSheetOpen.value = false
  selectedMember.value = null
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

async function setPrimary() {
  const member = selectedMember.value
  if (!member) return
  const confirmed = await new Promise((resolve) => {
    uni.showModal({
      title: '设为主工长',
      content: `确定将「${selectedMemberName.value}」设为主工长吗？主工长只能有 1 名。`,
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    })
  })
  if (!confirmed) return

  try {
    await setAdminPrimaryForeman(projectId.value, member.id)
    uni.showToast({ title: '已设置', icon: 'success' })
    closeMemberSheet()
    await load(true)
  } catch (err) {
    showAdminError(err, '设置失败')
  }
}

async function removeMember() {
  const member = selectedMember.value
  if (!member) return
  if (member.isPrimaryOwner && member.status === 'active') {
    uni.showToast({ title: '主业主不可移除', icon: 'none' })
    return
  }

  const confirmed = await new Promise((resolve) => {
    uni.showModal({
      title: '移除成员',
      content: `确定移除「${selectedMemberName.value}」吗？主工长不能直接移除。`,
      confirmText: '移除',
      confirmColor: '#f53f3f',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    })
  })
  if (!confirmed) return

  try {
    await removeAdminMember(projectId.value, member.id)
    uni.showToast({ title: '已移除', icon: 'success' })
    closeMemberSheet()
    await load(true)
  } catch (err) {
    showAdminError(err, '移除失败')
  }
}
</script>

<style scoped lang="scss">
.content {
  padding: 0 dp(16) dp(20);
}

.scope-row {
  display: flex;
  align-items: center;
  margin-top: dp(2);
  padding: 0 dp(2);
}

.scope-main {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: dp(6);
}

.scope-text {
  overflow: hidden;
  color: #86909c;
  font-size: dp(13);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.scope-archived {
  padding: dp(2) dp(6);
  border-radius: dp(999);
  background: #f2f3f5;
  color: #86909c;
  font-size: dp(9);
  font-weight: 600;
  flex-shrink: 0;
}

.scope-caret {
  width: dp(14);
  height: dp(14);
  margin-left: dp(4);
  flex-shrink: 0;
}

.search-box {
  display: flex;
  align-items: center;
  height: dp(44);
  margin-top: dp(10);
  padding: 0 dp(12);
  @include glass-surface(dp(12), 18px);
  box-shadow:
    0 dp(2) dp(8) rgba(29, 33, 41, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.search-icon {
  width: dp(16);
  height: dp(16);
  margin-right: dp(7);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  min-width: 0;
  color: #1d2129;
  font-size: dp(14);
}

.search-placeholder {
  color: #86909c;
}

.search-clear {
  margin-left: dp(8);
  color: #eb5c20;
  font-size: dp(11);
  flex-shrink: 0;
}

.filter-row {
  display: flex;
  gap: dp(10);
  margin-top: dp(10);
}

.filter-chip {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  height: dp(36);
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: dp(999);
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.9) 0%,
    rgba(255, 255, 255, 0.66) 100%
  );
  -webkit-backdrop-filter: blur(14px) saturate(170%);
  backdrop-filter: blur(14px) saturate(170%);
  color: #4e5969;
  font-size: dp(13);
  font-weight: 500;
  white-space: nowrap;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.filter-chip--active {
  border-color: #eb5c20;
  background: #eb5c20;
  color: #fff;
  box-shadow: 0 dp(2) dp(6) rgba(235, 92, 32, 0.25);
  transform-origin: center;
  animation: gc-tab-pop 420ms cubic-bezier(0.2, 1.35, 0.35, 1) both;
}

.filter-count {
  margin-left: dp(3);
}

.filter-chip--active .filter-count {
  color: rgba(255, 255, 255, 0.9);
}

.compose-warning {
  margin-top: dp(12);
  padding: dp(11) dp(12);
  border: 1px solid #ffe7d6;
  border-radius: dp(12);
  background: #fff7f2;
  color: #c44710;
  font-size: dp(11);
  line-height: 1.6;
}

.member-list {
  display: flex;
  flex-direction: column;
  gap: dp(10);
  margin-top: dp(14);
}

.rules-card {
  margin-top: dp(14);
  padding: dp(16);
  @include glass-surface(dp(16), 18px);
  background: linear-gradient(
    135deg,
    rgba(255, 247, 242, 0.9) 0%,
    rgba(255, 235, 224, 0.7) 100%
  );
}

.rules-title {
  display: block;
  color: #eb5c20;
  font-size: dp(14);
  font-weight: 700;
}

.rules-text {
  display: block;
  margin-top: dp(6);
  color: #86909c;
  font-size: dp(12);
  line-height: 1.6;
}

.compose-grid {
  display: flex;
  margin-top: dp(14);
  padding: dp(14) 0;
  border-radius: dp(12);
  background: #f7f8fa;
}

.compose-cell {
  flex: 1;
  min-width: 0;
  text-align: center;
}

.compose-value {
  display: block;
  color: #1d2129;
  font-size: dp(18);
  font-weight: 700;
}

.compose-value--text {
  overflow: hidden;
  padding: 0 dp(4);
  font-size: dp(12);
  line-height: 1.8;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.compose-label {
  display: block;
  margin-top: dp(3);
  color: #86909c;
  font-size: dp(10);
}

.compose-note {
  display: block;
  margin-top: dp(12);
  color: #86909c;
  font-size: dp(11);
  line-height: 1.7;
}

.member-sheet-card {
  display: flex;
  align-items: center;
  margin-top: dp(14);
  padding: dp(14);
  border-radius: dp(14);
  background: #f7f8fa;
}

.member-sheet-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: dp(44);
  height: dp(44);
  margin-right: dp(12);
  border-radius: 50%;
  background: #fce5d6;
  color: #d85e22;
  font-size: dp(17);
  font-weight: 700;
  flex-shrink: 0;
}

.member-sheet-avatar--image {
  display: block;
  object-fit: cover;
}

.member-sheet-main {
  flex: 1;
  min-width: 0;
}

.member-sheet-name-row {
  display: flex;
  align-items: center;
  gap: dp(6);
}

.member-sheet-name {
  overflow: hidden;
  color: #1d2129;
  font-size: dp(15);
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.member-sheet-role {
  padding: dp(2) dp(8);
  border-radius: dp(999);
  background: #fff0e6;
  color: #eb5c20;
  font-size: dp(10);
  font-weight: 600;
  flex-shrink: 0;
}

.member-sheet-phone {
  display: block;
  margin-top: dp(4);
  color: #86909c;
  font-size: dp(12);
}

.member-sheet-status {
  margin-left: dp(8);
  padding: dp(4) dp(10);
  border-radius: dp(999);
  font-size: dp(11);
  font-weight: 600;
  flex-shrink: 0;
}

.member-sheet-status--green {
  background: #e8f8f0;
  color: #149a5d;
}

.member-sheet-status--orange {
  background: #fff1e8;
  color: #eb5c20;
}

.member-sheet-status--gray {
  background: #f2f3f5;
  color: #86909c;
}

.action-list {
  margin-top: dp(8);
}

.action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: dp(15) dp(2);
  border-bottom: 1px solid #f2f3f5;
  color: #1d2129;
  font-size: dp(14);
}

.action-row:last-child {
  border-bottom: none;
}

.action-row--danger {
  color: #f53f3f;
}

.action-chevron {
  width: dp(13);
  height: dp(13);
  opacity: 0.55;
  flex-shrink: 0;
}

.action-hint {
  display: block;
  padding: dp(14) dp(2) dp(4);
  color: #a79c92;
  font-size: dp(11);
  text-align: center;
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
