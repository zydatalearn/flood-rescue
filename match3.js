(function () {
  const COLS = 8
  const ROWS = 9
  const SIZE = COLS * ROWS
  const COLORS = 5
  const MAX_CHAIN = 64
  const tile = (color, kind = '') => ({ color, kind })
  const roll = (random, count) => Math.min(count - 1, Math.floor(random() * count))
  const row = i => Math.floor(i / COLS)
  const col = i => i % COLS
  const adjacent = (a, b) => a >= 0 && b >= 0 && a < SIZE && b < SIZE &&
    Math.abs(row(a) - row(b)) + Math.abs(col(a) - col(b)) === 1

  function seeded(seed) {
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
    random.state = () => seed
    return random
  }

  function lines(board) {
    const found = []
    for (const step of [1, COLS]) {
      for (let i = 0; i < SIZE; i++) {
        const value = board[i]
        if (!value || value.kind === 'rainbow') continue
        const same = j => board[j]?.color === value.color && board[j].kind !== 'rainbow'
        if (adjacent(i, i - step) && same(i - step)) continue
        const cells = [i]
        while (adjacent(cells.at(-1), cells.at(-1) + step) && same(cells.at(-1) + step)) cells.push(cells.at(-1) + step)
        if (cells.length >= 3) found.push({ cells, kind: step === 1 ? 'row' : 'column' })
      }
    }
    return found
  }

  function specialPair(a, b) {
    return Boolean(a && b && (a.kind === 'rainbow' || b.kind === 'rainbow' || (a.kind && b.kind)))
  }

  function exchange(board, a, b, locked) {
    if (!adjacent(a, b) || !board[a] || !board[b] || locked?.(a) || locked?.(b)) return null
    const swapped = board.slice()
    ;[swapped[a], swapped[b]] = [swapped[b], swapped[a]]
    const pair = specialPair(board[a], board[b]) ? [b, a] : null
    const matches = pair ? [] : lines(swapped)
    return pair || matches.length ? { swapped, pair, matches, preferred: [b, a] } : null
  }

  function legalMove(board, locked) {
    for (let a = 0; a < SIZE; a++) {
      for (const b of [a + 1, a + COLS]) {
        if (!adjacent(a, b) || !board[a] || !board[b] || locked?.(a) || locked?.(b)) continue
        if (specialPair(board[a], board[b])) return [a, b]
        if (board[a].color === board[b].color) continue
        const read = i => board[i === a ? b : i === b ? a : i]
        if (formsLine(read, a) || formsLine(read, b)) return [a, b]
      }
    }
    return null
  }

  function formsLine(read, i) {
    const color = read(i).color
    for (const step of [1, COLS]) {
      let count = 1
      for (const dir of [-step, step]) {
        let cursor = i
        while (adjacent(cursor, cursor + dir)) {
          const next = read(cursor + dir)
          if (!next || next.kind === 'rainbow' || next.color !== color) break
          count++
          if (count === 3) return true
          cursor += dir
        }
      }
    }
    return false
  }

  function clearWave(board, matches = lines(board), preferred = [], pair = null) {
    const groups = []
    for (const line of matches) {
      const cells = new Set(line.cells)
      const runs = [line]
      for (let i = groups.length - 1; i >= 0; i--) {
        const group = groups[i]
        if (!line.cells.some(cell => group.cells.has(cell))) continue
        for (const cell of group.cells) cells.add(cell)
        runs.push(...group.runs)
        groups.splice(i, 1)
      }
      groups.push({ cells, runs })
    }
    const created = new Map()
    const queue = pair ? [...pair] : []
    for (const { cells, runs } of groups) {
      const longest = runs.reduce((best, run) => run.cells.length > best.cells.length ? run : best)
      const cross = runs.find(run => run.kind !== longest.kind)
      const kind = longest.cells.length >= 5 ? 'rainbow' : cross ? 'bomb' :
        longest.cells.length === 4 ? longest.kind : ''
      if (kind) {
        const intersection = cross?.cells.find(cell => longest.cells.includes(cell))
        const anchor = [...preferred, intersection, longest.cells[Math.floor(longest.cells.length / 2)], ...cells]
          .find(i => cells.has(i) && !board[i].kind)
        if (anchor !== undefined) created.set(anchor, tile(board[anchor].color, kind))
      }
      for (const i of cells) queue.push(i)
    }
    const cleared = new Set()
    const blasts = []
    const impacted = new Set()
    const scheduled = new Set(queue)
    const converted = new Map()
    const next = board.slice()
    const hit = i => {
      impacted.add(i)
      if (!scheduled.has(i)) { scheduled.add(i); queue.push(i) }
    }
    const stripe = kind => kind === 'row' || kind === 'column'
    if (pair) {
      const [a, b] = pair
      const first = board[a], second = board[b]
      if (stripe(first.kind) && stripe(second.kind)) {
        blasts.push({ i: a, kind: 'row' }, { i: a, kind: 'column' })
        for (let i = 0; i < SIZE; i++) if (row(i) === row(a) || col(i) === col(a)) hit(i)
      }
      const rainbow = first.kind === 'rainbow' ? a : second.kind === 'rainbow' ? b : -1
      const partner = rainbow === a ? second : first
      if (rainbow >= 0 && partner.kind && partner.kind !== 'rainbow') {
        for (let i = 0; i < SIZE; i++) {
          if (i === a || i === b || board[i]?.color !== partner.color || board[i].kind) continue
          converted.set(i, stripe(partner.kind) && i % 2 ? (partner.kind === 'row' ? 'column' : 'row') : partner.kind)
          hit(i)
        }
      }
    }
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const i = queue[cursor]
      if (cleared.has(i) || created.has(i) || !board[i]) continue
      cleared.add(i)
      next[i] = null
      const { color } = board[i]
      const kind = converted.get(i) ?? board[i].kind
      if (!kind) continue
      blasts.push({ i, kind })
      const partner = pair?.includes(i) ? board[pair.find(cell => cell !== i)] : null
      const radius = partner?.kind === 'bomb' ? 2 : 1
      for (let j = 0; j < SIZE; j++) {
        const dx = Math.abs(col(j) - col(i))
        const dy = Math.abs(row(j) - row(i))
        if ((kind === 'row' && dy <= (partner?.kind === 'bomb' ? 1 : 0)) ||
          (kind === 'column' && dx <= (partner?.kind === 'bomb' ? 1 : 0)) ||
          (kind === 'bomb' && dx <= radius && dy <= radius) ||
          (kind === 'rainbow' && (partner?.kind === 'rainbow' || board[j]?.color === (partner?.color ?? color)))) hit(j)
      }
    }
    for (const [i, value] of created) next[i] = value
    return { board: next, cleared, created, blasts, impacted, combined: Boolean(pair && pair.every(i => board[i].kind)) }
  }

  function refill(board, random) {
    const next = Array(SIZE)
    const falls = []
    for (let x = 0; x < COLS; x++) {
      let dest = ROWS - 1
      for (let y = ROWS - 1; y >= 0; y--) {
        const value = board[y * COLS + x]
        if (!value) continue
        const target = dest * COLS + x
        next[target] = value
        if (dest !== y) falls.push({ target, fromRow: y, distance: dest - y })
        dest--
      }
      for (let y = dest; y >= 0; y--) {
        const target = y * COLS + x
        next[target] = tile(roll(random, COLORS))
        falls.push({ target, fromRow: y - dest - 1, distance: dest + 1 })
      }
    }
    return { board: next, falls }
  }

  function deal(random, safeRows = ROWS) {
    const board = Array(SIZE)
    const base = roll(random, COLORS)
    const other = (base + 1 + roll(random, COLORS - 1)) % COLORS
    const anchor = roll(random, safeRows - 1) * COLS + roll(random, COLS - 2)
    for (const [offset, color] of [[0, base], [1, other], [2, base], [COLS + 1, base]]) board[anchor + offset] = tile(color)
    for (let i = 0; i < SIZE; i++) {
      if (board[i]) continue
      const start = roll(random, COLORS)
      for (let offset = 0; offset < COLORS; offset++) {
        const color = (start + offset) % COLORS
        const same = j => board[j]?.color === color
        if ([1, COLS].some(step =>
          (adjacent(i, i - step) && adjacent(i - step, i - 2 * step) && same(i - step) && same(i - 2 * step)) ||
          (adjacent(i, i - step) && adjacent(i, i + step) && same(i - step) && same(i + step)) ||
          (adjacent(i, i + step) && adjacent(i + step, i + 2 * step) && same(i + step) && same(i + 2 * step)))) continue
        board[i] = tile(color)
        break
      }
    }
    return board
  }

  function shuffle(board, random, locked) {
    const next = board.slice()
    const fallback = seeded(63109 + board.reduce((sum, value, i) => sum + (value.color + 1) * (i + 1), 0))
    for (let attempt = 0; attempt < 160; attempt++) {
      const source = attempt < 48 ? random : fallback
      for (let i = next.length - 1; i > 0; i--) {
        const j = roll(source, i + 1)
        ;[next[i], next[j]] = [next[j], next[i]]
      }
      if (!lines(next).length && legalMove(next, locked)) return { board: next, preserved: true }
    }
    for (let attempt = 0; attempt < 64; attempt++) {
      const buckets = Array.from({ length: COLORS }, (_, color) => next.filter(value => value.color === color))
      const arranged = []
      for (let i = 0; i < SIZE; i++) {
        const colors = seedsByWeight(buckets, fallback)
        const chosen = colors.find(color => {
          const value = buckets[color].at(-1)
          if (!value) return false
          if (value.kind === 'rainbow') return true
          const same = j => arranged[j]?.color === color && arranged[j].kind !== 'rainbow'
          return !(col(i) >= 2 && same(i - 1) && same(i - 2)) &&
            !(row(i) >= 2 && same(i - COLS) && same(i - 2 * COLS))
        })
        if (chosen === undefined) break
        arranged.push(buckets[chosen].pop())
      }
      if (arranged.length === SIZE && legalMove(arranged, locked)) return { board: arranged, preserved: true }
    }
    // A balanced constructive deal keeps pathological boards and random sources recoverable.
    return { board: deal(fallback, locked ? 5 : ROWS), preserved: false }
  }

  function seedsByWeight(buckets, random) {
    return buckets.map((group, color) => [color, group.length + random() * 4])
      .sort((a, b) => b[1] - a[1]).map(([color]) => color)
  }

  const api = { COLS, ROWS, SIZE, MAX_CHAIN, tile, seeded, adjacent, row, col, lines, exchange, legalMove,
    clearWave, refill, deal, shuffle }
  if (typeof module === 'object') module.exports = api
  else globalThis.ArcadeMatch = api
})()
