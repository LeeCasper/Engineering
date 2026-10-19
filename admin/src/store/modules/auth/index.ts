import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { defineStore } from 'pinia';
import { useLoading } from '@sa/hooks';
import { fetchGetUserInfo, fetchLogin, fetchLogout } from '@/service/api';
import { useRouterPush } from '@/hooks/common/router';
import { localStg } from '@/utils/storage';
import { SetupStoreId } from '@/enum';
import { useRouteStore } from '../route';
import { useTabStore } from '../tab';
import { clearAuthStorage, getToken } from './shared';

export const useAuthStore = defineStore(SetupStoreId.Auth, () => {
  const route = useRoute();
  const authStore = useAuthStore();
  const routeStore = useRouteStore();
  const tabStore = useTabStore();
  const { toLogin, redirectFromLogin, routerPush, routerPushByKey } = useRouterPush(false);
  const { loading: loginLoading, startLoading, endLoading } = useLoading();

  const token = ref(getToken());

  const userInfo: Api.Auth.UserInfo = reactive({
    userId: '',
    userName: '',
    roles: [],
    buttons: [],
    role: '',
    tenantId: null,
    mustChangePassword: false
  });

  /** is super role in static route（本项目刻意不设旁路） */
  const isStaticSuper = computed(() => {
    const { VITE_AUTH_ROUTE_MODE, VITE_STATIC_SUPER_ROLE } = import.meta.env;

    return VITE_AUTH_ROUTE_MODE === 'static' && userInfo.roles.includes(VITE_STATIC_SUPER_ROLE);
  });

  /** Is login */
  const isLogin = computed(() => Boolean(token.value));

  const isPlatform = computed(() => userInfo.role === 'platform');
  const isTenantOwner = computed(() => userInfo.role === 'owner');
  const isProjectAdmin = computed(() => userInfo.role === 'admin');

  /** Reset auth store */
  async function resetStore() {
    recordUserId();

    clearAuthStorage();

    authStore.$reset();

    if (!route.meta.constant) {
      // 租户管理员会话失效后必须回到**自己的**登录地址：
      // 平台入口 /login 会（正确地）拒绝租户账号，把人送到那里等于二次伤害
      const loginTenantCode = localStg.get('loginTenantCode');

      if (loginTenantCode) {
        await routerPush(`/t/${encodeURIComponent(loginTenantCode)}/login`);
      } else {
        await toLogin();
      }
    }

    // 不保留上一个会话的页签：首登改密流程结束后重新登录，
    // 不该再看到「修改密码」这一页；会话失效时也避免把上一轮的页面带回来
    tabStore.clearTabs();
    localStg.remove('globalTabs');
    routeStore.resetStore();
  }

  /** 登出：先让服务端删掉会话键，再清本地。失败也继续清本地，否则用户卡在登录态 */
  async function logout() {
    try {
      await fetchLogout();
    } finally {
      await resetStore();
    }
  }

  /** Record the user ID of the previous login session Used to compare with the current user ID on next login */
  function recordUserId() {
    if (!userInfo.userId) {
      return;
    }

    localStg.set('lastLoginUserId', userInfo.userId);
  }

  /**
   * Check if current login user is different from previous login user If different, clear all tabs
   *
   * @returns {boolean} Whether to clear all tabs
   */
  function checkTabClear(): boolean {
    if (!userInfo.userId) {
      return false;
    }

    const lastLoginUserId = localStg.get('lastLoginUserId');

    if (lastLoginUserId !== userInfo.userId) {
      localStg.remove('globalTabs');
      tabStore.clearTabs();

      return true;
    }

    return false;
  }

  /**
   * 登录。
   *
   * 返回 false 表示失败（错误提示已由请求层弹出），调用方据此刷新验证码 ——
   * 验证码是一次性的，失败后不复用。
   */
  async function login(params: Api.Auth.LoginParams, redirect = true): Promise<boolean> {
    startLoading();

    // 记住本次登录用的是哪个门户。租户会话失效后据此回到租户专属地址；
    // 平台登录则清掉，避免把平台运营也带进某个租户的登录页。
    if (params.portal === 'tenant' && params.tenantCode) {
      localStg.set('loginTenantCode', params.tenantCode);
    } else {
      localStg.remove('loginTenantCode');
    }

    let pass = false;

    try {
      const { data: loginToken, error } = await fetchLogin(params);

      if (!error) {
        pass = await loginByToken(loginToken);

        if (pass) {
          // 首登强制改密：后端只放行改密/资料/登出三个接口，
          // 因此必须先把人送到改密页，不能先跳首页再被 403 弹回来。
          //
          // 登录接口返回时，路由表里还只有常量路由（403/404/500/login）——
          // 业务路由要等第一次导航时由 routeStore 初始化。直接 push 命名路由
          // 会报 "No match for {name:'change-password'}"，因此这里先初始化。
          if (userInfo.mustChangePassword) {
            await routeStore.initAuthRoute();
            await routerPushByKey('change-password' as any);
            return true;
          }

          const isClear = checkTabClear();
          let needRedirect = redirect;

          if (isClear) {
            needRedirect = false;
          }
          await redirectFromLogin(needRedirect);

          window.$notification?.success({
            title: '登录成功',
            message: `欢迎回来，${userInfo.userName}`,
            duration: 3000
          });
        }
      }
    } finally {
      endLoading();
    }

    return pass;
  }

  async function loginByToken(loginToken: Api.Auth.LoginToken) {
    // 1. stored in the localStorage, the later requests need it in headers
    localStg.set('token', loginToken.token);

    // 2. get user info
    const pass = await getUserInfo();

    if (pass) {
      token.value = loginToken.token;

      return true;
    }

    return false;
  }

  async function getUserInfo() {
    const { data: info, error } = await fetchGetUserInfo();

    if (!error) {
      Object.assign(userInfo, {
        userId: String(info.id),
        userName: info.username,
        roles: [info.role],
        buttons: [],
        role: info.role,
        tenantId: info.tenantId ?? null,
        mustChangePassword: info.mustChangePassword
      });

      return true;
    }

    return false;
  }

  async function initUserInfo() {
    const hasToken = getToken();

    if (hasToken) {
      const pass = await getUserInfo();

      if (!pass) {
        resetStore();
      }
    }
  }

  return {
    token,
    userInfo,
    isStaticSuper,
    isLogin,
    isPlatform,
    isTenantOwner,
    isProjectAdmin,
    loginLoading,
    resetStore,
    logout,
    login,
    initUserInfo
  };
});
