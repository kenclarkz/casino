// THE BANKER — TV renderer & (in P2P mode) show host.

import { createAuthority } from './host.js'
import { snapshotFor } from './engine.js'
import { peerHost, wsConnect, transportMode, makeCode } from './net.js'
import { formatMoney, PRIZES } from './prizes.js'
import { PHASES, A } from './protocol.js'
import { audioInit, sfx } from './audio.js'

const $ = id => document.getElementById(id)
const TV_ID = '__tv__'
const BIG = 20000 // values >= this get the full drama

let lastState = null
let auth = null
let host = null
let ws = null
const conns = new Map()

let code = makeCode()

// site root, whether hosted at "/" (self-host) or "/casino/" (GitHub Pages)
const SITE_ROOT = new URL('../', document.baseURI).href
const joinUrl = c => new URL(`play/#${c}`, SITE_ROOT).href

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

function handleState(s) {
  const prev = lastState
  lastState = s
  $('roomChip').textContent = s.code || code
  // a fresh lobby after a finished show means the board was reset
  if (s.phase === 'lobby' && gridBuilt) {
    gridBuilt = false
    renderLobbyIdle()
  }
  renderHeader(s)
  renderMain(s, prev)
  renderRail(s)
  renderOverlays(s, prev)
}

function handleEvents(es) {
  if (!es?.length) return
  for (const e of es) {
    switch (e.type) {
      case 'caseOpened': onCaseOpened(e.caseId, e.value); break
      case 'bankerCalling': audioInit(); sfx.bankerRing(); break
      case 'dealt': audioInit(); sfx.dealChime(); break
      case 'stood': audioInit(); sfx.standSting(); break
      case 'twistIncoming': audioInit(); sfx.twistGlitch(); break
      case 'twistTaken':
        $('twistTitle').textContent = 'A DEAL IS SWAPPED'
        setTimeout(() => { $('twistTitle').textContent = 'THE TWIST' }, 2600)
        break
      case 'started': audioInit(); music.start(); break
      case 'turn': audioInit(); sfx.click(); break
      case 'finished': audioInit(); music.stop(); sfx.fanfare(); confetti(); break
    }
  }
}

function boot() {
  document.addEventListener('pointerdown', audioInit, { once: true })

  if (transportMode() === 'ws') {
    ws = wsConnect({
      room: code,
      role: 'tv',
      onOpen: () => ws.send({ t: 'hello', role: 'tv' }),
      onData: msg => {
        if (msg.t === 'state') handleState(msg)
        else if (msg.t === 'events') handleEvents(msg.es)
        else if (msg.t === 'reset') resetStage()
      },
    })
    window.tvSend = m => ws.send(m)
  } else {
    host = peerHost(code, {
      onConnection: {
        open: conn => conns.set(conn.peer, conn),
        data: (conn, d) => {
          conns.set(conn.peer, conn)
          auth.message(conn.peer, d)
        },
        close: conn => {
          conns.delete(conn.peer)
          auth.removePlayer(conn.peer)
        },
      },
      onError: err => {
        // id collision on the public broker — roll a fresh code and retry
        if (String(err?.type) === 'unavailable-id') {
          code = makeCode()
          host.destroy()
          boot()
        }
      },
    })
    auth = createAuthority({
      code,
      now: () => Date.now(),
      sendTo: (pid, msg) => {
        const c = conns.get(pid)
        if (c) host.sendTo(c, msg)
      },
      broadcast: msg => {
        handleEventsIfLocal(msg)
        if (msg.t === 'reset') resetStage()
        host.broadcast(msg)
      },
      onUpdate: game => handleState(snapshotFor(game, TV_ID)),
    })
    auth.message(TV_ID, { t: 'hello', role: 'tv' })
    window.tvSend = m => auth.message(TV_ID, m)
  }
  renderLobbyIdle()
}

function handleEventsIfLocal(msg) {
  if (msg.t === 'events') handleEvents(msg.es)
}

// a rematch keeps the table — just tear down the old board visuals
function resetStage() {
  gridBuilt = false
  music.stop()
  document.querySelectorAll('.confetti').forEach(c => c.remove())
  for (const id of ['bankerOverlay', 'twistOverlay', 'endOverlay']) {
    $(id).classList.remove('show')
  }
}

