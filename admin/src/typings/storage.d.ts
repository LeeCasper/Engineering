/** The storage namespace */
declare namespace StorageType {
  interface Session {
    /** The theme color */
    themeColor: string;
    // /**
    //  * the theme settings
    //  */
    // themeSettings: App.Theme.ThemeSetting;
  }

  interface Local {
    /** The i18n language */
    lang: App.I18n.LangType;
    /** The token */
    token: string;
    /** Fixed sider with mix-menu */
    mixSiderFixed: CommonType.YesOrNo;
    /** The refresh token */
    refreshToken: string;
    /** The theme color */
    themeColor: string;
    /** The dark mode */
    darkMode: boolean;
    /** The theme settings */
    themeSettings: App.Theme.ThemeSetting;
    /**
     * The override theme flags
     *
     * The value is the build time of the project
     */
    overrideThemeFlag: string;
    /** The global tabs */
    globalTabs: App.Global.Tab[];
    /** The backup theme setting before is mobile */
    backupThemeSettingBeforeIsMobile: {
      layout: UnionKey.ThemeLayoutMode;
      siderCollapse: boolean;
    };

    /** The last login user id */
    lastLoginUserId: string;

    /**
     * 平台排障访问时的目标租户。
     *
     * 平台账号默认看不到任何租户数据；持租户授予的窗口时，前端把它写进
     * 请求头 `X-Tenant-Id`。空字符串表示没有上下文。
     */
    tenantContext: string;

    /** 排障访问时显示的租户名称（仅 UI 用） */
    tenantContextName: string;

    /**
     * 最近一次登录使用的租户专属登录标识。
     *
     * 会话失效/登出后据此回到 `/t/<code>/login`，而不是把租户管理员
     * 甩到平台入口 —— 那个入口会（正确地）拒绝租户账号。
     */
    loginTenantCode: string;
  }
}
