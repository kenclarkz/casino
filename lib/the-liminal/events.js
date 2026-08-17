// @ts-nocheck
// Random & scripted horror events: flickers, whispers, phantom footsteps,
// phones, alarms, water rises, phantom trains, glitches, blessings, etc.
// Each event manipulates the game via a shared ctx.

import * as THREE from 'three'
import { makeRng, clamp, pickWeighted } from './utils.js'
import { T } from './levelgen.js'
import { LOOT_TABLES, ITEMS } from './items.js'

export class EventEngine {
  constructor(game) {
    this.game = game
    this.rng = makeRng(Math.floor(Math.random() * 1e9))
    this.timer = 14 + this.rng.next() * 14
    this.last = null
    this.activeEffects = []
  }

  update(dt) {
    const g = this.game
    const env = g.currentEnv
    const diff = g.diff
    this.timer -= dt
    // update active effects
    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const e = this.activeEffects[i]
      e.t -= dt
      if (e.t <= 0) {
        this.activeEffects.splice(i, 1)
        if (e.onEnd) e.onEnd(e)
        continue
      }
      if (e.onUpdate) e.onUpdate(e.t, e)
    }
    // water damage while flooded
    const flood = this.activeEffects.find((e) => e.id === 'waterRise')
    if (flood && g.player && g.player.inWater) {
      g.player.damage(3.5 * dt)
    }

