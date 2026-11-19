(function () {
  const puzzle = typeof module === 'object' ? require('./puzzle.js') : globalThis.RescuePuzzle
  const { MAX_WATER, floodTime, deal, adjacent, advanceWater, play, outlets } = puzzle
  const WIDTH = 390
  const HEIGHT = 806
  const BOARD_INSET = 9
  const START_BUTTON = { x: 99, y: 462, width: 192, height: 48 }
  const SWAP_MS = 68
  const CLEAR_MS = 80
  const BURST_MS = 155
  const LONG_BURST_MS = 280
  const NEXT_ROUND_MS = 950
  const BACKGROUND = '#f3ecdd'
  const INK = '#24443e'
  const PANEL = '#fff9ec'
  const PANEL_EDGE = '#aebdb0'
  const BOARD = '#c1d0c1'
  const DRY_SLOT = '#49675e'
  const WATER = '#238581'
  const DANGER = '#873d25'
  const OUTLET_SIDE = ['左侧', '中间', '右侧']
  const COLORS = {
    A: ['#f3bea5', '#db916f', '#593429', '扳手'],
    B: ['#b8dce8', '#87b9cc', '#254b58', '水滴'],
    C: ['#dcd0e5', '#b9a2c9', '#493952', '螺母'],
    D: ['#f4dfa3', '#dfbe68', '#50401d', '闪电'],
    E: ['#cedeb2', '#a9c28d', '#344b2e', '救生圈'],
  }
  const ease = value => 1 - (1 - value) ** 2
  const interpolate = (from, to, ratio) => from + (to - from) * ratio
  const clamp = value => Math.min(1, Math.max(0, value))

  function mount(canvas, options) {
    const ctx = canvas.getContext('2d')
    const { safeTop = 0, safeBottom = 0, requestFrame } = options
    const announce = options.announce || (() => {})
    const reducedMotion = options.reducedMotion || (() => false)
    const random = options.random || Math.random
    let width, height, scale, offsetX, offsetY, density
    let levelIndex = 0
    let roundNumber = 0
    let nextRoundAt = null
    let active = true
    let intro = true
    let guided = true
    let openingMove
    const openings = []
    pickOpening()
    let state = openings[levelIndex]
    let layout = boardLayout(state.level)
    let animation = null
    let queuedSwipe = null
    let pressed = null
    let selected = -1
    let focus = -1
    let message = '交换描边的两块，接通第一段水路。'
    let bonusNotice = null
    let framePending = false
    let clockSince = null
    let playedMs = 0
    let clockTimer
    let rise

    function elapsed(now) {
      return playedMs + (clockSince === null ? 0 : Math.max(0, now - clockSince))
    }

    function pauseClock(now) {
      playedMs = elapsed(now)
      clockSince = null
      clearTimeout(clockTimer)
      clockTimer = undefined
    }

    function updateWater(now) {
      if (clockSince === null) return
      const next = advanceWater(state, elapsed(now))
      if (next === state) return
      if (next.outcome === 'flooded') {
        animation = null
        queuedSwipe = null
        rise = null
        pauseClock(now)
        finish(next)
      } else {
        rise = reducedMotion() ? null : { from: now, water: state.water }
        const { exits, closeAt } = state.level
        const closed = closeAt ? exits.findIndex(col => state.water < closeAt[col] && next.water >= closeAt[col]) : -1
        const warning = closeAt ? exits.findIndex(col => next.water === closeAt[col] - 1) : -1
        if (closed >= 0) {
          message = `${OUTLET_SIDE[closed]}出口已关，可改接仍开放的出口。`
          announce(message)
        }
        if (warning >= 0) announce(`${OUTLET_SIDE[warning]}出口下次涨水就会关闭。`)
        state = next
      }
    }

    function scheduleClock(now) {
      if (clockSince === null || clockTimer !== undefined) return
      const played = elapsed(now)
      const riseMs = floodTime(state.level) / (MAX_WATER - 1)
      const bonus = state.bonusMs ?? 0
      const nextSecond = (floodTime(state.level) + bonus - played) % 1000 || 1000
      const nextRise = state.water * riseMs + bonus - played
      clockTimer = setTimeout(() => {
        clockTimer = undefined
        schedule()
      }, Math.min(nextSecond, nextRise))
    }

    function setActive(nextActive) {
      active = nextActive
      const now = Date.now()
      if (!active) {
        updateWater(now)
        pauseClock(now)
        pressed = null
      } else if (!intro && clockSince === null && !state.outcome && !animation?.result?.state.outcome) {
        clockSince = now
        schedule()
      }
      if (active && nextRoundAt !== null) schedule()
    }

    function pickOpening() {
      const opening = deal(levelIndex, random, openings[levelIndex], roundNumber)
      openings[levelIndex] = opening.state
      if (levelIndex === 0) openingMove = opening.paths[0][0]
    }

    function boardLayout({ cols, rows }) {
      const top = rows > 9 ? 294 : 337
      const pitch = Math.min(Math.floor((WIDTH - 2 * BOARD_INSET - 12) / cols), Math.floor((763 - top) / rows))
      const cell = pitch - (rows > 12 ? 2 : 4)
      return { top, pitch, cell, left: Math.floor((WIDTH - (cols - 1) * pitch - cell) / 2) }
    }

    function center(index) {
      const { left, top, pitch, cell } = layout
      const { cols } = state.level
      return [left + (index % cols) * pitch + cell / 2, top + Math.floor(index / cols) * pitch + cell / 2]
    }

    function sceneY(y) {
      return 70 + (y - 70) * (277 + layout.top - 429) / 277
    }

    function resize(nextWidth, nextHeight, pixelRatio) {
      width = nextWidth
      height = nextHeight
      density = Math.min(pixelRatio, 2)
      canvas.width = Math.round(width * density)
      canvas.height = Math.round(height * density)
      const usableHeight = Math.max(1, height - safeTop - safeBottom)
      scale = Math.max(0.01, Math.min(width / WIDTH, usableHeight / HEIGHT, 1.25))
      offsetX = (width - WIDTH * scale) / 2
      offsetY = safeTop + (usableHeight - HEIGHT * scale) / 2
      schedule()
    }

    function schedule() {
      if (framePending) return
      framePending = true
      requestFrame(() => {
        framePending = false
        draw(Date.now())
        if (animation || rise || (active && nextRoundAt !== null)) schedule()
      })
    }

    function round(x, y, w, h, r) {
      ctx.beginPath()
      ctx.moveTo(x + r, y)
      ctx.arcTo(x + w, y, x + w, y + h, r)
      ctx.arcTo(x + w, y + h, x, y + h, r)
      ctx.arcTo(x, y + h, x, y, r)
      ctx.arcTo(x, y, x + w, y, r)
      ctx.closePath()
    }

    function box(x, y, w, h, r, fill, stroke) {
      round(x, y, w, h, r)
      ctx.fillStyle = fill
      ctx.fill()
      if (stroke) {
        ctx.strokeStyle = stroke
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }

    function oval(x, y, rx, ry, color) {
      ctx.beginPath()
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    }

    function line(points, color, thickness = 2) {
      ctx.beginPath()
      ctx.moveTo(...points[0])
      for (const point of points.slice(1)) ctx.lineTo(...point)
      ctx.strokeStyle = color
      ctx.lineWidth = thickness
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.stroke()
    }

    function label(value, x, y, size, color = '#f2e9cf', weight = 700, align = 'left') {
      ctx.fillStyle = color
      ctx.font = `${weight} ${size}px "Microsoft YaHei", "PingFang SC", sans-serif`
      ctx.textAlign = align
      ctx.textBaseline = 'middle'
      ctx.fillText(value, x, y)
    }

    function ramp(y, h, top, bottom) {
      const gradient = ctx.createLinearGradient(0, y, 0, y + h)
      gradient.addColorStop(0, top)
      gradient.addColorStop(1, bottom)
      return gradient
    }

    function symbol(type, x, y, scale = 1, ink = '#102e39') {
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(scale, scale)
      if (type === 'A') {
        ctx.beginPath()
        ctx.moveTo(5, -12)
        ctx.quadraticCurveTo(-3, -12, -2, -4)
        ctx.lineTo(-10, 5)
        ctx.quadraticCurveTo(-14, 10, -8, 11)
        ctx.lineTo(3, 0)
        ctx.quadraticCurveTo(12, 2, 12, -8)
        ctx.lineTo(7, -5)
        ctx.lineTo(3, -8)
        ctx.closePath()
        ctx.fillStyle = ink
        ctx.fill()
        oval(-8.5, 7.8, 1.4, 1.4, COLORS.A[0])
      } else if (type === 'B') {
        ctx.beginPath()
        ctx.moveTo(0, -12)
        ctx.quadraticCurveTo(4, -7, 8, -1)
        ctx.quadraticCurveTo(12, 10, 0, 11)
        ctx.quadraticCurveTo(-12, 10, -8, -1)
        ctx.quadraticCurveTo(-4, -7, 0, -12)
        ctx.fillStyle = ink
        ctx.fill()
        line([[-4, 2], [-3, 5], [0, 6]], COLORS.B[0], 1.7)
      } else if (type === 'C') {
        line([[-5, -9], [5, -9], [10, 0], [5, 9], [-5, 9], [-10, 0], [-5, -9]], ink, 3.2)
        ctx.beginPath()
        ctx.arc(0, 0, 3.4, 0, Math.PI * 2)
        ctx.lineWidth = 1.8
        ctx.stroke()
      } else if (type === 'D') {
        ctx.beginPath()
        ctx.moveTo(4, -12)
        ctx.lineTo(-9, 2)
        ctx.lineTo(-1, 2)
        ctx.lineTo(-3, 12)
        ctx.lineTo(10, -3)
        ctx.lineTo(2, -3)
        ctx.closePath()
        ctx.fillStyle = ink
        ctx.fill()
      } else {
        ctx.beginPath()
        ctx.arc(0, 0, 8.4, 0, Math.PI * 2)
        ctx.strokeStyle = ink
        ctx.lineWidth = 4.2
        ctx.stroke()
        for (const angle of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) {
          const x = Math.cos(angle)
          const y = Math.sin(angle)
          line([[x * 6.3, y * 6.3], [x * 10.4, y * 10.4]], COLORS.E[0], 2.8)
        }
      }
      ctx.restore()
    }

    function water(x, y, w, bottom, time, foreground) {
      if (bottom - y < 0.6) return
      ctx.beginPath()
      ctx.moveTo(x, bottom)
      for (let dx = 0; dx <= w; dx += 4) {
        const wave = Math.sin(dx / 11 + time) * Math.min(2.5, (bottom - y) / 2)
        ctx.lineTo(x + dx, y + wave)
      }
      ctx.lineTo(x + w, y)
      ctx.lineTo(x + w, bottom)
      ctx.closePath()
      ctx.fillStyle = foreground ? '#56b7ac44' : ramp(y, bottom - y, '#79c6b9', WATER)
      ctx.fill()
      if (!foreground) return
      ctx.strokeStyle = '#b4eee0'
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let dx = 0; dx <= w; dx += 4) {
        const point = [x + dx, y + Math.sin(dx / 11 + time) * Math.min(2.5, (bottom - y) / 2)]
        if (dx === 0) ctx.moveTo(...point)
        else ctx.lineTo(...point)
      }
      ctx.stroke()
    }

    function dog(x, y, safe) {
      ctx.save()
      ctx.translate(x, y)
      // Preserve the portrait proportions as the panorama changes height.
      ctx.scale(0.92, 0.92 * 277 / (277 + layout.top - 429))
      const fur = ramp(-24, 52, '#f6c483', '#c67b4b')
      const cream = '#fff1d5'
      const ink = '#39303a'
      oval(13, 22, 22, 15, fur)
      oval(30, 15, 8, 7, cream)
      for (const side of [-1, 1]) {
        ctx.save()
        ctx.scale(side, 1)
        ctx.beginPath()
        ctx.moveTo(8, -18)
        ctx.quadraticCurveTo(16, -38, 25, -39)
        ctx.quadraticCurveTo(30, -38, 26, -9)
        ctx.fillStyle = fur
        ctx.fill()
        ctx.beginPath()
        ctx.moveTo(15, -20)
        ctx.lineTo(24, -33)
        ctx.lineTo(23, -16)
        ctx.fillStyle = '#bc7770'
        ctx.fill()
        ctx.restore()
      }
      oval(0, -2, 29, 25, fur)
      oval(0, -7, 5, 17, cream)
      oval(-9, 7, 13, 11, cream)
      oval(9, 7, 13, 11, cream)
      for (const side of [-1, 1]) {
        const eye = side * 13
        if (safe) line([[eye - 3, -4], [eye, -6], [eye + 3, -4]], ink, 2.5)
        else {
          oval(eye, -6, 3.4, 4.2, ink)
          oval(eye - 0.9, -7.5, 1, 1, '#ffffff')
        }
      }
      oval(0, 3, 4.8, 3.6, ink)
      line([[-5, 9], [-2, 11], [0, 9], [3, 11], [6, 9]], ink, 1.3)
      line([[-16, 20], [0, 24], [17, 19]], '#437c77', 5)
      oval(1, 25, 3, 3, '#ffd284')
      oval(-13, 29, 7, 5, cream)
      oval(13, 29, 7, 5, cream)
      ctx.restore()
    }

    function dashes(points, phase) {
      ctx.save()
      ctx.setLineDash([5, 12])
      ctx.lineDashOffset = -phase * 46
      line(points, '#afefe4', 3)
      ctx.restore()
    }

    function pipe(path) {
      line(path, '#31574f', 13)
      line(path, '#77968a', 9)
      line(path, '#42685f', 5)
    }

    function scene(view, phase, rising, rescue) {
      box(17, 70, 356, 277, 19, PANEL, PANEL_EDGE)
      ctx.save()
      round(18, 71, 354, 275, 18)
      ctx.clip()
      box(25, 78, 340, 230, 12, ramp(78, 230, '#b5d9d5', '#f4e6c6'))
      const portraitScale = 277 / (277 + layout.top - 429)
      oval(214, 136, 25, 25 * portraitScale, '#fff2c755')
      oval(214, 136, 18, 18 * portraitScale, '#fff2c7')
      ctx.save()
      round(25, 78, 340, 223, 12)
      ctx.clip()
      ctx.beginPath()
      ctx.moveTo(25, 199)
      ctx.bezierCurveTo(99, 132, 115, 205, 181, 177)
      ctx.bezierCurveTo(245, 143, 271, 192, 365, 149)
      ctx.lineTo(365, 308)
      ctx.lineTo(25, 308)
      ctx.fillStyle = '#a2bb9e'
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(25, 201)
      ctx.bezierCurveTo(106, 155, 178, 251, 266, 192)
      ctx.quadraticCurveTo(326, 165, 365, 185)
      ctx.lineTo(365, 308)
      ctx.lineTo(25, 308)
      ctx.fillStyle = '#719783'
      ctx.fill()
      // The harbour beacon sits directly above the exit.
      box(291, 160, 7, 26, 1, '#c4b79f')
      box(290, 158, 9, 6, 1, '#f5da9e')
      line([[289, 157], [295, 152], [301, 157]], '#263c4b', 3)
      ctx.restore()
      const inletPath = [[32, 115], [92, 115], [92, 140]]
      pipe(inletPath)
      if (rising) {
        dashes(inletPath, phase)
        line([[92, 140], [92, Math.min(291, 157 + phase * 144)]], '#7de3e1a8', 6)
      }
      ctx.save()
      round(25, 78, 340, 223, 12)
      ctx.clip()
      box(249, 201, 70, 95, 4, '#31574f')
      box(270, 207, 45, 48, 6, view.outcome === 'escaped' ? '#94cf92' : '#244d46', '#698576')
      line([[285, 230], [303, 230], [297, 224]], '#d4edb4', 2)
      line([[303, 230], [297, 236]], '#d4edb4', 2)
      box(250, 253, 69, 48, 2, '#638289')
      box(222, 269, 97, 32, 2, '#4e6d77')
      box(193, 285, 126, 16, 2, '#759398')
      const y = 301 - view.water / MAX_WATER * 143
      water(25, y, 340, 301, phase * 7, false)
      const climb = view.outcome === 'escaped' ? 1 : rescue
      const swimY = Math.max(174, Math.min(254, y - 1))
      dog(interpolate(144, 273, climb), interpolate(swimY, 213, climb), climb > 0.7)
      water(25, y, 340, 301, phase * 7, true)
      ctx.restore()

      label('进水', 78, 98, 11, INK)
      for (let i = 0; i < MAX_WATER; i++) {
        box(86 + i * 16, 322, 12, 4, 2, i < Math.round(view.water) ? WATER : '#c4d0c4')
      }
      label(`水位 ${Math.round(view.water)}`, 37, 325, 11, INK)
      label(`${Math.round(view.water)} / ${MAX_WATER}`, 344, 325, 12, view.water >= MAX_WATER - 2 ? DANGER : INK, 700, 'right')
      ctx.restore()
      for (const x of [28, 362]) for (const y of [81, 335]) oval(x, y, 2, 2, '#6e9092')
    }

    function controls(now, connected) {
      const y = 363 + layout.top - 429
      const routeGoal = state.level.closeAt ? '数字标示关闭水位' : '接通金色排水口'
      const seconds = connected ? Math.floor(elapsed(now) / 1000) :
        Math.max(0, Math.ceil((floodTime(state.level) + (state.bonusMs ?? 0) - elapsed(now)) / 1000))
      const danger = seconds <= 10 && !connected
      const timeColor = danger ? DANGER : INK
      box(17, y, 172, 37, 9, danger ? '#fff0df' : PANEL, danger ? '#cc8b68' : PANEL_EDGE)
      oval(36, y + 18, 8, 8, timeColor)
      line([[36, y + 13], [36, y + 18], [39, y + 20]], '#ffffff', 1.5)
      label(connected ? '用时' : '距淹没', 51, y + 19, 12, timeColor)
      if (!connected && bonusNotice?.until > now) {
        label(`+${bonusNotice.seconds} 秒`, 110, y + 19, 12, '#246756', 700, 'center')
      }
      label(`00:${String(seconds).padStart(2, '0')}`, 174, y + 19, 17, timeColor, 700, 'right')
      box(201, y, 172, 37, 9, PANEL, PANEL_EDGE)
      box(209, y + 7, 24, 23, 6, COLORS.B[0])
      line([[215, y + 12], [221, y + 12], [221, y + 24], [227, y + 24]], '#102e39', 3)
      label(connected ? '水路已接通' : routeGoal, 244, y + 19, 12, connected ? '#246756' : INK)
    }

    function tile(type, x, y, selectedTile, focused, clearProgress = 0) {
      const [bright, middle, edge] = COLORS[type]
      const { cell } = layout
      ctx.save()
      if (clearProgress) {
        ctx.translate(x + cell / 2, y + cell / 2)
        const size = 1 - clearProgress * 0.5
        ctx.scale(size, size)
        ctx.translate(-x - cell / 2, -y - cell / 2)
        ctx.globalAlpha = 1 - clearProgress
      }
      const radius = cell * 0.25
      const depth = cell * 0.13
      const top = y + (selectedTile ? depth * 0.72 : 0)
      const faceHeight = cell - depth
      box(x, y + 1.5, cell, cell, radius, '#294a3e38')
      box(x, y + depth, cell, faceHeight, radius, edge + 'a6')
      box(x, top, cell, faceHeight, radius, ramp(top, faceHeight, bright, middle))
      // A curved rim catches the light on the upper-left shoulder of the key.
      ctx.beginPath()
      ctx.moveTo(x + 2, top + radius + 1)
      ctx.quadraticCurveTo(x + 2, top + 2, x + radius + 1, top + 2)
      ctx.lineTo(x + cell * 0.62, top + 2)
      ctx.lineWidth = 1.5
      ctx.strokeStyle = '#fffaf1a8'
      ctx.stroke()
      const iconSize = Math.min(0.98, cell / 40)
      symbol(type, x + cell / 2, top + faceHeight / 2 + 0.8, iconSize, edge)
      if (selectedTile || focused) {
        round(x + 1, top + 1, cell - 2, faceHeight - 2, radius - 1)
        ctx.strokeStyle = selectedTile ? '#653e29' : INK
        ctx.lineWidth = 2.5
        ctx.stroke()
      }
      ctx.restore()
    }

    function clearBurst(index, type, progress) {
      const [x, y] = center(index)
      const size = layout.cell
      const color = COLORS[type][1]
      ctx.save()
      ctx.globalAlpha = (1 - progress) * 0.85
      ctx.beginPath()
      ctx.arc(x, y, size * (0.18 + 0.48 * progress), 0, 2 * Math.PI)
      ctx.lineWidth = Math.max(1, size * 0.05 * (1 - progress))
      ctx.strokeStyle = color
      ctx.stroke()
      for (let i = 0; i < 5; i++) {
        const angle = i * 2 * Math.PI / 5 + index * 0.7
        const radius = size * (0.22 + (0.45 + (i % 2) * 0.15) * progress)
        const chipX = x + Math.cos(angle) * radius
        const chipY = y + Math.sin(angle) * radius + size * 0.15 * progress ** 2
        const chip = size * (0.055 + 0.035 * (1 - progress))
        box(chipX - chip, chipY - chip, 2 * chip, 2 * chip, chip * 0.45, color)
      }
      ctx.restore()
    }

    function longBurst({ first, last, length }, type, progress, showCount) {
      const [x, y] = center(first)
      const [endX, endY] = center(last)
      const size = layout.cell
      const strong = length >= 5
      const sweep = ease(clamp(progress * 1.8))
      const points = [[x, y], [interpolate(x, endX, sweep), interpolate(y, endY, sweep)]]
      ctx.save()
      ctx.lineCap = 'round'
      ctx.globalAlpha = 1 - clamp((progress - 0.42) / 0.58)
      line(points, COLORS[type][1], size * (strong ? 0.54 : 0.32))
      line(points, strong ? '#ffe9a2' : '#fffbec', size * (strong ? 0.22 : 0.12))
      if (showCount) {
        const midX = Math.min(323, Math.max(67, (x + endX) / 2))
        const midY = Math.max(layout.top + 13, (y + endY) / 2 - size * 0.6)
        box(midX - 32, midY - 10, 64, 20, 9, strong ? '#ffeaab' : PANEL, COLORS[type][2])
        label(`${length} 连消`, midX, midY, 12, INK, 700, 'center')
      }
      ctx.restore()
    }

    function board(phase) {
      const { cols, entry } = state.level
      const { left, top, pitch, cell } = layout
      box(BOARD_INSET, top - 13, WIDTH - 2 * BOARD_INSET, 783 - top, 18, BOARD, '#8fa99b')
      const entries = phase.board || state.board
      const ground = phase.result?.state.board || state.board
      const route = phase.result?.state.route || state.route
      const wet = new Map()
      for (const { cell: index, from } of route) {
        const step = phase.arrivals?.get(index) ?? -1
        const amount = step < 0 ? 1 : clamp(phase.waterFront - step)
        wet.set(index, { from, amount })
      }

      for (let i = 0; i < ground.length; i++) {
        if (ground[i] !== null) continue
        const [x, y] = center(i)
        box(x - cell / 2, y - cell / 2, cell, cell + 1, 7, DRY_SLOT)
      }
      for (let i = 0; i < ground.length; i++) {
        if (ground[i] !== null) continue
        const [x, y] = center(i)
        for (const neighbor of [i + 1, i + cols]) {
          if (!adjacent(i, neighbor, state.level) || ground[neighbor] !== null) continue
          const [nx, ny] = center(neighbor)
          const joined = wet.get(i)?.amount === 1 && wet.get(neighbor)?.amount === 1
          ctx.fillStyle = joined ? WATER : DRY_SLOT
          if (nx > x) ctx.fillRect(x + cell / 2 - 4, y - cell * 0.34, pitch - cell + 8, cell * 0.68)
          else ctx.fillRect(x - cell * 0.34, y + cell / 2 - 4, cell * 0.68, pitch - cell + 8)
        }
      }

      for (const [index, { from, amount }] of wet) {
        if (!amount) continue
        const [x, y] = center(index)
        const [fx] = from < 0 ? [x] : center(from)
        const size = cell - 4
        const startX = x - size / 2
        const startY = y - size / 2
        ctx.save()
        round(startX, startY, size, size, 6)
        ctx.clip()
        ctx.fillStyle = ramp(startY, size, '#81dfcc', WATER)
        const filled = size * amount
        const leadingX = fx < x ? startX + filled : startX + size - filled
        if (fx === x) ctx.fillRect(startX, startY, size, filled)
        else ctx.fillRect(fx < x ? startX : leadingX, startY, filled, size)
        if (amount < 1) {
          ctx.fillStyle = '#dcfff2'
          const crest = Math.min(3, filled)
          if (fx === x) ctx.fillRect(startX, startY + filled - crest, size, crest)
          else ctx.fillRect(fx < x ? leadingX - crest : leadingX, startY, crest, size)
        }
        if (amount === 1) {
          if (index % 3 !== 1) {
            line([[x - size * 0.25, y - size * 0.12], [x, y - size * 0.17], [x + size * 0.22, y - size * 0.13]],
              '#a2f4e68f', 1.5)
          }
          if (index % 4 === 0) oval(x + size * 0.14, y + size * 0.18, 1.8, 1.8, '#c2f7e786')
        }
        ctx.restore()
      }

      ctx.save()
      round(BOARD_INSET + 5, top - 6, WIDTH - 2 * (BOARD_INSET + 5), 769 - top, 11)
      ctx.clip()
      for (let i = 0; i < entries.length; i++) {
        if (!entries[i]) continue
        const row = Math.floor(i / cols)
        let x = left + i % cols * pitch
        let y = top + row * pitch
        if (phase.swap?.includes(i)) {
          const other = phase.swap.find(index => index !== i)
          x += (other % cols - i % cols) * pitch * phase.t
          y += (Math.floor(other / cols) - row) * pitch * phase.t
        }
        tile(entries[i], x, y, i === selected, i === focus,
          phase.cleared?.has(i) ? phase.t : 0)
      }
      if (guided && !intro && !animation && !state.outcome) {
        for (const index of openingMove) {
          const [x, y] = center(index)
          round(x - cell / 2 + 2, y - cell / 2 + 2, cell - 4, cell - 4, 9)
          ctx.strokeStyle = '#ffed9b'
          ctx.lineWidth = 3
          ctx.stroke()
        }
      }
      if (focus >= 0 && !ground[focus]) {
        const [x, y] = center(focus)
        round(x - cell / 2 + 2, y - cell / 2 + 2, cell - 4, cell - 4, 7)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.stroke()
      }
      if (phase.burst !== undefined) {
        for (const index of phase.result.cleared) clearBurst(index, phase.result.swapped[index], phase.burst)
      }
      if (phase.longBurst !== undefined) {
        const runs = phase.result.longRuns
        const longest = runs.reduce((best, run) => run.length > best.length ? run : best)
        for (const run of runs) longBurst(run, phase.result.swapped[run.first], phase.longBurst, run === longest)
      }
      ctx.restore()
      drawPorts(entry, route, wet, phase.pumpProgress)
      return route
    }

    function drawPorts(entry, route, wet, pumpProgress) {
      const { exits, cols, rows, closeAt } = state.level
      const water = state.rescueWater ?? state.water
      const { top, cell } = layout
      const [entryX] = center(entry)
      const inlet = [[253, sceneY(304)], [253, sceneY(352)], [195, sceneY(352)],
        [195, top - 20], [entryX, top - 20], [entryX, top]]
      line(inlet, '#31574f', 10)
      line(inlet, '#77968a', 7)
      line(inlet, route.length ? '#73d8c8' : '#42685f', 3)
      box(entryX - 9, top - 5, 18, 6, 3, '#a8f0dc')
      const ports = exits ? exits.map(col => (rows - 1) * cols + col) : outlets(route, state.level)
      for (const index of ports) {
        const [x, y] = center(index)
        const mouth = y + cell / 2 + 2
        const limit = closeAt?.[index % cols]
        const closed = limit !== undefined && water >= limit
        const warning = limit !== undefined && water === limit - 1
        const active = !closed && wet.get(index)?.amount === 1
        box(x - 11, mouth - 4, 22, 7, 3,
          active ? '#74d8ba' : closed ? DRY_SLOT : warning ? '#df8b69' : '#dbad54', INK)
        if (closeAt) {
          label(closed ? '已关' : limit ?? '常开', x, mouth + 11, 10,
            warning ? DANGER : INK, 700, 'center')
        }
        if (active && pumpProgress !== undefined) {
          ctx.save()
          ctx.globalAlpha = 1 - pumpProgress
          for (let i = -2; i <= 2; i++) {
            oval(x + i * (3 + 8 * pumpProgress), mouth - 25 * Math.sin(Math.PI * pumpProgress) + Math.abs(i) * 3,
              2, 3, '#b4f7fb')
          }
          ctx.restore()
        }
      }
    }

    function finish(nextState) {
      state = nextState
      if (state.outcome === 'escaped') {
        if (roundNumber) nextRoundAt = Date.now() + NEXT_ROUND_MS
        message = roundNumber ? `小狗脱险，已救援 ${roundNumber} 轮。` : '小狗已从逃生口脱险！'
      }
      else if (state.outcome === 'flooded') message = '水位到顶，小狗没能脱险。'
      else if (state.outcome === 'blocked') message = '棋盘上没有可消除的组合了。'
      else if (state.route.length) {
        const { cols, rows, closeAt } = state.level
        const reachedClosed = state.route.some(({ cell }) => cell >= cols * (rows - 1) && state.water >= closeAt?.[cell % cols])
        message = reachedClosed ? '水路接到了已关闭的出口，改走仍开放的出口。' : state.level.exits
          ? '水已流进棋盘，继续接通开放的排水口。' : '水已流进棋盘，继续接到底边。'
      }
      else message = '从棋盘上沿的水口开始接水路。'
      const tally = roundNumber && (state.outcome === 'flooded' || state.outcome === 'blocked')
        ? ` 累计救援 ${roundNumber - 1} 轮。` : ''
      announce(`${message}${tally} 水位 ${state.water}。`)
    }

    function draw(now) {
      if (active && nextRoundAt !== null && now >= nextRoundAt) continueLevel()
      updateWater(now)
      scheduleClock(now)
      ctx.setTransform(density, 0, 0, density, 0, 0)
      ctx.fillStyle = BACKGROUND
      ctx.fillRect(0, 0, width, height)
      ctx.translate(offsetX, offsetY)
      ctx.scale(scale, scale)

      let phase = {}
      let progress = 0
      let rescue = 0
      let view = state
      let rising = false
      if (rise) {
        progress = ease(clamp((now - rise.from) / 260))
        rising = progress < 1
        if (rising) view = { ...state, water: interpolate(rise.water, state.water, progress) }
        else rise = null
      }
      if (animation) {
        const age = Math.max(0, now - animation.from)
        let elapsed = age
        for (const part of animation.parts) {
          if (elapsed < part.duration) {
            phase = { ...part, t: ease(elapsed / part.duration) }
            break
          }
          elapsed -= part.duration
        }
        const { result, arrivals, flowSteps, channelMs, flowAt, flowDuration, rescueAt, end } = animation
        if (age >= end) {
          animation = null
          if (result) {
            finish(result.state.outcome === 'escaped' ? result.state : { ...result.state, water: state.water })
            view = state
          }
          const swipe = queuedSwipe
          queuedSwipe = null
          if (swipe && !state.outcome) move(...swipe)
        } else if (result) {
          if (age >= SWAP_MS) {
            phase.board ||= result.state.board
            phase.result = result
            const burstAge = age - SWAP_MS
            if (burstAge < BURST_MS) phase.burst = ease(burstAge / BURST_MS)
            if (result.longRuns.length && burstAge < LONG_BURST_MS) phase.longBurst = burstAge / LONG_BURST_MS
            phase.arrivals = arrivals
            phase.waterFront = clamp((burstAge - CLEAR_MS) / channelMs) * flowSteps
          }
          if (flowDuration && age >= flowAt) {
            progress = ease(clamp((age - flowAt) / flowDuration))
            phase.pumping = progress < 1
            if (phase.pumping) phase.pumpProgress = progress
            view = { ...state, water: interpolate(state.water, result.state.water, progress) }
          }
          if (rescueAt !== undefined) rescue = ease(clamp((age - rescueAt) / 245))
        }
      }

      label('水闸救援', 19, 36, 26, INK)
      label(roundNumber ? `无限救援 · 第 ${roundNumber} 轮` : '第 1 关', 134, 37, 13, INK)
      box(262, 22, 51, 30, 9, PANEL, PANEL_EDGE)
      label('重来', 287.5, 37, 13, INK, 700, 'center')
      box(321, 22, 51, 30, 9, PANEL, PANEL_EDGE)
      label('换盘', 346.5, 37, 13, INK, 700, 'center')
      ctx.save()
      ctx.translate(0, sceneY(0))
      ctx.scale(1, (sceneY(347) - 70) / 277)
      scene(view, progress, rising, rescue)
      ctx.restore()
      const route = board(phase)
      controls(now, outlets(route, state.level, state.rescueWater ?? state.water).length > 0)
      let status = message
      let statusColor = INK
      if (rescue) status = '小狗正在爬向逃生口。'
      else if (phase.pumping) status = '水正从棋盘底部排出。'
      else if (!state.outcome && state.level.closeAt) {
        const warning = state.level.exits.findIndex(col => state.water === state.level.closeAt[col] - 1)
        if (warning >= 0) {
          status = `${OUTLET_SIDE[warning]}出口下次涨水就会关闭。`
          statusColor = DANGER
        }
      }
      label(status, WIDTH / 2, 789, 13, statusColor, 600, 'center')

      if (intro) {
        box(0, 0, WIDTH, HEIGHT, 0, '#24443e85')
        box(25, 267, 340, 272, 20, PANEL, PANEL_EDGE)
        label('怎么玩', WIDTH / 2, 306, 24, INK, 700, 'center')
        label('滑动或点选相邻方块，凑成三个同色。', 48, 353, 14, INK)
        label('消开的格子会留下水路。', 48, 386, 14, INK)
        label('水涨满前，接通底边的金色排水口。', 48, 419, 14, INK)
        const { x, y, width, height } = START_BUTTON
        box(x, y, width, height, 12, '#edc67f')
        label('开始救援', WIDTH / 2, y + height / 2, 16, INK, 700, 'center')
      } else if (state.outcome) {
        const won = state.outcome === 'escaped'
        box(BOARD_INSET, layout.top - 13, WIDTH - 2 * BOARD_INSET, 783 - layout.top, 18, '#24443e9c')
        box(55, 512, 280, 145, 18, PANEL, PANEL_EDGE)
        const heading = state.outcome === 'flooded' ? '小狗被淹没了' : '救援中止'
        label(won ? '救援成功' : heading, WIDTH / 2, 549, 24, INK, 700, 'center')
        if (won && roundNumber) {
          label('正在进入下一轮…', WIDTH / 2, 607, 16, INK, 700, 'center')
        } else {
          if (roundNumber) label(`累计救援 ${roundNumber - 1} 轮`, WIDTH / 2, 576, 14, INK, 700, 'center')
          box(122, 586, 146, 42, 10, '#edc67f')
          label(won ? '开始无限救援' : roundNumber ? '从第 1 轮开始' : '再试一次',
            WIDTH / 2, 607, 16, '#253938', 700, 'center')
        }
      }
    }

    function reset() {
      pauseClock(Date.now())
      playedMs = 0
      clockSince = Date.now()
      nextRoundAt = null
      rise = null
      state = openings[levelIndex]
      layout = boardLayout(state.level)
      animation = null
      queuedSwipe = null
      selected = -1
      focus = -1
      pressed = null
      bonusNotice = null
      message = guided ? '交换描边的两块，接通第一段水路。' : levelIndex === 0
        ? '连成三个，把水绕到金色排水口。' : '每接通 6 格加 2 秒，常开口始终可用。'
      announce(roundNumber ? `无限救援第 ${roundNumber} 轮。${message}` : message)
      schedule()
    }

    function move(a, b) {
      const now = Date.now()
      updateWater(now)
      if (state.outcome) return
      selected = -1
      if (!state.board[a] || !state.board[b]) {
        schedule()
        return
      }
      const result = play(state, a, b)
      if (result) guided = false
      const earnedMs = (result?.state.bonusMs ?? 0) - (state.bonusMs ?? 0)
      const combo = result?.longRuns.reduce((longest, run) => Math.max(longest, run.length), 0)
      const feedback = [
        combo && `${combo} 连消。`,
        earnedMs > 0 && `水路加时 ${earnedMs / 1000} 秒。`,
      ].filter(Boolean).join(' ')
      if (earnedMs > 0) {
        bonusNotice = { seconds: earnedMs / 1000, until: now + 1200 }
        state = { ...state, bonusMs: result.state.bonusMs }
        clearTimeout(clockTimer)
        clockTimer = undefined
      }
      if (result?.state.outcome) {
        pauseClock(now)
        rise = null
      }
      if (!result) {
        message = '这一步无法连成三个。'
        announce(message)
      }
      if (reducedMotion()) {
        if (result) finish(result.state)
        if (feedback) announce(feedback)
        schedule()
        return
      }
      if (feedback) announce(feedback)
      const parts = [{ swap: [a, b], duration: SWAP_MS }]
      let end = SWAP_MS * 2
      let flowAt = SWAP_MS
      let flowDuration = 0
      let rescueAt
      let arrivals
      let flowSteps = 0
      let channelMs = 90
      if (result) {
        const alreadyWet = new Set(state.route.map(({ cell }) => cell))
        arrivals = new Map()
        for (const { cell, from } of result.state.route) {
          const step = alreadyWet.has(cell) ? -1 : (arrivals.get(from) ?? -1) + 1
          arrivals.set(cell, step)
          flowSteps = Math.max(flowSteps, step + 1)
        }
        parts.push({ board: result.swapped, cleared: result.cleared, duration: CLEAR_MS })
        channelMs = Math.min(310, Math.max(90, flowSteps * 23))
        end = SWAP_MS + (flowSteps ? CLEAR_MS + channelMs : BURST_MS)
        if (result.longRuns.length) end = Math.max(end, SWAP_MS + LONG_BURST_MS)
        if (result.state.outcome === 'escaped') {
          flowAt = end
          flowDuration = 275
          rescueAt = flowAt + 175
          end = rescueAt + 245
        }
      } else {
        const reversed = state.board.slice()
        reversed[a] = state.board[b]
        reversed[b] = state.board[a]
        parts.push({ board: reversed, swap: [a, b], duration: SWAP_MS })
      }
      animation = { from: now, parts, result, arrivals, flowSteps, channelMs, end, flowAt, flowDuration, rescueAt }
      schedule()
    }

    function choose(index) {
      if (!state.board[index]) {
        selected = -1
        announceCell(index)
        schedule()
        return
      }
      if (adjacent(selected, index, state.level)) move(selected, index)
      else {
        selected = selected === index ? -1 : index
        if (selected !== -1) announceCell(index)
        schedule()
      }
    }

    function announceCell(index) {
      const { cols } = state.level
      const name = COLORS[state.board[index]]?.[3] || '水槽'
      announce(`第 ${Math.floor(index / cols) + 1} 行，第 ${index % cols + 1} 列，${name}`)
    }

    function point(x, y) {
      return { x: (x - offsetX) / scale, y: (y - offsetY) / scale }
    }

    function cellAt({ x, y }) {
      const { left, top, pitch } = layout
      const { cols, rows } = state.level
      const col = Math.floor((x - left + 2) / pitch)
      const row = Math.floor((y - top + 2) / pitch)
      return col >= 0 && col < cols && row >= 0 && row < rows ? row * cols + col : -1
    }

    function continueLevel() {
      if (state.outcome === 'escaped') {
        levelIndex = 1
        roundNumber++
        pickOpening()
      } else if (roundNumber) {
        roundNumber = 1
        pickOpening()
      }
      reset()
    }

    function down(x, y) {
      pressed = point(x, y)
    }

    function startRescue() {
      intro = false
      if (active) clockSince = Date.now()
      announce(message)
      schedule()
    }

    function up(x, y) {
      if (!pressed) return
      const origin = pressed
      pressed = null
      if (nextRoundAt !== null) return
      const target = point(x, y)
      const dx = target.x - origin.x
      const dy = target.y - origin.y
      if (intro) {
        const { x, y, width, height } = START_BUTTON
        if (Math.hypot(dx, dy) < 14 && target.x >= x && target.x <= x + width &&
          target.y >= y && target.y <= y + height) startRescue()
        return
      }
      if (Math.hypot(dx, dy) < 14) {
        const resetButton = origin.x >= 262 && origin.x <= 313 && origin.y >= 22 && origin.y <= 52
        const shuffleButton = origin.x >= 321 && origin.x <= 372 && origin.y >= 22 && origin.y <= 52
        const replayButton = state.outcome && origin.x >= 122 && origin.x <= 268 && origin.y >= 586 && origin.y <= 628
        if (state.outcome && roundNumber) {
          if (replayButton) continueLevel()
          return
        }
        if (shuffleButton) {
          pickOpening()
          return reset()
        }
        if (resetButton) return reset()
        if (replayButton) return continueLevel()
      }
      if (state.outcome) return
      const from = cellAt(origin)
      if (from < 0) return
      focus = -1
      if (Math.hypot(dx, dy) < 14) {
        if (!animation) choose(from)
        return
      }
      const to = Math.abs(dx) > Math.abs(dy) ? from + Math.sign(dx) : from + state.level.cols * Math.sign(dy)
      if (!adjacent(from, to, state.level)) return
      if (animation) queuedSwipe = [from, to]
      else move(from, to)
    }

    function key(value) {
      if (intro) {
        if (value !== 'Enter' && value !== ' ') return false
        startRescue()
        return true
      }
      if (nextRoundAt !== null) return value === 'Enter' || value.toLowerCase() === 'r'
      if (value === 'Enter' && state.outcome) {
        continueLevel()
        return true
      }
      if (value.toLowerCase() === 'r') {
        if (!state.outcome || !roundNumber) reset()
        return true
      }
      const { cols } = state.level
      const arrows = { ArrowUp: -cols, ArrowDown: cols, ArrowLeft: -1, ArrowRight: 1 }
      if (!Object.hasOwn(arrows, value) && value !== 'Enter' && value !== ' ') return false
      if (animation || state.outcome) return true
      if (focus < 0) focus = 0
      else if (adjacent(focus, focus + arrows[value], state.level)) focus += arrows[value]
      if (value === 'Enter' || value === ' ') choose(focus)
      else announceCell(focus)
      schedule()
      return true
    }

    resize(options.width, options.height, options.pixelRatio)
    announce('怎么玩。交换相邻方块，凑成三个同色，把水引到金色排水口。按回车开始救援。')
    return { down, up, cancel: () => { pressed = null }, resize, key, setActive }
  }

  if (typeof module === 'object') module.exports = { mount }
  else globalThis.RescueScene = { mount }
})()
