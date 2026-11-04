<template>
  <view class="admin-page admin-page--cool admin-page--tabbar admin-page--fab">
    <AdminRootHeader title="成员管理" background="#F6F7F9" glass />

    <view class="content">
      <view class="search-box">
        <image class="search-icon" src="/static/images/icon-search.png" mode="aspectFit" />
        <input
          v-model="keyword"
          class="search-input"
          confirm-type="search"
          placeholder="搜索姓名 / 手机号 / 角色"
          placeholder-class="search-placeholder"
          @input="onKeywordInput"
        />
        <text v-if="keyword" class="search-clear" @tap="clearKeyword">清除</text>
      </view>

      <view class="scope-row" @tap="scopePickerOpen = true">
        <text class="scope-text">当前范围：{{ scopeProject ? scopeProject.name : '全部可见项目' }}</text>
        <image class="scope-caret" src="/static/images/icon-caret-down-gray.png" mode="aspectFit" />
      </view>

      <view class="filter-row">
        <view
          v-for="item in roleOptions"
          :key="item.key || 'all'"
          class="filter-chip"
          :class="{ 'filter-chip--active': role === item.key }"
          @tap="changeRole(item.key)"
        >
          <text>{{ item.label }}</text>
          <text v-if="item.count !== null" class="filter-count">{{ item.count }}</text>
        </view>
      </view>

      <AdminPageState
        :loading="loading && !members.length"
        :error="error"
        :empty="!loading && !error && !members.length"
        :empty-title="emptyTitle"
        :empty-text="emptyText"
        @retry="load(true)"
      />

      <view v-if="members.length" class="member-list gc-stagger">
        <view
          v-for="member in members"
          :key="member.id"
          class="member-item"
        >
          <AdminMemberCard :member="member" @select="openMemberSheet" />
        </view>

        <view v-if="members.length < total" class="load-more" @tap="loadMore">
          <gc-loading v-if="loadingMore" inline text="加载中" />
          <text v-else>加载更多</text>
        </view>
      </view>

      <view v-if="roleCounts" class="rules-card">
        <text class="rules-title">成员邀请规则</text>
        <text class="rules-text">手机号邀请 → 对方确认后生效；主工长每项目仅 1 人</text>
      </view>
    </view>

    <view class="invite-fab" @tap="openInvitePicker">
      <image class="invite-fab-icon" src="/static/images/icon-plus-white.png" mode="aspectFit" />
      <text>邀请成员</text>
    </view>

    <AdminTabBar active="members" />

    <AdminProjectPickerSheet
      :open="scopePickerOpen"
      title="选择成员范围"
      subtitle="按项目筛选成员，或查看全部可见项目"
      show-all
      all-label="全部可见项目"
      :selected-id="scopeProjectId"
      @close="scopePickerOpen = false"
      @select="chooseScope"
    />

    <AdminProjectPickerSheet
      :open="invitePickerOpen"
      title="选择项目"
      subtitle="邀请成员需要先选择要加入的项目"
      :allow-archived="false"
      @close="invitePickerOpen = false"
      @select="chooseInviteProject"
    />

    <view v-if="memberSheetOpen" class="admin-sheet-mask" @tap="closeMemberSheet">
      <view class="admin-sheet" @tap.stop>
        <view class="admin-sheet-handle" />
        <view class="admin-sheet-head">
          <view>
            <text class="admin-sheet-title">成员操作</text>
            <text class="admin-sheet-sub">成员关系始终绑定在具体项目上</text>
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
          <view v-else class="member-sheet-avatar">{{ memberInitial }}</view>
          <view class="member-sheet-main">
            <view class="member-sheet-name-row">
              <text class="member-sheet-name">{{ selectedMemberName }}</text>
              <text class="member-sheet-role">{{ selectedMemberRole }}</text>
            </view>
            <text class="member-sheet-phone">{{ selectedMember.phoneMasked || '未绑定手机号' }}</text>
            <text class="member-sheet-project">{{ selectedMember.projectName }}</text>
          </view>
          <text class="member-sheet-status" :class="selectedMemberStatusTone">
            {{ selectedMemberStatus }}
          </text>
        </view>

        <view class="action-list">
          <view
            v-if="canSetPrimary"
            class="action-row"
            @tap="setPrimary"
          >
            <text>设为主工长</text>
            <image class="action-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
          <view class="action-row" @tap="openProjectDetail">
            <text>查看项目详情</text>
            <image class="action-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
          <view v-if="canRemove" class="action-row action-row--danger" @tap="removeMember">
            <text>移除成员</text>
            <image class="action-chevron" src="/static/images/icon-chevron-right.png" mode="aspectFit" />
          </view>
          <text v-else-if="memberLockHint" class="action-hint">{{ memberLockHint }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import { onLoad, onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app'
import AdminRootHeader from '../../../components/admin/AdminRootHeader.vue'
import AdminTabBar from '../../../components/admin/AdminTabBar.vue'
import AdminMemberCard from '../../../components/admin/AdminMemberCard.vue'
import AdminPageState from '../../../components/admin/AdminPageState.vue'
import AdminProjectPickerSheet from '../../../components/admin/AdminProjectPickerSheet.vue'
import { resolveMediaUrl } from '../../../api/request'
import {
  fetchAdminMemberDirectory,
  setAdminPrimaryForeman,
  removeAdminMember,
} from '../../../api/admin/project'
import {
  memberRoleText,
  memberStatusText,
  requireAdminSession,
  showAdminError,
} from '../../../utils/admin'

defineOptions({ name: 'AdminMembersPage' })

const ROLE_OPTIONS = [
  { key: '', label: '全部', countKey: 'all' },
  { key: 'foreman', label: '工长', countKey: 'foreman' },
  { key: 'supervisor', label: '监理', countKey: 'supervisor' },
  { key: 'owner', label: '业主', countKey: 'owner' },
]

const profile = ref(null)
const members = ref([])
const total = ref(0)
const page = ref(1)
const totalPages = ref(1)
const pageSize = 20
const keyword = ref('')
const role = ref('')
const roleCounts = ref(null)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')

const scopeProjectId = ref(null)
const scopeProject = ref(null)
const scopePickerOpen = ref(false)
const invitePickerOpen = ref(false)

const memberSheetOpen = ref(false)
const selectedMember = ref(null)

let bootstrapped = false
let loadedOnce = false
let requestSeq = 0
let debounceTimer = null
let pendingInvite = false

const roleOptions = computed(() =>
  ROLE_OPTIONS.map((item) => ({
    ...item,
    count: roleCounts.value === null ? null : Number(roleCounts.value[item.countKey]) || 0,
  }))
)

const emptyTitle = computed(() =>
  keyword.value || role.value || scopeProject.value ? '没有找到成员' : '还没有成员'
)

const emptyText = computed(() => {
  if (keyword.value || role.value || scopeProject.value) {
    return '换个关键词或范围试试；成员目录只包含你有权限查看的项目'
  }
  return '在具体项目里邀请成员后，对方确认就会出现在这里'
})

const selectedMemberName = computed(() => {
  const member = selectedMember.value
  if (!member) return ''
  return member.nickname || member.phoneMasked || '待确认用户'
})

const memberInitial = computed(() => selectedMemberName.value.slice(0, 1) || '成')

const selectedMemberRole = computed(() => memberRoleText(selectedMember.value))
const selectedMemberStatus = computed(() => memberStatusText(selectedMember.value))

const selectedMemberStatusTone = computed(() => {
  const status = selectedMember.value && selectedMember.value.status
  if (status === 'active') return 'member-sheet-status--green'
  if (status === 'pending') return 'member-sheet-status--orange'
  return 'member-sheet-status--gray'
})

const memberWritable = computed(
  () => Boolean(selectedMember.value && selectedMember.value.projectStatus !== 'archived')
)

const canSetPrimary = computed(() => {
  const member = selectedMember.value
  return Boolean(
    memberWritable.value &&
      member &&
      member.role === 'foreman' &&
      member.status === 'active' &&
      !member.isPrimaryForeman
  )
})

const canRemove = computed(() => {
  const member = selectedMember.value
  if (!memberWritable.value || !member) return false
  if (member.status === 'removed' || member.isPrimaryForeman) return false
  if (member.isPrimaryOwner && member.status === 'active') return false
  return true
})

const memberLockHint = computed(() => {
  const member = selectedMember.value
  if (!member) return ''
  if (member.projectStatus === 'archived') return '项目已归档，成员只读'
  if (member.isPrimaryForeman) return '先改指主工长后可移除'
  if (member.isPrimaryOwner && member.status === 'active') return '主业主不可移除'
  return ''
})

onLoad(async (options) => {
  pendingInvite = Boolean(options && options.invite === '1')
  try {
    profile.value = await requireAdminSession()
  } catch (err) {
    showAdminError(err, '管理员信息加载失败')
  }
  bootstrapped = true
  if (profile.value) {
    await load(true)
    // 工作台「成员邀请」快捷入口直接进入邀请流程
    if (pendingInvite) invitePickerOpen.value = true
  }
})

onShow(() => {
  if (bootstrapped && loadedOnce && profile.value && !loading.value) {
    load(true, { silent: true })
  }
})

onPullDownRefresh(async () => {
  try {
    if (profile.value) await load(true, { silent: true })
  } finally {
    uni.stopPullDownRefresh()
  }
})

onReachBottom(() => {
  loadMore()
})

async function load(reset = false, { silent = false } = {}) {
  if (!profile.value) return
  if (!reset && (loading.value || loadingMore.value || page.value >= totalPages.value)) return

  const seq = ++requestSeq

  if (reset) {
    page.value = 1
    error.value = ''
    loadingMore.value = false
    if (!silent) loading.value = true
  } else {
    loadingMore.value = true
  }

  try {
    const data = await fetchAdminMemberDirectory({
      page: reset ? 1 : page.value + 1,
      pageSize,
      keyword: keyword.value.trim() || undefined,
      role: role.value || undefined,
      projectId: scopeProjectId.value || undefined,
    })
    if (seq !== requestSeq) return

    const list = (data && data.list) || []
    members.value = reset ? list : members.value.concat(list)
    total.value = (data && data.total) || 0
    page.value = (data && data.page) || (reset ? 1 : page.value + 1)
    totalPages.value = (data && data.totalPages) || 1
    roleCounts.value = (data && data.roleCounts) || {
      all: 0,
      foreman: 0,
      supervisor: 0,
      owner: 0,
    }
    loadedOnce = true
  } catch (err) {
    if (seq !== requestSeq) return
    if (silent && members.value.length) {
      showAdminError(err, '成员刷新失败')
    } else {
      error.value = err.message || '成员加载失败'
      showAdminError(err, '成员加载失败')
    }
  } finally {
    if (seq === requestSeq) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function loadMore() {
  if (!loading.value && !loadingMore.value && page.value < totalPages.value) load(false)
}

function resetAndLoad() {
  members.value = []
  total.value = 0
  load(true)
}

function onKeywordInput() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    resetAndLoad()
  }, 320)
}

function clearKeyword() {
  if (!keyword.value) return
  keyword.value = ''
  resetAndLoad()
}

function changeRole(key) {
  if (role.value === key) return
  role.value = key
  resetAndLoad()
}

function chooseScope(project) {
  scopePickerOpen.value = false
  scopeProjectId.value = project && project.id ? project.id : null
  scopeProject.value = project || null
  resetAndLoad()
}

function openInvitePicker() {
  if (profile.value) invitePickerOpen.value = true
}

function chooseInviteProject(project) {
  invitePickerOpen.value = false
  if (!project || !project.id) return
  uni.navigateTo({ url: `/pages/admin/project/members?id=${project.id}&invite=1` })
}

function openMemberSheet(member) {
  selectedMember.value = member
  memberSheetOpen.value = true
}

function closeMemberSheet() {
  memberSheetOpen.value = false
  selectedMember.value = null
}

function openProjectDetail() {
  const member = selectedMember.value
  if (!member) return
  const projectId = member.projectId
  closeMemberSheet()
  uni.navigateTo({ url: `/pages/admin/project/detail?id=${projectId}` })
}

async function setPrimary() {
  const member = selectedMember.value
  if (!member) return
  const confirmed = await new Promise((resolve) => {
    uni.showModal({
      title: '设为主工长',
      content: `确定将「${selectedMemberName.value}」设为主工长吗？主工长每项目仅 1 人。`,
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    })
  })
  if (!confirmed) return

  try {
    await setAdminPrimaryForeman(member.projectId, member.id)
    uni.showToast({ title: '已设置', icon: 'success' })
    closeMemberSheet()
    await load(true, { silent: true })
  } catch (err) {
    showAdminError(err, '设置失败')
  }
}

async function removeMember() {
  const member = selectedMember.value
  if (!member) return
  const confirmed = await new Promise((resolve) => {
    uni.showModal({
      title: '移除成员',
      content: `确定将「${selectedMemberName.value}」从「${member.projectName}」移除吗？`,
      confirmText: '移除',
      confirmColor: '#f53f3f',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    })
  })
  if (!confirmed) return

  try {
    await removeAdminMember(member.projectId, member.id)
    uni.showToast({ title: '已移除', icon: 'success' })
    closeMemberSheet()
    await load(true, { silent: true })
  } catch (err) {
    showAdminError(err, '移除失败')
  }
}
</script>

<style scoped lang="scss">
/* 邀请成员固定在右下角，浮在列表之上、管理端 tabBar 之上 */
.invite-fab {
  position: fixed;
  right: dp(16);
  bottom: calc(#{dp(76)} + env(safe-area-inset-bottom));
  z-index: 40;
  display: flex;
  align-items: center;
  gap: dp(5);
  height: dp(44);
  padding: 0 dp(18);
  border-radius: dp(999);
  background: #eb5c20;
  color: #fff;
  font-size: dp(14);
  font-weight: 600;
  box-shadow:
    0 dp(6) dp(18) rgba(235, 92, 32, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.28);
}

.invite-fab:active {
  background: #c44710;
}

.invite-fab-icon {
  width: dp(14);
  height: dp(14);
}

.content {
  padding: 0 dp(16) dp(16);
}

.admin-page--fab .content {
  padding-bottom: dp(68);
}

.search-box {
  display: flex;
  align-items: center;
  height: dp(44);
  margin-top: dp(2);
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

.scope-row {
  display: flex;
  align-items: center;
  margin-top: dp(10);
  padding: 0 dp(2);
}

.scope-text {
  overflow: hidden;
  color: #86909c;
  font-size: dp(13);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.scope-caret {
  width: dp(14);
  height: dp(14);
  margin-left: dp(4);
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

.member-list {
  display: flex;
  flex-direction: column;
  gap: dp(10);
  margin-top: dp(14);
}

.load-more {
  padding: dp(12) 0;
  color: #eb5c20;
  font-size: dp(12);
  text-align: center;
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

.member-sheet-project {
  display: block;
  margin-top: dp(2);
  overflow: hidden;
  color: #86909c;
  font-size: dp(11);
  white-space: nowrap;
  text-overflow: ellipsis;
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
</style>
