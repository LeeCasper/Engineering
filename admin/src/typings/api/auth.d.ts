declare namespace Api {
  /**
   * namespace Auth
   *
   * 对应后端 `server/src/controllers/adminAuth.controller.js`。
   */
  namespace Auth {
    /** 登录后返回的身份信息 */
    interface AdminIdentity {
      id: number;
      username: string;
      /** platform = 平台运营；owner = 租户管理员；admin = 项目管理员 */
      role: 'platform' | 'owner' | 'admin';
      /** 平台账号为 null */
      tenantId: number | null;
      mustChangePassword: boolean;
    }

    interface LoginToken {
      token: string;
      expiresIn: string;
      mustChangePassword: boolean;
      admin: AdminIdentity;
    }

    interface LoginParams {
      username: string;
      password: string;
      captchaId: string;
      captchaAnswer: string;
      /** 两家公司可以有同名账号，租户管理员从专属管理地址里自动带上 */
      tenantCode?: string;
      /**
       * 登录门户：
       * - platform：根地址 /login，只接受平台运营账号
       * - tenant：/t/<tenantCode>/login，只接受该租户账号
       */
      portal?: 'platform' | 'tenant';
    }

    /** GET /admin/auth/captcha */
    interface Captcha {
      captchaId: string;
      /** 后端直接返回 SVG 字符串 */
      svg: string;
      /** 仅 NODE_ENV=development 时返回，生产环境不会有这个字段 */
      debugAnswer?: string;
    }

    /** GET /admin/auth/profile */
    interface Profile {
      id: number;
      username: string;
      role: 'platform' | 'owner' | 'admin';
      status: string;
      tenantId: number | null;
      mustChangePassword: boolean;
      passwordChangedAt: string | null;
    }

    interface UserInfo {
      userId: string;
      userName: string;
      roles: string[];
      buttons: string[];
      role: 'platform' | 'owner' | 'admin' | '';
      tenantId: number | null;
      mustChangePassword: boolean;
    }
  }
}
