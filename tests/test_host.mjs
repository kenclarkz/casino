import { test } from './registry.mjs'
import { assert } from './lib.mjs'
import { createAuthority } from '../lib/the-banker/host.js'
import { nextNow } from './helpers.mjs'

// host.js wiring: roles, routing, restart — no sockets, direct calls.

function rig() {
  const outbox = new Map() // playerId -> messages[]
  const auth = createAuthority({
    code: 'TEST',
    now: () => 0,
    sendTo: (pid, msg) => {
      if (!outbox.has(pid)) outbox.set(pid, [])
      outbox.get(pid).push(msg)
    },
    broadcast: msg => {
      for (const box of outbox.values()) box.push(msg)
    },
  })
  return { auth, outbox }
}

test('authority: hello registers role and delivers a snapshot', () => {
  const { auth, outbox } = rig()
  auth.message('tv1', { t: 'hello', role: 'tv' })
  assert(outbox.has('tv1'), 'welcome/state sent to tv')
  auth.message('p1', { t: 'hello', role: 'player' })
  auth.message('p1', { t: 'join', name: 'Ana', avatar: '🦊' })
  const states = outbox.get('p1').filter(m => m.t === 'state')
  assert(states.length >= 1)
  assert.equal(states.at(-1).players.length, 1)
})

test('authority: only the tv can start the show', () => {
  const { auth, outbox } = rig()
  auth.message('p1', { t: 'hello', role: 'player' })
  auth.message('p1', { t: 'join', name: 'A', avatar: '🦊' })
  auth.message('p1', { t: 'start' })
  const errors = outbox.get('p1').filter(m => m.t === 'error')
  assert(errors.length === 1 && /TV/.test(errors[0].m), 'player cannot start')
})

test('authority: full lobby → start → pick round trip', () => {
  const { auth, outbox } = rig()
  auth.message('tv1', { t: 'hello', role: 'tv' })
  for (const [i, pid] of ['a', 'b'].entries()) {
    auth.message(pid, { t: 'hello', role: 'player' })
    auth.message(pid, { t: 'join', name: 'P' + i, avatar: '🎩' })
  }
  auth.message('tv1', { t: 'start' })
  const a = outbox.get('a').filter(m => m.t === 'state').at(-1)
  assert.equal(a.phase, 'picking')
  auth.message('a', { t: 'pickCase', caseId: 3 })
  auth.message('b', { t: 'pickCase', caseId: 9 })
  const b = outbox.get('b').filter(m => m.t === 'state').at(-1)
  assert.equal(b.phase, 'opening')
})

test('authority: bad actions come back as private errors, never crash the room', () => {
  const { auth, outbox } = rig()
  auth.message('tv1', { t: 'hello', role: 'tv' })
  auth.message('p1', { t: 'hello', role: 'player' })
  auth.message('p1', { t: 'join', name: 'X', avatar: '⚡' })
  auth.message('p2', { t: 'hello', role: 'player' })
  auth.message('p2', { t: 'join', name: 'Y', avatar: '💎' })
  auth.message('p1', { t: 'openCase', caseId: 5 }) // wrong phase
  const errs1 = outbox.get('p1').filter(m => m.t === 'error')
  assert(errs1.length >= 1)
  // room still alive:
  auth.message('tv1', { t: 'start' })
  auth.message('p2', { t: 'pickCase', caseId: 2 })
  const p2states = outbox.get('p2').filter(m => m.t === 'state')
  assert(p2states.at(-1).cases.some(c => c.owner === 'p2'))
})

test('authority: only the tv seats bots; only bots can be unseated', () => {
  const { auth, outbox } = rig()
  auth.message('tv1', { t: 'hello', role: 'tv' })
  auth.message('p1', { t: 'hello', role: 'player' })
  auth.message('p1', { t: 'join', name: 'Ana', avatar: '🦊' })
  auth.message('p1', { t: 'addBot' })
  assert(outbox.get('p1').some(m => m.t === 'error' && /TV/.test(m.m)),
    'players cannot seat bots')

  auth.message('tv1', { t: 'addBot' })
  let st = outbox.get('tv1').filter(m => m.t === 'state').at(-1)
  assert.equal(st.players.length, 2, 'bot seated')
  const bot = st.players.find(p => p.bot)
  assert(bot, 'snapshot flags the bot')

  auth.message('tv1', { t: 'kick', playerId: 'p1' }) // humans are protected
  st = outbox.get('tv1').filter(m => m.t === 'state').at(-1)
  assert.equal(st.players.length, 2, 'human stays seated')

  auth.message('tv1', { t: 'kick', playerId: bot.id })
  st = outbox.get('tv1').filter(m => m.t === 'state').at(-1)
  assert.equal(st.players.length, 1, 'bot unseated')
})

test('authority: solo show — one player and a bot from lobby to gameover', () => {
  const { auth, outbox } = rig()
  auth.message('tv1', { t: 'hello', role: 'tv' })
  auth.message('p1', { t: 'hello', role: 'player' })
  auth.message('p1', { t: 'join', name: 'Ana', avatar: '🦊' })
  auth.message('tv1', { t: 'addBot' })
  auth.message('tv1', { t: 'start' })
  auth.message('p1', { t: 'pickCase', caseId: 4 })
  // bot auto-picks via its own clock; pump real wall-clock time through tick
  let t = Date.now()
  for (let i = 0; i < 20000 && auth.game.phase !== 'gameover'; i++) {
    t += 250
    auth.tickFor(t)
    if (auth.game.phase === 'offer' && auth.game.offers.p1 && !auth.game.offers.p1.answered) {
      auth.message('p1', { t: 'noDeal' })
    } else if (auth.game.phase === 'twist' && auth.game.players.p1.twistPending &&
               auth.game.players.p1.twistChoice == null) {
      auth.message('p1', { t: 'twist', swap: false })
    }
  }
  assert.equal(auth.game.phase, 'gameover')
})
