'use strict'

/**
 * 微信订阅消息的纯逻辑单测。
 *
 * 只验证「模板关键词映射 → data」这一段：它决定了发出去的报文能不能被微信接受，
 * 且完全不需要网络与数据库。真正的发送在 wx.service，集成测试用 WX_MOCK 覆盖。
 */

const notificationService = require('../../src/services/notification.service')
const sysConfigService = require('../../src/services/sysConfig.service')

describe('订阅消息模板数据映射', () => {
  it('五类消息都有内置映射，且来源都在允许清单里', () => {
    for (const type of notificationService.FILTERABLE_TYPES) {
      const map = sysConfigService.SUBSCRIBE_FIELD_DEFAULTS[type]
      expect(map, `${type} 缺少内置映射`).toBeTruthy()

      for (const source of Object.values(map)) {
        // 来源写错时 parseFieldMap 会整条丢弃；默认值本身必须是对的，
        // 否则「未配置」的用户永远组不出 data
        expect(notificationService.SUBSCRIBE_DATA_SOURCES.has(source)).toBe(true)
      }
    }
  })

  it('留空时回落到内置映射', () => {
    expect(notificationService.parseFieldMap('acceptance', '')).toEqual(
      sysConfigService.SUBSCRIBE_FIELD_DEFAULTS.acceptance
    )
    expect(notificationService.parseFieldMap('acceptance', null)).toEqual(
      sysConfigService.SUBSCRIBE_FIELD_DEFAULTS.acceptance
    )
  })

  it('非法 JSON / 非对象回落到内置映射而不是让推送停摆', () => {
    expect(notificationService.parseFieldMap('comment', '{not json')).toEqual(
      sysConfigService.SUBSCRIBE_FIELD_DEFAULTS.comment
    )
    expect(notificationService.parseFieldMap('comment', '["thing1"]')).toEqual(
      sysConfigService.SUBSCRIBE_FIELD_DEFAULTS.comment
    )
    // 全部条目都不合法时同样是回落，而不是返回空对象
    expect(notificationService.parseFieldMap('payment', '{"thing1":"openid"}')).toEqual(
      sysConfigService.SUBSCRIBE_FIELD_DEFAULTS.payment
    )
  })

  it('只保留合法关键词与已知来源', () => {
    const map = notificationService.parseFieldMap(
      'payment',
      '{"thing1":"title","bad-key":"title","time2":"unknown","thing3":"projectName"}'
    )

    expect(map).toEqual({ thing1: 'title', thing3: 'projectName' })
  })

  it('按模板关键词类型截断：thing 20 字、phrase 5 字、character_string 32 字', () => {
    const twenty = '一二三四五六七八九十一二三四五六七八九十'
    const five = '已通过'

    expect(notificationService.formatTemplateValue('thing1', `${twenty}多出来的`)).toBe(twenty)
    expect(notificationService.formatTemplateValue('phrase2', '验收已通过了')).toBe('验收已通过')
    expect(notificationService.formatTemplateValue('phrase2', five)).toBe(five)
    expect(notificationService.formatTemplateValue('character_string3', 'x'.repeat(40))).toBe(
      'x'.repeat(32)
    )
    // 未识别的前缀按 thing 处理，避免把任意长文本直接抛给微信
    expect(notificationService.formatTemplateValue('custom1', 'x'.repeat(40))).toBe('x'.repeat(20))
  })

  it('时间按微信可识别的中文格式生成，分类带出展示名', () => {
    const values = notificationService.buildTemplateValues({
      projectName: '阳光花园',
      stageName: '水电验收',
      title: '验收已通过',
      content: '水电阶段验收通过',
      type: 'acceptance',
      refId: 42,
    })

    expect(values.projectName).toBe('阳光花园')
    expect(values.stageName).toBe('水电验收')
    expect(values.typeLabel).toBe('验收通知')
    expect(values.refId).toBe('42')
    expect(values.time).toMatch(/^\d{4}年\d{1,2}月\d{1,2}日 \d{2}:\d{2}$/)
    expect(values.date).toMatch(/^\d{4}年\d{1,2}月\d{1,2}日$/)
  })
})
