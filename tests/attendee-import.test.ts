import { expect, it, vi } from 'vitest'
import { ProtoWallet, PrivateKey, Transaction } from '@bsv/sdk'
import type { WalletInterface, InternalizeActionArgs, ListOutputsResult } from '@bsv/sdk'
import { attendeeOfflineFixture } from './helpers/attendee-offline-fixture.ts'
import { attendeeEvidence } from '../src/offline/attendee-evidence.ts'
import type { HeaderSnapshot } from '../src/headers/validate.ts'
import { reviewAttendeeImport, importAttendeeTicket, reconcileAttendeeImport, type AttendeeImportDependencies } from '../src/wallet/attendee-import.ts'
import { importFingerprint, importKey, newAttendeeImport, finishAttendeeImport, appendAttendeeObservation, readAttendeeImport, type AttendeeImportRecord } from '../src/wallet/attendee-import-store.ts'

// Only invented mining anchors cross a test boundary. Request/issuer signatures,
// evidence binding, script checks, coordinator and record transitions remain real.
vi.mock('../src/verification/signing-spv.ts', async original => ({ ...await original<object>(), verifySigningEvidence: async (e: { atomicBeef: number[] }, snapshot?: HeaderSnapshot) => {
 if (!snapshot) throw Error('Missing headers')
 return { subjectMined: !!Transaction.fromAtomicBEEF(e.atomicBeef).merklePath }
} }))
const origin = 'http://127.0.0.1:4175'
async function setup(mined = true) {
 const f = await attendeeOfflineFixture(origin, mined), evidence = attendeeEvidence(f.record, f.identity, origin)
 const proto = new ProtoWallet(new PrivateKey(2)), signal = new AbortController()
 let listing: ListOutputsResult = { totalOutputs: 0, outputs: [] }, saved: AttendeeImportRecord | undefined
 let identity = f.identity, network = 'testnet', failSave = false, guardFailure = false
 const mutations: InternalizeActionArgs[] = []
 const wallet = {
  getNetwork: async () => ({ network }), getVersion: async () => ({ version: 'wallet-brc100-1.0.0' }),
  getPublicKey: async (args: Parameters<WalletInterface['getPublicKey']>[0]) => args.identityKey ? { publicKey: identity } : proto.getPublicKey(args),
  listOutputs: async (args: { basket: string }) => { expect(args.basket).toBe('ticketsv-tickets'); return listing },
  internalizeAction: async (args: InternalizeActionArgs) => { mutations.push(args); return { accepted: true } },
 } as Pick<WalletInterface, 'getNetwork' | 'getVersion' | 'getPublicKey' | 'listOutputs' | 'internalizeAction'>
 const state = { evidence, snapshot: { id: 'aa'.repeat(32) } as HeaderSnapshot | undefined }
 const store: AttendeeImportDependencies['store'] = {
  load: async () => saved,
  claim: async e => { if (saved) throw Error('Already attempted'); saved = newAttendeeImport(e); return saved },
  finish: async (e, id, outcome) => { expect(importKey(e)).toBe(importKey(saved!.evidence)); if (failSave) throw Error('Storage failed'); saved = finishAttendeeImport(saved!, id, outcome); return saved },
  observe: async (e, id, review) => { expect(importKey(e)).toBe(importKey(saved!.evidence)); saved = appendAttendeeObservation(saved!, id, review); return saved },
 }
 const deps: AttendeeImportDependencies = { source: async () => state, wallet: async () => wallet, store, guard: () => { if (guardFailure) throw Error('Account changed') } }
 const present = () => { const k = evidence.proof.request.recipient; listing = { totalOutputs: 1, outputs: [{ outpoint: `${f.record.txid}.0`, satoshis: 1, spendable: true, lockingScript: f.tx.outputs[0].lockingScript.toHex(), customInstructions: JSON.stringify({ type: 'PushDrop', protocolID: k.protocolID, keyID: k.keyID, counterparty: k.counterparty }) }] } }
 return { f, evidence, signal, state, wallet, deps, mutations, present, saved: () => saved,
  listing: (v: ListOutputsResult) => { listing = v }, identity: (v: string) => { identity = v }, network: (v: string) => { network = v }, failSave: () => { failSave = true }, changeAccount: () => { guardFailure = true } }
}

