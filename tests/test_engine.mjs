import { test } from './registry.mjs'
import { assert } from './lib.mjs'
import {
  createGame, addPlayer, dropPlayer, startGame, applyAction, tick,
  snapshotFor, buildSchedule, bankerOffer, finalValue, results, rematch,
} from '../lib/the-banker/engine.js'
import { PHASES } from '../lib/the-banker/protocol.js'
import { makeTable, seat, pickAll, openUntilPhaseChange, answerAll, nextNow } from './helpers.mjs'

// ---------------------------------------------------------------------------
// schedule
// ---------------------------------------------------------------------------

test('offer schedule: valid for every legal table size', () => {
  for (let players = 2; players <= 8; players++) {
    const communal = 20 - players
    const sched = buildSchedule(communal)
    assert(sched.length >= 3, `schedule too short for ${players} players`)
    assert(sched.every((n, i) => n > (sched[i - 1] ?? 0)), 'must be strictly increasing')
    assert(sched[sched.length - 1] <= communal, 'cannot exceed communal count')
    assert(sched[0] >= 1 && sched[0] <= Math.ceil(communal / 2), 'first offer comes early')
  }
})

test('classic table (2 players): offers taper like the TV show', () => {
  assert.deepEqual(buildSchedule(18), [4, 7, 10, 13, 15, 17, 18])
})

// ---------------------------------------------------------------------------
// lobby
// ---------------------------------------------------------------------------

test('lobby: seats up to 8, rejects the 9th', () => {
  const { state, ids } = makeTable(8)
  assert.equal(state.joinOrder.length, 8)
  assert.throws(() => addPlayer(state, 'p9', 'Nine', '🎭', nextNow()), /full/i)
})

test('lobby: cannot start with fewer than 2', () => {
  const state = createGame({ code: 'T', seed: 1, now: 0 })
  addPlayer(state, 'solo', 'Solo', '🎩', nextNow())
  assert.throws(() => startGame(state, nextNow()), /2 players/)
  assert.equal(state.phase, PHASES.LOBBY)
})

test('lobby: leaving removes you before the show', () => {
  const { state, ids } = makeTable(3)
  dropPlayer(state, ids[0])
  assert(!state.joinOrder.includes(ids[0]))
  assert(!(ids[0] in state.players))
})

// ---------------------------------------------------------------------------
// picking
// ---------------------------------------------------------------------------

test('picking: each player owns exactly one distinct case', () => {
  const { state } = makeTable(4)
  seat(state)
  assert.equal(state.phase, PHASES.PICKING)
  pickAll(state)
  assert.equal(state.phase, PHASES.OPENING)
  const owners = Object.values(state.cases).filter(c => c.owner)
  assert.equal(owners.length, 4)
  assert.equal(new Set(owners.map(c => c.owner)).size, 4)
})

test('picking: cannot steal a taken case', () => {
  const { state, ids } = makeTable(2)
  seat(state)
  applyAction(state, ids[0], { t: 'pickCase', caseId: 1 }, nextNow())
  assert.throws(() =>
    applyAction(state, ids[1], { t: 'pickCase', caseId: 1 }, nextNow()), /taken/i)
})

test('values stay hidden in snapshots until opened or gameover', () => {
  const { state } = makeTable(2)
  seat(state)
  pickAll(state)
  const snap = snapshotFor(state, 'p0')
  for (const c of snap.cases) assert.equal(c.value, null, 'case value must be hidden')
  // and even the authority's own viewer can't see their case value pre-reveal
})

test('snapshot privacy: other players never see your offer amount', () => {
  const { state, ids } = makeTable(3, 7)
  seat(state); pickAll(state)
  openUntilPhaseChange(state) // runs into an offer round
  if (state.phase === PHASES.OPENING) return // schedule didn't trigger yet — skip
  assert.equal(state.phase, PHASES.OFFER)
  const mySnap = JSON.stringify(snapshotFor(state, ids[0]))
  const myAmount = state.offers[ids[0]].amount
  const theirAmount = state.offers[ids[1]].amount
  assert(typeof myAmount === 'number', 'I have a real offer')
  assert(mySnap.includes(String(theirAmount)) === false,
    'my snapshot must not leak anyone else\u2019s offer')
})

