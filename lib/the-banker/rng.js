// Deterministic seeded RNG (mulberry32). The authority owns the seed, so a
// whole game can be replayed / unit-tested from one integer.

export function makeRng(seed) {
  let a = seed >>> 0
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    seed,
    next,
    int(min, max) { return min + Math.floor(next() * (max - min + 1)) },
    pick(arr) { return arr[Math.floor(next() * arr.length)] },
    shuffle(arr) {
      const out = arr.slice()
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
  }
}

export function randomSeed() {
  return (Math.random() * 0xFFFFFFFF) >>> 0
}
