// Runner: node tests/the-liminal/run.mjs
import { summary } from './helpers.mjs'

const suites = [
  './test_utils.mjs',
  './test_items.mjs',
  './test_environments.mjs',
  './test_levelgen.mjs',
  './test_inventory.mjs',
  './test_save.mjs',
]

for (const s of suites) {
  console.log(`\n=== ${s} ===`)
  try {
    await import(s)
  } catch (e) {
    console.error(`Could not load suite ${s}:`, e)
    process.exitCode = 1
  }
}

if (!summary()) process.exitCode = 1
