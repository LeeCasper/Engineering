/**
 * 项目上下文。
 *
 * 登录只解决「你是谁」；「你在哪个项目里」是独立状态。C 端所有项目内页面
 * （进度 / 验收 / 记账 / 消息）都必须显式带一个 projectId，**不要默认取第一个项目** ——
 * 一个用户可能同时属于多个租户的多个项目，猜错就是把 A 项目的操作写到 B 项目。
 *
 * 这里只保存「用户进入过的项目」的摘要，不保存权限。权限每次都以后端
 * `project_member` 为准；项目列表刷新时若该项目已不可见（被移出 / 项目归档 /
 * 租户停用），立即清空，避免拿着旧上下文继续请求。
 */
const CURRENT_PROJECT_KEY = 'gc_current_project'

export function getCurrentProject() {
  const value = uni.getStorageSync(CURRENT_PROJECT_KEY)
  return value && value.id ? value : null
}

export function setCurrentProject(project) {
  if (!project || !project.id) return

  uni.setStorageSync(CURRENT_PROJECT_KEY, {
    id: project.id,
    tenantId: project.tenantId ?? project.tenant_id ?? null,
    tenantName: project.tenantName ?? project.tenant_name ?? null,
    name: project.name || '',
    role: project.myRole || project.my_role || null,
  })
}

export function clearCurrentProject() {
  uni.removeStorageSync(CURRENT_PROJECT_KEY)
}

function collectProjects(data) {
  const list = []
  const groups = (data && data.groups) || []

  for (const group of groups) {
    for (const item of group.items || []) list.push(item)
  }

  return list
}

/**
 * 列表刷新后同步当前项目：
 * - 当前项目还在列表里 → 保留；
 * - 已不可见 → 清空并告诉调用方（removed），由页面提示并回到列表；
 * - 没有当前项目且后端给了 autoEnterProjectId → 按 C-1.3 自动选中唯一项目。
 *   这里只建立上下文，不自动跳转：详情页需要先确认项目仍可见再加载。
 */
export function syncProjectContext(data, { autoSelect = true } = {}) {
  const projects = collectProjects(data)
  const ids = new Set(projects.map((item) => item.id))
  const current = getCurrentProject()

  if (current) {
    if (ids.has(current.id)) return { current, removed: false, autoSelected: false }

    // 旧上下文失效：先清空，再按 C-1.3 看看是否只剩一个可选项目。
    // removed 仍然为 true，让页面提示用户「上次进入的项目已不可用」。
    clearCurrentProject()

    const fallback = autoSelect && data && data.autoEnterProjectId
      ? projects.find((item) => item.id === data.autoEnterProjectId)
      : null

    if (fallback) {
      setCurrentProject(fallback)
      return { current: getCurrentProject(), removed: true, autoSelected: true }
    }

    return { current: null, removed: true, autoSelected: false }
  }

  if (autoSelect && data && data.autoEnterProjectId) {
    const only = projects.find((item) => item.id === data.autoEnterProjectId)

    if (only) {
      setCurrentProject(only)
      return { current: getCurrentProject(), removed: false, autoSelected: true }
    }
  }

  return { current: null, removed: false, autoSelected: false }
}

/**
 * 登录后的落点。
 *
 * 待确认邀请优先；其余一律回项目列表。角色在邀请时固定，不经过角色选择页，
 * 也不能挡在登录与项目列表之间。
 *
 * 详情页已实现，但登录仍默认落在项目列表：列表能同时承载邀请、多项目与
 * 无项目引导。单项目自动进入（C-1.3）作为后续优化，需先确认非 tab 页的返回栈。
 */
export function resolveProjectsLanding(data) {
  const hasPending = ((data && data.pendingInvitations) || []).length > 0
  return hasPending ? '/pages/projects/index?focus=invitations' : '/pages/projects/index'
}

/**
 * 项目内页面的守卫。下一批页面（详情 / 进度 / 验收 / 记账）在 onLoad 里调用：
 * 没有上下文就回项目列表，绝不默认第一个项目。
 */
export function requireCurrentProject() {
  const current = getCurrentProject()

  if (!current) {
    uni.redirectTo({ url: '/pages/projects/index' })
    return null
  }

  return current
}
