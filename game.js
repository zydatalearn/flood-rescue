const { mount } = require('./scene.js')
const canvas = wx.createCanvas()
const { windowWidth, windowHeight, pixelRatio, safeArea } = wx.getWindowInfo()
const safeTop = Math.max(44, safeArea?.top || 0)
const safeBottom = safeArea ? Math.max(0, windowHeight - safeArea.bottom) : 0
const game = mount(canvas, {
  width: windowWidth, height: windowHeight, pixelRatio, safeTop, safeBottom,
  requestFrame: callback => requestAnimationFrame(callback),
})

wx.onHide(() => game.setActive(false))
wx.onShow(() => game.setActive(true))

let finger
wx.onTouchStart(event => {
  if (finger !== undefined) return
  const touch = event.changedTouches[0]
  finger = touch.identifier
  game.down(touch.clientX, touch.clientY)
})
wx.onTouchEnd(event => {
  const touch = event.changedTouches.find(item => item.identifier === finger)
  if (!touch) return
  finger = undefined
  game.up(touch.clientX, touch.clientY)
})
wx.onTouchCancel(() => {
  finger = undefined
  game.cancel()
})
