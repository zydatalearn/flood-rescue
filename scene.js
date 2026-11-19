(function () {
  const puzzle = typeof module === 'object' ? require('./puzzle.js') : globalThis.RescuePuzzle
  const { MAX_WATER, FLOOD_MS, levelCount, deal, adjacent, advanceWater, play, outlets } = puzzle
  const WIDTH = 390
  const HEIGHT = 806
  const SWAP_MS = 68
  const CHANNEL_MS = 155
  const COLORS = {
    A: ['#ffcca2', '#d99066', '#704533', '扳手'],
    B: ['#a9efdc', '#61b9ae', '#285d5e', '水滴'],
    C: ['#d8d2ff', '#aaa3d5', '#514c79', '螺母'],
    D: ['#ffe09a', '#d5aa57', '#715326', '闪电'],
    E: ['#ffc6bf', '#d98e93', '#75424f', '救生圈'],
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
    const openings = []
    pickOpening()
    let state = openings[levelIndex]
    let layout = boardLayout(state.level)
    let animation = null
    let queuedSwipe = null
    let pressed = null
    let selected = -1
    let focus = -1
    let message = '连成三个，消开的格子会留下水路。'
    let framePending = false
    let clockSince = Date.now()
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
        state = next
      }
    }

    function scheduleClock(now) {
      if (clockSince === null || clockTimer !== undefined) return
      clockTimer = setTimeout(() => {
        clockTimer = undefined
        schedule()
      }, 1000 - elapsed(now) % 1000)
    }

    function setActive(active) {
      const now = Date.now()
      if (!active) {
        updateWater(now)
        pauseClock(now)
        pressed = null
      } else if (clockSince === null && !state.outcome && !animation?.result?.state.outcome) {
        clockSince = now
        schedule()
      }
    }

    function pickOpening() {
      openings[levelIndex] = deal(levelIndex, random, openings[levelIndex]).state
    }

    function boardLayout({ cols, rows }) {
      const top = rows > 9 ? 339 : 367
      const pitch = Math.min(Math.floor(336 / cols), Math.floor((763 - top) / rows))
      const cell = pitch - 4
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
        if (animation || rise) schedule()
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
      ctx.fillStyle = foreground ? '#459eae66' : ramp(y, bottom - y, '#62c4c3', '#265c79')
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
      // Keep the portrait round in the shorter second-level panorama.
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
      line(path, '#0b1e2a', 13)
      line(path, '#607982', 9)
      line(path, '#334f5f', 5)
    }

    function scene(view, phase, rising, rescue) {
      box(17, 70, 356, 277, 19, '#192b38', '#354a54')
      ctx.save()
      round(18, 71, 354, 275, 18)
      ctx.clip()
      box(25, 78, 340, 230, 12, ramp(78, 230, '#253756', '#78979a'))
      const portraitScale = 277 / (277 + layout.top - 429)
      oval(214, 136, 25, 25 * portraitScale, '#ead9b00e')
      oval(214, 136, 18, 18 * portraitScale, '#f4e4bb')
      for (const [x, y] of [[48, 110], [83, 143], [142, 111], [168, 140], [253, 103], [330, 135]]) {
        oval(x, y, 1, 1, '#e4e2cf')
      }
      ctx.save()
      round(25, 78, 340, 223, 12)
      ctx.clip()
      ctx.beginPath()
      ctx.moveTo(25, 199)
      ctx.bezierCurveTo(99, 132, 115, 205, 181, 177)
      ctx.bezierCurveTo(245, 143, 271, 192, 365, 149)
      ctx.lineTo(365, 308)
      ctx.lineTo(25, 308)
      ctx.fillStyle = '#485e72'
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(25, 201)
      ctx.bezierCurveTo(106, 155, 178, 251, 266, 192)
      ctx.quadraticCurveTo(326, 165, 365, 185)
      ctx.lineTo(365, 308)
      ctx.lineTo(25, 308)
      ctx.fillStyle = '#314e60'
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
      box(249, 201, 70, 95, 4, '#102932')
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

      label('进水', 78, 98, 11, '#cfdecf')
      for (let i = 0; i < MAX_WATER; i++) {
        box(86 + i * 16, 322, 12, 4, 2, i < Math.round(view.water) ? '#9ad9cb' : '#344d59')
      }
      label('水位', 49, 325, 11, '#bdced1')
      label(`${Math.round(view.water)} / ${MAX_WATER}`, 344, 325, 12, view.water >= MAX_WATER - 2 ? '#ffd19c' : '#d9eee7', 700, 'right')
      ctx.restore()
      for (const x of [28, 362]) for (const y of [81, 335]) oval(x, y, 2, 2, '#6e9092')
    }

    function controls(now, connected) {
      const y = 363 + layout.top - 429
      const routeGoal = state.level.exits ? '接通任一金色排水口' : '消格子接通底边'
      const seconds = connected ? Math.floor(elapsed(now) / 1000) :
        Math.max(0, Math.ceil((FLOOD_MS - elapsed(now)) / 1000))
      const danger = seconds <= 10 && !connected
      const timeColor = danger ? '#ffc38d' : '#f0e8d1'
      box(17, y, 172, 37, 9, '#15303a', danger ? '#855f46' : '#2b4b54')
      oval(36, y + 18, 8, 8, timeColor)
      line([[36, y + 13], [36, y + 18], [39, y + 20]], '#102e39', 1.5)
      label(connected ? '用时' : '距淹没', 51, y + 19, 12, timeColor)
      label(`00:${String(seconds).padStart(2, '0')}`, 174, y + 19, 17, timeColor, 700, 'right')
      box(201, y, 172, 37, 9, '#15303a', '#2b4b54')
      box(209, y + 7, 24, 23, 6, COLORS.B[0])
      line([[215, y + 12], [221, y + 12], [221, y + 24], [227, y + 24]], '#102e39', 3)
      label(connected ? '水路已接通' : routeGoal, 244, y + 19, 12, connected ? '#aee9c1' : '#f0e8d1')
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
      box(x, y + 1.5, cell, cell, radius, '#0d1b24')
      box(x, y + depth, cell, faceHeight, radius, edge)
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
        ctx.strokeStyle = selectedTile ? '#fff0a5' : '#ffffff'
        ctx.lineWidth = 2.5
        ctx.stroke()
      }
      ctx.restore()
    }

    function board(phase) {
      const { cols, entry } = state.level
      const { left, top, pitch, cell } = layout
      box(17, top - 13, 356, 783 - top, 18, '#192b38', '#354a54')
      const entries = phase.board || state.board
      const ground = phase.result?.state.board || state.board
      const route = phase.result?.state.route || state.route
      const wet = new Map()
      const alreadyWet = new Set(state.route.map(({ cell: index }) => index))
      const depthCount = route.length ? route.at(-1).depth + 1 : 1
      for (const { cell: index, from, depth } of route) {
        const amount = alreadyWet.has(index) ? 1 : clamp((phase.routeProgress ?? 1) * depthCount - depth)
        wet.set(index, { from, amount })
      }

      for (let i = 0; i < ground.length; i++) {
        if (ground[i] !== null) continue
        const [x, y] = center(i)
        box(x - cell / 2, y - cell / 2, cell, cell + 1, 7, '#071c28', '#284955')
      }
      for (let i = 0; i < ground.length; i++) {
        if (ground[i] !== null) continue
        const [x, y] = center(i)
        for (const neighbor of [i + 1, i + cols]) {
          if (!adjacent(i, neighbor, state.level) || ground[neighbor] !== null) continue
          const [nx, ny] = center(neighbor)
          const joined = wet.get(i)?.amount === 1 && wet.get(neighbor)?.amount === 1
          ctx.fillStyle = joined ? '#218eaa' : '#081f2b'
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
        ctx.fillStyle = ramp(startY, size, '#40bada', '#177c9d')
        if (fx === x) ctx.fillRect(startX, startY, size, size * amount)
        else ctx.fillRect(fx < x ? startX : startX + size * (1 - amount), startY, size * amount, size)
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
      round(24, top - 6, 342, 769 - top, 11)
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
      if (focus >= 0 && !ground[focus]) {
        const [x, y] = center(focus)
        round(x - cell / 2 + 2, y - cell / 2 + 2, cell - 4, cell - 4, 7)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.stroke()
      }
      ctx.restore()
      drawPorts(entry, route, wet, phase.routeProgress, phase.pumping)
      return route
    }

    function drawPorts(entry, route, wet, progress, pumping) {
      const { exits, cols, rows } = state.level
      const { top, cell } = layout
      const [entryX] = center(entry)
      const inlet = [[253, sceneY(304)], [253, sceneY(352)], [195, sceneY(352)],
        [195, top - 20], [entryX, top - 20], [entryX, top]]
      line(inlet, '#101e2b', 10)
      line(inlet, '#456672', 7)
      line(inlet, route.length ? '#41acc0' : '#254550', 3)
      box(entryX - 9, top - 5, 18, 6, 3, '#a8f0dc')
      const ports = exits ? exits.map(col => (rows - 1) * cols + col) : outlets(route, state.level)
      for (const index of ports) {
        const [x, y] = center(index)
        const mouth = y + cell / 2 + 2
        const active = wet.get(index)?.amount === 1
        box(x - 11, mouth - 4, 22, 7, 3, active ? '#a8f0dc' : '#edbc67')
        if (active && pumping) {
          oval(x, mouth + 4 + (progress || 0) * 4, 2.5, 3.5, '#8de9ed')
        }
      }
    }

    function finish(nextState) {
      state = nextState
      if (state.outcome === 'escaped') {
        message = levelIndex === levelCount - 1 ? '小狗脱险，两关全部通关！' : '小狗已从逃生口脱险！'
      }
      else if (state.outcome === 'flooded') message = '水位到顶，小狗没能脱险。'
      else if (state.outcome === 'blocked') message = '棋盘上没有可消除的组合了。'
      else if (state.route.length) message = state.level.exits
        ? '水已流进棋盘，继续接通任一排水口。' : '水已流进棋盘，继续接到底边。'
      else message = '从棋盘上沿的水口开始接水路。'
      announce(`${message} 水位 ${state.water}。`)
    }

    function draw(now) {
      updateWater(now)
      scheduleClock(now)
      ctx.setTransform(density, 0, 0, density, 0, 0)
      ctx.fillStyle = '#101e2b'
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
        const { result, flowAt, flowDuration, rescueAt, end } = animation
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
            phase.routeProgress = clamp((age - SWAP_MS) / CHANNEL_MS)
          }
          if (flowDuration && age >= flowAt) {
            progress = ease(clamp((age - flowAt) / flowDuration))
            phase.pumping = progress < 1
            view = { ...state, water: interpolate(state.water, result.state.water, progress) }
          }
          if (rescueAt !== undefined) rescue = ease(clamp((age - rescueAt) / 245))
        }
      }

      label('水闸救援', 19, 36, 26)
      label(`第 ${levelIndex + 1} 关`, 134, 37, 13, '#cbdcd4')
      box(262, 22, 51, 30, 9, '#193743', '#3a5861')
      label('重来', 287.5, 37, 13, '#dfdfc8', 700, 'center')
      box(321, 22, 51, 30, 9, '#193743', '#3a5861')
      label('换盘', 346.5, 37, 13, '#dfdfc8', 700, 'center')
      ctx.save()
      ctx.translate(0, sceneY(0))
      ctx.scale(1, (sceneY(347) - 70) / 277)
      scene(view, progress, rising, rescue)
      ctx.restore()
      const route = board(phase)
      controls(now, outlets(route, state.level).length > 0)
      let status = message
      if (rescue) status = '小狗正在爬向逃生口。'
      else if (phase.pumping) status = '水正从棋盘底部排出。'
      else if (phase.result?.state.route.length) status = '水正沿着消开的格子往下流。'
      label(status, WIDTH / 2, 789, 13, '#cbdcd4', 600, 'center')

      if (state.outcome) {
        const won = state.outcome === 'escaped'
        const final = levelIndex === levelCount - 1
        box(17, layout.top - 13, 356, 783 - layout.top, 18, '#081f2bc9')
        box(55, 512, 280, 145, 18, '#12313c', '#537477')
        const heading = state.outcome === 'flooded' ? '小狗被淹没了' : '救援中止'
        label(won ? (final ? '两关全部通关' : '救援成功') : heading, WIDTH / 2, 550, 24, '#f1e2b5', 700, 'center')
        box(122, 586, 146, 42, 10, '#f2bf73')
        label(won ? (final ? '再玩一轮' : '挑战第二关') : '再试一次', WIDTH / 2, 607, 16, '#253938', 700, 'center')
      }
    }

    function reset() {
      pauseClock(Date.now())
      playedMs = 0
      clockSince = Date.now()
      rise = null
      state = openings[levelIndex]
      layout = boardLayout(state.level)
      animation = null
      queuedSwipe = null
      selected = -1
      focus = -1
      pressed = null
      message = levelIndex === 0 ? '连成三个，消开的格子会留下水路。' : '消开格子，把水引向任一金色排水口。'
      announce(message)
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
        schedule()
        return
      }
      const parts = [{ swap: [a, b], duration: SWAP_MS }]
      let end = SWAP_MS * 2
      let flowAt = SWAP_MS
      let flowDuration = 0
      let rescueAt
      if (result) {
        parts.push({ board: result.swapped, cleared: result.cleared, duration: 80 })
        end = SWAP_MS + CHANNEL_MS
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
      animation = { from: now, parts, result, end, flowAt, flowDuration, rescueAt }
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
        levelIndex = (levelIndex + 1) % levelCount
        pickOpening()
      }
      reset()
    }

    function down(x, y) {
      pressed = point(x, y)
    }

    function up(x, y) {
      if (!pressed) return
      const origin = pressed
      pressed = null
      const target = point(x, y)
      const dx = target.x - origin.x
      const dy = target.y - origin.y
      if (Math.hypot(dx, dy) < 14) {
        const resetButton = origin.x >= 262 && origin.x <= 313 && origin.y >= 22 && origin.y <= 52
        const shuffleButton = origin.x >= 321 && origin.x <= 372 && origin.y >= 22 && origin.y <= 52
        const replayButton = state.outcome && origin.x >= 122 && origin.x <= 268 && origin.y >= 586 && origin.y <= 628
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
      if (value === 'Enter' && state.outcome) {
        continueLevel()
        return true
      }
      if (value.toLowerCase() === 'r') {
        reset()
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
    return { down, up, cancel: () => { pressed = null }, resize, key, setActive }
  }

  if (typeof module === 'object') module.exports = { mount }
  else globalThis.RescueScene = { mount }
})()
