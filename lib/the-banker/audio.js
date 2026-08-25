// Procedural WebAudio — show-floor stings for the TV — plus an optional
// looping background-music file dropped into assets/music/

let ctx = null
let master = null

export function audioInit() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)()
    master = ctx.createGain()
    master.gain.value = 0.5
    master.connect(ctx.destination)
  } catch { /* no audio */ }
}

function env(gainNode, t0, attack, hold, release, peak = 1) {
  const g = gainNode.gain
  g.setValueAtTime(0.0001, t0)
  g.exponentialRampToValueAtTime(peak, t0 + attack)
  g.setValueAtTime(peak, t0 + attack + hold)
  g.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release)
}

function tone({ freq = 440, type = 'sine', dur = 0.3, at = 0, peak = 0.5, slideTo = null }) {
  if (!ctx) return
  const t0 = ctx.currentTime + at
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
  env(gain, t0, 0.01, dur * 0.4, dur * 0.5, peak)
  osc.connect(gain).connect(master)
  osc.start(t0)
  osc.stop(t0 + dur + 0.2)
}

function noise({ dur = 0.5, at = 0, peak = 0.3, freq = 1200, q = 1, sweepTo = null }) {
  if (!ctx) return
  const t0 = ctx.currentTime + at
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buf
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(freq, t0)
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur)
  filter.Q.value = q
  const gain = ctx.createGain()
  env(gain, t0, 0.02, dur * 0.5, dur * 0.45, peak)
  src.connect(filter).connect(gain).connect(master)
  src.start(t0)
}

// a crowd is many voices: wobbling bands of shaped noise
function crowdMurmur({ dur = 2, at = 0, peak = 0.3, freq = 900, q = 0.6, wobble = 7 }) {
  if (!ctx) return
  const t0 = ctx.currentTime + at
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buf
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = freq
  bp.Q.value = q
  const g = ctx.createGain()
  env(g, t0, dur * 0.22, dur * 0.42, dur * 0.36, peak)
  const lfo = ctx.createOscillator()
  const depth = ctx.createGain()
  lfo.type = 'sine'
  lfo.frequency.value = wobble
  depth.gain.value = peak * 0.3
  lfo.connect(depth).connect(g.gain)
  src.connect(bp).connect(g).connect(master)
  lfo.start(t0)
  lfo.stop(t0 + dur)
  src.start(t0)
}

function claps({ dur = 2, at = 0, rate = 24, peak = 0.12 } = {}) {
  const n = Math.floor(dur * rate)
  for (let i = 0; i < n; i++) {
    noise({
      dur: 0.03,
      at: at + Math.random() * dur,
      freq: 2000 + Math.random() * 2000,
      q: 1.5,
      peak: peak * (0.4 + Math.random() * 0.6),
    })
  }
}

function crowdCheer(at = 0) {
  crowdMurmur({ dur: 2.8, at, peak: 0.36, freq: 950, q: 0.5, wobble: 6.5 })
  crowdMurmur({ dur: 2.6, at: at + 0.06, peak: 0.15, freq: 2600, q: 0.7, wobble: 9 })
  claps({ dur: 2.1, at: at + 0.12, rate: 26, peak: 0.11 })
  tone({ freq: 2600, type: 'sine', dur: 0.5, at: at + 0.25, peak: 0.06, slideTo: 3100 })
}

function crowdOhh(at = 0) {
  if (!ctx) return
  const dur = 1.7
  const t0 = ctx.currentTime + at
  const out = ctx.createGain()
  env(out, t0, 0.16, dur * 0.42, dur * 0.42, 0.5)
  const bps = [[480, 5], [850, 6], [2400, 8]].map(([f, q]) => {
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = f
    bp.Q.value = q
    bp.connect(out)
    return bp
  })
  out.connect(master)
  for (const det of [-10, -4, 0, 6, 11]) {
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(196 + det, t0)
    osc.frequency.exponentialRampToValueAtTime(148 + det, t0 + dur)
    const vg = ctx.createGain()
    vg.gain.value = 0.28
    osc.connect(vg)
    bps.forEach(bp => vg.connect(bp))
    osc.start(t0)
    osc.stop(t0 + dur)
  }
  crowdMurmur({ dur: 1.5, at, peak: 0.12, freq: 550, q: 0.4, wobble: 5 })
}

