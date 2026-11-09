import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

describe('application boundaries', () => {
  it('sets an explicit testnet boundary', async () => {
    expect(existsSync(new URL('../src/config/network.ts', import.meta.url))).toBe(true)
    const modulePath = '../src/config/network.ts'
    const { BSV_NETWORK } = await import(modulePath)
    expect(BSV_NETWORK).toBe('testnet')
  })

  it('keeps wallet custody and relay dependencies outside the application API', () => {
    expect(packageJson.scripts).toHaveProperty('api')
    expect(packageJson.dependencies).toHaveProperty('express')
    expect(packageJson.dependencies).toHaveProperty('pg')
    for (const name of ['@bsv/message-box-client', '@bsv/wallet-toolbox-client', '@bsv/wallet-relay', '@bsv/auth']) {
      expect(packageJson.dependencies).not.toHaveProperty(name)
    }
  })
})
