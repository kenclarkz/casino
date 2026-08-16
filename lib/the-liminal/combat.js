// @ts-nocheck
// Combat: melee swings, firearm hitscan, reload, ammo, aim zoom, throwables.
// Uses the player's camera for aiming and the fx module for impacts.

import * as THREE from 'three'
import { COMBAT, PLAYER, DIFFICULTY } from './config.js'
import { ITEMS, WEAPON_SLOT_MELEE, WEAPON_SLOT_GUN } from './items.js'
import { clamp, lerp, KEY } from './utils.js'

export class Combat {
  constructor(ctx) {
    this.ctx = ctx
    this.active = 'melee'
    this.meleeCooldown = 0
    this.swingAnim = 0
    this.reloadTimer = 0
    this.mags = {} // gunId -> current mag rounds
    this.fireCooldown = 0
    this.zoom = 1
    this.aiming = false
    this.recoil = 0
    this.lastMeleeSwing = 0
    this.molotovCooldown = 0
  }

  get inventory() {
    return this.ctx.inventory
  }

  currentMeleeDef() {
    const m = this.inventory.equippedMelee
    if (!m) return ITEMS.fists
    return ITEMS[m.id] || ITEMS.fists
  }

  currentGunDef() {
    const g = this.inventory.equippedGun
    if (!g) return null
    return ITEMS[g.id]
  }

  magFor(gunDef) {
    const id = gunDef ? gunDef.id || null : null
    if (!id) return 0
    if (this.mags[id] == null) this.mags[id] = gunDef.weapon.magSize
    return this.mags[id]
  }

  canAttack() {
    return this.meleeCooldown <= 0 && this.swingAnim <= 0 && this.reloadTimer <= 0
  }

  tryAttack(game) {
    if (this.active === 'melee') return this.tryMelee(game)
    return this.tryGun(game)
  }

  // ---------------- MELEE ----------------
  tryMelee(game) {
    const player = this.ctx.player
    if (this.meleeCooldown > 0 || this.reloadTimer > 0) return false
    const def = this.currentMeleeDef().weapon
    if (!def) return false
    if (player.stamina < 4) return false
    player.useStamina(def.stamina)
    this.meleeCooldown = def.speed
    this.swingAnim = 0.28
    this.lastMeleeSwing = performance.now()
    this.ctx.audio.lazyPlay('meleeSwing', { gain: 0.35 })

    // hit detection: cone in front
    const cam = this.ctx.camera
    const camPos = cam.position.clone()
    const forward = new THREE.Vector3()
    cam.getWorldDirection(forward)
    const range = def.range
    let hitAny = false
    for (const e of this.ctx.enemies()) {
      if (e.dead) continue
      const toE = e.getPos().clone().sub(camPos)
      const dist = toE.length()
      if (dist > range + e.radius) continue
      const d = toE.clone().normalize().dot(forward)
      if (d < Math.cos(COMBAT.meleeArc / 2)) continue
      // melee in complete darkness should be unreliable (satisfying risk)
      const dmg = def.dmg * (Math.random() < def.crit ? 2 : 1)
      e.takeDamage(dmg, { x: camPos.x, y: camPos.y, z: camPos.z }, forward)
      this.ctx.fx.hitEffect(e.getPos().clone(), 'blood')
      this.ctx.audio.lazyPlay('hit', { gain: 0.5, pos: e.getPos(), listener: camPos })
      e.applyKnockback(forward.clone().multiplyScalar(def.knockback))
      hitAny = true
      if (this.inventory.equippedMelee && this.inventory.equippedMelee.dur != null) {
        if (this.inventory.damageMelee(1)) {
          this.ctx.onMeleeBroke && this.ctx.onMeleeBroke()
        }
      }
    }
    if (!hitAny && game) {
      this.ctx.audio.lazyPlay('meleeSwing', { gain: 0.2 })
    }
    if (game) game.addPlayerNoise(PLAYER.noise.melee)
    return true
  }

