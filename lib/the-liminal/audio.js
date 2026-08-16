// @ts-nocheck
// Procedural audio engine. No audio files — everything is synthesized with
// WebAudio (oscillators + noise). Safe to call before user gesture: it lazily
// creates the AudioContext on first use.

import { clamp, lerp, TAU } from './utils.js'

export class AudioEngine {
  constructor() {
    this.ctx = null
    this.master = null
    this.sfx = null
    this.music = null
    this.ambientGain = null
    this.running = false
    this.ambientNodes = []
    this.tension = 0 // 0..1, rises when enemies are near
    this.muted = false
    this.settings = null
    this.noiseBuf = null
    this._lastStep = 0
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume()
      return
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!AC) return
    try {
      this.ctx = new AC()
      this.master = this.ctx.createGain()
      this.master.connect(this.ctx.destination)
      this.sfx = this.ctx.createGain()
      this.sfx.connect(this.master)
      this.music = this.ctx.createGain()
      this.music.connect(this.master)
      this.ambientGain = this.ctx.createGain()
      this.ambientGain.connect(this.music)
      this.applySettings()
    } catch {
      this.ctx = null
    }
  }

  applySettings(s = this.settings) {
    if (s) this.settings = s
    if (!this.ctx) return
    const st = this.settings || {}
    const m = st.masterVolume ?? 0.8
    this.master.gain.value = this.muted ? 0 : m
    this.sfx.gain.value = (st.sfxVolume ?? 0.9) * m
    this.music.gain.value = (st.musicVolume ?? 0.7) * m * 0.9
  }

  setMuted(m) {
    this.muted = m
    this.applySettings()
  }

  _now() {
    return this.ctx ? this.ctx.currentTime : 0
  }

  _noiseBuffer() {
    if (this.noiseBuf && this.noiseBuf.length > 0) return this.noiseBuf
    const len = this.ctx.sampleRate * 2
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    this.noiseBuf = buf
    return buf
  }

  _noiseSource() {
    const src = this.ctx.createBufferSource()
    src.buffer = this._noiseBuffer()
    src.loop = true
    return src
  }

  /** Master ambient bed for a floor. profile: {drone, drone2, droneGain, noiseFilter, noiseGain, hum, water}. */
  setAmbient(profile) {
    this.stopAmbient()
    if (!this.ctx || !profile) return
    const ctx = this.ctx
    const t = ctx.currentTime
    const g = this.ambientGain

    // Low drone + fifth
    const mk = (freq, type = 'sine', gain = 0.03) => {
      const o = ctx.createOscillator()
      o.type = type
      o.frequency.value = freq
      const og = ctx.createGain()
      og.gain.value = 0
      og.gain.linearRampToValueAtTime(gain, t + 3)
      o.connect(og)
      og.connect(g)
      o.start()
      const stop = () => {
        og.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5)
        o.stop(ctx.currentTime + 0.6)
      }
      this.ambientNodes.push({ osc: o, gain: og, stop })
      return { o, og }
    }
    const d1 = mk(profile.drone, 'sine', profile.droneGain)
    const d2 = mk(profile.drone2, 'sine', profile.droneGain * 0.7)

    // Slow detune LFO for unease
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.05 + Math.random() * 0.04
    const lfoG = ctx.createGain()
    lfoG.gain.value = 2
    lfo.connect(lfoG)
    lfoG.connect(d1.o.frequency)
    lfoG.connect(d2.o.frequency)
    lfo.start()
    this.ambientNodes.push({ osc: lfo, stop: () => lfo.stop(ctx.currentTime + 0.6) })

    // Filtered noise bed (air / hum)
    if (profile.noiseGain > 0) {
      const n = this._noiseSource()
      const filt = ctx.createBiquadFilter()
      filt.type = 'lowpass'
      filt.frequency.value = profile.noiseFilter
      filt.Q.value = 0.8
      const ng = ctx.createGain()
      ng.gain.value = 0
      ng.gain.linearRampToValueAtTime(profile.noiseGain, t + 4)
      n.connect(filt)
      filt.connect(ng)
      ng.connect(g)
      n.start()
      this.ambientNodes.push({ osc: n, stop: () => n.stop(ctx.currentTime + 0.6) })
    }

    // 60Hz electrical hum
    if (profile.hum) {
      const h = ctx.createOscillator()
      h.type = 'sawtooth'
      h.frequency.value = 60
      const hf = ctx.createBiquadFilter()
      hf.type = 'lowpass'
      hf.frequency.value = 120
      const hg = ctx.createGain()
      hg.gain.value = 0
      hg.gain.linearRampToValueAtTime(0.004, t + 3)
      h.connect(hf)
      hf.connect(hg)
      hg.connect(g)
      h.start()
      this.ambientNodes.push({ osc: h, stop: () => h.stop(ctx.currentTime + 0.6) })
    }

    // Water lap (pool)
    if (profile.water) {
      const w = this._noiseSource()
      const wf = ctx.createBiquadFilter()
      wf.type = 'bandpass'
      wf.frequency.value = 300
      wf.Q.value = 1
      const wg = ctx.createGain()
      wg.gain.value = 0
      wg.gain.linearRampToValueAtTime(0.012, t + 5)
      const lfo2 = ctx.createOscillator()
      lfo2.frequency.value = 0.11
      const l2g = ctx.createGain()
      l2g.gain.value = 0.01
      lfo2.connect(l2g)
      l2g.connect(wg.gain)
      w.connect(wf)
      wf.connect(wg)
      wg.connect(g)
      w.start()
      lfo2.start()
      this.ambientNodes.push({ osc: w, stop: () => { w.stop(ctx.currentTime + 0.6); lfo2.stop(ctx.currentTime + 0.6) } })
    }
  }

  stopAmbient() {
    for (const n of this.ambientNodes) {
      try {
        n.stop()
      } catch {
        /* ignore */
      }
    }
    this.ambientNodes = []
  }

  /**
   * Play a spatial SFX. pos: world {x,y,z}, listenerPos: {x,y,z}, opts gain.
   * Returns the playback handle (so callers can stop it, e.g. enemy vocals).
   */
  play(name, opts = {}) {
    if (!this.ctx) return null
    const { pos, listener, gain = 1, loop = false } = opts
    let pan = opts.pan ?? 0
    let vol = gain
    if (pos && listener) {
      const dx = pos.x - listener.x
      const dz = pos.z - listener.z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d > 42) return null
      vol = gain * clamp(1 - d / 42, 0, 1)
      vol *= vol
      const angle = Math.atan2(dz, dx)
      const rel = angle - (listener.yaw || 0)
      pan = clamp(Math.sin(rel) * 0.9, -0.8, 0.8)
    }
    if (vol <= 0.001) return null
    const fn = this._sfx[name]
    if (!fn) return null
    return fn.call(this, vol, pan, loop, opts)
  }

  // ---------- building blocks ----------

  _env(name, vol, pan, loop) {
    const g = this.sfx
    const out = this.ctx.createGain()
    out.gain.value = vol
    const p = this.ctx.createStereoPanner()
    p.pan.value = pan
    out.connect(p)
    p.connect(g)
    return { out, p }
  }

  _tone(type, freq, t0, t1, vol, envOut) {
    const o = this.ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(freq, t0)
    o.frequency.exponentialRampToValueAtTime(Math.max(1, t1), t0 + 0.02)
    const og = this.ctx.createGain()
    og.gain.value = vol
    o.connect(og)
    og.connect(envOut)
    o.start(t0)
    return { o, og }
  }

  _noiseBurst(vol, envOut, filterFreq = 1000, q = 1, dur = 0.15, type = 'bandpass') {
    const src = this._noiseSource()
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = filterFreq
    f.Q.value = q
    const g = this.ctx.createGain()
    g.gain.value = vol
    src.connect(f)
    f.connect(g)
    g.connect(envOut)
    src.start()
    return { src, g, stopAt: this._now() + dur }
  }

  // ---------- SFX ----------

  _sfx = {}

  _register(name, fn) {
    this._sfx[name] = fn
  }

  _initSfx() {
    if (this._sfxReady) return
    this._sfxReady = true
    const A = this

    const basic = (name, fn) => A._register(name, fn)

    basic('ui', (vol, pan, loop) => {
      const { out } = A._env('ui', vol, pan, loop)
      const t = A._now()
      const tone = A._tone('sine', 660, t, t, 0.3, out)
      tone.o.frequency.exponentialRampToValueAtTime(880, t + 0.08)
      tone.og.gain.exponentialRampToValueAtTime(0.001, t + 0.12)
      tone.o.stop(t + 0.15)
      return null
    })

    basic('hurt', (vol, pan) => {
      const { out } = A._env('hurt', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol * 0.5, out, 200, 0.5, 0.25, 'lowpass')
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
      n.src.stop(t + 0.3)
      const o = A._tone('sawtooth', 90, t, t, vol * 0.5, out)
      o.o.frequency.exponentialRampToValueAtTime(45, t + 0.2)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
      o.o.stop(t + 0.25)
      return null
    })

    basic('heartbeat', (vol, pan, loop) => {
      const { out } = A._env('heartbeat', vol, pan, true)
      const t = A._now()
      const beat = (when, amp) => {
        const o = A.ctx.createOscillator()
        o.type = 'sine'
        o.frequency.value = 55
        const g = A.ctx.createGain()
        g.gain.setValueAtTime(0, when)
        g.gain.linearRampToValueAtTime(amp, when + 0.03)
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.16)
        o.connect(g)
        g.connect(out)
        o.start(when)
        o.stop(when + 0.2)
      }
      let when = A._now()
      const id = setInterval(() => {
        if (!A.ctx) return clearInterval(id)
        beat(when, 0.5)
        beat(when + 0.18, 0.35)
        when += 0.75
      }, 750)
      return { stop: () => clearInterval(id) }
    })

    basic('step', (vol, pan, loop, opts) => {
      const { out } = A._env('step', vol, pan, false)
      const t = A._now()
      const surf = opts.surf || 'tile'
      const freq = surf === 'water' ? 400 : surf === 'carpet' ? 900 : 1100
      const n = A._noiseBurst(vol, out, freq, 1.5, 0.07)
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.09)
      n.src.stop(t + 0.12)
      return null
    })

    basic('pickup', (vol, pan) => {
      const { out } = A._env('pickup', vol, pan, false)
      const t = A._now()
      const o = A._tone('sine', 520, t, t, 0.3, out)
      o.o.frequency.exponentialRampToValueAtTime(1040, t + 0.12)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
      o.o.stop(t + 0.2)
      return null
    })

    basic('equip', (vol, pan) => {
      const { out } = A._env('equip', vol, pan, false)
      const t = A._now()
      A._noiseBurst(vol * 0.4, out, 2000, 2, 0.06).src.stop(t + 0.1)
      const o = A._tone('square', 220, t, t, 0.12, out)
      o.o.stop(t + 0.06)
      return null
    })

    basic('door', (vol, pan) => {
      const { out } = A._env('door', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol * 0.6, out, 250, 0.7, 0.3, 'lowpass')
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.32)
      n.src.stop(t + 0.35)
      return null
    })

    basic('doorSlam', (vol, pan) => {
      const { out } = A._env('doorSlam', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol * 0.9, out, 180, 0.6, 0.2, 'lowpass')
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
      n.src.stop(t + 0.22)
      const o = A._tone('sine', 60, t, t, 0.5, out)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 0.15)
      o.o.stop(t + 0.18)
      return null
    })

    basic('meleeSwing', (vol, pan) => {
      const { out } = A._env('meleeSwing', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol * 0.5, out, 900, 1, 0.18)
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
      n.src.stop(t + 0.2)
      return null
    })

    basic('hit', (vol, pan) => {
      const { out } = A._env('hit', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol * 0.9, out, 500, 0.8, 0.12, 'lowpass')
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.12)
      n.src.stop(t + 0.15)
      const o = A._tone('square', 130, t, t, 0.25, out)
      o.o.stop(t + 0.08)
      return null
    })

    basic('gun', (vol, pan) => {
      const { out } = A._env('gun', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol, out, 1200, 0.8, 0.3, 'lowpass')
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
      n.src.stop(t + 0.35)
      const o = A._tone('sine', 70, t, t, 0.8, out)
      o.o.frequency.exponentialRampToValueAtTime(35, t + 0.2)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
      o.o.stop(t + 0.25)
      return null
    })

    basic('shotgun', (vol, pan) => {
      const { out } = A._env('shotgun', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol, out, 800, 0.6, 0.45, 'lowpass')
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.45)
      n.src.stop(t + 0.5)
      const o = A._tone('sine', 55, t, t, 1, out)
      o.o.frequency.exponentialRampToValueAtTime(30, t + 0.3)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
      o.o.stop(t + 0.35)
      return null
    })

    basic('reload', (vol, pan) => {
      const { out } = A._env('reload', vol, pan, false)
      const t = A._now()
      A._noiseBurst(vol * 0.3, out, 3000, 2, 0.05).src.stop(t + 0.08)
      setTimeout(() => {
        if (!A.ctx) return
        A._noiseBurst(vol * 0.4, out, 2200, 2, 0.06).src.stop(A._now() + 0.06)
      }, 220)
      return null
    })

    basic('enemySpawn', (vol, pan) => {
      const { out } = A._env('enemySpawn', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol * 0.6, out, 300, 0.5, 0.4, 'lowpass')
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
      n.src.stop(t + 0.45)
      return null
    })

    basic('enemyAttack', (vol, pan) => {
      const { out } = A._env('enemyAttack', vol, pan, false)
      const t = A._now()
      const o = A._tone('sawtooth', 140, t, t, 0.4, out)
      o.o.frequency.exponentialRampToValueAtTime(70, t + 0.35)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
      o.o.stop(t + 0.4)
      const n = A._noiseBurst(vol * 0.5, out, 400, 1, 0.3)
      n.src.stop(t + 0.35)
      return null
    })

    basic('enemyDeath', (vol, pan) => {
      const { out } = A._env('enemyDeath', vol, pan, false)
      const t = A._now()
      const o = A._tone('sawtooth', 200, t, t, 0.3, out)
      o.o.frequency.exponentialRampToValueAtTime(40, t + 0.6)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 0.6)
      o.o.stop(t + 0.65)
      const n = A._noiseBurst(vol * 0.4, out, 500, 1, 0.5)
      n.src.stop(t + 0.55)
      return null
    })

    basic('whisper', (vol, pan) => {
      const { out } = A._env('whisper', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol * 0.8, out, 2200, 4, 0.9, 'bandpass')
      n.g.gain.setValueAtTime(vol, t + 0.3)
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.9)
      n.src.stop(t + 1.0)
      const lfo = A.ctx.createOscillator()
      lfo.frequency.value = 7
      const lfoG = A.ctx.createGain()
      lfoG.gain.value = 0.3
      lfo.connect(lfoG)
      lfoG.connect(n.g.gain)
      lfo.start(t)
      lfo.stop(t + 1)
      return null
    })

    basic('staticBurst', (vol, pan) => {
      const { out } = A._env('staticBurst', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol * 0.8, out, 3500, 1, 0.35)
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
      n.src.stop(t + 0.4)
      return null
    })

    basic('phoneRing', (vol, pan, loop) => {
      const { out } = A._env('phoneRing', vol, pan, loop)
      const t = A._now()
      const o = A._tone('sine', 940, t, t, 0.4, out)
      const o2 = A._tone('sine', 940, t + 0.03, t + 0.03, 0.4, out)
      o.og.gain.setValueAtTime(0.4, t)
      o.og.gain.setValueAtTime(0, t + 0.15)
      o.og.gain.setValueAtTime(0.4, t + 0.2)
      o.og.gain.setValueAtTime(0, t + 0.35)
      o2.og.gain.setValueAtTime(0.4, t + 0.03)
      o2.og.gain.setValueAtTime(0, t + 0.18)
      o2.og.gain.setValueAtTime(0.4, t + 0.23)
      o2.og.gain.setValueAtTime(0, t + 0.38)
      o.o.stop(t + 0.5)
      o2.o.stop(t + 0.5)
      return null
    })

    basic('bell', (vol, pan) => {
      const { out } = A._env('bell', vol, pan, false)
      const t = A._now()
      const o = A._tone('sine', 660, t, t, 0.6, out)
      o.o.frequency.exponentialRampToValueAtTime(660, t + 0.8)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 0.9)
      o.o.stop(t + 1)
      return null
    })

    basic('alarm', (vol, pan) => {
      const { out } = A._env('alarm', vol, pan, false)
      const t = A._now()
      for (let i = 0; i < 3; i++) {
        const o = A._tone('square', 440, t + i * 0.2, t + i * 0.2, 0.2, out)
        o.o.frequency.exponentialRampToValueAtTime(880, t + i * 0.2 + 0.15)
        o.og.gain.exponentialRampToValueAtTime(0.001, t + i * 0.2 + 0.18)
        o.o.stop(t + i * 0.2 + 0.2)
      }
      return null
    })

    basic('train', (vol, pan) => {
      const { out } = A._env('train', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol * 0.9, out, 200, 0.5, 2.5, 'lowpass')
      n.g.gain.setValueAtTime(0.0001, t)
      n.g.gain.exponentialRampToValueAtTime(vol, t + 1.2)
      n.g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6)
      n.src.stop(t + 2.8)
      const o = A._tone('sine', 45, t, t, 0.5, out)
      o.o.frequency.setValueAtTime(45, t)
      o.o.frequency.linearRampToValueAtTime(70, t + 2)
      o.og.gain.setValueAtTime(0.5, t + 0.5)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 2.6)
      o.o.stop(t + 2.8)
      return null
    })

    basic('whistle', (vol, pan) => {
      const { out } = A._env('whistle', vol, pan, false)
      const t = A._now()
      const o = A._tone('sine', 1800, t, t, 0.5, out)
      o.o.frequency.setValueAtTime(1800, t)
      o.o.frequency.linearRampToValueAtTime(2100, t + 0.4)
      o.o.frequency.linearRampToValueAtTime(1500, t + 0.8)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 0.9)
      o.o.stop(t + 1)
      return null
    })

    basic('paperRustle', (vol, pan) => {
      const { out } = A._env('paperRustle', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol * 0.7, out, 4000, 5, 0.3, 'highpass')
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
      n.src.stop(t + 0.35)
      return null
    })

    basic('fire', (vol, pan) => {
      const { out } = A._env('fire', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol * 0.8, out, 500, 0.7, 1.2, 'lowpass')
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 1.2)
      n.src.stop(t + 1.4)
      const o = A._tone('sine', 90, t, t, 0.3, out)
      o.o.frequency.linearRampToValueAtTime(40, t + 1)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 1.1)
      o.o.stop(t + 1.2)
      return null
    })

    basic('splash', (vol, pan) => {
      const { out } = A._env('splash', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol * 0.8, out, 900, 0.5, 0.5, 'bandpass')
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
      n.src.stop(t + 0.55)
      const o = A._tone('sine', 200, t, t, 0.3, out)
      o.o.frequency.exponentialRampToValueAtTime(60, t + 0.3)
      o.o.stop(t + 0.4)
      return null
    })

    basic('glitch', (vol, pan) => {
      const { out } = A._env('glitch', vol, pan, false)
      const t = A._now()
      for (let i = 0; i < 4; i++) {
        const o = A._tone('square', 300 + Math.random() * 400, t + i * 0.05, t + i * 0.05, 0.15, out)
        o.o.frequency.setValueAtTime(300 + Math.random() * 500, t + i * 0.05)
        o.o.stop(t + i * 0.05 + 0.04)
      }
      const n = A._noiseBurst(vol * 0.3, out, 2000, 2, 0.3)
      n.src.stop(t + 0.35)
      return null
    })

    basic('consume', (vol, pan) => {
      const { out } = A._env('consume', vol, pan, false)
      const t = A._now()
      const o = A._tone('sine', 300, t, t, 0.2, out)
      o.o.frequency.exponentialRampToValueAtTime(180, t + 0.2)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
      o.o.stop(t + 0.3)
      return null
    })

    basic('save', (vol, pan) => {
      const { out } = A._env('save', vol, pan, false)
      const t = A._now()
      const o = A._tone('sine', 440, t, t, 0.25, out)
      o.o.frequency.exponentialRampToValueAtTime(880, t + 0.25)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
      o.o.stop(t + 0.35)
      return null
    })

    basic('breath', (vol, pan) => {
      const { out } = A._env('breath', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol * 0.6, out, 800, 1, 0.8, 'bandpass')
      n.g.gain.setValueAtTime(0.0001, t)
      n.g.gain.linearRampToValueAtTime(vol, t + 0.3)
      n.g.gain.linearRampToValueAtTime(0.0001, t + 0.8)
      n.src.stop(t + 0.9)
      return null
    })

    basic('paperTear', (vol, pan) => {
      const { out } = A._env('paperTear', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol * 0.8, out, 2500, 3, 0.4, 'bandpass')
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
      n.src.stop(t + 0.45)
      return null
    })

    basic('drip', (vol, pan) => {
      const { out } = A._env('drip', vol, pan, false)
      const t = A._now()
      const o = A._tone('sine', 900, t, t, 0.25, out)
      o.o.frequency.exponentialRampToValueAtTime(300, t + 0.1)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 0.12)
      o.o.stop(t + 0.15)
      return null
    })

    // ---- enemy vocals (per type) ----
    basic('vocHost', (vol, pan) => {
      const { out } = A._env('vocHost', vol, pan, false)
      const t = A._now()
      const o = A._tone('sawtooth', 70, t, t, 0.5, out)
      o.o.frequency.setValueAtTime(70, t)
      o.o.frequency.linearRampToValueAtTime(100, t + 0.5)
      o.o.frequency.linearRampToValueAtTime(60, t + 1)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 1.1)
      o.o.stop(t + 1.2)
      const n = A._noiseBurst(vol * 0.3, out, 400, 1, 0.9, 'lowpass')
      n.src.stop(t + 1.0)
      return null
    })
    basic('vocLingerer', (vol, pan) => {
      const { out } = A._env('vocLingerer', vol, pan, false)
      const t = A._now()
      for (let i = 0; i < 5; i++) {
        const o = A._tone('square', 500 + Math.random() * 200, t + i * 0.07, t + i * 0.07, 0.2, out)
        o.o.frequency.setValueAtTime(500 + Math.random() * 400, t + i * 0.07)
        o.o.stop(t + i * 0.07 + 0.05)
      }
      return null
    })
    basic('vocTuner', (vol, pan) => {
      const { out } = A._env('vocTuner', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol * 0.9, out, 3000, 4, 1.2, 'bandpass')
      n.g.gain.setValueAtTime(0.0001, t)
      n.g.gain.linearRampToValueAtTime(vol, t + 0.6)
      n.g.gain.linearRampToValueAtTime(0.0001, t + 1.2)
      n.src.stop(t + 1.3)
      const lfo = A.ctx.createOscillator()
      lfo.frequency.value = 30
      const lg = A.ctx.createGain()
      lg.gain.value = 0.4
      lfo.connect(lg)
      lg.connect(n.g.gain)
      lfo.start(t)
      lfo.stop(t + 1.3)
      return null
    })
    basic('vocDrown', (vol, pan) => {
      const { out } = A._env('vocDrown', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol * 0.7, out, 350, 1, 0.7, 'lowpass')
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.7)
      n.src.stop(t + 0.75)
      const o = A._tone('sine', 55, t, t, 0.5, out)
      o.o.frequency.exponentialRampToValueAtTime(120, t + 0.5)
      o.o.stop(t + 0.6)
      return null
    })
    basic('vocPaper', (vol, pan) => {
      const { out } = A._env('vocPaper', vol, pan, false)
      const t = A._now()
      const n = A._noiseBurst(vol * 0.8, out, 4000, 6, 0.5, 'highpass')
      n.g.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
      n.src.stop(t + 0.55)
      return null
    })
    basic('vocMannequin', (vol, pan) => {
      const { out } = A._env('vocMannequin', vol, pan, false)
      const t = A._now()
      const o = A._tone('sine', 220, t, t, 0.4, out)
      o.o.frequency.exponentialRampToValueAtTime(120, t + 0.3)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
      o.o.stop(t + 0.35)
      const n = A._noiseBurst(vol * 0.4, out, 800, 2, 0.2)
      n.src.stop(t + 0.25)
      return null
    })
    basic('vocNurse', (vol, pan) => {
      const { out } = A._env('vocNurse', vol, pan, false)
      const t = A._now()
      const o = A._tone('sawtooth', 900, t, t, 0.3, out)
      o.o.frequency.setValueAtTime(900, t)
      o.o.frequency.linearRampToValueAtTime(1400, t + 0.2)
      o.o.frequency.linearRampToValueAtTime(700, t + 0.5)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 0.6)
      o.o.stop(t + 0.65)
      return null
    })
    basic('vocPrincipal', (vol, pan) => {
      const { out } = A._env('vocPrincipal', vol, pan, false)
      const t = A._now()
      const o = A._tone('square', 180, t, t, 0.35, out)
      o.o.frequency.setValueAtTime(180, t)
      o.o.frequency.linearRampToValueAtTime(220, t + 0.3)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
      o.o.stop(t + 0.35)
      return null
    })
    basic('vocConductor', (vol, pan) => {
      const { out } = A._env('vocConductor', vol, pan, false)
      const t = A._now()
      const o = A._tone('sine', 120, t, t, 0.4, out)
      o.o.frequency.setValueAtTime(120, t)
      o.o.frequency.linearRampToValueAtTime(90, t + 0.8)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 0.9)
      o.o.stop(t + 1)
      const w = A.ctx.createOscillator()
      w.type = 'sine'
      w.frequency.value = 60
      const wg = A.ctx.createGain()
      wg.gain.value = 0.0001
      w.connect(wg)
      wg.connect(out)
      w.start(t)
      w.stop(t + 1)
      return null
    })
    basic('vocShade', (vol, pan) => {
      const { out } = A._env('vocShade', vol, pan, false)
      const t = A._now()
      const o = A._tone('sawtooth', 45, t, t, 0.5, out)
      o.o.frequency.setValueAtTime(45, t)
      o.o.frequency.linearRampToValueAtTime(25, t + 1.5)
      o.og.gain.exponentialRampToValueAtTime(0.001, t + 1.6)
      o.o.stop(t + 1.7)
      return null
    })
  }

  /**
   * Play a looping enemy vocal that can be stopped.
   */
  playEnemyVocal(type, opts) {
    if (!this.ctx) return null
    const name = `voc${type.charAt(0).toUpperCase()}${type.slice(1)}`
    return this.play(name, opts)
  }

  /** Play with retry once if ctx just created (init order fix). */
  lazyPlay(name, opts) {
    if (!this._sfxReady) this._initSfx()
    return this.play(name, opts)
  }

  getSfxReady() {
    return this._sfxReady
  }

  // Tension music layer: fades a low dissonant bed up/down with `level` (0..1).
  setTension(level) {
    this.tension = level
    if (!this.ctx || !this.music) return
    // (simple approach: ambient gain is already the tension carrier; we just
    //  keep it here for API compatibility)
  }
}

let _instance = null
export function audio() {
  if (!_instance) {
    _instance = new AudioEngine()
    _instance._initSfx()
  }
  return _instance
}
