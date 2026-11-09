// Developer-only experiment. Loaded on explicit preparation, never by product routes.
import { Beef, LockingScript, PushDrop, Signature, Transaction } from '@bsv/sdk'
import type { CreateActionResult, SignActionResult, WalletInterface, WalletProtocol } from '@bsv/sdk'

export const SIGNING_PROTOCOL: WalletProtocol = [2, 'counterfoil signing experiment']
export type FinalEvidence = { txid: string; atomicBeef: number[]; outputIndex: number }
export type SigningPreparation = {
  kind: 'counterfoil-signing-experiment'; network: 'testnet'; runId: string;
  identity: string; sourceKeyId: string; destinationKeyId: string;
  sourceScript: string; destinationScript: string; source: FinalEvidence; noSendChange: string[];
}
export class SigningError extends Error {}
function fail(message: string): never { throw new SigningError(message) }

async function identityOnTestnet(wallet: WalletInterface, expected?: string): Promise<string> {
  if ((await wallet.getNetwork({})).network !== 'testnet') fail('Select testnet before this experiment.')
  const identity = (await wallet.getPublicKey({ identityKey: true })).publicKey
  if (expected && identity !== expected) fail('The wallet identity changed. Restore the prepared wallet profile.')
  return identity
}
function readAtomic(bytes: number[] | Uint8Array | undefined, allowMinedSource = false): Transaction {
  if (!bytes?.length || bytes.length > 4 * 1024 * 1024) fail('Missing or oversized Atomic BEEF.')
  const beef = Beef.fromBinary(bytes!)
  if (!beef.atomicTxid || !beef.isAtomic() || !beef.isValid(false)) fail('Incomplete Atomic BEEF: full dependencies are required.')
  const tx = Transaction.fromAtomicBEEF(bytes!)
  if (tx.merklePath && !allowMinedSource) fail('Expected a newly created, unmined transaction.')
  return tx
}

// Desktop's intermediate signing envelope intentionally omits deeper ancestry
// and anchors. Require its raw immediate parents for signing, not a final proof.
// inspectFinal continues to require complete evidence before any export.
function readSigningDraft(bytes: number[] | Uint8Array): Transaction {
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) fail('Missing or oversized signing draft.')
  const tx = Transaction.fromAtomicBEEF(bytes)
  if (tx.merklePath) fail('Expected an unmined signing draft.')
  if (!tx.inputs.length || tx.inputs.some(input => {
    const parent = input.sourceTransaction
    return !parent || parent.id('hex') !== input.sourceTXID ||
      !Number.isSafeInteger(input.sourceOutputIndex) || input.sourceOutputIndex < 0 ||
      !parent.outputs[input.sourceOutputIndex]
  })) fail('The signing draft is missing a valid immediate source output.')
  return tx
}
function outputIndex(tx: Transaction, script: string): number {
  const matching = tx.outputs.flatMap((output, index) => output.lockingScript.toHex() === script ? [index] : [])
  if (matching.length !== 1 || tx.outputs[matching[0]!]!.satoshis !== 1) fail('The expected one-satoshi output was changed or duplicated.')
  return matching[0]!
}
function sourceIndex(tx: Transaction, source: FinalEvidence): number {
  const matching = tx.inputs.flatMap((input, index) =>
    (input.sourceTXID ?? input.sourceTransaction?.id('hex')) === source.txid && input.sourceOutputIndex === source.outputIndex ? [index] : [])
  if (matching.length !== 1) fail('The prepared input was changed or duplicated.')
  return matching[0]!
}
function intent(tx: Transaction): string {
  return JSON.stringify({ version: tx.version, lockTime: tx.lockTime,
    inputs: tx.inputs.map(input => [input.sourceTXID ?? input.sourceTransaction?.id('hex'), input.sourceOutputIndex, input.sequence ?? 0xffffffff]),
    outputs: tx.outputs.map(output => [output.satoshis, output.lockingScript.toHex()]),
  })
}
export async function inspectFinal(result: CreateActionResult | SignActionResult, script: string): Promise<FinalEvidence> {
  return inspectEvidence(result, script, false)
}
// An existing source may be mined. This is only a structure/script check;
// the durable preparation separately validates its proof against local headers.
export async function inspectSource(result: CreateActionResult | SignActionResult, script: string): Promise<FinalEvidence> {
  return inspectEvidence(result, script, true)
}
async function inspectEvidence(result: CreateActionResult | SignActionResult, script: string, allowMinedSource: boolean): Promise<FinalEvidence> {
  if ('signableTransaction' in result || !result.tx || !result.txid) fail('The wallet did not return a final signed transaction.')
  const tx = readAtomic(result.tx, allowMinedSource)
  if (tx.id('hex') !== result.txid) fail('The returned txid does not match the transaction.')
  const index = outputIndex(tx, script)
  if (tx.inputs.some(input => !input.unlockingScript?.toHex())) fail('The final transaction has unsigned inputs.')
  // Deliberately no default tracker: this checks scripts, NOT chain anchors/SPV.
  if (!await tx.verify('scripts only')) fail('Local transaction script verification failed.')
  return { txid: result.txid!, atomicBeef: [...result.tx!], outputIndex: index }
}

