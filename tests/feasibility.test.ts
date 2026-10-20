import { existsSync } from 'node:fs'
import { expect, it } from 'vitest'

it('lists every real integration gate once, with no manufactured passes', async () => {
  expect(existsSync(new URL('../src/dev/feasibility.ts', import.meta.url))).toBe(true)
  const modulePath = '../src/dev/feasibility.ts'
  const { feasibilityGates } = await import(modulePath)
  expect(feasibilityGates.map((gate: { id: string }) => gate.id)).toEqual([
    'wallet-connect', 'offline-signing', 'issuer-verification', 'offline-reopen',
    'arc-access', 'wallet-import', 'conflicting-transfers',
  ])
  expect(new Set(feasibilityGates.map((gate: { id: string }) => gate.id)).size).toBe(7)
  expect(feasibilityGates.every((gate: { status: string }) => gate.status === 'not-tested')).toBe(true)
})
