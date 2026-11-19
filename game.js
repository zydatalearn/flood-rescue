const { mount } = require('./scene.js')
const { soundPlayer } = require('./sound.js')
const canvas = wx.createCanvas()
const { windowWidth, windowHeight, pixelRatio, safeArea } = wx.getWindowInfo()
const safeTop = Math.max(44, safeArea?.top || 0)
const safeBottom = safeArea ? Math.max(0, windowHeight - safeArea.bottom) : 0
const game = mount(canvas, {
  width: windowWidth, height: windowHeight, pixelRatio, safeTop, safeBottom,
  requestFrame: callback => requestAnimationFrame(callback),
  sound: soundPlayer(() => wx.createWebAudioContext?.(), () => wx.vibrateShort?.({ type: 'light' })),
  storage: {
    read: key => wx.getStorageSync(key),
    write: (key, value) => wx.setStorageSync(key, value),
  },
  loadGallery: (page, ready, unavailable) => {
    const image = wx.createImage()
    image.onload = () => ready(image)
    image.onerror = unavailable
    image.src = page === 0 ? 'dogs.webp' : 'dogs-2.webp'
  },
  share: report => wx.setClipboardData({ data: report }),
  createTileSurface: (width, height) => {
    if (!wx.createOffscreenCanvas) return null
    try {
      return wx.createOffscreenCanvas({ type: '2d', width, height })
    } catch {
      return null
    }
  },
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
