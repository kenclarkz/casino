// @ts-nocheck
// Item definitions, weapon stats, ammo, crafting recipes. Pure data + pure logic.
// All functions here are side-effect free. Node-testable.

export const WEAPON_SLOT_MELEE = 'melee'
export const WEAPON_SLOT_GUN = 'gun'

export const ITEMS = {
  // ---- crafting materials ----
  scrap: { name: 'Scrap Metal', cat: 'craft', stack: 20, desc: 'Bent, rusted metal torn from the walls.' },
  cloth: { name: 'Torn Cloth', cat: 'craft', stack: 20, desc: 'Fabric that smells faintly of old air.' },
  chemical: { name: 'Chemical', cat: 'craft', stack: 12, desc: 'A sealed vial of something that fizzes.' },
  wire: { name: 'Copper Wire', cat: 'craft', stack: 15, desc: 'Still humming. Best not to ask what powers it.' },
  fuel: { name: 'Fuel', cat: 'craft', stack: 10, desc: 'Thick, dark liquid in a glass jar.' },
  match: { name: 'Matchbook', cat: 'craft', stack: 12, desc: 'Almost full. Someone left it here on purpose.' },
  battery: { name: 'Battery Cell', cat: 'consumable', stack: 6, desc: 'Cold to the touch. Restores flashlight power.' },
  bandage: { name: 'Bandage', cat: 'consumable', stack: 8, desc: 'Sterile-looking. Restores 25 health.' },
  medkit: { name: 'Medkit', cat: 'consumable', stack: 4, desc: 'A field kit with an impossible symbol on it. Restores 60 health.' },
  food: { name: 'Canned Food', cat: 'consumable', stack: 8, desc: 'The label has been scratched blank. Restores 12 health.' },
  water: { name: 'Water Bottle', cat: 'consumable', stack: 8, desc: 'Clear. Restores stamina.' },
  molotov: { name: 'Molotov', cat: 'throwable', stack: 4, desc: 'Fire remembers you. Throws a burning area.' },
  note: { name: 'Note', cat: 'note', stack: 99, desc: 'Scrawled words from someone who was here.' },

  // ---- ammo ----
  ammo_pistol: { name: '9mm Rounds', cat: 'ammo', stack: 40, desc: 'Pistol ammunition. Loud, bright, temporary.' },
  ammo_shell: { name: 'Shells', cat: 'ammo', stack: 30, desc: '12-gauge. Room-clearing noise.' },
  ammo_rifle: { name: 'Rifle Rounds', cat: 'ammo', stack: 30, desc: 'Rare. Precision noise.' },

  // ---- melee weapons ----
  fists: {
    name: 'Fists', cat: 'melee', stack: 1, desc: 'Bare knuckles and bad intentions.',
    weapon: { slot: WEAPON_SLOT_MELEE, dmg: 6, speed: 0.34, range: 1.9, stamina: 6, crit: 0.05, knockback: 4 },
  },
  pipe: {
    name: 'Pipe', cat: 'melee', stack: 1, desc: 'A length of iron pipe. Quiet and final.',
    weapon: { slot: WEAPON_SLOT_MELEE, dmg: 16, speed: 0.45, range: 2.2, stamina: 8, crit: 0.08, knockback: 7, durability: 120 },
  },
  knife: {
    name: 'Knife', cat: 'melee', stack: 1, desc: 'Fast. Sharp. Gets you out of rooms faster than it gets you into trouble.',
    weapon: { slot: WEAPON_SLOT_MELEE, dmg: 13, speed: 0.3, range: 2.0, stamina: 5, crit: 0.28, knockback: 4, durability: 90 },
  },
  bat: {
    name: 'Bat', cat: 'melee', stack: 1, desc: 'Weighted at the end. Knocks things down.',
    weapon: { slot: WEAPON_SLOT_MELEE, dmg: 22, speed: 0.5, range: 2.4, stamina: 10, crit: 0.1, knockback: 12, durability: 100 },
  },
  axe: {
    name: 'Fire Axe', cat: 'melee', stack: 1, desc: 'Emergency glass. Emergency everything.',
    weapon: { slot: WEAPON_SLOT_MELEE, dmg: 32, speed: 0.62, range: 2.5, stamina: 14, crit: 0.12, knockback: 10, durability: 65 },
  },

  // ---- firearms ----
  pistol: {
    name: 'Pistol', cat: 'gun', stack: 1, desc: 'A standard-issue sidearm. Pull the trigger, everyone knows.',
    weapon: {
      slot: WEAPON_SLOT_GUN, dmg: 24, fireRate: 0.24, reload: 1.3, magSize: 12, ammo: 'ammo_pistol',
      spread: 0.02, recoil: 0.02, pellets: 1, knockback: 8, range: 90, loud: 100, aimZoom: 0.8,
    },
  },
  shotgun: {
    name: 'Shotgun', cat: 'gun', stack: 1, desc: 'A pump-action promise. One pull, one corridor.',
    weapon: {
      slot: WEAPON_SLOT_GUN, dmg: 8, fireRate: 0.85, reload: 1.8, magSize: 5, ammo: 'ammo_shell',
      spread: 0.12, recoil: 0.06, pellets: 7, knockback: 22, range: 50, loud: 110, aimZoom: 0.85,
    },
  },
  rifle: {
    name: 'Rifle', cat: 'gun', stack: 1, desc: 'Precision tool. Rounds almost impossible to find.',
    weapon: {
      slot: WEAPON_SLOT_GUN, dmg: 40, fireRate: 0.34, reload: 1.5, magSize: 8, ammo: 'ammo_rifle',
      spread: 0.004, recoil: 0.012, pellets: 1, knockback: 12, range: 120, loud: 105, aimZoom: 0.7,
    },
  },
}

