<template>
  <view class="admin-home">
    <WorkbenchView
      v-if="visited.workbench"
      v-show="tab === 'workbench'"
      ref="workbenchRef"
      :active="tab === 'workbench'"
    />
    <ProjectsView
      v-if="visited.projects"
      v-show="tab === 'projects'"
      ref="projectsRef"
      :active="tab === 'projects'"
      :mode="projectMode"
    />
    <MembersView
      v-if="visited.members"
      v-show="tab === 'members'"
      ref="membersRef"
      :active="tab === 'members'"
      :invite="inviteMembers"
    />
    <ProfileView
      v-if="visited.profile"
      v-show="tab === 'profile'"
      ref="profileRef"
      :active="tab === 'profile'"
    />

    <AdminTabBar v-if="!hideTabBar" :active="tab" @change="switchTab" />
  </view>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'
import { onLoad, onPageScroll, onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app'
import AdminTabBar from '../../../components/admin/AdminTabBar.vue'
import WorkbenchView from '../../../components/admin/views/WorkbenchView.vue'
import ProjectsView from '../../../components/admin/views/ProjectsView.vue'
import MembersView from '../../../components/admin/views/MembersView.vue'
import ProfileView from '../../../components/admin/views/ProfileView.vue'
import { adminTabRequest, ADMIN_TAB_NAMES, requestAdminTab } from '../../../store/adminTabs'

defineOptions({ name: 'AdminHomePage' })

/**
 * 管理端壳页。
 *
 * 四个顶层 tab 是同一页面内的视图（v-show 保持挂载），底栏只渲染一次：
 * C 端用原生 tabBar + switchTab 达到「切页不重建」，管理端用这个壳页达到同样效果。
 * 微信只允许一套 tabBar（最多 5 个），且 tabBar 页必须在主包，管理端页面在分包里，
 * 因此不能直接注册成原生 tab；不要再把这里改回 redirectTo 的四个独立页面。
 */
const TAB_NAMES = ADMIN_TAB_NAMES

const tab = ref('workbench')
// 首次访问才挂载视图，之后用 v-show 保活；避免一次启动就打四组接口
const visited = ref({ workbench: true })
// 工作台「阶段管理」入口：项目 tab 以阶段模式打开时隐藏底栏
const projectMode = ref('')
// 工作台「成员邀请」入口：切到成员 tab 时直接打开邀请面板
const inviteMembers = ref(false)

const hideTabBar = ref(false)
const workbenchRef = ref(null)
const projectsRef = ref(null)
const membersRef = ref(null)
const profileRef = ref(null)

const scrollTops = {}
let lastScrollTop = 0
let shownOnce = false

const VIEW_REFS = {
  workbench: workbenchRef,
  projects: projectsRef,
  members: membersRef,
  profile: profileRef,
}

/** 当前可见视图的刷新方法；视图未挂载时返回 null */
function activeView() {
  return VIEW_REFS[tab.value] ? VIEW_REFS[tab.value].value : null
}

function normalizeTab(name) {
  return TAB_NAMES.includes(name) ? name : 'workbench'
}

/**
 * 切 tab：只改视图可见性，不跳页面。
 * 底栏和页面实例都保持挂载，真机不会闪。
 */
async function switchTab(name) {
  const next = normalizeTab(name)
  if (next === tab.value) return

  scrollTops[tab.value] = lastScrollTop
  if (next !== 'projects') {
    projectMode.value = ''
    hideTabBar.value = false
  }
  if (next !== 'members') inviteMembers.value = false

  tab.value = next
  if (!visited.value[next]) visited.value = { ...visited.value, [next]: true }

  await nextTick()
  uni.pageScrollTo({ scrollTop: scrollTops[next] || 0, duration: 0 })
}

/* dev-only:start 自动化测试入口：直接调用壳页切 tab，正式构建整段删除 */
if (import.meta.env.DEV && typeof getApp === 'function') {
  const app = getApp()
  if (app) {
    app.__switchAdminTab = switchTab
    app.__requestAdminTab = requestAdminTab
  }
}
/* dev-only:end */

onLoad((options) => {
  const wanted = normalizeTab(options && options.tab)
  const mode = options && options.mode === 'stages' ? 'stages' : ''
  const invite = Boolean(options && options.invite === '1')

  if (wanted === 'projects' && mode === 'stages') {
    projectMode.value = 'stages'
    hideTabBar.value = true
  }
  if (wanted === 'members' && invite) inviteMembers.value = true

  tab.value = wanted
  visited.value = { ...visited.value, [wanted]: true }
})

// 视图内部（工作台快捷入口 / 我的管理工具）发起的 tab 切换
watch(adminTabRequest, (request) => {
  if (!request || !request.name) return
  const options = request.options || {}

  if (request.name === 'projects' && options.mode === 'stages') {
    hideTabBar.value = true
    projectMode.value = 'stages'
    switchTab('projects')
    return
  }
  if (request.name === 'members' && options.invite) {
    inviteMembers.value = true
  }
  hideTabBar.value = false
  switchTab(request.name)
})

onShow(() => {
  // 首屏由各视图自己 onMounted；从详情页返回时刷新当前 tab
  if (shownOnce) {
    const view = activeView()
    if (view && typeof view.refresh === 'function') view.refresh()
  }
  shownOnce = true
})

onPullDownRefresh(async () => {
  try {
    const view = activeView()
    if (view && typeof view.refresh === 'function') await view.refresh()
  } finally {
    uni.stopPullDownRefresh()
  }
})

onReachBottom(() => {
  const view = activeView()
  if (view && typeof view.loadMore === 'function') view.loadMore()
})

onPageScroll((e) => {
  lastScrollTop = e.scrollTop || 0
})
</script>

<style scoped lang="scss">
.admin-home {
  min-height: 100vh;
  background: #f6f7f9;
}
</style>
