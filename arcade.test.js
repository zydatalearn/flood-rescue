const assert = require('node:assert/strict')
const { test } = require('node:test')
const m = require('./match3.js')
const depth = require('./descent.js')
const { mount } = require('./arcade.js')
const rescue = require('./scene.js')
const { dailyTasks, petProgress } = require('./challenge.js')

const put = (indices, color = 0) => {
  const board = Array(m.SIZE).fill(null)
  for (const i of indices) board[i] = m.tile(color)
  return board
}
const point = i => [38.5 + m.col(i) * 44, 243.5 + m.row(i) * 44]

test('three, both four directions, five, T and L follow priority and protect the new tile', () => {
  for (const [indices, kind] of [
    [[0, 1, 2], ''], [[0, 1, 2, 3], 'row'], [[0, 8, 16, 24], 'column'],
    [[0, 1, 2, 3, 4], 'rainbow'], [[0, 1, 2, 9, 17], 'bomb'], [[0, 8, 16, 17, 18], 'bomb'],
    [[0, 1, 2, 3, 4, 10, 18], 'rainbow'],
  ]) {
    const board = put(indices)
    const result = m.clearWave(board, m.lines(board), [indices[0]])
    assert.equal(result.cleared.size, indices.length - Number(Boolean(kind)))
    if (kind) {
      assert.equal(result.board[indices[0]].kind, kind)
      assert.ok(!result.cleared.has(indices[0]))
    }
  }
})

test('swaps enforce adjacency, frozen cells, and valid matches in both directions', () => {
  const horizontal = put([0, 1, 8])
  horizontal[9] = m.tile(1)
  horizontal[2] = m.tile(1)
  horizontal[10] = m.tile(0)
  assert.ok(m.exchange(horizontal, 2, 10))
  assert.equal(m.exchange(horizontal, 2, 10, i => i === 10), null)
  const vertical = put([0, 8, 17])
  vertical[16] = m.tile(1)
  assert.ok(m.exchange(vertical, 17, 16))
  assert.equal(m.exchange(vertical, 0, 17), null)
  assert.equal(m.exchange(vertical, 8, 16), null)
})

test('double stripes cross, rainbow converts same-color specials and all cells clear at most once', () => {
  const board = m.deal(m.seeded(18))
  board[26] = m.tile(2, 'row')
  board[27] = m.tile(2, 'row')
  const stripe = m.exchange(board, 26, 27)
  const cross = m.clearWave(stripe.swapped, [], [], stripe.pair)
  for (let i = 0; i < m.SIZE; i++) {
    if (m.row(i) === 3 || m.col(i) === 3) assert.ok(cross.cleared.has(i))
  }
  board[26] = m.tile(4, 'rainbow')
  board[27] = m.tile(1, 'bomb')
  const rainbow = m.exchange(board, 26, 27)
  const explosion = m.clearWave(rainbow.swapped, [], [], rainbow.pair)
  assert.ok(explosion.blasts.filter(blast => blast.kind === 'bomb').length > 2)
  assert.equal(explosion.impacted.size, explosion.cleared.size)
  assert.equal(explosion.board.filter(x => x === null).length, explosion.cleared.size)
})

test('refill drops several columns and a seeded round resolves eleven automatic waves', () => {
  const next = m.refill(put([0, 1, 41, 64]), m.seeded(3))
  assert.equal(next.falls.find(fall => fall.target === 56).distance, 7)
  assert.equal(next.falls.find(fall => fall.target === 65).fromRow, 5)
  assert.ok(next.falls.some(fall => fall.fromRow < 0))
  const seed = 874
  let board = m.deal(m.seeded(seed))
  board[0] = m.tile(0, 'rainbow')
  board[1] = m.tile(1, 'rainbow')
  let plan = m.exchange(board, 0, 1)
  let chain = 0
  const random = m.seeded(seed)
  while (plan && chain < m.MAX_CHAIN) {
    board = m.refill(m.clearWave(plan.swapped, plan.matches, plan.preferred, plan.pair).board, random).board
    const runs = m.lines(board)
    plan = runs.length ? { swapped: board, matches: runs } : null
    chain++
  }
  assert.equal(chain, 11)
  assert.equal(m.lines(board).length, 0)
})

