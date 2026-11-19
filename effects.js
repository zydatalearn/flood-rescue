(function () {
  const SWAP_MS = 165
  const RETURN_MS = 140
  const MATCH_MS = 60
  const CLEAR_MS = 145
  const LINE_MS = 240
  const clamp = value => Math.max(0, Math.min(1, value))
  const easeOut = value => 1 - (1 - value) ** 3

  function swapPose(age, valid) {
    const returning = age >= SWAP_MS && !valid
    const t = clamp(returning ? (age - SWAP_MS) / RETURN_MS : age / SWAP_MS)
    return { t: returning ? 1 - easeOut(t) : easeOut(t), scale: 1 + Math.sin(Math.PI * t) * (returning ? 0.02 : 0.05) }
  }

  function matchPose(age) {
    if (age < MATCH_MS) {
      const t = clamp(age / MATCH_MS)
      return {
        scale: 1 + 0.07 * easeOut(t) - 0.022 * Math.sin(2 * Math.PI * t) * (1 - t),
        alpha: 1,
        flash: 0.24 * Math.sin(Math.PI * t),
      }
    }
    const t = clamp((age - MATCH_MS) / CLEAR_MS)
    return { scale: 1.07 * (1 - t) ** 2, alpha: (1 - t) ** 1.4, flash: 0 }
  }

  function createEffects(lowDetail = false) {
    const particles = Array.from({ length: 72 }, () => ({}))
    let length = 0
    let slowFrames = 0

    function observeFrame(drawMs) {
      if (lowDetail) return
      slowFrames = drawMs > 18 ? slowFrames + 1 : Math.max(0, slowFrames - 1)
      if (slowFrames >= 4) lowDetail = true
    }

    function prepareMatch(cleared, center, colorAt, size, intensity) {
      length = 0
      const limit = lowDetail ? 24 : particles.length
      const perTile = Math.min(lowDetail ? 4 : intensity >= 5 ? 8 : 6, Math.floor(limit / cleared.size))
      for (const index of cleared) {
        const [x, y] = center(index)
        const color = colorAt(index)
        for (let i = 0; i < perTile; i++) {
          const angle = i * 2 * Math.PI / perTile + index * 0.61
          const distance = size * (0.46 + (i % 3) * 0.15)
          const particle = particles[length++]
          particle.x = x
          particle.y = y
          particle.dx = Math.cos(angle) * distance
          particle.dy = Math.sin(angle) * distance
          particle.size = Math.max(1, size * (i % 3 === 0 ? 0.06 : 0.042))
          particle.color = i % 4 === 0 && !lowDetail ? '#fff5cf' : color
        }
      }
    }

    function drawParticles(ctx, progress) {
      if (!length) return
      const travel = easeOut(progress)
      ctx.save()
      for (let i = 0; i < length; i++) {
        const p = particles[i]
        const size = p.size * (1 - progress * 0.62)
        ctx.globalAlpha = (1 - progress) * 0.92
        ctx.fillStyle = p.color
        ctx.fillRect(p.x + p.dx * travel - size, p.y + p.dy * travel + 8 * progress ** 2 - size, size * 2, size * 2)
      }
      ctx.restore()
    }

    return {
      prepareMatch, drawParticles, observeFrame,
      clearEffects: () => { length = 0 },
      get lowDetail() { return lowDetail },
    }
  }

  const effects = { SWAP_MS, RETURN_MS, MATCH_MS, CLEAR_MS, LINE_MS, swapPose, matchPose, createEffects }
  if (typeof module === 'object') module.exports = effects
  else globalThis.RescueEffects = effects
})()
