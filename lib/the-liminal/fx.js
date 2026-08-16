// @ts-nocheck
// Visual FX: pooled particles, blood/sparks, muzzle flash, molotov projectile
// + fire zones, shockwave rings. Reads enemies via ctx for fire damage.

import * as THREE from 'three'
import { clamp } from './utils.js'

const PARTICLE_POOL = 240

export class Fx {
  constructor(scene, camera, ctx) {
    this.scene = scene
    this.camera = camera
    this.ctx = ctx
    this.particles = []
    this.fires = []
    this.shockwaves = []
    this.projectiles = []
    this.flashIntensity = 0
    this.flashColor = 0xffffff
    this._pool = []
    this._makePool(scene)
    this.bloodMat = new THREE.MeshBasicMaterial({ color: 0x8a0f1a })
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffe9a0 })
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffd27a })
    this.shockGeo = new THREE.RingGeometry(0.9, 1, 24)
  }

  _makePool(scene) {
    const geo = new THREE.BoxGeometry(0.07, 0.07, 0.07)
    for (let i = 0; i < PARTICLE_POOL; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }))
      m.visible = false
      scene.add(m)
      this._pool.push({ mesh: m, life: 0, vel: new THREE.Vector3(), gravity: 0, active: false, spin: new THREE.Vector3() })
    }
  }

  _spawn(pos, count, color, speed, life, gravity = 8, spread = 1) {
    const mat = new THREE.MeshBasicMaterial({ color })
    for (let i = 0; i < count; i++) {
      const p = this._pool.find((x) => !x.active)
      if (!p) return
      p.active = true
      p.mesh.visible = true
      p.mesh.material = mat
      p.mesh.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread))
      p.vel.set((Math.random() - 0.5) * speed, Math.random() * speed * 0.7, (Math.random() - 0.5) * speed)
      p.life = life
      p.gravity = gravity
      p.spin.set(Math.random() * 8, Math.random() * 8, 0)
    }
  }

  hitEffect(pos, kind) {
    if (kind === 'blood') {
      this._spawn(pos, 10, 0x8a0f1a, 3.5, 0.7, 7, 0.4)
      this._spawn(pos, 4, 0xc02030, 2.5, 0.5, 7, 0.3)
    } else {
      this._spawn(pos, 6, 0xffe9a0, 4, 0.35, 5, 0.2)
    }
  }

  muzzleFlash(cam, big = false) {
    const flash = new THREE.Mesh(new THREE.SphereGeometry(big ? 0.35 : 0.22, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffe9a0 }))
    flash.position.copy(cam.position)
    flash.position.add(cam.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.7))
    this.scene.add(flash)
    const light = new THREE.PointLight(0xffd9a0, 6, 8, 1.4)
    light.position.copy(flash.position)
    this.scene.add(light)
    this.particles.push({ mesh: flash, life: 0.07, vel: new THREE.Vector3(), gravity: 0, active: true, isFlash: true, light })
  }

  throwMolotov(from, dir) {
    const proj = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ color: 0x7a4a2a }))
    proj.position.copy(from)
    proj.vel = dir.clone().multiplyScalar(12)
    proj.vel.y = 4
    this.scene.add(proj)
    this.projectiles.push(proj)
  }

  shockwave(pos, color) {
    const ring = new THREE.Mesh(this.shockGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide }))
    ring.position.set(pos.x, 0.2, pos.z)
    ring.rotation.x = -Math.PI / 2
    this.scene.add(ring)
    this.shockwaves.push({ mesh: ring, t: 0 })
  }

  update(dt) {
    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= dt
      if (p.life <= 0) {
        this.scene.remove(p.mesh)
        if (p.light) this.scene.remove(p.light)
        this.particles.splice(i, 1)
        continue
      }
      if (p.isFlash) continue
      p.vel.y -= (p.gravity || 8) * dt
      p.mesh.position.addScaledVector(p.vel, dt)
      p.mesh.rotation.x += dt * p.spin.x
      p.mesh.rotation.y += dt * p.spin.y
    }
    // pooled
    for (const p of this._pool) {
      if (!p.active) continue
      p.life -= dt
      if (p.life <= 0) {
        p.active = false
        p.mesh.visible = false
        continue
      }
      p.vel.y -= p.gravity * dt
      p.mesh.position.addScaledVector(p.vel, dt)
      p.mesh.rotation.x += dt * p.spin.x
      p.mesh.rotation.y += dt * p.spin.y
    }
    // projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i]
      pr.vel.y -= 14 * dt
      pr.position.addScaledVector(pr.vel, dt)
      if (pr.position.y <= 0.1) {
        this.createFire(pr.position)
        this.scene.remove(pr)
        this.projectiles.splice(i, 1)
      }
    }
    // fires
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i]
      f.t += dt
      if (f.t > f.life) {
        this.scene.remove(f.mesh)
        this.scene.remove(f.light)
        this.fires.splice(i, 1)
        continue
      }
      f.mesh.scale.setScalar(1 + Math.sin(f.t * 30) * 0.06)
      f.light.intensity = 3 * (1 - f.t / f.life) * (0.7 + Math.sin(f.t * 40) * 0.3)
      // damage enemies
      if (this.ctx && this.ctx.enemies) {
        for (const e of this.ctx.enemies()) {
          if (e.dead) continue
          const d = e.getPos().distanceTo(f.mesh.position)
          if (d < f.radius) {
            e.takeDamage(14 * dt, f.mesh.position, new THREE.Vector3(0, 0, 1))
          }
        }
      }
    }
    // shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i]
      s.t += dt
      if (s.t > 0.5) {
        this.scene.remove(s.mesh)
        this.shockwaves.splice(i, 1)
        continue
      }
      s.mesh.scale.setScalar(1 + s.t * 8)
      s.mesh.material.opacity = 0.6 * (1 - s.t / 0.5)
    }
    // flash decay
    this.flashIntensity = Math.max(0, this.flashIntensity - dt * 2.2)
  }

  createFire(pos) {
    const radius = 2.6
    const flame = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.5 }))
    flame.position.set(pos.x, 0.3, pos.z)
    flame.scale.y = 0.5
    this.scene.add(flame)
    const light = new THREE.PointLight(0xff8a2a, 3, 10, 1.4)
    light.position.set(pos.x, 1.2, pos.z)
    this.scene.add(light)
    this.fires.push({ mesh: flame, light, t: 0, life: 8, radius })
    this.ctx.audio && this.ctx.audio.lazyPlay('fire', { gain: 0.5, pos: { x: pos.x, y: 0, z: pos.z }, listener: this.ctx.player.pos })
  }

  screenFlash(color, intensity) {
    this.flashColor = color
    this.flashIntensity = Math.max(this.flashIntensity, intensity)
  }
}
