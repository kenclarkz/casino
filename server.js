#!/usr/bin/env node
// THE BANKER — self-hosted mode.
//
// Zero-dependency node server that:
//   1. serves the game over HTTP (/, /tv, /play)
//   2. hosts WebSockets at /ws and runs one authoritative Game per room
//
// GitHub Pages deployments don't run this file — those use the P2P
// (PeerJS data channel) transport instead. Both speak the same protocol.
//
//   node server.js            → http://localhost:8080

import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAuthority } from './lib/the-banker/host.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8080)
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

// ---------------------------------------------------------------------------
// static files
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function resolveFile(urlPath) {
  let p = decodeURIComponent(urlPath.split('?')[0])
  if (p === '/' || p === '') p = '/index.html'
  if (p === '/tv' || p === '/tv/') p = '/tv/index.html'
  if (p === '/play' || p === '/play/') p = '/play/index.html'
  const abs = path.normalize(path.join(ROOT, p))
  if (!abs.startsWith(ROOT)) return null
  return abs
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url)
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    return res.end('Not found')
  }
  const ext = path.extname(file)
  const body = fs.readFileSync(file)
  if (ext === '.html') {
    // tell the pages to use this server's WebSockets instead of PeerJS
    const html = body.toString('utf8').replace(
      '<head>',
      '<head>\n  <script>window.BANKER_TRANSPORT = "ws"</script>',
    )
    res.writeHead(200, { 'Content-Type': MIME[ext] })
    return res.end(html)
  }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
  res.end(body)
})

// ---------------------------------------------------------------------------
// minimal RFC 6455 WebSocket
// ---------------------------------------------------------------------------


function wsAccept(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64')
}

function encodeFrame(str) {
  const payload = Buffer.from(str, 'utf8')
  const len = payload.length
  let header
  if (len < 126) {
    header = Buffer.from([0x81, len])
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81; header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81; header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, payload])
}

server.on('upgrade', (req, sock) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname !== '/ws') return sock.destroy()
  const key = req.headers['sec-websocket-key']
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    return sock.destroy()
  }
  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`,
  )
  sock.setNoDelay(true)

  const client = {
    id: 'c' + crypto.randomBytes(6).toString('hex'),
    room: normalizeCode(url.searchParams.get('room')),
    role: url.searchParams.get('role') === 'tv' ? 'tv' : 'player',
    sock,
    buffer: Buffer.alloc(0),
    fragments: null,
  }
  const room = getRoom(client.room)

  sock.on('data', chunk => {
    client.buffer = Buffer.concat([client.buffer, chunk])
    let frame
    while ((frame = readFrame(client))) {
      handleFrame(client, room, frame)
    }
  })
  const drop = () => {
    room.clients.delete(client)
    room.authority?.removePlayer(client.id)
  }
  sock.on('close', drop)
  sock.on('error', drop)
})

function readFrame(client) {
  const buf = client.buffer
  if (buf.length < 2) return null
  const fin = (buf[0] & 0x80) !== 0
  const opcode = buf[0] & 0x0f
  const masked = (buf[1] & 0x80) !== 0
  let len = buf[1] & 0x7f
  let off = 2
  if (len === 126) {
    if (buf.length < 4) return null
    len = buf.readUInt16BE(2); off = 4
  } else if (len === 127) {
    if (buf.length < 10) return null
    const big = buf.readBigUInt64BE(2)
    if (big > 1_000_000n) { client.sock.destroy(); return null }
    len = Number(big); off = 10
  }
  if (len > 1_000_000) { client.sock.destroy(); return null }
  const maskLen = masked ? 4 : 0
  if (buf.length < off + maskLen + len) return null
  let payload = buf.subarray(off + maskLen, off + maskLen + len)
  if (masked) {
    const mask = buf.subarray(off, off + 4)
    const out = Buffer.allocUnsafe(len)
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3]
    payload = out
  }
  client.buffer = buf.subarray(off + maskLen + len)
  return { fin, opcode, payload }
}

function handleFrame(client, room, { fin, opcode, payload }) {
  switch (opcode) {
    case 0x0: // continuation
      client.fragments.push(payload)
      if (fin) {
        const full = Buffer.concat(client.fragments)
        client.fragments = null
        onMessage(client, room, full.toString('utf8'))
      }
      break
    case 0x1:
    case 0x2:
      if (!fin) { client.fragments = [payload]; break }
      onMessage(client, room, opcode === 0x1 ? payload.toString('utf8') : '')
      break
    case 0x8: // close
      try { client.sock.write(Buffer.from([0x88, 0x00])) } catch { /* */ }
      client.sock.end()
      break
    case 0x9: // ping → pong
      try {
        const p = payload.subarray(0, 125)
        client.sock.write(Buffer.concat([
          Buffer.from([0x8a, p.length]), p,
        ]))
      } catch { /* */ }
      break
    default: break // pong etc.
  }
}

function normalizeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
}

// ---------------------------------------------------------------------------
// rooms
// ---------------------------------------------------------------------------

const rooms = new Map()

function getRoom(code) {
  let room = rooms.get(code)
  if (!room) {
    room = { code, clients: new Set(), authority: null, touchedAt: Date.now() }
    rooms.set(code, room)
  }
  room.touchedAt = Date.now()
  return room
}

function attachAuthority(room) {
  if (room.authority) return room.authority
  room.authority = createAuthority({
    code: room.code,
    now: () => Date.now(),
    sendTo(playerId, msg) {
      for (const c of room.clients) {
        if (c.id === playerId && c.sock.writable) {
          try { c.sock.write(encodeFrame(JSON.stringify(msg))) } catch { /* */ }
        }
      }
    },
    broadcast(msg) {
      const frame = encodeFrame(JSON.stringify(msg))
      for (const c of room.clients) {
        try { if (c.sock.writable) c.sock.write(frame) } catch { /* */ }
      }
    },
  })
  return room.authority
}

function onMessage(client, room, text) {
  if (!text) return
  let msg
  try { msg = JSON.parse(text) } catch { return }
  room.clients.add(client)
  attachAuthority(room)
  room.authority.message(client.id, msg, client.role)
}

setInterval(() => {
  for (const [code, room] of rooms) {
    if (
      room.clients.size === 0 &&
      Date.now() - Math.max(room.touchedAt, room.authority?.game?.createdAt ?? 0) > 15 * 60 * 1000
    ) {
      room.authority?.destroy()
      rooms.delete(code)
    }
  }
}, 60 * 1000).unref()


server.listen(PORT, () => {
  console.log(`THE BANKER is open for business → http://localhost:${PORT}`)
})
