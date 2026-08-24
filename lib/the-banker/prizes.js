// The prize board: 20 values from $1 to $1,000,000, shuffled into cases.

export const PRIZES = [
  1, 5, 10, 25, 50, 75, 100, 250, 500,
  1000, 2500, 5000, 7500, 10000,
  25000, 50000, 75000, 100000, 250000, 1000000,
]

export const CASE_COUNT = PRIZES.length

export function formatMoney(n) {
  return '$' + Number(n).toLocaleString('en-US')
}