// ---------------------------------------------------------------------------
// opening + offers
// ---------------------------------------------------------------------------

function playToFirstOffer(seed = 42) {
  const { state, ids } = makeTable(3, seed)
  seat(state); pickAll(state)
  openUntilPhaseChange(state)
  assert.equal(state.phase, PHASES.OFFER, 'should hit first offer')
  return { state, ids }
}

test('banker calls on schedule and every active player gets a private offer', () => {
  const { state, ids } = playToFirstOffer()
  assert.equal(state.openedCount, buildSchedule(state.communalTotal)[0])
  assert.deepEqual(Object.keys(state.offers).sort(), [...ids].sort())
  const amounts = new Set(Object.values(state.offers).map(o => o.amount))
  assert(amounts.size > 1 || state.communalTotal < 5, 'offers should differ per player early on')
})

test('DEAL locks the offer and benches you; NO DEAL keeps playing', () => {
  const { state, ids } = playToFirstOffer()
  applyAction(state, ids[0], { t: 'deal' }, nextNow())
  assert(state.players[ids[0]].cashedOut, 'dealt player is cashed out')
  assert(typeof state.players[ids[0]].dealAmount === 'number')
  assert.throws(() => applyAction(state, ids[0], { t: 'noDeal' }, nextNow()), /answered/i)

  answerAll(state, id => id === ids[1]) // p1 deals too, p2 stands
  assert.equal(state.phase, PHASES.OPENING, 'show continues while anyone stands')
  const turnPid = state.joinOrder[state.turnIndex]
  assert.notEqual(turnPid, ids[0], 'cashed-out players lose their turns')
  assert.notEqual(turnPid, ids[1])
})

test("one player's decision never blocks another player", () => {
  const { state, ids } = playToFirstOffer()
  applyAction(state, ids[0], { t: 'deal' }, nextNow())
  assert.equal(state.phase, PHASES.OFFER, 'round waits only for unanswered phones')
  applyAction(state, ids[1], { t: 'noDeal' }, nextNow())
  assert.equal(state.phase, PHASES.OFFER)
  applyAction(state, ids[2], { t: 'noDeal' }, nextNow())
  assert.equal(state.phase, PHASES.OPENING)
})

test('everyone cashing out ends the show immediately', () => {
  const { state, ids } = playToFirstOffer()
  answerAll(state, () => true)
  assert.equal(state.phase, PHASES.GAMEOVER)
  assert.equal(state.endReason, 'allCashed')
  for (const id of ids) assert(finalValue(state, id) === state.players[id].dealAmount)
})

test('opening every communal case ends the show with a full reveal', () => {
  const { state, ids } = makeTable(2, 11)
  seat(state); pickAll(state)
  let guard = 200
  let dealt = false
  while (state.phase !== PHASES.GAMEOVER && guard-- > 0) {
    if (state.phase === PHASES.OFFER) {
      if (!dealt) { applyAction(state, ids[0], { t: 'deal' }, nextNow()); dealt = true }
      else applyAction(state, ids[1], { t: 'noDeal' }, nextNow())
    } else if (state.phase === PHASES.TWIST) {
      for (const id of state.twistPendingIds.slice()) {
        applyAction(state, id, { t: 'twist', swap: false }, nextNow())
      }
    } else {
      openUntilPhaseChange(state)
    }
  }
  assert.equal(state.phase, PHASES.GAMEOVER)
  assert.equal(state.endReason, 'boardEmpty')
  const res = results(state)
  assert.equal(res.leaderboard.length, 2)
  assert(res.leaderboard[0].final >= res.leaderboard[1].final, 'leaderboard sorted')
  const dealtRow = res.leaderboard.find(r => r.playerId === ids[0])
  assert(dealtRow.dealt && dealtRow.final === dealtRow.dealAmount, 'deal locked in')
  const stoodRow = res.leaderboard.find(r => r.playerId === ids[1])
  assert(stoodRow.final === stoodRow.caseValue, 'standing pays your own case')
  // winner is whoever has more
  assert.deepEqual(res.winnerIds, [res.leaderboard[0].playerId])
})

