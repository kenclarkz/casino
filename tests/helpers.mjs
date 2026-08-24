// Test driver helpers: seat a table, play out rounds with scripted choices.

import { createGame, addPlayer, startGame, applyAction, tick } from '../lib/the-banker/engine.js'
import { PHASES } from '../lib/the-banker/protocol.js'

let counter = 0
export function nextNow() { return ++counter * 1000 }

export function makeTable(n = 3, seed = 42) {
  const state = createGame({ code: 'TEST', seed, now: 0 })
  const ids = []
  for (let i = 0; i < n; i++) {
    const id = 'p' + i
    ids.push(id)
    addPlayer(state, id, 'Player ' + (i + 1), '🎭', nextNow())
  }
  return { state, ids }
}

export function seat(state, now = nextNow()) {
  startGame(state, now)
}

// every seated player picks a distinct case
export function pickAll(state) {
  for (const id of state.joinOrder.slice()) {
    const free = Object.values(state.cases).filter(c => !c.owner)
    applyAction(state, id, { t: 'pickCase', caseId: free[0].id }, nextNow())
  }
}

// keep opening until the phase changes from `opening`
export function openUntilPhaseChange(state) {
  let guard = 100
  while (state.phase === PHASES.OPENING && guard-- > 0) {
    const pid = state.joinOrder[state.turnIndex]
    if (!pid) break
    const free = Object.values(state.cases).filter(c => !c.opened && !c.owner)
    if (!free.length) break
    applyAction(state, pid, { t: 'openCase', caseId: free[0].id }, nextNow())
  }
}

// answer all outstanding offers; choiceFn(pid) -> deal:boolean
export function answerAll(state, choiceFn = () => false) {
  const events = []
  for (const id of Object.keys(state.offers)) {
    if (!state.offers[id].answered) {
      events.push(...applyAction(state, id, { t: choiceFn(id) ? 'deal' : 'noDeal' }, nextNow()))
    }
  }
  return events
}
