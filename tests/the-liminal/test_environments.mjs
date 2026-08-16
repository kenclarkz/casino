import { test, expect } from './helpers.mjs'
import { ENVIRONMENTS, FLOOR_COUNT, getEnv, ENV_INDEX } from '../../lib/the-liminal/environments.js'
import { LOOT_TABLES } from '../../lib/the-liminal/items.js'

test('there are exactly 10 environments', () => {
  expect(FLOOR_COUNT).toBe(10)
  expect(ENVIRONMENTS.length).toBe(10)
})

test('environments are complete data definitions', () => {
  for (const e of ENVIRONMENTS) {
    expect(typeof e.id).toBe('string')
    expect(ENV_INDEX[e.id]).toBeGreaterThanOrEqual(0)
    expect(e.grid.length).toBe(2)
    expect(e.grid[0]).toBeGreaterThan(10)
    expect(e.palette.fog).toBeTruthy()
    expect(e.fog.length).toBe(2)
    expect(e.ambience.drone).toBeGreaterThan(0)
    expect(e.enemyPool.length).toBeGreaterThan(0)
    expect(e.events.length).toBeGreaterThan(0)
    expect(e.lore.length).toBeGreaterThan(0)
    expect(LOOT_TABLES[e.loot]).toBeTruthy()
  }
})

test('getEnv clamps out of range floors', () => {
  expect(getEnv(0).id).toBe('foyer')
  expect(getEnv(9).id).toBe('void')
  expect(getEnv(99).id).toBe('void')
  expect(getEnv(-3).id).toBe('foyer')
})

test('environment ids are unique', () => {
  const ids = new Set(ENVIRONMENTS.map((e) => e.id))
  expect(ids.size).toBe(10)
})

test('void env is last and boss floor', () => {
  expect(ENVIRONMENTS[9].id).toBe('void')
})
