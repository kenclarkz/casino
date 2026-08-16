// @ts-nocheck
// First-person player controller: movement (walk/run/crouch), collision vs
// level colliders, stamina, health, step sounds, noise emission.

import * as THREE from 'three'
import { PLAYER } from './config.js'
import { KEY, clamp, circleRect, lerp, damp } from './utils.js'

export class Player {
  constructor(scene, camera, input, audio, floorWorld, floor) {
    this.scene = scene
    this.camera = camera
    this.input = input
    this.audio = audio
    this.floorWorld = floorWorld
    this.floor = floor

    this.pos = new THREE.Vector3(floor.spawn.x + 0.5, 0, floor.spawn.y + 0.5)
    this.vel = new THREE.Vector3()
    this.yaw = 0
    this.pitch = 0
    this.eye = PLAYER.eye
    this.crouching = false
    this.crouchAmount = 0
    this.onGround = true
    this.jumpVel = 0
    this.exhausted = false
    this.regenDelay = 0

    this.health = PLAYER.healthMax
    this.stamina = PLAYER.staminaMax

    this.noise = 0
    this.bobPhase = 0
    this.stepAcc = 0
    this.lastY = 0
    this.inWater = false
    this.cameraShake = 0

    this.sprintHeld = false

    // spawn facing: away from safe room
    const sf = floor.safeSpawn
    this.yaw = Math.atan2(sf.x - floor.spawn.x, sf.y - floor.spawn.y)
    this.syncCamera()
  }

  get radius() {
    return PLAYER.radius
  }

  get exhaustedNow() {
    return this.exhausted
  }

  reset(floor) {
    this.floor = floor
    this.floorWorld = null
    this.pos.set(floor.spawn.x + 0.5, 0, floor.spawn.y + 0.5)
    this.vel.set(0, 0, 0)
    this.noise = 0
    this.syncCamera()
  }

  attachFloor(world) {
    this.floorWorld = world
  }

  // ---- input convenience ----
  wantRun() {
    const t = this.input.touchOverride
    if (t && t.runOverride != null) return t.runOverride
    return this.input.action(KEY.RUN)
  }

  addNoise(v) {
    this.noise = Math.max(this.noise, v)
  }

  damage(amount) {
    if (this.dead) return
    this.health = Math.max(0, this.health - amount)
    this.audio.lazyPlay('hurt', { gain: 0.6 })
    this.cameraShake = Math.min(1, 0.4 + amount / 80)
    if (this.health <= 0) this.dead = true
  }

  heal(amount) {
    this.health = clamp(this.health + amount, 0, PLAYER.healthMax)
  }

  useStamina(amount) {
    this.stamina = Math.max(0, this.stamina - amount)
    if (this.stamina <= PLAYER.exhaustedThreshold) this.exhausted = true
  }

  get canSprint() {
    return this.stamina > PLAYER.exhaustedThreshold + 2 && !this.exhausted
  }

  syncCamera() {
    const eyeH = lerp(PLAYER.eye, PLAYER.crouchEye, this.crouchAmount)
    this.camera.position.set(this.pos.x, eyeH, this.pos.z)
    this.camera.rotation.set(this.pitch, this.yaw, 0)
  }

  look(dx, dy, sensMul = 1) {
    this.yaw -= dx * PLAYER.mouseSensitivity * sensMul
    this.pitch -= dy * PLAYER.mouseSensitivity * sensMul
    this.pitch = clamp(this.pitch, -1.45, 1.45)
  }

  update(dt, mode) {
    if (mode !== 'play') {
      this.cameraShake = damp(this.cameraShake, 0, 3, dt)
      this.syncCamera()
      return
    }

    const input = this.input
    const axis = input.axis()
    const running = this.wantRun() && this.canSprint && !this.crouching && axis.y > 0
    const crouchKey = input.action(KEY.CROUCH)
    const wantCrouch = crouchKey || (input.touchOverride && input.touchOverride.crouchOverride)

    this.crouching = wantCrouch
    this.crouchAmount = damp(this.crouchAmount, wantCrouch ? 1 : 0, PLAYER.crouchSmooth, dt)

    // stamina
    if (running) {
      this.stamina = Math.max(0, this.stamina - PLAYER.runDrain * dt)
      this.regenDelay = PLAYER.regenDelay
      if (this.stamina <= 0) {
        this.exhausted = true
      }
    } else if (this.regenDelay > 0) {
      this.regenDelay -= dt
    } else {
      this.stamina = clamp(this.stamina + PLAYER.staminaRegen * dt, 0, PLAYER.staminaMax)
      if (this.stamina > PLAYER.exhaustedThreshold + 4) this.exhausted = false
    }

    // movement speed by state
    let speed = PLAYER.walkSpeed
    if (this.crouching) speed = PLAYER.crouchSpeed
    else if (running) speed = PLAYER.runSpeed
    if (this.inWater) speed *= 0.6
    if (this.exhausted && running) speed = PLAYER.walkSpeed

    // desired horizontal velocity from camera yaw
    const sinY = Math.sin(this.yaw)
    const cosY = Math.cos(this.yaw)
    // camera-relative: forward = (-sinY, -cosY)? depends on convention
    // We use yaw rotation around Y; forward vector when pitch=0, yaw=0 faces -Z.
    const fwd = new THREE.Vector3(-sinY, 0, -cosY)
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x)
    const wish = new THREE.Vector3()
    wish.addScaledVector(fwd, axis.y)
    wish.addScaledVector(right, axis.x)
    if (wish.lengthSq() > 0) wish.normalize()
    wish.multiplyScalar(speed)

