import { Beef, KeyDeriver, Transaction, Utils } from '@bsv/sdk'
import { readTicketPackage, fromBase64 } from '../tickets/codec.ts'
import { ISSUER_PROTOCOL, RECEIVE_PROTOCOL, type TicketPackage } from '../tickets/types.ts'
import { decodeTicket, issuanceBytes } from '../tickets/script.ts'
import { readAttendeeEvidence, type AttendeeEvidence } from '../offline/attendee-evidence.ts'
import { readHandoffTicket } from './evidence.ts'
import type { HandoffTicket } from './types.ts'
import { encodeBinary, decodeBinary, type BinaryValue } from './compact-binary.ts'
const eventKeys = ['name', 'date', 'time', 'timezone', 'venue', 'address', 'description'] as const
const hex = (bytes: Uint8Array) => Utils.toHex(Array.from(bytes)),
  b64 = (bytes: Uint8Array) => Utils.toBase64(Array.from(bytes))
const bytesHex = (text: string) => new Uint8Array(Utils.toArray(text, 'hex')),
  bytes64 = (text: string) => new Uint8Array(fromBase64(text))
function row(v: BinaryValue, length?: number): BinaryValue[] {
  if (!Array.isArray(v) || (length !== undefined && v.length !== length)) throw Error('Invalid compact row.')
  return v
}
function binary(v: BinaryValue): Uint8Array {
  if (!(v instanceof Uint8Array)) throw Error('Invalid compact bytes.')
  return v
}
function text(v: BinaryValue): string {
  if (typeof v !== 'string') throw Error('Invalid compact text.')
  return v
}
function integer(v: BinaryValue): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > 0xffffffff) throw Error('Invalid compact integer.')
  return v
}
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map(k => [k, x[k]]),
        )
      : x,
  )
}
function graph(bytes: Uint8Array) {
  const beef = Beef.fromBinaryStrict(bytes)
  if (!beef.isAtomic() || beef.txs.length > 128 || !beef.isValid(false)) throw Error('Invalid compact BEEF.')
  const root = Transaction.fromAtomicBEEF(Array.from(bytes)),
    map = new Map<string, Transaction>()
  function visit(tx: Transaction) {
    const id = tx.id('hex')
    if (map.has(id)) return
    if (map.size >= 128) throw Error('Too many compact transactions.')
    map.set(id, tx)
    for (const input of tx.inputs) if (input.sourceTransaction) visit(input.sourceTransaction)
  }
  visit(root)
  return { root, map }
}
function packBase(pkg: TicketPackage): BinaryValue[] {
  const { map } = graph(bytes64(pkg.atomicBeefBase64))
  return [
    bytes64(pkg.atomicBeefBase64),
    bytesHex(pkg.issuance.issuerIdentity),
    bytes64(pkg.issuance.signatureBase64),
    pkg.current.index,
    pkg.issuance.origin.index,
    pkg.lineageRawTxs.map(raw => {
      const id = Transaction.fromHex(raw).id('hex')
      return bytesHex(map.has(id) ? id : raw)
    }),
  ]
}
function requestFor(d: NonNullable<ReturnType<typeof decodeTicket>>): TicketPackage['request'] {
  return {
    kind: 'ticket-request',
    version: 1,
    network: 'testnet',
    requestId: d.requestId,
    recipient: { publicKey: d.publicKey, protocolID: RECEIVE_PROTOCOL, keyID: d.requestId, counterparty: 'self' },
  }
}
function restoreBase(value: BinaryValue) {
  const a = row(value, 6),
    beef = binary(a[0]),
    { root, map } = graph(beef),
    index = integer(a[3]),
    originIndex = integer(a[4]),
    lines = row(a[5])
  if (!lines.length || lines.length > 101) throw Error('Invalid compact lineage.')
  let lineageSize = 0
  const lineage = lines.map(v => {
    const b = binary(v)
    if (b.length === 32) {
      const tx = map.get(hex(b))
      if (!tx) throw Error('Missing compact transaction.')
      const raw = tx.toHex()
      lineageSize += raw.length
      if (lineageSize > 4 * 1024 * 1024) throw Error('Compact lineage exceeds size limit.')
      return raw
    }
    lineageSize += b.length * 2
    if (lineageSize > 4 * 1024 * 1024) throw Error('Compact lineage exceeds size limit.')
    const tx = Transaction.fromHex(hex(b))
    map.set(tx.id('hex'), tx)
    return tx.toHex()
  })
  const details = root.outputs[index] && decodeTicket(root.outputs[index].lockingScript)
  if (!details) throw Error('Missing compact ticket output.')
  const first = map.get(details.origin?.txid ?? root.id('hex'))
  if (!first) throw Error('Missing original transaction.')
  const firstDetails = first.outputs[originIndex] && decodeTicket(first.outputs[originIndex].lockingScript)
  if (!firstDetails) throw Error('Missing original ticket output.')
  const origin = { txid: first.id('hex'), index: originIndex },
    issuerIdentity = hex(binary(a[1])),
    keyID = `${origin.txid}.${origin.index}`
  const pkg = readTicketPackage(
    JSON.stringify({
      kind: 'ticket-package',
      version: 1,
      network: 'testnet',
      issuance: {
        eventId: details.eventId,
        ticketId: details.ticketId,
        origin,
        issuerIdentity,
        signedBytesBase64: Utils.toBase64(issuanceBytes(details.eventId, details.ticketId, origin)),
        signatureBase64: b64(binary(a[2])),
        signingKey: {
          publicKey: new KeyDeriver('anyone').derivePublicKey(ISSUER_PROTOCOL, keyID, issuerIdentity).toString(),
          protocolID: ISSUER_PROTOCOL,
          keyID,
          counterparty: 'anyone',
        },
      },
      current: { txid: root.id('hex'), index },
      request: requestFor(details),
      lineageRawTxs: lineage,
      atomicBeefBase64: b64(beef),
    }),
  )
  return { pkg, root, first, firstRequest: requestFor(firstDetails) }
}
function eventRow(event: AttendeeEvidence['event']): BinaryValue[] {
  return eventKeys.map(k => event[k])
}
function restoreEvent(value: BinaryValue): AttendeeEvidence['event'] {
  const a = row(value, 7)
  return Object.fromEntries(eventKeys.map((k, i) => [k, text(a[i])])) as AttendeeEvidence['event']
}
function priorRow(e: AttendeeEvidence, base: ReturnType<typeof restoreBase>): BinaryValue[] {
  let canonical: string | undefined
  try {
    canonical = Utils.toBase64(base.first.toAtomicBEEF())
  } catch {
    /* An older mined origin can be absent from the current BEEF. */
  }
  return [
    e.savedAt,
    e.eventRevision,
    bytesHex(e.attendee),
    bytes64(e.proof.signature),
    canonical === e.pkg.atomicBeefBase64 ? null : bytes64(e.pkg.atomicBeefBase64),
  ]
}
function restorePrior(
  value: BinaryValue,
  base: ReturnType<typeof restoreBase>,
  event: AttendeeEvidence['event'],
  origin: string,
): AttendeeEvidence {
  const a = row(value, 5),
    attendee = hex(binary(a[2])),
    revision = integer(a[1]),
    { pkg, first, firstRequest } = base,
    eventId = pkg.issuance.eventId,
    trustedVenue = pkg.issuance.issuerIdentity
  const originalPkg = {
    ...pkg,
    current: pkg.issuance.origin,
    request: firstRequest,
    lineageRawTxs: [first.toHex()],
    atomicBeefBase64: a[4] === null ? Utils.toBase64(first.toAtomicBEEF()) : b64(binary(a[4])),
  }
  return readAttendeeEvidence(
    {
      kind: 'ticketsv-attendee-offline',
      version: 1,
      id: pkg.issuance.ticketId,
      attendee,
      origin,
      eventId,
      eventRevision: revision,
      event,
      trustedVenue,
      proof: { origin, eventId, revision, venue: trustedVenue, attendee, request: firstRequest, signature: b64(binary(a[3])) },
      pkg: originalPkg,
      savedAt: text(a[0]),
    },
    origin,
  )
}
function restore(value: BinaryValue): TicketPackage | HandoffTicket | AttendeeEvidence {
  const a = row(value),
    kind = integer(a[0])
  if (kind === 0) {
    row(a, 2)
    return restoreBase(a[1]).pkg
  }
  if (kind === 2) {
    row(a, 5)
    return restorePrior(a[4], restoreBase(a[1]), restoreEvent(a[2]), text(a[3]))
  }
  if (kind !== 1) throw Error('Unknown compact ticket kind.')
  row(a, 7)
  const base = restoreBase(a[1]),
    event = restoreEvent(a[2]),
    origin = text(a[3]),
    savedAt = text(a[4]),
    trustedVenue = base.pkg.issuance.issuerIdentity
  const original = a[6] === null ? undefined : restorePrior(a[6], base, event, origin)
  let request: HandoffTicket['request'] = null,
    holder = original?.attendee
  if (a[5] !== null) {
    const r = row(a[5], 4),
      previous = base.pkg.lineageRawTxs.at(-2)
    if (!previous) throw Error('Missing compact predecessor.')
    const tx = Transaction.fromHex(previous),
      input = base.root.inputs.find(i => (i.sourceTXID ?? i.sourceTransaction?.id('hex')) === tx.id('hex'))
    if (!input) throw Error('Missing compact input.')
    holder = hex(binary(r[0]))
    request = {
      kind: 'ticketsv-handoff-request',
      version: 1,
      invitation: {
        kind: 'ticketsv-handoff-invitation',
        version: 1,
        network: 'testnet',
        origin,
        eventId: base.pkg.issuance.eventId,
        ticketId: base.pkg.issuance.ticketId,
        source: { txid: tx.id('hex'), index: input.sourceOutputIndex },
        trustedVenue,
        event,
        ...(r[3] === null ? {} : { requiredHeight: integer(r[3]) }),
      },
      recipientIdentity: holder,
      request: base.pkg.request,
      keySignature: b64(binary(r[1])),
      identitySignature: b64(binary(r[2])),
    }
  }
  return readHandoffTicket({
    kind: 'ticketsv-handoff-ticket',
    version: 1,
    origin,
    holder,
    trustedVenue,
    event,
    pkg: base.pkg,
    request,
    savedAt,
    ...(original ? { issuanceEvidence: original } : {}),
  })
}
export function unpackCompactTicket(bytes: Uint8Array) {
  return restore(decodeBinary(bytes))
}
export function packCompactTicket(value: unknown): Uint8Array | null {
  try {
    const v = value as { kind?: string }
    let packed: BinaryValue
    if (v?.kind === 'ticket-package') {
      const pkg = readTicketPackage(JSON.stringify(v))
      packed = [0, packBase(pkg)]
    } else if (v?.kind === 'ticketsv-attendee-offline') {
      const e = readAttendeeEvidence(v, (v as AttendeeEvidence).origin),
        base = packBase(e.pkg)
      packed = [2, base, eventRow(e.event), e.origin, priorRow(e, restoreBase(base))]
    } else if (v?.kind === 'ticketsv-handoff-ticket') {
      const t = readHandoffTicket(v),
        base = packBase(t.pkg)
      packed = [
        1,
        base,
        eventRow(t.event),
        t.origin,
        t.savedAt,
        t.request
          ? [
              bytesHex(t.request.recipientIdentity),
              bytes64(t.request.keySignature),
              bytes64(t.request.identitySignature),
              t.request.invitation.requiredHeight ?? null,
            ]
          : null,
        t.issuanceEvidence ? priorRow(t.issuanceEvidence, restoreBase(base)) : null,
      ]
    } else return null
    const bytes = encodeBinary(packed)
    // Only use this representation when every original data field is recoverable.
    // Noncanonical variants and future extensions retain the generic transport.
    return stable(value) === stable(unpackCompactTicket(bytes)) ? bytes : null
  } catch {
    return null
  }
}
