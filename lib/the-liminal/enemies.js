// @ts-nocheck
// Enemy AI: senses (vision/LOS, hearing), A* pathing, per-type behaviors,
// attacks, damage, death + loot drops. Plus the boss (The Architect) for the
// final floor.

import * as THREE from 'three'
import { makePathfinder, tileIndex, T } from './levelgen.js'
import { LOOT_TABLES, ITEMS } from './items.js'
import { clamp, lerp, damp, pickWeighted } from './utils.js'
import { DIFFICULTY } from './config.js'

export const ENEMY_TYPES = {
  host: {
    name: 'The Host', hp: 90, speed: 2.5, sprint: 3.6, atkDmg: 16, atkRange: 1.6,
    atkWindup: 0.7, atkCooldown: 1.7, radius: 0.38, headHeight: 1.5, fov: 1.0,
    viewRange: 15, hear: 1.1, color: 0x3a3a42, accent: 0xc8232c, canOpenDoors: false,
    size: 1.0, animSpeed: 1,
  },
  lingerer: {
    name: 'The Lingerer', hp: 55, speed: 3.3, sprint: 5.0, atkDmg: 12, atkRange: 1.4,
    atkWindup: 0.4, atkCooldown: 1.2, radius: 0.32, headHeight: 1.2, fov: 0.9,
    viewRange: 13, hear: 1.3, color: 0x2e3440, accent: 0x8fb3b8, canOpenDoors: true,
    size: 0.9, animSpeed: 1.5, crawls: true,
  },
  tuner: {
    name: 'The Tuner', hp: 70, speed: 2.7, sprint: 3.4, atkDmg: 14, atkRange: 1.5,
    atkWindup: 0.6, atkCooldown: 1.5, radius: 0.34, headHeight: 1.6, fov: 0.25,
    viewRange: 4, hear: 2.2, color: 0x4a4330, accent: 0xe0d94a, canOpenDoors: true,
    size: 1.15, animSpeed: 1, blind: true, staticEyes: true,
  },
  drown: {
    name: 'The Drown', hp: 85, speed: 2.0, sprint: 4.4, atkDmg: 20, atkRange: 1.5,
    atkWindup: 0.8, atkCooldown: 2.0, radius: 0.4, headHeight: 1.4, fov: 1.0,
    viewRange: 14, hear: 1.0, color: 0x1a2a26, accent: 0x4ae0c0, canOpenDoors: true,
    size: 1.0, animSpeed: 0.8, water: true,
  },
  paper: {
    name: 'The Paper', hp: 40, speed: 1.8, sprint: 2.6, atkDmg: 8, atkRange: 1.4,
    atkWindup: 0.4, atkCooldown: 1.0, radius: 0.3, headHeight: 1.0, fov: 0.7,
    viewRange: 10, hear: 1.0, color: 0xcfd2d6, accent: 0xd8dbe0, canOpenDoors: true,
    size: 0.8, animSpeed: 1, paper: true,
  },
  mannequin: {
    name: 'The Mannequin', hp: 120, speed: 0, sprint: 6.5, atkDmg: 25, atkRange: 1.6,
    atkWindup: 0.3, atkCooldown: 2.2, radius: 0.4, headHeight: 1.55, fov: 0,
    viewRange: 0, hear: 0, color: 0xd8cfc0, accent: 0x9a8f7d, canOpenDoors: false,
    size: 1.0, animSpeed: 1, weepingAngel: true,
  },
  nurse: {
    name: 'The Nurse', hp: 75, speed: 4.2, sprint: 6.0, atkDmg: 15, atkRange: 1.5,
    atkWindup: 0.45, atkCooldown: 1.4, radius: 0.36, headHeight: 1.55, fov: 1.2,
    viewRange: 18, hear: 1.8, color: 0xdfe8e4, accent: 0x8a2b3a, canOpenDoors: true,
    size: 1.02, animSpeed: 1.6,
  },
  principal: {
    name: 'The Principal', hp: 160, speed: 1.9, sprint: 2.8, atkDmg: 30, atkRange: 1.7,
    atkWindup: 1.0, atkCooldown: 2.5, radius: 0.42, headHeight: 1.6, fov: 0.8,
    viewRange: 12, hear: 1.0, color: 0x4a4036, accent: 0x8a5a2a, canOpenDoors: true,
    size: 1.1, animSpeed: 0.7,
  },
  conductor: {
    name: 'The Conductor', hp: 110, speed: 2.6, sprint: 3.2, atkDmg: 22, atkRange: 1.6,
    atkWindup: 0.9, atkCooldown: 2.0, radius: 0.4, headHeight: 1.6, fov: 1.0,
    viewRange: 13, hear: 1.3, color: 0x2a2a30, accent: 0xd9b04a, canOpenDoors: true,
    size: 1.0, animSpeed: 0.9,
  },
  shade: {
    name: 'The Shade', hp: 45, speed: 3.8, sprint: 4.6, atkDmg: 12, atkRange: 1.3,
    atkWindup: 0.35, atkCooldown: 1.1, radius: 0.3, headHeight: 1.3, fov: 1.2,
    viewRange: 16, hear: 1.5, color: 0x0e0e16, accent: 0x7a1f3d, canOpenDoors: true,
    size: 0.85, animSpeed: 1.8, glitchy: true,
  },
}