function tvAction(a) { window.tvSend({ t: a.t ?? a }) }

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

function renderHeader(s) {
  const label = {
    lobby: 'OPEN FOR CONTESTANTS',
    picking: 'CHOOSING CASES',
    opening: 'BOARD LIVE',
    offer: 'BANKER TALKS',
    twist: 'THE TWIST',
    gameover: 'SHOW OVER',
  }[s.phase] ?? ''
  $('roundInfo').innerHTML = `${label}<b>${s.openedCount}/${s.communalTotal} OPENED</b>`
}

function renderLobbyIdle() {
  const url = joinUrl(code)
  $('main').innerHTML = `
    <div class="tv-lobby">
      <div>
        <div class="lobby-code logo">${code}</div>
        <div class="lobby-hint">
          On your phone, go to <b>${SITE_ROOT}</b><br>
          scan the QR, enter code <b>${code}</b> and take a seat.<br>
          Playing solo? Start right away — add bots if you want company.
        </div>
        <div class="lobby-players" id="lobbyRoster"></div>
        <div class="start-row">
          <button class="btn btn-gold" id="startBtn">START THE SHOW</button>
          <button class="btn btn-ghost" id="addBotBtn">+ ADD A BOT</button>
          <span class="min-note" id="minNote">take a seat or add a bot…</span>
          <button class="btn btn-ghost" id="newCodeBtn">NEW CODE</button>
        </div>
      </div>
      <div class="qr-box" id="qrBox"></div>
    </div>`
  drawQr($('qrBox'), url)
  $('startBtn').addEventListener('click', () => tvAction('start'))
  $('addBotBtn').addEventListener('click', () => tvAction(A.ADD_BOT))
  $('newCodeBtn').addEventListener('click', () => location.reload())
}

function drawQr(el, text) {
  try {
    const qr = window.qrcode(0, 'M')
    qr.addData(text)
    qr.make()
    el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 6, scalable: true })
    const svg = el.querySelector('svg')
    svg.removeAttribute('width'); svg.removeAttribute('height')
    svg.style.width = 'min(34vh, 30vw)'
    svg.style.height = 'auto'
  } catch { el.textContent = text }
}

let gridBuilt = false

function renderMain(s, prev) {
  if (s.phase === 'lobby') {
    // WS-mode TVs arrive here with an empty stage; P2P hosts already drew it
    if (!$('qrBox')) renderLobbyIdle()
    renderLobbyPlayers(s)
    return
  }
  ensureBoardDom(s)

  // cases
  const myTurnPid = s.turnPlayer
  for (const c of s.cases) {
    const el = caseEl(c.id)
    if (!el) continue
    const owner = c.owner ? s.players.find(p => p.id === c.owner) : null
    el.classList.toggle('mine', !!owner)
    if (owner && !c.opened) {
      el.dataset.owner = `${owner.avatar} ${owner.name}`
      el.classList.add('picked-by')
    }
    if (c.opened) {
      el.classList.add('open')
      const vEl = el.querySelector('.case-value')
      vEl.textContent = formatMoney(c.value)
      vEl.classList.toggle('v-big', c.value >= BIG)
      vEl.classList.toggle('v-small', c.value < BIG)
    }
    const canOpen = s.phase === PHASES.OPENING &&
      !c.opened && !c.owner && myTurnPid != null
    el.classList.toggle('can-open', canOpen)
  }
  renderBoardHits(s)
  renderPhaseBanner(s)
}

function renderLobbyPlayers(s) {
  const note = $('minNote')
  if (!note) return
  const n = s.players.length
  note.textContent = n === 0 ? 'take a seat or add a bot… (0/8)' : `${n} seated — ready! (${n}/8)`
  $('startBtn').disabled = n < 1
  $('addBotBtn').disabled = n >= 8
  const roster = $('lobbyRoster')
  if (roster) {
    roster.innerHTML = s.players.map(p => `
      <span class="lobby-player${p.bot ? ' is-bot' : ''}"${p.bot ? ` data-pid="${p.id}" title="tap to send home"` : ''}>
        ${p.avatar} ${escapeHtml(p.name)}${p.bot ? ' ✕' : ''}
      </span>`).join('')
    for (const el of roster.querySelectorAll('[data-pid]')) {
      el.addEventListener('click', () => tvAction({ t: A.KICK, playerId: el.dataset.pid }))
    }
  }
}

