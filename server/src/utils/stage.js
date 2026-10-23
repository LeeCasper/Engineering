'use strict'

/**
 * 阶段展示相关的纯函数。
 *
 * 锁定原因在 C-2.13 与 C-7.2 里是**面向用户的一句话**，不是内部错误码。
 * 放在 util 而不是各 service 里各写一份，是因为项目详情与阶段树两个接口
 * 都要返回它；两处文案一旦分叉，同一个阶段在详情页和进度页会显示
 * 「水电工程未结清」和「上一阶段未结清」，用户会以为是两件事。
 */

/**
 * 锁定原因：取该阶段之前最近的一个阶段名。
 * 阶段锁定的直接原因总是「上一阶段没结清」，不需要更复杂的推断。
 */
function lockedReasonFor(stages, stage) {
  const previous = (stages || [])
    .filter((s) => Number(s.seq) < Number(stage.seq))
    .sort((a, b) => Number(b.seq) - Number(a.seq))[0]

  return previous ? `${previous.name}未结清` : '上一阶段未结清'
}

module.exports = { lockedReasonFor }