function goodPull() {
  const notes = [659, 784, 988, 1319]
  notes.forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.15, at: i * 0.06, peak: 0.3 }))
  noise({ dur: 0.45, freq: 4500, sweepTo: 8000, peak: 0.07 })
}

function badPull() {
  tone({ freq: 330, type: 'square', dur: 0.2, peak: 0.22 })
  tone({ freq: 262, type: 'square', dur: 0.26, at: 0.15, peak: 0.22 })
  tone({ freq: 175, type: 'sawtooth', dur: 0.55, at: 0.3, peak: 0.28, slideTo: 110 })
}

export const sfx = {
  click() { tone({ freq: 900, type: 'triangle', dur: 0.06, peak: 0.25 }) },
  caseOpen() {
    noise({ dur: 0.35, freq: 500, sweepTo: 3000, peak: 0.35 })
    tone({ freq: 220, type: 'sawtooth', dur: 0.25, peak: 0.2, slideTo: 90 })
  },
  revealGood() {
    goodPull()
    crowdCheer(0.5)
  },
  revealBad() {
    badPull()
    crowdOhh(0.55)
  },
  bankerRing() {
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < 8; i++) {
        tone({ freq: 1400, type: 'sine', dur: 0.05, at: r * 1.1 + i * 0.11, peak: 0.3 })
        tone({ freq: 1000, type: 'sine', dur: 0.05, at: r * 1.1 + i * 0.11 + 0.05, peak: 0.25 })
      }
    }
  },
  drumroll(seconds = 3) {
    const n = Math.floor(seconds * 14)
    for (let i = 0; i < n; i++) {
      const vol = 0.08 + (i / n) * 0.22
      noise({ dur: 0.05, at: (i / n) * seconds, freq: 240, q: 2, peak: vol })
    }
  },
  dealChime() {
    tone({ freq: 880, type: 'sine', dur: 0.18, peak: 0.4 })
    tone({ freq: 1318, type: 'sine', dur: 0.4, at: 0.12, peak: 0.4 })
    noise({ dur: 0.15, at: 0.05, freq: 6000, peak: 0.15 })
  },
  standSting() { tone({ freq: 330, type: 'triangle', dur: 0.35, peak: 0.3, slideTo: 392 }) },
  twistGlitch() {
    for (let i = 0; i < 10; i++) {
      tone({ freq: 100 + Math.random() * 2000, type: 'square', dur: 0.05, at: i * 0.06, peak: 0.18 })
    }
    noise({ dur: 1.0, freq: 300, sweepTo: 2500, peak: 0.3 })
  },
  fanfare() {
    const notes = [523, 659, 784, 1047]
    notes.forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.5, at: i * 0.16, peak: 0.4 }))
    noise({ dur: 2.2, at: 0.5, freq: 1500, sweepTo: 5000, peak: 0.35 })
  },
  heartbeat() {
    tone({ freq: 55, type: 'sine', dur: 0.22, peak: 0.8 })
    tone({ freq: 50, type: 'sine', dur: 0.18, at: 0.28, peak: 0.6 })
  },
  tick() { tone({ freq: 1200, type: 'square', dur: 0.03, peak: 0.12 }) },
}

// ---------------------------------------------------------------------------
// background music — optional file asset (assets/music/theme.mp3)
// ---------------------------------------------------------------------------

const MUSIC_EXTS = ['mp3', 'ogg', 'wav', 'm4a']
let themePromise = null

function loadTheme(i = 0) {
  if (i >= MUSIC_EXTS.length) return Promise.resolve(null)
  const el = new Audio(new URL(`../assets/music/theme.${MUSIC_EXTS[i]}`, document.baseURI).href)
  el.loop = true
  el.volume = 0.45
  return new Promise(res => {
    el.addEventListener('canplay', () => res(el), { once: true })
    el.addEventListener('error', () => res(loadTheme(i + 1)), { once: true })
    el.load()
  })
}

export const music = {
  async start() {
    if (!themePromise) themePromise = loadTheme()
    const themeEl = await themePromise
    if (!themeEl) return
    themeEl.currentTime = 0
    themeEl.play().catch(() => { /* autoplay blocked — silence is fine */ })
  },
  stop() {
    if (!themePromise) return
    themePromise.then(el => {
      if (!el || el.paused) return
      el.pause()
      el.currentTime = 0
    })
  },
}
