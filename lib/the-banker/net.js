// Transport layer.
//
// Primary: WebRTC data channels via PeerJS (vendored) — works on static
// hosting like GitHub Pages, phone-to-TV across the internet, no server.
// Optional: plain WebSockets to `server.js` when the game is self-hosted
// (server.js flips window.BANKER_TRANSPORT = 'ws' while serving HTML).
//
// Both transports speak the same JSON protocol, so pages don't care which
// one is live.

const PEER_PREFIX = 'the-banker-show-'

export function makeCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)]
  return code
}

export function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
}

// --- PeerJS host (TV side) -------------------------------------------------

export function peerHost(code, { onOpen, onConnection, onError }) {
  const peer = new Peer(PEER_PREFIX + code)
  peer.on('open', () => onOpen && onOpen())
  peer.on('connection', conn => {
    conn.on('open', () => onConnection?.open?.(conn))
    conn.on('data', d => onConnection?.data?.(conn, d))
    conn.on('close', () => onConnection?.close?.(conn))
    conn.on('error', () => onConnection?.close?.(conn))
  })
  peer.on('error', err => onError && onError(err))
  return {
    broadcast(obj) {
      for (const conn of Object.values(peer.connections).flat()) {
        try { if (conn.open) conn.send(obj) } catch { /* dead conn */ }
      }
    },
    sendTo(conn, obj) { try { if (conn.open) conn.send(obj) } catch { /* */ } },
    destroy() { try { peer.destroy() } catch { /* */ } },
    peer,
  }
}

// --- PeerJS client (phone side) --------------------------------------------

export function peerJoin(code, { onOpen, onData, onClose, onError }) {
  const peer = new Peer()
  let conn = null
  let closed = false
  peer.on('open', () => {
    conn = peer.connect(PEER_PREFIX + code, { reliable: true })
    conn.on('open', () => onOpen && onOpen())
    conn.on('data', d => onData && onData(d))
    conn.on('close', () => { closed = true; onClose && onClose() })
  })
  peer.on('error', err => {
    if (closed) return
    const m = String(err?.type || err?.message || err)
    onError && onError(m.includes('peer-unavailable') ? 'Show not found — check the code' : m)
  })
  return {
    send(obj) { try { if (conn?.open) conn.send(obj) } catch { /* */ } },
    close() { closed = true; try { conn?.close(); peer.destroy() } catch { /* */ } },
  }
}

// --- WebSocket (both roles; server.js mode) ---------------------------------

export function wsConnect({ room, role, onOpen, onData, onClose }) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${proto}//${location.host}/ws?room=${encodeURIComponent(room)}&role=${role}`
  let sock
  try { sock = new WebSocket(url) } catch { onClose && onClose(); return deadSocket(onClose) }
  sock.onopen = () => onOpen && onOpen()
  sock.onmessage = e => {
    try { onData && onData(JSON.parse(e.data)) } catch { /* bad frame */ }
  }
  sock.onclose = () => onClose && onClose()
  sock.onerror = () => { /* close event follows */ }
  return {
    send(obj) { try { if (sock.readyState === 1) sock.send(JSON.stringify(obj)) } catch { /* */ } },
    close() { try { sock.close() } catch { /* */ } },
  }
}

function deadSocket(onClose) {
  setTimeout(() => onClose && onClose(), 0)
  return { send() {}, close() {} }
}

export function transportMode() {
  return window.BANKER_TRANSPORT === 'ws' ? 'ws' : 'p2p'
}
