// @ts-nocheck
// Mobile touch controls: virtual joysticks + context buttons.
// Writes into Input.touchOverride so the rest of the game is untouched.

import { KEY } from './utils.js'

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

export class Mobile {
  constructor(container, input, ui) {
    this.container = container
    this.input = input
    this.ui = ui
    this.visible = false
    this.active = false

    this.wrap = el('div', 'tl-mobile')
    this.wrap.style.display = 'none'
    container.appendChild(this.wrap)

    // left joystick
    this.moveKnob = this.mkJoystick('tl-stick tl-stick-move', (x, y) => {
      input.touchOverride.axisX = x
      input.touchOverride.axisY = y
    })
    // right joystick (look)
    this.lookKnob = this.mkJoystick('tl-stick tl-stick-look', (x, y) => {
      input.touchOverride.lookX = x
      input.touchOverride.lookY = y
    })

    // buttons
    this.btnAttack = this.mkButton('tl-tbtn tl-tbtn-attack', '⚔')
    this.btnAim = this.mkButton('tl-tbtn tl-tbtn-aim', '◎')
    this.btnInteract = this.mkButton('tl-tbtn tl-tbtn-interact', 'E')
    this.btnFlash = this.mkButton('tl-tbtn tl-tbtn-flash', '🔦')
    this.btnInv = this.mkButton('tl-tbtn tl-tbtn-inv', '🎒')
    this.btnCrouch = this.mkButton('tl-tbtn tl-tbtn-crouch', '▼')
    this.btnSwap = this.mkButton('tl-tbtn tl-tbtn-swap', '⇌')
    this.btnPause = this.mkButton('tl-tbtn tl-tbtn-pause', '❚❚')

    // bind buttons to input override + ui callbacks
    this.btnAttack.onPress = () => {
      input.touchOverride.buttons[KEY.ATTACK] = true
      input.touchOverride.justButtons[KEY.ATTACK] = true
    }
    this.btnAttack.onRelease = () => {
      input.touchOverride.buttons[KEY.ATTACK] = false
    }
    this.btnAim.onPress = () => {
      input.touchOverride.buttons[KEY.AIM] = true
      input.touchOverride.justButtons[KEY.AIM] = true
    }
    this.btnAim.onRelease = () => {
      input.touchOverride.buttons[KEY.AIM] = false
    }
    this.btnInteract.onPress = () => {
      input.touchOverride.justButtons[KEY.INTERACT] = true
    }
    this.btnFlash.onPress = () => {
      input.touchOverride.justButtons[KEY.FLASHLIGHT] = true
    }
    this.btnInv.onPress = () => {
      input.touchOverride.justButtons[KEY.INVENTORY] = true
      if (ui && ui.callbacks['inv:open']) ui.callbacks['inv:open']()
    }
    this.btnCrouch.onPress = () => {
      input.touchOverride.crouchOverride = !input.touchOverride.crouchOverride
    }
    this.btnRun = this.mkButton('tl-tbtn tl-tbtn-run', '»')
    this.btnRun.onPress = () => {
      input.touchOverride.runOverride = true
    }
    this.btnRun.onRelease = () => {
      input.touchOverride.runOverride = false
    }
    this.btnSwap.onPress = () => {
      input.touchOverride.justButtons[KEY.SWAP] = true
    }
    this.btnPause.onPress = () => {
      input.touchOverride.justButtons[KEY.PAUSE] = true
    }
  }

  mkJoystick(cls, onChange) {
    const wrap = el('div', cls)
    const base = el('div', 'tl-stick-base')
    const knob = el('div', 'tl-stick-knob')
    base.appendChild(knob)
    wrap.appendChild(base)
    this.wrap.appendChild(wrap)
    let id = null
    const origin = { x: 0, y: 0 }
    let maxR = 0

    const down = (e) => {
      if (id != null) return
      id = e.identifier
      const rect = wrap.getBoundingClientRect()
      origin.x = rect.left + rect.width / 2
      origin.y = rect.top + rect.height / 2
      maxR = rect.width * 0.32
      knob.style.transform = 'translate(0px,0px)'
      onChange(0, 0)
      e.preventDefault()
    }
    const move = (e) => {
      if (e.identifier !== id) return
      let dx = (e.clientX - origin.x) / maxR
      let dy = (e.clientY - origin.y) / maxR
      const len = Math.hypot(dx, dy)
      if (len > 1) {
        dx /= len
        dy /= len
      }
      knob.style.transform = `translate(${dx * maxR}px,${dy * maxR}px)`
      onChange(dx, dy)
      e.preventDefault()
    }
    const up = (e) => {
      if (e.identifier !== id) return
      id = null
      knob.style.transform = 'translate(0px,0px)'
      onChange(0, 0)
      e.preventDefault()
    }
    wrap.addEventListener('touchstart', down, { passive: false })
    wrap.addEventListener('touchmove', move, { passive: false })
    wrap.addEventListener('touchend', up, { passive: false })
    wrap.addEventListener('touchcancel', up, { passive: false })
    return wrap
  }

  mkButton(cls, label) {
    const b = el('div', cls, label)
    this.wrap.appendChild(b)
    const handlers = {}
    const set = (state) => {
      if (state && handlers.onPress) handlers.onPress()
      if (!state && handlers.onRelease) handlers.onRelease()
    }
    b.addEventListener('touchstart', (e) => {
      e.preventDefault()
      set(true)
    }, { passive: false })
    b.addEventListener('touchend', (e) => {
      e.preventDefault()
      set(false)
    }, { passive: false })
    b.addEventListener('touchcancel', (e) => {
      e.preventDefault()
      set(false)
    }, { passive: false })
    b.addEventListener('mousedown', (e) => {
      e.preventDefault()
      set(true)
    })
    b.addEventListener('mouseup', (e) => {
      e.preventDefault()
      set(false)
    })
    return { el: b, onPress: null, onRelease: null, set }
  }

  enable() {
    if (this.visible) return
    this.visible = true
    this.active = true
    this.wrap.style.display = 'flex'
    this.input.touchOverride = {
      axisX: 0,
      axisY: 0,
      lookX: 0,
      lookY: 0,
      buttons: {},
      justButtons: {},
      crouchOverride: false,
      runOverride: false,
    }
  }

  disable() {
    this.visible = false
    this.active = false
    this.wrap.style.display = 'none'
    if (this.input.touchOverride) {
      this.input.touchOverride.axisX = 0
      this.input.touchOverride.axisY = 0
      this.input.touchOverride.lookX = 0
      this.input.touchOverride.lookY = 0
      this.input.touchOverride.buttons = {}
      this.input.touchOverride.justButtons = {}
    }
  }

  flush() {
    if (this.input.touchOverride) {
      this.input.touchOverride.justButtons = {}
    }
  }
}
