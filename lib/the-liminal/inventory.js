// @ts-nocheck
// Inventory model + equipment. Pure logic (no DOM / three). Node-testable.

import { ITEMS, WEAPON_SLOT_GUN, WEAPON_SLOT_MELEE } from './items.js'

export class Inventory {
  constructor(capacity = 24) {
    this.capacity = capacity
    this.slots = [] // { id, count, dur? }
    this.equipped = { melee: -1, gun: -1 }
    this.seenWeapons = new Set()
    this.notes = new Set()
    this.molotovReady = 0
  }

  slotCount() {
    return this.slots.length
  }

  count(id) {
    let n = 0
    for (const s of this.slots) if (s.id === id) n += s.count
    return n
  }

  has(id, n = 1) {
    return this.count(id) >= n
  }

  findSlot(id) {
    return this.slots.findIndex((s) => s.id === id)
  }

  stackLimit(id) {
    const def = ITEMS[id]
    return def ? def.stack : 1
  }

  canAdd(id, count = 1) {
    const lim = this.stackLimit(id)
    let space = 0
    for (const s of this.slots) if (s.id === id) space += Math.max(0, lim - s.count)
    const emptySlots = this.capacity - this.slots.length
    return space + emptySlots * lim >= count
  }

  add(id, count = 1, dur) {
    const def = ITEMS[id]
    if (!def) return false
    let remaining = count
    const lim = this.stackLimit(id)
    // fill existing stacks
    for (const s of this.slots) {
      if (s.id === id && s.count < lim && remaining > 0) {
        const take = Math.min(lim - s.count, remaining)
        s.count += take
        remaining -= take
      }
    }
    // new slots
    while (remaining > 0 && this.slots.length < this.capacity) {
      const take = Math.min(lim, remaining)
      this.slots.push({ id, count: take, dur: dur ?? null })
      remaining -= take
    }
    if (def.cat === 'gun' || def.cat === 'melee') this.seenWeapons.add(id)
    return remaining === 0
  }

  remove(id, count = 1) {
    let remaining = count
    for (let i = this.slots.length - 1; i >= 0 && remaining > 0; i--) {
      const s = this.slots[i]
      if (s.id !== id) continue
      const take = Math.min(s.count, remaining)
      s.count -= take
      remaining -= take
      if (s.count <= 0) {
        if (this.equipped.melee === i) this.equipped.melee = -1
        if (this.equipped.gun === i) this.equipped.gun = -1
        this.slots.splice(i, 1)
        this._fixEquipIndices(i)
      }
    }
    return remaining === 0
  }

  _fixEquipIndices(from) {
    if (this.equipped.melee > from) this.equipped.melee--
    if (this.equipped.gun > from) this.equipped.gun--
  }

  get equippedMelee() {
    return this.equipped.melee >= 0 && this.equipped.melee < this.slots.length ? this.slots[this.equipped.melee] : null
  }

  get equippedGun() {
    return this.equipped.gun >= 0 && this.equipped.gun < this.slots.length ? this.slots[this.equipped.gun] : null
  }

  equip(id, slot) {
    const idx = this.findSlot(id)
    if (idx === -1) return false
    this.equipped[slot] = idx
    return true
  }

  equipBest(slot) {
    const preferred = slot === WEAPON_SLOT_MELEE
      ? ['axe', 'bat', 'knife', 'pipe', 'fists']
      : ['rifle', 'shotgun', 'pistol']
    for (const id of preferred) {
      const idx = this.findSlot(id)
      if (idx !== -1) {
        this.equipped[slot] = idx
        return id
      }
    }
    return null
  }

  hasGun() {
    return !!this.equippedGun
  }

  get ammoForEquippedGun() {
    const g = this.equippedGun
    if (!g) return 0
    const def = ITEMS[g.id]
    return def && def.weapon ? this.count(def.weapon.ammo) : 0
  }

  /** Damage a durable melee weapon. Returns true if it broke. */
  damageMelee(dur) {
    const m = this.equippedMelee
    if (!m || m.dur == null) return false
    m.dur -= dur
    if (m.dur <= 0) {
      this.remove(m.id, 1)
      return true
    }
    return false
  }

  consume(id, n = 1) {
    return this.remove(id, n)
  }

  addNote(noteId) {
    this.notes.add(noteId)
  }

  serialize() {
    return {
      slots: this.slots.map((s) => ({ id: s.id, count: s.count, dur: s.dur })),
      equipped: { ...this.equipped },
      seenWeapons: [...this.seenWeapons],
      notes: [...this.notes],
    }
  }

  static deserialize(data, capacity) {
    const inv = new Inventory(capacity)
    if (!data) return inv
    inv.slots = (data.slots || []).map((s) => ({ id: s.id, count: s.count, dur: s.dur ?? null }))
    inv.equipped = { melee: data.equipped?.melee ?? -1, gun: data.equipped?.gun ?? -1 }
    inv.seenWeapons = new Set(data.seenWeapons || [])
    inv.notes = new Set(data.notes || [])
    return inv
  }
}
