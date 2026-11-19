(function () {
  const puzzle = typeof module === 'object' ? require('./puzzle.js') : globalThis.RescuePuzzle
  const visuals = typeof module === 'object' ? require('./effects.js') : globalThis.RescueEffects
  const challenges = typeof module === 'object' ? require('./challenge.js') : globalThis.RescueChallenge
  const { MAX_WATER, floodTime, deal, adjacent, advanceWater, play, outlets, TOOL_COST, ROCK, PLATE, CRACKED,
    isTile, useTool, suggest } = puzzle
  const { dailyDate, dailyRandom, recordStore, grade, UPGRADES, SKINS } = challenges
  const { SWAP_MS, RETURN_MS, MATCH_MS, CLEAR_MS, LINE_MS, swapPose, matchPose, createEffects } = visuals
  const WIDTH = 390
  const HEIGHT = 806
  const BOARD_INSET = 9
  const START_BUTTON = { x: 99, y: 462, width: 192, height: 48 }
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
    let ctx = canvas.getContext('2d')
    const { safeTop = 0, safeBottom = 0, requestFrame } = options
    const effects = createEffects(options.lowDetail)
    const { record, save } = recordStore(options.storage)
    const sound = {
      play: event => { if (!record.muted) options.sound?.play(event) },
      unlock: () => { if (!record.muted) options.sound?.unlock() },
    }
    const tileSprites = new Map()
    const frameTime = () => globalThis.performance?.now() ?? Date.now()
    const announce = options.announce || (() => {})
    const reducedMotion = options.reducedMotion || (() => false)
    const random = options.random || Math.random
    let width, height, scale, offsetX, offsetY, density
    let levelIndex = 0
    let roundNumber = 0
    let nextRoundAt = null
    let mode = 'endless'
    let date
    let dailyElapsed = 0
    let dailyResults = []
    let rerolls = 2
    let runCharge = {}
    let upgrades = {}
    let choices = null
    let weather
    let supply = 0
    let restartConfirm = false
    let pausedAt = null
    let gallery = false
    let help = false
    let toolHelp = false
    let chapterSelect = false
    let galleryPage = 0
    const galleryImages = []
    const galleryLoading = new Set()
    let skin = record.skin
    let toolTarget = null
    let hint
    let hintDue = 8000
    let dryMoves = 0
    let usedTool = false
    let unlockedPet
    let moodTimer
    let stars = 0
    let urgencySecond
    let active = true
    let hiddenAt
    let intro = true
    let guided = true
    let openingMove
    const openings = []
    pickOpening()
    let state = openings[levelIndex]
    let layout
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
      const seconds = Math.ceil(remaining(now) / 1000)
      if (seconds > 0 && seconds <= 10 && seconds !== urgencySecond) sound.play('pulse')
      urgencySecond = seconds
      const next = advanceWater(state, elapsed(now))
      if (next === state) return
      if (next.outcome === 'flooded') {
        animation = null
        effects.clearEffects()
        queuedSwipe = null
        rise = null
        pauseClock(now)
        finish(next)
      } else {
        rise = reducedMotion() ? null : { from: now, water: state.water }
        const { exits, closeAt } = state.level
        const closed = closeAt ? exits.findIndex(col => state.gateWater < closeAt[col] && next.gateWater >= closeAt[col]) : -1
        const warning = closeAt ? exits.findIndex(col => next.water === closeAt[col] - 1 && next.gateWater < closeAt[col]) : -1
        if (closed >= 0) {
          message = `${OUTLET_SIDE[closed]}出口已关，可改接仍开放的出口。`
          announce(message)
        }
        if (warning >= 0) {
          announce(`${OUTLET_SIDE[warning]}出口下次涨水就会关闭。`)
          sound.play('warn')
        }
        state = next
      }
    }

    function scheduleClock(now) {
      if (clockSince === null || clockTimer !== undefined) return
      const played = elapsed(now)
      const riseMs = floodTime(state.level) / (MAX_WATER - 1)
      const bonus = state.bonusMs ?? 0
      const nextSecond = remaining(now) % 1000 || 1000
      const nextRise = state.water * riseMs + bonus - played - (state.pressureOffset ?? 0)
      clockTimer = setTimeout(() => {
        clockTimer = undefined
        schedule()
      }, Math.min(nextSecond, nextRise))
    }

    function remaining(now) {
      return floodTime(state.level) + (state.bonusMs ?? 0) - (state.pressureOffset ?? 0) - elapsed(now)
    }

    function setActive(nextActive) {
      if (active === nextActive) return
      const now = Date.now()
      active = nextActive
      if (!active) {
        updateWater(now)
        pauseClock(now)
        clearTimeout(moodTimer)
        moodTimer = undefined
        hiddenAt = now
        rise = null
        queuedSwipe = null
        pressed = null
      } else {
        if (animation && pausedAt === null) animation.from += now - hiddenAt
        if (!intro && pausedAt === null && !choices && clockSince === null && !state.outcome &&
          !animation?.result?.state.outcome) clockSince = now
        if (animation || !state.outcome || nextRoundAt !== null) schedule()
      }
    }

    function pickOpening() {
      const levelRound = mode === 'chapters' ? Math.max(1, roundNumber - (roundNumber < 8 ? 2 : 1)) : roundNumber
      const opening = deal(levelIndex, mode === 'daily' ? dailyRandom(date, roundNumber) : random,
        mode === 'daily' ? undefined : openings[levelIndex], levelRound,
        mode === 'daily' ? { fixed: true } : mode === 'chapters' ? { gateDelay: 1 } : { ...upgrades, weather, supply })
      openings[levelIndex] = opening.state
      if (levelIndex === 0) openingMove = opening.paths[0][0]
    }

    function boardLayout({ cols, rows, tools }) {
      const top = tools ? 269 : rows > 9 ? 294 : 337
      const bottom = tools ? 750 : 783
      const panelWidth = Math.min(width / scale, WIDTH + 76) - 2 * BOARD_INSET
      const panelLeft = (WIDTH - panelWidth) / 2
      const pitch = Math.floor((bottom - 20 - top) / rows)
      const pitchX = Math.min(Math.floor((panelWidth - 18) / cols), Math.floor(pitch * 1.4))
      const gap = rows > 12 ? 2 : 4
      const cell = pitch - gap
      const cellWidth = pitchX - gap
      const left = (WIDTH - (cols - 1) * pitchX - cellWidth) / 2
      return { top, bottom, pitch, pitchX, cell, cellWidth, left, panelLeft, panelWidth }
    }

    function center(index) {
      const { left, top, pitch, pitchX, cell, cellWidth } = layout
      const { cols } = state.level
      return [left + (index % cols) * pitchX + cellWidth / 2, top + Math.floor(index / cols) * pitch + cell / 2]
    }

    function sceneY(y) {
      return 70 + (y - 70) * (277 + layout.top - 429) / 277
    }

    function sceneLabel(value, x, y, size, color, weight, align) {
      ctx.save()
      ctx.translate(x, y)
      ctx.scale(1, portraitScale())
      label(value, 0, 0, size, color, weight, align)
      ctx.restore()
    }

    function portraitScale() {
      return intro ? 1 : 277 / (277 + layout.top - 429)
    }

    function resize(nextWidth, nextHeight, pixelRatio) {
      const nextDensity = Math.min(pixelRatio, options.lowDetail ? 1.5 : 2)
      if (width === nextWidth && height === nextHeight && density === nextDensity) return
      width = nextWidth
      height = nextHeight
      density = nextDensity
      canvas.width = Math.round(width * density)
      canvas.height = Math.round(height * density)
      const usableHeight = Math.max(1, height - safeTop - safeBottom)
      scale = Math.max(0.01, Math.min(width / WIDTH, usableHeight / HEIGHT, 1.25))
      offsetX = (width - WIDTH * scale) / 2
      offsetY = safeTop + (usableHeight - HEIGHT * scale) / 2
      layout = boardLayout(state.level)
      tileSprites.clear()
      if (animation?.result) prepareParticles(animation.result)
      schedule()
    }

    function schedule() {
      if (framePending || !active) return
      framePending = true
      requestFrame(() => {
        framePending = false
        if (!active) return
        const start = animation ? frameTime() : null
        draw(Date.now())
        if (start !== null) effects.observeFrame(frameTime() - start)
        if ((pausedAt === null && animation) || rise || nextRoundAt !== null) schedule()
        else if (!moodTimer && !intro && pausedAt === null && !state.outcome && state.water >= 8 && !reducedMotion()) {
          moodTimer = setTimeout(() => { moodTimer = undefined; schedule() }, 85)
        }
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

    function polygon(points, color) {
      ctx.beginPath()
      ctx.moveTo(...points[0])
      for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i])
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
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

    function dog(x, y, safe, waterLevel, phase = 0) {
      ctx.save()
      ctx.translate(x, y)
      // Preserve the portrait proportions as the panorama changes height.
      ctx.scale(0.92, 0.92 * portraitScale())
      const worried = !safe && waterLevel >= 8
      const colors = SKINS[skin].fur ?? ['#f6c483', '#c67b4b']
      const fur = ramp(-24, 52, ...colors)
      const cream = '#fff1d5'
      const ink = '#39303a'
      oval(13, 22, 22, 15, fur)
      oval(30, 15, 8, 7, cream)
      for (const side of [-1, 1]) {
        ctx.save()
        ctx.scale(side, 1)
        if (skin === 2 || skin === 4 || skin === 5 || skin === 6) ctx.rotate(0.78)
        if (worried) ctx.rotate(0.34)
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
      if (skin === 3) {
        oval(13, -13, 6, 5, '#595953')
        oval(-21, -1, 5, 4, '#595953')
        oval(18, 16, 4, 3, '#595953')
      }
      if (skin === 7) {
        for (const side of [-1, 1]) {
          line([[side * 16, 6], [side * 31, 2]], ink, 1.2)
          line([[side * 17, 9], [side * 31, 10]], ink, 1.2)
        }
      }
      if (record.medals.includes(3)) {
        box(-17, -32, 34, 8, 3, '#2a5562')
        box(-10, -39, 22, 11, 4, PANEL, '#2a5562')
      } else if (record.medals.includes(0)) {
        line([[-24, -5], [24, -5]], '#34616a', 2)
        for (const side of [-1, 1]) oval(side * 12, -5, 9, 7, '#8ac6d45a')
      } else if (record.medals.includes(1)) {
        oval(29, 22, 7, 5, '#f6ce68')
        oval(33, 18, 4, 4, '#ffe093')
      }
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
      const paddle = worried ? Math.sin(phase * Math.PI * 4) * 6 : 0
      oval(-13, 29 - paddle, 7, 5, cream)
      oval(13, 29 + paddle, 7, 5, cream)
      if (worried) {
        oval(32, -13, 2.8, 4.8, '#b4e8f1')
        oval(37, 22 - paddle, 3.3, 2.2, '#dcfff2')
        oval(-34, 16 + paddle, 2.6, 1.8, '#dcfff2')
      }
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
      const sky = mode === 'endless' && roundNumber >= 7
        ? roundNumber % 2 ? ['#a9bada', '#e2e4f4'] : ['#8fa9be', '#e7cbb9']
        : ['#b5d9d5', '#f4e6c6']
      box(25, 78, 340, 230, 12, ramp(78, 230, ...sky))
      oval(214, 136, 25, 25 * portraitScale(), '#fff2c755')
      oval(214, 136, 18, 18 * portraitScale(), '#fff2c7')
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
      dog(interpolate(144, 273, climb), interpolate(swimY, 213, climb), climb > 0.7, view.water, phase)
      water(25, y, 340, 301, phase * 7, true)
      if (view.water >= 10 && !view.outcome) {
        box(169, swimY - 48 - 10 * portraitScale(), 102, 20 * portraitScale(), 8, PANEL, PANEL_EDGE)
        sceneLabel('快帮我开闸！', 220, swimY - 48, 12, DANGER, 700, 'center')
      }
      ctx.restore()

      sceneLabel('进水', 78, 98, 11, INK)
      for (let i = 0; i < MAX_WATER; i++) {
        box(86 + i * 16, 322, 12, 4, 2, i < Math.round(view.water) ? WATER : '#c4d0c4')
      }
      sceneLabel('水位', 37, 325, 11, INK)
      sceneLabel(`${Math.round(view.water)} / ${MAX_WATER}`, 344, 325, 12, view.water >= MAX_WATER - 2 ? DANGER : INK, 700, 'right')
      ctx.restore()
      for (const x of [28, 362]) for (const y of [81, 335]) oval(x, y, 2, 2, '#6e9092')
    }

    function controls(now, connected) {
      const y = 363 + layout.top - 429
      const routeGoal = state.level.closeAt ? '数字标示关闭水位' : '接通金色排水口'
      const seconds = connected ? Math.floor(elapsed(now) / 1000) :
        Math.max(0, Math.ceil(remaining(now) / 1000))
      const danger = seconds <= 10 && !connected
      const timeColor = danger ? DANGER : INK
      box(17, y, 172, 37, 9, danger ? '#fff0df' : PANEL, danger ? '#cc8b68' : PANEL_EDGE)
      oval(36, y + 18, 8, 8, timeColor)
      line([[36, y + 13], [36, y + 18], [39, y + 20]], '#ffffff', 1.5)
      label(connected ? '用时' : '距淹没', 51, y + 19, 12, timeColor)
      if (!connected && bonusNotice?.until > now) {
        label(`+${bonusNotice.seconds} 秒`, 102, y + 19, 11, '#246756', 700, 'center')
      }
      label(`${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`,
        174, y + 19, 17, timeColor, 700, 'right')
      box(201, y, 172, 37, 9, PANEL, PANEL_EDGE)
      box(209, y + 7, 24, 23, 6, COLORS.B[0])
      line([[215, y + 12], [221, y + 12], [221, y + 24], [227, y + 24]], '#102e39', 3)
      label(connected ? '水路已接通' : routeGoal, 244, y + 19, 12, connected ? '#246756' : INK)
    }

    function paintTile(type, x, y) {
      const [bright, middle, edge] = COLORS[type]
      const { cell, cellWidth } = layout
      const radius = cell * 0.25
      const depth = cell * 0.12
      const faceHeight = cell - depth
      box(x, y + 1.5, cellWidth, cell, radius, '#294a3e38')
      box(x, y + depth, cellWidth, faceHeight, radius, edge + 'a6')
      box(x, y, cellWidth, faceHeight, radius, ramp(y, faceHeight, bright, middle))
      box(x + cellWidth * 0.12, y + faceHeight * 0.1, cellWidth * 0.46, faceHeight * 0.12,
        faceHeight * 0.055, '#fff9ec42')
      const iconSize = Math.min(0.98, cell / 38)
      symbol(type, x + cellWidth / 2, y + faceHeight / 2 + 0.8, iconSize, edge)
    }

    function tileSprite(type) {
      if (!options.createTileSurface) return null
      if (tileSprites.has(type)) return tileSprites.get(type)
      const { cell, cellWidth } = layout
      const surface = options.createTileSurface(Math.ceil(cellWidth * density), Math.ceil((cell + 2) * density))
      const spriteContext = surface?.getContext('2d')
      if (!spriteContext) {
        tileSprites.set(type, null)
        return null
      }
      const main = ctx
      ctx = spriteContext
      try {
        ctx.setTransform(surface.width / cellWidth, 0, 0, surface.height / (cell + 2), 0, 0)
        paintTile(type, 0, 0)
      } finally {
        ctx = main
      }
      tileSprites.set(type, surface)
      return surface
    }

    function tile(type, x, y, selectedTile, focused, pose) {
      const { cell, cellWidth } = layout
      if (!isTile(type)) {
        box(x, y, cellWidth, cell, cell * 0.18, '#72837a', '#394b46')
        if (type === ROCK) {
          polygon([[x + 3, y + cell * 0.64], [x + cellWidth * 0.31, y + 3],
            [x + cellWidth * 0.77, y + 5], [x + cellWidth - 3, y + cell * 0.75],
            [x + cellWidth * 0.42, y + cell - 3]], '#3e504a')
          polygon([[x + cellWidth * 0.3, y + 5], [x + cellWidth * 0.72, y + 6],
            [x + cellWidth * 0.46, y + cell * 0.45]], '#b8c2ad')
        } else {
          box(x + 2, y + 2, cellWidth - 4, cell - 4, 4, '#a7806a', '#624b3f')
          for (const dx of [5, cellWidth - 5]) for (const dy of [5, cell - 5]) oval(x + dx, y + dy, 1.7, 1.7, '#e1c9ad')
          if (type === CRACKED) line([[x + cellWidth * 0.6, y + 2], [x + cellWidth * 0.42, y + cell * 0.41],
            [x + cellWidth * 0.59, y + cell * 0.62], [x + cellWidth * 0.35, y + cell - 2]], '#402c26', 2)
        }
        return
      }
      const sprite = tileSprite(type)
      const faceHeight = cell * 0.88
      const transformed = pose || selectedTile || focused
      if (transformed) ctx.save()
      if (pose) {
        ctx.translate(x + cellWidth / 2, y + cell / 2)
        ctx.scale(pose.scale, pose.scale)
        ctx.translate(-x - cellWidth / 2, -y - cell / 2)
        ctx.globalAlpha = pose.alpha ?? 1
      }
      if (selectedTile) y += cell * 0.05
      if (sprite) ctx.drawImage(sprite, x, y, cellWidth, cell + 2)
      else paintTile(type, x, y)
      if (pose?.flash) {
        ctx.globalAlpha = pose.flash
        box(x + 2, y + 2, cellWidth - 4, faceHeight - 4, cell * 0.21, '#fff8df')
        oval(x + cellWidth / 2, y + faceHeight / 2, cell * 0.12, cell * 0.08, '#fffdf4')
        ctx.globalAlpha = pose.alpha
      }
      if (selectedTile || focused) {
        round(x + 1, y + 1, cellWidth - 2, faceHeight - 2, cell * 0.22)
        ctx.strokeStyle = selectedTile ? '#653e29' : INK
        ctx.lineWidth = 2.5
        ctx.stroke()
      }
      if (transformed) ctx.restore()
    }

    function clearBurst(index, type, progress) {
      const [x, y] = center(index)
      const size = layout.cell
      const color = COLORS[type]?.[1] ?? '#d9c4a7'
      ctx.save()
      ctx.globalAlpha = (1 - progress) * 0.85
      ctx.beginPath()
      ctx.arc(x, y, size * (0.18 + 0.48 * progress), 0, 2 * Math.PI)
      ctx.lineWidth = Math.max(1, size * 0.05 * (1 - progress))
      ctx.strokeStyle = color
      ctx.stroke()
      ctx.restore()
    }

    function prepareParticles(result) {
      effects.prepareMatch(result.cleared, center, index => COLORS[result.swapped[index]]?.[1] ?? '#d9c4a7', layout.cell,
        result.longRuns.reduce((longest, run) => Math.max(longest, run.length), 3))
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
      if (!effects.lowDetail) line(points, COLORS[type][1], size * (strong ? 0.54 : 0.32))
      line(points, strong ? '#ffe9a2' : '#fffbec', size * (strong ? 0.22 : 0.12))
      if (showCount) {
        const minX = layout.panelLeft + 38
        const maxX = layout.panelLeft + layout.panelWidth - 38
        const midX = Math.min(maxX, Math.max(minX, (x + endX) / 2))
        const midY = Math.max(layout.top + 13, (y + endY) / 2 - size * 0.6)
        box(midX - 32, midY - 10, 64, 20, 9, strong ? '#ffeaab' : PANEL, COLORS[type][2])
        label(`${length} 连消`, midX, midY, 12, INK, 700, 'center')
      }
      ctx.restore()
    }

    function board(phase) {
      const { cols, entry } = state.level
      const { left, top, bottom, pitch, pitchX, cell, cellWidth, panelLeft, panelWidth } = layout
      box(panelLeft, top - 13, panelWidth, bottom - top, 18, BOARD, '#8fa99b')
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
        box(x - cellWidth / 2, y - cell / 2, cellWidth, cell + 1, 7, DRY_SLOT)
      }
      for (let i = 0; i < ground.length; i++) {
        if (ground[i] !== null) continue
        const [x, y] = center(i)
        for (const neighbor of [i + 1, i + cols]) {
          if (!adjacent(i, neighbor, state.level) || ground[neighbor] !== null) continue
          const [nx, ny] = center(neighbor)
          const joined = wet.get(i)?.amount === 1 && wet.get(neighbor)?.amount === 1
          ctx.fillStyle = joined ? WATER : DRY_SLOT
          if (nx > x) ctx.fillRect(x + cellWidth / 2 - 4, y - cell * 0.34, pitchX - cellWidth + 8, cell * 0.68)
          else ctx.fillRect(x - cellWidth * 0.34, y + cell / 2 - 4, cellWidth * 0.68, pitch - cell + 8)
        }
      }

      for (const [index, { from, amount }] of wet) {
        if (!amount) continue
        const [x, y] = center(index)
        const [fx, fy] = from < 0 ? [x, y] : center(from)
        const size = cell - 4
        const wetWidth = cellWidth - 4
        const startX = x - wetWidth / 2
        const startY = y - size / 2
        ctx.save()
        round(startX, startY, wetWidth, size, 6)
        ctx.clip()
        ctx.fillStyle = ramp(startY, size, '#81dfcc', WATER)
        const filled = (fx === x ? size : wetWidth) * amount
        const leadingX = fx < x ? startX + filled : startX + wetWidth - filled
        if (fx === x) ctx.fillRect(startX, fy > y ? startY + size - filled : startY, wetWidth, filled)
        else ctx.fillRect(fx < x ? startX : leadingX, startY, filled, size)
        if (amount < 1) {
          ctx.fillStyle = '#dcfff2'
          const crest = Math.min(3, filled)
          if (fx === x) ctx.fillRect(startX, fy > y ? startY + size - filled : startY + filled - crest, wetWidth, crest)
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
      round(panelLeft + 5, top - 6, panelWidth - 10, bottom - 14 - top, 11)
      ctx.clip()
      for (let i = 0; i < entries.length; i++) {
        if (!entries[i]) continue
        const row = Math.floor(i / cols)
        let x = left + i % cols * pitchX
        let y = top + row * pitch
        let pose
        if (phase.swap && (i === phase.swap[0] || i === phase.swap[1])) {
          const other = i === phase.swap[0] ? phase.swap[1] : phase.swap[0]
          x += (other % cols - i % cols) * pitchX * phase.swapPose.t
          y += (Math.floor(other / cols) - row) * pitch * phase.swapPose.t
          pose = phase.swapPose
        }
        if (phase.matchPose && phase.result.cleared.has(i)) pose = phase.matchPose
        tile(entries[i], x, y, i === selected, i === focus, pose)
        if (state.level.valves?.includes(i)) {
          oval(x + cellWidth - 6, y + 6, 6.5, 6, '#28655c')
          label('+2', x + cellWidth - 6, y + 6, 8, PANEL, 700, 'center')
        }
        if (toolTarget === 'D' && isTile(entries[i]) || toolTarget === 'C' && entries[i] && !isTile(entries[i])) {
          round(x + 2, y + 2, cellWidth - 4, cell - 4, 6)
          ctx.strokeStyle = '#fff0a0'
          ctx.lineWidth = 2
          ctx.stroke()
        }
      }
      if ((guided || hint) && !intro && !animation && !state.outcome) {
        for (const index of guided ? openingMove : hint) {
          const [x, y] = center(index)
          round(x - cellWidth / 2 + 2, y - cell / 2 + 2, cellWidth - 4, cell - 4, 9)
          ctx.strokeStyle = '#ffed9b'
          ctx.lineWidth = 3
          ctx.stroke()
        }
      }
      if (focus >= 0 && !ground[focus]) {
        const [x, y] = center(focus)
        round(x - cellWidth / 2 + 2, y - cell / 2 + 2, cellWidth - 4, cell - 4, 7)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.stroke()
      }
      if (phase.burst !== undefined) {
        if (!effects.lowDetail && phase.result.cleared.size <= 12) {
          for (const index of phase.result.cleared) clearBurst(index, phase.result.swapped[index], phase.burst)
        }
        effects.drawParticles(ctx, phase.burst)
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
      const water = state.gateWater ?? state.water
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
        const mouth = y + cell / 2
        const limit = closeAt?.[index % cols]
        const closed = limit !== undefined && water >= limit
        const warning = limit !== undefined && water === limit - 1
        const active = !closed && wet.get(index)?.amount === 1
        const fill = active ? '#95ddc2' : closed ? DRY_SLOT : warning ? '#f1ae8d' : '#f5cf79'
        const caption = closed ? '已关' : limit !== undefined ? `${limit} 关闸` : closeAt ? '常开' : '出口'
        box(x - 5, mouth - 3, 10, 7, 2, fill, INK)
        box(x - 22, mouth + 2, 44, 18, 5, fill, toolTarget === 'A' && closed ? '#fff0a0' : INK)
        label(caption, x, mouth + 11, 11, closed ? PANEL : INK, 700, 'center')
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
      const newlyWet = nextState.route.length > state.route.length
      state = nextState
      if (state.outcome === 'escaped') {
        const ms = Math.max(1, Math.round(playedMs))
        const water = state.rescueWater ?? 1
        const early = outlets(state.route, state.level, state.gateWater)
          .some(cell => state.level.closeAt?.[cell % state.level.cols] === 6 + (state.level.gateDelay ?? 0))
        stars = grade(water, early, false)
        record.saves++
        unlockedPet = SKINS.findIndex(pet => pet.after === record.saves)
        if (unlockedPet < 0) unlockedPet = undefined
        if (mode === 'chapters') record.chapterStars[roundNumber - 1] = Math.max(record.chapterStars[roundNumber - 1], stars)
        if (water === 11) awardMedal(0)
        if (mode === 'endless' && roundNumber >= 5 && !usedTool) awardMedal(2)
        if (mode === 'endless' && roundNumber >= 10) awardMedal(3)
        if (mode === 'chapters' && roundNumber === 8) awardMedal(4)
        if (mode === 'daily' && roundNumber === 3) awardMedal(5)
        if (mode === 'endless' && roundNumber) record.best = Math.max(record.best, roundNumber)
        if (roundNumber) record.fastest = record.fastest ? Math.min(record.fastest, ms) : ms
        if (mode === 'daily') {
          dailyElapsed += ms
          dailyResults.push({ stars, water })
          if (roundNumber === 3 && (record.daily?.date !== date || dailyElapsed < record.daily.ms)) {
            record.daily = { date, ms: dailyElapsed }
          }
        }
        save()
        sound.play('rescue')
        if (mode === 'endless' && roundNumber && roundNumber % 2 === 0) {
          const available = UPGRADES.filter(upgrade => upgrade.key === 'supply' ||
            (upgrade.key === 'reroll' ? rerolls < 2 : upgrades[upgrade.key] === undefined))
          choices = []
          while (choices.length < 3 && available.length) {
            choices.push(available.splice(Math.floor(random() * available.length), 1)[0])
          }
          if (!choices.length) choices = null
        }
        if (roundNumber && !choices && unlockedPet === undefined && !runComplete()) nextRoundAt = Date.now() + NEXT_ROUND_MS
        message = roundNumber ? `小狗脱险，已救援 ${roundNumber} 轮。` : '小狗已从逃生口脱险！'
      }
      else if (state.outcome === 'flooded' || state.outcome === 'blocked') {
        message = state.outcome === 'flooded' ? '水位到顶，小狗没能脱险。' : '棋盘上没有可消除的组合了。'
        if (mode === 'endless' && roundNumber > 1) {
          record.scores = [...record.scores, roundNumber - 1].sort((a, b) => b - a).slice(0, 5)
          save()
        }
      }
      else if (state.route.length) {
        const { cols, rows, closeAt } = state.level
        const reachedClosed = state.route.some(({ cell }) => cell >= cols * (rows - 1) && state.water >= closeAt?.[cell % cols])
        message = reachedClosed ? '水路接到了已关闭的出口，改走仍开放的出口。' : state.level.exits
          ? '水已流进棋盘，继续接通开放的排水口。' : '水已流进棋盘，继续接到底边。'
      }
      else message = '从棋盘上沿的水口开始接水路。'
      if (newlyWet && !state.outcome) sound.play('water')
      if (!state.outcome && dryMoves >= 2) {
        message = state.level.tools ? '水路暂未推进，试试靠近水头的消除或道具。' : '水路暂未推进，试试靠近水头的消除。'
      }
      const tally = roundNumber && (state.outcome === 'flooded' || state.outcome === 'blocked')
        ? ` 累计救援 ${roundNumber - 1} 轮。` : ''
      announce(`${message}${tally} 水位 ${state.water}。`)
    }

    function draw(now) {
      if (active && nextRoundAt !== null && now >= nextRoundAt) continueLevel()
      updateWater(now)
      if (!intro && !guided && !hint && !animation && clockSince !== null && mode !== 'daily' && elapsed(now) >= hintDue) {
        hint = suggest(state)
        hintDue = elapsed(now) + 8000
      }
      scheduleClock(now)
      ctx.setTransform(density, 0, 0, density, 0, 0)
      ctx.fillStyle = BACKGROUND
      ctx.fillRect(0, 0, width, height)
      ctx.translate(offsetX, offsetY)
      ctx.scale(scale, scale)
      if (intro) {
        drawHome()
        if (gallery || help || chapterSelect) drawPanel()
        return
      }

      let phase = {}
      let progress = state.water >= 8 && pausedAt === null && !state.outcome && !reducedMotion() ? (now % 840) / 840 : 0
      let rescue = 0
      let view = state
      let rising = false
      if (rise) {
        progress = ease(clamp((now - rise.from) / 260))
        rising = progress < 1
        if (rising) view = { ...state, water: interpolate(rise.water, state.water, progress) }
        else rise = null
      }
      if (animation && pausedAt === null) {
        const age = Math.max(0, now - animation.from)
        const { swap, lead, result, arrivals, flowSteps, channelMs, flowAt, flowDuration, rescueAt, end } = animation
        if (age >= end) {
          animation = null
          effects.clearEffects()
          if (result) {
            finish(result.state.outcome === 'escaped' ? result.state : { ...result.state, water: state.water })
            view = state
          }
          const swipe = queuedSwipe
          queuedSwipe = null
          if (swipe && !state.outcome) move(...swipe)
        } else if (age < lead || !result) {
          phase = { swap, swapPose: swapPose(age, Boolean(result)) }
        } else {
          const matchAge = age - lead
          const clearAge = matchAge - MATCH_MS
          const clearing = clearAge >= 0
          const tilesVisible = clearAge < CLEAR_MS
          phase.board = tilesVisible ? result.swapped : result.state.board
          phase.result = result
          if (tilesVisible) phase.matchPose = matchPose(matchAge)
          if (clearing) {
            if (tilesVisible) phase.burst = clearAge / CLEAR_MS
            if (result.longRuns.length && clearAge < LINE_MS) phase.longBurst = clearAge / LINE_MS
          }
          phase.arrivals = arrivals
          phase.waterFront = clamp((clearAge - CLEAR_MS / 2) / channelMs) * flowSteps
          if (flowDuration && age >= flowAt) {
            progress = ease(clamp((age - flowAt) / flowDuration))
            phase.pumping = progress < 1
            if (phase.pumping) phase.pumpProgress = progress
            view = { ...state, water: interpolate(state.water, result.state.water, progress) }
          }
          if (rescueAt !== undefined) rescue = ease(clamp((age - rescueAt) / 245))
        }
      }

      label('小狗别慌', 19, 36, 26, INK)
      label(mode === 'daily' ? `每日 ${roundNumber}/3` : mode === 'chapters' ? `章节 ${roundNumber}/8` :
        roundNumber ? `第 ${roundNumber} 轮` : '第 1 关', 134, 37, 13, INK)
      box(207, 22, 47, 30, 9, PANEL, PANEL_EDGE)
      label('暂停', 230.5, 37, 13, INK, 700, 'center')
      box(262, 22, 51, 30, 9, PANEL, PANEL_EDGE)
      label('重来', 287.5, 37, 13, INK, 700, 'center')
      box(321, 22, 51, 30, 9, PANEL, PANEL_EDGE)
      label(mode === 'daily' ? '固定盘' : roundNumber && mode === 'endless' ? `换盘 ${rerolls}` : '换盘',
        346.5, 37, 13, INK, 700, 'center')
      if (weather) label(weather === 'storm' ? '暴雨 · 加时阀增加' : '满潮 · 开局工具充能', 24, 61, 11, DANGER)
      ctx.save()
      ctx.translate(0, sceneY(0))
      ctx.scale(1, (sceneY(347) - 70) / 277)
      scene(view, progress, rising, rescue)
      ctx.restore()
      const route = board(phase)
      controls(now, outlets(route, state.level, state.gateWater).length > 0)
      if (state.level.tools) {
        for (const [i, type] of [...'ABCDE'].entries()) {
          const charge = state.charge?.[type] ?? 0
          const cost = state.level.toolCost ?? TOOL_COST
          const x = 14 + i * 73
          box(x, 751, 69, 26, 8, toolTarget === type || charge >= cost ? '#f5dfa8' : PANEL, PANEL_EDGE)
          if (charge > 0) box(x + 4, 772, 61 * Math.min(charge / cost, 1), 2, 1, COLORS[type][1])
          symbol(type, x + 14, 764, 0.56, COLORS[type][2])
          label(charge >= 2 * cost ? '×2' : `${charge}/${cost}`, x + 63, 763, 11, INK, 700, 'right')
        }
      }
      let status = message
      let statusColor = INK
      if (rescue) status = '小狗正在爬向逃生口。'
      else if (phase.pumping) status = '水正从棋盘底部排出。'
      else if (hint && !animation) status = '描边处有一步可试。'
      else if (!state.outcome && state.level.closeAt) {
        const warning = state.level.exits.findIndex(col => state.water === state.level.closeAt[col] - 1 &&
          state.gateWater < state.level.closeAt[col])
        if (warning >= 0) {
          status = `${OUTLET_SIDE[warning]}出口下次涨水就会关闭。`
          statusColor = DANGER
        }
      }
      label(status, WIDTH / 2, 789, 13, statusColor, 600, 'center')

      if (gallery || pausedAt !== null || choices) {
        drawPanel()
      } else if (state.outcome) {
        const won = state.outcome === 'escaped'
        box(layout.panelLeft, layout.top - 13, layout.panelWidth, 783 - layout.top, 18, '#24443e9c')
        box(55, 500, 280, 191, 18, PANEL, PANEL_EDGE)
        const heading = state.outcome === 'flooded' ? '小狗被淹没了' : '救援中止'
        label(won ? (runComplete() ? '挑战通关' : '救援成功') : heading, WIDTH / 2, 528, 24, INK, 700, 'center')
        if (won) label('★'.repeat(stars), WIDTH / 2, 553, 15, '#87601c', 700, 'center')
        if (roundNumber) label(`累计救援 ${roundNumber - Number(!won)} 轮`, WIDTH / 2, 576, 14, INK, 700, 'center')
        if (won && roundNumber && !runComplete() && unlockedPet === undefined) {
          label('正在进入下一轮…', WIDTH / 2, 607, 16, INK, 700, 'center')
        } else {
          box(122, 586, 146, 42, 10, '#edc67f')
          label(won && mode === 'daily' && runComplete() ? '复制每日战报' : won && roundNumber && !runComplete()
            ? '下一轮' : won ? '开始无限救援' : mode === 'chapters' ? '再试本关' : roundNumber ? '从第 1 轮开始' : '再试一次',
            WIDTH / 2, 607, 16, '#253938', 700, 'center')
        }
        if (unlockedPet !== undefined && runComplete()) {
          dialogButton(67, 638, 124, `换上${SKINS[unlockedPet].name}`)
          dialogButton(199, 638, 124, '返回首页')
        } else if (unlockedPet !== undefined) dialogButton(91, 638, 208, `换上新伙伴 · ${SKINS[unlockedPet].name}`)
        else if (runComplete() || !won) dialogButton(115, 638, 160, '返回首页')
      }
    }

    function reset() {
      pauseClock(Date.now())
      playedMs = 0
      clockSince = intro || !active ? null : Date.now()
      nextRoundAt = null
      rise = null
      state = { ...openings[levelIndex], charge: runCharge }
      layout = boardLayout(state.level)
      animation = null
      effects.clearEffects()
      queuedSwipe = null
      selected = -1
      focus = -1
      pressed = null
      bonusNotice = null
      toolTarget = null
      hint = null
      hintDue = 8000
      dryMoves = 0
      urgencySecond = undefined
      unlockedPet = undefined
      message = guided ? '交换描边的两块，接通第一段水路。' : levelIndex === 0
        ? '连成三个，把水绕到金色排水口。' : '每接通 6 格加 2 秒，常开口始终可用。'
      announce(mode === 'daily' ? `每日挑战第 ${roundNumber} 盘。${message}` : mode === 'chapters'
        ? `救援章节第 ${roundNumber} 关。${message}` : roundNumber ? `无限救援第 ${roundNumber} 轮。${message}` : message)
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
      if (result && guided) {
        guided = false
        message = '把水引到标出的排水口。'
      }
      const earnedMs = (result?.state.bonusMs ?? 0) - (state.bonusMs ?? 0)
      const combo = result?.longRuns.reduce((longest, run) => Math.max(longest, run.length), 0)
      if (result) {
        dryMoves = result.state.route.length > state.route.length ? 0 : dryMoves + 1
        hint = null
        hintDue = elapsed(now) + 8000
        const streak = combo || 3
        if (streak >= 5) awardMedal(1)
        if (streak > record.combo) {
          record.combo = streak
          save()
        }
      }
      sound.play(result ? combo >= 4 ? 'chain' : 'clear' : 'swap')
      const feedback = [
        combo && `${combo} 连消。`,
        earnedMs > 0 && `加时 ${earnedMs / 1000} 秒。`,
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
      animateResult(result, [a, b], now)
    }

    function animateResult(result, swap, now) {
      const lead = swap ? SWAP_MS : 0
      let end = SWAP_MS + RETURN_MS
      let flowAt = SWAP_MS
      let flowDuration = 0
      let rescueAt
      let arrivals
      let flowSteps = 0
      let channelMs = 90
      if (result) {
        prepareParticles(result)
        const alreadyWet = new Set(state.route.map(({ cell }) => cell))
        arrivals = new Map()
        for (const { cell, from } of result.state.route) {
          const step = alreadyWet.has(cell) ? -1 : (arrivals.get(from) ?? -1) + 1
          arrivals.set(cell, step)
          flowSteps = Math.max(flowSteps, step + 1)
        }
        channelMs = Math.min(310, Math.max(90, flowSteps * 23))
        end = lead + MATCH_MS + Math.max(CLEAR_MS, flowSteps ? CLEAR_MS / 2 + channelMs : 0,
          result.longRuns.length ? LINE_MS : 0)
        if (result.state.outcome === 'escaped') {
          flowAt = end
          flowDuration = 275
          rescueAt = flowAt + 175
          end = rescueAt + 245
        }
      }
      animation = { from: now, swap, lead, result, arrivals, flowSteps, channelMs, end, flowAt, flowDuration, rescueAt }
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
      const name = ({ [ROCK]: '礁石', [PLATE]: '铁板', [CRACKED]: '开裂铁板' })[state.board[index]] ||
        COLORS[state.board[index]]?.[3] || '水槽'
      announce(`第 ${Math.floor(index / cols) + 1} 行，第 ${index % cols + 1} 列，${name}`)
    }

    function point(x, y) {
      return { x: (x - offsetX) / scale, y: (y - offsetY) / scale }
    }

    function cellAt({ x, y }) {
      const { left, top, pitch, pitchX } = layout
      const { cols, rows } = state.level
      const col = Math.floor((x - left + 2) / pitchX)
      const row = Math.floor((y - top + 2) / pitch)
      return col >= 0 && col < cols && row >= 0 && row < rows ? row * cols + col : -1
    }

    function runComplete() {
      return mode === 'daily' && roundNumber === 3 || mode === 'chapters' && roundNumber === 8
    }

    function restartRun(first = 1) {
      roundNumber = first
      levelIndex = mode === 'chapters' && roundNumber <= 3 ? 0 : 1
      rerolls = 2
      upgrades = {}
      weather = undefined
      supply = 0
      usedTool = false
      runCharge = {}
      dailyElapsed = 0
      dailyResults = []
      choices = null
      restartConfirm = false
      pausedAt = null
      guided = false
      pickOpening()
      reset()
    }

    function continueLevel() {
      if (state.outcome !== 'escaped') {
        if (roundNumber && mode !== 'chapters') restartRun()
        else reset()
        return
      }
      if (runComplete() && mode === 'daily') {
        const marks = dailyResults.map(({ stars }) => '★'.repeat(stars) + '☆'.repeat(3 - stars)).join(' ')
        const levels = dailyResults.map(({ water }) => `${water >= 9 ? '🟥' : water >= 6 ? '🟨' : '🟩'}${water}`).join(' ')
        const report = `🐾 小狗别慌 · ${date}\n${marks}\n💧 ${levels} · ${(dailyElapsed / 1000).toFixed(1)} 秒`
        options.share?.(report)
        message = '每日战报已生成。'
        announce(report)
        schedule()
        return
      }
      if (runComplete()) {
        mode = 'endless'
        restartRun()
        return
      }
      runCharge = state.charge ?? {}
      if (mode === 'endless' && roundNumber > 0 && roundNumber % 3 === 0) rerolls = Math.min(2, rerolls + 1)
      roundNumber++
      levelIndex = mode === 'chapters' && roundNumber <= 3 ? 0 : 1
      weather = mode === 'endless' && roundNumber >= 4 && (roundNumber - 4) % 3 === 0
        ? (random() < 0.5 ? 'storm' : 'tide') : undefined
      if (weather === 'tide') {
        const cap = 2 * (upgrades.toolCost ?? TOOL_COST)
        runCharge = Object.fromEntries([...'ABCDE'].map(type => [type, Math.min(cap, (runCharge[type] ?? 0) + 3)]))
      }
      pickOpening()
      supply = 0
      reset()
    }

    function dialogButton(x, y, width, title) {
      box(x, y, width, 34, 9, '#edc67f', PANEL_EDGE)
      label(title, x + width / 2, y + 17, 13, INK, 700, 'center')
    }

    function drawHome() {
      label('小狗别慌', 195, 90, 42, INK, 700, 'center')
      ctx.save()
      ctx.translate(0, 83)
      scene({ ...state, water: 1, outcome: null }, 0, false, 0)
      ctx.restore()
      const { x, y, width, height } = START_BUTTON
      box(x, y, width, height, 12, '#edc67f', INK)
      label('开始救援', 195, y + height / 2, 17, INK, 700, 'center')
      dialogButton(36, 530, 150, '怎么玩')
      dialogButton(204, 530, 150, '战绩图鉴')
      dialogButton(36, 580, 150, '救援章节')
      dialogButton(204, 580, 150, '每日挑战')
      label(`已通 ${chapterCount()}/8 · ${record.chapterStars.reduce((a, b) => a + b, 0)} 星`, 111, 627, 11, INK, 600, 'center')
      const today = record.daily?.date === dailyDate()
      label(today ? `已通关 · ${(record.daily.ms / 1000).toFixed(1)} 秒` : '今日未通关', 279, 627, 11, INK, 600, 'center')
      label(`最高救援 ${record.best} 轮`, 195, 661, 13, INK, 700, 'center')
    }

    function drawPanel() {
      box(-offsetX / scale, 0, width / scale, HEIGHT, 0, '#31534b')
      box(27, 240, 336, 321, 20, PANEL, PANEL_EDGE)
      if (chapterSelect) {
        label('救援章节', 195, 279, 23, INK, 700, 'center')
        for (let i = 0; i < 8; i++) {
          const x = 51 + i % 2 * 150
          const y = 306 + Math.floor(i / 2) * 47
          const unlocked = i <= chapterCount()
          box(x, y, 139, 36, 8, unlocked ? '#f1d690' : '#e2e6de', PANEL_EDGE)
          label(`第 ${i + 1} 关 · ${unlocked ? '★'.repeat(record.chapterStars[i]) || '未通关' : '未解锁'}`,
            x + 69.5, y + 18, 12, INK, 700, 'center')
        }
        dialogButton(126, 507, 138, '返回')
      } else if (restartConfirm) {
        label('从第 1 轮重新开始？', 195, 303, 21, INK, 700, 'center')
        label('本局轮数、道具和改造会清空。', 195, 350, 14, INK, 600, 'center')
        dialogButton(50, 401, 137, '继续本局')
        dialogButton(203, 401, 137, '确认重开')
      } else if (help) {
        label(toolHelp ? '工具怎么用' : '怎么玩', 195, 279, 23, INK, 700, 'center')
        const lines = toolHelp ? ['每消 9 个同色方块，充能一次。', '扳手重开闸口，水滴降低一格水位。',
          '螺母拆开障碍，闪电击碎一个方块。', '救生圈推迟涨水 5 秒。', '亮起的工具可用，×2 表示可用两次。'] :
          ['交换相邻方块，凑出横向或纵向三连。', '消开的格子会留下水路。',
            '在水涨满前，接通底部开放的闸口。', '四连加 2 秒，五连及以上加 4 秒。',
            '铁板需相邻消两次，水流过 +2 阀可加时。']
        lines.forEach((text, i) => label(text, 45, 325 + i * 36, 13, INK))
        dialogButton(49, 507, 124, '返回')
        dialogButton(217, 507, 124, toolHelp ? '基本玩法' : '工具说明')
      } else if (gallery) {
        label('战绩与小狗图鉴', 195, 271, 21, INK, 700, 'center')
        label(`最高 ${record.best} 轮  ·  累计救援 ${record.saves} 只`, 195, 303, 13, INK, 700, 'center')
        label(`最快 ${record.fastest ? (record.fastest / 1000).toFixed(1) + ' 秒' : '—'}  ·  最长 ${record.combo} 连消`,
          195, 329, 13, INK, 700, 'center')
        const image = galleryImages[galleryPage]
        for (const [i, entry] of SKINS.slice(galleryPage * 4, galleryPage * 4 + 4).entries()) {
          const x = 43 + i * 77
          const unlocked = record.saves >= entry.after
          box(x, 353, 70, 112, 8, galleryPage * 4 + i === skin ? '#ebd39f' : '#e7eee0', PANEL_EDGE)
          if (image) {
            const w = image.width / 2
            const h = image.height / 2
            ctx.save()
            if (!unlocked) ctx.globalAlpha = 0.38
            ctx.drawImage(image, i % 2 * w, Math.floor(i / 2) * h, w, h, x + 5, 358, 60, 60)
            ctx.restore()
          } else {
            oval(x + 35, 385, 20, 20, entry.fur?.[0] ?? '#edb361')
            label('汪', x + 35, 385, 14, INK, 700, 'center')
          }
          label(entry.name, x + 35, 433, 12, INK, 700, 'center')
          if (!unlocked) label(`${entry.after} 只解锁`, x + 35, 451, 10, INK, 700, 'center')
        }
        const summary = record.scores.length ? `本机榜单 · ${record.scores.join(' / ')} 轮` : '本机榜单 · 完成一局后记录'
        label(`${summary} · 勋章 ${record.medals.length}/6`, 195, 485, 11, INK, 600, 'center')
        dialogButton(42, 507, 89, '返回')
        dialogButton(245, 507, 100, galleryPage === 0 ? '下一页' : '上一页')
      } else if (choices) {
        label('选择一项救援改造', 195, 279, 21, INK, 700, 'center')
        choices.forEach(({ title, detail }, i) => {
          const y = 310 + i * 69
          box(51, y, 288, 57, 9, '#f9e8bf', PANEL_EDGE)
          label(title, 195, y + 18, 15, INK, 700, 'center')
          label(detail, 195, y + 40, 12, INK, 600, 'center')
        })
        if (unlockedPet !== undefined) dialogButton(90, 522, 210, `换上新伙伴 · ${SKINS[unlockedPet].name}`)
      } else {
        label('已暂停', 195, 303, 24, INK, 700, 'center')
        dialogButton(108, 374, 174, '继续救援')
        dialogButton(108, 425, 174, '战绩图鉴')
        dialogButton(108, 476, 174, '返回首页')
        dialogButton(108, 519, 174, record.muted ? '开启音效' : '静音')
      }
    }

    function returnHome() {
      intro = true
      mode = 'endless'
      roundNumber = 0
      levelIndex = 0
      upgrades = {}
      choices = null
      weather = undefined
      supply = 0
      chapterSelect = false
      pausedAt = null
      runCharge = {}
      rerolls = 2
      guided = true
      pickOpening()
      reset()
    }

    function openGallery() {
      gallery = true
      showGalleryPage(Math.floor(skin / 4))
    }

    function chapterCount() {
      return record.chapterStars.filter(Boolean).length
    }

    function awardMedal(index) {
      if (record.medals.includes(index)) return
      record.medals.push(index)
      save()
    }

    function equipNewPet() {
      if (unlockedPet === undefined) return
      skin = unlockedPet
      record.skin = skin
      unlockedPet = undefined
      save()
      if (!choices && !runComplete() && roundNumber) continueLevel()
      else schedule()
    }

    function askRestart() {
      if (state.outcome || pausedAt !== null) return
      togglePause()
      if (pausedAt !== null) restartConfirm = true
    }

    function cancelRestart() {
      restartConfirm = false
      togglePause()
    }

    function showGalleryPage(page) {
      galleryPage = page
      if (!galleryImages[page] && !galleryLoading.has(page) && options.loadGallery) {
        galleryLoading.add(page)
        options.loadGallery(page, image => {
          galleryLoading.delete(page)
          galleryImages[page] = image
          schedule()
        }, () => galleryLoading.delete(page))
      }
      schedule()
    }

    function togglePause() {
      if (state.outcome || choices) return
      const now = Date.now()
      if (pausedAt === null) {
        updateWater(now)
        if (state.outcome) return
        pauseClock(now)
        pausedAt = now
        queuedSwipe = null
        pressed = null
      } else {
        if (animation) animation.from += now - pausedAt
        if (active && !animation?.result?.state.outcome) clockSince = now
        pausedAt = null
      }
      schedule()
    }

    function selectUpgrade(index) {
      const upgrade = choices?.[index]
      if (!upgrade) return
      if (upgrade.key === 'supply') supply = upgrade.value
      else if (upgrade.key === 'reroll') rerolls = Math.min(2, rerolls + 1)
      else upgrades = { ...upgrades, [upgrade.key]: upgrade.value }
      choices = null
      continueLevel()
    }

    function activateTool(type, target) {
      if (animation || state.outcome || !state.level.tools) return
      const now = Date.now()
      updateWater(now)
      const result = useTool(state, type, target)
      if (!result) {
        message = type === 'B' ? '水位已经最低，留着下次使用。' : '这里不能使用该道具，请选择高亮目标。'
        announce(message)
        schedule()
        return
      }
      usedTool = true
      const extra = result.state.bonusMs - (state.bonusMs ?? 0)
      toolTarget = null
      hint = null
      hintDue = elapsed(now) + 8000
      if (extra > 0) {
        bonusNotice = { seconds: extra / 1000, until: now + 1200 }
        clearTimeout(clockTimer)
        clockTimer = undefined
      }
      if (result.state.outcome) pauseClock(now)
      else state = { ...state, bonusMs: result.state.bonusMs, water: result.state.water }
      sound.play('chain')
      if (reducedMotion()) { finish(result.state); schedule() }
      else animateResult(result, null, now)
    }

    function selectTool(type) {
      if (animation) return
      if ((state.charge?.[type] ?? 0) < (state.level.toolCost ?? TOOL_COST)) {
        message = { A: '扳手：重新开启一个关闭的闸口。', B: '水滴：降低一格水位，已关闸口保持关闭。',
          C: '螺母：拆除礁石或铁板。', D: '闪电：击碎一个方块。', E: '救生圈：推迟涨水五秒。' }[type]
        announce(message)
        schedule()
        return
      }
      if (type === 'B' || type === 'E') return activateTool(type)
      toolTarget = toolTarget === type ? null : type
      message = { A: '选择一个已关闭的闸口。', C: '选择一块礁石或铁板。', D: '选择一个要击碎的方块。' }[type]
      announce(message)
      schedule()
    }

    function down(x, y) {
      pressed = point(x, y)
    }

    function startRescue(nextMode = 'endless', chapter = 1) {
      sound.unlock()
      intro = false
      chapterSelect = false
      mode = nextMode
      if (mode !== 'endless') {
        date = dailyDate()
        restartRun(chapter)
        return
      }
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
      const tap = Math.hypot(dx, dy) < 14
      if (tap) sound.unlock()
      if (chapterSelect || help || gallery || choices || pausedAt !== null) {
        if (!tap) return
        const { x, y } = target
        if (chapterSelect) {
          if (x >= 126 && x <= 264 && y >= 507 && y <= 541) { chapterSelect = false; schedule() }
          else if (x >= 51 && x <= 340 && y >= 306 && y <= 483 && (y - 306) % 47 <= 36) {
            const index = Math.floor((y - 306) / 47) * 2 + Number(x >= 201)
            if (index < 8 && index <= chapterCount()) startRescue('chapters', index + 1)
          }
        } else if (restartConfirm) {
          if (y >= 401 && y <= 435) {
            if (x >= 50 && x <= 187) cancelRestart()
            if (x >= 203 && x <= 340) restartRun()
          }
        } else if (help) {
          if (y >= 507 && y <= 541) {
            if (x >= 49 && x <= 173) { help = false; toolHelp = false; schedule() }
            if (x >= 217 && x <= 341) { toolHelp = !toolHelp; schedule() }
          }
        } else if (gallery) {
          if (y >= 507 && y <= 541) {
            if (x >= 42 && x <= 131) gallery = false
            if (x >= 245 && x <= 345) showGalleryPage(1 - galleryPage)
          }
          const card = Math.floor((x - 43) / 77)
          const i = galleryPage * 4 + card
          if (y >= 353 && y <= 465 && card >= 0 && card < 4 && record.saves >= SKINS[i].after) {
            skin = i
            record.skin = i
            save()
          }
          schedule()
        } else if (choices) {
          if (x >= 51 && x <= 339 && y >= 310 && (y - 310) % 69 <= 57) {
            selectUpgrade(Math.floor((y - 310) / 69))
          }
          if (x >= 90 && x <= 300 && y >= 522 && y <= 556) equipNewPet()
        } else if (x >= 108 && x <= 282) {
          if (y >= 374 && y <= 408) togglePause()
          if (y >= 425 && y <= 459) openGallery()
          if (y >= 476 && y <= 510) returnHome()
          if (y >= 519 && y <= 553) {
            record.muted = !record.muted
            save()
            sound.unlock()
            schedule()
          }
        }
        return
      }
      if (intro) {
        const { x, y, width, height } = START_BUTTON
        if (tap && target.x >= x && target.x <= x + width &&
          target.y >= y && target.y <= y + height) startRescue()
        if (tap && target.y >= 530 && target.y <= 564) {
          if (target.x >= 36 && target.x <= 186) { help = true; schedule() }
          if (target.x >= 204 && target.x <= 354) openGallery()
        }
        if (tap && target.y >= 580 && target.y <= 614) {
          if (target.x >= 36 && target.x <= 186) { chapterSelect = true; schedule() }
          if (target.x >= 204 && target.x <= 354) startRescue('daily')
        }
        return
      }
      if (tap) {
        if (origin.x >= 207 && origin.x <= 254 && origin.y >= 22 && origin.y <= 52) return togglePause()
        const resetButton = origin.x >= 262 && origin.x <= 313 && origin.y >= 22 && origin.y <= 52
        const shuffleButton = origin.x >= 321 && origin.x <= 372 && origin.y >= 22 && origin.y <= 52
        const replayButton = state.outcome && origin.x >= 122 && origin.x <= 268 && origin.y >= 586 && origin.y <= 628
        if (state.outcome) {
          if (replayButton) continueLevel()
          if (origin.y >= 638 && origin.y <= 672) {
            if (runComplete() && unlockedPet !== undefined) {
              if (origin.x >= 67 && origin.x <= 191) equipNewPet()
              if (origin.x >= 199 && origin.x <= 323) returnHome()
            } else if (origin.x >= 91 && origin.x <= 299) {
              if (unlockedPet !== undefined) equipNewPet()
              else if (runComplete() || state.outcome !== 'escaped') returnHome()
            }
          }
          return
        }
        if (shuffleButton) {
          if (mode === 'daily' || (roundNumber && mode === 'endless' && !rerolls) || animation) return
          if (roundNumber && mode === 'endless') rerolls--
          runCharge = state.charge ?? {}
          pickOpening()
          return reset()
        }
        if (resetButton) {
          if (roundNumber && mode !== 'chapters') return askRestart()
          return reset()
        }
        if (replayButton) return continueLevel()
        if (state.level.tools && origin.y >= 751 && origin.y <= 777) {
          const type = 'ABCDE'[Math.floor((origin.x - 14) / 73)]
          if (type) selectTool(type)
          return
        }
        if (toolTarget === 'A') {
          let hit
          for (const col of state.level.exits) {
            const [x, y] = center((state.level.rows - 1) * state.level.cols + col)
            if (Math.abs(target.x - x) <= 23 && Math.abs(target.y - y) <= 38) {
              hit = col
              break
            }
          }
          activateTool('A', hit)
          return
        }
        if (toolTarget) {
          activateTool(toolTarget, cellAt(target))
          return
        }
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
      sound.unlock()
      if (restartConfirm) {
        if (value === 'Enter') { restartRun(); return true }
        if (value === 'Escape') { cancelRestart(); return true }
        return false
      }
      if (chapterSelect) {
        if (value === 'Escape') { chapterSelect = false; schedule(); return true }
        if (/^[1-8]$/.test(value) && Number(value) <= chapterCount() + 1) {
          startRescue('chapters', Number(value))
          return true
        }
        return false
      }
      if (gallery || help) {
        if (gallery && (value === 'ArrowLeft' || value === 'ArrowRight')) { showGalleryPage(1 - galleryPage); return true }
        if (value === 'Escape' || value === 'Enter') { gallery = false; help = false; schedule(); return true }
        return false
      }
      if (choices) {
        if (/^[1-3]$/.test(value)) { selectUpgrade(Number(value) - 1); return true }
        return false
      }
      if (!intro && (value.toLowerCase() === 'p' || (pausedAt !== null && value === 'Escape'))) {
        togglePause()
        return true
      }
      if (pausedAt !== null) return false
      if (intro) {
        if (value.toLowerCase() === 'd') { startRescue('daily'); return true }
        if (value.toLowerCase() === 'c') { chapterSelect = true; schedule(); return true }
        if (value.toLowerCase() === 'g') { openGallery(); return true }
        if (value !== 'Enter' && value !== ' ') return false
        startRescue()
        return true
      }
      if (nextRoundAt !== null) return value === 'Enter' || value.toLowerCase() === 'r'
      if (value === 'Enter' && state.outcome) {
        continueLevel()
        return true
      }
      if (value === 'Escape' && state.outcome) { returnHome(); return true }
      if (value.toLowerCase() === 'r') {
        if (roundNumber && mode !== 'chapters' && !state.outcome) askRestart()
        else if (!state.outcome || !roundNumber) reset()
        return true
      }
      if (state.level.tools && /^[1-5]$/.test(value)) { selectTool('ABCDE'[Number(value) - 1]); return true }
      const { cols } = state.level
      const arrows = { ArrowUp: -cols, ArrowDown: cols, ArrowLeft: -1, ArrowRight: 1 }
      if (!Object.hasOwn(arrows, value) && value !== 'Enter' && value !== ' ') return false
      if (animation || state.outcome) return true
      if (focus < 0) focus = 0
      else if (adjacent(focus, focus + arrows[value], state.level)) focus += arrows[value]
      if (value === 'Enter' || value === ' ') {
        if (toolTarget === 'A') activateTool('A', focus % cols)
        else if (toolTarget) activateTool(toolTarget, focus)
        else choose(focus)
      }
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
