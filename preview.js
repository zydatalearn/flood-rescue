const canvas = document.querySelector('canvas')
const status = document.querySelector('#status')
const motion = matchMedia('(prefers-reduced-motion: reduce)')
const game = RescueScene.mount(canvas, {
  width: canvas.clientWidth, height: canvas.clientHeight, pixelRatio: devicePixelRatio,
  requestFrame: requestAnimationFrame.bind(window),
  lowDetail: navigator.deviceMemory <= 4 || navigator.hardwareConcurrency <= 4,
  createTileSurface: (width, height) => Object.assign(document.createElement('canvas'), { width, height }),
  reducedMotion: () => motion.matches,
  announce: message => { status.textContent = message },
})

new ResizeObserver(() => game.resize(canvas.clientWidth, canvas.clientHeight, devicePixelRatio)).observe(canvas)
document.addEventListener('visibilitychange', () => game.setActive(!document.hidden))
game.setActive(!document.hidden)
let pointerBounds
canvas.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return
  canvas.setPointerCapture(event.pointerId)
  pointerBounds = canvas.getBoundingClientRect()
  game.down(event.clientX - pointerBounds.left, event.clientY - pointerBounds.top)
})
canvas.addEventListener('pointerup', event => {
  if (!event.isPrimary || !pointerBounds) return
  game.up(event.clientX - pointerBounds.left, event.clientY - pointerBounds.top)
  pointerBounds = null
})
canvas.addEventListener('lostpointercapture', event => {
  if (!event.isPrimary || !pointerBounds) return
  pointerBounds = null
  game.cancel()
})
canvas.addEventListener('keydown', event => { if (game.key(event.key)) event.preventDefault() })