test('opening anchors vary; dead board shuffle preserves tiles and pathological inventory recovers', () => {
  const moves = new Set()
  for (let i = 0; i < 80; i++) {
    const board = m.deal(m.seeded(i * 1009))
    assert.equal(m.lines(board).length, 0)
    moves.add(m.legalMove(board).join(','))
  }
  assert.ok(moves.size > 12)
  const board = Array.from({ length: m.SIZE }, (_, i) => m.tile((m.row(i) + m.col(i)) % 5))
  assert.equal(m.legalMove(board), null)
  const result = m.shuffle(board, () => 0)
  assert.equal(result.preserved, true)
  assert.equal(new Set(result.board).size, m.SIZE)
  for (const value of board) assert.ok(result.board.includes(value))
  assert.equal(m.lines(result.board).length, 0)
  assert.ok(m.legalMove(result.board))
  const pathological = m.shuffle(board.map(() => m.tile(0)), () => 0)
  assert.ok(m.legalMove(pathological.board))
  assert.equal(m.lines(pathological.board).length, 0)
})

test('terrain is independent, chain takes special damage and crystal gives a separate hit', () => {
  const layer = depth.layer(131, 32)
  assert.deepEqual(layer.ground, depth.layer(131, 32).ground)
  const ground = Array(m.SIZE).fill(null)
  ground[56] = { kind: 'chain', hp: 3, core: true }
  ground[57] = { kind: 'crystal', hp: 1, core: false }
  ground[58] = { kind: 'ice', hp: 2, core: true }
  const struck = depth.damage(ground, new Set([56, 57, 58]), new Set([56]))
  assert.equal(struck.ground[56], null)
  assert.equal(struck.ground[58], null)
  assert.equal(struck.complete, true)
  assert.equal(ground[56].hp, 3)
  assert.equal(m.refill(layer.board, m.seeded(1)).board.length, struck.ground.length)
  for (let floor = 1; floor <= 120; floor++) {
    const next = depth.layer(23, floor)
    assert.equal(next.ground.length, m.SIZE)
    assert.equal(next.depth, (floor - 1) * 4)
    assert.ok(m.legalMove(next.board, i => next.ground[i]?.kind === 'ice'))
    assert.ok(next.ground.filter(value => value?.core).length <= 5)
  }
})

function setup(t) {
  let now = 1000
  t.mock.method(Date, 'now', () => now)
  const frames = []
  const texts = []
  const saved = new Map()
  const canvas = { getContext: () => new Proxy({}, {
    get: (_, key) => key === 'createLinearGradient' ? () => ({ addColorStop() {} }) :
      key === 'fillText' ? value => texts.push(String(value)) : () => {},
  }) }
  const options = { width: 390, height: 806, pixelRatio: 1, random: () => 0.5,
    requestFrame: frame => frames.push(frame), reducedMotion: () => false,
    storage: { read: key => saved.get(key), write: (key, value) => saved.set(key, structuredClone(value)) },
  }
  const tick = (ms = 0) => { now += ms; for (const frame of frames.splice(0)) frame() }
  const drain = () => { for (let i = 0; frames.length && i < 200; i++) tick(350); assert.equal(frames.length, 0) }
  const swipe = (game, a, b) => { game.down(...point(a)); game.up(...point(b)) }
  const tap = (game, x, y) => { game.down(x, y); game.up(x, y) }
  return { canvas, options, saved, texts, tick, drain, swipe, tap }
}

