import type { ElegantConstRoute, ElegantRoute } from '@elegant-router/types';
import { layouts, views } from '../elegant/imports';
import { transformElegantRoutesToVueRoutes } from '../elegant/transform';

/**
 * 工程宝后台路由。
 *
 * 模板原本用 elegant-router 从 `src/views` 目录自动生成；本项目页面不多，
 * 且大量路由需要按角色（platform / owner / admin）过滤，因此改成显式声明 ——
 * 生成器只认目录结构，认不出「这条菜单只给租户管理员看」。
 *
 * **角色语义**（与后端 `requireTenant` / `requireTenantOwner` 对齐）：
 * - `platform`：平台运营，看租户，不看任何租户业务数据；
 * - `owner`：租户管理员，本租户全部；
 * - `admin`：项目管理员，本租户内被授权的项目。
 *
 * 没有 `roles` 的路由对所有已登录账号可见。
 */
const appRoutes = [
  // ── 常量路由 ──
  {
    name: 'login',
    path: '/login/:module(pwd-login|code-login|register|reset-pwd|bind-wechat)?',
    component: 'layout.blank$view.login',
    meta: { title: '登录', constant: true, hideInMenu: true }
  },
  {
    // 租户专属登录地址：/t/<tenantCode>/login
    //
    // 与平台入口 /login 分开是刻意设计：平台运营与租户管理员看到的是
    // 两个不同的地址，租户管理员不需要（也不应该）知道平台入口。
    // tenantCode 由路由参数带进登录页，不再让用户手工输入。
    name: 'tenant-login',
    path: '/t/:tenantCode/login',
    component: 'layout.blank$view.login',
    meta: { title: '租户登录', constant: true, hideInMenu: true }
  },
  {
    name: '403',
    path: '/403',
    component: 'layout.blank$view.403',
    meta: { title: '无权限', constant: true, hideInMenu: true }
  },
  {
    name: '404',
    path: '/404',
    component: 'layout.blank$view.404',
    meta: { title: '页面不存在', constant: true, hideInMenu: true }
  },
  {
    name: '500',
    path: '/500',
    component: 'layout.blank$view.500',
    meta: { title: '服务器错误', constant: true, hideInMenu: true }
  },

  // ── 业务路由 ──
  {
    name: 'home',
    path: '/home',
    component: 'layout.base$view.home',
    meta: {
      title: '工作台',
      icon: 'mdi:view-dashboard-outline',
      order: 1
    }
  },
  {
    name: 'project',
    path: '/project',
    component: 'layout.base',
    meta: {
      title: '项目管理',
      icon: 'mdi:home-city-outline',
      order: 2,
      roles: ['owner', 'admin', 'platform']
    },
    children: [
      {
        name: 'project_list',
        path: '/project/list',
        component: 'view.project_list',
        meta: {
          title: '项目列表',
          icon: 'mdi:format-list-bulleted',
          order: 1,
          roles: ['owner', 'admin', 'platform']
        }
      },
      {
        name: 'project_detail',
        path: '/project/detail/:id',
        component: 'view.project_detail',
        props: true,
        meta: {
          title: '项目详情',
          hideInMenu: true,
          activeMenu: 'project_list',
          roles: ['owner', 'admin', 'platform']
        }
      }
    ]
  },
  {
    name: 'template',
    path: '/template',
    component: 'layout.base$view.template',
    meta: {
      title: '阶段模板',
      icon: 'mdi:layers-triple-outline',
      order: 3,
      roles: ['owner', 'admin', 'platform']
    }
  },
  {
    name: 'account',
    path: '/account',
    component: 'layout.base$view.account',
    meta: {
      title: '账号管理',
      icon: 'mdi:account-cog-outline',
      order: 4,
      roles: ['owner', 'admin', 'platform']
    }
  },
  {
    name: 'config',
    path: '/config',
    component: 'layout.base$view.config',
    meta: {
      title: '系统配置',
      icon: 'mdi:cog-outline',
      order: 5,
      roles: ['owner', 'admin', 'platform']
    }
  },
  {
    name: 'log',
    path: '/log',
    component: 'layout.base',
    meta: {
      title: '日志中心',
      icon: 'mdi:file-clock-outline',
      order: 6,
      roles: ['owner', 'admin', 'platform']
    },
    children: [
      {
        name: 'log_operation',
        path: '/log/operation',
        component: 'view.log_operation',
        meta: {
          title: '操作日志',
          icon: 'mdi:file-document-outline',
          order: 1,
          roles: ['owner', 'admin', 'platform']
        }
      },
      {
        name: 'log_login',
        path: '/log/login',
        component: 'view.log_login',
        meta: {
          title: '登录日志',
          icon: 'mdi:login-variant',
          order: 2,
          roles: ['owner', 'admin', 'platform']
        }
      }
    ]
  },
  {
    name: 'content',
    path: '/content',
    component: 'layout.base$view.content',
    meta: {
      title: '内容页',
      icon: 'mdi:file-document-edit-outline',
      order: 7,
      roles: ['owner', 'admin', 'platform']
    }
  },
  {
    name: 'feedback',
    path: '/feedback',
    component: 'layout.base$view.feedback',
    meta: {
      title: '意见反馈',
      icon: 'mdi:message-alert-outline',
      order: 8,
      roles: ['owner', 'admin', 'platform']
    }
  },
  {
    name: 'export-task',
    path: '/export-task',
    component: 'layout.base$view.export-task',
    meta: {
      title: '我的导出',
      icon: 'mdi:tray-download',
      order: 10,
      roles: ['owner', 'admin', 'platform']
    }
  },
  {
    name: 'grant',
    path: '/grant',
    component: 'layout.base$view.grant',
    meta: {
      title: '排障授权',
      icon: 'mdi:shield-key-outline',
      order: 9,
      roles: ['owner']
    }
  },
  {
    name: 'platform',
    path: '/platform',
    component: 'layout.base',
    meta: {
      title: '平台运营',
      icon: 'mdi:office-building-outline',
      order: 2,
      roles: ['platform']
    },
    children: [
      {
        name: 'platform_tenant',
        // 与 elegant-router 依据 views/platform/tenant 生成的路径保持一致，
        // 否则页签按 path 反查路由名时会拿不到
        path: '/platform/tenant',
        component: 'view.platform_tenant',
        meta: {
          title: '租户管理',
          icon: 'mdi:domain-plus',
          order: 1,
          roles: ['platform']
        }
      }
    ]
  },
  {
    name: 'change-password',
    path: '/change-password',
    component: 'layout.base$view.change-password',
    meta: {
      title: '修改密码',
      hideInMenu: true,
      icon: 'mdi:lock-reset'
    }
  },
  {
    name: 'user-center',
    path: '/user-center',
    component: 'layout.base$view.user-center',
    meta: {
      title: '个人中心',
      hideInMenu: true,
      icon: 'ph:user-circle'
    }
  }
] as unknown as ElegantConstRoute[];

/** create routes when the auth route mode is static */
export function createStaticRoutes() {
  const constantRoutes: ElegantRoute[] = [];

  const authRoutes: ElegantRoute[] = [];

  appRoutes.forEach(item => {
    if (item.meta?.constant) {
      constantRoutes.push(item as ElegantRoute);
    } else {
      authRoutes.push(item as ElegantRoute);
    }
  });

  return {
    constantRoutes,
    authRoutes
  };
}

/**
 * Get auth vue routes
 *
 * @param routes Elegant routes
 */
export function getAuthVueRoutes(routes: ElegantConstRoute[]) {
  return transformElegantRoutesToVueRoutes(routes, layouts, views as any);
}
