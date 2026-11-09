import { expect, it, vi } from 'vitest'
import { probeWallet, ConnectionError, type ProbeClient, type ProbeCall } from '../src/wallet/connection.ts'

const identityKey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
function client(): ProbeClient {
  return {
    getNetwork: vi.fn().mockResolvedValue({ network: 'testnet' }),
    getVersion: vi.fn().mockResolvedValue({ version: 'test-v1.0.0' }),
    getPublicKey: vi.fn().mockResolvedValue({ publicKey: identityKey }),
  }
}
it('reads testnet, version and identity, then rechecks network with a safe method-only log', async () => {
  const log: ProbeCall[] = []
  const wallet = client()
  const result = await probeWallet(wallet, new AbortController().signal, entry => log.push(entry))
  expect(result).toMatchObject({ network: 'testnet', identityKey, version: 'test-v1.0.0' })
  expect(log.filter(entry => entry.status === 'started').map(entry => entry.method)).toEqual(['getNetwork', 'getVersion', 'getPublicKey', 'getNetwork'])
  expect(wallet.getPublicKey).toHaveBeenCalledWith({ identityKey: true })
  expect(JSON.stringify(log)).not.toContain(identityKey)
})
it('blocks mainnet before any identity permission request', async () => {
  const wallet = client()
  vi.mocked(wallet.getNetwork).mockResolvedValue({ network: 'mainnet' })
  await expect(probeWallet(wallet, new AbortController().signal)).rejects.toMatchObject({ code: 'wrong-network' })
  expect(wallet.getPublicKey).not.toHaveBeenCalled()
  expect(wallet.getVersion).not.toHaveBeenCalled()
})
it('rejects a wallet network switch during identity approval', async () => {
  const wallet = client()
  vi.mocked(wallet.getNetwork).mockResolvedValueOnce({ network: 'testnet' }).mockResolvedValueOnce({ network: 'mainnet' })
  await expect(probeWallet(wallet, new AbortController().signal)).rejects.toMatchObject({ code: 'wrong-network' })
})
it.each(['bad-key', '02' + 'ff'.repeat(32)])('rejects an invalid public key: %s', async key => {
  const wallet = client()
  vi.mocked(wallet.getPublicKey).mockResolvedValue({ publicKey: key })
  await expect(probeWallet(wallet, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid-response' })
})
it('cancels a pending request and never proceeds when its late result arrives', async () => {
  const wallet = client()
  let resolve!: (value: { network: 'testnet' }) => void
  vi.mocked(wallet.getNetwork).mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const controller = new AbortController()
  const pending = probeWallet(wallet, controller.signal)
  await Promise.resolve()
  controller.abort(new ConnectionError('cancelled'))
  await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
  resolve({ network: 'testnet' })
  await Promise.resolve()
  expect(wallet.getVersion).not.toHaveBeenCalled()
})
it('preserves timeout as a reason without exposing wallet error text', async () => {
  const wallet = client()
  const signal = AbortSignal.abort(new ConnectionError('timeout'))
  await expect(probeWallet(wallet, signal)).rejects.toMatchObject({ code: 'timeout' })
  expect(wallet.getNetwork).not.toHaveBeenCalled()
  vi.mocked(wallet.getNetwork).mockRejectedValue(new Error('sensitive wallet response'))
  const log: ProbeCall[] = []
  await expect(probeWallet(wallet, new AbortController().signal, entry => log.push(entry))).rejects.toMatchObject({ code: 'request-failed' })
  expect(JSON.stringify(log)).not.toContain('sensitive')
})
