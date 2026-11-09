import { describe, expect, it } from 'vitest'
import { PrivateKey, ProtoWallet, type WalletInterface } from '@bsv/sdk'
import { authenticationWallet } from '../src/auth/login.ts'

describe('authentication wallet boundary', () => {
  it('allows authentication signatures and denies spending and record mutations', async () => {
    const wallet = authenticationWallet(new ProtoWallet(PrivateKey.fromRandom()) as WalletInterface, new AbortController().signal)
    expect((await wallet.getPublicKey({ identityKey: true })).publicKey).toMatch(/^0[23]/)
    for (const method of ['createAction', 'signAction', 'internalizeAction', 'abortAction'] as const) {
      await expect((wallet[method] as Function)({})).rejects.toThrow('Authentication cannot')
    }
  })
  it('rejects late wallet operations after cancellation', async () => {
    const controller = new AbortController()
    const wallet = authenticationWallet(new ProtoWallet(PrivateKey.fromRandom()) as WalletInterface, controller.signal)
    controller.abort()
    await expect(wallet.getPublicKey({ identityKey: true })).rejects.toThrow()
  })
})

it('does not send an old organiser draft after delayed image encoding and an account switch', async () => {
  const { advanceAuthEpoch } = await import('../src/auth/api.ts')
  const { saveAccountEvent } = await import('../src/events/api.ts')
  let release!: (value: ArrayBuffer) => void
  const image = new Blob(['image'], { type: 'image/png' })
  image.arrayBuffer = () => new Promise(resolve => { release = resolve })
  advanceAuthEpoch('account-a')
  const saving = saveAccountEvent({ name: 'A draft', description: '', date: '2027-01-01', time: '18:00', timezone: 'UTC', venue: 'Hall', address: 'Street', image }, undefined, 'creation-id')
  const rejected = expect(saving).rejects.toThrow('account changed')
  advanceAuthEpoch('account-b')
  release(new ArrayBuffer(0))
  await rejected
  advanceAuthEpoch(null)
})
