import { useEffect, useState } from 'react'
import type { WalletInterface } from '@bsv/sdk'
import type { HandoffSettlement } from '../handoff/settlement.ts'
import type { SenderRecord } from '../handoff/types.ts'
import { sourceKey } from '../handoff/store.ts'
import { loadSnapshot } from '../headers/store.ts'
import {
  checkSpentOutputs,
  recheckRelease,
  releaseEligibility,
  releaseSpentOutputs,
  senderForSettlement,
  senderReleaseStore,
  type ReleaseObservation,
  type SenderRelease as Release,
} from '../handoff/release.ts'

type Props = {
  settlement: HandoffSettlement
  senders: SenderRecord[]
  busy: boolean
  run: (action: (signal: AbortSignal) => Promise<void>) => void | Promise<void>
  wallet: (signal: AbortSignal) => Promise<WalletInterface>
}
const short = (outpoint: string) => `${outpoint.slice(0, 6)}…${outpoint.slice(58)}`
const shown = { listed: 'still listed', absent: 'not listed', inconclusive: 'unclear' } as const

// Shown only on the device that signed this transfer. A read-only check comes first, because a
// wallet that recorded the transfer itself no longer lists the spent outputs. Release then removes
// any still listed from the sender's TicketSV baskets after verified mining. No network is needed.
export function SenderRelease({ settlement, senders, busy, run, wallet }: Props) {
  const sender = senderForSettlement(senders, settlement)
  const [record, setRecord] = useState<Release>(),
    [reason, setReason] = useState(''),
    [eligible, setEligible] = useState(false),
    [consent, setConsent] = useState(false),
    [checked, setChecked] = useState<[ReleaseObservation, ReleaseObservation]>()
  useEffect(() => setChecked(undefined), [settlement.id])
  useEffect(() => {
    if (!sender || busy) return
    let live = true
    void (async () => {
      const saved = await senderReleaseStore.load(sourceKey(sender.ticket)).catch(() => undefined)
      let ready = false,
        why = ''
      try {
        await releaseEligibility(sender, settlement, await loadSnapshot())
        ready = true
      } catch (e) {
        why = (e as Error).message
      }
      if (live) {
        setRecord(saved)
        setEligible(ready)
        setReason(why)
      }
    })()
    return () => {
      live = false
    }
  }, [sender, settlement, busy])
  if (!sender?.funding?.txid || sender.funding.index === undefined) return null
  const rows = record?.outputs ?? [
    { basket: 'ticketsv-tickets', outpoint: `${sender.ticket.pkg.current.txid}.${sender.ticket.pkg.current.index}` },
    { basket: 'ticketsv-handoff-fees', outpoint: `${sender.funding.txid}.${sender.funding.index}` },
  ]
  const seen = (i: number) => record?.outputs[i]?.observation ?? checked?.[i]
  const done = !!record && record.outputs.every(o => o.observation?.state === 'absent')
  // Only say TicketSV removed them when the wallet confirmed a release.
  const removed = done && record.outputs.some(o => o.attempts.some(a => a.outcome === 'complete'))
  const clear = !record && !!checked && checked.every(o => o.state === 'absent')
  const needsCheck = !record && (!checked || checked.some(o => o.state === 'inconclusive'))
  const unconfirmed = !!record && record.outputs.some(o => o.attempts.length > 0 && o.observation?.state !== 'absent')
  function release() {
    setConsent(false)
    void run(async signal => {
      await releaseSpentOutputs(sender!, settlement, await wallet(signal), await loadSnapshot(), signal)
    })
  }
  function check() {
    void run(async signal => {
      setChecked(await checkSpentOutputs(sender!, await wallet(signal), signal))
    })
  }
  function recheck() {
    void run(async signal => {
      await recheckRelease(sender!, await wallet(signal), signal)
    })
  }
  return (
    <div className="handoff-review sender-release">
      <h3>Your wallet (sender)</h3>
      <p>This device signed the transfer. After mining, your wallet may still list the spent ticket and fee output.</p>
      <ul>
        {rows.map((row, i) => {
          const o = seen(i)
          return (
            <li key={row.basket}>
              {i === 0 ? 'Ticket' : 'Fee'} <code>{short(row.outpoint)}</code> · Wallet:{' '}
              <strong>{o ? shown[o.state] : 'not checked'}</strong>
              {o && <> · checked {new Date(o.checkedAt).toLocaleString()}</>}
            </li>
          )
        })}
      </ul>
      {removed ? (
        <p className="event-saved">Removed from your wallet's ticket and fee lists. Your wallet history will not show this transfer.</p>
      ) : done || clear ? (
        <p className="event-saved">Nothing to remove. Your wallet no longer lists them.</p>
      ) : needsCheck ? (
        <>
          {checked && <p>{checked.find(o => o.state === 'inconclusive')!.reason}</p>}
          <p>Check your wallet first. This only reads your wallet; nothing is changed.</p>
        </>
      ) : (
        <>
          {unconfirmed && (
            <p role="status">
              Your wallet did not confirm the release. It may not support this or the permission was declined. Recheck before trying again.
            </p>
          )}
          {!eligible && reason && <p>{reason}</p>}
          <p>Your wallet may ask permission to remove items from its TicketSV ticket and fee lists.</p>
          <label className="handoff-consent">
            <input type="checkbox" checked={consent} disabled={busy || !eligible} onChange={e => setConsent(e.target.checked)} />I authorise
            removing these two spent outputs from my wallet's TicketSV ticket and fee lists. This does not sign or broadcast anything.
          </label>
        </>
      )}
      <div className="actions">
        {needsCheck && (
          <button className="btn" disabled={busy} onClick={check}>
            Check my wallet
          </button>
        )}
        {!done && !clear && !needsCheck && (
          <button className="btn primary" aria-label="Release spent outputs" disabled={busy || !eligible || !consent} onClick={release}>
            Release spent outputs
          </button>
        )}
        {record && !done && (
          <button className="btn" disabled={busy} onClick={recheck}>
            Recheck wallet
          </button>
        )}
      </div>
    </div>
  )
}
