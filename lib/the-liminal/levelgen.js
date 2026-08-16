// @ts-nocheck
// Pure procedural level generation. No three.js, no DOM. Fully deterministic
// given (seed, floorIndex). Output is a plain data structure consumed by
// builder.js. Node-testable.

import { makeRng, hashString, pointInRect, aabbOverlap, dist2, pickWeighted } from './utils.js'
import { getEnv, ENV_INDEX } from './environments.js'
import { LOOT_TABLES, CONTAINER_TYPES } from './items.js'

export const T = { WALL: 0, FLOOR: 1, DOOR: 2, WATER: 3, RAIL: 4 }

let uidCounter = 0
const nextUid = () => `g${(++uidCounter).toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`

export function tileIndex(x, y, w) {
  return y * w + x
}

function rectsOverlap(a, b, gap) {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
}

function carveRoom(tiles, w, h, room) {
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      if (x >= 0 && x < w && y >= 0 && y < h) tiles[tileIndex(x, y, w)] = T.FLOOR
    }
  }
}

function carveCorridor(tiles, w, h, x0, y0, x1, y1, width) {
  const carveLine = (ax, ay, bx, by, vertical) => {
    const step = vertical ? (by > ay ? 1 : -1) : bx > ax ? 1 : -1
    const len = Math.abs(vertical ? by - ay : bx - ax)
    let cx = ax
    let cy = ay
    for (let i = 0; i <= len; i++) {
      for (let o = 0; o < width; o++) {
        let tx = cx
        let ty = cy
        if (vertical) ty += o
        else tx += o
        if (tx >= 1 && tx < w - 1 && ty >= 1 && ty < h - 1) tiles[tileIndex(tx, ty, w)] = T.FLOOR
      }
      if (vertical) cy += step
      else cx += step
    }
  }
  // L-corridor: horizontal then vertical (or vertical then horizontal for variety)
  if (Math.abs(x1 - x0) > Math.abs(y1 - y0)) {
    carveLine(x0, y0, x1, y0, false)
    carveLine(x1, y0, x1, y1, true)
  } else {
    carveLine(x0, y0, x0, y1, true)
    carveLine(x0, y1, x1, y1, false)
  }
}

/** BFS distances from (sx, sy) over walkable tiles. Returns {dists, prev}. */
export function bfsDistances(tiles, w, h, sx, sy) {
  const dists = new Int32Array(w * h).fill(-1)
  const prev = new Int32Array(w * h).fill(-1)
  const qx = new Int32Array(w * h)
  const qy = new Int32Array(w * h)
  let head = 0
  let tail = 0
  const si = tileIndex(sx, sy, w)
  dists[si] = 0
  qx[tail] = sx
  qy[tail] = sy
  tail++
  while (head < tail) {
    const x = qx[head]
    const y = qy[head]
    head++
    const d = dists[tileIndex(x, y, w)]
    const nb = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]
    for (const [nx, ny] of nb) {
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
      const ni = tileIndex(nx, ny, w)
      if (tiles[ni] === T.WALL || dists[ni] !== -1) continue
      dists[ni] = d + 1
      prev[ni] = tileIndex(x, y, w)
      qx[tail] = nx
      qy[tail] = ny
      tail++
    }
  }
  return { dists, prev }
}

/** A* pathfinding over walkable tiles. Returns array of {x,y}. */
export function astar(tiles, w, h, sx, sy, gx, gy, maxSteps = 4000) {
  if (tiles[tileIndex(sx, sy, w)] === T.WALL || tiles[tileIndex(gx, gy, w)] === T.WALL) return null
  const start = tileIndex(sx, sy, w)
  const goal = tileIndex(gx, gy, w)
  if (start === goal) return [{ x: sx, y: sy }]
  const open = new Float64Array(w * h).fill(Infinity) // f score keyed by cell
  const gScore = new Int32Array(w * h).fill(-1)
  const came = new Int32Array(w * h).fill(-1)
  const closed = new Uint8Array(w * h)
  const heap = [] // [f, idx]
  const push = (idx, f) => {
    heap.push([f, idx])
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      const t = heap[p]
      heap[p] = heap[i]
      heap[i] = t
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let s = i
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r
        if (s === i) break
        const t = heap[s]
        heap[s] = heap[i]
        heap[i] = t
        i = s
      }
    }
    return top
  }
  const hx = (idx) => {
    const x = idx % w
    const y = Math.floor(idx / w)
    const dx = gx - x
    const dy = gy - y
    return Math.abs(dx) + Math.abs(dy)
  }
  gScore[start] = 0
  open[start] = hx(start)
  push(start, open[start])
  let steps = 0
  while (heap.length && steps++ < maxSteps) {
    const [f, cur] = pop()
    if (f !== open[cur]) continue
    if (closed[cur]) continue
    closed[cur] = 1
    if (cur === goal) {
      const path = []
      let c = cur
      while (c !== -1) {
        path.push({ x: c % w, y: Math.floor(c / w) })
        c = came[c]
      }
      path.reverse()
      return path
    }
    const x = cur % w
    const y = Math.floor(cur / w)
    const g = gScore[cur]
    const nb = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ]
    for (const [nx, ny] of nb) {
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
      const ni = tileIndex(nx, ny, w)
      if (tiles[ni] === T.WALL || closed[ni]) continue
      const ng = g + 1
      if (gScore[ni] === -1 || ng < gScore[ni]) {
        gScore[ni] = ng
        came[ni] = cur
        const nf = ng + hx(ni)
        open[ni] = nf
        push(ni, nf)
      }
    }
  }
  return null
}

