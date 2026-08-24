// THE BANKER — authoritative game state machine.
//
// Runs on the authority (the dedicated server in WS mode, otherwise the TV
// tab acting as host). Clients never mutate state; they send ACTIONS and
// receive privacy-filtered SNAPSHOTS plus broadcast EVENTS.
//
// Pure-ish: all randomness flows from one seeded rng, all timing decisions go
// through explicit `now` arguments, so games replay deterministically and are
// unit-testable in Node.

import { PRIZES, CASE_COUNT } from './prizes.js'
import { makeRng } from './rng.js'
import { PHASES, A, E, TIMINGS } from './protocol.js'

const MIN_PLAYERS = 2
const MAX_PLAYERS = 8

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

export function createGame({ code, seed, now }) {
  const rng = makeRng(seed ?? 1)
  const values = rng.shuffle(PRIZES)
  const cases = {}
  for (let i = 0; i < CASE_COUNT; i++) {
    cases[i + 1] = {
      id: i + 1,
      value: values[i],
      owner: null,     // playerId holding this case as their own
      opened: false,
      openedBy: null,  // playerId who opened it
    }
  }
  return {
    code,
    createdAt: now,
    phase: PHASES.LOBBY,
    rng,
    players: {},        // id -> player
    joinOrder: [],      // playerIds in join order == turn order
    cases,
    openedCount: 0,
    communalTotal: CASE_COUNT, // recomputed at start (20 - players)
    schedule: [],       // ascending openedCounts that trigger an offer round
    offerIndex: 0,
    twistRound: -1,     // which offer index carries the one-time twist
    twistDone: false,
    twistPendingIds: [],
    offers: {},         // playerId -> {amount, deadline, answered, choice}
    turnIndex: 0,
    deadline: 0,
    log: [],
  }
}

// Same table, fresh board: keep every seated player connected and jump
// straight back to case-picking. Used by the TV's PLAY AGAIN button.
export function rematch(state, now) {
  if (state.joinOrder.length < MIN_PLAYERS) throw new Error('Not enough players for a rematch')
  const values = state.rng.shuffle(PRIZES)
  for (let i = 0; i < CASE_COUNT; i++) {
    const c = state.cases[i + 1]
    c.value = values[i]
    c.owner = null
    c.opened = false
    c.openedBy = null
  }
  for (const p of Object.values(state.players)) {
    p.caseId = null
    p.cashedOut = false
    p.dealt = false
    p.dealAmount = null
    p.twistPending = false
    p.twistChoice = null
  }
  state.joinOrder = state.joinOrder.filter(id => state.players[id])
  state.openedCount = 0
  state.communalTotal = CASE_COUNT - state.joinOrder.length
  state.schedule = buildSchedule(state.communalTotal)
  state.offerIndex = 0
  state.twistRound = state.schedule.length >= 3
    ? state.rng.int(1, state.schedule.length - 2)
    : -1
  state.twistDone = false
  state.twistPendingIds = []
  state.offers = {}
  state.turnIndex = 0
  state.phase = PHASES.PICKING
  state.deadline = now + TIMINGS.PICK_MS
  state.log = []
  return [emit(state, E.STARTED, { players: state.joinOrder.length })]
}

function emit(state, type, data = {}) {
  const e = { type, ...data }
  state.log.push(e)
  if (state.log.length > 60) state.log.splice(0, state.log.length - 60)
  return e
}

// ---------------------------------------------------------------------------
// lobby
// ---------------------------------------------------------------------------

export function addPlayer(state, id, name, avatar, now) {
  if (state.phase !== PHASES.LOBBY) throw new Error('Game already started')
  if (state.players[id]) {
    const p = state.players[id]
    p.name = name
    p.avatar = avatar
    p.connected = true
    return emit(state, E.JOINED, { playerId: id })
  }
  if (state.joinOrder.length >= MAX_PLAYERS) throw new Error('Show is full (8 max)')
  state.players[id] = {
    id,
    name: String(name || 'Guest').slice(0, 20),
    avatar: String(avatar || '🎭').slice(0, 8),
    connected: true,
    caseId: null,
    cashedOut: false,
    dealt: false,
    dealAmount: null,
    twistPending: false,
  }
  state.joinOrder.push(id)
  return emit(state, E.JOINED, { playerId: id })
}

