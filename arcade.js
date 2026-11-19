(function () {
  const match = typeof module === 'object' ? require('./match3.js') : globalThis.ArcadeMatch
  const depth = typeof module === 'object' ? require('./descent.js') : globalThis.ArcadeDescent
  const fx = typeof module === 'object' ? require('./effects.js') : globalThis.RescueEffects
  const { COLS, ROWS, row, col, adjacent } = match
  const WIDTH = 390
  const HEIGHT = 806
  const PITCH = 44
  const CELL = 39
  const LEFT = 19
  const TOP = 224
  const PALETTE = [
    ['#ffb5ba', '#da547b', '#7e3454'], ['#a0e7f7', '#43a9d8', '#275d90'],
    ['#ffe696', '#edaa48', '#915726'], ['#c3bbff', '#8b6ce0', '#533c9c'],
    ['#c5efa8', '#6abd90', '#356a67'],
  ]
  const TERRAINS = { soil: '#ab744d', dense: '#81543d', rock: '#8b91aa', ice: '#68bed0',
    chain: '#c9a88b', crystal: '#cf89ec', cache: '#f7c672' }
  const THEMES = { treasure: '宝藏层', blast: '爆破层', rock: '坚岩层', crystal: '水晶层', reward: '奖励层',
    supply: '补给层', elite: '精英层' }
  const clamp = value => Math.max(0, Math.min(1, value))
  const ease = value => 1 - (1 - value) ** 3
  const mix = (from, to, t) => from + (to - from) * t

  function mount(canvas, options, digging, leave) {
    const ctx = canvas.getContext('2d')
    const effects = fx.createEffects(options.lowDetail)
    const reduced = options.reducedMotion || (() => false)
    const sound = options.sound
    const sprites = new Map()
    const storageKey = digging ? 'dog-descent-v1' : 'dog-classic-v1'
    let record = {}
    try { record = options.storage?.read(storageKey) || {} } catch {}
    for (const key of ['score', 'combo', 'floor', 'broken', 'treats']) {
      if (!Number.isSafeInteger(record[key]) || record[key] < 0) record[key] = 0
    }
    record.runs = Array.isArray(record.runs) ? record.runs.filter(n => Number.isSafeInteger(n) && n > 0).slice(0, 5) : []
    let seed, random, board, ground, theme, floor, meters, steps, score, combo
    let pendingBroken = 0
    let goal = 0
    let goalCount = 0
    let energy = 0
    let feverUntil = 0
    let credited = 0
    let queuedMove
    let confirmation
    let hint
    let hintTimer
    let hintAt = 0
    let partner
    let feverTimer
    let completedFloors = 0
    let phase, selected, focus, press, paused, reward, lost, pending, suspendedAt
    let message = ''
    let active = true
    let width, height, scale, density, xOffset, yOffset

    function save() {
      try { options.storage?.write(storageKey, record) } catch {}
    }

    function archive() {
      if (!score) return
      record.runs = [...record.runs, digging ? floor : score].sort((a, b) => b - a).slice(0, 5)
      save()
    }

    function saveStable(milestone = false) {
      record.score = Math.max(record.score, score)
      record.combo = Math.max(record.combo, combo)
      const earned = digging ? Math.floor((floor - 1) / 5) : Math.floor(score / 5000)
      record.treats += Math.max(0, earned - credited)
      credited = Math.max(earned, credited)
      const checkpoint = { seed, rng: random.state(), score, board, credited }
      if (digging) {
        record.broken += pendingBroken
        pendingBroken = 0
        record.checkpoint = lost ? null : { ...checkpoint, floor, steps, ground, reward }
        if (milestone && (!record.milestone || record.milestone.floor <= floor)) record.milestone = record.checkpoint
        if (lost && record.milestone) record.milestone.credited = Math.max(record.milestone.credited ?? 0, credited)
      } else record.checkpoint = { ...checkpoint, goal, goalCount, energy, feverMs: Math.max(0, feverUntil - Date.now()) }
      save()
      options.noteArcade?.(digging ? [0, completedFloors, 0] : [0, 0, score])
      completedFloors = 0
    }

    function loadFloor() {
      const next = depth.layer(seed, floor)
      ;({ board, ground, theme, depth: meters, random } = next)
      record.floor = Math.max(record.floor, floor)
    }

    function reset(resume = false) {
      seed = Math.floor((options.random ?? Math.random)() * 4294967296)
      random = match.seeded(seed)
      floor = 1
      steps = depth.STEPS.initial
      score = 0
      combo = 0
      goal = goalCount = energy = feverUntil = pendingBroken = credited = 0
      completedFloors = 0
      clearHint()
      paused = reward = lost = false
      confirmation = queuedMove = null
      phase = selected = focus = press = null
      effects.clearEffects()
      if (digging && resume && depth.validCheckpoint(record.checkpoint)) {
        const saved = record.checkpoint
        ;({ seed, floor, score, steps, board, ground, reward } = saved)
        credited = saved.credited ?? Math.floor((floor - 1) / 5)
        random = match.seeded(saved.rng)
        const info = depth.layer(seed, floor)
        theme = info.theme
        meters = info.depth
      } else if (digging) loadFloor()
      else if (resume && classicCheckpoint(record.checkpoint)) {
        const saved = record.checkpoint
        ;({ seed, score, board } = saved)
        random = match.seeded(saved.rng)
        goal = saved.goal
        goalCount = saved.goalCount
        credited = saved.credited ?? Math.floor(score / 5000)
        energy = saved.energy
        feverUntil = saved.feverMs ? Date.now() + saved.feverMs : 0
      } else board = match.deal(random)
      saveStable()
      message = digging ? '消除核心地块附近的宝石，继续下潜。' : '交换宝石，连成三个同色。'
      schedule()
      armHint()
    }

    function classicCheckpoint(saved) {
      return depth.validBoard(saved?.board) && match.legalMove(saved.board) &&
        [saved.seed, saved.rng, saved.score, saved.goal, saved.goalCount, saved.energy, saved.feverMs]
          .every(value => Number.isSafeInteger(value) && value >= 0) && saved.goal < PALETTE.length && saved.feverMs <= 15000
    }

    const locked = i => digging && ground[i]?.kind === 'ice'
    const lockCheck = digging ? locked : undefined
    const inFever = () => feverUntil > Date.now()

    function clearHint() {
      clearTimeout(hintTimer)
      hintTimer = null
      hint = null
    }

    function armHint() {
      clearHint()
      if (phase || paused || !active || reward || lost || confirmation) return
      hintTimer = setTimeout(() => {
        hintTimer = null
        hint = match.legalMove(board, lockCheck)
        hintAt = Date.now()
        if (hint) schedule()
      }, 8000)
    }

    function center(i) {
      return [LEFT + col(i) * PITCH + CELL / 2, TOP + row(i) * PITCH + CELL / 2]
    }

    function begin(type, duration, data = {}) {
      phase = { type, duration: reduced() ? 0 : duration, from: Date.now(), ...data }
    }

    function settle() {
      if (digging && !ground.some(value => value?.core)) {
        const last = { board, ground }
        const oldFloor = floor++
        completedFloors++
        steps = depth.stepsAfterLayer(steps, oldFloor)
        loadFloor()
        if (floor % 5 === 0 || theme === 'reward' || theme === 'supply') reward = true
        message = theme ? THEMES[theme] : `已抵达地下第 ${floor} 层`
        saveStable(oldFloor % 5 === 0)
        begin('dive', 370, { last })
      } else if (digging && steps === 0) {
        lost = true
        saveStable()
        archive()
      } else if (!match.legalMove(board, lockCheck)) {
        const next = match.shuffle(board, random, lockCheck)
        board = next.board
        message = next.preserved ? '已重新排列宝石' : '已补充新宝石'
        saveStable()
        begin('shuffle', 240)
      } else {
        message = combo > 1 ? `${combo} 连锁` : ''
        saveStable()
      }
      if (message) options.announce?.(message)
    }

    function wave(plan) {
      const result = match.clearWave(board, plan?.matches, plan?.preferred, plan?.pair)
      if (!result.cleared.size) { settle(); return }
      combo++
      const groundResult = digging ? depth.damage(ground, result.cleared, result.impacted) : null
      const intensity = result.blasts.length ? 5 : combo
      if (!reduced()) effects.prepareMatch(result.cleared, center, i => PALETTE[board[i].color][0], CELL, intensity)
      sound?.play(combo > 1 || result.blasts.length ? 'chain' : 'clear', Math.min(combo, 8))
      begin('clear', 205, { result, groundResult })
    }

    function advance() {
      const finished = phase
      phase = null
      if (finished.type === 'swap') {
        if (finished.plan) {
          board = finished.plan.swapped
          if (digging) steps--
          wave(finished.plan)
        }
      } else if (finished.type === 'clear') {
        const { result, groundResult } = finished
        const multiplier = inFever() ? 2 : 1
        const points = multiplier * (result.cleared.size * 10 * Math.min(combo, 12) + result.blasts.length * 35 + Number(result.combined) * 150)
        score += points
        if (!digging) {
          for (const i of result.cleared) if (board[i].color === goal) goalCount++
          energy += result.cleared.size * (combo > 1 ? 2 : 1)
          if (goalCount >= 20 || energy >= 80) {
            feverUntil = Date.now() + 15000
            energy = 0
            goalCount = 0
            goal = (goal + 1) % PALETTE.length
          }
        }
        if (groundResult) {
          ground = groundResult.ground
          steps = Math.min(depth.STEPS.capacity, steps + groundResult.reward)
          pendingBroken += groundResult.broken.size
          score += groundResult.broken.size * 25
        }
        const next = match.refill(result.board, random)
        if (!digging && inFever() && random() < 0.38) {
          const fresh = next.falls.find(fall => fall.fromRow < 0)
          if (fresh) next.board[fresh.target] = match.tile(next.board[fresh.target].color, random() < 0.5 ? 'row' : 'column')
        }
        board = next.board
        effects.clearEffects()
        const byTile = new Map(next.falls.map(fall => [fall.target, fall]))
        begin('fall', Math.max(160, ...next.falls.map(fall => fallTime(fall) + col(fall.target) * 3)),
          { byTile, points, extraSteps: groundResult?.reward })
      } else if (finished.type === 'fall') {
        const lines = match.lines(board)
        if (lines.length && combo < match.MAX_CHAIN) wave({ matches: lines })
        else {
          if (lines.length) {
            board = match.shuffle(board, random, lockCheck).board
            effects.clearEffects()
          }
          settle()
        }
      }
    }

    function fallTime(fall) {
      return Math.min(299, 145 + fall.distance * 18)
    }

    function move(a, b) {
      if (phase || paused || reward || lost || !adjacent(a, b)) return
      clearHint()
      if (locked(a) || locked(b)) {
        message = '冰层冻结了宝石，可从旁边消除破冰。'
        armHint()
        schedule()
        return
      }
      selected = null
      combo = 0
      const plan = match.exchange(board, a, b, lockCheck)
      sound?.play('swap')
      begin('swap', fx.SWAP_MS + (plan ? 0 : fx.RETURN_MS), { a, b, plan })
      schedule()
    }

    function schedule() {
      if (!active || pending) return
      pending = true
      options.requestFrame(() => {
        pending = false
        if (!active) return
        const now = Date.now()
        if (!paused) {
          for (let transitions = 0; phase && now - phase.from >= phase.duration && transitions < 8; transitions++) advance()
          if (!phase && queuedMove) {
            const moveToTry = queuedMove
            queuedMove = null
            if (!reward && !lost) {
              if (moveToTry.length === 1) choose(moveToTry[0])
              else if (match.exchange(board, ...moveToTry, lockCheck)) move(...moveToTry)
            }
          }
          if (!phase && !hint && !hintTimer) armHint()
        }
        const start = globalThis.performance?.now()
        render(now)
        if (!digging && !paused && inFever() && !feverTimer) {
          feverTimer = setTimeout(() => { feverTimer = null; schedule() }, 1000)
        }
        if (start !== undefined && phase) effects.observeFrame(performance.now() - start)
        if (!paused && !reduced() && (phase || hint && now - hintAt < 1200)) schedule()
        else if (phase && !paused) schedule()
      })
    }

    function resize(w, h, ratio) {
      const nextDensity = Math.min(ratio, options.lowDetail ? 1.5 : 2)
      if (width === w && height === h && density === nextDensity) return
      width = w
      height = h
      density = nextDensity
      canvas.width = Math.round(w * density)
      canvas.height = Math.round(h * density)
      const top = options.safeTop ?? 0
      const usable = Math.max(1, h - top - (options.safeBottom ?? 0))
      scale = Math.min(w / WIDTH, usable / HEIGHT, 1.25) || 1
      xOffset = (w - WIDTH * scale) / 2
      yOffset = top + (usable - HEIGHT * scale) / 2
      sprites.clear()
      schedule()
    }

    function box(c, x, y, w, h, radius, fill, stroke) {
      const r = Math.min(radius, w / 2, h / 2)
      c.beginPath()
      c.moveTo(x + r, y)
      c.arcTo(x + w, y, x + w, y + h, r)
      c.arcTo(x + w, y + h, x, y + h, r)
      c.arcTo(x, y + h, x, y, r)
      c.arcTo(x, y, x + w, y, r)
      c.closePath()
      c.fillStyle = fill
      c.fill()
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = 1; c.stroke() }
    }

    function label(text, x, y, size, color = '#f6f6ff', align = 'left') {
      ctx.font = `700 ${size}px system-ui, sans-serif`
      ctx.textBaseline = 'middle'
      ctx.textAlign = align
      ctx.fillStyle = color
      ctx.fillText(text, x, y)
    }

    function gemFace(c, value, x, y) {
      const [light, color, edge] = PALETTE[value.color]
      const ramp = c.createLinearGradient(x, y, x, y + CELL)
      ramp.addColorStop(0, light)
      ramp.addColorStop(0.75, color)
      ramp.addColorStop(1, edge)
      box(c, x, y + 2, CELL, CELL - 1, 9, '#151b34')
      box(c, x + 1, y, CELL - 2, CELL - 3, 9, ramp, light)
      box(c, x + 7, y + 4, 18, 4, 2, '#ffffff9e')
      const cx = x + CELL / 2
      const cy = y + CELL / 2 - 1
      c.fillStyle = '#ffffffb8'
      c.strokeStyle = '#ffffffdf'
      c.lineWidth = 2.6
      c.beginPath()
      if (value.kind === 'row' || value.kind === 'column') {
        for (const offset of [-3, 3]) {
          if (value.kind === 'row') { c.moveTo(cx - 10, cy + offset); c.lineTo(cx + 10, cy + offset) }
          else { c.moveTo(cx + offset, cy - 10); c.lineTo(cx + offset, cy + 10) }
        }
        c.stroke()
      } else if (value.kind === 'bomb') {
        c.arc(cx, cy, 9, 0, 2 * Math.PI)
        c.stroke()
        c.beginPath()
        c.arc(cx, cy, 3, 0, 2 * Math.PI)
        c.fill()
      } else if (value.kind === 'rainbow') {
        PALETTE.forEach(([paint], i) => {
          c.beginPath()
          c.arc(cx, cy, 9, i * 1.257, (i + 1) * 1.257 + 0.09)
          c.lineWidth = 5
          c.strokeStyle = paint
          c.stroke()
        })
      } else {
        const sides = [4, 20, 3, 5, 6][value.color]
        for (let i = 0; i < sides; i++) {
          const angle = i * Math.PI * 2 / sides - Math.PI / 2
          c.lineTo(cx + Math.cos(angle) * 10, cy + Math.sin(angle) * 10)
        }
        c.closePath()
        c.fill()
      }
    }

    function gem(value, x, y) {
      const key = value.color + value.kind
      if (!sprites.has(key) && options.createTileSurface) {
        const surface = options.createTileSurface(Math.ceil(CELL * density), Math.ceil(CELL * density))
        const target = surface?.getContext('2d')
        if (target) { target.scale(surface.width / CELL, surface.height / CELL); gemFace(target, value, 0, 0) }
        sprites.set(key, target ? surface : null)
      }
      const sprite = sprites.get(key)
      if (sprite) ctx.drawImage(sprite, x, y, CELL, CELL)
      else gemFace(ctx, value, x, y)
    }

    function terrain(value, x, y, hit) {
      const tint = TERRAINS[value.kind]
      box(ctx, x - 2, y - 2, CELL + 4, CELL + 4, 8, tint, value.core ? '#fff3ab' : '#3e2a42')
      if (hit) box(ctx, x - 2, y - 2, CELL + 4, CELL + 4, 8, '#fff0b766')
    }

    function drawBoard(values, soil, shift, now, animated) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(LEFT - 3, TOP - 3, COLS * PITCH + 3, ROWS * PITCH + 2)
      ctx.clip()
      ctx.translate(0, shift)
      const current = animated ? phase : null
      const age = current ? Math.max(0, now - current.from) : 0
      const rainbowWave = current?.result?.blasts.some(blast => blast.kind === 'rainbow')
      for (let i = 0; i < values.length; i++) {
        const x = LEFT + col(i) * PITCH
        const y = TOP + row(i) * PITCH
        box(ctx, x, y, CELL, CELL, 8, digging ? '#49384c' : '#303d66')
        if (soil?.[i]) terrain(soil[i], x, y, current?.groundResult?.hits.has(i))
      }
      for (let i = 0; i < values.length; i++) {
        if (!values[i]) continue
        let [cx, cy] = center(i)
        let sx = 1, sy = 1, alpha = 1, flash = 0
        if (current?.type === 'swap' && (i === current.a || i === current.b)) {
          const [x, y] = center(i === current.a ? current.b : current.a)
          const motion = fx.swapPose(age, Boolean(current.plan))
          cx = mix(cx, x, motion.t)
          cy = mix(cy, y, motion.t)
          sx = sy = motion.scale
        }
        if (current?.type === 'clear' && current.result.cleared.has(i)) {
          const pose = fx.matchPose(age - (rainbowWave ? i % 3 * 12 : 0))
          sx = sy = pose.scale
          alpha = pose.alpha
          flash = pose.flash
        }
        const falling = current?.byTile?.get(i)
        if (falling) {
          const t = clamp((age - col(i) * 3) / fallTime(falling))
          cy = mix(TOP + falling.fromRow * PITCH + CELL / 2, cy, t * t * (3 - 2 * t))
          const impact = Math.sin(Math.PI * clamp((t - 0.78) / 0.22)) * 0.1
          sx += impact
          sy -= impact
        }
        if (sx !== 1 || sy !== 1 || alpha !== 1) {
          ctx.save()
          ctx.translate(cx, cy)
          ctx.scale(sx, sy)
          ctx.globalAlpha = alpha
          gem(values[i], -CELL / 2, -CELL / 2)
          ctx.restore()
        } else gem(values[i], cx - CELL / 2, cy - CELL / 2)
        if (flash) box(ctx, cx - 14, cy - 14, 28, 28, 8, `rgba(255,255,255,${flash})`)
      }
      if (soil) {
        for (let i = 0; i < soil.length; i++) {
          const soilTile = soil[i]
          if (!soilTile) continue
          const [cx, cy] = center(i)
          const hit = current?.groundResult?.hits.has(i) && age > 60
          const hp = hit ? current.groundResult.ground[i]?.hp : soilTile.hp
          if (!hp) continue
          const tag = { soil: '土', dense: '黏', rock: '岩', ice: '冰', chain: '锁', crystal: '晶', cache: '宝' }[soilTile.kind]
          if (soilTile.core) box(ctx, cx - 19, cy - 19, 38, 38, 8, '#ffe3892b', '#ffea91')
          if (soilTile.kind === 'ice') box(ctx, cx - 19, cy - 19, 38, 38, 8, '#89dfff55', '#dcf9ff')
          box(ctx, cx - 1, cy + 3, 21, 16, 4, TERRAINS[soilTile.kind], soilTile.core ? '#fff3ab' : '#253047')
          label(`${tag}${hp}`, cx + 9, cy + 11, 9, '#172037', 'center')
        }
      }
      if (current?.type === 'clear') {
        drawBlasts(current.result.blasts, age)
        effects.drawParticles(ctx, clamp((age - 60) / 145))
        if (current.groundResult?.broken.size && age > 45) {
          const t = clamp((age - 45) / 150)
          ctx.save()
          ctx.globalAlpha = 1 - t
          for (const index of [...current.groundResult.broken].slice(0, effects.lowDetail ? 4 : 8)) {
            const [x, y] = center(index)
            ctx.fillStyle = TERRAINS[soil[index].kind]
            for (const side of [-1, 1]) ctx.fillRect(x + side * (7 + 17 * ease(t)), y - 9 * t, 4, 3)
          }
          ctx.restore()
        }
      }
      if (animated && !current) {
        for (const i of [selected, focus, ...(hint ?? [])]) {
          if (i === null) continue
          const [x, y] = center(i)
          ctx.save()
          if (hint?.includes(i) && !reduced()) ctx.globalAlpha = 0.62 + 0.38 * Math.sin(Math.min(1200, now - hintAt) / 180) ** 2
          box(ctx, x - CELL / 2, y - CELL / 2, CELL, CELL, 8, '#fff3a62b', '#fff3a6')
          ctx.restore()
        }
      }
      ctx.restore()
    }

    function drawBlasts(blasts, age) {
      const t = clamp((age - 25) / 180)
      if (!t || t >= 1) return
      ctx.save()
      ctx.globalAlpha = (1 - t) * 0.85
      ctx.strokeStyle = '#fff1b1'
      ctx.lineWidth = effects.lowDetail ? 3 : 5
      for (const { i, kind } of blasts.slice(0, effects.lowDetail ? 4 : 12)) {
        const [x, y] = center(i)
        ctx.beginPath()
        if (kind === 'row') { ctx.moveTo(mix(x, LEFT, ease(t)), y); ctx.lineTo(mix(x, WIDTH - LEFT, ease(t)), y) }
        if (kind === 'column') { ctx.moveTo(x, mix(y, TOP, ease(t))); ctx.lineTo(x, mix(y, TOP + ROWS * PITCH, ease(t))) }
        if (kind === 'bomb' || kind === 'rainbow') ctx.arc(x, y, ease(t) * (kind === 'bomb' ? 74 : 125), 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()
    }

    function render(now) {
      const background = digging ? floor >= 31 ? '#242237' : floor >= 16 ? '#243344' : '#362b39' : inFever() ? '#343266' : '#232d53'
      ctx.setTransform(density, 0, 0, density, 0, 0)
      ctx.fillStyle = background
      ctx.fillRect(0, 0, width, height)
      ctx.translate(xOffset, yOffset)
      ctx.scale(scale, scale)
      if (digging) {
        for (let i = 0; i < 10; i++) {
          ctx.fillStyle = i % 2 ? '#cba68412' : '#f9ddbd08'
          ctx.fillRect(0, i * 83, WIDTH, 39 + (i % 3) * 8)
          if (!effects.lowDetail) {
            ctx.fillStyle = '#f4d3b722'
            ctx.fillRect(11 + i * 113 % 365, i * 83 + 9, 3, 2)
            ctx.fillRect(24 + i * 47 % 363, i * 83 + 29, 7, 2)
          }
        }
      }
      label(digging ? '无尽深挖' : '经典无限消消乐', 22, 51, 27)
      button(292, 32, 77, '暂停', '#434b70')
      box(ctx, 18, 93, 354, 85, 16, '#111931a8', '#6d749a')
      label(digging ? `第 ${floor} 层 · ${meters} 米` : '当前分数', 35, 116, 14, '#d3dcff')
      label(digging ? '剩余步数' : '历史最高', 352, 116, 14, '#d3dcff', 'right')
      label(digging ? `${score.toLocaleString()} 分` : score.toLocaleString(), 35, 149, 25)
      label(digging ? String(steps) : record.score.toLocaleString(), 352, 149, 25, '#ffe6a3', 'right')
      label(digging ? `最深第 ${record.floor} 层${theme ? ' · ' + THEMES[theme] : ''}` : `最高 ${record.combo} 连锁`,
        195, 200, 14, '#d3dcff', 'center')
      if (partner) drawPartner(now)
      box(ctx, 11, TOP - 12, 368, ROWS * PITCH + 19, 15, digging ? '#211e35' : '#182449', '#68719b')
      if (phase?.type === 'dive') {
        const offset = ease(clamp((now - phase.from) / phase.duration)) * ROWS * PITCH
        drawBoard(phase.last.board, phase.last.ground, -offset, now, false)
        drawBoard(board, ground, ROWS * PITCH - offset, now, false)
      } else drawBoard(board, ground, 0, now, true)
      if (combo >= 2 && phase?.type === 'clear') {
        const p = clamp((now - phase.from) / phase.duration)
        ctx.save()
        ctx.globalAlpha = Math.min(1, (1 - p) * 3)
        label(`COMBO ×${combo}`, 195, 660, 25 + Math.sin(p * Math.PI) * 5, '#ffe9a8', 'center')
        ctx.restore()
      } else if (digging) {
        label(`核心剩余 ${ground.filter(value => value?.core).length}`, 195, 657, 17, '#ffe6a3', 'center')
        box(ctx, 153, 671, 84, 4, 2, '#6a4f64')
        const remaining = ground.filter(value => value?.core).length
        if (remaining) box(ctx, 153, 671, 84 * remaining / Math.min(5, 2 + Math.floor((floor - 1) / 5)), 4, 2, '#f8cf80')
        label(message, 195, 686, 12, '#d3dcff', 'center')
      } else if (digging === false) {
        label(inFever() ? `狂热 · 双倍得分 ${Math.ceil((feverUntil - now) / 1000)} 秒` :
          `收集${['红', '蓝', '金', '紫', '绿'][goal]}色宝石 ${goalCount}/20`, 195, 671, 14, '#d3dcff', 'center')
        box(ctx, 132, 691, 126, 4, 2, '#58658f')
        if (energy) box(ctx, 132, 691, 126 * Math.min(energy / 80, 1), 4, 2, '#f8d68a')
      }
      if (phase?.type === 'fall') {
        const t = clamp((now - phase.from) / phase.duration)
        ctx.save()
        ctx.globalAlpha = 1 - t * 0.85
        if (phase.extraSteps) label(`+${phase.extraSteps} 步`, 346, 102 - t * 12, 14, '#ffe6a3', 'right')
        if (combo > 1) label(`+${phase.points}`, 194, 217 - t * 12, 13, '#ffe6a3', 'center')
        ctx.restore()
      }
      button(20, 722, 111, '返回首页', '#434b70')
      button(259, 722, 111, '重新开始', '#434b70')
      if (confirmation || paused || lost || reward && !phase) {
        box(ctx, 0, 0, WIDTH, HEIGHT, 0, '#11172acb')
        box(ctx, 38, 275, 314, 270, 19, '#283350', '#7d91b8')
        label(confirmation === 'exit' ? '返回首页？' : confirmation === 'reset' ? '重新开始？' :
          paused ? '已暂停' : lost ? '步数用完了' : '选择补给', 195, 320, 25, '#f5f6ff', 'center')
        if (lost) label(`抵达第 ${floor} 层 · ${score} 分`, 195, 360, 16, '#ffe6a3', 'center')
        else if (confirmation) label(confirmation === 'exit' ? '下次从上一个稳定盘面继续。' : '将清空本局进度，保留历史纪录。', 195, 360, 14, '#d3dcff', 'center')
        else if (paused && record.runs.length) label(`历史 · ${record.runs.slice(0, 3).map(n => n + (digging ? ' 层' : ' 分')).join(' · ')}`, 195, 360, 14, '#d3dcff', 'center')
        button(88, 398, 214, confirmation ? '取消' : paused ? '继续' : lost ? '再挖一次' : '补充 6 步')
        button(88, 455, 214, confirmation ? '确认' : reward && !paused ? '获得一颗彩虹宝石' : '返回首页', '#434b70')
        if (paused && !confirmation) button(112, 502, 166, options.isMuted?.() ? '开启音效' : '静音', '#434b70')
        if (lost && record.milestone) button(88, 502, 214, `从第 ${record.milestone.floor} 层检查点继续`, '#434b70')
      }
    }

    function button(x, y, w, text, color = '#6657a2') {
      box(ctx, x, y, w, 38, 11, color, '#858fc0')
      label(text, x + w / 2, y + 19, 14, '#f6f6ff', 'center')
    }

    function drawPartner(now) {
      const skin = options.skin ?? 0
      const w = partner.width / 2
      const h = partner.height / 2
      const i = skin % 4
      const bounce = !reduced() && phase?.type === 'clear' && combo >= 3
        ? Math.sin(Math.PI * clamp((now - phase.from) / phase.duration)) * 5 : 0
      ctx.save()
      ctx.beginPath()
      ctx.arc(47, 197 - bounce, 15, 0, Math.PI * 2)
      ctx.clip()
      ctx.drawImage(partner, i % 2 * w, Math.floor(i / 2) * h, w, h, 32, 182 - bounce, 30, 30)
      ctx.restore()
      if (digging) box(ctx, 37, 181 - bounce, 20, 5, 2, '#f9cc6b')
      const accessories = options.accessories ?? []
      if (accessories.includes(3) && !digging) box(ctx, 38, 182 - bounce, 18, 5, 2, '#a1d7eb')
      if (accessories.includes(0)) box(ctx, 39, 194 - bounce, 16, 4, 2, '#81d9e8b5')
      if (accessories.includes(1)) label('●', 58, 207 - bounce, 8, '#ffe28c', 'center')
      if (accessories.includes(2) || accessories.includes(4)) box(ctx, 41, 204 - bounce, 13, 3, 1, '#ec9cab')
      if (accessories.includes(5)) label('★', 54, 208 - bounce, 8, '#ffe28c', 'center')
    }

    function toggle(now = Date.now()) {
      if (paused) {
        if (phase) phase.from += now - paused
        if (feverUntil > paused) feverUntil += now - paused
        paused = false
        armHint()
      } else {
        paused = now
        queuedMove = null
        clearHint()
        clearTimeout(feverTimer)
        feverTimer = null
      }
      press = null
      schedule()
    }

    function setActive(value) {
      if (active === value) return
      active = value
      const now = Date.now()
      press = null
      if (!active) {
        suspendedAt = now
        clearHint()
        clearTimeout(feverTimer)
        feverTimer = null
        queuedMove = null
      }
      else {
        if (phase && !paused) phase.from += now - suspendedAt
        if (!paused && feverUntil > suspendedAt) feverUntil += now - suspendedAt
        schedule()
      }
    }

    function choose(i) {
      if (selected !== null && adjacent(selected, i)) move(selected, i)
      else { selected = selected === i ? null : i; schedule() }
    }

    function point(x, y) { return [(x - xOffset) / scale, (y - yOffset) / scale] }
    function cell(x, y) {
      const a = Math.floor((x - LEFT) / PITCH), b = Math.floor((y - TOP) / PITCH)
      return a >= 0 && a < COLS && b >= 0 && b < ROWS ? b * COLS + a : -1
    }

    function up(x, y) {
      if (!press) return
      const [fromX, fromY] = press
      press = null
      const [tx, ty] = point(x, y)
      const dx = tx - fromX, dy = ty - fromY
      if (Math.hypot(dx, dy) < 12) {
        sound?.unlock()
        if (confirmation || paused || lost || reward && !phase) {
          if (paused && !confirmation && ty >= 502 && ty <= 540 && tx >= 112 && tx <= 278) {
            options.toggleMute?.()
            schedule()
            return
          }
          if (tx < 88 || tx > 302) return
          if (lost && record.milestone && ty >= 502 && ty <= 540) {
            record.checkpoint = record.milestone
            reset(true)
            return
          }
          if (ty >= 398 && ty <= 436) {
            if (confirmation) cancelConfirmation()
            else if (paused) toggle()
            else if (lost) reset()
            else { reward = false; steps = Math.min(depth.STEPS.capacity, steps + 6); saveStable(); schedule() }
          }
          if (ty >= 455 && ty <= 493) {
            if (confirmation) applyConfirmation()
            else if (reward && !paused) {
              const index = [35, 36, 43, 44, ...board.keys()].find(i => !board[i].kind && !locked(i)) ?? 35
              board[index] = match.tile(board[index].color, 'rainbow')
              reward = false
              saveStable()
              schedule()
            } else if (lost) exit()
            else ask('exit')
          }
          return
        }
        if (tx >= 292 && ty >= 32 && ty <= 70) { toggle(); return }
        if (ty >= 722 && ty <= 760) {
          if (tx <= 131) ask('exit')
          else if (tx >= 259) ask('reset')
          return
        }
      }
      if (paused || lost || reward || confirmation) return
      if (phase?.type === 'dive' || phase?.type === 'shuffle') return
      const from = cell(fromX, fromY)
      if (from < 0) return
      focus = null
      if (Math.hypot(dx, dy) < 12) {
        if (phase) queuedMove = queuedMove?.length === 1 && adjacent(queuedMove[0], from) ? [queuedMove[0], from] : [from]
        else choose(from)
      }
      else {
        sound?.unlock()
        const to = from + (Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : Math.sign(dy) * COLS)
        if (phase && adjacent(from, to)) queuedMove = [from, to]
        else move(from, to)
      }
    }

    function ask(action) {
      if (!paused) toggle()
      confirmation = action
      schedule()
    }

    function cancelConfirmation() {
      confirmation = null
      if (paused) toggle()
    }

    function applyConfirmation() {
      if (confirmation === 'exit') exit()
      else { if (!lost) archive(); reset() }
    }

    function exit() {
      setActive(false)
      leave()
    }

    function key(value) {
      if (confirmation) {
        if (value === 'Escape') { cancelConfirmation(); return true }
        if (value === 'Enter') { applyConfirmation(); return true }
        return false
      }
      if (value === 'Escape') {
        if (lost) exit()
        else toggle()
        return true
      }
      if (value.toLowerCase() === 'p' && !lost) { toggle(); return true }
      if (value.toLowerCase() === 'r') { ask('reset'); return true }
      const directions = { ArrowUp: -COLS, ArrowDown: COLS, ArrowLeft: -1, ArrowRight: 1 }
      if (!Object.hasOwn(directions, value) && value !== 'Enter' && value !== ' ') return false
      if (paused && value === 'Enter') { toggle(); return true }
      if (reward && !phase && value === 'Enter') {
        reward = false; steps = Math.min(depth.STEPS.capacity, steps + 6); saveStable(); schedule(); return true
      }
      if (phase || paused || lost || reward) return true
      sound?.unlock()
      if (focus === null) focus = 0
      if (value === 'Enter' || value === ' ') choose(focus)
      else if (adjacent(focus, focus + directions[value])) focus += directions[value]
      schedule()
      return true
    }

    reset(true)
    resize(options.width, options.height, options.pixelRatio)
    options.loadGallery?.(Math.floor((options.skin ?? 0) / 4), image => { partner = image; schedule() }, () => {})
    return { down: (x, y) => { press = point(x, y) }, up, cancel: () => { press = null }, resize, setActive, key }
  }

  if (typeof module === 'object') module.exports = { mount }
  else globalThis.ArcadeScene = { mount }
})()