test('classic buffers a swipe, rejects accidental reset and resumes the stable board', t => {
  const h = setup(t)
  const board = m.deal(m.seeded(183))
  const first = m.legalMove(board)
  let plan = m.exchange(board, ...first)
  let projected = board
  const random = m.seeded(87287)
  while (plan) {
    projected = m.refill(m.clearWave(plan.swapped, plan.matches, plan.preferred, plan.pair).board, random).board
    const runs = m.lines(projected)
    plan = runs.length ? { swapped: projected, matches: runs } : null
  }
  const second = m.legalMove(projected)
  const key = 'dog-classic-v1'
  h.saved.set(key, { checkpoint: { board, seed: 0, rng: 87287, score: 50, goal: 0, goalCount: 0, energy: 0, feverMs: 0 } })
  let left = false
  const game = mount(h.canvas, h.options, false, () => { left = true })
  t.after(() => game.setActive(false))
  h.tick()
  h.swipe(game, ...first)
  h.tick(60)
  h.swipe(game, ...second)
  h.drain()
  assert.notDeepEqual(h.saved.get(key).checkpoint.board, projected)
  game.key('Escape')
  h.tick(500)
  assert.ok(h.texts.includes('已暂停'))
  assert.equal(left, false)
  game.key('Escape')
  h.drain()
  const before = h.saved.get(key).checkpoint.score
  assert.ok(before > 50)
  game.key('r')
  h.tick()
  assert.ok(h.texts.includes('重新开始？'))
  game.key('Escape')
  h.tap(game, 77, 741)
  game.key('Enter')
  assert.equal(left, true)
  assert.equal(h.saved.get(key).checkpoint.score, before)
  const resumed = mount(h.canvas, h.options, false, () => {})
  t.after(() => resumed.setActive(false))
  h.tick()
  assert.equal(h.saved.get(key).checkpoint.score, before)
})

test('rescue outlet stays shut if rising water reaches the threshold during a clear', t => {
  const h = setup(t)
  let reducedMotion = true
  const game = rescue.mount(h.canvas, { ...h.options, random: () => 0, reducedMotion: () => reducedMotion })
  t.after(() => game.setActive(false))
  const puzzle = require('./puzzle.js')
  const swipe = (move, endless) => {
    const point = endless ? i => [37.5 + i % 10 * 35, 283 + Math.floor(i / 10) * 30] :
      i => [45 + i % 7 * 50, 358 + Math.floor(i / 7) * 47]
    game.down(...point(move[0]))
    game.up(...point(move[1]))
  }
  h.tick()
  game.key('Enter')
  h.tick()
  for (const move of puzzle.deal(0, () => 0).paths[0]) { swipe(move, false); h.tick(300) }
  game.key('Enter')
  h.tick()
  reducedMotion = false
  h.tick(22400)
  swipe(puzzle.deal(1, () => 0, undefined, 1).paths[0][0], true)
  h.tick(210)
  assert.ok(h.texts.includes('已关'))
  h.texts.length = 0
  h.tick(410)
  assert.ok(h.texts.includes('已关'))
})

test('deep mode resolves the last move before failure and checkpoints the next layer', t => {
  const h = setup(t)
  const board = m.deal(m.seeded(183))
  const move = m.legalMove(board)
  const plan = m.exchange(board, ...move)
  const at = [...m.clearWave(plan.swapped, plan.matches, plan.preferred).cleared][0]
  const ground = Array(m.SIZE).fill(null)
  ground[at] = { kind: 'soil', hp: 1, max: 1, core: true }
  const key = 'dog-descent-v1'
  h.saved.set(key, { checkpoint: { board, ground, seed: 20, rng: 31, score: 0, floor: 1, steps: 1 } })
  const game = mount(h.canvas, h.options, true, () => {})
  t.after(() => game.setActive(false))
  h.tick()
  h.swipe(game, ...move)
  h.drain()
  const state = h.saved.get(key).checkpoint
  assert.equal(state.floor, 2)
  assert.equal(h.saved.get(key).broken, 1)
  assert.ok(state.steps >= 5)
  assert.ok(h.texts.includes('第 2 层 · 4 米'))
  assert.ok(!h.texts.includes('步数用完了'))
})