export const BOSS_DEF = {
  name: 'The Architect',
  hp: 1400,
  speed: 2.0,
  atkDmg: 34,
  atkRange: 2.0,
  atkWindup: 1.1,
  atkCooldown: 2.2,
  radius: 1.0,
  headHeight: 2.2,
}

// ---- grid DDA line of sight ----
function lineOfSightClear(tiles, w, h, ax, az, bx, bz) {
  let x0 = ax
  let y0 = az
  const x1 = bx
  const y1 = bz
  let dx = x1 - x0
  let dy = y1 - y0
  const steps = Math.max(Math.abs(dx), Math.abs(dy))
  if (steps < 1) return true
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    const x = Math.floor(x0 + dx * t)
    const y = Math.floor(y0 + dy * t)
    if (x < 0 || y < 0 || x >= w || y >= h) return false
    if (tiles[y * w + x] === T.WALL) return false
  }
  return true
}

function buildEnemyMesh(typeDef, accentColor) {
  const g = new THREE.Group()
  const s = typeDef.size
  const col = typeDef.color
  const m = new THREE.MeshLambertMaterial({ color: col })
  const matAccent = new THREE.MeshBasicMaterial({ color: accentColor })
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.7 * s, 0.3 * s), m)
  body.position.y = 1.25 * s
  g.add(body)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19 * s, 8, 6), m)
  head.position.y = 1.75 * s
  g.add(head)
  const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02), matAccent)
  eyeL.position.set(-0.07 * s, 1.79 * s, 0.19 * s)
  g.add(eyeL)
  const eyeR = eyeL.clone()
  eyeR.position.x = 0.07 * s
  g.add(eyeR)
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.1 * s, 0.7 * s, 0.1 * s), m)
  armL.position.set(-0.33 * s, 1.15 * s, 0)
  g.add(armL)
  const armR = armL.clone()
  armR.position.x = 0.33 * s
  g.add(armR)
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.13 * s, 0.75 * s, 0.13 * s), m)
  legL.position.set(-0.12 * s, 0.375 * s, 0)
  g.add(legL)
  const legR = legL.clone()
  legR.position.x = 0.12 * s
  g.add(legR)
  g.userData = { body, head, armL, armR, legL, legR, eyeL, eyeR }
  return g
}

export class Enemy {
  constructor(type, floor, world, x, z, ctx) {
    this.type = type
    this.typeDef = ENEMY_TYPES[type]
    this.floor = floor
    this.world = world
    this.ctx = ctx
    this.pos = new THREE.Vector3(x + 0.5, 0, z + 0.5)
    this.vel = new THREE.Vector3()
    this.hp = this.typeDef.hp * ctx.diff.enemyHp
    this.maxHp = this.hp
    this.state = 'patrol'
    this.stateTime = 0
    this.dead = false
    this.deathT = 0
    this.path = []
    this.pathIndex = 0
    this.repathTimer = 0
    this.senseTimer = 0
    this.seenPlayer = false
    this.lastKnown = null
    this.patrolTarget = null
    this.attackTimer = 0
    this.attackWindup = 0
    this.attackReady = false
    this.frozen = 0
    this.stunTimer = 0
    this.movePhase = Math.random() * 10
    this.vocalTimer = Math.random() * 6
    this.knockbackVel = new THREE.Vector3()
    this.lookDir = new THREE.Vector3(0, 0, -1)
    this.mesh = buildEnemyMesh(this.typeDef, this.typeDef.accent)
    this.mesh.position.copy(this.pos)
    this.world.group.add(this.mesh)
    this.paperTiles = []
    this.growTimer = 0
    this.pf = makePathfinder(floor)
    this.speed = this.typeDef.speed * ctx.diff.enemySpeed
    this.dmg = this.typeDef.atkDmg * ctx.diff.enemyDmg
    this.hitFlash = 0
    this.attackAnim = 0
    this.observed = false
    this.whistleTimer = 0
    this.patrolAround()
  }

  get radius() {
    return this.typeDef.radius
  }
  get headHeight() {
    return this.typeDef.headHeight * this.typeDef.size
  }

  getPos() {
    return this.pos
  }

  setTile(x, y) {
    this.pos.set(x + 0.5, 0, y + 0.5)
  }

