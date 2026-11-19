(function () {
  const START_WATER = 1
  const MAX_WATER = 12
  const RISE_MS = 5000
  const FLOOD_MS = (MAX_WATER - START_WATER) * RISE_MS
  const BONUS_CELLS = 6
  const BONUS_MS = 2000
  const MAX_BONUSES = 3
  const TILES = 'ABCDE'
  const GENERATION_ATTEMPTS = 96
  const hardBranches = [
    { entry: 1, bands: [[2, 5]] },
    { entry: 3, bands: [[0], [4]] },
    { entry: 7, bands: [[4, 1]] },
  ]
  const endlessBranches = [
    { entry: 0, bands: [[1, 4]] },
    { entry: 8, bands: [[5, 2]] },
  ]
  const levels = [
    {
      cols: 7, rows: 9,
      variants: [
        {
          entry: 3, board: ['ADDCBAA', 'BCDDECA', 'CDBDBBC', 'AABCADE', 'ACEECAC', 'BBCCADC', 'BBABCBD',
            'CCBBCCD', 'DDBCEDA'],
          paths: [[[3, 2], [31, 32], [59, 58]]],
        },
        {
          entry: 0, board: ['AEAEECC', 'BABEEAD', 'AABACBC', 'DCADADC', 'DECDDBA', 'CDECEDC', 'ADEEDDC',
            'AABDEEA', 'BACCDBA'],
          paths: [[[7, 8], [35, 36], [56, 57]]],
        },
      ],
    },
    {
      cols: 9, rows: 12, exits: [2, 4, 6],
      variants: [
        {
          entry: 3, board: ['BADBEBADA', 'BCBDDECAD', 'CECBBCAAE', 'CEBEEABCD', 'ACBBACABA', 'BBABEDEAB',
            'AECEAEAEB', 'CDEBAABDC', 'DBEABDAEE', 'ABBDDACDE', 'DEDCACEED', 'AADBABCDD'],
          paths: [
            [[12, 11], [30, 29], [47, 38], [56, 57], [83, 84]],
            [[12, 11], [30, 29], [50, 59], [76, 75], [85, 86]],
            [[12, 11], [30, 29], [50, 59], [69, 68], [96, 95]],
          ],
        },
        {
          entry: 7, board: ['BBEEACADB', 'DACBCDDEE', 'EEABDEADC', 'EDBCDBABB', 'DEDDEECAC', 'EAEEBCBAC',
            'BAEBEBDBA', 'BCDEBEADD', 'DEECEADEC', 'BCBCBEADB', 'CEBBDBEEA', 'ABACBCEAE'],
          paths: [
            [[16, 15], [34, 33], [50, 59], [46, 45], [65, 66], [101, 100]],
            [[16, 15], [34, 33], [50, 59], [67, 68], [94, 93]],
            [[16, 15], [34, 33], [50, 59], [69, 70], [87, 86]],
          ],
        },
        {
          entry: 1, board: ['EBCDBDADE', 'BCBBEEDEC', 'ACEEBBCBE', 'BACDEEBDB', 'DCABEEBCA', 'DAAEDAEBC',
            'EDBECDABC', 'DECDCABCD', 'ADCCBEAAC', 'EBEDDECBD', 'ADEDADEAE', 'BBAEDBECB'],
          paths: [
            [[1, 2], [37, 38], [64, 63], [76, 67], [101, 102]],
            [[1, 2], [37, 38], [64, 63], [76, 67], [94, 95]],
            [[1, 2], [37, 38], [64, 63], [76, 67], [77, 68], [87, 86]],
          ],
        },
      ],
    },
  ]

  function presets(index) {
    const { variants, ...rules } = levels[index]
    return variants.map(({ entry, board, paths }) => ({
      state: opening({ ...rules, entry }, [...board.join('')]), paths, generated: false,
    }))
  }

  function opening(level, board) {
    return { level, board, water: START_WATER, route: [], outcome: null }
  }

  function pick(items, random) {
    return items[Math.floor(random() * items.length)]
  }

  function deal(index, random = Math.random, previous, round = 0) {
    const sameBoard = state => previous && state.board.length === previous.board.length &&
      state.board.every((tile, cell) => tile === previous.board[cell])
    const endless = index === 1 && round > 0
    const attempts = endless ? 4 * GENERATION_ATTEMPTS : GENERATION_ATTEMPTS
    for (let attempt = 0; attempt < attempts; attempt++) {
      const candidate = buildBoard(index, random, round)
      if (candidate && !sameBoard(candidate.state) && proves(candidate)) return { ...candidate, generated: true }
    }
    if (endless || index === 0) {
      // The backup sequence keeps the required bends at every board size.
      let seed = 20261119
      const backupRandom = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
      for (;;) {
        const candidate = buildBoard(index, backupRandom, round)
        if (candidate && !sameBoard(candidate.state) && proves(candidate)) return { ...candidate, generated: false }
      }
    }
    return pick(presets(index).filter(({ state }) => !sameBoard(state)), random)
  }

  function buildBoard(index, random, round) {
    const intro = index === 0
    const endless = index === 1 && round > 0
    const cols = endless ? 9 + Math.min(round, 3) : levels[index].cols
    const rows = endless ? (round < 3 ? 15 : 18) : levels[index].rows
    const offset = endless ? Math.floor(random() * (cols - 8)) : 0
    const branch = intro ? null : pick(endless ? endlessBranches : hardBranches, random)
    const entry = branch ? branch.entry + offset : Math.floor(random() * cols)
    const direction = intro && (entry < 3 || (entry === 3 && random() < 0.5)) ? 1 : -1
    const exits = intro ? [entry + 3 * direction] : levels[index].exits.map(col => col + offset)
    const riseMs = endless ? Math.max(1800, 4500 - (round - 1) * 250) : RISE_MS
    const level = { cols, rows, exits, entry, riseMs }
    const junction = 2 + 3 * Math.floor(random() * (rows / 3 - 1))
    const groups = []
    const group = (first, stride) => {
      const cells = [first, first + stride, first + 2 * stride]
      groups.push(cells)
      return cells
    }
    const shaft = (startRow, endRow, col) => {
      const segments = []
      for (let row = startRow; row <= endRow; row += 3) segments.push(group(row * cols + col, cols))
      return segments
    }
    const stem = shaft(0, junction, entry)
    const bands = intro
      ? [[group(junction * cols + entry + direction, direction)]]
      : branch.bands.map(starts => starts.map(col => group(junction * cols + col + offset, 1)))
    const routes = exits.map(exit => {
      const band = bands.find(parts => parts.some(cells => cells.includes(junction * cols + exit)))
      const last = band.findIndex(cells => cells.includes(junction * cols + exit))
      return [...stem, ...band.slice(0, last + 1), ...shaft(junction + 1, rows - 1, exit)]
    })

    const reserved = new Set(groups.flat())
    const moves = new Map()
    const board = Array(cols * rows).fill(null)
    for (const cells of groups) {
      const pairs = []
      for (const cell of cells) {
        for (const neighbor of [cell - 1, cell + 1, cell - cols, cell + cols]) {
          if (adjacent(cell, neighbor, level) && !reserved.has(neighbor)) pairs.push([cell, neighbor])
        }
      }
      if (!pairs.length) return
      const [cell, helper] = pick(pairs, random)
      const color = pick(TILES, random)
      for (const target of cells) board[target] = color
      board[cell] = pick(TILES.replace(color, ''), random)
      board[helper] = color
      reserved.add(helper)
      moves.set(cells, [cell, helper])
    }
    if (matches(board, cols).size) return
    for (let cell = 0; cell < board.length; cell++) {
      if (board[cell] !== null) continue
      const first = Math.floor(random() * TILES.length)
      for (let offset = 0; offset < TILES.length; offset++) {
        board[cell] = TILES[(first + offset) % TILES.length]
        if (!formsTriple(board, cols, cell, board[cell])) break
        board[cell] = null
      }
      if (board[cell] === null) return
    }
    const paths = routes.map(cells => cells.map(group => moves.get(group)))
    if (endless) {
      const byLength = exits.map((col, i) => ({ col, length: paths[i].length }))
        .sort((a, b) => a.length - b.length)
      level.closeAt = { [byLength[0].col]: 6, [byLength[1].col]: 9 }
    }
    return { state: opening(level, board), paths }
  }

  function proves({ state, paths }) {
    const { cols, rows, exits } = state.level
    return paths.every((moves, index) => {
      let position = state
      for (const move of moves) {
        const next = play(position, ...move)
        if (!next || next.cleared.size !== 3) return false
        position = next.state
      }
      if (position.outcome !== 'escaped') return false
      const reached = outlets(position.route, position.level)
      return !exits || (reached.length === 1 && reached[0] === (rows - 1) * cols + exits[index])
    })
  }

  function matches(board, cols = levels[0].cols) {
    const found = new Set()
    for (let index = 0; index < board.length; index++) {
      const tile = board[index]
      if (tile === null) continue
      if (index % cols < cols - 2 && board[index + 1] === tile && board[index + 2] === tile) {
        found.add(index).add(index + 1).add(index + 2)
      }
      if (index < board.length - 2 * cols && board[index + cols] === tile && board[index + 2 * cols] === tile) {
        found.add(index).add(index + cols).add(index + 2 * cols)
      }
    }
    return found
  }

  function adjacent(a, b, { cols, rows }) {
    return a >= 0 && a < cols * rows && b >= 0 && b < cols * rows &&
      Math.abs(Math.floor(a / cols) - Math.floor(b / cols)) + Math.abs(a % cols - b % cols) === 1
  }

  function swap(board, a, b) {
    const next = board.slice()
    next[a] = board[b]
    next[b] = board[a]
    return next
  }

  function longRuns(board, level, a, b) {
    const runs = []
    for (const cell of [a, b]) {
      for (const stride of [1, level.cols]) {
        const tile = board[cell]
        let first = cell
        let last = cell
        while (adjacent(first, first - stride, level) && board[first - stride] === tile) first -= stride
        while (adjacent(last, last + stride, level) && board[last + stride] === tile) last += stride
        const length = (last - first) / stride + 1
        if (length >= 4) runs.push({ first, last, length })
      }
    }
    return runs
  }

  // Only triples crossing the changed cell can be new on a settled board.
  function formsTriple(board, cols, cell, tile, vacated = -1) {
    const same = index => index !== vacated && board[index] === tile
    const col = cell % cols
    const left = col > 0 && same(cell - 1)
    const right = col + 1 < cols && same(cell + 1)
    const up = same(cell - cols)
    const down = same(cell + cols)
    return (left && right) || (left && col >= 2 && same(cell - 2)) ||
      (right && col + 2 < cols && same(cell + 2)) || (up && down) ||
      (up && same(cell - 2 * cols)) || (down && same(cell + 2 * cols))
  }

  function availableMove(board, level) {
    for (let a = 0; a < board.length; a++) {
      for (const b of [a + 1, a + level.cols]) {
        if (board[a] && board[b] && board[a] !== board[b] && adjacent(a, b, level) &&
          (formsTriple(board, level.cols, a, board[b], b) || formsTriple(board, level.cols, b, board[a], a))) return [a, b]
      }
    }
    return null
  }

  function trace(board, level) {
    if (board[level.entry] !== null) return []
    const route = [{ cell: level.entry, from: -1, depth: 0 }]
    const visited = new Set([level.entry])
    for (const { cell, depth } of route) {
      for (const next of [cell + level.cols, cell - 1, cell + 1]) {
        if (board[next] !== null || visited.has(next) || !adjacent(cell, next, level)) continue
        route.push({ cell: next, from: cell, depth: depth + 1 })
        visited.add(next)
      }
    }
    return route
  }

  function outlets(route, { cols, rows, exits, closeAt } = levels[0], water = START_WATER) {
    const bottom = cols * (rows - 1)
    return route.map(({ cell }) => cell).filter(cell => {
      const col = cell - bottom
      return col >= 0 && (!exits || exits.includes(col)) && water < (closeAt?.[col] ?? Infinity)
    })
  }

  function advanceWater(state, elapsedMs) {
    if (state.outcome) return state
    const pressureMs = Math.max(0, elapsedMs - (state.bonusMs ?? 0))
    const water = Math.min(MAX_WATER, START_WATER + Math.floor(pressureMs / (state.level.riseMs ?? RISE_MS)))
    if (water <= state.water) return state
    return { ...state, water, outcome: water === MAX_WATER ? 'flooded' : null }
  }

  function play(state, a, b) {
    const { level } = state
    const { cols } = level
    if (state.outcome || !state.board[a] || !state.board[b] || state.board[a] === state.board[b] ||
      !adjacent(a, b, level)) return null
    const swapped = swap(state.board, a, b)
    const cleared = matches(swapped, cols)
    if (!cleared.size) return null

    const board = swapped.slice()
    for (const index of cleared) board[index] = null

    const route = trace(board, level)
    const drains = outlets(route, level, state.water).length > 0
    let outcome = null
    if (drains) outcome = 'escaped'
    else if (!availableMove(board, level)) outcome = 'blocked'
    const bonusMs = level.closeAt && !outcome
      ? BONUS_MS * Math.min(MAX_BONUSES, Math.floor(route.length / BONUS_CELLS))
      : state.bonusMs ?? 0

    return {
      state: {
        level, board, water: drains ? 0 : state.water, route, outcome, bonusMs,
        ...(drains && level.closeAt ? { rescueWater: state.water } : {}),
      },
      swapped, cleared,
      longRuns: cleared.size >= 4 ? longRuns(swapped, level, a, b) : [],
    }
  }

  const puzzle = {
    MAX_WATER, FLOOD_MS, levelCount: levels.length, presets, deal,
    floodTime: ({ riseMs = RISE_MS }) => (MAX_WATER - START_WATER) * riseMs,
    matches, adjacent, advanceWater, play, outlets,
  }
  if (typeof module === 'object') module.exports = puzzle
  else globalThis.RescuePuzzle = puzzle
})()
