import { test } from './registry.mjs'
import { assert } from './lib.mjs'
import {
  createGame, addPlayer, addBot, dropPlayer, startGame, applyAction, tick,
  snapshotFor, results,
} from '../lib/the-banker/engine.js'
import { PHASES, A } from '../lib/the-banker/protocol.js'
import { makeTable, nextNow } from './helpers.mjs'

// Bots: solo shows, house robots, determinism. The human contestant ('p0')
// plays honestly while tick() drives the bots on their own clock.

const STEP = 250

function freeCases(state) {
  return Object.values(state.cases).filter(c => !c.opened && !c.owner)
}

// Advance virtual time in small steps; the human acts instantly, bots act
// when their seeded think-time elapses inside tick().
function drive(state, humanId, startAt) {
  let t = startAt
  let guard = 20000
  while (state.phase !== PHASES.GAMEOVER && guard-- > 0) {
    t += STEP
    if (state.phase === PHASES.OPENING && state.joinOrder[state.turnIndex] === humanId) {
      const free = freeCases(state)
      if (free.length) applyAction(state, humanId, { t: A.OPEN_CASE, caseId: free[0].id }, t)
    } else if (state.phase === PHASES.OFFER) {
      const off = state.offers[humanId]
      if (off && !off.answered) applyAction(state, humanId, { t: A.NO_DEAL }, t)
    } else if (state.phase === PHASES.TWIST) {
      const p = state.players[humanId]
      if (p?.twistPending && p.twistChoice == null) {
        applyAction(state, humanId, { t: A.TWIST_CHOICE, swap: false }, t)
      }
    }
    tick(state, t)
  }
  assert(guard > 0, 'drive() never reached gameover — bot clock stalled the show')
  return t
}

test('bots: seating works and names stay unique', () => {
  const { state } = makeTable(6, 3)
  const a = addBot(state)
  const b = addBot(state)
  assert(state.players[a.playerId].bot === true)
  assert.notEqual(a.playerId, b.playerId)
  assert.notEqual(state.players[a.playerId].name, state.players[b.playerId].name)
})

test('bots: the ninth seat is refused', () => {
  const { state } = makeTable(7, 5)
  addBot(state)
  assert.throws(() => addBot(state), /full/i)
})

test('bots: unseating works in the lobby, then the show starts solo', () => {
  const state = createGame({ code: 'KICK', seed: 1, now: 0 })
  addPlayer(state, 'p0', 'Ana', '🦊', nextNow())
  const bot = addBot(state)
  dropPlayer(state, bot.playerId)
  assert(!state.joinOrder.includes(bot.playerId))
  assert(!(bot.playerId in state.players))
  startGame(state, nextNow())
  assert.equal(state.phase, PHASES.PICKING)
})

test('solo: one contestant plays a complete show with no bots at all', () => {
  const state = createGame({ code: 'SOLO', seed: 42, now: 0 })
  addPlayer(state, 'p0', 'Solo', '🎩', nextNow())
  startGame(state, nextNow())
  applyAction(state, 'p0', { t: A.PICK_CASE, caseId: 5 }, nextNow())
  assert.equal(state.phase, PHASES.OPENING, 'solo picking completes instantly')

  let guard = 500
  while (state.phase !== PHASES.GAMEOVER && guard-- > 0) {
    if (state.phase === PHASES.OFFER) applyAction(state, 'p0', { t: A.NO_DEAL }, nextNow())
    else if (state.phase === PHASES.TWIST) {
      applyAction(state, 'p0', { t: A.TWIST_CHOICE, swap: false }, nextNow())
    } else if (state.phase === PHASES.OPENING) {
      const free = freeCases(state)
      if (!free.length) break
      applyAction(state, 'p0', { t: A.OPEN_CASE, caseId: free[0].id }, nextNow())
    }
  }
  assert.equal(state.phase, PHASES.GAMEOVER)
  assert.equal(state.endReason, 'boardEmpty')
  const res = results(state)
  assert.equal(res.leaderboard.length, 1)
  assert(res.leaderboard[0].final >= 1, 'solo finalist has a real value')
  assert.deepEqual(res.winnerIds, ['p0'])
})

test('bots: a lone human versus one robot plays to a full reveal', () => {
  const state = createGame({ code: 'DUEL', seed: 7, now: 0 })
  addPlayer(state, 'p0', 'Ana', '🦊', nextNow())
  const joined = addBot(state)
  const botId = joined.playerId
  startGame(state, nextNow())
  applyAction(state, 'p0', { t: A.PICK_CASE, caseId: 3 }, nextNow())

  drive(state, 'p0', 1000)

  assert.equal(state.phase, PHASES.GAMEOVER)
  assert(Object.values(state.cases).some(c => c.openedBy === botId),
    'the bot opened cases on its own turns')
  const res = results(state)
  assert.equal(res.leaderboard.length, 2)
  const snap = snapshotFor(state, 'p0')
  assert(snap.players.find(p => p.id === botId)?.bot === true,
    'snapshots flag the bot so UIs can badge it')
})

test('bots: they answer offers on their own judgment, not silence', () => {
  const state = createGame({ code: 'JUDGE', seed: 21, now: 0 })
  addPlayer(state, 'p0', 'Ana', '🦊', nextNow())
  addBot(state)
  startGame(state, nextNow())
  applyAction(state, 'p0', { t: A.PICK_CASE, caseId: 8 }, nextNow())
  drive(state, 'p0', 1000)
  assert.equal(state.phase, PHASES.GAMEOVER)
})

test('bots: same seed replays an identical solo-vs-bot show', () => {
  const run = () => {
    const state = createGame({ code: 'DET', seed: 99, now: 0 })
    addPlayer(state, 'p0', 'Ana', '🦊', nextNow())
    addBot(state)
    startGame(state, nextNow())
    applyAction(state, 'p0', { t: A.PICK_CASE, caseId: 3 }, nextNow())
    drive(state, 'p0', 1000)
    return results(state).leaderboard.map(r => [r.playerId, r.final, r.dealt])
  }
  assert.deepEqual(run(), run())
})

test('bots: a full robot audience runs the show without any humans', () => {
  const state = createGame({ code: 'ROBO', seed: 4, now: 0 })
  for (let i = 0; i < 3; i++) addBot(state)
  startGame(state, nextNow())
  let t = 1000
  let guard = 20000
  while (state.phase !== PHASES.GAMEOVER && guard-- > 0) {
    t += STEP
    tick(state, t)
  }
  assert.equal(state.phase, PHASES.GAMEOVER, 'bots finish their own show')
  assert.equal(results(state).leaderboard.length, 3)
})
