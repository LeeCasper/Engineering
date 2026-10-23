'use strict'

/**
 * 系统配置的纯逻辑单测（AC-AD65）。
 *
 * 只测校验与注册表自身的自洽性，不碰数据库 ——
 * 接口行为（权限、留痕、生效）在 tests/integration/adminConfig.test.js 里。
 */

const AppError = require('../../src/utils/AppError')
const sysConfig = require('../../src/services/sysConfig.service')
const upload = require('../../src/middlewares/upload')

describe('AC-AD65 配置值校验', () => {
  it('整数配置拒绝非整数与越界值', () => {
    expect(() => sysConfig.normalizeValue('report_max_images', '9.5')).toThrow(AppError)
    expect(() => sysConfig.normalizeValue('report_max_images', '0')).toThrow(AppError)
    expect(() => sysConfig.normalizeValue('report_max_images', '99')).toThrow(AppError)
    expect(() => sysConfig.normalizeValue('report_max_images', 'abc')).toThrow(AppError)

    expect(sysConfig.normalizeValue('report_max_images', '9')).toBe('9')
    // 表单传来的可能是数字而不是字符串，两种都要能收
    expect(sysConfig.normalizeValue('report_max_images', 5)).toBe('5')
  })

  it('比例配置按 0–100% 校验（0.1 表示 10%）', () => {
    // 比例大于 1 意味着大额支出的门槛比合同额还高，那条提醒永远不会触发
    expect(() => sysConfig.normalizeValue('big_expense_ratio', '1.5')).toThrow(AppError)
    expect(() => sysConfig.normalizeValue('big_expense_ratio', '0')).toThrow(AppError)
    expect(() => sysConfig.normalizeValue('big_expense_ratio', '-0.1')).toThrow(AppError)

    expect(sysConfig.normalizeValue('big_expense_ratio', '0.1')).toBe('0.1')
  })

  it('枚举配置只接受白名单内的取值', () => {
    expect(() => sysConfig.normalizeValue('gate_strength', 'very_strict')).toThrow(AppError)
    expect(sysConfig.normalizeValue('gate_strength', 'strict')).toBe('strict')
  })

  it('字符串配置去除首尾空白', () => {
    // 从微信后台复制模板 ID 时很容易带上空格，那种空格看不见，
    // 但会让模板 ID 匹配失败
    expect(sysConfig.normalizeValue('subscribe_template_progress', '  TPL-abc  ')).toBe('TPL-abc')
    expect(() => sysConfig.normalizeValue('support_contact', 'x'.repeat(200))).toThrow(AppError)
  })

  it('未知配置项一律拒绝', () => {
    // 放行的话，写入一个谁都不读的键既不会报错也不会生效，
    // 而管理员会以为配置成功了
    expect(() => sysConfig.normalizeValue('not_a_config', '1')).toThrow(AppError)
  })
})

describe('配置注册表自身的自洽性', () => {
  it('每个配置项都有默认值，且默认值本身合法', () => {
    for (const key of Object.keys(sysConfig.SCHEMA)) {
      // 订阅消息模板 ID 默认就是空（要从微信后台申请），因此只要求键存在
      expect(sysConfig.DEFAULTS).toHaveProperty(key)

      const raw = sysConfig.DEFAULTS[key]
      if (raw === '') continue
      // 「默认值落在合法区间之外」会让系统一出厂就带着一个改不回去的坏值：
      // 想恢复默认都做不到，因为默认值本身会被校验拒绝
      expect(() => sysConfig.normalizeValue(key, raw)).not.toThrow()
    }
  })

  it('每个配置项都写明了展示文案与需求编号', () => {
    for (const [key, spec] of Object.entries(sysConfig.SCHEMA)) {
      expect(spec.label, `${key} 缺 label`).toBeTruthy()
      expect(spec.requirement, `${key} 缺 requirement`).toBeTruthy()
    }
  })

  it('订阅消息模板 ID 的键名与消息服务读取的键名完全一致', () => {
    // resolveTemplateId 拼的是 `subscribe_template_${type}`。
    // 两处各写一遍的话，配置界面能保存、推送时却永远取不到值，且不会有任何报错
    const notificationService = require('../../src/services/notification.service')
    for (const type of notificationService.FILTERABLE_TYPES) {
      expect(sysConfig.SCHEMA).toHaveProperty(`subscribe_template_${type}`)
      // 模板 ID 来自小程序主体，只有平台能配置；租户后台必须只读
      expect(sysConfig.SCHEMA[`subscribe_template_${type}`].platformOnly).toBe(true)
    }
  })

  it('小程序品牌配置是平台专属，名称与 Logo 都有合法的默认值', () => {
    for (const key of ['miniapp_name', 'miniapp_logo']) {
      expect(sysConfig.SCHEMA).toHaveProperty(key)
      expect(sysConfig.SCHEMA[key].platformOnly).toBe(true)
      expect(sysConfig.DEFAULTS).toHaveProperty(key)
    }

    expect(sysConfig.normalizeValue('miniapp_name', '  住好家  ')).toBe('住好家')
    expect(() => sysConfig.normalizeValue('miniapp_name', 'x'.repeat(31))).toThrow(AppError)
    expect(sysConfig.normalizeValue('miniapp_logo', '')).toBe('')
  })

  it('可配置的附件上限不得超过传输层的文件数硬上限', () => {
    const imageMax = sysConfig.SCHEMA.report_max_images.max
    const videoMax = sysConfig.SCHEMA.report_max_videos.max

    // 超过的话会出现「把照片上限调到 15，结果第 11 张就报文件过多」，
    // 而那句错误看起来像客户端的问题
    expect(imageMax + videoMax).toBeLessThanOrEqual(upload.MAX_FILES)
  })
})