  get tile() {
    return { x: Math.floor(this.pos.x), y: Math.floor(this.pos.z) }
  }

  patrolAround() {
    const t = this.tile
    const rng = this.ctx.rng
    for (let i = 0; i < 8; i++) {
      const dx = rng.int(-4, 4)
      const dy = rng.int(-4, 4)
      const nx = clamp(t.x + dx, 1, this.floor.w - 2)
      const ny = clamp(t.y + dy, 1, this.floor.h - 2)
      if (this.pf.isWalkable(nx, ny)) {
        this.patrolTarget = { x: nx, y: ny }
        return
      }
    }
    this.patrolTarget = null
  }

  // ---------------- senses ----------------
  get player() {
    return this.ctx.player
  }

  playerVisible() {
    const p = this.player
    if (!p || p.dead) return false
    const dist = this.pos.distanceTo(p.pos)
    const td = this.typeDef
    const viewRange = td.viewRange * (0.85 + this.ctx.diff.aggroRange / 16)
    if (dist > viewRange) return false
    // FOV
    if (td.fov > 0 && !td.blind) {
      const toP = p.pos.clone().sub(this.pos)
      toP.y = 0
      const f = this.lookDir.clone()
      f.y = 0
      const angle = f.angleTo(toP.normalize())
      if (angle > td.fov) return false
    }
    // LOS (tiles + closed doors)
    const st = this.tile
    const pt = { x: Math.floor(p.pos.x), y: Math.floor(p.pos.z) }
    if (!lineOfSightClear(this.floor.tiles, this.floor.w, this.floor.h, st.x, st.y, pt.x, pt.y)) return false
    // dark rooms: if player light off and distance > 3, harder to see
    const light = this.ctx.flashlight
    if ((!light || !light.on) && dist > 4) return false
    return true
  }

  /** For weeping angel type: is the player looking at me? */
  playerObserving() {
    const p = this.player
    const cam = this.ctx.camera
    if (!p || p.dead) return false
    const toE = this.pos.clone().sub(cam.position)
    toE.y = 0
    const dist = toE.length()
    if (dist > 26) return false
    const fwd = new THREE.Vector3()
    cam.getWorldDirection(fwd)
    fwd.y = 0
    fwd.normalize()
    const angle = fwd.angleTo(toE.clone().normalize())
    if (angle > 0.5) return false
    const st = this.tile
    const pt = { x: Math.floor(p.pos.x), y: Math.floor(p.pos.z) }
    if (!lineOfSightClear(this.floor.tiles, this.floor.w, this.floor.h, pt.x, pt.y, st.x, st.y)) return false
    return true
  }

  playerHeard(noise) {
    const p = this.player
    if (!p) return false
    const dist = this.pos.distanceTo(p.pos)
    const reach = noise * this.typeDef.hear
    return noise >= 4 && dist < reach
  }

  hearNoiseAt(x, z, strength) {
    const dist = Math.hypot(x - this.pos.x, z - this.pos.z)
    const reach = strength * this.typeDef.hear
    if (dist < reach) {
      this.lastKnown = { x, z }
      if (this.state === 'patrol' || this.state === 'idle') this.state = 'investigate'
      return true
    }
    return false
  }

  // ---------------- steering ----------------
  updatePath() {
    const t = this.tile
    const goal = this.lastKnown || this.patrolTarget
    if (!goal) return
    this.path = this.pf.find(t.x, t.y, Math.floor(goal.x), Math.floor(goal.y)) || []
    this.pathIndex = 0
  }

  moveAlongPath(dt, speed) {
    const t = this.tile
    // skip waypoints we're already on / behind
    while (this.pathIndex < this.path.length) {
      const wp = this.path[this.pathIndex]
      if (Math.floor(this.pos.x) === wp.x && Math.floor(this.pos.z) === wp.y) {
        this.pathIndex++
      } else break
    }
    if (this.pathIndex >= this.path.length) {
      if (this.lastKnown) this.state = 'search'
      return
    }
    const wp = this.path[this.pathIndex]
    const target = new THREE.Vector3(wp.x + 0.5, 0, wp.y + 0.5)
    const dir = target.clone().sub(this.pos)
    dir.y = 0
    const dist = dir.length()
    if (dist > 0.05) {
      dir.normalize()
      const dx = dir.x * speed * dt
      const dz = dir.z * speed * dt
      this.moveCollided(dx, dz)
      this.lookDir.copy(dir)
    }
  }

  moveDirect(dt, speed) {
    const p = this.player.pos.clone().sub(this.pos)
    p.y = 0
    const dist = p.length()
    if (dist > 0.05) {
      p.normalize()
      const dx = p.x * speed * dt
      const dz = p.z * speed * dt
      this.moveCollided(dx, dz)
      this.lookDir.copy(p)
    }
  }