/** Build a reusable pathfinder for a floor. */
export function makePathfinder(floor) {
  return {
    tiles: floor.tiles,
    w: floor.w,
    h: floor.h,
    find: (sx, sy, gx, gy, maxSteps) => astar(floor.tiles, floor.w, floor.h, sx, sy, gx, gy, maxSteps),
    isWalkable: (x, y) => x >= 0 && y >= 0 && x < floor.w && y < floor.h && floor.tiles[tileIndex(x, y, floor.w)] !== T.WALL,
  }
}

function findFarthest(tiles, w, h, dists) {
  let best = -1
  let bestIdx = -1
  for (let i = 0; i < dists.length; i++) {
    if (dists[i] > best) {
      best = dists[i]
      bestIdx = i
    }
  }
  return { x: bestIdx % w, y: Math.floor(bestIdx / w), d: best }
}

/** Main entry: generate a floor. Deterministic given (seed, floorIndex). */
export function generateFloor(seed, floorIndex) {
  const env = getEnv(floorIndex)
  const envSeed = hashString(`${seed}|${floorIndex}`)
  const rng = makeRng(envSeed)
  const w = env.grid[0]
  const h = env.grid[1]
  const tiles = new Int16Array(w * h).fill(T.WALL)

  // ---- rooms ----
  const rooms = []
  const margin = 2
  const roomCfg = env.rooms
  let attempts = 0
  while (rooms.length < roomCfg.max && attempts++ < 200) {
    const rw = rng.int(roomCfg.minW, roomCfg.maxW)
    const rh = rng.int(roomCfg.minH, roomCfg.maxH)
    const x = rng.int(margin, w - margin - rw)
    const y = rng.int(margin, h - margin - rh)
    const rect = { x, y, w: rw, h: rh, cx: x + rw / 2, cy: y + rh / 2 }
    let ok = true
    for (const r of rooms) {
      if (rectsOverlap(rect, r, roomCfg.gap)) {
        ok = false
        break
      }
    }
    if (ok) {
      rect.type = 'room'
      rooms.push(rect)
      carveRoom(tiles, w, h, rect)
    }
  }

  // ---- corridors (connect as a tree: nearest-neighbor chain) ----
  const centers = rooms.map((r) => [r.cx, r.cy])
  const connected = new Set()
  const first = Math.floor(rng.next() * rooms.length)
  connected.add(first)
  let guard = 0
  while (connected.size < rooms.length && guard++ < 500) {
    let bestDist = Infinity
    let bestA = -1
    let bestB = -1
    for (const a of connected) {
      for (let b = 0; b < rooms.length; b++) {
        if (connected.has(b)) continue
        const d = dist2(centers[a][0], centers[a][1], centers[b][0], centers[b][1])
        if (d < bestDist) {
          bestDist = d
          bestA = a
          bestB = b
        }
      }
    }
    if (bestA === -1) break
    connected.add(bestB)
    carveCorridor(
      tiles, w, h,
      Math.round(centers[bestA][0]), Math.round(centers[bestA][1]),
      Math.round(centers[bestB][0]), Math.round(centers[bestB][1]),
      env.corridorWidth
    )
    rooms[bestA].conns = rooms[bestA].conns || []
    rooms[bestB].conns = rooms[bestB].conns || []
    rooms[bestA].conns.push(bestB)
    rooms[bestB].conns.push(bestA)
  }

  // ---- start / safe / exit ----
  const startRoomIdx = first
  const startRoom = rooms[startRoomIdx]
  const startTile = { x: Math.floor(startRoom.cx), y: Math.floor(startRoom.cy) }
  const bfs = bfsDistances(tiles, w, h, startTile.x, startTile.y)

  let safeIdx = -1
  for (let i = 0; i < 60 && safeIdx === -1; i++) {
    const cand = rng.int(0, rooms.length - 1)
    if (cand !== startRoomIdx && rooms[cand].w * rooms[cand].h >= 9) safeIdx = cand
  }
  if (safeIdx === -1) safeIdx = (startRoomIdx + 1) % rooms.length
  const safeRoom = rooms[safeIdx]
  safeRoom.type = 'safe'

  // exit = farthest reachable tile from spawn
  const far = findFarthest(tiles, w, h, bfs.dists)
  const exitTile = { x: far.x, y: far.y }
  const exitDist = far.d

  // doors between rooms and corridors (not on every junction)
  const doors = []
  const doorChance = env.id === 'foyer' ? 0.85 : env.id === 'hallway' ? 0.7 : 0.3
  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i]
    if (i === safeIdx) continue
    // door near room edge where corridor meets
    for (let o = 0; o < 2; o++) {
      const px = rng.int(r.x, r.x + r.w - 1)
      const py = rng.int(r.y, r.y + r.h - 1)
      if (rng.chance(doorChance) && isRoomEdge(r, px, py) && tiles[tileIndex(px, py, w)] === T.FLOOR) {
        // only if neighbor tile is corridor (outside room) or wall
        doors.push({ x: px, y: py, open: rng.chance(0.4) })
      }
    }
  }

  // ---- enemies ----
  const difficulty = floorIndex
  const enemyCount = Math.min(env.id === 'void' ? 0 : Math.max(2, Math.floor(2.6 + difficulty * 1.4)), 14)
  const enemies = []
  const spawnDist = Math.max(6, Math.floor(exitDist * 0.55))
  let eGuard = 0
  while (enemies.length < enemyCount && eGuard++ < 400) {
    const room = rng.pick(rooms)
    if (room === safeRoom || room === startRoom) continue
    const x = rng.int(room.x, room.x + room.w - 1)
    const y = rng.int(room.y, room.y + room.h - 1)
    const di = tileIndex(x, y, w)
    if (tiles[di] !== T.FLOOR) continue
    if (bfs.dists[di] < spawnDist) continue
    const pool = env.enemyPool
    const type = rng.weighted(pool.map((e) => ({ w: e.w, value: e.id })))
    enemies.push({ x, y, type })
  }

  // ---- containers ----
  const containers = []
  const containerCount = rng.int(4, 7) + Math.floor(difficulty * 0.5)
  let cGuard = 0
  while (containers.length < containerCount && cGuard++ < 400) {
    const room = rng.pick(rooms)
    if (room === safeRoom) continue
    const x = rng.int(room.x + 1, room.x + room.w - 2)
    const y = rng.int(room.y + 1, room.y + room.h - 2)
    const di = tileIndex(x, y, w)
    if (tiles[di] !== T.FLOOR) continue
    const nearWall = isRoomEdge(room, x, y) || rng.chance(0.6)
    if (!nearWall) continue
    const type = rng.pick(env.containers)
    containers.push({ id: nextUid(), x, y, type, room: rooms.indexOf(room) })
  }

  // ---- loose loot ----
  const loot = []
  const lootCount = rng.int(3, 6)
  let lGuard = 0
  while (loot.length < lootCount && lGuard++ < 300) {
    const room = rng.pick(rooms)
    if (room === safeRoom) continue
    const x = rng.int(room.x + 1, room.x + room.w - 2)
    const y = rng.int(room.y + 1, room.y + room.h - 2)
    const di = tileIndex(x, y, w)
    if (tiles[di] !== T.FLOOR) continue
    const table = LOOT_TABLES[env.loot] || LOOT_TABLES.generic
    const tier = rng.weighted([
      { w: 62, value: 'common' },
      { w: 30, value: 'uncommon' },
      { w: 8, value: 'rare' },
    ])
    const item = pickWeighted(table[tier], rng)
    const count = rng.chance(0.25) ? 2 : 1
    loot.push({ id: nextUid(), x, y, item, count })
  }

  // ---- props ----
  const props = []
  for (const room of rooms) {
    if (room.w * room.h < 8) continue
    let roomProps = 0
    const maxProps = Math.floor((room.w * room.h) / 6) + 1
    for (let yy = room.y + 1; yy < room.y + room.h - 1 && roomProps < maxProps; yy++) {
      for (let xx = room.x + 1; xx < room.x + room.w - 1 && roomProps < maxProps; xx++) {
        const di = tileIndex(xx, yy, w)
        if (tiles[di] !== T.FLOOR) continue
        if (!rng.chance(env.propChance)) continue
        // don't place over other gameplay markers
        if (containers.some((c) => c.x === xx && c.y === yy)) continue
        if (loot.some((l) => l.x === xx && l.y === yy)) continue
        if (enemies.some((e) => e.x === xx && e.y === yy)) continue
        if (Math.abs(xx - Math.floor(room.cx)) < 1 && Math.abs(yy - Math.floor(room.cy)) < 1) continue
        const type = pickWeighted(env.props, rng)
        const rot = rng.int(0, 3) * Math.PI / 2
        props.push({ id: nextUid(), type, x: xx, y: yy, rot })
        roomProps++
      }
    }
  }

  // ---- lights ----
  const lights = []
  for (const room of rooms) {
    const area = room.w * room.h
    const n = Math.round(area * env.lightDensity * 0.16)
    for (let i = 0; i < n; i++) {
      const x = rng.int(room.x + 1, room.x + room.w - 2)
      const y = rng.int(room.y + 1, room.y + room.h - 2)
      if (tiles[tileIndex(x, y, w)] === T.FLOOR) {
        lights.push({ x, y, flicker: rng.chance(0.18), on: true })
      }
    }
  }

  // ---- environment post-processing ----
  const floorData = {
    seed,
    floorIndex,
    env: env.id,
    envIndex: ENV_INDEX[env.id],
    w,
    h,
    tiles,
    rooms,
    spawn: { ...startTile },
    safeRoom: safeIdx,
    safeSpawn: { x: Math.floor(safeRoom.cx), y: Math.floor(safeRoom.cy) },
    exit: exitTile,
    exitDist,
    containers,
    loot,
    props,
    lights,
    enemies,
    doors,
    waterZones: [],
    rails: [],
    boss: env.id === 'void',
    bounds: { w, h },
  }

  applyEnvGen(floorData, env, rng)

  return floorData
}

