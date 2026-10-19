'use strict'

/**
 * 审计动作常量的**覆盖性**单测。
 *
 * ── 为什么需要这条 ──
 * `operationLog.ACTIONS` 里定义了动作名，但定义不等于会写。
 * 曾经的状态是：33 个动作里只有 12 个真的被调用，另外 17 个（项目建档/编辑/
 * 状态流转、成员邀请/移除、模板增删改、账号增删改、系统配置）只存在于常量表里 ——
 * 日志界面照常能用、列表里也有一堆记录，**只有等到需要追责时才会发现那次改动没留痕**。
 * 而「日志里没有」和「这件事没发生过」在审计时是同一个结论。
 *
 * 因此这里扫描 src/ 全部源码，逐个核对每个动作名至少被引用一次。
 * 新增一个 ACTIONS 常量却忘了在业务里调用，测试立刻变红。
 */

const fs = require('node:fs')
const path = require('node:path')
const operationLog = require('../../src/services/operationLog.service')

/**
 * 允许暂时无人调用的动作。
 *
 * **目前为空** —— 最后一处例外（M12 的门锁密码）已在 M12 落地时接线。
 * 这个白名单存在的意义就是「不许有例外」：新增一个 ACTIONS 常量却忘了在业务里
 * 调用，测试立刻变红。真要加例外，必须在这一行写清楚**为什么可以还没有调用方**，
 * 否则它会变成「忘了接线就加进来」的垃圾桶。
 */
const NOT_YET_WIRED = new Set()

function readAllSource() {
  const root = path.resolve(__dirname, '..', '..', 'src')
  const chunks = []

  ;(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.js')) chunks.push(fs.readFileSync(full, 'utf8'))
    }
  })(root)

  return chunks.join('\n')
}

describe('AC-AD09 审计动作必须真的被写入', () => {
  const source = readAllSource()

  it('每个动作常量都在业务代码里出现过（拒绝只定义不调用）', () => {
    const neverCalled = Object.entries(operationLog.ACTIONS)
      .filter(([name]) => !NOT_YET_WIRED.has(name))
      .filter(([name]) => !new RegExp(`ACTIONS\\.${name}\\b`).test(source))
      .map(([name]) => name)

    expect(neverCalled, `以下动作定义了却没有任何调用方：${neverCalled.join(', ')}`).toEqual([])
  })

  it('动作名符合 `<模块>.<动作>` 的约定，模块名可用于筛选', () => {
    for (const action of Object.values(operationLog.ACTIONS)) {
      expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/)
      // 模块白名单由 ACTIONS 推导，因此这里必然成立；
      // 断言它是在防止将来有人把点号写成别的分隔符，那会让筛选静默失效
      expect(operationLog.isKnownModule(operationLog.moduleOf(action))).toBe(true)
    }
  })

  it('动作名唯一 —— 拼错的动作名会变成两条互不相干的统计', () => {
    const actions = Object.values(operationLog.ACTIONS)
    expect(new Set(actions).size).toBe(actions.length)
  })

  it('每个模块都有中文标签，筛选下拉不会露出英文键名', () => {
    for (const { module, label } of operationLog.listModules()) {
      // 未配标签时 listModules 会退回模块原名（不至于崩，但界面很难看），
      // 因此这里要求显式配置
      expect(operationLog.MODULE_LABELS[module], `${module} 缺中文标签`).toBe(label)
    }
  })
})