export const ITEM_IDS = Object.keys(ITEMS)

export function itemDef(id) {
  return ITEMS[id]
}

export const CRAFTING = [
  {
    id: 'craft_bandage', name: 'Bandage', outputs: { bandage: 1 }, inputs: { cloth: 1, chemical: 1 },
    requireSeen: false,
  },
  {
    id: 'craft_battery', name: 'Battery Cell', outputs: { battery: 1 }, inputs: { scrap: 1, wire: 1 },
    requireSeen: false,
  },
  {
    id: 'craft_pistol_ammo', name: '9mm Rounds', outputs: { ammo_pistol: 6 }, inputs: { scrap: 1, chemical: 1 },
    requireSeen: 'pistol',
  },
  {
    id: 'craft_shells', name: 'Shells', outputs: { ammo_shell: 4 }, inputs: { scrap: 2, fuel: 1 },
    requireSeen: 'shotgun',
  },
  {
    id: 'craft_rifle_ammo', name: 'Rifle Rounds', outputs: { ammo_rifle: 4 }, inputs: { scrap: 2, wire: 1, chemical: 1 },
    requireSeen: 'rifle',
  },
  {
    id: 'craft_molotov', name: 'Molotov', outputs: { molotov: 1 }, inputs: { match: 1, fuel: 1 },
    requireSeen: false,
  },
  {
    id: 'craft_medkit', name: 'Medkit', outputs: { medkit: 1 }, inputs: { bandage: 2, chemical: 1, cloth: 1 },
    requireSeen: false,
  },
]

export function canCraft(recipe, inventory) {
  if (recipe.requireSeen && !inventory.seenWeapons.has(recipe.requireSeen)) return false
  for (const [item, n] of Object.entries(recipe.inputs)) {
    if ((inventory.count(item) || 0) < n) return false
  }
  // Room to store outputs
  const out = Object.entries(recipe.outputs)
  for (const [item, n] of out) {
    if (!inventory.canAdd(item, n)) return false
  }
  return true
}

export function craft(recipe, inventory) {
  if (!canCraft(recipe, inventory)) return false
  for (const [item, n] of Object.entries(recipe.inputs)) {
    inventory.remove(item, n)
  }
  for (const [item, n] of Object.entries(recipe.outputs)) {
    inventory.add(item, n)
  }
  return true
}

// Loot tables. Keyed by environment family. `rng` picks from weights.
export const LOOT_TABLES = {
  generic: {
    common: { scrap: 30, cloth: 20, wire: 8, food: 12, water: 10, match: 10 },
    uncommon: { battery: 10, bandage: 12, chemical: 10, ammo_pistol: 8, fuel: 7 },
    rare: { medkit: 3, ammo_shell: 3, pistol: 1.2, knife: 3, pipe: 2 },
  },
  backrooms: {
    common: { scrap: 30, cloth: 18, food: 16, water: 14, match: 14 },
    uncommon: { battery: 12, chemical: 12, wire: 10, bandage: 10, ammo_pistol: 6, fuel: 5 },
    rare: { medkit: 4, ammo_shell: 2, bat: 2, shotgun: 0.8 },
  },
  office: {
    common: { scrap: 22, cloth: 16, chemical: 16, food: 10, match: 8 },
    uncommon: { bandage: 12, wire: 14, battery: 8, ammo_pistol: 10, water: 8 },
    rare: { medkit: 3, ammo_shell: 3, pistol: 1.2, knife: 3 },
  },
  hospital: {
    common: { bandage: 20, cloth: 18, chemical: 14, food: 12, water: 14 },
    uncommon: { medkit: 6, battery: 12, scrap: 12, ammo_pistol: 6 },
    rare: { medkit: 6, ammo_shell: 3, axe: 1.6, shotgun: 0.7 },
  },
  metro: {
    common: { scrap: 30, match: 14, chemical: 10, food: 12, water: 12 },
    uncommon: { battery: 14, wire: 12, fuel: 10, ammo_pistol: 6, ammo_shell: 5 },
    rare: { medkit: 3, ammo_rifle: 3, rifle: 0.5, axe: 1.4 },
  },
  void: {
    common: { scrap: 20, match: 16, chemical: 10, fuel: 12 },
    uncommon: { battery: 16, medkit: 6, ammo_shell: 8, ammo_pistol: 8, ammo_rifle: 6 },
    rare: { medkit: 8, ammo_rifle: 8, molotov: 4, axe: 2 },
  },
}

export const CONTAINER_TYPES = {
  box: { name: 'Cardboard Box', lootChance: 0.85, max: 2, model: 'box' },
  locker: { name: 'Locker', lootChance: 0.7, max: 2, model: 'locker' },
  desk: { name: 'Desk Drawer', lootChance: 0.55, max: 1, model: 'desk' },
  shelf: { name: 'Shelf', lootChance: 0.6, max: 1, model: 'shelf' },
  cabinet: { name: 'Cabinet', lootChance: 0.75, max: 2, model: 'cabinet' },
  bin: { name: 'Supply Bin', lootChance: 0.9, max: 3, model: 'bin' },
  corpse: { name: 'Corpse', lootChance: 0.85, max: 1, model: 'corpse' },
}
