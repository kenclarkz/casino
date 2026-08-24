// THE BANKER — phone controller. Every decision lives here:
// pick a case, open a case, DEAL or NO DEAL, take the twist.

import { connectClient } from './client.js'
import { normalizeCode } from './net.js'
import { formatMoney } from './prizes.js'
import { audioInit, sfx } from './audio.js'

const $ = id => document.getElementById(id)
const phone = document.getElementById('phone')

let profile = null
let code = ''
let conn = null
let lastState = null

// ---------------------------------------------------------------------------
// join form (shown when landing here cold)
// ---------------------------------------------------------------------------

const AVATARS = ['🎩','🦊','🐼','👑','🤠','🐙','🦖','🚀','🍀','⚡','💎','🎭']

function renderJoinForm() {
  let avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)]
  phone.innerHTML = `
    <div class="phone-head"><span class="logo">THE BANKER</span><span class="phone-room">controller</span></div>
    <main class="phone-main">
      <section class="landing-card" style="width:100%">
        <div class="field">
          <label for="pname">Your name</label>
          <input id="pname" maxlength="20" placeholder="Contestant">
        </div>
        <div class="field">
          <label>Avatar</label>
          <div class="avatar-row" id="pav"></div>
        </div>
        <div class="field">
          <label for="pcode">Show code</label>
          <input id="pcode" class="code-input" maxlength="4" value="${code}" autocomplete="off">
        </div>
        <button class="btn btn-gold join-btn" id="pjoin">TAKE A SEAT</button>
      </section>
    </main>`
  const row = $('pav')
  for (const a of AVATARS) {
    const b = document.createElement('button')
    b.className = 'avatar-opt' + (a === avatar ? ' sel' : '')
    b.textContent = a
    b.addEventListener('click', () => {
      avatar = a
      row.querySelectorAll('.avatar-opt').forEach(x => x.classList.remove('sel'))
      b.classList.add('sel')
      audioInit(); sfx.click()
    })
    row.appendChild(b)
  }
  $('pjoin').addEventListener('click', () => {
    const name = $('pname').value.trim() || 'Contestant'
    const c = normalizeCode($('pcode').value)
    if (c.length !== 4) { toast('Enter the 4-letter show code'); return }
    profile = { name, avatar }
    code = c
    sessionStorage.setItem('banker-profile', JSON.stringify(profile))
    history.replaceState(null, '', '#' + c)
    connect()
  })
}

// ---------------------------------------------------------------------------
// connection
// ---------------------------------------------------------------------------