  // ---------------- GUNS ----------------
  tryGun(game) {
    if (this.fireCooldown > 0 || this.reloadTimer > 0) return false
    const gunDef = this.currentGunDef()
    if (!gunDef) return false
    const w = gunDef.weapon
    const mag = this.magFor(gunDef)
    if (mag <= 0) {
      this.startReload(game)
      return false
    }
    this.fireCooldown = w.fireRate
    this.mags[gunDef.id] = mag - 1
    this.recoil = 1

    // hit scan with pellets
    const cam = this.ctx.camera
    const camPos = cam.position.clone()
    let baseDir = new THREE.Vector3()
    cam.getWorldDirection(baseDir)
    const spread = w.spread * (this.aiming ? 0.45 : 1)
    let kills = 0
    for (let p = 0; p < w.pellets; p++) {
      const dir = baseDir.clone()
      dir.x += (Math.random() - 0.5) * spread * 2
      dir.y += (Math.random() - 0.5) * spread * 2
      dir.z += (Math.random() - 0.5) * spread * 2
      dir.normalize()
      let best = null
      for (const e of this.ctx.enemies()) {
        if (e.dead) continue
        const center = e.getPos()
        const oc = camPos.clone().sub(center)
        const t = oc.dot(dir)
        if (t < 0) continue
        const closest = camPos.clone().addScaledVector(dir, t).sub(center)
        const distToCenter = closest.length()
        const headY = center.y + e.headHeight
        if (distToCenter < e.radius && t < w.range) {
          const hit = camPos.clone().addScaledVector(dir, t)
          const isHead = hit.y > headY
          if (!best || t < best.t) best = { e, t, hit, isHead }
        }
      }
      if (best) {
        const dmg = w.dmg * (best.isHead ? COMBAT.headshotMult : 1)
        best.e.takeDamage(dmg, { x: camPos.x, y: camPos.y, z: camPos.z }, dir)
        this.ctx.fx.hitEffect(best.hit, 'blood')
        if (best.isHead) this.ctx.fx.hitEffect(best.hit.clone().add(new THREE.Vector3(0, 0.2, 0)), 'spark')
        if (best.e.dead) kills++
      } else {
        // wall impact
        const hitPt = this.raycastWall(camPos, dir)
        if (hitPt) this.ctx.fx.hitEffect(hitPt, 'spark')
      }
    }

    this.ctx.audio.lazyPlay(w.pellets > 1 ? 'shotgun' : 'gun', {
      gain: 0.8,
      pos: camPos,
      listener: camPos,
    })
    this.ctx.fx.muzzleFlash(cam, w.pellets > 1)
    if (game) {
      game.addPlayerNoise(w.loud || 100)
      game.onGunFired && game.onGunFired(w.loud || 100)
      game.stats.shots += w.pellets
    }
    if (this.mags[gunDef.id] <= 0) this.startReload(game)
    return true
  }

  raycastWall(origin, dir) {
    // simple grid DDA against floor tiles
    const world = this.ctx.floorWorld
    if (!world) return null
    let t = 0.2
    const step = 0.3
    const p = origin.clone()
    while (t < COMBAT.gunMaxRange) {
      p.addScaledVector(dir, step)
      t += step
      const ty = world.tileAt(p.x, p.z)
      if (ty === 0) {
        const up = origin.clone().addScaledVector(dir, t)
        return up
      }
    }
    return null
  }

  startReload(game) {
    if (this.reloadTimer > 0) return
    const gunDef = this.currentGunDef()
    if (!gunDef) return
    const w = gunDef.weapon
    if (this.magFor(gunDef) >= w.magSize) return
    const ammo = this.inventory.count(w.ammo)
    if (ammo <= 0) return
    this.reloadTimer = w.reload
    this.ctx.audio.lazyPlay('reload', { gain: 0.5 })
    if (game) game.addPlayerNoise(PLAYER.noise.reload)
  }

