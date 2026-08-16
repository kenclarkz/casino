// @ts-nocheck
// Pure math / RNG / helper utilities. No three.js, no DOM. Node-testable.

export const TAU = Math.PI * 2

/** Deterministic seeded RNG (mulberry32). Returns {next, range, int, pick, chance, shuffle}. */
export function makeRng(seed) {
  let a = (seed >>> 0)
  const next = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted: (entries) => {
      // entries: [{w, value}] or array of numbers weighted by value
      let total = 0
      for (const e of entries) total += e.w
      let r = next() * total
      for (const e of entries) {
        r -= e.w
        if (r <= 0) return e.value
      }
      return entries[entries.length - 1].value
    },
    shuffle: (arr) => {
      const a = arr.slice()
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const t = a[i]
        a[i] = a[j]
        a[j] = t
      }
      return a
    },
  }
}

export function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
export const lerp = (a, b, t) => a + (b - a) * t
export const invLerp = (a, b, v) => (a === b ? 0.5 : clamp((v - a) / (b - a), 0, 1))
export const smoothstep = (a, b, v) => {
  const t = invLerp(a, b, v)
  return t * t * (3 - 2 * t)
}
export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax
  const dy = by - ay
  return dx * dx + dy * dy
}
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by))
export const lerpAngle = (a, b, t) => {
  let d = b - a
  while (d > Math.PI) d -= TAU
  while (d < -Math.PI) d += TAU
  return a + d * t
}

/** Frame-rate independent exponential damping. */
export function damp(cur, target, lambda, dt) {
  return lerp(cur, target, 1 - Math.exp(-lambda * dt))
}

/** Critical damping toward target (handles velocity). */
export function dampStep(cur, target, lambda, dt) {
  return clamp(1 - Math.exp(-lambda * dt), 0, 1) * (target - cur) + cur
}

/** AABB overlap (axis aligned, 2D). */
export function aabbOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah
}

/** Circle vs AABB (2D). */
export function circleRect(px, py, pr, rx, ry, rw, rh) {
  const cx = clamp(px, rx, rx + rw)
  const cy = clamp(py, ry, ry + rh)
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy < pr * pr
}

export function pointInRect(px, py, rx, ry, rw, rh) {
  return px >= rx && px < rx + rw && py >= ry && py < ry + rh
}

/** Cheap 1D value noise for flicker / ambience. */
export function makeNoise1(seed = 1) {
  const p = new Uint8Array(512)
  const perm = new Uint8Array(256)
  const rng = makeRng(seed)
  for (let i = 0; i < 256; i++) perm[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    const t = perm[i]
    perm[i] = perm[j]
    perm[j] = t
  }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255]
  const grad = (h, t) => {
    h &= 1
    return h === 0 ? t : 1 - t
  }
  return {
    at(t) {
      const x = t
      const xi = Math.floor(x)
      const xf = x - xi
      const u = xf * xf * (3 - 2 * xf)
      const g1 = p[xi & 255]
      const g2 = p[(xi + 1) & 255]
      return grad(g1, xf) * (1 - u) + grad(g2, xf - 1) * u
    },
  }
}

export const fmtTime = (t) => {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export const uid = (() => {
  let n = 0
  return (prefix = 'id') => `${prefix}_${(++n).toString(36)}_${Math.random().toString(36).slice(2, 7)}`
})()

export const clamp01 = (v) => clamp(v, 0, 1)

/** Weighted pick from object map {key: weight}. */
export function pickWeighted(map, rng) {
  const entries = Object.entries(map)
  let total = 0
  for (const [, w] of entries) total += w
  let r = rng.next() * total
  for (const [k, w] of entries) {
    r -= w
    if (r <= 0) return k
  }
  return entries[0][0]
}

export const KEY = {
  UP: 0,
  DOWN: 1,
  LEFT: 2,
  RIGHT: 3,
  INTERACT: 4,
  RUN: 5,
  CROUCH: 6,
  JUMP: 7,
  ATTACK: 8,
  AIM: 9,
  RELOAD: 10,
  FLASHLIGHT: 11,
  INVENTORY: 12,
  USE_ITEM: 13,
  PAUSE: 14,
  CRAFT: 15,
  LIGHT_TOGGLE: 16,
  HEAL: 17,
  DROP: 18,
}
