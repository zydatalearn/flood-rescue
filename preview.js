const canvas = document.querySelector('canvas')
const status = document.querySelector('#status')
const motion = matchMedia('(prefers-reduced-motion: reduce)')
const game = RescueScene.mount(canvas, {
  width: canvas.clientWidth, height: canvas.clientHeight, pixelRatio: devicePixelRatio,
  requestFrame: requestAnimationFrame.bind(window),
  reducedMotion: () => motion.matches,
  announce: message => { status.textContent = message },
})

new ResizeObserver(() => game.resize(canvas.clientWidth, canvas.clientHeight, devicePixelRatio)).observe(canvas)
document.addEventListener('visibilitychange', () => game.setActive(!document.hidden))
game.setActive(!document.hidden)
canvas.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return
  canvas.setPointerCapture(event.pointerId)
  const rect = canvas.getBoundingClientRect()
  game.down(event.clientX - rect.left, event.clientY - rect.top)
})
canvas.addEventListener('pointerup', event => {
  if (!event.isPrimary) return
  const rect = canvas.getBoundingClientRect()
  game.up(event.clientX - rect.left, event.clientY - rect.top)
})
canvas.addEventListener('pointercancel', event => { if (event.isPrimary) game.cancel() })
canvas.addEventListener('keydown', event => { if (game.key(event.key)) event.preventDefault() })