  moveCollided(dx, dz) {
    const r = this.radius
    const rects = this.world.colliders
    const tryMove = (nx, nz) => {
      for (const c of rects) {
        if (
          nx + r > c.x - c.w / 2 &&
          nx - r < c.x + c.w / 2 &&
          nz + r > c.z - c.d / 2 &&
          nz - r < c.z + c.d / 2
        ) return false
      }
      return true
    }
    if (tryMove(this.pos.x + dx, this.pos.z)) this.pos.x += dx
    if (tryMove(this.pos.x, this.pos.z + dz)) this.pos.z += dz
    const b = this.floor.bounds
    this.pos.x = clamp(this.pos.x, 0.35, b.w - 0.35)
    this.pos.z = clamp(this.pos.z, 0.35, b.h - 0.35)
  }

  // ---------------- attack ----------------
  tryAttack(dt) {
    const p = this.player
    const td = this.typeDef
    const dist = this.pos.distanceTo(p.pos)
    this.attackTimer = Math.max(0, this.attackTimer - dt)
    if (this.attackWindup > 0) {
      this.attackWindup -= dt
      this.attackAnim = Math.min(1, this.attackAnim + dt * 3)
      if (this.attackWindup <= 0) {
        if (dist < td.atkRange + p.radius) {
          p.damage(this.dmg)
          this.ctx.audio.lazyPlay('enemyAttack', { gain: 0.6, pos: this.pos, listener: p.pos })
          this.ctx.fx.hitEffect(p.pos.clone().add(new THREE.Vector3(0, 1.3, 0)), 'blood')
          this.ctx.onPlayerHit && this.ctx.onPlayerHit(this)
        } else {
          this.ctx.audio.lazyPlay('enemyAttack', { gain: 0.2, pos: this.pos, listener: p.pos })
        }
        this.attackReady = false
        this.attackTimer = td.atkCooldown
      }
    } else if (dist < td.atkRange + p.radius && this.attackTimer <= 0) {
      this.attackWindup = td.atkWindup
      this.ctx.audio.lazyPlay('enemyAttack', { gain: 0.4, pos: this.pos, listener: p.pos })
    }
  }

