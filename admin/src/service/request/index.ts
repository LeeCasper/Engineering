import type { AxiosResponse } from 'axios';
import { createFlatRequest, createRequest } from '@sa/axios';
import { useAuthStore } from '@/store/modules/auth';
import { getServiceBaseURL } from '@/utils/service';
import { getAuthorization, getTenantContext, showErrorMsg, TENANT_CONTEXT_HEADER } from './shared';
import type { RequestInstanceState } from './type';

const isHttpProxy = import.meta.env.DEV && import.meta.env.VITE_HTTP_PROXY === 'Y';
const { baseURL, otherBaseURL } = getServiceBaseURL(import.meta.env, isHttpProxy);

/**
 * 后台统一请求实例。
 *
 * 后端响应体是 `{ code, message, data }`（需求文档 §7.2），成功码为 0。
 * 与 Soybean 模板默认的 `0000 + msg` 不同，因此这里改了三处：
 *   1. `VITE_SERVICE_SUCCESS_CODE=0`；
 *   2. 错误消息取 `message` 而不是 `msg`；
 *   3. 去掉 refresh-token 流程 —— 本项目没有 refresh token，
 *      改密/禁用会让 token 立即失效，正确做法是回登录页。
 */
export const request = createFlatRequest(
  {
    baseURL
  },
  {
    defaultState: {
      errMsgStack: [],
      refreshTokenPromise: null
    } as RequestInstanceState,
    transform(response: AxiosResponse<App.Service.Response<any>>) {
      return response.data.data;
    },
    async onRequest(config) {
      const Authorization = getAuthorization();
      Object.assign(config.headers, { Authorization });

      // 平台账号持租户授权排障时，后端只读窗口由这个头触发。
      // 租户账号不写这个头，避免「拿着自己的身份假装在别家」。
      const tenantId = getTenantContext();
      if (tenantId) {
        config.headers.set(TENANT_CONTEXT_HEADER, String(tenantId));
      }

      return config;
    },
    isBackendSuccess(response) {
      return String(response.data.code) === String(import.meta.env.VITE_SERVICE_SUCCESS_CODE);
    },
    async onBackendFail() {
      // 本项目所有失败都带非 2xx 状态码，走 onError；这里只需把控制权交回去
      return null;
    },
    onError(error) {
      let message = error.message;
      let code = '';
      const status = error.response?.status;

      // 后端的业务错误是「HTTP 4xx + { code, message }」，axios 会把它当作
      // HTTP 错误（ERR_BAD_REQUEST / ERR_BAD_RESPONSE），而不是 BACKEND_ERROR_CODE。
      // 因此这里不能再按 BACKEND_ERROR_CODE 判断 —— 否则用户看到的永远是
      // 「Request failed with status code 409」，而不是后端那句
      // 「人员尚未配齐，不能流转到施工中」。
      const body = error.response?.data;

      if (body && typeof body === 'object' && 'message' in body) {
        message = (body as App.Service.Response).message || message;
        code = String((body as App.Service.Response).code || '');
      }

      // HTTP 状态码与 code 同值（需求文档 §7.2）。两者任一为 401 都意味着登录态失效：
      // 清掉本地会话并回登录页，不要再弹一条「登录已失效」的红色提示 ——
      // 用户已经在登录页上了，那条提示只会让人以为是登录本身失败。
      if (status === 401 || code === '401') {
        void useAuthStore().resetStore();
        return;
      }

      showErrorMsg(request.state, message);
    }
  }
);

/** 模板自带的 demo 请求实例，本项目未使用，保留以免删掉示例页面时连锁报错 */
export const demoRequest = createRequest(
  {
    baseURL: otherBaseURL.demo
  },
  {
    transform(response: AxiosResponse<App.Service.DemoResponse>) {
      return response.data.result;
    },
    isBackendSuccess(response) {
      return response.data.status === '200';
    }
  }
);