export function dropPlayer(state, id) {
  const p = state.players[id]
  if (!p) return []
  p.connected = false
  if (state.phase === PHASES.LOBBY) {
    delete state.players[id]
    state.joinOrder = state.joinOrder.filter(x => x !== id)
  }
  return [emit(state, E.LEFT, { playerId: id })]
}

export function startGame(state, now) {
  if (state.phase !== PHASES.LOBBY) throw new Error('Already started')
  const seated = state.joinOrder.filter(id => state.players[id])
  if (seated.length < MIN_PLAYERS) throw new Error(`Need ${MIN_PLAYERS} players minimum`)
  state.joinOrder = seated
  state.communalTotal = CASE_COUNT - seated.length
  state.schedule = buildSchedule(state.communalTotal)
  state.twistRound = state.schedule.length >= 3
    ? state.rng.int(1, state.schedule.length - 2) // never the first or last offer
    : -1
  for (const id of seated) state.players[id].caseId = null
  state.phase = PHASES.PICKING
  state.deadline = now + TIMINGS.PICK_MS
  return [emit(state, E.STARTED, { players: seated.length })]
}

// Openings between banker calls tighten as the board drains (classic rhythm):
// roughly quarters first, single openings near the end.
export function buildSchedule(communal) {
  const fractions = [0.22, 0.18, 0.16, 0.14, 0.12, 0.10, 0.08]
  const sched = []
  let acc = 0
  for (const f of fractions) {
    acc += Math.max(1, Math.round(communal * f))
    if (acc >= communal) { sched.push(communal); break }
    sched.push(acc)
  }
  return [...new Set(sched)].filter(n => n >= 1 && n <= communal)
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

export function applyAction(state, playerId, action, now) {
  switch (action.t) {
    case A.PICK_CASE: return actPickCase(state, playerId, action, now)
    case A.OPEN_CASE: return actOpenCase(state, playerId, action, now)
    case A.DEAL: return actAnswer(state, playerId, true, now)
    case A.NO_DEAL: return actAnswer(state, playerId, false, now)
    case A.TWIST_CHOICE: return actTwist(state, playerId, action, now)
    default: throw new Error(`Unknown action ${action.t}`)
  }
}

function requireTurn(state, playerId) {
  const cur = state.joinOrder[state.turnIndex]
  if (cur !== playerId) throw new Error('Not your turn')
}

function actPickCase(state, playerId, action, now) {
  if (state.phase !== PHASES.PICKING) throw new Error('Not picking right now')
  const p = state.players[playerId]
  if (!p) throw new Error('Join first')
  if (p.caseId != null) throw new Error('You already picked a case')
  const c = state.cases[action.caseId]
  if (!c) throw new Error('No such case')
  if (c.owner) throw new Error('Case already taken')
  c.owner = playerId
  p.caseId = c.id
  const events = [emit(state, E.CASE_PICKED, { playerId, caseId: c.id })]
  const unpicked = state.joinOrder.filter(id => state.players[id]?.caseId == null)
  if (unpicked.length === 0) beginOpening(state, now, events)
  return events
}

function beginOpening(state, now, events) {
  state.phase = PHASES.OPENING
  state.turnIndex = 0
  skipInactive(state)
  state.deadline = now + TIMINGS.TURN_MS
  events.push(emit(state, E.TURN, { playerId: state.joinOrder[state.turnIndex] }))
}

function activePlayers(state) {
  return state.joinOrder.filter(id => state.players[id] && !state.players[id].cashedOut)
}

function skipInactive(state) {
  while (
    state.turnIndex < state.joinOrder.length &&
    (!state.players[state.joinOrder[state.turnIndex]] ||
      state.players[state.joinOrder[state.turnIndex]].cashedOut ||
      !state.players[state.joinOrder[state.turnIndex]].connected)
  ) state.turnIndex++
}

function unopenedCommunal(state) {
  return Object.values(state.cases).filter(c => !c.opened && !c.owner)
}

function actOpenCase(state, playerId, action, now) {
  if (state.phase !== PHASES.OPENING) throw new Error('Not opening right now')
  requireTurn(state, playerId)
  const c = state.cases[action.caseId]
  if (!c) throw new Error('No such case')
  if (c.opened) throw new Error('Case already opened')
  if (c.owner) throw new Error('You cannot open your own case')
  c.opened = true
  c.openedBy = playerId
  state.openedCount++
  const events = [emit(state, E.CASE_OPENED, {
    caseId: c.id,
    value: c.value,
    openedBy: playerId,
  })]

  // Banker call milestone?
  if (state.offerIndex < state.schedule.length &&
      state.openedCount === state.schedule[state.offerIndex]) {
    openOfferRound(state, now, events)
    return events
  }

  if (unopenedCommunal(state).length === 0) {
    finishGame(state, 'boardEmpty', events)
    return events
  }

  advanceTurn(state, now, events)
  return events
}

function advanceTurn(state, now, events) {
  state.turnIndex++
  skipInactive(state)
  if (state.turnIndex >= state.joinOrder.length) state.turnIndex = 0
  skipInactive(state)
  if (activePlayers(state).length === 0) {
    finishGame(state, 'allCashed', events)
    return
  }
  state.deadline = now + TIMINGS.TURN_MS
  events.push(emit(state, E.TURN, { playerId: state.joinOrder[state.turnIndex] }))
}

// ---------------------------------------------------------------------------
// banker offers (one private offer per active player)
// ---------------------------------------------------------------------------

function roundOffer(x) {
  if (x < 1000) return Math.max(1, Math.round(x / 10) * 10)
  if (x < 10000) return Math.round(x / 50) * 50
  if (x < 100000) return Math.round(x / 500) * 500
  return Math.round(x / 5000) * 5000
}

export function bankerOffer(state, playerId) {
  const p = state.players[playerId]
  const pool = []
  if (p.caseId != null) pool.push(state.cases[p.caseId].value) // the banker knows…
  for (const c of Object.values(state.cases)) {
    if (!c.opened && !c.owner) pool.push(c.value)
  }
  const ev = pool.reduce((a, b) => a + b, 0) / Math.max(1, pool.length)
  const progress = state.communalTotal ? state.openedCount / state.communalTotal : 1
  const mult = 0.32 + 0.62 * Math.pow(Math.min(1, progress), 0.85)
  const jitter = 0.96 + state.rng.next() * 0.08
  return roundOffer(Math.max(1, ev * mult * jitter))
}

function openOfferRound(state, now, events) {
  state.offerIndex++
  state.phase = PHASES.OFFER
  state.offers = {}
  const actives = activePlayers(state)
  for (const id of actives) {
    state.offers[id] = {
      amount: bankerOffer(state, id),
      deadline: now + TIMINGS.OFFER_MS,
      answered: false,
      choice: null,
    }
  }
  events.push(emit(state, E.BANKER_CALLING, {}))
  events.push(emit(state, E.OFFER_OPEN, { count: actives.length }))
  state.deadline = now + TIMINGS.OFFER_MS
}

function actAnswer(state, playerId, deal, now) {
  if (state.phase !== PHASES.OFFER) throw new Error('No offer on the table')
  const off = state.offers[playerId]
  if (!off) throw new Error('No offer for you')
  if (off.answered) throw new Error('Already answered')
  off.answered = true
  off.choice = deal ? 'deal' : 'nodeal'
  const p = state.players[playerId]
  const events = [emit(state, E.ANSWERED, { playerId, choice: off.choice })]
  if (deal) {
    p.cashedOut = true
    p.dealt = true
    p.dealAmount = off.amount
    events.push(emit(state, E.DEALT, { playerId })) // amount stays private until the end
  } else {
    events.push(emit(state, E.STOOD, { playerId }))
  }
  resolveOffers(state, now, events)
  return events
}

function resolveOffers(state, now, events) {
  const unanswered = Object.values(state.offers).some(o => !o.answered)
  if (unanswered) return

  if (activePlayers(state).length === 0) {
    finishGame(state, 'allCashed', events)
    return
  }

  if (!state.twistDone && state.twistRound === state.offerIndex) {
    const pending = activePlayers(state).filter(id => state.offers[id]?.choice === 'nodeal')
    if (pending.length) {
      state.phase = PHASES.TWIST
      state.twistPendingIds = pending
      for (const id of pending) state.players[id].twistPending = true
      state.deadline = now + TIMINGS.TWIST_MS
      events.push(emit(state, E.TWIST_INCOMING, { players: pending.length }))
      return
    }
  }

  closeRound(state, now, events)
}

function closeRound(state, now, events) {
  state.offers = {}
  state.phase = PHASES.OPENING
  if (unopenedCommunal(state).length === 0) {
    finishGame(state, 'boardEmpty', events)
    return
  }
  advanceTurn(state, now, events)
}

// ---------------------------------------------------------------------------
// the twist — one dramatic mid-game reveal
// ---------------------------------------------------------------------------

function actTwist(state, playerId, action, now) {
  if (state.phase !== PHASES.TWIST) throw new Error('No twist happening')
  const p = state.players[playerId]
  if (!p?.twistPending) throw new Error('The twist is not yours')
  if (p.twistChoice != null) throw new Error('Twist already chosen')
  p.twistChoice = !!action.swap
  const events = [emit(state, E.ANSWERED, { playerId, choice: p.twistChoice ? 'swap' : 'keep' })]

  const unresolved = (state.twistPendingIds || []).filter(id => state.players[id]?.twistChoice == null)
  if (unresolved.length === 0) applyTwists(state, now, events)
  return events
}

function applyTwists(state, now, events) {
  for (const id of state.twistPendingIds || []) {
    const p = state.players[id]
    if (!p || !p.twistChoice) continue // chose keep (or timed out)
    const mine = state.cases[p.caseId]
    const communal = unopenedCommunal(state)
    let target = communal.length ? state.rng.pick(communal) : null
    if (!target) {
      const others = Object.values(state.cases).filter(
        c => c.owner && c.owner !== id && !c.opened)
      target = others.length ? state.rng.pick(others) : null
    }
    if (target) {
      // Players keep their physical briefcase; only the CONTENTS trade places.
      ;[mine.value, target.value] = [target.value, mine.value]
      events.push(emit(state, E.TWIST_TAKEN, { playerId: id }))
    }
    p.twistPending = false
  }
  state.twistDone = true
  for (const p of Object.values(state.players)) { p.twistChoice = null }
  state.twistPendingIds = []
  closeRound(state, now, events)
}

// ---------------------------------------------------------------------------
// endings
// ---------------------------------------------------------------------------

export function finalValue(state, playerId) {
  const p = state.players[playerId]
  if (!p) return 0
  if (p.dealt) return p.dealAmount
  return p.caseId != null ? state.cases[p.caseId].value : 0
}

export function results(state) {
  const rows = state.joinOrder
    .map(id => ({
      playerId: id,
      name: state.players[id]?.name ?? '?',
      avatar: state.players[id]?.avatar ?? '🎭',
      dealt: state.players[id]?.dealt ?? false,
      dealAmount: state.players[id]?.dealAmount,
      caseValue: state.players[id]?.caseId != null ? state.cases[state.players[id].caseId].value : null,
      final: finalValue(state, id),
    }))
    .sort((a, b) => b.final - a.final)
  const top = rows.length ? rows[0].final : 0
  return { reason: state.endReason, leaderboard: rows, winnerIds: rows.filter(r => r.final === top).map(r => r.playerId) }
}

function finishGame(state, reason, events) {
  state.endReason = reason
  state.phase = PHASES.GAMEOVER
  state.offers = {}
  state.deadline = 0
  events.push(emit(state, E.FINISHED, { reason }))
}

// ---------------------------------------------------------------------------
// clock — the authority pumps this; timeouts auto-play so the show never dies
// ---------------------------------------------------------------------------

export function tick(state, now) {
  const events = []
  if (state.deadline && now < state.deadline) return events
  if (!state.deadline) return events
  state.deadline = 0

  switch (state.phase) {
    case PHASES.PICKING: {
      for (const id of state.joinOrder) {
        const p = state.players[id]
        if (p?.caseId == null) {
          const free = Object.values(state.cases).filter(c => !c.owner)
          const pick = free[state.rng.int(0, free.length - 1)]
          try {
            events.push(...applyAction(state, id, { t: A.PICK_CASE, caseId: pick.id }, now))
          } catch { /* race with a real pick */ }
        }
      }
      break
    }
    case PHASES.OPENING: {
      skipInactive(state)
      const pid = state.joinOrder[state.turnIndex]
      const free = unopenedCommunal(state)
      if (pid && free.length) {
        const pick = free[state.rng.int(0, free.length - 1)]
        try {
          events.push(...applyAction(state, pid, { t: A.OPEN_CASE, caseId: pick.id }, now))
        } catch { /* ignore */ }
      }
      break
    }
    case PHASES.OFFER: {
      for (const [id, off] of Object.entries(state.offers)) {
        if (!off.answered) {
          try {
            events.push(...actAnswer(state, id, false, now)) // silence == NO DEAL
          } catch { /* already answered */ }
        }
      }
      break
    }
    case PHASES.TWIST: {
      for (const id of state.twistPendingIds || []) {
        const p = state.players[id]
        if (p?.twistChoice == null) {
          try {
            events.push(...actTwist(state, id, { t: A.TWIST_CHOICE, swap: false }, now))
          } catch { /* ignore */ }
        }
      }
      break
    }
  }
  return events
}

// ---------------------------------------------------------------------------
// snapshots — what each connection is allowed to see
// ---------------------------------------------------------------------------

export function snapshotFor(state, viewerId) {
  const over = state.phase === PHASES.GAMEOVER
  const res = over ? results(state) : null
  const myOffer = state.offers[viewerId]
  return {
    t: 'state',
    you: viewerId,
    code: state.code,
    phase: state.phase,
    openedCount: state.openedCount,
    communalTotal: state.communalTotal,
    scheduleLeft: Math.max(0, state.schedule.length - state.offerIndex),
    deadline: state.deadline,
    now: Date.now(),
    turnPlayer: state.phase === PHASES.OPENING ? state.joinOrder[state.turnIndex] : null,
    players: state.joinOrder.filter(id => state.players[id]).map(id => {
      const p = state.players[id]
      const off = state.offers[id]
      return {
        id,
        name: p.name,
        avatar: p.avatar,
        connected: p.connected,
        cashedOut: p.cashedOut,
        dealt: p.dealt,
        hasCase: p.caseId != null,
        isTurn: state.phase === PHASES.OPENING && state.joinOrder[state.turnIndex] === id,
        twistPending: state.phase === PHASES.TWIST && p.twistPending === true,
        answered: off ? off.answered : null,
        choice: off?.answered ? off.choice : null, // deal/nodeal shown, amount never
        final: over ? finalValue(state, id) : null,
      }
    }),
    cases: Object.values(state.cases).map(c => ({
      id: c.id,
      opened: c.opened,
      owner: c.owner,
      openedBy: c.openedBy,
      value: c.opened || over ? c.value : null,
    })),
    offer: state.phase === PHASES.OFFER
      ? (myOffer
          ? { amount: myOffer.amount, answered: myOffer.answered, choice: myOffer.choice }
          : { secret: true, answered: null, choice: null })
      : null,
    twist: state.phase === PHASES.TWIST
      ? { youArePending: state.players[viewerId]?.twistPending === true }
      : null,
    results: res,
  }
}
