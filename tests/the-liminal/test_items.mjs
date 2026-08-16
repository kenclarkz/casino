import { test, expect } from './helpers.mjs'
import { ITEMS, ITEM_IDS, CRAFTING, LOOT_TABLES, CONTAINER_TYPES, itemDef } from '../../lib/the-liminal/items.js'

test('every item id has a definition', () => {
  for (const id of ITEM_IDS) {
    expect(itemDef(id)).toBeTruthy()
    expect(typeof itemDef(id).name).toBe('string')
    expect(itemDef(id).stack).toBeGreaterThan(0)
  }
})

test('weapon stats are sane', () => {
  const axe = itemDef('axe')
  expect(axe.weapon.slot).toBe('melee')
  expect(axe.weapon.dmg).toBeGreaterThan(10)
  const shotgun = itemDef('shotgun')
  expect(shotgun.weapon.pellets).toBeGreaterThan(1)
  expect(shotgun.weapon.loud).toBeGreaterThan(100)
})

test('crafting recipes reference real items', () => {
  for (const r of CRAFTING) {
    for (const id of Object.keys(r.inputs)) expect(ITEMS[id]).toBeTruthy()
    for (const id of Object.keys(r.outputs)) expect(ITEMS[id]).toBeTruthy()
  }
})

test('loot tables reference real items', () => {
  for (const table of Object.values(LOOT_TABLES)) {
    for (const tier of ['common', 'uncommon', 'rare']) {
      for (const id of Object.keys(table[tier])) expect(ITEMS[id]).toBeTruthy()
    }
  }
})

test('container types have sane values', () => {
  for (const c of Object.values(CONTAINER_TYPES)) {
    expect(c.lootChance).toBeGreaterThan(0)
    expect(c.max).toBeGreaterThan(0)
  }
})
