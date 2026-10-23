import { computed, ref } from 'vue'

/**
 * 底部弹窗「下滑关闭」。
 *
 * 只绑定在弹窗的把手 / 标题区，不要绑整个面板：
 * 面板内部有输入框和可滚动列表，整面板手势会和滚动、点击冲突。
 *
 * 用法：
 *   const swipe = useSwipeClose(closeSheet)
 *   <view class="sheet" :style="swipe.style">
 *     <view class="sheet-head" v-on="swipe.handlers">...</view>
 *   </view>
 */
export function useSwipeClose(onClose, options = {}) {
  const threshold = options.threshold ?? 90
  const closeDuration = options.duration ?? 220

  const offset = ref(0)
  const dragging = ref(false)
  const closing = ref(false)

  let startY = 0
  let startAt = 0
  let lastY = 0
  let lastAt = 0
  let velocity = 0
  let active = false
  let closeTimer = null

  function onTouchStart(event) {
    // 关闭动画进行中不再接收新手势，否则会被重新拉回来
    if (closing.value) return
    const touch = event.touches && event.touches[0]
    if (!touch || active) return
    active = true
    dragging.value = true
    offset.value = 0
    startY = touch.clientY
    startAt = Date.now()
    lastY = startY
    lastAt = startAt
    velocity = 0
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
  }

  function onTouchMove(event) {
    if (!active) return
    const touch = event.touches && event.touches[0]
    if (!touch) return

    const now = Date.now()
    const delta = touch.clientY - startY
    const dt = Math.max(1, now - lastAt)
    velocity = (touch.clientY - lastY) / dt
    lastY = touch.clientY
    lastAt = now

    if (delta <= 0) {
      offset.value = 0
      return
    }

    // 超过一定距离后加阻尼，避免把面板拖得离屏幕太远
    offset.value = delta > 120 ? 120 + (delta - 120) * 0.4 : delta
  }

  function onTouchEnd() {
    if (!active) return
    active = false
    dragging.value = false

    const distance = offset.value
    // 距离够长，或者向下甩得够快（约 600px/s 以上）都关闭
    const shouldClose = distance > threshold || (velocity > 0.6 && distance > 24)

    if (!shouldClose) {
      offset.value = 0
      return
    }

    // 先播放下滑动画，再真正关闭；关闭后把位移复位，下一次打开不会残留
    closing.value = true
    offset.value = Math.max(distance, 600)
    closeTimer = setTimeout(() => {
      closeTimer = null
      onClose()
      offset.value = 0
      closing.value = false
    }, closeDuration + 20)
  }

  // 蒙层上的空处理器：只借 catchtouchmove 锁住背景页面滚动。
  function onMaskTouchMove() {}

  function reset() {
    active = false
    dragging.value = false
    closing.value = false
    offset.value = 0
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = null
    }
  }

  const style = computed(() => {
    let transition = 'transform 320ms cubic-bezier(.22, 1, .36, 1)'
    if (dragging.value) transition = 'none'
    else if (closing.value) transition = `transform ${closeDuration}ms cubic-bezier(.4, 0, 1, 1)`

    return {
      transform: offset.value ? `translateY(${offset.value}px)` : '',
      transition,
      willChange: dragging.value ? 'transform' : ''
    }
  })

  return {
    offset,
    dragging,
    style,
    // 模板里直接绑定 sheetSwipe.onTouchStart / onTouchMove / onTouchEnd
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onMaskTouchMove,
    reset
  }
}