  // ---------------- damage ----------------
  takeDamage(amount, fromPos, dir) {
    if (this.dead) return
    this.hp -= amount
    this.hitFlash = 0.2
    if (this.typeDef.glitchy && Math.random() < 0.3) {
      this.pos.add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2))
    }
    if (this.hp <= 0) {
      this.die()
      return
    }
    if (this.lastKnown && this.state !== 'chase') this.state = 'investigate'
    this.seenPlayer = true
  }

  applyKnockback(dir) {
    this.knockbackVel.add(dir)
    this.knockbackVel.y = 2.5
  }

  die() {
    this.dead = true
    this.state = 'dead'
    this.ctx.audio.lazyPlay('enemyDeath', { gain: 0.6, pos: this.pos, listener: this.player.pos })
    this.ctx.onEnemyKilled && this.ctx.onEnemyKilled(this)
    this.dropLoot()
  }

  dropLoot() {
    const env = this.ctx.currentEnv
    const table = LOOT_TABLES[env.loot] || LOOT_TABLES.generic
    const rng = this.ctx.rng
    if (rng.chance(0.5)) {
      const tier = rng.weighted([
        { w: 55, value: 'common' },
        { w: 33, value: 'uncommon' },
        { w: 12, value: 'rare' },
      ])
      const item = pickWeighted(table[tier], rng)
      const count = rng.chance(0.3) ? 2 : 1
      this.ctx.onDropLoot(this.pos.x, this.pos.z, item, count)
    }
  }

  // ---------------- state machine ----------------
  update(dt) {
    if (this.dead) {
      this.deathT += dt
      this.mesh.rotation.x = Math.min(1.4, this.deathT * 1.5)
      this.mesh.position.y = -this.deathT * 0.6
      if (this.deathT > 1.6) this.mesh.visible = false
      return
    }
    this.stateTime += dt
    this.movePhase += dt
    this.hitFlash = Math.max(0, this.hitFlash - dt)
    this.frozen = Math.max(0, this.frozen - dt)
    this.attackAnim = Math.max(0, this.attackAnim - dt * 2)
    this.speed = this.typeDef.speed * this.ctx.diff.enemySpeed

    // knockback
    if (this.knockbackVel.lengthSq() > 0.001) {
      this.pos.add(this.knockbackVel.clone().multiplyScalar(dt))
      this.knockbackVel.multiplyScalar(Math.max(0, 1 - dt * 5))
    }

    const p = this.player
    const distToPlayer = p ? this.pos.distanceTo(p.pos) : 999

    // ---- sense update (throttled) ----
    this.senseTimer -= dt
    if (this.senseTimer <= 0) {
      this.senseTimer = 0.2
      const visible = this.playerVisible()
      if (visible) {
        this.seenPlayer = true
        this.lastKnown = { x: p.pos.x, z: p.pos.z }
        this.state = 'chase'
      } else if (this.state !== 'chase' && this.playerHeard(p.noise)) {
        this.lastKnown = { x: p.pos.x, z: p.pos.z }
        this.state = 'investigate'
      }
      // per-type sense overrides
      this.typeSense(dt, distToPlayer)
    }

    // ---- per-type behavior ----
    this.typeBehavior(dt, distToPlayer)

    // ---- shared state machine ----
    const td = this.typeDef
    switch (this.state) {
      case 'idle':
        this.speed = 0
        this.stateTime > 3 && this.patrolAround()
        this.stateTime > 3 && (this.state = 'patrol')
        break
      case 'patrol': {
        if (!this.patrolTarget || this.stateTime > 8) this.patrolAround()
        this.repathTimer -= dt
        if (this.repathTimer <= 0 && this.patrolTarget) {
          this.path = this.pf.find(this.tile.x, this.tile.y, this.patrolTarget.x, this.patrolTarget.y) || []
          this.pathIndex = 0
          this.repathTimer = 1.2
        }
        this.moveAlongPath(dt, this.speed * 0.5)
        const t = this.tile
        if (this.patrolTarget && Math.abs(t.x - this.patrolTarget.x) <= 1 && Math.abs(t.y - this.patrolTarget.y) <= 1) {
          this.state = 'idle'
          this.stateTime = 0
        }
        break
      }
      case 'investigate':
      case 'search': {
        this.repathTimer -= dt
        if (this.repathTimer <= 0 || !this.path.length) {
          this.updatePath()
          this.repathTimer = 0.8
        }
        if (this.state === 'investigate' && this.stateTime > 6) this.state = 'search'
        if (this.state === 'search' && this.stateTime > 8) {
          this.state = 'patrol'
          this.stateTime = 0
          this.patrolAround()
          this.seenPlayer = false
        }
        this.moveAlongPath(dt, this.speed * 0.7)
        break
      }
      case 'chase': {
        if (!this.seenPlayer && this.stateTime > 7) {
          this.state = 'search'
          this.stateTime = 0
          break
        }
        this.repathTimer -= dt
        if (this.repathTimer <= 0 || !this.path.length) {
          this.updatePath()
          this.repathTimer = 0.6
        }
        const chaseSpeed = distToPlayer < 7 ? this.typeDef.sprint * this.ctx.diff.enemySpeed : this.speed
        if (this.frozen <= 0) this.moveAlongPath(dt, chaseSpeed)
        this.tryAttack(dt)
        // open doors while chasing
        if (this.typeDef.canOpenDoors && this.stateTime % 1.0 < dt) {
          this.tryOpenAdjacentDoor()
        }
        break
      }
    }

    // ---- vocalization ----
    this.vocalTimer -= dt
    if (this.vocalTimer <= 0 && !p.dead) {
      this.vocalTimer = 6 + Math.random() * 8
      if (distToPlayer < 18 && this.state !== 'dead') {
        const vol = clamp(1 - distToPlayer / 25, 0, 1)
        this.ctx.audio.lazyPlay(`voc${this.type.charAt(0).toUpperCase()}${this.type.slice(1)}`, {
          gain: 0.35 * vol,
          pos: this.pos,
          listener: p.pos,
        })
      }
    }

    // ---- mesh ----
    this.animate(dt)
  }

  typeSense(dt, dist) {
    switch (this.type) {
      case 'tuner': {
        // flashlight stuns
        const fl = this.ctx.flashlight
        if (fl && fl.on && dist < 10) {
          const cam = this.ctx.camera
          const toE = this.pos.clone().sub(cam.position)
          toE.y = 0
          const fwd = new THREE.Vector3()
          cam.getWorldDirection(fwd)
          fwd.y = 0
          fwd.normalize()
          if (fwd.angleTo(toE.clone().normalize()) < 0.25) {
            this.frozen = 1.4
            this.stunTimer = 1.4
          }
        }
        break
      }
      case 'drown': {
        // bright light slows it
        const fl = this.ctx.flashlight
        if (fl && fl.on && dist < 8) {
          this.frozen = Math.max(this.frozen, dt * 0.6)
        }
        break
      }
      case 'nurse': {
        // crouched & still = holding breath → invisible
        const pc = this.player
        if (pc && pc.crouching && Math.hypot(pc.vel.x, pc.vel.z) < 0.4 && dist > 2.5) {
          this.seenPlayer = false
          this.lastKnown = null
          if (this.state === 'chase') {
            this.state = 'search'
            this.stateTime = 0
          }
        }
        break
      }
      case 'host': {
        // closed doors block detection entirely
        if (dist < 3) break
        const pp = this.player
        const st = this.tile
        const pt = { x: Math.floor(pp.pos.x), y: Math.floor(pp.pos.z) }
        if (!lineOfSightClear(this.floor.tiles, this.floor.w, this.floor.h, st.x, st.y, pt.x, pt.y)) {
          // maybe a door is closed between
          this.seenPlayer = false
          if (this.state === 'chase') {
            this.state = 'search'
            this.stateTime = 0
          }
        }
        break
      }
      case 'mannequin': {
        const obs = this.playerObserving()
        if (obs) {
          this.observed = true
          this.frozen = Math.max(this.frozen, 0.2)
          this.state = 'idle'
        } else if (dist < 20) {
          this.state = 'chase'
        }
        break
      }
    }
  }

  typeBehavior(dt, dist) {
    switch (this.type) {
      case 'lingerer': {
        // flicker panels nearby freeze it briefly
        const t = this.tile
        for (const pan of this.world.panels) {
          if (!pan.flicker) continue
          const px = Math.floor(pan.mesh.position.x)
          const py = Math.floor(pan.mesh.position.z)
          if (Math.abs(px - t.x) <= 2 && Math.abs(py - t.y) <= 2) {
            this.frozen = Math.max(this.frozen, 0.35)
            break
          }
        }
        break
      }
      case 'drown': {
        // faster in water, slower on dry
        const surf = this.world.surfaceAt(this.pos.x, this.pos.z)
        if (surf === 'water') this.speed = this.typeDef.sprint * this.ctx.diff.enemySpeed
        else this.speed = this.typeDef.speed * 0.7
        break
      }
      case 'paper': {
        this.growTimer -= dt
        if (this.growTimer <= 0) {
          this.growTimer = 6 + Math.random() * 6
          this.growPaper()
        }
        break
      }
      case 'conductor': {
        this.whistleTimer -= dt
        if (this.whistleTimer <= 0 && dist < 16 && this.state === 'chase') {
          this.whistleTimer = 12
          this.ctx.audio.lazyPlay('whistle', { gain: 0.7, pos: this.pos, listener: this.player.pos })
          this.ctx.onTrainWhistle && this.ctx.onTrainWhistle(this)
        }
        break
      }
    }
  }

  growPaper() {
    const t = this.tile
    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
    ]
    for (const [dx, dy] of dirs) {
      const nx = t.x + dx
      const ny = t.y + dy
      if (nx < 0 || ny < 0 || nx >= this.floor.w || ny >= this.floor.h) continue
      if (this.floor.tiles[tileIndex(nx, ny, this.floor.w)] === T.WALL) continue
      if (this.ctx.isFreeForPaper(nx, ny)) {
        const wallMesh = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1.8, 0.08),
          new THREE.MeshLambertMaterial({ color: 0xd8dbe0 })
        )
        wallMesh.position.set(nx + 0.5, 0.9, ny + 0.5)
        this.world.group.add(wallMesh)
        this.world.colliders.push({ x: nx + 0.5, z: ny + 0.5, w: 0.3, d: 1 })
        this.paperTiles.push(wallMesh)
        this.ctx.audio.lazyPlay('paperTear', { gain: 0.4, pos: this.pos, listener: this.player.pos })
        break
      }
    }
  }

  removePaper() {
    for (const m of this.paperTiles) {
      this.world.group.remove(m)
      m.geometry.dispose()
      m.material.dispose()
    }
    // remove their colliders (best-effort: drop all colliders with w 0.3 paper)
    this.world.colliders = this.world.colliders.filter((c) => !(c.w === 0.3 && c.d === 1))
    this.paperTiles = []
  }

  tryOpenAdjacentDoor() {
    const t = this.tile
    for (const d of this.world.doors.values()) {
      const dx = Math.floor(d.x)
      const dz = Math.floor(d.z)
      if (Math.abs(dx - t.x) <= 1 && Math.abs(dz - t.y) <= 1 && !d.targetOpen) {
        d.targetOpen = true
        this.ctx.audio.lazyPlay('door', { gain: 0.5, pos: new THREE.Vector3(d.x, 1, d.z), listener: this.player.pos })
      }
    }
  }

  animate(dt) {
    const u = this.mesh.userData
    if (!u) return
    const moving = this.state === 'chase' || this.state === 'investigate' || this.state === 'search' || this.state === 'patrol'
    const walk = moving && this.frozen <= 0 ? 1 : 0
    const t = this.movePhase * this.typeDef.animSpeed
    const swing = Math.sin(t * 8) * walk * 0.6
    u.armL.rotation.x = swing * 1.4 + (this.attackAnim > 0 ? -2.6 : 0)
    u.armR.rotation.x = -swing * 1.4 + (this.attackAnim > 0 ? -2.6 : 0)
    u.legL.rotation.x = swing
    u.legR.rotation.x = -swing
    u.body.rotation.x = Math.sin(t * 4) * 0.03 * walk
    if (this.typeDef.crawls) {
      this.mesh.rotation.x = 0
      this.mesh.position.y = 0.4
    }
    // face movement direction
    const f = this.lookDir
    if (f.lengthSq() > 0.001) {
      const targetYaw = Math.atan2(f.x, f.z)
      this.mesh.rotation.y = lerpAngle(this.mesh.rotation.y, targetYaw, Math.min(1, dt * 6))
    }
    this.mesh.position.copy(this.pos)
    if (this.hitFlash > 0) {
      const on = Math.floor(this.hitFlash * 30) % 2 === 0
      this.mesh.traverse((o) => {
        if (o.isMesh && o.material && o.material.isMeshLambertMaterial) o.material.emissive.setHex(on ? 0xffffff : 0x000000)
      })
    } else {
      this.mesh.traverse((o) => {
        if (o.isMesh && o.material && o.material.isMeshLambertMaterial) o.material.emissive.setHex(0x000000)
      })
    }
    if (this.frozen > 0 || this.observed) {
      u.armL.rotation.x = -2.6
      u.armR.rotation.x = -2.6
      u.legL.rotation.x = 0
      u.legR.rotation.x = 0
    }
  }

  dispose() {
    this.world.group.remove(this.mesh)
    this.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) o.material.dispose()
    })
    this.removePaper()
  }
}

