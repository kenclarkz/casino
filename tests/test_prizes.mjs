import { test } from './registry.mjs'
import { assert } from './lib.mjs'
import { PRIZES, CASE_COUNT } from '../lib/the-banker/prizes.js'

test('prize board: 20 values from $1 to $1,000,000', () => {
  assert.equal(PRIZES.length, CASE_COUNT)
  assert.equal(PRIZES.length, 20)
  assert.equal(Math.min(...PRIZES), 1)
  assert.equal(Math.max(...PRIZES), 1000000)
})

test('prize board: all unique', () => {
  assert.equal(new Set(PRIZES).size, 20)
})
