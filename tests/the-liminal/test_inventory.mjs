import { test, expect } from './helpers.mjs'
import { Inventory } from '../../lib/the-liminal/inventory.js'
import { CRAFTING, canCraft, craft } from '../../lib/the-liminal/items.js'

test('add / count / remove basics', () => {
  const inv = new Inventory(6)
  expect(inv.add('scrap', 5)).toBe(true)
  expect(inv.count('scrap')).toBe(5)
  expect(inv.remove('scrap', 2)).toBe(true)
  expect(inv.count('scrap')).toBe(3)
})

test('stacking respects limits and capacity', () => {
  const inv = new Inventory(2)
  inv.add('scrap', 20)
  expect(inv.slots.length).toBe(1)
  inv.add('scrap', 20)
  expect(inv.slots.length).toBe(2)
  const ok = inv.add('scrap', 1)
  expect(ok).toBe(false)
  expect(inv.count('scrap')).toBe(40)
})

test('canAdd checks space', () => {
  const inv = new Inventory(1)
  inv.add('scrap', 20)
  expect(inv.canAdd('scrap', 1)).toBe(false)
  expect(inv.canAdd('wire', 1)).toBe(false)
  const inv2 = new Inventory(2)
  inv2.add('scrap', 20)
  expect(inv2.canAdd('wire', 1)).toBe(true)
})

test('equip melee/gun and best equipment', () => {
  const inv = new Inventory(12)
  inv.add('pipe')
  inv.add('pistol')
  inv.equip('pipe', 'melee')
  inv.equip('pistol', 'gun')
  expect(inv.equippedMelee.id).toBe('pipe')
  expect(inv.equippedGun.id).toBe('pistol')
  const best = inv.equipBest('melee')
  expect(best).toBe('pipe')
  expect(inv.equipBest('gun')).toBe('pistol')
})

test('equipBest returns better weapon when available', () => {
  const inv = new Inventory(12)
  inv.add('knife')
  inv.add('axe')
  expect(inv.equipBest('melee')).toBe('axe')
  expect(inv.equippedMelee.id).toBe('axe')
})

test('durability damage breaks weapon', () => {
  const inv = new Inventory(12)
  inv.add('pipe')
  inv.equip('pipe', 'melee')
  inv.slots[inv.equipped.melee].dur = 3
  inv.damageMelee(2)
  expect(inv.equippedMelee.dur).toBe(1)
  expect(inv.damageMelee(5)).toBe(true)
  expect(inv.equippedMelee).toBe(null)
})

test('removing an equipped item clears the slot', () => {
  const inv = new Inventory(12)
  inv.add('pipe')
  inv.equip('pipe', 'melee')
  inv.remove('pipe')
  expect(inv.equipped.melee).toBe(-1)
})

test('crafting flows: bandage, battery, medkit, molotov', () => {
  const inv = new Inventory(24)
  inv.add('cloth', 4)
  inv.add('chemical', 4)
  inv.add('wire', 2)
  inv.add('scrap', 4)
  inv.add('match', 2)
  inv.add('fuel', 2)

  const bandage = CRAFTING.find((r) => r.id === 'craft_bandage')
  expect(canCraft(bandage, inv)).toBe(true)
  expect(craft(bandage, inv)).toBe(true)
  expect(inv.count('bandage')).toBe(1)
  expect(inv.count('cloth')).toBe(3)
  expect(craft(bandage, inv)).toBe(true)
  expect(inv.count('bandage')).toBe(2)

  const battery = CRAFTING.find((r) => r.id === 'craft_battery')
  expect(craft(battery, inv)).toBe(true)
  expect(inv.count('battery')).toBe(1)

  const molotov = CRAFTING.find((r) => r.id === 'craft_molotov')
  expect(craft(molotov, inv)).toBe(true)
  expect(inv.count('molotov')).toBe(1)

  const medkit = CRAFTING.find((r) => r.id === 'craft_medkit')
  expect(canCraft(medkit, inv)).toBe(true)
  expect(craft(medkit, inv)).toBe(true)
  expect(inv.count('medkit')).toBe(1)
})

test('gun ammo crafting requires seeing the gun first', () => {
  const inv = new Inventory(24)
  inv.add('scrap', 5)
  inv.add('chemical', 5)
  const recipe = CRAFTING.find((r) => r.id === 'craft_pistol_ammo')
  expect(canCraft(recipe, inv)).toBe(false)
  inv.add('pistol')
  expect(canCraft(recipe, inv)).toBe(true)
  expect(craft(recipe, inv)).toBe(true)
  expect(inv.count('ammo_pistol')).toBe(6)
})

test('serialize / deserialize round trip', () => {
  const inv = new Inventory(24)
  inv.add('scrap', 7)
  inv.add('pistol')
  inv.equip('pistol', 'gun')
  inv.addNote('foyer1')
  const inv2 = Inventory.deserialize(JSON.parse(JSON.stringify(inv.serialize())))
  expect(inv2.count('scrap')).toBe(7)
  expect(inv2.equippedGun.id).toBe('pistol')
  expect(inv2.notes.has('foyer1')).toBe(true)
})
