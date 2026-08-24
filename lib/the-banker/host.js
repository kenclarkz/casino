// The authority glue: owns one Game instance per room and routes messages.
//
// Used identically by:
//   - server.js (node, rooms keyed by code, WebSockets)
//   - tv.js     (browser acting as host over a PeerJS data channel)
//
// Transport never touches game rules: callers hand messages in with a stable
// playerId and call sendTo()/broadcast() to push snapshots + events out.

import {
  createGame, addPlayer, dropPlayer, applyAction, tick,
  snapshotFor, startGame, rematch,
} from './engine.js'
import { randomSeed } from './rng.js'
import { A, PHASES } from './protocol.js'

export function createAuthority({ code, sendTo, broadcast, onUpdate, now = () => Date.now() }) {
  let game = null
  const roles = new Map() // playerId -> 'tv' | 'player'
  let ticker = null

  function ensureGame() {
    if (!game) game = createGame({ code, seed: randomSeed(), now: now() })
    return game
  }

  function pushState() {
    if (!game) return
    for (const id of roles.keys()) sendTo(id, snapshotFor(game, id))
    onUpdate?.(game)
  }

  function pushEvents(events) {
    if (events.length) broadcast({ t: 'events', es: events, at: Date.now() })
  }

  // periodic timeout pump while a round is live
  function armTicker() {
    clearInterval(ticker)
    ticker = setInterval(() => {
      if (!game || game.phase === PHASES.LOBBY || game.phase === PHASES.GAMEOVER) return
      const evs = tick(game, Date.now())
      if (evs.length) { pushEvents(evs); pushState() }
    }, 500)
  }
  armTicker()

  function message(playerId, msg) {
    try {
      switch (msg?.t) {
        case A.HELLO: {
          roles.set(playerId, msg.role === 'tv' ? 'tv' : 'player')
          if (!game) sendTo(playerId, { t: 'welcome', code })
          else sendTo(playerId, snapshotFor(game, playerId))
          return
        }
        case A.JOIN: {
          const g = ensureGame()
          const evs = [addPlayer(g, playerId, msg.name, msg.avatar, now())]
          pushEvents(evs); pushState()
          return
        }
        case A.START: {
          if (roles.get(playerId) !== 'tv') throw new Error('Only the TV can start')
          const g = ensureGame()
          const evs = startGame(g, now())
          pushEvents(evs); pushState()
          return
        }
        case A.RESTART: {
          if (roles.get(playerId) !== 'tv') throw new Error('Only the TV can restart')
          if (game && game.joinOrder.length >= 2) {
            rematch(game, now()) // same table, fresh board — nobody disconnects
          } else {
            game = createGame({ code, seed: randomSeed(), now: now() })
          }
          broadcast({ t: 'reset' })
          pushState()
          return
        }
        default: {
          const g = ensureGame()
          const evs = applyAction(g, playerId, msg, now())
          pushEvents(evs); pushState()
        }
      }
    } catch (err) {
      sendTo(playerId, { t: 'error', m: err.message })
    }
  }

  function removePlayer(playerId) {
    if (!game) { roles.delete(playerId); return }
    const evs = dropPlayer(game, playerId)
    roles.delete(playerId)
    pushEvents(evs); pushState()
  }

  function destroy() { clearInterval(ticker) }

  return { message, removePlayer, destroy, get game() { return game } }
}
