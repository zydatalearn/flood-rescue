const canvas = document.querySelector('canvas')
const status = document.querySelector('#status')
const motion = matchMedia('(prefers-reduced-motion: reduce)')
const game = RescueScene.mount(canvas, {
  width: canvas.clientWidth, height: canvas.clientHeight, pixelRatio: devicePixelRatio,
  requestFrame: requestAnimationFrame.bind(window),
  lowDetail: navigator.deviceMemory <= 4 || navigator.hardwareConcurrency <= 4,
  createTileSurface: (width, height) => Object.assign(document.createElement('canvas'), { width, height }),
  reducedMotion: () => motion.matches,
  sound: RescueSound.soundPlayer(() => {
    const Audio = window.AudioContext || window.webkitAudioContext
    return Audio ? new Audio() : null
  }, () => navigator.vibrate?.(15)),
  storage: {
    read: key => JSON.parse(localStorage.getItem(key)),
    write: (key, value) => localStorage.setItem(key, JSON.stringify(value)),
  },
  loadGallery: (page, ready, unavailable) => {
    const image = new Image()
    image.onload = () => ready(image)
    image.onerror = unavailable
    image.src = page === 0 ? 'dogs.webp' : 'dogs-2.webp'
  },
  share: report => {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(report).catch(() => window.prompt('复制每日战报', report))
    else window.prompt('复制每日战报', report)
  },
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