test('floor six supply does not change the milestone or reopen after restoring it', t => {
  const h = setup(t)
  const key = 'dog-descent-v1'
  const board = m.deal(m.seeded(183))
  const move = m.legalMove(board)
  const plan = m.exchange(board, ...move)
  const cleared = m.clearWave(plan.swapped, plan.matches, plan.preferred).cleared
  const ground = Array(m.SIZE).fill(null)
  ground[[...cleared][0]] = { kind: 'soil', hp: 1, max: 1, core: true }
  h.saved.set(key, { checkpoint: { board, ground, seed: 20, rng: 31, score: 0, floor: 5, steps: 1 } })
  const game = mount(h.canvas, h.options, true, () => {})
  t.after(() => game.setActive(false))
  h.swipe(game, ...move)
  h.drain()
  const { checkpoint, milestone } = h.saved.get(key)
  assert.equal(milestone.floor, 6)
  assert.equal(checkpoint.reward, true)
  assert.equal(milestone.reward, false)
  h.tap(game, 195, 474)
  h.drain()
  assert.ok(h.saved.get(key).checkpoint.board.some(tile => tile.kind === 'rainbow'))
  assert.deepEqual(h.saved.get(key).milestone.board, milestone.board)

  // Restore a pre-fix milestone whose saved reward flag was still set.
  const lastMoveGround = Array(m.SIZE).fill({ kind: 'rock', hp: 3, max: 3, core: true })
  h.saved.set(key, { milestone: { ...milestone, reward: true },
    checkpoint: { ...milestone, steps: 1, board, ground: lastMoveGround } })
  game.setActive(false)
  const resumed = mount(h.canvas, h.options, true, () => {})
  t.after(() => resumed.setActive(false))
  h.swipe(resumed, ...move)
  h.drain()
  assert.equal(h.saved.get(key).checkpoint, null)
  h.tap(resumed, 195, 521)
  h.drain()
  assert.equal(h.saved.get(key).checkpoint.reward, false)
  assert.deepEqual(h.saved.get(key).checkpoint.board, milestone.board)
})

test('main menu switches both new modes, shared tasks reward once and rescue storage survives', t => {
  const h = setup(t)
  const game = rescue.mount(h.canvas, h.options)
  t.after(() => game.setActive(false))
  h.tick()
  game.key('m')
  h.tick()
  assert.ok(h.texts.includes('当前分数'))
  h.tap(game, 74, 742)
  game.key('Enter')
  h.tick()
  game.key('x')
  h.tick()
  assert.ok(h.texts.includes('第 1 层 · 0 米'))
  h.tap(game, 74, 742)
  game.key('Enter')
  h.tick()
  assert.ok(h.texts.includes('最深第 1 层'))
  assert.ok(!h.texts.includes('继续 · 第 1 层'))
  game.key('Enter')
  h.tick()
  assert.ok(h.texts.includes('00:55'))
  const goals = dailyTasks(h.options.storage).goals
  assert.equal(dailyTasks(h.options.storage, goals).treats, 2)
  assert.equal(dailyTasks(h.options.storage, goals).treats, 2)
  assert.equal(petProgress(h.options.storage, 1), 3)
})

test('opening the gallery acknowledges treat unlocks and viewing medals acknowledges medals separately', t => {
  const h = setup(t)
  const key = 'dog-rescue-record-v1'
  h.saved.set(key, { saves: 2, seenPets: 2, medals: [0] })
  const goals = dailyTasks(h.options.storage).goals
  dailyTasks(h.options.storage, goals)
  const game = rescue.mount(h.canvas, h.options)
  t.after(() => game.setActive(false))
  h.tick()
  h.tap(game, 195, 123)
  h.tick()
  assert.ok(h.texts.includes('战绩与小狗图鉴'))
  assert.equal(h.saved.get(key).seenPets, 4)
  assert.equal(h.saved.get(key).seenMedals, 0)
  h.tap(game, 185, 524)
  h.tick()
  assert.ok(h.texts.includes('勋章与配饰'))
  assert.equal(h.saved.get(key).seenMedals, 1)
})