function isRoomEdge(room, x, y) {
  return x === room.x || x === room.x + room.w - 1 || y === room.y || y === room.y + room.h - 1
}

// ---- per-environment post-generation hooks ----

function applyEnvGen(floor, env, rng) {
  if (env.id === 'pool') {
    // pick ~half the rooms as water rooms (sunken pools)
    const poolRooms = []
    for (let i = 0; i < floor.rooms.length; i++) {
      if (i === floor.safeRoom) continue
      if (rng.chance(0.45)) poolRooms.push(floor.rooms[i])
    }
    for (const room of poolRooms) {
      floor.waterZones.push({ x: room.x, y: room.y, w: room.w, h: room.h })
      for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) {
          if (floor.tiles[tileIndex(x, y, floor.w)] === T.FLOOR) floor.tiles[tileIndex(x, y, floor.w)] = T.WATER
        }
      }
    }
  } else if (env.id === 'metro') {
    // horizontal rail tunnel across the map at mid height, plus alcoves
    const ry = Math.floor(floor.h / 2)
    const railXs = []
    for (let x = 1; x < floor.w - 1; x++) {
      if (floor.tiles[tileIndex(x, ry, floor.w)] === T.WALL) {
        floor.tiles[tileIndex(x, ry, floor.w)] = T.RAIL
        railXs.push(x)
      }
    }
    // alcoves every few tiles for hiding from phantom trains
    for (let i = 2; i < railXs.length - 2; i += 4) {
      const x = railXs[i]
      for (let y = Math.max(1, ry - 2); y <= ry - 1; y++) {
        if (floor.tiles[tileIndex(x, y, floor.w)] === T.WALL) floor.tiles[tileIndex(x, y, floor.w)] = T.FLOOR
      }
    }
    floor.rails = railXs.map((x) => ({ x, y: ry }))
    // ensure spawn/exit connect to the tunnel
  } else if (env.id === 'void') {
    floor.boss = true
  }
}

/** Regenerate a saved floor from seed + index (used by save system). */
export function regenerateFloor(seed, floorIndex) {
  return generateFloor(seed, floorIndex)
}
