import { describe, expect, it, vi } from 'vitest'
import { PrivateKey, ProtoWallet } from '@bsv/sdk'
import { checkWallet } from '../src/wallet/identity.ts'

const messages = { network: 'Select testnet.', identity: 'Wrong identity.', receivingKey: 'Wrong receiving key.' }
async function setup(network = 'testnet') {
  const wallet = new ProtoWallet(new PrivateKey(7)),
    identity = (await wallet.getPublicKey({ identityKey: true })).publicKey
  const key = { protocolID: [2, 'counterfoil ticket receiving'] as [2, string], keyID: 'request', counterparty: 'self' }
  const receivingKey = { ...key, publicKey: (await wallet.getPublicKey({ ...key, forSelf: true })).publicKey }
  const reader = {
    getNetwork: vi.fn(async () => ({ network })),
    getPublicKey: vi.fn((args: Parameters<ProtoWallet['getPublicKey']>[0]) => wallet.getPublicKey(args)),
  }
  return { reader, identity, receivingKey }
}
describe('checkWallet', () => {
  it('returns the identity after confirming network, identity and receiving key', async () => {
    const { reader, identity, receivingKey } = await setup()
    expect(await checkWallet(reader as never, { identity, receivingKey, messages })).toBe(identity)
  })
  it('stops at the network before asking for any key', async () => {
    const { reader, identity } = await setup('mainnet')
    await expect(checkWallet(reader as never, { identity, messages })).rejects.toThrow('Select testnet.')
    expect(reader.getPublicKey).not.toHaveBeenCalled()
  })
  it('uses each flow’s own wording for identity and receiving key mismatches', async () => {
    const { reader, receivingKey } = await setup()
    await expect(checkWallet(reader as never, { identity: new PrivateKey(8).toPublicKey().toString(), messages })).rejects.toThrow(
      'Wrong identity.',
    )
    await expect(
      checkWallet(reader as never, { receivingKey: { ...receivingKey, publicKey: new PrivateKey(9).toPublicKey().toString() }, messages }),
    ).rejects.toThrow('Wrong receiving key.')
  })
  it('works out the expected identity only after asking the wallet for its network, as each flow did before', async () => {
    const { reader } = await setup(),
      order: string[] = []
    reader.getNetwork.mockImplementation(async () => {
      order.push('network')
      return { network: 'testnet' }
    })
    const expected = () => {
      order.push('expected identity')
      throw Error('Invalid ticket package or receiving request')
    }
    await expect(checkWallet(reader as never, { identity: expected, messages })).rejects.toThrow(
      'Invalid ticket package or receiving request',
    )
    expect(order).toEqual(['network', 'expected identity'])
  })
  it('routes every wallet call through the flow’s wrapper and error type', async () => {
    const { reader, identity } = await setup('mainnet'),
      seen: string[] = []
    class FlowError extends Error {}
    await expect(
      checkWallet(reader as never, { identity, messages, error: message => new FlowError(message) }, (method, work) => {
        seen.push(method)
        return work()
      }),
    ).rejects.toBeInstanceOf(FlowError)
    expect(seen).toEqual(['getNetwork'])
  })
})