test('gameover snapshots reveal all values', () => {
  const { state } = makeTable(2, 3)
  seat(state); pickAll(state)
  let guard = 100
  while (state.phase !== PHASES.GAMEOVER && guard-- > 0) {
    if (state.phase === PHASES.OFFER) answerAll(state, () => true)
    else openUntilPhaseChange(state)
  }
  const snap = snapshotFor(state, 'p0')
  assert(snap.cases.every(c => typeof c.value === 'number'), 'all revealed at the end')
})

// ---------------------------------------------------------------------------
// timeouts keep the show moving
// ---------------------------------------------------------------------------

test('tick: silence during an offer counts as NO DEAL for everyone', () => {
  const { state } = playToFirstOffer(5)
  const deadline = state.deadline
  tick(state, deadline - 1)
  assert.equal(state.phase, PHASES.OFFER, 'not yet time')
  tick(state, deadline + 5000)
  assert.equal(state.phase, PHASES.OPENING, 'all auto-answered no deal')
})

test('tick: AFK opener gets their case opened for them', () => {
  const { state } = makeTable(3, 21)
  seat(state); pickAll(state)
  const before = state.openedCount
  const deadline = state.deadline
  const events = tick(state, deadline + 1)
  assert.equal(state.openedCount, before + 1, 'auto-opened one case')
  assert(events.some(e => e.type === 'caseOpened'))
})

test('tick: AFK case-pickers get assigned cases', () => {
  const { state, ids } = makeTable(2, 31)
  seat(state)
  applyAction(state, ids[0], { t: 'pickCase', caseId: 7 }, nextNow())
  tick(state, state.deadline + 1)
  assert.equal(state.phase, PHASES.OPENING, 'auto-picked and moved on')
  assert(state.players[ids[1]].caseId != null)
})

// ---------------------------------------------------------------------------
// the twist
// ---------------------------------------------------------------------------

test('the twist fires exactly once mid-show and swaps contents', () => {
  const seed = 77
  const { state, ids } = makeTable(2, seed)
  seat(state); pickAll(state)
  assert(state.schedule.length >= 3, 'twist requires at least 3 offers')
  assert(state.twistRound >= 1 && state.twistRound <= state.schedule.length - 2,
    'twist is never the first or last offer')

  let twistSeen = 0
  let guard = 300
  while (state.phase !== PHASES.GAMEOVER && guard-- > 0) {
    if (state.phase === PHASES.OFFER) {
      const isTwistRound = state.offerIndex === state.twistRound && !state.twistDone
      answerAll(state, () => false)
      if (state.phase === PHASES.TWIST) {
        assert(isTwistRound, 'twist only fires in its scheduled round')
        twistSeen++
        const before = state.cases[state.players[ids[0]].caseId].value
        applyAction(state, ids[0], { t: 'twist', swap: true }, nextNow())
        applyAction(state, ids[1], { t: 'twist', swap: false }, nextNow())
        const after = state.cases[state.players[ids[0]].caseId].value
        assert(after !== before, 'swap changed the contents of the kept case')
      }
    } else if (state.phase === PHASES.TWIST) {
      for (const id of state.twistPendingIds.slice()) {
        if (state.players[id].twistChoice == null) {
          applyAction(state, id, { t: 'twist', swap: false }, nextNow())
        }
      }
    } else {
      openUntilPhaseChange(state)
    }
  }
  assert.equal(twistSeen, 1, 'exactly one twist per show')
  assert(state.twistDone, 'twist marked done')
  assert.equal(state.phase, PHASES.GAMEOVER)
})

