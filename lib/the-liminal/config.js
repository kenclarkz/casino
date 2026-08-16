// @ts-nocheck
// Central balance / tuning constants. Keep everything here so the game is
// easy to rebalance. No three.js, no DOM. Node-testable.

import { clamp01 } from './utils.js'

export const GAME = {
  title: 'THE LIMINAL',
  version: '0.1.0',
  floors: 10,
  saveKey: 'the-liminal-save-v1',
  settingsKey: 'the-liminal-settings-v1',
  lowBatteryThreshold: 25,
  maxLootDistance: 2.6, // pickup radius
}

export const PLAYER = {
  eye: 1.58,
  crouchEye: 0.72,
  height: 1.7,
  radius: 0.34,
  walkSpeed: 3.0,
  runSpeed: 5.3,
  crouchSpeed: 1.35,
  accel: 26,
  damping: 10,
  jumpVel: 4.2,
  gravity: -12,
  maxFallSpeed: -14,
  crouchSmooth: 10,
  headBobWalk: 0.032,
  headBobRun: 0.055,
  headBobFreq: 1.8,
  mouseSensitivity: 0.0022,
  controllerLook: 2.6,

  healthMax: 100,
  staminaMax: 100,
  runDrain: 15, // per second while sprinting
  exhaustionDrain: 6,
  staminaRegen: 13,
  exhaustedThreshold: 18, // below this you can't sprint
  regenDelay: 0.8, // seconds before regen starts after sprint

  // Noise footprint (0-100). Gunfire ~100.
  noise: { crouch: 2, walk: 7, run: 18, interact: 9, melee: 7, reload: 8, gun: 100, fall: 12 },

  // Vertical bobbing + landing
  stepIntervalWalk: 0.52,
  stepIntervalRun: 0.4,
  stepIntervalCrouch: 0.85,
  fallDamagePerM: 6,
  fallDamageMin: 3.2,
}

export const FLASHLIGHT = {
  batteryMax: 100,
  drainPerSec: 2.8,
  flickerBelow: 22,
  range: 30,
  innerAngle: 0.26,
  outerAngle: 0.58,
  intensity: 2.4,
  color: 0xfff2d9,
}

export const COMBAT = {
  meleeRange: 2.3,
  meleeArc: 1.15, // radians half-arc
  meleeSwingTime: 0.28,
  meleeCooldown: 0.42,
  pickupRange: 2.4,
  gunMaxRange: 120,
  headshotMult: 1.8,
  critChance: 0.08,
  ammoBoxPistol: 8,
  ammoBoxShell: 5,
}

export const DIFFICULTY = {
  // Per floor (0-based). Escalation curve.
  enemyHpMul: (d) => 1 + d * 0.16,
  enemySpeedMul: (d) => 1 + d * 0.028,
  enemyDmgMul: (d) => 1 + d * 0.1,
  enemyCount: (d) => 3 + Math.floor(d * 1.7) + (d % 3),
  lootScarcity: (d) => clamp01(1 - d * 0.06), // multiplies container loot chance
  eventFreq: (d) => 26 - d * 1.6, // seconds baseline between random events
  darknessMul: (d) => 1 + d * 0.04, // dims ambient further each floor
  aggroRange: (d) => 11 + d * 0.7,
  ammoScarcity: (d) => 1 - d * 0.05,
}

export const CHECKPOINT = {
  reviveHealthFrac: 0.55,
  reviveStaminaFrac: 1,
  reviveBatteryFrac: 0.7,
  lostLootFrac: 0.45, // fraction of non-equipment inventory lost on death
}

export const CAP = {
  batteryMin: 0.0001,
  maxEnemiesActive: 6, // enemies culled far away are simulated lightly
}

export const DISPLAY = {
  pixelRatioCap: 2,
  mobilePixelRatioCap: 1.5,
  fov: 76,
  near: 0.05,
  far: 120,
  shadowMapSize: 1024,
  mobileShadowMapSize: 512,
}
