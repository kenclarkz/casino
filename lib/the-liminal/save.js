// @ts-nocheck
// Save / load / settings persistence. Uses an injectable storage adapter so it
// is testable in Node (pass a mock). In the browser it defaults to localStorage.

import { GAME, PLAYER, FLASHLIGHT, DIFFICULTY, CHECKPOINT } from './config.js'
import { Inventory } from './inventory.js'

function defaultStorage() {
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null
  } catch {
    return null
  }
}

let storage = defaultStorage()
export function setStorage(s) {
  storage = s
}

export function saveData(key, obj) {
  if (!storage) return false
  try {
    storage.setItem(key, JSON.stringify(obj))
    return true
  } catch {
    return false
  }
}

export function loadData(key) {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function clearData(key) {
  if (!storage) return
  try {
    storage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export const DEFAULT_SETTINGS = {
  sensitivity: 1,
  invertY: false,
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.7,
  brightness: 1,
  crouchToggle: false,
  holdBreathKey: 'ShiftLeft',
  controllerLookSpeed: 2.6,
  shadows: true,
}

export function loadSettings() {
  const s = { ...DEFAULT_SETTINGS }
  const d = loadData(GAME.settingsKey)
  if (d) Object.assign(s, d)
  return s
}

export function saveSettings(s) {
  saveData(GAME.settingsKey, s)
}

/** Build a fresh save state for a new game. */
export function newSaveState(seed, floor = 0) {
  return {
    version: GAME.version,
    seed,
    floorIndex: floor,
    pos: null,
    rot: null,
    health: PLAYER.healthMax,
    stamina: PLAYER.staminaMax,
    battery: FLASHLIGHT.batteryMax,
    inventory: new Inventory(),
    claimed: [],
    killed: [],
    noteRead: [],
    playTime: 0,
    stats: { kills: 0, looted: 0, shots: 0, meleeHits: 0, deaths: 0 },
  }
}

/**
 * Save current game state. Only allowed at checkpoints (safe rooms / floor
 * start). `pos`/`rot` are the respawn point (safe room).
 */
export function saveGame(state, pos, rot) {
  const payload = {
    ...state,
    savedAt: Date.now(),
    pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : state.pos,
    rot: rot ? { y: rot.y, x: rot.x } : state.rot,
    inventory: state.inventory.serialize ? state.inventory.serialize() : state.inventory,
  }
  return saveData(GAME.saveKey, payload)
}

export function loadGame() {
  const d = loadData(GAME.saveKey)
  if (!d) return null
  try {
    d.inventory = Inventory.deserialize(d.inventory)
  } catch {
    d.inventory = new Inventory()
  }
  return d
}

export function hasSave() {
  return !!loadData(GAME.saveKey)
}

export function clearSave() {
  clearData(GAME.saveKey)
}

export function difficultyForFloor(d) {
  return {
    enemyHp: DIFFICULTY.enemyHpMul(d),
    enemySpeed: DIFFICULTY.enemySpeedMul(d),
    enemyDmg: DIFFICULTY.enemyDmgMul(d),
    enemyCount: DIFFICULTY.enemyCount(d),
    loot: DIFFICULTY.lootScarcity(d),
    ammo: DIFFICULTY.ammoScarcity(d),
    eventFreq: DIFFICULTY.eventFreq(d),
    darkness: DIFFICULTY.darknessMul(d),
    aggroRange: DIFFICULTY.aggroRange(d),
  }
}

export function applyDeath(state, rng = Math.random) {
  const inv = state.inventory
  // lose a fraction of non-equipment items
  const removable = inv.slots.filter(
    (s, idx) =>
      s.dur == null &&
      inv.equipped.melee !== idx &&
      inv.equipped.gun !== idx
  )
  for (const s of removable) {
    if (rng() < CHECKPOINT.lostLootFrac) {
      const dropCount = Math.max(1, Math.floor(s.count * CHECKPOINT.lostLootFrac))
      inv.remove(s.id, Math.min(s.count, dropCount))
    }
  }
  state.health = Math.round(PLAYER.healthMax * CHECKPOINT.reviveHealthFrac)
  state.stamina = PLAYER.staminaMax * CHECKPOINT.reviveStaminaFrac
  state.battery = Math.max(state.battery, FLASHLIGHT.batteryMax * CHECKPOINT.reviveBatteryFrac)
  state.stats.deaths = (state.stats.deaths || 0) + 1
  return state
}

export function serializeRun(state) {
  return {
    version: state.version,
    seed: state.seed,
    floorIndex: state.floorIndex,
    health: state.health,
    stamina: state.stamina,
    battery: state.battery,
    inventory: state.inventory.serialize ? state.inventory.serialize() : state.inventory,
    claimed: state.claimed,
    killed: state.killed,
    noteRead: state.noteRead,
    playTime: state.playTime,
    stats: state.stats,
  }
}