    const accel = this.crouching ? PLAYER.accel * 0.6 : PLAYER.accel
    this.vel.x = damp(this.vel.x, wish.x, accel, dt)
    this.vel.z = damp(this.vel.z, wish.z, accel, dt)

    // integrate + collide
    const dx = this.vel.x * dt
    const dz = this.vel.z * dt
    this.moveCollided(dx, dz)

    // bounds
    const b = this.floor.bounds
    this.pos.x = clamp(this.pos.x, 0.35, b.w - 0.35)
    this.pos.z = clamp(this.pos.z, 0.35, b.h - 0.35)

    // surface / water
    const surf = this.floorWorld.surfaceAt(this.pos.x, this.pos.z)
    const wasWater = this.inWater
    this.inWater = surf === 'water'
    if (this.inWater && !wasWater) this.audio.lazyPlay('splash', { gain: 0.4 })
    if (!this.inWater && wasWater) this.audio.lazyPlay('splash', { gain: 0.3 })

    // footstep cadence
    const moving = Math.hypot(this.vel.x, this.vel.z) > 0.4
    if (moving) {
      const stepInt = this.crouching
        ? PLAYER.stepIntervalCrouch
        : running
          ? PLAYER.stepIntervalRun
          : PLAYER.stepIntervalWalk
      this.stepAcc += dt
      this.bobPhase += dt * PLAYER.headBobFreq * (this.crouching ? 0.7 : running ? 1.4 : 1)
      if (this.stepAcc >= stepInt) {
        this.stepAcc = 0
        const vol = this.crouching ? 0.08 : running ? 0.28 : 0.15
        this.audio.lazyPlay('step', { gain: vol, surf: this.inWater ? 'water' : surf })
      }
    } else {
      this.stepAcc = 0
    }

    // noise emission
    const baseNoise = this.crouching ? PLAYER.noise.crouch : running ? PLAYER.noise.run : PLAYER.noise.walk
    if (moving) this.noise = Math.max(this.noise, baseNoise)
    this.noise = Math.max(0, this.noise - dt * 6)

    // head bob (only moves the visual camera a bit)
    const bobAmp = this.crouching ? 0 : running ? PLAYER.headBobRun : PLAYER.headBobWalk
    const bobY = moving ? Math.sin(this.bobPhase * 2) * bobAmp : 0
    const eyeH = lerp(PLAYER.eye, PLAYER.crouchEye, this.crouchAmount)
    this.camera.position.set(this.pos.x, eyeH + bobY, this.pos.z)
    this.camera.rotation.set(this.pitch, this.yaw, 0)

    // camera shake decay
    this.cameraShake = Math.max(0, this.cameraShake - dt * 1.6)
    if (this.cameraShake > 0) {
      const s = this.cameraShake * 0.05
      this.camera.rotation.z = Math.sin(this.bobPhase * 9) * s
      this.camera.rotation.x = this.pitch + Math.sin(this.bobPhase * 7) * s
    }
  }

  moveCollided(dx, dz) {
    const rects = this.floorWorld.colliders
    const r = this.radius
    // X axis
    let nx = this.pos.x + dx
    let hitX = false
    for (const c of rects) {
      if (circleRect(nx, this.pos.z, r, c.x - c.w / 2 - r, c.z - c.d / 2 - r, c.w + r * 2, c.d + r * 2)) {
        hitX = true
        break
      }
    }
    if (!hitX) this.pos.x = nx
    else this.vel.x = 0
    // Z axis
    let nz = this.pos.z + dz
    let hitZ = false
    for (const c of rects) {
      if (circleRect(this.pos.x, nz, r, c.x - c.w / 2 - r, c.z - c.d / 2 - r, c.w + r * 2, c.d + r * 2)) {
        hitZ = true
        break
      }
    }
    if (!hitZ) this.pos.z = nz
    else this.vel.z = 0
  }
}
