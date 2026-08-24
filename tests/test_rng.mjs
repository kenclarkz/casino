import { test } from './registry.mjs'
import { assert } from './lib.mjs'
import { makeRng } from '../lib/the-banker/rng.js'

test('rng: deterministic from a seed', () => {
  const a = makeRng(1234)
  const b = makeRng(1234)
  const seqA = Array.from({ length: 20 }, () => a.next())
  const seqB = Array.from({ length: 20 }, () => b.next())
  assert.deepEqual(seqA, seqB)
})

test('rng: different seeds diverge', () => {
  const a = makeRng(1).next()
  const b = makeRng(2).next()
  assert(a !== b, 'seeds should differ')
})

test('rng: shuffle is a permutation and deterministic', () => {
  const base = [1, 2, 3, 4, 5, 6, 7, 8]
  const s1 = makeRng(99).shuffle(base)
  const s2 = makeRng(99).shuffle(base)
  assert.deepEqual(s1, s2)
  assert.deepEqual([...s1].sort((x, y) => x - y), base)
})
