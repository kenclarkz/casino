// @ts-nocheck
// THE LIMINAL — main game orchestrator.
// Wires together levelgen, builder, player, flashlight, combat, enemies, fx,
// events, audio, input, UI, mobile controls, and the save/checkpoint system.

import * as THREE from 'three'
import { generateFloor } from './levelgen.js'
import { buildFloorWorld } from './builder.js'
import { getEnv, FLOOR_COUNT } from './environments.js'
import { Player } from './player.js'
import { Flashlight } from './flashlight.js'
import { Combat } from './combat.js'
import { Enemy, spawnFloorEnemies } from './enemies.js'
import { Fx } from './fx.js'
import { EventEngine } from './events.js'
import { Input } from './input.js'
import { Mobile } from './mobile.js'
import { UI } from './ui.js'
import { audio } from './audio.js'
import { makeRng, hashString, KEY, clamp, fmtTime } from './utils.js'
import { GAME, PLAYER, FLASHLIGHT, COMBAT, CHECKPOINT, DISPLAY } from './config.js'
import { ITEMS, CONTAINER_TYPES, CRAFTING, craft, LOOT_TABLES } from './items.js'
import {
  newSaveState, saveGame, loadGame, hasSave, clearSave,
  loadSettings, saveSettings, applyDeath, difficultyForFloor, serializeRun,
} from './save.js'

const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)

export class Game {
  constructor(container) {
    this.container = container
    if (typeof window !== 'undefined') window.__tl_game = this
    this.mode = 'menu' // menu | play | paused | dead | victory
    this.settings = loadSettings()
    this.audioEngine = audio()
    this.applySettings()
    this.hasSave = hasSave()

    this.setupRenderer(container)
    this.setupAudioListener()

    this.input = new Input(container)
    this.input.enabled = true

    this.ui = new UI(container)
    this.bindUI()

    this.mobile = isTouch ? new Mobile(container, this.input, this.ui) : null

    this.state = null
    this.floor = null
    this.world = null
    this.enemies = []
    this.player = null
    this.flashlight = null
    this.combat = null
    this.fx = null
    this.events = null
    this.ctx = null

    this.power = true
    this.activeTrain = null
    this.trainTime = 0
    this.trainRow = 0
    this.activeBursts = []
    this.objectiveText = ''
    this.boss = null
    this.bossKilled = false
    this.promptObj = null

    this._t = 0
    this._last = performance.now()

    window.addEventListener('resize', this._onResize)
    this.ui.updateContinueButton(this.hasSave)
    this.showMenu()
    this.start()
  }

