import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

describe('frontend-only scaffold', () => {
  it('sets an explicit testnet boundary', async () => {
    expect(existsSync(new URL('../src/config/network.ts', import.meta.url))).toBe(true)
    const modulePath = '../src/config/network.ts'
    const { BSV_NETWORK } = await import(modulePath)
    expect(BSV_NETWORK).toBe('testnet')
  })

  it('does not install a server, relay or authentication baseline', () => {
    expect(packageJson.scripts).not.toHaveProperty('dev:server')
    expect(packageJson.scripts).not.toHaveProperty('start:server')
    for (const name of ['express', '@bsv/message-box-client', '@bsv/wallet-toolbox-client', '@bsv/wallet-relay', '@bsv/auth']) {
      expect(packageJson.dependencies).not.toHaveProperty(name)
    }
  })
})
