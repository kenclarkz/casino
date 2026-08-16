import { test, expect } from './helpers.mjs'
import {
  generateFloor,
  astar,
  bfsDistances,
  makePathfinder,
  tileIndex,
  T,
} from '../../lib/the-liminal/levelgen.js'
import { ENVIRONMENTS } from '../../lib/the-liminal/environments.js'

test('generation is deterministic for same seed+floor', () => {
  const a = generateFloor(1234, 2)
  const b = generateFloor(1234, 2)
  expect(a.tiles).toEqual(b.tiles)
  expect(a.enemies.length).toBe(b.enemies.length)
  expect(a.spawn).toEqual(b.spawn)
  expect(a.exit).toEqual(b.exit)
  expect(a.lights.length).toBe(b.lights.length)
})

test('different seeds give different floors', () => {
  const a = generateFloor(1, 2)
  const b = generateFloor(2, 2)
  let diff = 0
  for (let i = 0; i < a.tiles.length; i++) if (a.tiles[i] !== b.tiles[i]) diff++
  expect(diff).toBeGreaterThan(50)
})

test('every floor is fully connected and valid', () => {
  for (let floor = 0; floor < ENVIRONMENTS.length; floor++) {
    for (const seed of [1, 7, 99]) {
      const f = generateFloor(seed, floor)
      expect(f.w).toBe(ENVIRONMENTS[floor].grid[0])
      expect(f.h).toBe(ENVIRONMENTS[floor].grid[1])
      const bfs = bfsDistances(f.tiles, f.w, f.h, f.spawn.x, f.spawn.y)
      // spawn, safe, exit all reachable
      expect(bfs.dists[tileIndex(f.spawn.x, f.spawn.y, f.w)]).toBe(0)
      expect(bfs.dists[tileIndex(f.safeSpawn.x, f.safeSpawn.y, f.w)]).toBeGreaterThanOrEqual(0)
      expect(bfs.dists[tileIndex(f.exit.x, f.exit.y, f.w)]).toBeGreaterThan(0)
      // every room center reachable
      for (const room of f.rooms) {
        const ci = tileIndex(Math.floor(room.cx), Math.floor(room.cy), f.w)
        expect(bfs.dists[ci]).toBeGreaterThanOrEqual(0)
      }
    }
  }
})

test('astar finds path between spawn and exit', () => {
  const f = generateFloor(555, 3)
  const pf = makePathfinder(f)
  const path = pf.find(f.spawn.x, f.spawn.y, f.exit.x, f.exit.y)
  expect(path).toBeTruthy()
  expect(path[0].x).toBe(f.spawn.x)
  expect(path[path.length - 1].x).toBe(f.exit.x)
  expect(path[path.length - 1].y).toBe(f.exit.y)
  for (const p of path) expect(pf.isWalkable(p.x, p.y)).toBe(true)
})

test('astar returns null for unreachable target', () => {
  const f = generateFloor(555, 3)
  const pf = makePathfinder(f)
  let wall = null
  outer: for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      if (f.tiles[tileIndex(x, y, f.w)] === T.WALL) {
        wall = { x, y }
        break outer
      }
    }
  }
  expect(wall).toBeTruthy()
  const res = pf.find(f.spawn.x, f.spawn.y, wall.x, wall.y)
  expect(res).toBe(null)
})

test('enemies avoid the safe room and spawn', () => {
  const f = generateFloor(2024, 4)
  const safeRoom = f.rooms[f.safeRoom]
  for (const e of f.enemies) {
    const insideSafe = e.x >= safeRoom.x && e.x < safeRoom.x + safeRoom.w && e.y >= safeRoom.y && e.y < safeRoom.y + safeRoom.h
    expect(insideSafe).toBe(false)
    expect(f.tiles[tileIndex(e.x, e.y, f.w)]).not.toBe(T.WALL)
  }
})

test('enemy count scales with depth', () => {
  const f0 = generateFloor(11, 0)
  const f8 = generateFloor(11, 8)
  expect(f8.enemies.length).toBeGreaterThan(f0.enemies.length)
})

test('metro floor has rails, pool has water zones', () => {
  const metro = generateFloor(333, 8)
  expect(metro.rails.length).toBeGreaterThan(5)
  let railCount = 0
  for (const r of metro.rails) if (metro.tiles[tileIndex(r.x, r.y, metro.w)] === T.RAIL) railCount++
  expect(railCount).toBe(metro.rails.length)

  const pool = generateFloor(333, 3)
  expect(pool.waterZones.length).toBeGreaterThan(0)
  let waterCount = 0
  for (let i = 0; i < pool.tiles.length; i++) if (pool.tiles[i] === T.WATER) waterCount++
  expect(waterCount).toBeGreaterThan(0)
})

test('loot and containers exist on floor tiles', () => {
  const f = generateFloor(77, 2)
  for (const c of f.containers) expect(f.tiles[tileIndex(c.x, c.y, f.w)]).not.toBe(T.WALL)
  for (const l of f.loot) expect(f.tiles[tileIndex(l.x, l.y, f.w)]).not.toBe(T.WALL)
})
