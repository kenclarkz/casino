// Shared client-side connection helper: picks the right transport, performs
// the hello/join handshake, and normalizes incoming messages into handlers.

import { peerJoin, wsConnect, transportMode } from './net.js'
import { A } from './protocol.js'

export function connectClient({ role, code, profile, onState, onEvents, onError, onReset }) {
  const sendHello = c => {
    c.send({ t: A.HELLO, role })
    if (profile) c.send({ t: A.JOIN, name: profile.name, avatar: profile.avatar })
  }

  if (transportMode() === 'ws') {
    let sock = null
    sock = wsConnect({
      room: code,
      role,
      onOpen: () => sendHello(sock),
      onData: msg => route(msg),
      onClose: () => onError?.('Connection lost — refresh to rejoin'),
    })
    function route(msg) {
      if (msg.t === 'state') onState?.(msg)
      else if (msg.t === 'events') onEvents?.(msg.es ?? [])
      else if (msg.t === 'reset') onReset?.()
      else if (msg.t === 'error') onError?.(msg.m)
    }
    return { send: a => sock.send(a), close: () => sock.close() }
  }

  const conn = peerJoin(code, {
    onOpen: () => sendHello(conn),
    onData: msg => {
      if (msg.t === 'state') onState?.(msg)
      else if (msg.t === 'events') onEvents?.(msg.es ?? [])
      else if (msg.t === 'reset') onReset?.()
      else if (msg.t === 'error') onError?.(msg.m)
    },
    onClose: () => onError?.('Connection lost — refresh to rejoin'),
    onError: err => onError?.(err),
  })
  return { send: a => conn.send(a), close: () => conn.close() }
}