    if (this.timer <= 0) {
      this.timer = diff.eventFreq * (0.6 + this.rng.next() * 0.9)
      this.fire(env)
    }
  }

  fire(env) {
    const g = this.game
    const pool = env.events || []
    if (!pool.length) return
    const weighted = pool.map((id) => ({ w: this.eventWeight(id), value: id }))
    const ev = this.rng.weighted(weighted)
    if (ev === this.last && this.rng.chance(0.5)) return
    this.last = ev
    const fn = this[ev]
    if (typeof fn === 'function') {
      try {
        fn.call(this, g)
      } catch (e) {
        console.warn('event error', ev, e)
      }
    }
  }

  eventWeight(id) {
    const base = {
      whisper: 16, flicker: 14, flickerBurst: 10, phantomStep: 10, doorSlam: 9,
      coldSpot: 8, staticBurst: 8, phoneRing: 7, bell: 6, alarm: 7,
      trainWhistle: 8, waterRise: 8, realityGlitch: 6, mannequinShift: 7,
      paperRustle: 7, drip: 6, lightOrb: 5, heartbeat: 8,
    }
    return base[id] || 5
  }

  toast(msg, sub) {
    if (this.game.ui) this.game.ui.toast(msg, sub)
  }

  // ---------------- events ----------------

  whisper(g) {
    g.audio.lazyPlay('whisper', { gain: 0.5 })
    g.fx.screenFlash(0xffffff, 0.12)
    this.toast('A whisper, close to your ear...', 'You are not alone down here.')
    const pt = g.player.pos
    for (const e of g.enemies) {
      if (e.type === 'tuner' || e.type === 'nurse') {
        e.lastKnown = { x: pt.x + (Math.random() - 0.5) * 4, z: pt.z + (Math.random() - 0.5) * 4 }
      }
    }
  }

  flicker(g) {
    const t = 4 + this.rng.next() * 2.5
    this.activeEffects.push({ id: 'flicker', t, onEnd: () => g.setPower(true) })
    g.setPower(false)
    g.audio.lazyPlay('staticBurst', { gain: 0.35 })
    this.toast('The lights die...', 'Something stirs in the dark.')
    // aggro enemies nearby
    const pt = g.player.pos
    for (const e of g.enemies) {
      if (e.dead) continue
      if (e.getPos().distanceTo(pt) < 14 && this.rng.chance(0.6)) {
        e.lastKnown = { x: pt.x, z: pt.z }
        if (e.state === 'patrol' || e.state === 'idle') e.state = 'investigate'
      }
    }
  }

  flickerBurst(g) {
    g.audio.lazyPlay('flickerBurst' in g.audio._sfx ? 'flickerBurst' : 'staticBurst', { gain: 0.3 })
    // flash a nearby light rapidly
    const lights = g.world.lights
    if (lights.length) {
      const l = lights[Math.floor(this.rng.next() * lights.length)]
      l.flicker = true
      g.activeBursts = g.activeBursts || []
      g.activeBursts.push(l)
    }
    this.toast('A light stutters above you.', null)
  }

  phantomStep(g) {
    const p = g.player.pos
    const angle = this.rng.next() * Math.PI * 2
    const d = 6 + this.rng.next() * 5
    const x = p.x + Math.cos(angle) * d
    const z = p.z + Math.sin(angle) * d
    g.audio.lazyPlay('step', { gain: 0.3, pos: { x, y: 0, z }, listener: p })
    this.activeEffects.push({
      id: 'phantomStep',
      t: 3,
      onUpdate: (et) => {
        if (Math.floor(et * 3) % 2 === 0) {
          g.audio.lazyPlay('step', { gain: 0.22, pos: { x: x + (Math.random() - 0.5) * 2, y: 0, z }, listener: p })
        }
      },
    })
    g.emitNoise(x, z, 10)
  }

  doorSlam(g) {
    const doors = [...g.world.doors.values()]
    if (!doors.length) return
    const near = doors
      .filter((d) => Math.hypot(d.x - g.player.pos.x, d.z - g.player.pos.z) < 20)
    const d = near.length ? near[Math.floor(this.rng.next() * near.length)] : doors[0]
    d.targetOpen = false
    d.open = 0
    g.audio.lazyPlay('doorSlam', { gain: 0.7, pos: new THREE.Vector3(d.x, 1, d.z), listener: g.player.pos })
    g.emitNoise(d.x, d.z, 8)
    this.toast('A door slams somewhere close.', null)
  }

  coldSpot(g) {
    this.activeEffects.push({ id: 'coldSpot', t: 6, onEnd: () => g.ui && g.ui.setFogOverlay(0) })
    if (g.ui) g.ui.setFogOverlay(0.5)
    g.audio.lazyPlay('whisper', { gain: 0.2 })
    this.toast('The air turns cold.', 'Your breath fogs.')
  }

  staticBurst(g) {
    g.audio.lazyPlay('staticBurst', { gain: 0.6 })
    g.fx.screenFlash(0x88ff88, 0.08)
    this.toast('Radio static, impossibly loud.', null)
  }

  phoneRing(g) {
    if (g.currentEnv.id !== 'school') return
    const p = g.player.pos
    // find a phone prop-ish tile away from player
    let x = Math.floor(p.x) + (Math.random() > 0.5 ? 1 : -1) * 8
    let z = Math.floor(p.z) + (Math.random() > 0.5 ? 1 : -1) * 6
    x = clamp(x, 2, g.floor.w - 3)
    z = clamp(z, 2, g.floor.h - 3)
    const wx = x + 0.5
    const wz = z + 0.5
    const ringHandle = g.audio.lazyPlay('phoneRing', { gain: 0.8, pos: new THREE.Vector3(wx, 1, wz), listener: p, loop: true })
    const ev = {
      id: 'phoneRing',
      t: 4.5,
      rings: 0,
      wx,
      wz,
      onUpdate: (et, ev2) => {
        const ringNo = Math.floor(et * 2.4)
        if (ringNo !== ev2.rings) {
          ev2.rings = ringNo
          g.audio.lazyPlay('phoneRing', { gain: 0.7, pos: new THREE.Vector3(wx, 1, wz), listener: g.player.pos })
        }
        // if player is near, they can answer
        if (g.player.pos.distanceTo(new THREE.Vector3(wx, 0, wz)) < 2.2 && g.input.action(12)) {
          ev2.answered = true
          g.audio.lazyPlay('pickup', { gain: 0.5 })
          this.toast('You answer the phone. Silence. Then a click.', 'The Principal loses your trail.')
          this.activeEffects = this.activeEffects.filter((x2) => x2 !== ev2)
        }
      },
      onEnd: (ev2) => {
        if (ringHandle && ringHandle.stop) ringHandle.stop()
        if (ev2.answered) return
        this.toast('The phone rings on and on...', 'Then stops.')
        // Principal teleports near player
        const prin = g.enemies.find((e) => e.type === 'principal' && !e.dead)
        if (prin) {
          const px = Math.floor(p.x)
          const pz = Math.floor(p.z)
          prin.setTile(px + (Math.random() > 0.5 ? 1 : -1), pz)
          prin.lastKnown = { x: p.x, z: p.z }
          prin.state = 'chase'
          prin.stateTime = 0
          g.audio.lazyPlay('doorSlam', { gain: 0.6, pos: g.player.pos, listener: g.player.pos })
          g.fx.shockwave(prin.getPos(), 0x8a5a2a)
        }
      },
    }
    this.activeEffects.push(ev)
    this.toast('A phone is ringing...', 'Answer it before the third ring.')
  }

  bell(g) {
    if (g.currentEnv.id !== 'school') return
    g.audio.lazyPlay('bell', { gain: 0.8 })
    const p = g.player.pos
    for (const e of g.enemies) {
      if (e.dead) continue
      e.lastKnown = { x: p.x, z: p.z }
      if (e.state === 'patrol' || e.state === 'idle') e.state = 'investigate'
    }
    this.toast('The school bell rings.', 'Everyone is paying attention now.')
  }

  alarm(g) {
    g.audio.lazyPlay('alarm', { gain: 0.7 })
    g.fx.screenFlash(0xff3a2a, 0.18)
    const p = g.player.pos
    for (const e of g.enemies) {
      if (e.dead) continue
      if (e.getPos().distanceTo(p) < 18) {
        e.lastKnown = { x: p.x, z: p.z }
        if (e.state === 'patrol' || e.state === 'idle') e.state = 'investigate'
      }
    }
    this.toast('An alarm blares through the building.', 'They heard it too.')
  }

  trainWhistle(g) {
    if (g.currentEnv.id !== 'metro') return
    const rails = g.floor.rails
    if (!rails.length) return
    g.audio.lazyPlay('whistle', { gain: 0.9 })
    this.toast('A whistle shrieks down the tunnel.', 'Train coming.')
    // pick a rail row with player proximity
    let bestRow = rails[0].y
    let bestDist = Infinity
    for (const r of rails) {
      const d = Math.abs(r.y - g.player.pos.z)
      if (d < bestDist) {
        bestDist = d
        bestRow = r.y
      }
    }
    const train = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.4, 60), new THREE.MeshBasicMaterial({ color: 0x0a0a0e }))
    train.position.set(-10, 1.7, bestRow + 0.5)
    train.velocity = 14
    train.passed = false
    g.world.group.add(train)
    g.activeTrain = train
    g.trainRow = bestRow
    g.trainTime = 4.2
    g.audio.lazyPlay('train', { gain: 0.6, pos: { x: 0, y: 0, z: bestRow }, listener: g.player.pos })
  }

  waterRise(g) {
    if (g.currentEnv.id !== 'pool') return
    this.activeEffects.push({ id: 'waterRise', t: 9, onEnd: () => this.toast('The water recedes.', null) })
    g.audio.lazyPlay('splash', { gain: 0.6 })
    this.toast('The water is rising!', 'Stay on the dry tiles.')
  }

  realityGlitch(g) {
    g.audio.lazyPlay('glitch', { gain: 0.7 })
    g.fx.screenFlash(0x7a1f3d, 0.3)
    // teleport player a couple tiles (short)
    const p = g.player.pos
    if (this.rng.chance(0.6)) {
      const nx = clamp(p.x + this.rng.int(-3, 3), 1, g.floor.w - 1)
      const nz = clamp(p.z + this.rng.int(-3, 3), 1, g.floor.h - 1)
      if (g.world.tileAt(nx, nz) !== T.WALL) {
        p.set(nx, 0, nz)
        g.fx.shockwave(new THREE.Vector3(nx, 0, nz), 0x7a1f3d)
      }
    }
    this.toast('Reality shudders.', 'The room rearranges itself.')
  }

  mannequinShift(g) {
    if (g.currentEnv.id !== 'mall') return
    g.audio.lazyPlay('vocMannequin', { gain: 0.6 })
    for (const e of g.enemies) {
      if (e.type !== 'mannequin' || e.dead) continue
      const p = g.player.pos
      const d = e.getPos().distanceTo(p)
      if (d < 22) {
        const nx = p.x + (Math.random() - 0.5) * 8
        const nz = p.z + (Math.random() - 0.5) * 8
        e.pos.set(clamp(nx, 1, g.floor.w - 1), 0, clamp(nz, 1, g.floor.h - 1))
      }
    }
    this.toast('You feel watched.', 'When you blink, they move.')
  }

  paperRustle(g) {
    if (g.currentEnv.id !== 'office') return
    g.audio.lazyPlay('paperRustle', { gain: 0.6 })
    for (const e of g.enemies) {
      if (e.type === 'paper' && !e.dead) e.growTimer = Math.min(e.growTimer, 1.5)
    }
    this.toast('Paper rustles in every direction.', null)
  }

  drip(g) {
    if (g.currentEnv.id !== 'pool') return
    g.audio.lazyPlay('drip', { gain: 0.5 })
  }

  lightOrb(g) {
    const table = LOOT_TABLES[g.currentEnv.loot] || LOOT_TABLES.generic
    const tier = this.rng.weighted([
      { w: 40, value: 'common' },
      { w: 40, value: 'uncommon' },
      { w: 20, value: 'rare' },
    ])
    const item = pickWeighted(table[tier], this.rng)
    const count = this.rng.chance(0.3) ? 2 : 1
    const p = g.player.pos
    const angle = this.rng.next() * Math.PI * 2
    const d = 3 + this.rng.next() * 3
    g.spawnLoot(p.x + Math.cos(angle) * d, p.z + Math.sin(angle) * d, item, count)
    g.fx.screenFlash(0xffd27a, 0.15)
    this.toast('A warm light flickers ahead...', `It seems to hold ${ITEMS[item].name}.`)
  }

  heartbeat(g) {
    const near = g.enemies.some((e) => !e.dead && e.getPos().distanceTo(g.player.pos) < 8)
    if (!near) {
      this.toast('Your heartbeat is the only sound.', null)
      return
    }
    const h = g.audio.lazyPlay('heartbeat', { gain: 0.7 })
    this.activeEffects.push({ id: 'heartbeat', t: 2.5, onEnd: () => h && h.stop && h.stop() })
    if (g.ui) g.ui.pulseVignette(0.4)
  }
}