  finishReload(game) {
    const gunDef = this.currentGunDef()
    if (!gunDef) return
    const w = gunDef.weapon
    const need = w.magSize - this.magFor(gunDef)
    const have = this.inventory.count(w.ammo)
    const take = Math.min(need, have)
    if (take > 0) {
      this.inventory.remove(w.ammo, take)
      this.mags[gunDef.id] += take
    }
    this.reloadTimer = 0
    this.ctx.audio.lazyPlay('equip', { gain: 0.3 })
  }

  // ---------------- ITEMS ----------------
  useItem(id) {
    const inv = this.inventory
    if (!inv.has(id)) return
    const def = ITEMS[id]
    switch (id) {
      case 'bandage':
        this.ctx.player.heal(25)
        this.ctx.audio.lazyPlay('consume', { gain: 0.4 })
        inv.consume(id, 1)
        return true
      case 'medkit':
        this.ctx.player.heal(60)
        this.ctx.audio.lazyPlay('consume', { gain: 0.5 })
        inv.consume(id, 1)
        return true
      case 'food':
        this.ctx.player.heal(12)
        this.ctx.audio.lazyPlay('consume', { gain: 0.3 })
        inv.consume(id, 1)
        return true
      case 'water':
        this.ctx.player.stamina = clamp(this.ctx.player.stamina + 35, 0, PLAYER.staminaMax)
        this.ctx.audio.lazyPlay('consume', { gain: 0.3 })
        inv.consume(id, 1)
        return true
      case 'battery':
        this.ctx.flashlight.addBattery(40)
        this.ctx.audio.lazyPlay('pickup', { gain: 0.4 })
        inv.consume(id, 1)
        return true
      case 'molotov':
        this.throwMolotov()
        inv.consume(id, 1)
        return true
      default:
        return false
    }
  }

  throwMolotov() {
    const cam = this.ctx.camera
    const dir = new THREE.Vector3()
    cam.getWorldDirection(dir)
    const from = cam.position.clone().addScaledVector(dir, 0.6)
    this.ctx.fx.throwMolotov(from, dir)
    this.ctx.audio.lazyPlay('meleeSwing', { gain: 0.4 })
    this.molotovCooldown = 1
  }

  // ---------------- EQUIP ----------------
  setActive(slot) {
    if (slot === 'gun' && !this.currentGunDef()) return false
    this.active = slot
    this.ctx.audio.lazyPlay('equip', { gain: 0.3 })
    return true
  }

  swap() {
    const gunDef = this.currentGunDef()
    if (this.active === 'melee' && gunDef) return this.setActive('gun')
    return this.setActive('melee')
  }

  // ---------------- UPDATE ----------------
  update(dt, game) {
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt)
    this.fireCooldown = Math.max(0, this.fireCooldown - dt)
    this.molotovCooldown = Math.max(0, this.molotovCooldown - dt)
    this.swingAnim = Math.max(0, this.swingAnim - dt)
    this.recoil = Math.max(0, this.recoil - dt * 5)
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt
      if (this.reloadTimer <= 0) this.finishReload(game)
    }
    // aim zoom
    const cam = this.ctx.camera
    const gunDef = this.currentGunDef()
    this.aiming = this.ctx.input.action(KEY.AIM) && !!gunDef && this.active === 'gun'
    const targetZoom = this.aiming && gunDef ? gunDef.weapon.aimZoom : 1
    this.zoom = lerp(this.zoom, targetZoom, Math.min(1, dt * 8))
    cam.fov = lerp(cam.fov, (this.ctx.baseFov || 76) * this.zoom, Math.min(1, dt * 10))
    cam.updateProjectionMatrix()
    // recoil kick
    if (this.recoil > 0.01) {
      const kick = this.recoil * 0.02
      cam.rotation.x += kick
      cam.rotation.y += (Math.random() - 0.5) * kick * 0.6
    }
  }
}