function connect() {
  conn?.close()
  conn = connectClient({
    role: 'player',
    code,
    profile,
    onState: handleState,
    onEvents: handleEvents,
    onError: toast,
    onReset: () => { lastState = null },
  })
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

function handleState(s) {
  const prev = lastState
  lastState = s

  if (s.phase === 'lobby') { renderLobby(s); return }

  const me = s.players.find(p => p.id === s.you)

  // not seated? (joined mid-game or dropped)
  if (!me && s.phase !== 'gameover') {
    phone.innerHTML = head() + `
      <main class="phone-main">
        <div class="big-msg"><h2>THE SHOW IS LIVE</h2>
        <p>You're watching from the wings. Wait for the next episode.</p></div>
      </main>`
    return
  }

  switch (s.phase) {
    case 'picking': return renderPicking(s, prev)
    case 'opening': return renderOpening(s, prev)
    case 'offer': return renderOffer(s, prev)
    case 'twist': return renderTwist(s, prev)
    case 'gameover': return renderGameOver(s)
  }
}

const head = () => `
  <div class="phone-head">
    <span class="logo">THE BANKER</span>
    <span class="phone-room">SHOW ${lastState.code}</span>
  </div>`

function statusStrip(s) {
  const chips = s.players.map(p =>
    `<span class="lobby-player">${p.avatar} ${escapeHtml(p.name)}${p.cashedOut ? ' ✓' : ''}</span>`)
  return `<div class="status-strip">${chips.join('')}</div>`
}

function renderLobby(s) {
  phone.innerHTML = head() + `
    <main class="phone-main">
      <div class="big-msg">
        <h2>YOU'RE SEATED ${profile ? profile.avatar : ''}</h2>
        <p>Waiting for the TV to start the show…<br>${s.players.length}/8 contestants</p>
      </div>
      ${statusStrip(s)}
    </main>`
}

function renderPicking(s, prev) {
  const me = s.players.find(p => p.id === s.you)
  if (me?.hasCase) {
    phone.innerHTML = head() + `
      <main class="phone-main">
        <div class="big-msg"><h2>CASE SECURED</h2><p>Hold it tight. The show starts when everyone has picked.</p></div>
        ${statusStrip(s)}
      </main>`
    return
  }
  const takenIds = new Set(s.cases.filter(c => c.owner).map(c => c.id))
  phone.innerHTML = head() + `
    <main class="phone-main">
      <p class="hint">Choose the briefcase that's <b>yours to keep</b></p>
      <div class="pick-grid" id="grid"></div>
      ${statusStrip(s)}
    </main>`
  const grid = $('grid')
  for (const c of s.cases) {
    const el = document.createElement('button')
    el.className = 'case'
    el.innerHTML = `<div class="case-inner" style="position:absolute;inset:0">
      <div class="case-face case-front" style="position:absolute;inset:0;border-radius:12%;display:grid;place-items:center">
        <span class="case-num">${c.id}</span></div></div>`
    if (takenIds.has(c.id)) { el.style.opacity = '.25'; el.style.pointerEvents = 'none' }
    el.addEventListener('click', () => {
      audioInit(); sfx.click(); vibrate(30)
      conn.send({ t: 'pickCase', caseId: c.id })
    })
    grid.appendChild(el)
  }
}

function myCaseBanner(s, me) {
  const mine = s.cases.find(c => c.owner === s.you)
  if (!mine) return ''
  return `
    <div class="my-case-banner">
      <div><div class="mc-label">your case</div><div class="mc-num">#${mine.id}</div></div>
      <div style="text-align:right;color:var(--dim);font-size:13px">
        ${me.dealt ? `locked in<br><b style="color:var(--nodeal)">${formatMoney(me.final ?? 0)}</b>` : 'unopened until the end'}
      </div>
    </div>`
}

function caseGrid(s, interactive) {
  const wrap = document.createElement('div')
  wrap.className = 'pick-grid'
  for (const c of s.cases) {
    const el = document.createElement('button')
    el.className = 'case'
    const owner = c.owner ? s.players.find(p => p.id === c.owner) : null
    let inner
    if (c.opened) {
      const cls = c.value >= 20000 ? 'v-big' : 'v-small'
      inner = `<span class="case-value ${cls}">${formatMoney(c.value)}</span>`
      el.style.borderColor = c.value >= 20000 ? 'var(--danger)' : 'var(--nodeal)'
    } else {
      inner = `<span class="case-num">${c.id}${owner ? `<div style="font-size:10px;font-family:var(--font-body)">${owner.avatar}</div>` : ''}</span>`
    }
    el.innerHTML = `<div class="case-inner" style="position:absolute;inset:0">
      <div class="case-face case-front" style="position:absolute;inset:0;border-radius:12%;display:grid;place-items:center">${inner}</div></div>`
    if (!interactive || c.opened || c.owner) { el.style.opacity = c.opened || c.owner ? '.85' : '.5'; el.style.pointerEvents = 'none' }
    else el.addEventListener('click', () => {
      audioInit(); sfx.click(); vibrate(40)
      conn.send({ t: 'openCase', caseId: c.id })
    })
    wrap.appendChild(el)
  }
  return wrap
}

function renderOpening(s) {
  const me = s.players.find(p => p.id === s.you)
  const myTurn = s.turnPlayer === s.you && !me.cashedOut
  const turnP = s.players.find(p => p.id === s.turnPlayer)
  phone.innerHTML = head() + `
    <main class="phone-main">
      ${myTurn ? '<p class="hint"><b>YOUR TURN</b> — open someone else\u2019s case</p>'
               : `<p class="hint">${turnP ? `${turnP.avatar} ${escapeHtml(turnP.name)}'s turn` : 'watching'} — sit tight</p>`}
      <div id="gridSlot"></div>
      ${myCaseBanner(s, me)}
    </main>`
  $('gridSlot').replaceWith(caseGrid(s, myTurn))
}

function countdownBar(ms) {
  return `<div class="countdown-bar"><i style="animation-duration:${Math.max(300, ms - Date.now())}ms"></i></div>`
}

function renderOffer(s) {
  const me = s.players.find(p => p.id === s.you)
  const off = s.offer

  if (me?.dealt) {
    phone.innerHTML = head() + `
      <main class="phone-main">
        <div class="big-msg">
          <h2>CASHED OUT ✓</h2>
          <p>The rest of the show belongs to the others.</p>
          <div class="locked-amount">${formatMoney(me.final ?? 0)}</div>
        </div>
        ${statusStrip(s)}
      </main>`
    return
  }

  if (off && typeof off.amount === 'number') {
    if (off.answered) {
      phone.innerHTML = head() + `
        <main class="phone-main">
          <div class="offer-card">
            <div class="mc-label oc-label" style="color:var(--dim)">you answered</div>
            <div class="offer-amount">${formatMoney(off.amount)}</div>
            <div class="offer-q">${off.choice === 'deal' ? 'DEAL — enjoy the cash' : 'NO DEAL — keep playing'}</div>
            <div class="spin-note">waiting for the others…</div>
          </div>
          ${statusStrip(s)}
        </main>`
      return
    }
    phone.innerHTML = head() + `
      <main class="phone-main">
        <div class="offer-card">
          <div class="mc-label oc-label" style="color:var(--gold)">the banker offers you</div>
          <div class="offer-amount">${formatMoney(off.amount)}</div>
          <div class="offer-q">deal or no deal?</div>
          <div class="offer-buttons">
            <button class="btn btn-deal" id="deal">DEAL</button>
            <button class="btn btn-nodeal" id="nodeal">NO DEAL</button>
          </div>
          ${countdownBar(s.deadline)}
        </div>
      </main>`
    audioInit(); sfx.heartbeat()
    vibrate([80, 60, 80])
    $('deal').addEventListener('click', () => { audioInit(); sfx.click(); vibrate(60); conn.send({ t: 'deal' }) })
    $('nodeal').addEventListener('click', () => { audioInit(); sfx.click(); vibrate(60); conn.send({ t: 'noDeal' }) })
    return
  }

  // offer round exists but nothing private for us (shouldn't happen while active)
  phone.innerHTML = head() + `
    <main class="phone-main">
      <div class="offer-card"><div class="spin-note">the banker is talking…</div>${countdownBar(s.deadline)}</div>
      ${statusStrip(s)}
    </main>`
}

function renderTwist(s) {
  const me = s.players.find(p => p.id === s.you)
  if (s.twist?.youArePending && !me?.dealt) {
    phone.innerHTML = head() + `
      <main class="phone-main">
        <div class="offer-card" style="border-color:var(--danger)">
          <div class="mc-label oc-label" style="color:#ff8ba0">THE TWIST</div>
          <div class="offer-q" style="margin-top:10px;line-height:1.7">
            The banker will swap the contents of your case with another mystery case.<br><br>
            Do you accept the swap?
          </div>
          <div class="offer-buttons">
            <button class="btn btn-deal" id="keep">KEEP MINE</button>
            <button class="btn btn-nodeal" id="swap">SWAP IT ⚡</button>
          </div>
          ${countdownBar(s.deadline)}
        </div>
      </main>`
    vibrate([120, 80, 120])
    $('swap').addEventListener('click', () => { conn.send({ t: 'twist', swap: true }); vibrate(80) })
    $('keep').addEventListener('click', () => { conn.send({ t: 'twist', swap: false }); vibrate(80) })
  } else {
    phone.innerHTML = head() + `
      <main class="phone-main">
        <div class="big-msg"><h2>⚡ THE TWIST ⚡</h2><p>Fates are being shuffled…</p></div>
      </main>`
  }
}

function renderGameOver(s) {
  const r = s.results
  const meRow = r.leaderboard.find(x => x.playerId === s.you)
  const winnerNames = r.leaderboard.filter(x => r.winnerIds.includes(x.playerId)).map(x => `${x.avatar} ${x.name}`).join(' & ')
  phone.innerHTML = head() + `
    <main class="phone-main">
      <div class="big-msg">
        <h2>${r.winnerIds.includes(s.you) ? '🏆 YOU WIN THE SHOW' : 'SHOW OVER'}</h2>
        <p>winner: <b>${escapeHtml(winnerNames)}</b> with ${formatMoney(r.leaderboard[0]?.final ?? 0)}</p>
        ${meRow ? `<p>you finished with <b style="color:var(--gold)">${formatMoney(meRow.final)}</b>${meRow.dealt ? ' (took the deal)' : ''}</p>` : ''}
      </div>
      ${r.leaderboard.map((row, i) => `
        <div class="my-case-banner">
          <div><div class="mc-label">#${i + 1}</div><b>${row.avatar} ${escapeHtml(row.name)}</b></div>
          <div style="text-align:right"><b style="color:var(--gold-bright)">${formatMoney(row.final)}</b>
          <div class="mc-label">${row.dealt ? 'dealt' : 'played out'}</div></div>
        </div>`).join('')}
    </main>`
}

// ---------------------------------------------------------------------------
// events / fx
// ---------------------------------------------------------------------------

function handleEvents(es) {
  for (const e of es ?? []) {
    if (e.type === 'bankerCalling') vibrate([200, 100, 200])
    if (e.type === 'turn' && lastState && e.playerId === lastState.you) {
      vibrate([60, 40, 60]); audioInit(); sfx.standSting()
    }
    if (e.type === 'twistIncoming') vibrate([300])
  }
}

function vibrate(pattern) {
  try { navigator.vibrate?.(pattern) } catch { /* */ }
}

let toastTimer = null
function toast(m) {
  document.querySelector('.error-toast')?.remove()
  const el = document.createElement('div')
  el.className = 'error-toast'
  el.textContent = m
  document.body.appendChild(el)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.remove(), 3500)
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]))
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

code = normalizeCode(location.hash.slice(1))
try { profile = JSON.parse(sessionStorage.getItem('banker-profile')) } catch { profile = null }
if (!profile || !/^[A-Z0-9]{4}$/.test(code)) {
  renderJoinForm()
} else {
  connect()
}
