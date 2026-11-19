const assert = require('node:assert/strict')
const { test } = require('node:test')
const { deal, presets, advanceWater, play, matches, outlets, levelCount } = require('./puzzle.js')
const { mount } = require('./scene.js')

const start = (index = 0) => presets(index)[0].state
const starterPath = presets(0)[0].paths[0]

function turn(state, from, to) {
  const result = play(state, from, to)
  assert.ok(result)
  assert.equal(matches(result.state.board, state.level.cols).size, 0)
  assert.equal(result.state.water, result.state.outcome === 'escaped' ? 0 : state.water)
  for (const [index, tile] of state.board.entries()) {
    if (result.cleared.has(index) || tile === null) assert.equal(result.state.board[index], null)
    else if (index !== from && index !== to) assert.equal(result.state.board[index], tile)
  }
  return result.state
}

test('an invalid swap leaves the opening board and water intact', () => {
  const state = start()
  assert.equal(matches(state.board).size, 0)
  assert.equal(play(state, 0, 6), null)
  assert.equal(play(state, 6, 7), null)
  assert.deepEqual(state, start())
})

test('water follows the cleared cells and drains only after the route reaches the bottom', () => {
  const partial = turn(start(), ...starterPath[0])
  assert.deepEqual(partial.route.map(segment => segment.cell), [3, 10, 17])
  assert.deepEqual(outlets(partial.route), [])
  assert.equal(partial.water, 1)

  const rescued = starterPath.slice(1).reduce((state, move) => turn(state, ...move), partial)
  const path = rescued.route.map(({ cell, from }) => [cell, from])
  assert.deepEqual(path, [[3, -1], [10, 3], [17, 10], [24, 17], [31, 24], [38, 31], [45, 38], [52, 45], [59, 52]])
  assert.deepEqual(outlets(rescued.route), [59])
  assert.deepEqual([rescued.water, rescued.outcome], [0, 'escaped'])
  assert.equal(play(rescued, 1, 7), null)
})

test('cleared cells below a gap stay dry and join the route when the gap is connected', () => {
  const initial = start()
  const bottomMove = starterPath.at(-1)
  const bottom = turn(initial, ...bottomMove)
  assert.notDeepEqual(bottom.board, turn(initial, ...starterPath[0]).board)
  assert.deepEqual(bottom, turn(start(), ...bottomMove))
  assert.deepEqual([bottom.board[45], bottom.board[52], bottom.board[59]], [null, null, null])
  assert.equal(play(bottom, ...bottomMove), null)
  assert.deepEqual(bottom.route, [])
  assert.equal(bottom.water, 1)
  const linked = starterPath.slice(0, -1).reduce((state, move) => turn(state, ...move), bottom)
  assert.deepEqual(outlets(linked.route), [59])
  assert.deepEqual([linked.water, linked.outcome], [0, 'escaped'])
})

test('elapsed seconds set the water level and give the rescue exactly 55 seconds', () => {
  for (const level of [0, 1]) {
    const initial = start(level)
    assert.equal(initial.water, 1)
    assert.equal(advanceWater(initial, 4999), initial)
    assert.equal(advanceWater(initial, 5000).water, 2)
    const almost = advanceWater(initial, 54999)
    assert.equal(almost.water, 11)
    assert.equal(almost.outcome, null)
    const flooded = advanceWater(almost, 55000)
    assert.deepEqual([flooded.water, flooded.outcome], [12, 'flooded'])
    assert.equal(advanceWater(flooded, 60000), flooded)
  }
})

