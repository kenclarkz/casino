// Assertion helpers (kept separate from the runner to avoid import cycles).

function deepEq(a, b, path = '$') {
  if (a === b) return null
  if (typeof a !== typeof b || a === null || b === null) return `${path}: ${a} !== ${b}`
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} !== ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const err = deepEq(a[i], b[i], `${path}[${i}]`)
      if (err) return err
    }
    return null
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a).sort()
    const kb = Object.keys(b).sort()
    if (JSON.stringify(ka) !== JSON.stringify(kb)) return `${path}: keys differ`
    for (const k of ka) {
      const err = deepEq(a[k], b[k], `${path}.${k}`)
      if (err) return err
    }
    return null
  }
  return `${path}: ${a} !== ${b}`
}

export function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg)
}

assert.equal = (a, b, msg) => {
  if (a !== b) throw new Error(`${msg ?? 'equal'}: expected ${b}, got ${a}`)
}
assert.notEqual = (a, b, msg) => {
  if (a === b) throw new Error(`${msg ?? 'notEqual'}: both are ${a}`)
}
assert.deepEqual = (a, b, msg) => {
  const err = deepEq(a, b)
  if (err) throw new Error(`${msg ?? 'deepEqual'} → ${err}`)
}
assert.throws = (fn, match) => {
  try { fn() } catch (err) {
    if (match && !String(err.message).match(match)) {
      throw new Error(`threw wrong error: "${err.message}" (wanted /${match}/)`)
    }
    return
  }
  throw new Error('expected function to throw')
}
