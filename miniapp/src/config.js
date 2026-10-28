/**
 * 小程序运行配置。
 *
 * ── 本地联调 ──
 * 微信开发者工具里需要在「详情 → 本地设置」勾选
 * **不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书**，
 * 否则 `http://127.0.0.1:3000` 会被拦截。
 * 真机调试时改为局域网 IP（例如 http://192.168.1.20:3000/api/v1）。
 *
 * 生产环境必须是已在小程序后台配置的 HTTPS 域名。
 */
export const API_BASE =
  import.meta.env.VITE_API_BASE || 'http://127.0.0.1:3000/api/v1'

/**
 * H5 / 非微信端的开发用 code。
 *
 * 后端在 `WX_MOCK=true` 时由 code 派生稳定 openid，因此这里固定一个值，
 * 保证反复预览时始终是同一个账号。微信小程序端不会用到它。
 */
export const DEV_WX_CODE = 'gongchengbao-h5-dev'

/**
 * 微信开发者工具（dev 构建）使用的固定 code。
 *
 * 开发者工具每次编译的 `uni.login` code 都会变，后端在 WX_MOCK=true 时按 code
 * 派生 openid —— 于是清缓存 / 重新编译就会变成一个新用户，手机号会撞上旧账号
 * （「该手机号已被其他账号绑定」）。dev 构建改用固定 code，保证无论编译多少次
 * 都回到同一个测试账号；**正式构建不会用到它**。
 */
export const DEV_MP_WX_CODE = 'gongchengbao-mp-dev'

/**
 * 是否允许开发环境直接输入手机号绑定。
 *
 * 只有后端 WX_MOCK=true（没有真实 AppID/Secret）时才应该打开；
 * 现在已配置真实微信凭据，默认走 getPhoneNumber。
 * 需要临时调试 mock 绑定时，在环境变量里设置 VITE_DEV_PHONE_BIND=true。
 */
export const DEV_PHONE_BIND = import.meta.env.VITE_DEV_PHONE_BIND === 'true'

/** 角色展示文案与顺序 */
export const ROLES = [
  {
    key: 'foreman',
    name: '工长',
    subtitle: '现场施工负责人',
    description: '汇报进度、登记支出、发起验收、提交结算',
    avatarBg: '#eb5c20',
    avatarIcon: '/static/images/icon-user-white.png',
    image: '/static/images/role-foreman.jpg',
  },
  {
    key: 'supervisor',
    name: '监理',
    subtitle: '质量监督方',
    description: '审核验收、查看进度、提出整改',
    avatarBg: '#10b981',
    avatarIcon: '/static/images/icon-shield-white.png',
    image: '/static/images/role-supervisor.jpg',
  },
  {
    key: 'owner',
    name: '业主',
    subtitle: '项目出资方',
    description: '查看进度、确认验收、核对账目',
    avatarBg: '#d97706',
    avatarIcon: '/static/images/icon-user-white.png',
    image: '/static/images/role-owner.jpg',
  },
]

export const ROLE_LABELS = {
  foreman: '工长',
  supervisor: '监理',
  owner: '业主',
}

export const PROJECT_STATUS_LABELS = {
  pending: '待开工',
  building: '施工中',
  finished: '已完工',
  archived: '已归档',
}
