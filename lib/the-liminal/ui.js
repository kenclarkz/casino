// @ts-nocheck
// DOM-based UI: HUD, prompts, toasts, inventory + crafting, notes, menus,
// settings, death/victory screens, vignettes. Styling lives in the-liminal.css.

import { ITEMS, CRAFTING, canCraft } from './items.js'
import { WEAPON_SLOT_MELEE, WEAPON_SLOT_GUN } from './items.js'
import { fmtTime, clamp } from './utils.js'

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

export class UI {
  constructor(container) {
    this.root = el('div', 'tl-ui')
    container.appendChild(this.root)
    this.screens = {}
    this.promptTimer = 0
    this._hudCache = {}
    this.callbacks = {}
    this.build()
  }

  on(event, fn) {
    this.callbacks[event] = fn
  }

  build() {
    const root = this.root

    // ---------- HUD ----------
    const hud = el('div', 'tl-hud')
    root.appendChild(hud)

    const cross = el('div', 'tl-crosshair')
    cross.innerHTML = '<span class="tl-cross-dot"></span><span class="tl-cross-v"></span><span class="tl-cross-h"></span>'
    hud.appendChild(cross)

    const top = el('div', 'tl-hud-top')
    this.objText = el('div', 'tl-obj')
    this.floorText = el('div', 'tl-floor')
    top.appendChild(this.objText)
    top.appendChild(this.floorText)
    hud.appendChild(top)

    const bottom = el('div', 'tl-hud-bottom')
    const left = el('div', 'tl-vitals')
    this.healthBar = this.mkBar('health', 'HEALTH')
    this.staminaBar = this.mkBar('stamina', 'STAMINA')
    this.batteryBar = this.mkBar('battery', 'LIGHT')
    left.appendChild(this.healthBar.wrap)
    left.appendChild(this.staminaBar.wrap)
    left.appendChild(this.batteryBar.wrap)
    bottom.appendChild(left)

    const center = el('div', 'tl-hud-center')
    this.prompt = el('div', 'tl-prompt')
    this.prompt.hidden = true
    this.toastBox = el('div', 'tl-toasts')
    center.appendChild(this.prompt)
    center.appendChild(this.toastBox)
    bottom.appendChild(center)

    const right = el('div', 'tl-ammo-wrap')
    this.weaponName = el('div', 'tl-weapon')
    this.ammoText = el('div', 'tl-ammo')
    right.appendChild(this.weaponName)
    right.appendChild(this.ammoText)
    bottom.appendChild(right)

    hud.appendChild(bottom)

    // vignettes
    this.dmgVignette = el('div', 'tl-vignette tl-vignette-dmg')
    root.appendChild(this.dmgVignette)
    this.lowHpVignette = el('div', 'tl-vignette tl-vignette-lowhp')
    root.appendChild(this.lowHpVignette)
    this.flashVignette = el('div', 'tl-vignette tl-vignette-flash')
    root.appendChild(this.flashVignette)
    this.fogOverlay = el('div', 'tl-vignette tl-vignette-fog')
    root.appendChild(this.fogOverlay)
    this.powerOverlay = el('div', 'tl-power')
    root.appendChild(this.powerOverlay)
    this.lowBatteryOverlay = el('div', 'tl-vignette tl-vignette-batt')
    root.appendChild(this.lowBatteryOverlay)

    // ---------- main menu ----------
    const mm = el('div', 'tl-screen tl-menu')
    mm.innerHTML = `
      <div class="tl-menu-title">THE <span>LIMINAL</span></div>
      <div class="tl-menu-sub">Ten floors. No exits. Only descent.</div>
      <div class="tl-menu-buttons">
        <button data-act="new">NEW DESCENT</button>
        <button data-act="continue" class="tl-btn-continue">CONTINUE</button>
        <button data-act="settings">SETTINGS</button>
        <button data-act="controls">CONTROLS</button>
        <button data-act="credits">CREDITS</button>
      </div>
      <div class="tl-menu-foot">v0.1.0 — a survival horror experiment</div>
    `
    root.appendChild(mm)
    this.screens.mainMenu = mm
    mm.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.act
        this.callbacks['menu:' + act] && this.callbacks['menu:' + act]()
      })
    })

    // ---------- pause ----------
    const pause = el('div', 'tl-screen tl-menu tl-pause')
    pause.innerHTML = `
      <div class="tl-menu-title tl-pause-title">PAUSED</div>
      <div class="tl-menu-buttons">
        <button data-act="resume">RESUME</button>
        <button data-act="save">SAVE AT CHECKPOINT</button>
        <button data-act="settings2">SETTINGS</button>
        <button data-act="quit">QUIT TO MENU</button>
      </div>
    `
    root.appendChild(pause)
    this.screens.pause = pause
    pause.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.act
        this.callbacks['menu:' + act] && this.callbacks['menu:' + act]()
      })
    })

    // ---------- settings ----------
    const st = el('div', 'tl-screen tl-menu tl-settings')
    st.innerHTML = `
      <div class="tl-menu-title tl-pause-title">SETTINGS</div>
      <div class="tl-settings-body"></div>
      <div class="tl-menu-buttons"><button data-act="back-settings">BACK</button></div>
    `
    root.appendChild(st)
    this.screens.settings = st
    this.settingsBody = st.querySelector('.tl-settings-body')
    this.settingsBack = () => this.showScreen('mainMenu')

    // ---------- controls ----------
    const ctrl = el('div', 'tl-screen tl-menu tl-settings')
    ctrl.innerHTML = `
      <div class="tl-menu-title tl-pause-title">CONTROLS</div>
      <div class="tl-settings-body tl-controls">
        <p><b>WASD</b> move &nbsp; <b>MOUSE</b> look &nbsp; <b>LMB</b> attack &nbsp; <b>RMB</b> aim</p>
        <p><b>SHIFT</b> run &nbsp; <b>CTRL</b> crouch (stealth) &nbsp; <b>SPACE</b> jump</p>
        <p><b>E</b> interact &nbsp; <b>F</b> flashlight &nbsp; <b>R</b> reload &nbsp; <b>H</b> heal</p>
        <p><b>TAB</b> inventory / craft &nbsp; <b>Q</b> craft screen &nbsp; <b>G</b> drop &nbsp; <b>1</b> melee <b>2</b> gun <b>3</b> throwable</p>
        <p><b>ESC</b> pause</p>
        <p class="tl-ctrl-note">TIP: LIGHTS ATTRACT THEM. BULLETS ARE LOUD. CROUCHING IS SILENCE.</p>
      </div>
      <div class="tl-menu-buttons"><button data-act="back-controls">BACK</button></div>
    `
    root.appendChild(ctrl)
    this.screens.controls = ctrl

    // ---------- inventory ----------
    const inv = el('div', 'tl-screen tl-inv')
    inv.innerHTML = `
      <div class="tl-inv-head">
        <div class="tl-inv-title">INVENTORY</div>
        <div class="tl-inv-tabs">
          <button data-tab="items">ITEMS</button>
          <button data-tab="craft">CRAFT</button>
          <button data-tab="notes">NOTES</button>
        </div>
      </div>
      <div class="tl-inv-body">
        <div class="tl-inv-grid" data-panel="items"></div>
        <div class="tl-craft" data-panel="craft"></div>
        <div class="tl-notes" data-panel="notes"></div>
      </div>
      <div class="tl-inv-foot">
        <div class="tl-inv-detail"></div>
        <div class="tl-inv-actions">
          <button data-act="close">CLOSE [TAB]</button>
          <button data-act="use">USE / EQUIP</button>
          <button data-act="drop">DROP</button>
        </div>
      </div>
    `
    root.appendChild(inv)
    this.screens.inventory = inv
    this.invGrid = inv.querySelector('[data-panel="items"]')
    this.craftPanel = inv.querySelector('[data-panel="craft"]')
    this.notesPanel = inv.querySelector('[data-panel="notes"]')
    this.invDetail = inv.querySelector('.tl-inv-detail')
    this.selectedSlot = -1
    inv.querySelectorAll('[data-tab]').forEach((b) => {
      b.addEventListener('click', () => this.showInvTab(b.dataset.tab))
    })
    inv.querySelector('[data-act="close"]').addEventListener('click', () => this.callbacks['inv:close'] && this.callbacks['inv:close']())
    inv.querySelector('[data-act="use"]').addEventListener('click', () => this.callbacks['inv:use'] && this.callbacks['inv:use'](this.selectedSlot))
    inv.querySelector('[data-act="drop"]').addEventListener('click', () => this.callbacks['inv:drop'] && this.callbacks['inv:drop'](this.selectedSlot))

    // ---------- death ----------
    const death = el('div', 'tl-screen tl-menu tl-death')
    death.innerHTML = `
      <div class="tl-death-title">THE LIMINAL TAKES ANOTHER</div>
      <div class="tl-death-sub">You lost part of what you carried.</div>
      <div class="tl-menu-buttons">
        <button data-act="retry">RESPAWN AT CHECKPOINT</button>
        <button data-act="quit">QUIT TO MENU</button>
      </div>
    `
    root.appendChild(death)
    this.screens.death = death
    death.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.act
        this.callbacks['menu:' + act] && this.callbacks['menu:' + act]()
      })
    })

    // ---------- victory ----------
    const vict = el('div', 'tl-screen tl-menu tl-victory')
    vict.innerHTML = `
      <div class="tl-victory-title">YOU DESCENDED. ALL OF IT.</div>
      <div class="tl-victory-sub" data-vs></div>
      <div class="tl-menu-buttons">
        <button data-act="victory-continue">DWELL HERE</button>
      </div>
    `
    root.appendChild(vict)
    this.screens.victory = vict
    this.victorySub = vict.querySelector('[data-vs]')
    vict.querySelector('button').addEventListener('click', () => this.callbacks['menu:victory-continue'] && this.callbacks['menu:victory-continue']())

    // ---------- transition / floor intro ----------
    const trans = el('div', 'tl-screen tl-transition')
    trans.innerHTML = `<div class="tl-trans-title"></div><div class="tl-trans-sub"></div>`
    root.appendChild(trans)
    this.screens.transition = trans
    this.transTitle = trans.querySelector('.tl-trans-title')
    this.transSub = trans.querySelector('.tl-trans-sub')

    // ---------- note modal ----------
    const noteModal = el('div', 'tl-screen tl-note-modal')
    noteModal.innerHTML = `
      <div class="tl-note-card">
        <div class="tl-note-title"></div>
        <div class="tl-note-text"></div>
        <button>CLOSE</button>
      </div>
    `
    root.appendChild(noteModal)
    this.screens.noteModal = noteModal
    this.noteTitle = noteModal.querySelector('.tl-note-title')
    this.noteText = noteModal.querySelector('.tl-note-text')
    noteModal.querySelector('button').addEventListener('click', () => this.hideScreen('noteModal'))
    noteModal.addEventListener('click', (e) => {
      if (e.target === noteModal) this.hideScreen('noteModal')
    })

    this.showScreen('mainMenu')
  }

  mkBar(cls, label) {
    const wrap = el('div', `tl-bar tl-bar-${cls}`)
    const lbl = el('div', 'tl-bar-label', label)
    const track = el('div', 'tl-bar-track')
    const fill = el('div', 'tl-bar-fill')
    track.appendChild(fill)
    wrap.appendChild(lbl)
    wrap.appendChild(track)
    return { wrap, fill }
  }

  // ---------------- screens ----------------
  showScreen(name) {
    for (const s of Object.values(this.screens)) {
      if (s && s.classList.contains('tl-screen')) s.classList.remove('tl-active')
    }
    const s = this.screens[name]
    if (s) s.classList.add('tl-active')
  }
  hideScreen(name) {
    const s = this.screens[name]
    if (s) s.classList.remove('tl-active')
  }

  showHud(v) {
    this.root.querySelector('.tl-hud').style.display = v ? '' : 'none'
  }

  // ---------------- HUD update ----------------
  updateHud(s) {
    if (Math.abs(s.health - (this._hudCache.health ?? -1)) > 0.5) {
      this._hudCache.health = s.health
      this.healthBar.fill.style.width = clamp(s.health, 0, 100) + '%'
    }
    if (Math.abs(s.stamina - (this._hudCache.stamina ?? -1)) > 0.5) {
      this._hudCache.stamina = s.stamina
      this.staminaBar.fill.style.width = clamp(s.stamina, 0, 100) + '%'
    }
    if (Math.abs(s.battery - (this._hudCache.battery ?? -1)) > 0.5) {
      this._hudCache.battery = s.battery
      this.batteryBar.fill.style.width = clamp(s.battery, 0, 100) + '%'
      this.batteryBar.fill.classList.toggle('tl-low', s.battery < 25)
    }
    if (s.ammoText !== this._hudCache.ammoText) {
      this._hudCache.ammoText = s.ammoText
      this.ammoText.textContent = s.ammoText
    }
    if (s.weaponName !== this._hudCache.weaponName) {
      this._hudCache.weaponName = s.weaponName
      this.weaponName.textContent = s.weaponName
    }
    if (s.floorLabel !== this._hudCache.floorLabel) {
      this._hudCache.floorLabel = s.floorLabel
      this.floorText.textContent = s.floorLabel
    }
    if (s.objText !== this._hudCache.objText) {
      this._hudCache.objText = s.objText
      this.objText.textContent = s.objText
    }
    // low health vignette
    const lowHp = s.health < 35
    if (lowHp !== this._hudCache.lowHp) {
      this._hudCache.lowHp = lowHp
      this.lowHpVignette.style.opacity = lowHp ? '1' : '0'
    }
    if (lowHp) {
      const pulse = 0.35 + Math.sin(performance.now() / 400) * 0.2
      this.lowHpVignette.style.opacity = String(pulse)
    }
    // battery vignette
    if (s.lowBatt !== this._hudCache.lowBatt) {
      this._hudCache.lowBatt = s.lowBatt
      this.lowBatteryOverlay.style.opacity = s.lowBatt ? '1' : '0'
    }
  }

  // ---------------- prompts / toasts ----------------
  showPrompt(text, sub) {
    this.prompt.hidden = false
    this.prompt.innerHTML = `<b>${text}</b>${sub ? `<span>${sub}</span>` : ''}`
    this.prompt.classList.add('tl-prompt-on')
  }
  hidePrompt() {
    this.prompt.hidden = true
    this.prompt.classList.remove('tl-prompt-on')
  }

  toast(msg, sub) {
    const t = el('div', 'tl-toast')
    t.innerHTML = `<b>${msg}</b>${sub ? `<span>${sub}</span>` : ''}`
    this.toastBox.appendChild(t)
    while (this.toastBox.children.length > 3) this.toastBox.removeChild(this.toastBox.firstChild)
    setTimeout(() => {
      t.classList.add('tl-toast-out')
      setTimeout(() => t.remove(), 600)
    }, 4000)
  }

  // ---------------- inventory ----------------
  showInvTab(tab) {
    this.invTab = tab
    this.screens.inventory.querySelectorAll('[data-tab]').forEach((b) => {
      b.classList.toggle('tl-tab-active', b.dataset.tab === tab)
    })
    for (const p of this.screens.inventory.querySelectorAll('[data-panel]')) {
      p.classList.toggle('tl-panel-active', p.dataset.panel === tab)
    }
    if (tab === 'items') this.renderInventory()
    if (tab === 'craft') this.renderCraft()
    if (tab === 'notes') this.renderNotes()
  }

  renderInventory() {
    const inv = this.callbacks['inv:get']()
    if (!inv) return
    this.invGrid.innerHTML = ''
    for (let i = 0; i < inv.capacity; i++) {
      const cell = el('div', 'tl-slot')
      if (i < inv.slots.length) {
        const s = inv.slots[i]
        const def = ITEMS[s.id]
        const equipped = inv.equipped.melee === i || inv.equipped.gun === i
        cell.classList.add('tl-slot-filled', equipped ? 'tl-slot-equipped' : '')
        cell.innerHTML = `
          <span class="tl-slot-icon tl-ic-${def.cat}">${(def.name[0] || '?')}</span>
          <span class="tl-slot-count">${s.count > 1 ? s.count : ''}</span>
          <span class="tl-slot-name">${def.name}</span>
        `
        cell.title = def.desc
      }
      cell.dataset.i = i
      cell.addEventListener('click', () => this.selectSlot(i))
      this.invGrid.appendChild(cell)
    }
    this.invDetail.textContent = ''
    this.selectSlot(Math.min(this.selectedSlot, inv.slots.length - 1))
  }

  selectSlot(i) {
    this.selectedSlot = i
    this.invGrid.querySelectorAll('.tl-slot').forEach((c) => c.classList.toggle('tl-slot-selected', Number(c.dataset.i) === i))
    const inv = this.callbacks['inv:get']()
    if (!inv || i < 0 || i >= inv.slots.length) {
      this.invDetail.textContent = ''
      return
    }
    const s = inv.slots[i]
    const def = ITEMS[s.id]
    const equipped = inv.equipped.melee === i || inv.equipped.gun === i
    this.invDetail.innerHTML = `<b>${def.name}</b>${equipped ? ' <em>(equipped)</em>' : ''}<br><span>${def.desc}</span>`
  }

  renderCraft() {
    const inv = this.callbacks['inv:get']()
    if (!inv) return
    this.craftPanel.innerHTML = ''
    for (const recipe of CRAFTING) {
      const ok = canCraft(recipe, inv)
      const row = el('div', 'tl-craft-row' + (ok ? '' : ' tl-craft-off'))
      const ins = Object.entries(recipe.inputs)
        .map(([id, n]) => `<span class="tl-craft-ing">${ITEMS[id].name}×${n}${inv.count(id) >= n ? '' : ' <em class="tl-missing">(need)</em>'}</span>`)
        .join(' → ')
      const outs = Object.entries(recipe.outputs)
        .map(([id, n]) => `${ITEMS[id].name}×${n}`)
        .join(', ')
      row.innerHTML = `<div class="tl-craft-name">${recipe.name}</div><div class="tl-craft-io">${ins} → <b>${outs}</b></div>`
      if (ok) {
        const btn = el('button', 'tl-craft-btn', 'CRAFT')
        btn.addEventListener('click', () => {
          if (this.callbacks['inv:craft'](recipe.id)) {
            this.toast(`Crafted: ${recipe.name}`)
            this.renderCraft()
            this.renderInventory()
          }
        })
        row.appendChild(btn)
      }
      this.craftPanel.appendChild(row)
    }
  }

  renderNotes() {
    const notes = this.callbacks['inv:notes']()
    if (!notes) return
    this.notesPanel.innerHTML = ''
    if (!notes.length) {
      this.notesPanel.innerHTML = '<div class="tl-notes-empty">You have found no notes. The walls stay silent.</div>'
      return
    }
    for (const n of notes) {
      const card = el('div', 'tl-note-entry')
      card.innerHTML = `<b>${n.title}</b><span>${n.text}</span>`
      this.notesPanel.appendChild(card)
    }
  }

  // ---------------- notes modal ----------------
  showNote(title, text) {
    this.noteTitle.textContent = title
    this.noteText.textContent = text
    this.showScreen('noteModal')
  }

  // ---------------- effects ----------------
  setPower(on) {
    this.powerOverlay.classList.toggle('tl-power-on', !on)
  }

  setFogOverlay(v) {
    this.fogOverlay.style.opacity = String(clamp(v, 0, 1))
  }

  pulseVignette(v) {
    this.dmgVignette.style.opacity = String(clamp(v, 0, 1))
    setTimeout(() => {
      this.dmgVignette.style.opacity = '0'
    }, 900)
  }

  flash(color, intensity) {
    this.flashVignette.style.background = `radial-gradient(ellipse at center, transparent 30%, ${color} 100%)`
    this.flashVignette.style.opacity = String(clamp(intensity, 0, 1))
  }

  damageFlash(amount) {
    const op = clamp(amount / 100, 0, 0.85)
    this.dmgVignette.style.opacity = String(op)
    if (op > 0.01) {
      clearTimeout(this._dmgTimer)
      this._dmgTimer = setTimeout(() => {
        this.dmgVignette.style.opacity = '0'
      }, 500)
    }
  }

  transition(floorName, subtitle, durMs = 900) {
    this.transTitle.textContent = floorName
    this.transSub.textContent = subtitle
    this.transitionSub = subtitle
    this.showScreen('transition')
    setTimeout(() => {
      this.transitionSub && (this.transSub.textContent = this.transitionSub)
    }, 0)
    setTimeout(() => {
      this.hideScreen('transition')
    }, durMs + 1400)
  }

  // settings screen
  buildSettings(s, onChange) {
    this.settingsBody.innerHTML = ''
    const rows = [
      ['sensitivity', 'Mouse sensitivity', 'range', { min: 0.2, max: 3, step: 0.1 }],
      ['masterVolume', 'Master volume', 'range', { min: 0, max: 1, step: 0.05 }],
      ['sfxVolume', 'Sound effects', 'range', { min: 0, max: 1, step: 0.05 }],
      ['musicVolume', 'Ambience', 'range', { min: 0, max: 1, step: 0.05 }],
      ['brightness', 'Brightness', 'range', { min: 0.5, max: 2, step: 0.1 }],
      ['invertY', 'Invert mouse Y', 'toggle', null],
      ['shadows', 'Shadows', 'toggle', null],
    ]
    for (const [key, label, type, opts] of rows) {
      const row = el('div', 'tl-set-row')
      const lbl = el('label', null, label)
      row.appendChild(lbl)
      if (type === 'range') {
        const input = el('input')
        input.type = 'range'
        input.min = opts.min
        input.max = opts.max
        input.step = opts.step
        input.value = s[key]
        input.addEventListener('input', () => {
          onChange(key, parseFloat(input.value))
        })
        row.appendChild(input)
      } else {
        const input = el('input')
        input.type = 'checkbox'
        input.checked = !!s[key]
        input.addEventListener('change', () => {
          onChange(key, input.checked)
        })
        row.appendChild(input)
      }
      this.settingsBody.appendChild(row)
    }
  }

  updateContinueButton(hasSave) {
    const b = this.screens.mainMenu.querySelector('.tl-btn-continue')
    b.style.display = hasSave ? '' : 'none'
  }

  setVictory(text) {
    this.victorySub.textContent = text
  }
}
