/**
 * 微信小程序右上角胶囊的安全区计算。
 *
 * ── 为什么不写死 dp(92) ──
 * 胶囊的宽度和左边距随机型、字号、是否分屏变化；dp(92) 在 375px 宽的
 * iPhone 上只有约 88px，而胶囊本身加右边距已经接近 95px —— 右侧按钮会
 * 被压到胶囊下面。必须直接读 `getMenuButtonBoundingClientRect()`。
 *
 * 返回值单位是 **px**（不是 rpx），用于内联样式，避免再被 dp() 缩放一次。
 * H5 / App 没有胶囊，`rightInset` 为 0，调用方回落到自己的 CSS 内边距。
 */

export function useCapsuleInsets() {
  const info = uni.getSystemInfoSync()
  const statusBarHeight = info.statusBarHeight || 12
  const windowWidth = info.windowWidth || info.screenWidth || 375

  let capsule = null
  // #ifdef MP-WEIXIN
  try {
    capsule = uni.getMenuButtonBoundingClientRect()
  } catch (err) {
    capsule = null
  }
  // #endif

  const hasCapsule = Boolean(
    capsule &&
      Number(capsule.width) > 0 &&
      Number(capsule.left) > 0 &&
      Number.isFinite(Number(capsule.top))
  )

  // 右侧需要预留的距离 = 屏幕宽 - 胶囊左边缘 + 与胶囊之间的间隙
  // 例如 375px 屏幕、胶囊 left=278px：375 - 278 + 8 = 105px。
  let rightInset = hasCapsule
    ? Math.max(0, Math.ceil(windowWidth - Number(capsule.left) + 8))
    : 0

  // 测量失败时的保守回退：按屏幕宽度约 28% 预留，宁可标题窄一点，
  // 也不能让按钮被胶囊盖住。H5 不启用该回退。
  // #ifdef MP-WEIXIN
  if (!rightInset) rightInset = Math.max(96, Math.round(windowWidth * 0.28))
  // #endif

  return {
    statusBarHeight,
    windowWidth,
    rightInset,
    hasCapsule,
    capsuleTop: hasCapsule ? Number(capsule.top) : statusBarHeight + 6,
    capsuleHeight: hasCapsule ? Number(capsule.height) : 32,
  }
}