  // ---------------- setup ----------------
  setupRenderer(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? DISPLAY.mobilePixelRatioCap : DISPLAY.pixelRatioCap))
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight)
    this.renderer.shadowMap.enabled = this.settings.shadows
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.renderer.domElement.style.display = 'block'

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(DISPLAY.fov, this.aspect(), DISPLAY.near, DISPLAY.far)
    this.baseFov = DISPLAY.fov
    this.scene.add(this.camera)

    this.scene.ambient = new THREE.AmbientLight(0xffffff, 0.2)
    this.scene.add(this.scene.ambient)
    this.scene.hemi = new THREE.HemisphereLight(0x8899aa, 0x000000, 0.15)
    this.scene.add(this.scene.hemi)
  }

  setupAudioListener() {
    this.listenerObj = { x: 0, y: 0, z: 0, yaw: 0 }
    this.audioEngine.listener = this.listenerObj
  }

  aspect() {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight
    return w / Math.max(1, h)
  }

  _onResize = () => {
    this.renderer.setSize(this.container.clientWidth || window.innerWidth, this.container.clientHeight || window.innerHeight)
    this.camera.aspect = this.aspect()
    this.camera.updateProjectionMatrix()
  }

  applySettings() {
    const s = this.settings
    const ae = this.audioEngine
    ae.ensure()
    if (!ae.master) return
    ae.master.gain.value = s.masterVolume ?? 0.8
    ae.sfx.gain.value = s.sfxVolume ?? 0.9
    ae.music.gain.value = s.musicVolume ?? 0.7
  }

  // ---------------- UI wiring ----------------
  bindUI() {
    const u = this.ui
    u.on('menu:new', () => this.newRun())
    u.on('menu:continue', () => this.continueRun())
    u.on('menu:settings', () => this.openSettings('mainMenu'))
    u.on('menu:back-settings', () => this.closeSettings())
    u.on('menu:controls', () => u.showScreen('controls'))
    u.on('menu:back-controls', () => u.showScreen('mainMenu'))
    u.on('menu:credits', () => this.showCredits())
    u.on('menu:resume', () => this.togglePause())
    u.on('menu:save', () => this.saveCheckpoint(true))
    u.on('menu:settings2', () => this.openSettings('pause'))
    u.on('menu:quit', () => this.quitToMenu())
    u.on('menu:retry', () => this.respawn())
    u.on('menu:victory-continue', () => this.quitToMenu())

    u.on('inv:open', () => this.openInventory())
    u.on('inv:close', () => this.closeInventory())
    u.on('inv:use', (i) => this.useSlot(i))
    u.on('inv:drop', (i) => this.dropSlot(i))
    u.on('inv:craft', (id) => {
      const recipe = CRAFTING.find((r) => r.id === id)
      if (recipe && craft(recipe, this.state.inventory)) return true
      return false
    })
    u.on('inv:get', () => this.state.inventory)
    u.on('inv:notes', () => {
      const env = this.currentEnv
      const out = []
      for (const nid of this.state.inventory.notes) {
        const note = (env && env.lore ? env.lore : []).find((n) => n.id === nid)
        if (note) out.push(note)
      }
      return out
    })
  }

  showCredits() {
    this.ui.toast('THE LIMINAL — a survival horror experiment', 'All code, audio, and lore hand-built.')
    this.ui.showScreen('mainMenu')
  }

  openSettings(backTo) {
    this.ui.buildSettings(this.settings, (key, val) => {
      this.settings[key] = val
      if (key === 'masterVolume' || key === 'sfxVolume' || key === 'musicVolume') this.applySettings()
      if (key === 'shadows') this.renderer.shadowMap.enabled = val
      if (key === 'sensitivity') PLAYER.mouseSensitivity = 0.0022 * val
      saveSettings(this.settings)
    })
    this.settingsBackTo = backTo
    this.ui.showScreen('settings')
  }

  closeSettings() {
    this.ui.showScreen(this.settingsBackTo || 'mainMenu')
  }

  // ---------------- menu / run lifecycle ----------------
  showMenu() {
    this.mode = 'menu'
    this.input.enabled = false
    this.input.exitLock()
    if (this.mobile) this.mobile.disable()
    this.ui.showScreen('mainMenu')
    this.ui.showHud(false)
    this.ui.updateContinueButton(hasSave())
  }

  newRun() {
    const seed = Math.floor(Math.random() * 1e9)
    this.state = newSaveState(seed, 0)
    const inv = this.state.inventory
    inv.add('pipe', 1, ITEMS.pipe.weapon.durability)
    inv.add('bandage', 2)
    inv.add('water', 1)
    inv.add('match', 1)
    inv.equip('pipe', 'melee')
    this.startSession()
  }

  continueRun() {
    const d = loadGame()
    if (!d) {
      this.ui.toast('No checkpoint found.', 'Start a new descent.')
      return
    }
    this.state = d
    this.startSession()
  }

  startSession() {
    this.input.enabled = true
    this.mode = 'play'
    this.ui.showHud(true)
    if (this.mobile) this.mobile.enable()
    this.loadFloor(this.state.floorIndex || 0)
    this.input.requestLock()
  }

  quitToMenu() {
    this.audioEngine.stopAmbient()
    this.teardownFloor()
    this.state = null
    this.showMenu()
  }

  // ---------------- floor lifecycle ----------------
  loadFloor(idx, fromSave = false) {
    this.teardownFloor()
    this.floorIndex = idx
    this.currentEnv = getEnv(idx)
    this.diff = difficultyForFloor(idx)
    this.rng = makeRng(hashString(`${this.state.seed}|${idx}`))
    this.bossKilled = false
    this.boss = null
    this.power = true
    this.activeTrain = null
    this.activeBursts = []

    const floor = generateFloor(this.state.seed, idx)
    this.floor = floor
    this.world = buildFloorWorld(floor)
    this.scene.add(this.world.group)

    this.player = new Player(this.scene, this.camera, this.input, this.audioEngine, this.world, floor)
    this.flashlight = new Flashlight(this.camera, this.scene)

    this.ctx = this.buildCtx()
    this.combat = new Combat(this.ctx)
    this.fx = new Fx(this.scene, this.camera, this.ctx)
    this.events = new EventEngine(this)

    this.enemies = spawnFloorEnemies(floor, this.world, this.ctx)
    this.boss = this.enemies.find((e) => e.type === 'architect') || null

    this.applyFloorLook()
    this.setObjective()
    this.setupAmbient()

    if (fromSave && this.state.pos) {
      this.player.pos.set(this.state.pos.x, 0, this.state.pos.z)
      if (this.state.rot) {
        this.player.yaw = this.state.rot.y
        this.player.pitch = this.state.rot.x || 0
      }
    }
    this.player.syncCamera()

    if (this.state.health != null) this.player.health = this.state.health
    if (this.state.stamina != null) this.player.stamina = this.state.stamina
    if (this.state.battery != null) this.flashlight.setBattery(this.state.battery)

    // starting floor: auto-save checkpoint
    if (idx === 0 && !fromSave) this.saveCheckpoint(false)

    const env = this.currentEnv
    this.ui.transition(env.name, env.subtitle, 800)
    this.audioEngine.setAmbient(env.ambience || {})
    this.ui.setFogOverlay(0)
    this.ui.flash('#000000', 1)
  }

  teardownFloor() {
    if (this.events) {
      this.events.activeEffects = []
    }
    if (this.enemies) {
      for (const e of this.enemies) e.dispose && e.dispose()
    }
    if (this.world) {
      this.scene.remove(this.world.group)
      this.world.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose()
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material]
          for (const m of ms) m.dispose && m.dispose()
        }
      })
    }
    if (this.fx) {
      for (const m of this.fx._pool) if (m.mesh) this.scene.remove(m.mesh)
      for (const p of this.fx.particles) if (p.mesh) this.scene.remove(p.mesh)
      for (const pr of this.fx.projectiles) this.scene.remove(pr)
      for (const f of this.fx.fires) { this.scene.remove(f.mesh); this.scene.remove(f.light) }
      for (const s of this.fx.shockwaves) this.scene.remove(s.mesh)
    }
    this.enemies = []
    this.world = null
    this.fx = null
    this.events = null
  }

  buildCtx() {
    const game = this
    return {
      camera: this.camera,
      input: this.input,
      audio: this.audioEngine,
      ui: this.ui,
      player: this.player,
      flashlight: this.flashlight,
      inventory: this.state.inventory,
      floorWorld: this.world,
      currentEnv: this.currentEnv,
      diff: this.diff,
      baseFov: this.baseFov,
      rng: this.rng,
      enemies: () => this.enemies,
      g: this,
      onMeleeBroke: () => {
        this.ui.toast('Your weapon broke.', null)
        this.audioEngine.lazyPlay('ui', { gain: 0.3 })
      },
      onGunFired: (loud) => {
        this.emitNoise(this.player.pos.x, this.player.pos.z, loud || 100)
      },
      onEnemyKilled: (e) => {
        this.state.stats.kills++
      },
      onPlayerHit: (e) => {
        this.ui.damageFlash(this.player.health)
        this.state.stats.hits = (this.state.stats.hits || 0) + 1
      },
      onBossSpawn: (b) => {
        this.ui.toast('THE ARCHITECT', 'It is here. This is the bottom.')
        this.setObjective('Kill The Architect')
      },
      onBossPhase: (n) => {
        this.ui.toast(`Phase ${n}`, n === 2 ? 'It begins to glitch.' : 'It is barely holding together.')
      },
      onBossKilled: () => {
        this.bossKilled = true
        this.win()
      },
      onBossSpawnMinions: () => {
        const p = this.player.pos
        for (let i = 0; i < 2; i++) {
          const ang = (Math.random() * Math.PI * 2)
          const dx = Math.round(p.x + Math.cos(ang) * 5)
          const dz = Math.round(p.z + Math.sin(ang) * 5)
          if (this.world.tileAt(dx, dz) !== 0) {
            this.spawnEnemy('shade', dx, dz)
          }
        }
      },
      onTrainWhistle: () => {
        if (this.currentEnv.id === 'metro') this.spawnTrain()
      },
      onDropLoot: (x, z, item, count) => this.spawnLoot(x, z, item, count),
      isFreeForPaper: (x, y) => this.isFreeForPaper(x, y),
    }
  }

  applyFloorLook() {
    const env = this.currentEnv
    const d = this.diff
    const [fogNear, fogFar] = env.fog || [6, 40]
    this.scene.fog = new THREE.Fog(env.palette.fog, fogNear, fogFar)
    this.renderer.setClearColor(env.palette.bg)
    this.scene.ambient.color.set(env.ambient.color)
    this.scene.ambient.intensity = (env.ambient.intensity || 0.2) / (d.darkness || 1)
    this.scene.hemi.intensity = 0.12 / (d.darkness || 1)
  }

  setupAmbient() {
    const env = this.currentEnv
    this.audioEngine.setAmbient(env.ambience || {})
  }

  setObjective(text) {
    this.objectiveText = text || this.defaultObjective()
  }

  defaultObjective() {
    const env = this.currentEnv
    const isLast = this.floorIndex >= FLOOR_COUNT - 1
    if (isLast) return 'Descend. The Architect awaits.'
    return `${env.name} — find the glowing exit door`
  }

  // ---------------- main loop ----------------
  start() {
    if (this._running) return
    this._running = true
    const loop = () => {
      if (!this._running) return
      requestAnimationFrame(loop)
      const now = performance.now()
      const dt = Math.min(0.05, (now - this._last) / 1000)
      this._last = now
      this.update(dt)
    }
    loop()
  }

  stop() {
    this._running = false
  }

  update(dt) {
    this._t += dt
    this.updateListener()

    if (this.mode === 'play') {
      this.updatePlay(dt)
    } else if (this.mode === 'paused' || this.mode === 'dead') {
      if (this.player) this.player.update(dt, 'ambient')
      if (this.fx) this.fx.update(dt)
    }

    this.renderer.render(this.scene, this.camera)
    if (this.input) this.input.endFrame()
  }

  updateListener() {
    const p = this.player
    const l = this.listenerObj
    if (p) {
      l.x = p.pos.x
      l.y = p.pos.y + p.eye
      l.z = p.pos.z
      l.yaw = p.yaw
    }
  }

  updatePlay(dt) {
    const input = this.input
    const player = this.player

    if (player.dead) {
      this.handleDeath()
      return
    }

    // look
    const sensMul = this.settings.invertY ? -1 : 1
    const ld = input.lookDelta()
    if (ld.dx || ld.dy) player.look(ld.dx, ld.dy, sensMul)

    // pause / inventory
    if (input.justPressedAction(KEY.PAUSE)) {
      this.togglePause()
      return
    }
    if (input.justPressedAction(KEY.INVENTORY)) {
      this.openInventory()
      return
    }
    if (input.justPressedAction(KEY.CRAFT)) {
      this.openInventory()
      this.ui.showInvTab('craft')
      return
    }

    // attack
    if (input.action(KEY.ATTACK)) {
      this.combat.tryAttack(this)
    }
    // reload
    if (input.justPressedAction(KEY.RELOAD)) {
      this.combat.startReload(this)
    }
    // heal / use item
    if (input.justPressedAction(KEY.HEAL)) {
      this.useHealItem()
    }
    // flashlight
    if (input.justPressedAction(KEY.FLASHLIGHT)) {
      this.flashlight.toggle()
      this.audioEngine.lazyPlay('equip', { gain: 0.2 })
    }
    // weapon slots
    if (input.justPressedAction(KEY.AIM)) {
      // aim held via action(); nothing on just press
    }
    this.handleWeaponKeys()

    // interact
    if (input.justPressedAction(KEY.INTERACT)) {
      this.interact()
    }

    // drop selected equipped? default: drop the equipped item handled via inventory

    // simulate
    player.update(dt, 'play')
    this.combat.update(dt, this)
    this.flashlight.update(dt, this.flashlight.isLow)

    for (const e of this.enemies) {
      if (e.dead && e.deathT > 2) continue
      e.update(dt)
    }
    this.fx.update(dt)
    if (this.events) this.events.update(dt)

    this.updateDoors(dt)
    this.updateLights(dt)
    this.updateTrain(dt)
    this.updatePrompts()

    this.state.playTime += dt
    this.updateHud()
  }

  handleWeaponKeys() {
    const input = this.input
    if (input.justPressedAction(KEY.USE_ITEM) || (this.ui.invTab === 'craft' && false)) {
      // (H is bound to HEAL)
    }
    if (input.justPressedAction(KEY.WEAPON_MELEE)) {
      this.combat.setActive('melee')
    } else if (input.justPressedAction(KEY.WEAPON_GUN)) {
      this.combat.setActive('gun')
    } else if (input.justPressedAction(KEY.WEAPON_THROW)) {
      this.combat.throwMolotov()
    }
    if (input.justPressedAction(KEY.DROP)) {
      this.dropEquipped()
    }
  }

  dropEquipped() {
    const inv = this.state.inventory
    const slot = this.combat.active === 'gun' ? inv.equipped.gun : inv.equipped.melee
    if (slot >= 0 && slot < inv.slots.length) {
      this.dropSlot(slot)
    }
  }

  // ---------------- HUD ----------------
  ammoText() {
    const c = this.combat
    if (c.active === 'gun') {
      const def = c.currentGunDef()
      if (def) return `${c.magFor(def)} / ${this.state.inventory.count(def.weapon.ammo)}`
      return '—'
    }
    const m = c.currentMeleeDef()
    return m && m.name ? `${m.name}` : '—'
  }

  weaponName() {
    const c = this.combat
    if (c.active === 'gun') {
      const def = c.currentGunDef()
      return def ? def.name : 'Fists'
    }
    const m = c.currentMeleeDef()
    return m ? m.name : 'Fists'
  }

  updateHud() {
    const inv = this.state.inventory
    const mag = this.combat.magFor(this.combat.currentGunDef())
    const reserve = this.combat.currentGunDef() ? inv.count(this.combat.currentGunDef().weapon.ammo) : 0
    const ammoText = this.combat.active === 'gun' && this.combat.currentGunDef()
      ? `${mag} / ${reserve}`
      : this.weaponName()
    this.ui.updateHud({
      health: this.player.health,
      stamina: this.player.stamina,
      battery: this.flashlight.battery,
      ammoText,
      weaponName: this.weaponName(),
      floorLabel: this.currentEnv.name,
      objText: this.objectiveText,
      lowBatt: this.flashlight.isLow,
    })
  }

  // ---------------- pause / inventory ----------------
  togglePause() {
    if (this.mode === 'play') {
      this.mode = 'paused'
      this.input.exitLock()
      this.ui.showScreen('pause')
      this.audioEngine.lazyPlay('ui', { gain: 0.2 })
    } else if (this.mode === 'paused') {
      this.mode = 'play'
      this.ui.hideScreen('pause')
      this.input.requestLock()
      this.audioEngine.lazyPlay('ui', { gain: 0.2 })
    }
  }

  openInventory() {
    if (this.mode !== 'play') return
    this.mode = 'paused'
    this.input.exitLock()
    this.ui.showScreen('inventory')
    this.ui.showInvTab('items')
    this.ui.renderInventory()
  }

  closeInventory() {
    this.mode = 'play'
    this.ui.hideScreen('inventory')
    this.input.requestLock()
  }

  useSlot(i) {
    const inv = this.state.inventory
    if (i < 0 || i >= inv.slots.length) return
    const s = inv.slots[i]
    const def = ITEMS[s.id]
    if (!def) return
    if (def.cat === 'melee') {
      inv.equip(s.id, 'melee')
      this.combat.setActive('melee')
      this.audioEngine.lazyPlay('equip', { gain: 0.3 })
    } else if (def.cat === 'gun') {
      inv.equip(s.id, 'gun')
      this.combat.setActive('gun')
      this.audioEngine.lazyPlay('equip', { gain: 0.3 })
    } else {
      this.combat.useItem(s.id)
    }
    this.ui.renderInventory()
    this.ui.renderCraft()
  }

  dropSlot(i) {
    const inv = this.state.inventory
    if (i < 0 || i >= inv.slots.length) return
    const s = inv.slots[i]
    const count = Math.min(s.count, 1)
    inv.remove(s.id, count)
    const p = this.player.pos
    const ang = this.player.yaw
    const dx = p.x + Math.cos(ang) * 1.2
    const dz = p.z - Math.sin(ang) * 1.2
    this.spawnLoot(dx, dz, s.id, count)
    this.audioEngine.lazyPlay('ui', { gain: 0.2 })
    this.ui.renderInventory()
    this.ui.renderCraft()
  }

  useHealItem() {
    const inv = this.state.inventory
    const item = inv.has('medkit') ? 'medkit' : inv.has('bandage') ? 'bandage' : inv.has('food') ? 'food' : null
    if (!item) {
      this.ui.toast('No healing items.', null)
      return
    }
    if (this.player.health >= PLAYER.healthMax - 1) {
      this.ui.toast('Health is already full.', null)
      return
    }
    this.combat.useItem(item)
  }

  // ---------------- interact / prompts ----------------
  findInteractable() {
    const p = this.player.pos
    const world = this.world
    const R = COMBAT.pickupRange // pickup radius
    let best = null
    let bestDist = R

    for (const [, l] of world.lootMeshes) {
      if (l.taken) continue
      const d = Math.hypot(l.x - p.x, l.z - p.z)
      if (d < bestDist) {
        bestDist = d
        best = { kind: 'loot', obj: l, dist: d }
      }
    }
    for (const [, n] of world.noteMeshes) {
      if (n.taken) continue
      const d = Math.hypot(n.x - p.x, n.z - p.z)
      if (d < bestDist) {
        bestDist = d
        best = { kind: 'note', obj: n, dist: d }
      }
    }
    for (const [, c] of world.containers) {
      if (c.open) continue
      const d = Math.hypot(c.x - p.x, c.z - p.z)
      if (d < bestDist) {
        bestDist = d
        best = { kind: 'container', obj: c, dist: d }
      }
    }
    if (world.safePos) {
      const d = Math.hypot(world.safePos.x - p.x, world.safePos.z - p.z)
      if (d < bestDist) {
        bestDist = d
        best = { kind: 'safe', obj: world, dist: d }
      }
    }
    {
      const d = Math.hypot(world.exitPos.x - p.x, world.exitPos.z - p.z)
      if (d < bestDist) {
        bestDist = d
        best = { kind: 'exit', obj: world, dist: d }
      }
    }
    // doors: nearest within 2.2
    for (const [, d] of world.doors) {
      const dd = Math.hypot(d.x - p.x, d.z - p.z)
      if (dd < 2.4) {
        if (!best || dd < bestDist) {
          best = { kind: 'door', obj: d, dist: dd }
          bestDist = dd
        }
      }
    }
    return best
  }

  updatePrompts() {
    const it = this.findInteractable()
    this.promptObj = it
    if (!it) {
      this.ui.hidePrompt()
      return
    }
    switch (it.kind) {
      case 'loot': {
        const def = ITEMS[it.obj.item]
        this.ui.showPrompt(`[E] Take ${def ? def.name : 'Item'}`, it.obj.count > 1 ? `x${it.obj.count}` : '')
        break
      }
      case 'note':
        this.ui.showPrompt('[E] Read note', 'Someone was here.')
        break
      case 'container': {
        const def = CONTAINER_TYPES[it.obj.type]
        this.ui.showPrompt(`[E] Search ${def ? def.name : 'it'}`, '')
        break
      }
      case 'safe':
        this.ui.showPrompt('[E] Checkpoint — rest & save', 'Health and battery restored')
        break
      case 'exit':
        if (this.isLastFloor()) {
          if (this.bossKilled) this.ui.showPrompt('[E] Ascend. It is over.', '')
          else this.ui.showPrompt('[E] The exit is sealed', 'The Architect must die.')
        } else {
          this.ui.showPrompt('[E] Descend to the next floor', 'The stairs only go down.')
        }
        break
      case 'door':
        this.ui.showPrompt('[E] Open / close door', '')
        break
    }
  }

  interact() {
    const it = this.promptObj
    if (!it) return
    this.promptObj = null
    switch (it.kind) {
      case 'loot':
        this.pickupLoot(it.obj)
        break
      case 'note':
        this.readNote(it.obj)
        break
      case 'container':
        this.openContainer(it.obj)
        break
      case 'safe':
        this.useCheckpoint()
        break
      case 'exit':
        this.useExit()
        break
      case 'door':
        it.obj.targetOpen = !it.obj.targetOpen
        this.audioEngine.lazyPlay('door', { gain: 0.4, pos: { x: it.obj.x, y: 1, z: it.obj.z }, listener: this.player.pos })
        break
    }
  }

  pickupLoot(l) {
    if (l.taken) return
    const inv = this.state.inventory
    if (!inv.canAdd(l.item, l.count)) {
      this.ui.toast('Inventory full.', null)
      return
    }
    const def = ITEMS[l.item]
    const dur = def && def.weapon && def.weapon.durability ? def.weapon.durability : undefined
    inv.add(l.item, l.count, dur)
    l.taken = true
    l.mesh.visible = false
    this.world.lootMeshes.delete(l.id)
    this.state.stats.looted = (this.state.stats.looted || 0) + l.count
    const def = ITEMS[l.item]
    this.ui.toast(`+ ${def ? def.name : 'Item'}`, l.count > 1 ? `x${l.count}` : '')
    this.audioEngine.lazyPlay('pickup', { gain: 0.5, pos: { x: l.x, y: 0.3, z: l.z }, listener: this.player.pos })
    if (def && (def.cat === 'gun' || def.cat === 'melee')) {
      inv.equip(l.item, def.cat === 'gun' ? 'gun' : 'melee')
    }
  }

  readNote(n) {
    if (n.taken) return
    const lore = this.currentEnv.lore || []
    const note = lore[n.noteIndex]
    if (!note) return
    n.taken = true
    n.mesh.visible = false
    this.world.noteMeshes.delete(n.id)
    this.state.inventory.addNote(note.id)
    this.state.noteRead = this.state.noteRead || []
    this.state.noteRead.push(note.id)
    this.ui.showNote(note.title, note.text)
    this.audioEngine.lazyPlay('paperRustle', { gain: 0.4 })
  }

  openContainer(c) {
    if (c.open) return
    c.open = true
    c.interact && c.interact()
    this.audioEngine.lazyPlay('equip', { gain: 0.3, pos: { x: c.x, y: 0.5, z: c.z }, listener: this.player.pos })
    // roll loot
    const env = this.currentEnv
    const table = LOOT_TABLES[env.loot] || LOOT_TABLES.generic
    const roll = this.rng.next()
    const scarcity = this.diff.loot
    if (roll > c.def.lootChance * scarcity) {
      this.ui.toast('Empty.', null)
      return
    }
    const tier = this.rng.weighted([
      { w: 55, value: 'common' },
      { w: 32, value: 'uncommon' },
      { w: 13, value: 'rare' },
    ])
    const item = this.pickLoot(table[tier])
    if (!item) {
      this.ui.toast('Empty.', null)
      return
    }
    const count = this.rng.chance(0.3) ? 2 : 1
    const ang = this.rng.next() * Math.PI * 2
    const d = 0.6 + this.rng.next() * 0.5
    this.spawnLoot(c.x + Math.cos(ang) * d, c.z + Math.sin(ang) * d, item, count)
    this.ui.toast(`Found ${ITEMS[item].name}`, count > 1 ? `x${count}` : '')
  }

  useCheckpoint() {
    const inv = this.state.inventory
    this.player.health = PLAYER.healthMax
    this.player.stamina = PLAYER.staminaMax
    this.flashlight.setBattery(FLASHLIGHT.batteryMax)
    this.saveCheckpoint(false)
    this.ui.toast('Checkpoint saved.', 'You feel rested.')
    this.audioEngine.lazyPlay('save', { gain: 0.5 })
  }

  saveCheckpoint(toast) {
    const safe = this.world && this.world.safePos
    const pos = safe ? { x: safe.x, y: 0, z: safe.z } : null
    const rot = pos ? { y: this.player.yaw, x: 0 } : null
    this.state.health = this.player.health
    this.state.stamina = this.player.stamina
    this.state.battery = this.flashlight.battery
    this.state.pos = pos
    this.state.rot = rot
    saveGame(this.state, pos, rot)
    this.hasSave = true
    this.ui.updateContinueButton(true)
    if (toast) this.ui.toast('Game saved.', null)
  }

  useExit() {
    if (this.isLastFloor()) {
      if (!this.bossKilled) {
        this.ui.toast('The exit is sealed by the Architect.', 'It must be destroyed.')
        return
      }
      this.win()
      return
    }
    const next = this.floorIndex + 1
    this.saveCheckpoint(false)
    this.state.floorIndex = next
    this.loadFloor(next, true)
    this.audioEngine.lazyPlay('bell', { gain: 0.4 })
  }

  isLastFloor() {
    return this.floorIndex >= FLOOR_COUNT - 1
  }

  // ---------------- death ----------------
  handleDeath() {
    if (this.mode !== 'play') return
    this.mode = 'dead'
    this.input.exitLock()
    this.ui.showScreen('death')
    this.audioEngine.lazyPlay('enemyDeath', { gain: 0.8 })
    this.ui.damageFlash(1)
  }

  respawn() {
    applyDeath(this.state, () => Math.random())
    this.player.health = this.state.health
    this.player.stamina = this.state.stamina
    this.flashlight.setBattery(this.state.battery)
    this.player.dead = false
    const safe = this.world && this.world.safePos
    if (safe) {
      this.player.pos.set(safe.x, 0, safe.z)
    } else {
      this.player.pos.set(this.floor.spawn.x + 0.5, 0, this.floor.spawn.y + 0.5)
    }
    this.player.vel.set(0, 0, 0)
    this.player.syncCamera()
    for (const e of this.enemies) {
      e.lastKnown = null
      if (e.state !== 'dead') {
        e.state = 'patrol'
        e.stateTime = 0
        e.patrolAround && e.patrolAround()
      }
    }
    this.mode = 'play'
    this.ui.hideScreen('death')
    this.ui.showHud(true)
    this.input.requestLock()
    this.ui.toast('You wake at the checkpoint.', 'Half of what you carried is gone.')
  }

  // ---------------- victory ----------------
  win() {
    this.mode = 'victory'
    this.input.exitLock()
    const st = this.state.stats || {}
    const time = fmtTime(this.state.playTime || 0)
    this.ui.setVictory(`You descended all ${FLOOR_COUNT} floors in ${time}. Kills: ${st.kills || 0}. Loot: ${st.looted || 0}. Shots fired: ${st.shots || 0}.`)
    this.ui.showScreen('victory')
    this.audioEngine.lazyPlay('bell', { gain: 0.5 })
    clearSave()
  }

  // ---------------- world updates ----------------
  updateDoors(dt) {
    for (const [, d] of this.world.doors) d.update && d.update(dt)
  }

  updateLights(dt) {
    const t = this._t
    for (const l of this.world.lights) {
      let target = this.power ? l.base : 0
      if (l.flicker && this.power) {
        const n = Math.sin(t * 40 + l.x * 13 + l.z * 7)
        const f = Math.sin(t * 120 + l.x * 5) > 0.55 ? 0.25 : 1
        target *= (n > 0.6 ? 0.5 : 1) * f
      }
      l.light.intensity += (target - l.light.intensity) * Math.min(1, dt * 8)
    }
    for (const pan of this.world.panels) {
      let dim = this.power ? 1 : 0.06
      if (pan.flicker && this.power) {
        dim = Math.sin(t * 90 + pan.mesh.position.x * 7) > 0.4 ? 0.12 : 1
      }
      pan.mesh.material.color.setHex(dim < 0.3 ? 0x111111 : this.currentEnv.palette.panel)
      pan.mesh.material.opacity = dim
    }
    // clear expired bursts
    if (this.activeBursts.length) {
      this._burstT = (this._burstT || 0) + dt
      if (this._burstT > 2.2) {
        for (const l of this.activeBursts) l.flicker = false
        this.activeBursts = []
        this._burstT = 0
      }
    }
  }

  setPower(on) {
    this.power = on
    if (on) this.ui.setPower(false)
    else this.ui.setPower(true)
  }

  updateTrain(dt) {
    const tr = this.activeTrain
    if (!tr) return
    this.trainTime -= dt
    tr.position.x += tr.velocity * dt
    const p = this.player.pos
    // kill on rail row while train near
    const onRow = Math.abs(p.z - (this.trainRow + 0.5)) < 1.1
    if (onRow && Math.abs(tr.position.x - p.x) < 1.5) {
      this.player.damage(100)
      this.audioEngine.lazyPlay('splash', { gain: 0.6 })
    }
    if (tr.position.x > this.floor.w + 60) {
      this.world.group.remove(tr)
      tr.geometry.dispose()
      tr.material.dispose()
      this.activeTrain = null
    }
  }

  spawnTrain() {
    if (this.currentEnv.id !== 'metro' || this.activeTrain) return
    const rails = this.floor.rails
    if (!rails.length) return
    let bestRow = rails[0].y
    let bestDist = Infinity
    for (const r of rails) {
      const d = Math.abs(r.y - this.player.pos.z)
      if (d < bestDist) {
        bestDist = d
        bestRow = r.y
      }
    }
    const train = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 3.4, 60),
      new THREE.MeshBasicMaterial({ color: 0x0a0a0e })
    )
    train.position.set(-10, 1.7, bestRow + 0.5)
    train.velocity = 14
    this.world.group.add(train)
    this.activeTrain = train
    this.trainRow = bestRow
    this.trainTime = 4.2
    this.audioEngine.lazyPlay('train', { gain: 0.6, pos: { x: 0, y: 0, z: bestRow }, listener: this.player.pos })
    this.audioEngine.lazyPlay('whistle', { gain: 0.7 })
  }

  // ---------------- noise / loot / spawn helpers ----------------
  addPlayerNoise(v) {
    if (this.player) this.player.addNoise(v)
  }

  emitNoise(x, z, strength) {
    for (const e of this.enemies) {
      if (e.dead) continue
      e.hearNoiseAt(x, z, strength)
    }
  }

  spawnLoot(x, z, item, count) {
    if (!this.world) return
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.18, 0.18),
      new THREE.MeshBasicMaterial({ color: 0xfff1c0 })
    )
    mesh.position.set(x, 0.12, z)
    this.world.group.add(mesh)
    const id = `${item}_${this._t.toFixed(2)}_${Math.random().toString(36).slice(2, 6)}`
    this.world.lootMeshes.set(id, { id, x, z, mesh, item, count, taken: false, t: 0 })
  }

  spawnEnemy(type, x, z) {
    const e = new Enemy(type, this.floor, this.world, x, z, this.ctx)
    this.enemies.push(e)
    return e
  }

  isFreeForPaper(x, y) {
    if (this.world.tileAt(x, y) === 0) return false
    const p = this.player.pos
    if (Math.hypot(x + 0.5 - p.x, y + 0.5 - p.z) < 2.5) return false
    const sx = this.floor.safeSpawn
    if (Math.abs(x - sx.x) <= 1 && Math.abs(y - sx.y) <= 1) return false
    const ex = this.floor.exit
    if (Math.abs(x - ex.x) <= 1 && Math.abs(y - ex.y) <= 1) return false
    return true
  }

  pickLoot(table) {
    if (!table) return null
    const entries = Object.entries(table)
    if (!entries.length) return null
    let total = 0
    for (const [, w] of entries) total += w
    let r = this.rng.next() * total
    for (const [k, w] of entries) {
      r -= w
      if (r <= 0) return k
    }
    return entries[entries.length - 1][0]
  }

  destroy() {
    this.stop()
    window.removeEventListener('resize', this._onResize)
    this.input.destroy()
    this.teardownFloor()
    this.audioEngine.stopAmbient()
    if (this.renderer) this.renderer.dispose()
  }
}
