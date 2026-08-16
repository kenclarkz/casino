import { test, expect } from './helpers.mjs'
import {
  setStorage,
  saveData,
  loadData,
  clearData,
  saveGame,
  loadGame,
  hasSave,
  clearSave,
  newSaveState,
  applyDeath,
  serializeRun,
  difficultyForFloor,
  loadSettings,
  saveSettings,
} from '../../lib/the-liminal/save.js'
import { Inventory } from '../../lib/the-liminal/inventory.js'
import { PLAYER } from '../../lib/the-liminal/config.js'

// In-memory storage mock
const mem = new Map()
const mockStorage = {
  setItem: (k, v) => mem.set(k, String(v)),
  getItem: (k) => mem.get(k) ?? null,
  removeItem: (k) => mem.delete(k),
}
setStorage(mockStorage)

test('data round-trips through storage', () => {
  saveData('test-key', { a: 1, b: 'two' })
  expect(loadData('test-key')).toEqual({ a: 1, b: 'two' })
  clearData('test-key')
  expect(loadData('test-key')).toBe(null)
})

test('new save state is complete', () => {
  const s = newSaveState(123)
  expect(s.seed).toBe(123)
  expect(s.floorIndex).toBe(0)
  expect(s.health).toBe(PLAYER.healthMax)
  expect(s.inventory.slots.length).toBe(0)
})

test('saveGame / loadGame round-trip with inventory', () => {
  clearSave()
  expect(hasSave()).toBe(false)
  const s = newSaveState(42)
  const inv = s.inventory
  inv.add('scrap', 9)
  inv.add('pistol')
  inv.equip('pistol', 'gun')
  saveGame(s, { x: 1, y: 2, z: 3 }, { x: 0.1, y: 0.5 })
  expect(hasSave()).toBe(true)
  const loaded = loadGame()
  expect(loaded.seed).toBe(42)
  expect(loaded.pos).toEqual({ x: 1, y: 2, z: 3 })
  expect(loaded.inventory.count('scrap')).toBe(9)
  expect(loaded.inventory.equippedGun.id).toBe('pistol')
  clearSave()
  expect(hasSave()).toBe(false)
})

test('serializeRun is plain JSON-safe', () => {
  const s = newSaveState(1)
  const plain = serializeRun(s)
  const json = JSON.parse(JSON.stringify(plain))
  expect(json.seed).toBe(1)
})

test('applyDeath reduces health and drops loot but keeps equipment', () => {
  const s = newSaveState(5)
  const inv = s.inventory
  inv.add('scrap', 10)
  inv.add('cloth', 10)
  inv.add('pipe')
  inv.equip('pipe', 'melee')
  inv.add('bandage', 4)
  applyDeath(s, () => 0) // deterministic: always drop
  expect(s.health).toBeLessThan(PLAYER.healthMax)
  expect(inv.count('scrap')).toBeLessThan(10)
  expect(inv.count('cloth')).toBeLessThan(10)
  expect(inv.count('bandage')).toBeLessThan(4)
  expect(inv.equippedMelee).toBeTruthy()
  expect(inv.count('pipe')).toBe(1)
  expect(s.stats.deaths).toBe(1)
})

test('difficultyForFloor escalates', () => {
  const d0 = difficultyForFloor(0)
  const d9 = difficultyForFloor(9)
  expect(d9.enemyHp).toBeGreaterThan(d0.enemyHp)
  expect(d9.enemySpeed).toBeGreaterThan(d0.enemySpeed)
  expect(d9.enemyDmg).toBeGreaterThan(d0.enemyDmg)
  expect(d9.enemyCount).toBeGreaterThan(d0.enemyCount)
  expect(d9.loot).toBeLessThan(d0.loot)
  expect(d9.aggroRange).toBeGreaterThan(d0.aggroRange)
})

test('settings merge with defaults', () => {
  saveSettings({ sensitivity: 0.5 })
  const s = loadSettings()
  expect(s.sensitivity).toBe(0.5)
  expect(s.masterVolume).toBeGreaterThan(0)
})