// Restores this diagnostic's own export, not arbitrary tickets or wallet state.
// All wallet calls here are read-only; availability is checked again online.
export async function restorePreparation(wallet: WalletInterface, text: string): Promise<SigningPreparation> {
  if (text.length > 4 * 1024 * 1024) fail('Saved preparation exceeds the size limit.')
  let p: SigningPreparation
  try { p = JSON.parse(text) as SigningPreparation } catch { fail('Invalid preparation JSON.') }
  const hex = (value: unknown): value is string => typeof value === 'string' && value.length <= 8192 && /^(?:[0-9a-f]{2})+$/.test(value)
  if (!p || p.kind !== 'counterfoil-signing-experiment' || p.network !== 'testnet' ||
    typeof p.runId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(p.runId) ||
    p.sourceKeyId !== `${p.runId}-source` || p.destinationKeyId !== `${p.runId}-destination` ||
    typeof p.identity !== 'string' || !/^(02|03)[0-9a-f]{64}$/.test(p.identity) ||
    !hex(p.sourceScript) || !hex(p.destinationScript) || !p.source ||
    typeof p.source.txid !== 'string' || !/^[0-9a-f]{64}$/.test(p.source.txid) ||
    !Number.isSafeInteger(p.source.outputIndex) || p.source.outputIndex < 0 ||
    !Array.isArray(p.source.atomicBeef) || !p.source.atomicBeef.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255) ||
    !Array.isArray(p.noSendChange) || p.noSendChange.length > 100) fail('Invalid saved signing preparation.')
  const source = await inspectFinal({ tx: p.source.atomicBeef, txid: p.source.txid }, p.sourceScript)
  if (source.outputIndex !== p.source.outputIndex) fail('Saved preparation output index does not match.')
  const tx = Transaction.fromAtomicBEEF(source.atomicBeef)
  for (const outpoint of p.noSendChange) {
    if (typeof outpoint !== 'string' || !/^[0-9a-f]{64}\.(0|[1-9][0-9]*)$/.test(outpoint)) fail('Invalid preparation change outpoint.')
    const [txid, index] = outpoint.split('.')
    if (txid !== source.txid || Number(index) === source.outputIndex || !Number.isSafeInteger(Number(index)) || !tx.outputs[Number(index)]) fail('Invalid preparation change outpoint.')
  }
  await identityOnTestnet(wallet, p.identity)
  const expectedFields = ['counterfoil-signing-experiment', p.runId].map(value => Array.from(new TextEncoder().encode(value)))
  for (const [script, keyId] of [[p.sourceScript, p.sourceKeyId], [p.destinationScript, p.destinationKeyId]]) {
    const decoded = PushDrop.decode(LockingScript.fromHex(script!))
    if (decoded.fields.length !== 3 || JSON.stringify(decoded.fields.slice(0, 2)) !== JSON.stringify(expectedFields) ||
      !Signature.fromDER(decoded.fields[2]!).verify(expectedFields.flat(), decoded.lockingPublicKey)) fail('Saved preparation script metadata or signature does not match.')
    const expected = await new PushDrop(wallet).lock(decoded.fields, SIGNING_PROTOCOL, keyId!, 'self', true, false)
    if (expected.toHex() !== script) fail('Saved preparation script is not locked to the expected wallet key.')
  }
  const outputs = await wallet.listOutputs({ basket: 'counterfoil-signing-experiment', limit: 1000 })
  if (!outputs.outputs.some(output => output.outpoint === `${source.txid}.${source.outputIndex}` && output.spendable === true)) {
    fail('The prepared output is not listed as spendable. Resolve pending wallet actions before retrying.')
  }
  await identityOnTestnet(wallet, p.identity)
  return { kind: p.kind, network: p.network, runId: p.runId, identity: p.identity, sourceKeyId: p.sourceKeyId,
    destinationKeyId: p.destinationKeyId, sourceScript: p.sourceScript, destinationScript: p.destinationScript, source, noSendChange: [...p.noSendChange] }
}
export async function prepareSigning(wallet: WalletInterface, runId: string, onReference: (value: string) => void = () => {}): Promise<SigningPreparation> {
  const identity = await identityOnTestnet(wallet)
  const sourceKeyId = `${runId}-source`
  const destinationKeyId = `${runId}-destination`
  const fields = () => [Array.from(new TextEncoder().encode('counterfoil-signing-experiment')), Array.from(new TextEncoder().encode(runId))]
  const template = new PushDrop(wallet)
  const sourceScript = (await template.lock(fields(), SIGNING_PROTOCOL, sourceKeyId, 'self', true, true)).toHex()
  const destinationScript = (await template.lock(fields(), SIGNING_PROTOCOL, destinationKeyId, 'self', true, true)).toHex()
  await identityOnTestnet(wallet, identity)
  const response = await wallet.createAction({
    description: 'Prepare Counterfoil signing experiment',
    outputs: [{ lockingScript: sourceScript, satoshis: 1, outputDescription: 'Self-owned signing test token',
      basket: 'counterfoil-signing-experiment', customInstructions: JSON.stringify({ protocolID: SIGNING_PROTOCOL, keyID: sourceKeyId, counterparty: 'self', type: 'PushDrop' }) }],
    options: { noSend: true, returnTXIDOnly: false, randomizeOutputs: false },
  })
  const reference = response.signableTransaction?.reference ?? response.txid
  if (reference) onReference(reference)
  const source = await inspectFinal(response, sourceScript)
  return { kind: 'counterfoil-signing-experiment', network: 'testnet', runId, identity, sourceKeyId, destinationKeyId,
    sourceScript, destinationScript, source, noSendChange: response.noSendChange ?? [] }
}
export async function transferSigning(wallet: WalletInterface, prepared: SigningPreparation, onReference: (value: string) => void = () => {}): Promise<FinalEvidence> {
  await identityOnTestnet(wallet, prepared.identity)
  const parent = await inspectFinal({ tx: prepared.source.atomicBeef, txid: prepared.source.txid }, prepared.sourceScript)
  if (parent.outputIndex !== prepared.source.outputIndex) fail('The prepared output index changed.')
  const response = await wallet.createAction({
    description: 'Transfer Counterfoil signing test token', inputBEEF: prepared.source.atomicBeef,
    inputs: [{ outpoint: `${parent.txid}.${parent.outputIndex}`, inputDescription: 'Prepared self-owned test token', unlockingScriptLength: 73 }],
    outputs: [{ lockingScript: prepared.destinationScript, satoshis: 1, outputDescription: 'Self-owned successor test token', basket: 'counterfoil-signing-experiment',
      customInstructions: JSON.stringify({ protocolID: SIGNING_PROTOCOL, keyID: prepared.destinationKeyId, counterparty: 'self', type: 'PushDrop' }) }],
    options: { noSend: true, signAndProcess: false, returnTXIDOnly: false, randomizeOutputs: false, noSendChange: prepared.noSendChange },
  })
  const signable = response.signableTransaction
  if (!signable?.reference) fail('The wallet did not return a signable transaction and reference.')
  onReference(signable.reference)
  const draft = readSigningDraft(signable.tx)
  outputIndex(draft, prepared.destinationScript)
  const index = sourceIndex(draft, parent)
  const expected = intent(draft)
  await identityOnTestnet(wallet, prepared.identity)
  const unlock = await new PushDrop(wallet).unlock(SIGNING_PROTOCOL, prepared.sourceKeyId, 'self', 'all', false).sign(draft, index)
  const final = await wallet.signAction({ reference: signable.reference, spends: { [index]: { unlockingScript: unlock.toHex() } }, options: { noSend: true, returnTXIDOnly: false } })
  const result = await inspectFinal(final, prepared.destinationScript)
  if (intent(Transaction.fromAtomicBEEF(result.atomicBeef)) !== expected) fail('The final transaction differs from the approved signing template.')
  return result
}

// Shared draft/intent checks; these do not contact the wallet.
export { readSigningDraft, intent as transactionIntent }