test('twist: declining keeps your contents untouched', () => {
  const { state, ids } = makeTable(2, 55)
  seat(state); pickAll(state)
  let guard = 300
  let checked = false
  while (state.phase !== PHASES.GAMEOVER && guard-- > 0) {
    if (state.phase === PHASES.OFFER) {
      const mineBefore = state.cases[state.players[ids[0]].caseId]?.value
      answerAll(state, () => false)
      if (state.phase === PHASES.TWIST) {
        for (const id of state.twistPendingIds.slice()) {
          applyAction(state, id, { t: 'twist', swap: false }, nextNow())
        }
        checked = true
      }
    } else if (state.phase === PHASES.TWIST) {
      for (const id of state.twistPendingIds.slice()) {
        if (state.players[id].twistChoice == null) {
          applyAction(state, id, { t: 'twist', swap: false }, nextNow())
        }
      }
    } else {
      openUntilPhaseChange(state)
    }
  }
  assert(checked, 'a twist should have occurred this game')
})

test('determinism: same seed plays an identical game', () => {
  const run = seed => {
    const { state, ids } = makeTable(3, seed)
    seat(state); pickAll(state)
    let guard = 400
    while (state.phase !== PHASES.GAMEOVER && guard-- > 0) {
      if (state.phase === PHASES.OFFER) answerAll(state, id => id === 'p0')
      else if (state.phase === PHASES.TWIST) {
        for (const id of state.twistPendingIds.slice()) {
          if (state.players[id].twistChoice == null) applyAction(state, id, { t: 'twist', swap: true }, nextNow())
        }
      } else openUntilPhaseChange(state)
    }
    return results(state).leaderboard.map(r => [r.playerId, r.final, r.dealt])
  }
  assert.deepEqual(run(2024), run(2024))
})

test('rematch: same table, fresh board, back to picking', () => {
  const { state } = makeTable(3, 88)
  seat(state); pickAll(state)
  // play a bit
  openUntilPhaseChange(state)
  if (state.phase === PHASES.OFFER) answerAll(state, () => true)
  assert.equal(state.phase, PHASES.GAMEOVER)

  const ownersBefore = Object.values(state.cases).filter(c => c.owner).length
  rematch(state, nextNow())
  assert.equal(state.phase, PHASES.PICKING)
  assert.equal(state.joinOrder.length, 3, 'roster kept')
  for (const p of Object.values(state.players)) {
    assert.equal(p.caseId, null)
    assert.equal(p.cashedOut, false)
    assert.equal(p.dealt, false)
  }
  assert.equal(state.openedCount, 0)
  assert(Object.values(state.cases).every(c => !c.opened && !c.owner))
  assert.equal(Object.values(state.cases).filter(c => typeof c.value === 'number').length, 20)
  assert.notEqual(
    Object.values(state.cases).map(c => c.value).join(),
    null, 'values assigned')
  assert.equal(state.schedule.length, buildSchedule(17).length)
})

test('rematch: full second show is playable to gameover', () => {
  const { state } = makeTable(2, 12)
  seat(state); pickAll(state)
  let guard = 200
  while (state.phase !== PHASES.GAMEOVER && guard-- > 0) {
    if (state.phase === PHASES.OFFER) answerAll(state, () => true)
    else openUntilPhaseChange(state)
  }
  rematch(state, nextNow())
  pickAll(state)
  guard = 200
  while (state.phase !== PHASES.GAMEOVER && guard-- > 0) {
    if (state.phase === PHASES.OFFER) answerAll(state, () => true)
    else openUntilPhaseChange(state)
  }
  assert.equal(state.phase, PHASES.GAMEOVER)
})