it('reviews a distinct attendee and imports only the exact reviewed mined ticket', async () => {
 const h = await setup(), r = await reviewAttendeeImport(h.signal.signal, h.deps)
 expect(r.wallet.state).toBe('absent'); expect(r.wallet.walletIdentity).toBe(h.f.identity)
 expect(r.wallet.walletIdentity).not.toBe(h.evidence.trustedVenue); expect(h.mutations).toEqual([])
 const result = await importAttendeeTicket(r, h.signal.signal, h.deps)
 expect(result.attempt.outcome).toBe('accepted'); expect(h.mutations).toHaveLength(1)
 const args = h.mutations[0]
 expect(Transaction.fromAtomicBEEF(args.tx).id('hex')).toBe(h.f.record.txid)
 expect(args.outputs).toEqual([{ outputIndex: 0, protocol: 'basket insertion', insertionRemittance: { basket: 'ticketsv-tickets', customInstructions: JSON.stringify({ protocolID: h.evidence.proof.request.recipient.protocolID, keyID: h.evidence.proof.request.recipient.keyID, counterparty: 'self', type: 'PushDrop' }) } }])
 await expect(importAttendeeTicket(r, h.signal.signal, h.deps)).rejects.toThrow(/attempt/i)
 expect(h.mutations).toHaveLength(1)
})
it('a matching output is present without importing; incomplete or contradictory listings are inconclusive', async () => {
 const h = await setup(); h.present()
 const r = await reviewAttendeeImport(h.signal.signal, h.deps); expect(r.wallet.state).toBe('present')
 await expect(importAttendeeTicket(r, h.signal.signal, h.deps)).rejects.toThrow(/absent/i)
 for (const listing of [{ totalOutputs: 1001, outputs: [] }, { totalOutputs: 1, outputs: [] }, { totalOutputs: 1, outputs: [{ outpoint: `${h.f.record.txid}.0`, satoshis: 1, spendable: false }] }]) {
  h.listing(listing); expect((await reviewAttendeeImport(h.signal.signal, h.deps)).wallet.state).toBe('inconclusive')
 }
 expect(h.mutations).toEqual([])
})
it('wrong attendee identity, network or derived key prevents wallet import', async () => {
 const h = await setup()
 h.identity(h.evidence.trustedVenue); await expect(reviewAttendeeImport(h.signal.signal, h.deps)).rejects.toThrow(/identity/i)
 h.identity(h.f.identity); h.network('mainnet'); await expect(reviewAttendeeImport(h.signal.signal, h.deps)).rejects.toThrow(/testnet/i)
 h.network('testnet'); const original = h.wallet.getPublicKey
 h.wallet.getPublicKey = async args => args.identityKey ? original(args) : { publicKey: h.evidence.trustedVenue }
 await expect(reviewAttendeeImport(h.signal.signal, h.deps)).rejects.toThrow(/receiving key/i); expect(h.mutations).toEqual([])
})
it('malformed unrelated wallet outputs cannot establish absence or authorize import', async () => {
 const h = await setup(), valid = { outpoint: `${'ab'.repeat(32)}.0`, satoshis: 1, spendable: true, lockingScript: '51' }
 for (const output of [
  { outpoint: valid.outpoint }, { ...valid, satoshis: -1 }, { ...valid, satoshis: 1.5 },
  { ...valid, spendable: undefined }, { ...valid, lockingScript: 'xyz' },
 ]) {
  h.listing({ totalOutputs: 1, outputs: [output] } as ListOutputsResult)
  const reviewed = await reviewAttendeeImport(h.signal.signal, h.deps)
  expect(reviewed.wallet.state).toBe('inconclusive')
  await expect(importAttendeeTicket(reviewed, h.signal.signal, h.deps)).rejects.toThrow()
 }
 expect(h.saved()).toBeUndefined(); expect(h.mutations).toEqual([])
})
it('missing headers, unmined or tampered evidence prevent review before wallet access', async () => {
 const h = await setup(false), clients = vi.spyOn(h.deps, 'wallet')
 await expect(reviewAttendeeImport(h.signal.signal, h.deps)).rejects.toThrow(/mining/i)
 h.state.snapshot = undefined; await expect(reviewAttendeeImport(h.signal.signal, h.deps)).rejects.toThrow(/verified/i)
 h.state.evidence.pkg.issuance.signatureBase64 = 'AAAA'; await expect(reviewAttendeeImport(h.signal.signal, h.deps)).rejects.toThrow()
 expect(clients).not.toHaveBeenCalled()
})
it('changed source or headers invalidate approval before claim', async () => {
 const h = await setup(), r = await reviewAttendeeImport(h.signal.signal, h.deps)
 h.state.snapshot = { id: 'bb'.repeat(32) } as HeaderSnapshot
 await expect(importAttendeeTicket(r, h.signal.signal, h.deps)).rejects.toThrow(/changed/i)
 expect(h.saved()).toBeUndefined(); expect(h.mutations).toEqual([])
})
it('a receiving-key or account change after claim blocks dispatch and retains the claim', async () => {
 for (const change of ['account', 'key']) {
  const h = await setup(), r = await reviewAttendeeImport(h.signal.signal, h.deps), claim = h.deps.store.claim
  h.deps.store.claim = async e => { const record = await claim(e); if (change === 'account') h.changeAccount(); else { const read = h.wallet.getPublicKey; h.wallet.getPublicKey = args => args.identityKey ? read(args) : Promise.resolve({ publicKey: h.evidence.trustedVenue }) }; return record }
  const result = await importAttendeeTicket(r, h.signal.signal, h.deps)
  expect(result.attempt.outcome).toBe('unknown'); expect(h.mutations).toEqual([])
 }
})
it('a lost response is unknown and reconciliation cannot authorize another import', async () => {
 const h = await setup(), r = await reviewAttendeeImport(h.signal.signal, h.deps)
 h.wallet.internalizeAction = async args => { h.mutations.push(args); h.present(); throw Error('Lost response') }
 const result = await importAttendeeTicket(r, h.signal.signal, h.deps); expect(result.attempt.outcome).toBe('unknown')
 const observed = await reconcileAttendeeImport(h.signal.signal, h.deps)
 expect(observed.attempt.outcome).toBe('unknown'); expect(observed.observations.at(-1)?.state).toBe('present')
 await expect(importAttendeeTicket(r, h.signal.signal, h.deps)).rejects.toThrow(); expect(h.mutations).toHaveLength(1)
})
it('accepted response and an absent observation remain separate', async () => {
 const h = await setup(), r = await reviewAttendeeImport(h.signal.signal, h.deps)
 await importAttendeeTicket(r, h.signal.signal, h.deps)
 const observed = await reconcileAttendeeImport(h.signal.signal, h.deps)
 expect(observed.attempt.outcome).toBe('accepted'); expect(observed.observations.at(-1)?.state).toBe('absent')
})
it('cancellation ignores late acceptance and never repeats the mutation', async () => {
 const h = await setup(), r = await reviewAttendeeImport(h.signal.signal, h.deps)
 let release!: (value: { accepted: true }) => void
 h.wallet.internalizeAction = args => { h.mutations.push(args); h.signal.abort(Error('Cancelled')); return new Promise(resolve => { release = resolve }) }
 const result = await importAttendeeTicket(r, h.signal.signal, h.deps)
 expect(result.attempt.outcome).toBe('unknown'); release({ accepted: true }); await Promise.resolve()
 expect(h.saved()!.attempt.outcome).toBe('unknown'); expect(h.mutations).toHaveLength(1)
})
it('failed receipt persistence leaves pending protection; two claims cannot import twice', async () => {
 const h = await setup(), r = await reviewAttendeeImport(h.signal.signal, h.deps); h.failSave()
 await expect(importAttendeeTicket(r, h.signal.signal, h.deps)).rejects.toThrow('Storage failed')
 expect(h.saved()!.attempt.outcome).toBe('pending')
 await expect(importAttendeeTicket(r, h.signal.signal, h.deps)).rejects.toThrow(); expect(h.mutations).toHaveLength(1)
 const concurrent = await setup(), reviewed = await reviewAttendeeImport(concurrent.signal.signal, concurrent.deps)
 await Promise.allSettled([importAttendeeTicket(reviewed, concurrent.signal.signal, concurrent.deps), importAttendeeTicket(reviewed, concurrent.signal.signal, concurrent.deps)])
 expect(concurrent.mutations).toHaveLength(1)
})
it('journal binds the account, transaction and source while allowing a new save timestamp', async () => {
 const h = await setup(), record = newAttendeeImport(h.evidence)
 expect(importFingerprint({ ...h.evidence, savedAt: new Date(Date.now() + 1000).toISOString() })).toBe(record.fingerprint)
 expect(importKey(h.evidence)).toContain(h.f.identity); expect(importKey(h.evidence)).toContain(h.f.record.txid)
 expect(() => readAttendeeImport({ ...record, fingerprint: '00'.repeat(32) })).toThrow()
 expect(() => finishAttendeeImport(record, 'another', 'accepted')).toThrow()
 expect(() => finishAttendeeImport(finishAttendeeImport(record, record.attempt.id, 'unknown'), record.attempt.id, 'accepted')).toThrow()
})