test('a second swipe during the clear animation runs after the board settles', t => {
  let now = 1000
  t.mock.method(Date, 'now', () => now)
  const frames = []
  const announcements = []
  const context = new Proxy({}, {
    get: (_, key) => key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {},
  })
  const game = mount({ getContext: () => context }, {
    width: 390, height: 806, pixelRatio: 1,
    random: () => 0,
    requestFrame: frame => frames.push(frame),
    announce: message => announcements.push(message),
  })
  t.after(() => game.setActive(false))
  const tick = ms => {
    now += ms
    assert.equal(frames.length, 1)
    frames.shift()()
  }

  const swipe = ([from, to]) => {
    const coordinates = index => [63 + index % 7 * 44, 387 + Math.floor(index / 7) * 44]
    game.down(...coordinates(from))
    game.up(...coordinates(to))
  }
  const moves = deal(0, () => 0).paths[0]
  tick(0)
  swipe(moves[0])
  tick(145)
  swipe(moves[1])
  tick(95)
  assert.match(announcements[0], /流进棋盘.*水位 1/)
  tick(250)
  assert.match(announcements[1], /流进棋盘.*水位 1/)
  swipe(moves[2])
  tick(700)
  assert.match(announcements[2], /脱险.*水位 0/)
  assert.equal(frames.length, 0)
})

function replay({ state, paths }, index) {
  const { cols, rows, exits } = state.level
  assert.deepEqual([cols, rows], index === 0 ? [7, 9] : [9, 12])
  assert.equal(state.board.length, cols * rows)
  assert.equal(matches(state.board, cols).size, 0)
  assert.equal(paths.length, exits?.length || 1)
  return paths.map((path, port) => {
    assert.ok(index === 0 ? path.length === 3 : path.length >= 5)
    const won = path.reduce((position, move) => turn(position, ...move), state)
    assert.equal(won.outcome, 'escaped')
    if (exits) assert.deepEqual(outlets(won.route, won.level), [(rows - 1) * cols + exits[port]])
    return won
  })
}

test('every fallback board has a valid path to each planned outlet', () => {
  assert.equal(levelCount, 2)
  for (const level of [0, 1]) for (const board of presets(level)) replay(board, level)
  const first = deal(1, () => 0)
  const second = deal(1, () => 0, first.state)
  assert.equal(first.generated, false)
  assert.equal(second.generated, false)
  assert.notDeepEqual(first.state.board, second.state.board)
})

test('random openings vary in layout and every returned solution can be replayed', () => {
  let seed = 20261119
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32)
  for (const level of [0, 1]) {
    const shapes = new Set()
    let previous
    let generated = 0
    for (let i = 0; i < 100; i++) {
      const board = deal(level, random, previous)
      const [won] = replay(board, level)
      assert.notDeepEqual(board.state.board, previous?.board)
      previous = board.state
      if (!board.generated) continue
      generated++
      const { cols, entry } = won.level
      const bend = won.route.find(({ cell, from }) => from >= 0 && Math.abs(cell - from) === 1)
      shapes.add(`${entry}/${bend && Math.floor(bend.cell / cols)}`)
    }
    assert.ok(generated >= 90)
    assert.ok(shapes.size >= 6)
  }
})
test('a settled board is blocked exactly when no adjacent swap makes a match', () => {
  let blocked = 0
  for (const { state } of [...presets(0), ...presets(1)]) {
    let position = state
    while (!position.outcome) {
      const { cols } = position.level
      const board = position.board
      let move
      for (let a = 0; a < board.length && !move; a++) {
        for (const b of [a + 1, a + cols]) {
          if (b === a + 1 && b % cols === 0) continue
          if (!board[a] || !board[b] || board[a] === board[b]) continue
          const trial = board.slice()
          trial[a] = board[b]
          trial[b] = board[a]
          if (matches(trial, cols).size) {
            move = [a, b]
            break
          }
        }
      }
      assert.ok(move, 'a live board must still have a legal swap')
      position = turn(position, ...move)
      if (position.outcome === 'blocked') {
        blocked++
        for (let a = 0; a < board.length; a++) {
          for (const b of [a + 1, a + cols]) {
            assert.equal(play({ ...position, outcome: null }, a, b), null)
          }
        }
      }
    }
  }
  assert.ok(blocked > 0)
})
