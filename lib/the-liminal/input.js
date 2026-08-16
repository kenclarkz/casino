// @ts-nocheck
// Desktop input: keyboard + mouse with pointer lock. Also provides a touch
// override API that mobile.js feeds. No three.js dependency.

import { KEY } from './utils.js'

export const BINDINGS = {
  [KEY.UP]: ['KeyW', 'ArrowUp'],
  [KEY.DOWN]: ['KeyS', 'ArrowDown'],
  [KEY.LEFT]: ['KeyA', 'ArrowLeft'],
  [KEY.RIGHT]: ['KeyD', 'ArrowRight'],
  [KEY.INTERACT]: ['KeyE'],
  [KEY.RUN]: ['ShiftLeft', 'ShiftRight'],
  [KEY.CROUCH]: ['ControlLeft', 'KeyC'],
  [KEY.JUMP]: ['Space'],
  [KEY.ATTACK]: [],
  [KEY.AIM]: [],
  [KEY.RELOAD]: ['KeyR'],
  [KEY.FLASHLIGHT]: ['KeyF'],
  [KEY.INVENTORY]: ['Tab', 'KeyI'],
  [KEY.USE_ITEM]: ['KeyH'],
  [KEY.PAUSE]: ['Escape'],
  [KEY.CRAFT]: ['KeyQ'],
  [KEY.HEAL]: ['KeyH'],
  [KEY.DROP]: ['KeyG'],
  [KEY.WEAPON_MELEE]: ['Digit1'],
  [KEY.WEAPON_GUN]: ['Digit2'],
  [KEY.WEAPON_THROW]: ['Digit3'],
}

export class Input {
  constructor(domElement) {
    this.dom = domElement
    this.keys = new Map() // code -> { down, justPressed }
    this.mouse = { dx: 0, dy: 0, down: { left: false, right: false } }
    this.locked = false
    this.touchOverride = null // { axisX, axisY, lookX, lookY, buttons:{} } from mobile.js
    this.domElement = domElement
    this.enabled = true
    this._listeners = {}

    this._onKeyDown = (e) => {
      if (!this.enabled) return
      if (e.code === 'Space') e.preventDefault()
      if (!this.keys.has(e.code)) {
        this.keys.set(e.code, { down: true, justPressed: true })
      } else {
        this.keys.get(e.code).down = true
      }
      this.emit('keydown', e.code)
    }
    this._onKeyUp = (e) => {
      if (!this.enabled) return
      const k = this.keys.get(e.code)
      if (k) k.down = false
      this.emit('keyup', e.code)
    }
    this._onMouseMove = (e) => {
      if (!this.enabled || !this.locked) return
      this.mouse.dx += e.movementX || 0
      this.mouse.dy += e.movementY || 0
    }
    this._onMouseDown = (e) => {
      if (!this.enabled) return
      if (e.button === 0) this.mouse.down.left = true
      if (e.button === 2) this.mouse.down.right = true
      this.emit('mousedown', e.button)
    }
    this._onMouseUp = (e) => {
      if (!this.enabled) return
      if (e.button === 0) this.mouse.down.left = false
      if (e.button === 2) this.mouse.down.right = false
      this.emit('mouseup', e.button)
    }
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.dom
      this.emit('lockchange', this.locked)
    }
    this._onCtx = (e) => e.preventDefault()
    this._onBlur = () => {
      this.keys.clear()
      this.mouse.down.left = false
      this.mouse.down.right = false
    }

    document.addEventListener('keydown', this._onKeyDown)
    document.addEventListener('keyup', this._onKeyUp)
    document.addEventListener('mousemove', this._onMouseMove)
    document.addEventListener('mousedown', this._onMouseDown)
    document.addEventListener('mouseup', this._onMouseUp)
    this.dom.addEventListener('contextmenu', this._onCtx)
    window.addEventListener('blur', this._onBlur)
    document.addEventListener('pointerlockchange', this._onLockChange)
  }

  on(evt, fn) {
    ;(this._listeners[evt] = this._listeners[evt] || []).push(fn)
  }
  emit(evt, data) {
    const fns = this._listeners[evt]
    if (!fns) return
    for (const fn of fns) fn(data)
  }

  requestLock() {
    if (!this.dom.requestPointerLock) return false
    try {
      const p = this.dom.requestPointerLock()
      if (p && typeof p.catch === 'function') p.catch(() => {})
      return true
    } catch {
      return false
    }
  }
  exitLock() {
    if (document.exitPointerLock) {
      try {
        document.exitPointerLock()
      } catch {
        /* ignore */
      }
    }
  }

  pressed(code) {
    const k = this.keys.get(code)
    return !!k && k.down
  }

  justPressed(code) {
    const k = this.keys.get(code)
    if (k && k.justPressed) {
      k.justPressed = false
      return true
    }
    return false
  }

  action(key) {
    // touch override wins when active
    const t = this.touchOverride
    if (t && t.buttons && typeof t.buttons[key] === 'boolean') return t.buttons[key]
    if (t && t.axisOverride && key >= KEY.UP && key <= KEY.RIGHT) {
      // axis override handled via axis()
    }
    const codes = BINDINGS[key] || []
    for (const c of codes) if (this.pressed(c)) return true
    if (key === KEY.ATTACK) return this.mouse.down.left
    if (key === KEY.AIM) return this.mouse.down.right
    return false
  }

  justPressedAction(key) {
    const t = this.touchOverride
    if (t && t.justButtons && typeof t.justButtons[key] === 'boolean') {
      const v = t.justButtons[key]
      t.justButtons[key] = false
      return v
    }
    const codes = BINDINGS[key] || []
    for (const c of codes) if (this.justPressed(c)) return true
    return false
  }

  /** Movement axis (-1..1). */
  axis() {
    const t = this.touchOverride
    if (t && typeof t.axisX === 'number') {
      return { x: t.axisX, y: t.axisY }
    }
    let x = 0
    let y = 0
    if (this.action(KEY.UP)) y += 1
    if (this.action(KEY.DOWN)) y -= 1
    if (this.action(KEY.LEFT)) x -= 1
    if (this.action(KEY.RIGHT)) x += 1
    const len = Math.hypot(x, y)
    if (len > 1) {
      x /= len
      y /= len
    }
    return { x, y }
  }

  /** Consume mouse delta since last call. */
  lookDelta() {
    const t = this.touchOverride
    if (t && typeof t.lookX === 'number') {
      const dx = t.lookX
      const dy = t.lookY
      t.lookX = 0
      t.lookY = 0
      return { dx, dy }
    }
    const dx = this.mouse.dx
    const dy = this.mouse.dy
    this.mouse.dx = 0
    this.mouse.dy = 0
    return { dx, dy }
  }

  endFrame() {
    // clear just-pressed flags
    for (const [, k] of this.keys) k.justPressed = false
    const t = this.touchOverride
    if (t && t.justButtons) {
      for (const k of Object.keys(t.justButtons)) t.justButtons[k] = false
    }
  }

  destroy() {
    document.removeEventListener('keydown', this._onKeyDown)
    document.removeEventListener('keyup', this._onKeyUp)
    document.removeEventListener('mousemove', this._onMouseMove)
    document.removeEventListener('mousedown', this._onMouseDown)
    document.removeEventListener('mouseup', this._onMouseUp)
    this.dom.removeEventListener('contextmenu', this._onCtx)
    window.removeEventListener('blur', this._onBlur)
    document.removeEventListener('pointerlockchange', this._onLockChange)
  }
}
