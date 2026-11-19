(function () {
  const match = typeof module === 'object' ? require('./match3.js') : globalThis.ArcadeMatch
  const { COLS, SIZE, adjacent, seeded, tile, deal } = match
  const STEPS = { initial: 30, layer: 5, section: 30, capacity: 42 }
  const THEMES = ['treasure', 'blast', 'rock', 'crystal', 'reward']
  const MATERIALS = { soil: 1, dense: 2, rock: 3, ice: 2, chain: 3, crystal: 3, cache: 1 }

  function layer(seed, depth) {
    const random = seeded((seed ^ Math.imul(depth, 0x9e3779b1)) >>> 0)
    const board = deal(random, 5)
    const theme = depth % 10 === 0 ? THEMES[(depth / 10 - 1) % THEMES.length] :
      depth % 5 === 0 ? 'elite' : depth % 3 === 0 ? 'supply' : null
    const ground = Array(SIZE).fill(null)
    const bandStart = 5 * COLS
    const candidates = Array.from({ length: SIZE - bandStart }, (_, i) => bandStart + i)
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
    }
    const palette = depth <= 5 ? ['soil'] : depth <= 15 ? ['soil', 'dense', 'rock'] :
      depth <= 30 ? ['soil', 'dense', 'rock', 'ice'] : ['soil', 'dense', 'rock', 'ice', 'chain', 'crystal']
    const targets = Math.min(5, 2 + Math.floor((depth - 1) / 5))
    const count = Math.min(16, targets + 4 + Math.floor(depth / 5))
    for (let i = 0; i < count; i++) {
      let kind = i < targets && depth <= 5 ? 'soil' : palette[Math.floor(random() * palette.length)]
      if (i === 0 && (theme === 'treasure' || theme === 'reward')) kind = 'cache'
      if (i === 0 && (theme === 'rock' || theme === 'crystal')) kind = theme
      if (i === 0 && theme === 'elite' && depth > 5) kind = 'rock'
      ground[candidates[i]] = { kind, hp: MATERIALS[kind], max: MATERIALS[kind], core: i < targets }
    }
    if (theme === 'blast' || theme === 'treasure') {
      for (const i of [candidates[0], candidates[1]]) board[i] = tile(board[i].color, theme === 'blast' ? 'bomb' : 'rainbow')
    }
    return { board, ground, theme, depth: (depth - 1) * 4, random }
  }

  function damage(ground, cleared, impacted = new Set()) {
    const next = ground.slice()
    const hits = new Set()
    const broken = new Set()
    const queue = []
    const mark = cell => {
      if (next[cell] && !hits.has(cell)) {
        hits.add(cell)
        queue.push(cell)
      }
    }
    for (const cell of cleared) {
      mark(cell)
      for (const neighbor of [cell - 1, cell + 1, cell - COLS, cell + COLS]) {
        if (adjacent(cell, neighbor)) mark(neighbor)
      }
    }
    const echo = []
    let reward = 0
    function strike(cell, amount) {
      const value = next[cell]
      if (!value) return
      hits.add(cell)
      if (value.hp > amount) {
        next[cell] = { ...value, hp: value.hp - amount }
        return
      }
      next[cell] = null
      broken.add(cell)
      if (value.kind === 'cache') reward += 3
      if (value.kind === 'crystal') {
        for (const neighbor of [cell - 1, cell + 1, cell - COLS, cell + COLS]) {
          if (adjacent(cell, neighbor) && next[neighbor]) echo.push(neighbor)
        }
      }
    }
    for (const cell of queue) strike(cell, next[cell].kind === 'chain' && impacted.has(cell) ? 2 : 1)
    for (const cell of echo) strike(cell, 1)
    return { ground: next, hits, broken, reward, complete: !next.some(value => value?.core) }
  }

  const stepsAfterLayer = (steps, floor) => Math.min(STEPS.capacity, Math.max(steps + STEPS.layer, floor % 10 === 0 ? STEPS.section : 0))

  function validBoard(board) {
    return Array.isArray(board) && board.length === SIZE && board.every(entry => entry &&
      Number.isInteger(entry.color) && entry.color >= 0 && entry.color < 5 &&
      ['', 'row', 'column', 'bomb', 'rainbow'].includes(entry.kind)) && !match.lines(board).length
  }

  function validCheckpoint(value) {
    return Boolean(validBoard(value?.board) && Array.isArray(value.ground) && value.ground.length === SIZE &&
      value.ground.every(entry => entry === null || (Object.hasOwn(MATERIALS, entry.kind) &&
        Number.isInteger(entry.hp) && entry.hp >= 1 && entry.hp <= MATERIALS[entry.kind])) &&
      [value.seed, value.rng, value.score, value.steps, value.floor].every(n => Number.isSafeInteger(n) && n >= 0) &&
      value.floor >= 1 && value.steps <= STEPS.capacity && value.ground.some(entry => entry?.core) &&
      match.legalMove(value.board, i => value.ground[i]?.kind === 'ice'))
  }

  const api = { STEPS, layer, damage, stepsAfterLayer, validBoard, validCheckpoint }
  if (typeof module === 'object') module.exports = api
  else globalThis.ArcadeDescent = api
})()
