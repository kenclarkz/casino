import { test, expect } from './helpers.mjs'
import { makeRng, hashString, clamp, lerp, damp, dist2, circleRect, pointInRect, makeNoise1, pickWeighted, KEY } from '../../lib/the-liminal/utils.js'

test('mulberry32 is deterministic', () => {
  const a = makeRng(42)
  const b = makeRng(42)
  const seq1 = [a.next(), a.next(), a.next()]
  const seq2 = [b.next(), b.next(), b.next()]
  expect(seq1).toEqual(seq2)
  expect(a.next()).toBeGreaterThan(0)
  expect(a.next()).toBeLessThan(1)
})

test('different seeds diverge', () => {
  const a = makeRng(1)
  const b = makeRng(2)
  let diff = 0
  for (let i = 0; i < 20; i++) if (a.next() !== b.next()) diff++
  expect(diff).toBeGreaterThan(10)
})

test('hashString is stable and varied', () => {
  expect(hashString('abc')).toBe(hashString('abc'))
  expect(hashString('abc')).not.toBe(hashString('abd'))
})

test('clamp / lerp / dist2', () => {
  expect(clamp(5, 0, 3)).toBe(3)
  expect(clamp(-1, 0, 3)).toBe(0)
  expect(lerp(0, 10, 0.5)).toBe(5)
  expect(dist2(0, 0, 3, 4)).toBe(25)
})

test('pointInRect / circleRect', () => {
  expect(pointInRect(2, 2, 0, 0, 4, 4)).toBe(true)
  expect(pointInRect(5, 2, 0, 0, 4, 4)).toBe(false)
  expect(circleRect(1, 1, 0.5, 0, 0, 1, 1)).toBe(true)
  expect(circleRect(5, 5, 0.5, 0, 0, 1, 1)).toBe(false)
})

test('makeNoise1 is deterministic and bounded', () => {
  const n = makeNoise1(7)
  const a = [n.at(0.1), n.at(0.1), n.at(0.5)]
  const m = makeNoise1(7)
  expect([m.at(0.1), m.at(0.1), m.at(0.5)]).toEqual(a)
  for (const v of a) expect(v).toBeGreaterThanOrEqual(0)
})

test('pickWeighted obeys weights', () => {
  const rng = makeRng(3)
  const counts = { a: 0, b: 0 }
  for (let i = 0; i < 2000; i++) counts[pickWeighted({ a: 90, b: 10 }, rng)]++
  expect(counts.a).toBeGreaterThan(counts.b)
})

test('KEY map has all bindings', () => {
  expect(KEY.ATTACK).toBe(8)
  expect(KEY.INTERACT).toBe(4)
  expect(KEY.PAUSE).toBe(14)
})