function ensureBoardDom(s) {
  const main = $('main')
  if (!gridBuilt) {
    main.innerHTML = ''
    const board = document.createElement('aside')
    board.className = 'board'
    board.id = 'boardLeft'
    const boardR = document.createElement('aside')
    boardR.className = 'board'
    boardR.id = 'boardRight'
    const wrap = document.createElement('section')
    wrap.className = 'case-grid-wrap'
    const grid = document.createElement('div')
    grid.className = 'case-grid'
    grid.id = 'caseGrid'
    wrap.appendChild(grid)
    main.append(board, wrap, boardR)

    const ids = s.cases.map(c => c.id).sort((a, b) => a - b)
    for (const id of ids) {
      const el = document.createElement('div')
      el.className = 'case'
      el.dataset.case = id
      el.innerHTML = `
        <div class="case-inner">
          <div class="case-face case-front"><span class="case-num">${id}</span></div>
          <div class="case-face back-face"><span class="case-value"></span></div>
        </div>`
      grid.appendChild(el)
    }
    fillBoards(PRIZES) // the board is public knowledge; the mapping is not
    gridBuilt = true
  }
}

const PRIZE_SPLIT = 10 // first 10 low values left, rest right

function fillBoards(valuesAsc) {
  const asc = [...valuesAsc].sort((a, b) => a - b)
  const mk = (parent, vals) => {
    parent.innerHTML = '<h3>PRIZE BOARD</h3>'
    for (const v of vals) {
      const d = document.createElement('div')
      d.className = 'prize' + (v >= BIG ? ' big' : '')
      d.dataset.prize = v
      d.textContent = formatMoney(v)
      parent.appendChild(d)
    }
  }
  mk($('boardLeft'), asc.slice(0, PRIZE_SPLIT))
  mk($('boardRight'), asc.slice(PRIZE_SPLIT))
}

function renderBoardHits(s) {
  const openedVals = new Set(s.cases.filter(c => c.opened).map(c => c.value))
  for (const d of document.querySelectorAll('.prize')) {
    d.classList.toggle('hit', openedVals.has(Number(d.dataset.prize)))
  }
}

function onCaseOpened(caseId, value) {
  const el = caseEl(caseId)
  audioInit()
  if (el) {
    el.classList.add('shake')
    setTimeout(() => el.classList.add('open'), 350)
    setTimeout(() => el.classList.remove('shake'), 550)
  }
  const pill = document.querySelector(`.prize[data-prize="${value}"]`)
  if (pill) pill.classList.add('just-hit')
  setTimeout(() => value >= BIG ? sfx.revealBad() : sfx.revealGood(), 500)
  setTimeout(() => pill && pill.classList.remove('just-hit'), 1600)
}

function caseEl(id) { return document.querySelector(`.case[data-case="${id}"]`) }

function renderPhaseBanner(s) {
  // subtle status line inside the grid wrap
  let banner = document.getElementById('phaseBanner')
  if (!banner) {
    banner = document.createElement('div')
    banner.id = 'phaseBanner'
    banner.className = 'spin-note'
    banner.style.position = 'absolute'
    banner.style.top = '8px'
    banner.style.left = '50%'
    banner.style.transform = 'translateX(-50%)'
    $('main').style.position = 'relative'
    $('main').appendChild(banner)
  }
  const turnP = s.turnPlayer ? s.players.find(p => p.id === s.turnPlayer) : null
  banner.textContent =
    s.phase === 'picking' ? 'everyone is choosing their case…' :
    s.phase === 'opening' && turnP ? `${turnP.avatar} ${turnP.name} — open a case` :
    s.phase === 'offer' ? 'offers are private — check your phone' :
    s.phase === 'twist' ? 'the twist is loose…' : ''
}

