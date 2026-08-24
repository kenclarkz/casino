// Shared test registry (no top-level await here, so test files can import it).

export const tests = []
export function test(name, fn) { tests.push({ name, fn }) }
