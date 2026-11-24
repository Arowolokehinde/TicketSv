import { LockingScript, MerklePath, PrivateKey, ProtoWallet, Transaction, UnlockingScript, Utils, type WalletInterface } from '@bsv/sdk'
import { attendeeOfflineFixture } from './attendee-offline-fixture.ts'
import { attendeeEvidence } from '../../src/offline/attendee-evidence.ts'
import { fromAttendee, invitationFor, readHandoffTicket } from '../../src/handoff/evidence.ts'
import { readSender, sourceKey } from '../../src/handoff/store.ts'
import { createReceivingRequest, fundHandoff, fundingCandidate, reviewFunding, signHandoff } from '../../src/handoff/wallet.ts'
import { newSettlement } from '../../src/handoff/settlement.ts'
import type { RecordStore, SenderRecord } from '../../src/handoff/types.ts'
import type { HeaderSnapshot } from '../../src/headers/validate.ts'

// Callers mock the local header tracker and mining-anchor boundary, as the
// sender wallet tests do; signatures, BEEF and scripts stay real.
export const releaseSnapshot = {
  version: 1,
  network: 'testnet',
  syncedAt: new Date().toISOString(),
  id: 'synthetic-local-headers',
  headers: [{ height: 1762500, hash: '22'.repeat(32), hex: '00'.repeat(80) }],
} as HeaderSnapshot
export function walletFor(key: number): WalletInterface {
  const wallet = new ProtoWallet(new PrivateKey(key)) as WalletInterface
  wallet.getNetwork = async () => ({ network: 'testnet' })
  return wallet
}
export function memory<T extends { id: string; revision: number }>(
  validator: (value: unknown, previous?: T) => T,
  initial?: T,
): RecordStore<T> & { value: (id: string) => T | undefined } {
  const rows = new Map<string, T>()
  if (initial) rows.set(initial.id, validator(initial))
  return {
    load: async id => structuredClone(rows.get(id)),
    list: async () => [...rows.values()].map(r => structuredClone(r)),
    remove: async () => {},
    value: id => rows.get(id),
    save: async (next, expected) => {
      const old = rows.get(next.id)
      if (old?.revision !== expected) throw Error('Revision conflict')
      rows.set(next.id, validator(next, old))
    },
  }
}
const signal = () => new AbortController().signal
const minedProof = (txid: string, height: number) =>
  new MerklePath(height, [
    [
      { offset: 1, hash: txid, txid: true },
      { offset: 0, hash: '11'.repeat(32) },
    ],
  ])
// A funded, fee-mined sender record and an independent receiving request, ready to sign.
export async function fundedForSigning() {
  const f = await attendeeOfflineFixture(),
    ticket = fromAttendee(attendeeEvidence(f.record, f.identity, 'http://127.0.0.1:4175')),
    wallet = walletFor(2),
    key = ticket.pkg.request.recipient
  wallet.listOutputs = async () => ({
    totalOutputs: 1,
    outputs: [
      {
        outpoint: `${ticket.pkg.current.txid}.0`,
        satoshis: 1,
        lockingScript: f.tx.outputs[0].lockingScript.toHex(),
        spendable: true,
        customInstructions: JSON.stringify({
          protocolID: key.protocolID,
          keyID: key.keyID,
          counterparty: key.counterparty,
          type: 'PushDrop',
        }),
        tags: [],
        labels: [],
      },
    ],
  })
  const record: SenderRecord = { kind: 'ticketsv-handoff-sender', version: 1, id: sourceKey(ticket), revision: 0, ticket },
    store = memory(readSender, record)
  const review = await reviewFunding(ticket, { maxTxBytes: 100000, feeSatoshis: 1, feeBytes: 1000 }, wallet, signal(), releaseSnapshot)
  wallet.createAction = async args => {
    const parent = new Transaction(1, [], [{ satoshis: 10000, lockingScript: LockingScript.fromASM('OP_TRUE') }])
    parent.merklePath = minedProof(parent.id('hex'), 1762324)
    const tx = new Transaction(
      1,
      [{ sourceTransaction: parent, sourceOutputIndex: 0, unlockingScript: new UnlockingScript() }],
      args.outputs!.map(o => ({ satoshis: o.satoshis, lockingScript: LockingScript.fromHex(o.lockingScript) })),
    )
    return { txid: tx.id('hex'), tx: tx.toAtomicBEEF() }
  }
  const funded = await fundHandoff(record, review, wallet, signal(), store),
    funding = funded.funding!
  const observation = {
    txid: funding.txid!,
    txStatus: 'MINED' as const,
    observedAt: new Date().toISOString(),
    blockHeight: 1762325,
    blockHash: '22'.repeat(32),
    merklePath: minedProof(funding.txid!, 1762325).toHex(),
  }
  const ready: SenderRecord = { ...funded, revision: funded.revision + 1, funding: fundingCandidate(funding, observation) }
  await store.save(ready, funded.revision)
  // Funding is complete; transfer signing tests install their own action methods.
  delete (wallet as Partial<WalletInterface>).createAction
  const request = await createReceivingRequest(walletFor(3), invitationFor(ticket), signal())
  return { ticket, ready, request, wallet, store, funded }
}
export async function senderReleaseFixture() {
  const { ticket, ready, request, wallet, store, funded } = await fundedForSigning(),
    funding = ready.funding!
  const signed = await signHandoff(ready, request, wallet, releaseSnapshot, signal(), store)
  if (!signed.transfer) throw Error('Fixture signing failed.')
  const tx = Transaction.fromAtomicBEEF(Utils.toArray(signed.transfer.pkg.atomicBeefBase64, 'base64'))
  tx.merklePath = minedProof(tx.id('hex'), 1762326)
  const mined = readHandoffTicket({
    ...signed.transfer,
    pkg: { ...signed.transfer.pkg, atomicBeefBase64: Utils.toBase64(tx.toAtomicBEEF()) },
  })
  return {
    signed,
    funded,
    wallet,
    settlement: newSettlement(mined),
    unminedSettlement: newSettlement(signed.transfer),
    ticketOutpoint: `${ticket.pkg.current.txid}.${ticket.pkg.current.index}`,
    feeOutpoint: `${funding.txid}.${funding.index}`,
  }
}
