// @ts-nocheck
// Flashlight: battery, toggle, flicker, spotlight attached to the camera.

import * as THREE from 'three'
import { FLASHLIGHT } from './config.js'
import { makeNoise1 } from './utils.js'

export class Flashlight {
  constructor(camera, scene) {
    this.camera = camera
    this.on = false
    this.battery = FLASHLIGHT.batteryMax
    this.flickerNoise = makeNoise1(13)
    this.flickerTimer = 0

    this.spot = new THREE.SpotLight(FLASHLIGHT.color, 0, FLASHLIGHT.range, FLASHLIGHT.outerAngle, 0.4, 1.4)
    this.spot.position.set(0.25, -0.12, 0.1)
    this.spot.target.position.set(0, -0.2, -10)
    this.spot.castShadow = true
    camera.add(this.spot)
    camera.add(this.spot.target)
    scene.add(camera)

    this.spot.shadow.mapSize.width = 1024
    this.spot.shadow.mapSize.height = 1024
    this.spot.shadow.bias = -0.004
  }

  setShadows(enabled) {
    this.spot.castShadow = enabled
    this.spot.shadow.mapSize.width = enabled ? 1024 : 0
    this.spot.shadow.mapSize.height = enabled ? 1024 : 0
  }

  setBattery(v) {
    this.battery = Math.max(0, Math.min(FLASHLIGHT.batteryMax, v))
  }

  addBattery(v) {
    this.setBattery(this.battery + v)
  }

  get isLow() {
    return this.on && this.battery < FLASHLIGHT.flickerBelow
  }

  update(dt, lowBattery = false) {
    this.flickerTimer += dt
    let target = 0
    if (this.on && this.battery > 0.001) {
      this.battery = Math.max(0, this.battery - FLASHLIGHT.drainPerSec * dt)
      target = FLASHLIGHT.intensity
      // low battery flicker
      if (this.battery < FLASHLIGHT.flickerBelow) {
        const n = this.flickerNoise.at(this.flickerTimer * 22)
        if (n < 0.55) target *= 0.15 + n * 0.6
      }
      if (this.battery <= 0.001) {
        this.on = false
        target = 0
      }
    }
    this.spot.intensity += (target - this.spot.intensity) * Math.min(1, dt * 12)
  }

  toggle() {
    if (this.battery <= 0.001 && !this.on) return false
    this.on = !this.on
    return this.on
  }

  get intensity() {
    return this.spot.intensity / FLASHLIGHT.intensity
  }
}
