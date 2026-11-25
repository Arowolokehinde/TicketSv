import { KeyDeriver, Transaction, Utils, type WalletInterface } from '@bsv/sdk'
import { identifier, publicKey, readReceiveRequest, readTicketPackage } from '../tickets/codec.ts'
import { ISSUER_PROTOCOL, RECEIVE_PROTOCOL, type ReceiveRequest, type TicketPackage } from '../tickets/types.ts'
import { issuanceBytes, ticketScript } from '../tickets/script.ts'
import { verifyIssuer, verifyContinuity, verifyRecipient } from '../verification/authenticity.ts'
import { verifyRequestProof } from '../marketplace/request-proof.ts'
import type { RequestProof } from '../marketplace/types.ts'
import { inspectFinal, type FinalEvidence } from './signing-experiment.ts'
import { checkWallet } from './identity.ts'

type Reader = Pick<WalletInterface, 'getNetwork' | 'getPublicKey'>
export async function checkVenueWallet(wallet: Reader, owner: string): Promise<void> {
  await checkWallet(wallet, {
    identity: () => publicKey(owner),
    messages: { network: 'Select testnet before issuing a ticket.', identity: 'The wallet identity differs from your signed-in account.' },
  })
}
export async function prepareVenueRecipient(wallet: Reader, owner: string, ticketId: string): Promise<ReceiveRequest> {
  await checkVenueWallet(wallet, owner)
  const requestId = `${identifier(ticketId)}-source`
  const key = (await wallet.getPublicKey({ protocolID: RECEIVE_PROTOCOL, keyID: requestId, counterparty: 'self', forSelf: true })).publicKey
  await checkVenueWallet(wallet, owner)
  return readReceiveRequest(
    JSON.stringify({
      kind: 'ticket-request',
      version: 1,
      network: 'testnet',
      requestId,
      recipient: { publicKey: key, protocolID: RECEIVE_PROTOCOL, keyID: requestId, counterparty: 'self' },
    }),
  )
}
// Read-only: finds the live wallet transaction an issuance attempt created, if
// any. Failed actions never reach the chain, so they count as absent.
async function issuanceActions(wallet: Reader & Pick<WalletInterface, 'listActions'>, owner: string, ticketId: string) {
  identifier(ticketId)
  await checkVenueWallet(wallet, owner)
  const listed = await wallet.listActions({ labels: [`ticketsv-issuance-${ticketId}`], labelQueryMode: 'any', limit: 100 })
  if (!Array.isArray(listed.actions) || listed.totalActions !== listed.actions.length)
    throw Error('The wallet returned an incomplete transaction list. Do not issue again; check the wallet history.')
  return listed.actions
}
export async function findIssuanceAction(
  wallet: Reader & Pick<WalletInterface, 'listActions'>,
  owner: string,
  ticketId: string,
): Promise<string | undefined> {
  const live = (await issuanceActions(wallet, owner, ticketId)).filter(action => action.status !== 'failed')
  if (live.length > 1) throw Error('Several wallet transactions carry this ticket label. Do not issue again; check the wallet history.')
  if (live.length && !/^[a-f0-9]{64}$/.test(live[0].txid))
    throw Error('The wallet returned an invalid transaction ID. Do not issue again; check the wallet history.')
  return live[0]?.txid
}
// Read-only. True only when the wallet reports this saved transaction as failed
// and holds no live one for the ticket: it can never be mined, so any signed copy
// names an output that never exists and the attempt may return to approval.
export async function issuanceActionFailed(
  wallet: Reader & Pick<WalletInterface, 'listActions'>,
  owner: string,
  ticketId: string,
  txid: string,
): Promise<boolean> {
  const actions = await issuanceActions(wallet, owner, ticketId)
  return actions.some(action => action.txid === txid && action.status === 'failed') && actions.every(action => action.status === 'failed')
}
export async function issueVenueTicket(
  wallet: WalletInterface,
  owner: string,
  eventId: string,
  ticketId: string,
  request: ReceiveRequest,
  checkpoint: (txid: string) => Promise<void>,
): Promise<TicketPackage> {
  identifier(eventId)
  identifier(ticketId)
  const recipient = await prepareVenueRecipient(wallet, owner, ticketId)
  if (JSON.stringify(recipient) !== JSON.stringify(readReceiveRequest(JSON.stringify(request))))
    throw Error('The reviewed receiving key changed.')
  return issueToRecipient(wallet, owner, eventId, ticketId, recipient, checkpoint, true)
}
export async function issueAttendeeTicket(
  wallet: WalletInterface,
  owner: string,
  eventId: string,
  ticketId: string,
  proof: RequestProof,
  checkpoint: (txid: string) => Promise<void>,
): Promise<TicketPackage> {
  identifier(ticketId)
  const checked = verifyRequestProof(proof, {
    eventId,
    venue: owner,
    attendee: proof.attendee,
    origin: proof.origin,
    revision: proof.revision,
  })
  return issueToRecipient(wallet, owner, eventId, ticketId, checked.request, checkpoint, false)
}
async function issueToRecipient(
  wallet: WalletInterface,
  owner: string,
  eventId: string,
  ticketId: string,
  recipient: ReceiveRequest,
  checkpoint: (txid: string) => Promise<void>,
  ownRecipient: boolean,
): Promise<TicketPackage> {
  const script = ticketScript(eventId, ticketId, null, recipient).toHex()
  await checkVenueWallet(wallet, owner)
  const response = await wallet.createAction({
    description: 'Issue TicketSV event ticket',
    labels: [`ticketsv-issuance-${ticketId}`],
    outputs: [
      {
        lockingScript: script,
        satoshis: 1,
        outputDescription: ownRecipient ? 'TicketSV event ticket for connected wallet' : 'TicketSV event ticket for attendee',
        ...(ownRecipient
          ? {
              basket: 'counterfoil-ticket-experiment',
              customInstructions: JSON.stringify({
                protocolID: RECEIVE_PROTOCOL,
                keyID: recipient.requestId,
                counterparty: 'self',
                type: 'PushDrop',
              }),
            }
          : {}),
      },
    ],
    options: { noSend: false, acceptDelayedBroadcast: false, returnTXIDOnly: false, randomizeOutputs: false },
  })
  // Persist the returned ID before any more signatures. Never repeat creation.
  if (response.txid && /^[a-f0-9]{64}$/.test(response.txid)) await checkpoint(response.txid)
  const final = await inspectFinal(response, script)
  if (!response.txid) await checkpoint(final.txid)
  return signIssuance(wallet, owner, eventId, ticketId, recipient, final)
}
// Completes an attempt whose transaction ID is saved but whose evidence is not,
// from that transaction rebuilt from the chain. No transaction is created. The
// wallet signs deterministically, so the package equals any copy that was lost.
export async function recoverVenueTicket(
  wallet: WalletInterface,
  owner: string,
  eventId: string,
  ticketId: string,
  request: ReceiveRequest,
  txid: string,
  atomicBeef: number[],
): Promise<TicketPackage> {
  identifier(eventId)
  identifier(ticketId)
  const recipient = readReceiveRequest(JSON.stringify(request))
  await checkVenueWallet(wallet, owner)
  const final = await inspectFinal({ txid, tx: atomicBeef }, ticketScript(eventId, ticketId, null, recipient).toHex())
  return signIssuance(wallet, owner, eventId, ticketId, recipient, final)
}
async function signIssuance(
  wallet: WalletInterface,
  owner: string,
  eventId: string,
  ticketId: string,
  recipient: ReceiveRequest,
  final: FinalEvidence,
): Promise<TicketPackage> {
  const origin = { txid: final.txid, index: final.outputIndex },
    keyID = `${origin.txid}.${origin.index}`
  await checkVenueWallet(wallet, owner)
  const data = issuanceBytes(eventId, ticketId, origin)
  const { signature } = await wallet.createSignature({ protocolID: ISSUER_PROTOCOL, keyID, counterparty: 'anyone', data })
  await checkVenueWallet(wallet, owner)
  const pkg = readTicketPackage(
    JSON.stringify({
      kind: 'ticket-package',
      version: 1,
      network: 'testnet',
      issuance: {
        eventId,
        ticketId,
        origin,
        issuerIdentity: owner,
        signedBytesBase64: Utils.toBase64(data),
        signatureBase64: Utils.toBase64(signature),
        signingKey: {
          publicKey: new KeyDeriver('anyone').derivePublicKey(ISSUER_PROTOCOL, keyID, owner).toString(),
          protocolID: ISSUER_PROTOCOL,
          keyID,
          counterparty: 'anyone',
        },
      },
      current: origin,
      request: recipient,
      lineageRawTxs: [Transaction.fromAtomicBEEF(final.atomicBeef).toHex()],
      atomicBeefBase64: Utils.toBase64(final.atomicBeef),
    }),
  )
  verifyIssuer(pkg, owner)
  verifyContinuity(pkg)
  verifyRecipient(pkg, recipient)
  return pkg
}