function lerpAngle(a, b, t) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

// ==================== BOSS: THE ARCHITECT ====================

export class BossArchitect {
  constructor(floor, world, ctx) {
    this.type = 'architect'
    this.floor = floor
    this.world = world
    this.ctx = ctx
    this.pos = new THREE.Vector3(floor.exit.x + 0.5, 0, floor.exit.y + 0.5)
    this.hp = BOSS_DEF.hp * ctx.diff.enemyHp
    this.maxHp = this.hp
    this.dead = false
    this.deathT = 0
    this.phase = 1
    this.phaseTimer = 0
    this.attackTimer = 0
    this.attackWindup = 0
    this.attackAnim = 0
    this.teleportTimer = 0
    this.spawnTimer = 0
    this.glitchTimer = 0
    this.lookDir = new THREE.Vector3(0, 0, -1)
    this.hitFlash = 0
    this.attackCooldown = 2
    this.mesh = this.buildMesh()
    this.world.group.add(this.mesh)
    this.ctx.onBossSpawn && this.ctx.onBossSpawn(this)
  }

  get radius() {
    return BOSS_DEF.radius
  }
  get headHeight() {
    return BOSS_DEF.headHeight
  }
  getPos() {
    return this.pos
  }

  buildMesh() {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.4, 1.0), new THREE.MeshLambertMaterial({ color: 0x14141f }))
    body.position.y = 2.2
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), new THREE.MeshLambertMaterial({ color: 0x1a1a2a }))
    head.position.y = 3.5
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.06), new THREE.MeshBasicMaterial({ color: 0x7a1f3d }))
    eyes.position.set(0, 3.5, 0.5)
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.2, 0.35), new THREE.MeshLambertMaterial({ color: 0x161621 }))
    armL.position.set(-1.0, 2.2, 0)
    const armR = armL.clone()
    armR.position.x = 1.0
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshBasicMaterial({ color: 0x7a1f3d }))
    core.position.y = 2.2
    g.add(body)
    g.add(head)
    g.add(eyes)
    g.add(armL)
    g.add(armR)
    g.add(core)
    g.userData = { body, head, armL, armR, core, eyes }
    return g
  }

  update(dt) {
    const p = this.ctx.player
    if (this.dead) {
      this.deathT += dt
      this.mesh.rotation.x = Math.min(1.5, this.deathT * 0.5)
      this.mesh.position.y = -this.deathT * 0.3
      if (this.deathT > 3) this.mesh.visible = false
      return
    }
    this.phaseTimer += dt
    this.attackTimer = Math.max(0, this.attackTimer - dt)
    this.hitFlash = Math.max(0, this.hitFlash - dt)
    this.attackAnim = Math.max(0, this.attackAnim - dt * 2)

    const dist = p ? this.pos.distanceTo(p.pos) : 999

    // phases
    const hpFrac = this.hp / this.maxHp
    if (hpFrac < 0.66 && this.phase === 1) {
      this.phase = 2
      this.ctx.fx.shockwave(this.pos, 0x7a1f3d)
      this.ctx.onBossPhase && this.ctx.onBossPhase(2)
      this.ctx.audio.lazyPlay('glitch', { gain: 0.8, pos: this.pos, listener: p.pos })
    }
    if (hpFrac < 0.33 && this.phase === 2) {
      this.phase = 3
      this.ctx.fx.shockwave(this.pos, 0x7a1f3d)
      this.ctx.onBossPhase && this.ctx.onBossPhase(3)
    }

    // phase behaviors
    const speed = BOSS_DEF.speed * (1 + this.phase * 0.25)
    if (this.phase >= 2) {
      // glitch teleport: reposition periodically
      this.glitchTimer -= dt
      if (this.glitchTimer <= 0) {
        this.glitchTimer = 5 + Math.random() * 3
        this.teleportNear(p)
        this.ctx.fx.shockwave(this.pos, 0x7a1f3d)
        this.ctx.audio.lazyPlay('glitch', { gain: 0.7, pos: this.pos, listener: p.pos })
      }
    }
    if (this.phase === 3) {
      // spawn shades
      this.spawnTimer -= dt
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 7
        this.ctx.onBossSpawnMinions && this.ctx.onBossSpawnMinions()
      }
    }

    // move toward player
    const dir = p.pos.clone().sub(this.pos)
    dir.y = 0
    if (dir.lengthSq() > 0.5 && dist > BOSS_DEF.atkRange) {
      dir.normalize()
      this.pos.addScaledVector(dir, speed * dt)
      this.lookDir.copy(dir)
    }

    // attack
    if (this.attackTimer <= 0 && dist < BOSS_DEF.atkRange + p.radius) {
      this.attackWindup = BOSS_DEF.atkWindup
      this.attackTimer = BOSS_DEF.atkCooldown
    }
    if (this.attackWindup > 0) {
      this.attackWindup -= dt
      this.attackAnim = Math.min(1, this.attackAnim + dt * 3)
      if (this.attackWindup <= 0) {
        if (dist < BOSS_DEF.atkRange + p.radius) {
          p.damage(this.ctx.diff.enemyDmg * BOSS_DEF.atkDmg)
          this.ctx.audio.lazyPlay('enemyAttack', { gain: 0.7, pos: this.pos, listener: p.pos })
          this.ctx.fx.hitEffect(p.pos.clone().add(new THREE.Vector3(0, 1.3, 0)), 'blood')
        }
      }
    }

    // animate
    const u = this.mesh.userData
    const t = this.phaseTimer
    const walk = dist > BOSS_DEF.atkRange ? 1 : 0
    const swing = Math.sin(t * 4) * 0.5 * walk
    u.armL.rotation.x = swing + (this.attackAnim > 0 ? -2.4 : 0)
    u.armR.rotation.x = -swing + (this.attackAnim > 0 ? -2.4 : 0)
    const targetYaw = Math.atan2(this.lookDir.x, this.lookDir.z)
    this.mesh.rotation.y = lerpAngle(this.mesh.rotation.y, targetYaw, Math.min(1, dt * 4))
    this.mesh.position.copy(this.pos)
    const pulse = 0.6 + Math.sin(t * 3) * 0.2
    u.core.material.color.setRGB(0.48 * pulse, 0.12 * pulse, 0.24 * pulse)
    u.eyes.material.color.setRGB(0.48 * pulse, 0.12 * pulse, 0.24 * pulse)
    if (this.hitFlash > 0) {
      u.body.material.emissive.setHex(0xffffff)
    } else u.body.material.emissive.setHex(0x000000)
  }

  teleportNear(p) {
    const t = this.tile
    const pt = { x: Math.floor(p.pos.x), y: Math.floor(p.pos.z) }
    const pf = makePathfinder(this.floor)
    const path = pf.find(pt.x, pt.y, t.x, t.y) || []
    const target = path[Math.floor(path.length * 0.4)] || path[path.length - 1] || pt
    this.pos.set(target.x + 0.5, 0, target.y + 0.5)
  }

  get tile() {
    return { x: Math.floor(this.pos.x), y: Math.floor(this.pos.z) }
  }

  takeDamage(amount, fromPos) {
    if (this.dead) return
    // phase 3: core exposed only
    this.hp -= amount
    this.hitFlash = 0.15
    if (this.hp <= 0) {
      this.dead = true
      this.ctx.onBossKilled && this.ctx.onBossKilled()
      this.ctx.audio.lazyPlay('enemyDeath', { gain: 0.8, pos: this.pos, listener: this.ctx.player.pos })
    }
  }

  applyKnockback(dir) {
    this.pos.addScaledVector(dir, 0.3)
  }

  dispose() {
    this.world.group.remove(this.mesh)
    this.mesh.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) o.material.dispose()
    })
  }
}

export function spawnFloorEnemies(floor, world, ctx) {
  const list = []
  for (const e of floor.enemies) {
    const en = new Enemy(e.type, floor, world, e.x, e.y, ctx)
    list.push(en)
  }
  if (floor.boss) {
    const boss = new BossArchitect(floor, world, ctx)
    list.push(boss)
  }
  return list
}