function renderRail(s) {
  const rail = $('rail')
  rail.innerHTML = ''
  if (s.phase === 'lobby') return
  for (const p of s.players) {
    const card = document.createElement('div')
    card.className = 'player-card'
    let status = p.isTurn ? 'opening…' : 'playing'
    if (p.answered === true) status = p.choice === 'deal' ? 'DEALT ✓' : 'no deal'
    else if (p.cashedOut) status = `locked ${formatMoney(p.final ?? 0)}`
    else if (s.phase === 'offer') status = 'phone ringing…'
    else if (s.phase === 'twist' && p.twistPending) status = 'choosing…'
    if (!p.connected) card.classList.add('gone')
    if (p.cashedOut) card.classList.add('cashed')
    if (p.isTurn) card.classList.add('turn')
    if (p.answered === true) card.classList.add(p.choice === 'deal' ? 'answered-deal' : 'answered-nodeal')
    card.innerHTML = `
      <div class="pc-avatar">${p.avatar}</div>
      <div class="pc-name">${escapeHtml(p.name)}</div>
      <div class="pc-status">${status}</div>`
    rail.appendChild(card)
  }
}

function renderOverlays(s, prev) {
  const bankerOn = s.phase === 'offer'
  const twistOn = s.phase === 'twist'
  $('bankerOverlay').classList.toggle('show', bankerOn)
  $('twistOverlay').classList.toggle('show', twistOn)

  if (bankerOn) {
    const answered = s.players.filter(p => p.answered === true)
    const deal = answered.filter(p => p.choice === 'deal').length
    const nodeal = answered.filter(p => p.choice === 'nodeal').length
    const waiting = s.players.filter(p => !p.connected || p.cashedOut ? false : p.answered !== true).length
    $('offerTally').innerHTML = `
      <span class="tally-chip deal">DEAL × ${deal}</span>
      <span class="tally-chip nodeal">NO DEAL × ${nodeal}</span>
      <span class="tally-chip waiting">⏳ ${Math.max(0, waiting)}</span>`
    restartBar($('offerBar'), s)
  }

  const endOn = s.phase === 'gameover'
  $('endOverlay').classList.toggle('show', endOn)
  if (endOn && (!prev || prev.phase !== 'gameover')) renderResults(s)
}

function restartBar(bar, s) {
  const remain = Math.max(0, (s.deadline || 0) - (Date.now()))
  bar.style.animation = 'none'
  void bar.offsetWidth
  bar.style.animationDuration = `${remain}ms`
  bar.style.animation = 'drain linear forwards'
}

function renderResults(s) {
  const r = s.results
  $('endTitle').textContent = r.reason === 'allCashed'
    ? 'EVERYONE TOOK THE MONEY'
    : 'THE FINAL REVEAL'
  $('revealStrip').innerHTML = s.cases
    .map(c => `<span class="reveal-pill">#${c.id} · ${formatMoney(c.value)}</span>`).join('')
  $('podium').innerHTML = r.leaderboard.map((row, i) => `
    <div class="podium-step ${r.winnerIds.includes(row.playerId) ? 'winner crowned' : ''}" style="animation-delay:${i * 0.12}s">
      ${r.winnerIds.includes(row.playerId) ? '<div class="pd-crown">👑</div>' : ''}
      <div>${row.avatar} ${escapeHtml(row.name)}</div>
      <div class="pd-amt">${formatMoney(row.final)}</div>
      <div class="overlay-sub" style="font-size:11px">${row.dealt ? `dealt · case held ${formatMoney(row.caseValue)}` : 'played it out'}</div>
    </div>`).join('')
  $('endHint').innerHTML = ''
  const again = document.createElement('button')
  again.className = 'btn btn-gold'
  again.textContent = 'PLAY AGAIN — SAME TABLE'
  again.addEventListener('click', () => tvAction('restart'))
  $('endHint').appendChild(again)
}

function confetti() {
  const colors = ['#f6c945', '#ffe08a', '#ff3355', '#29d9a6', '#7c5cff']
  for (let i = 0; i < 120; i++) {
    const c = document.createElement('i')
    c.className = 'confetti'
    c.style.left = Math.random() * 100 + 'vw'
    c.style.background = colors[i % colors.length]
    c.style.animationDuration = 2.2 + Math.random() * 2 + 's'
    c.style.animationDelay = Math.random() * 1.2 + 's'
    c.style.transform = `rotate(${Math.random() * 360}deg)`
    document.body.appendChild(c)
    setTimeout(() => c.remove(), 6000)
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]))
}

boot()
