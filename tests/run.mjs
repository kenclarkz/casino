// Tiny zero-dependency test runner: `node tests/run.mjs [name-filter]`

import { tests } from './registry.mjs'

const files = [
  './test_prizes.mjs',
  './test_rng.mjs',
  './test_engine.mjs',
  './test_bots.mjs',
  './test_host.mjs',
]

for (const f of files) await import(f)

const only = process.argv[2]
let failed = 0
for (const t of tests) {
  if (only && !t.name.includes(only)) continue
  try {
    await t.fn()
    console.log(`  ✓ ${t.name}`)
  } catch (err) {
    failed++
    console.error(`  ✗ ${t.name}\n      ${err.message}`)
  }
}
console.log(failed ? `\n${failed} test(s) FAILED` : '\nall green')
process.exit(failed ? 1 : 0)
