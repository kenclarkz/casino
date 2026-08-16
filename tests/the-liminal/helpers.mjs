// Minimal assertion harness for the game's Node unit tests.
let passed = 0
let failed = 0
const failures = []

export function test(name, fn) {
  try {
    fn()
    passed++
  } catch (e) {
    failed++
    failures.push({ name, error: e })
  }
}

export function expect(actual) {
  const matchers = {
    toBe(expected) {
      if (Object.is(actual, expected)) return
      throw new Error(`expected ${String(expected)} but got ${String(actual)}`)
    },
    toEqual(expected) {
      const a = JSON.stringify(actual)
      const b = JSON.stringify(expected)
      if (a === b) return
      throw new Error(`expected ${a} to equal ${b}`)
    },
    toBeGreaterThan(expected) {
      if (actual > expected) return
      throw new Error(`expected ${String(actual)} > ${String(expected)}`)
    },
    toBeGreaterThanOrEqual(expected) {
      if (actual >= expected) return
      throw new Error(`expected ${String(actual)} >= ${String(expected)}`)
    },
    toBeLessThan(expected) {
      if (actual < expected) return
      throw new Error(`expected ${String(actual)} < ${String(expected)}`)
    },
    toBeTruthy() {
      if (actual) return
      throw new Error(`expected ${String(actual)} to be truthy`)
    },
    toBeFalsy() {
      if (!actual) return
      throw new Error(`expected ${String(actual)} to be falsy`)
    },
    toBeCloseTo(expected, eps = 1e-9) {
      if (Math.abs(actual - expected) <= eps) return
      throw new Error(`expected ${actual} close to ${expected}`)
    },
    toContain(expected) {
      if (Array.isArray(actual) || typeof actual === 'string') {
        if (actual.includes(expected)) return
      } else if (actual instanceof Set) {
        if (actual.has(expected)) return
      }
      throw new Error(`expected ${String(actual)} to contain ${String(expected)}`)
    },
  }
  return {
    ...matchers,
    get not() {
      const neg = {}
      for (const [k, fn] of Object.entries(matchers)) {
        neg[k] = (...args) => {
          try {
            fn(...args)
          } catch {
            return
          }
          throw new Error(`expected NOT ${String(actual)} ${k} ${args.map(String).join(', ')}`)
        }
      }
      return neg
    },
  }
}

export function summary() {
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failures.length) {
    for (const f of failures) {
      console.log(`\nFAIL: ${f.name}`)
      console.log(`  ${f.error?.stack || f.error}`)
    }
  }
  return failed === 0
}
