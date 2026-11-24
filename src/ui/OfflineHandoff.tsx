import {OfflineBrowserSupport} from './OfflineBrowserSupport.tsx'
import {evidenceChange,evidenceSize} from '../tickets/size.ts'
import {loadHandoffView,saveHandoffView} from '../handoff/view-state.ts'
import {ReceivedSync} from './ReceivedSync.tsx'
import {ReceiveSteps} from './ReceiveSteps.tsx'
import {receiveNext,receiveSteps} from '../handoff/receive-steps.ts'
import {sendNext,transferNext} from '../handoff/send-next.ts'
import {NextStep} from './NextStep.tsx'
import {useCallback,useEffect,useRef,useState} from 'react'
import {Transaction} from '@bsv/sdk'
import {listSavedTickets} from '../offline/attendee-store.ts'
import {prepareAttendeeApp,OfflineAppUnavailableError} from '../offline/attendee-cache.ts'
import {fromAttendee,invitationFor,readInvitation,readHandoffRequest,receiveHandoffTicket,verifyHandoffTicket} from '../handoff/evidence.ts'
import {senderStore,recipientStore,sourceKey,recipientKey,readSender,readRecipient} from '../handoff/store.ts'
import type {HandoffTicket,SenderRecord,RecipientRecord,Invitation,HandoffRequest} from '../handoff/types.ts'
import {reviewFunding,fundHandoff,fundingCandidate,prepareSigning,signHandoff,createReceivingRequest,type FundingReview} from '../handoff/wallet.ts'
import {prepareHandoffHeaders,requiredHeaderHeight} from '../handoff/headers.ts'
import {fetchPolicy,fetchStatus} from '../settlement/arc.ts'
import {settlementStore,newSettlement,settlementKey,submitHandoff,checkHandoffMining,verifyHandoffMining,prepareObservedHandoffMining,reconcileReceivedTicket,importReceivedTicket,type HandoffSettlement,type MiningPreparation} from '../handoff/settlement.ts'
import {openWalletClient,preferredWalletTransport,type WalletTransport} from '../wallet/connection.ts'
import {loadSnapshot} from '../headers/store.ts'
import {fromBase64} from '../tickets/codec.ts'
import type {Verification} from '../tickets/types.ts'
import {TicketSidebar} from './TicketSidebar.tsx'
import {DashboardIcon} from './DashboardIcon.tsx'
import {OrganiserReview} from './OrganiserReview.tsx'
import {organiserReviewStore,organiserReviewKey,assertReviewedInvitation,type OrganiserReview as ReviewedOrganiser} from '../handoff/organiser-review.ts'
import {ExchangeExport,ExchangeImport} from './HandoffExchange.tsx'
import {SenderRelease} from './SenderRelease.tsx'
import {senderForSettlement} from '../handoff/release.ts'
import {OfflineReadiness} from './OfflineReadiness.tsx'
import '../styles/offline-tickets.css'
import '../styles/handoff.css'
import '../styles/organiser-review.css'
import {measured} from '../network/recorder.ts'
import {NetworkLine} from './NetworkLine.tsx'
import {canReopenOffline} from '../offline/persist.ts'
import {handoffNextStep} from '../offline/home.ts'
const txLabel=(t:HandoffTicket)=>`${t.pkg.current.txid}.${t.pkg.current.index}`
const feeSteps=['Prepare transfer fee','Fee preparation needs review','Waiting for fee mining']

export function OfflineHandoff(){
 const context=new URLSearchParams(location.search),receiving=context.get('step')==='receive'||context.has('request')||context.has('transfer')
 const [tab,setTab]=useState<'prepare'|'send'|'receive'|'confirm'>(()=>receiving?'receive':context.get('step')==='send'?'send':'prepare'),[sources,setSources]=useState<HandoffTicket[]>([]),[senders,setSenders]=useState<SenderRecord[]>([]),[recipients,setRecipients]=useState<RecipientRecord[]>([]),[settlements,setSettlements]=useState<HandoffSettlement[]>([])
 // The receiver says when the sender has their request; the phone can't see it offline.
 const [shownRequest,setShownRequest]=useState<string>()
 const [source,setSource]=useState(''),[sender,setSender]=useState<SenderRecord>(),[recipient,setRecipient]=useState<RecipientRecord>(),[settlement,setSettlement]=useState<HandoffSettlement>()
 const [fundingReview,setFundingReview]=useState<FundingReview>(),[invitation,setInvitation]=useState<Invitation>(),[request,setRequest]=useState<HandoffRequest>(),[reviewedOrganiser,setReviewedOrganiser]=useState<ReviewedOrganiser|null>(null),[consent,setConsent]=useState(false),[prepared,setPrepared]=useState(false),[publishConsent,setPublishConsent]=useState(false),[importConsent,setImportConsent]=useState(false)
 const [report,setReport]=useState<Verification>(),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[online,setOnline]=useState(navigator.onLine),[transport,setTransport]=useState<WalletTransport>(preferredWalletTransport)
 const [feeWaiting,setFeeWaiting]=useState(false),[offlineUnavailable,setOfflineUnavailable]=useState('')
 const onOrganiserReviewed=useCallback((review:ReviewedOrganiser|null)=>{setReviewedOrganiser(review);setConsent(false)},[])
 function resetConsent(){setConsent(false);setPublishConsent(false);setImportConsent(false)}
 const initialSelection=useRef(false)
 const [viewReady,setViewReady]=useState(false)
 const control=useRef<AbortController|null>(null),mounted=useRef(true)
 async function reload(){
  const [saved,ss,rr,tt]=await Promise.all([listSavedTickets(location.origin),senderStore.list(),recipientStore.list(),settlementStore.list()])
  const tickets=new Map<string,HandoffTicket>()
  for(const r of ss)tickets.set(sourceKey(r.ticket),r.ticket)
  for(const row of saved)if(row.evidence)tickets.set(sourceKey(fromAttendee(row.evidence)),fromAttendee(row.evidence))
  for(const r of rr)if(r.ticket)tickets.set(sourceKey(r.ticket),r.ticket)
  for(const r of tt)tickets.set(sourceKey(r.ticket),r.ticket)
  // An outgoing transfer's successor belongs to its recipient, not this
  // sender's next Send operation. Keep the evidence in its original stores.
  // A separately prepared sender record remains accessible for later handoffs.
  const preparedSources=new Set(ss.map(r=>sourceKey(r.ticket)))
  for(const r of ss){
   if(r.transfer&&r.transfer.holder!==r.ticket.holder){
    const successor=sourceKey(r.transfer)
    if(!preparedSources.has(successor))tickets.delete(successor)
   }
  }
  if(!mounted.current)return
  setSources([...tickets.values()]);setSenders(ss);setRecipients(rr);setSettlements(tt)
  if(!initialSelection.current){
   initialSelection.current=true
   const query=new URLSearchParams(location.search),transfer=tt.find(r=>r.id===query.get('transfer'))
   const found=rr.find(r=>r.id===query.get('request'))
   const own=query.get('source')??''
   if(transfer){setTab('confirm');setSettlement(transfer)}
   else if(found){setTab('receive');setRecipient(found)}
   else if(tickets.has(own)){
    // A link from the offline home: open this ticket on the step it needs next.
    const record=ss.find(r=>r.id===own),step=record&&handoffNextStep({sender:record})
    setSource(own);setSender(record);setTab(step&&!feeSteps.includes(step)?'send':'prepare')
   }
   else if(!query.has('request')&&!query.has('transfer')&&!query.has('source')){
    const view=loadHandoffView(receiving)
    if(view){
     const restoredSender=ss.find(r=>r.id===view.source),restoredRecipient=rr.find(r=>r.id===view.recipient),restoredSettlement=tt.find(r=>r.id===view.settlement)
     if(restoredSender||tickets.has(view.source??'')){setSource(view.source!);setSender(restoredSender)}
     if(restoredRecipient)setRecipient(restoredRecipient)
     if(restoredSettlement)setSettlement(restoredSettlement)
     // Restore a step only when its selected durable record still exists.
     if(view.tab==='confirm'?!!restoredSettlement:view.tab==='receive'?!!restoredRecipient:!!restoredSender||tickets.has(view.source??''))setTab(view.tab)
    }
   }
   setViewReady(true)
  }
  setSender(old=>old?ss.find(r=>r.id===old.id):old);setRecipient(old=>old?rr.find(r=>r.id===old.id):old);setSettlement(old=>old?tt.find(r=>r.id===old.id):old)
 }
 useEffect(()=>{mounted.current=true;void reload().catch(e=>setError((e as Error).message));const update=()=>setOnline(navigator.onLine);addEventListener('online',update);addEventListener('offline',update);return()=>{mounted.current=false;control.current?.abort();removeEventListener('online',update);removeEventListener('offline',update)}},[])
 const [snapshotTip,setSnapshotTip]=useState<number>()
 useEffect(()=>{if(busy||tab!=='receive')return;let live=true;void loadSnapshot().then(value=>{if(live)setSnapshotTip(value?.headers.at(-1)?.height)},()=>{});return()=>{live=false}},[busy,tab,recipient?.id,invitation])
 useEffect(()=>{if(viewReady)saveHandoffView(receiving,{tab,source,recipient:recipient?.id,settlement:settlement?.id})},[viewReady,receiving,tab,source,recipient?.id,settlement?.id])
 async function run(action:(signal:AbortSignal)=>Promise<void>){
  if(control.current)return
  const c=new AbortController();control.current=c;setBusy(true);setError('');setMessage('');setFeeWaiting(false);resetConsent()
  try{await action(c.signal)}catch(e){if(mounted.current)setError(c.signal.aborted?'Operation cancelled. A wallet or publication action may already have happened; review its saved outcome before continuing.':(e as Error).message)}
  finally{try{await reload()}catch(e){if(mounted.current)setError((e as Error).message)}if(control.current===c)control.current=null;if(mounted.current)setBusy(false)}
 }
 const wallet=(signal:AbortSignal)=>openWalletClient(transport,AbortSignal.any([signal,AbortSignal.timeout(120000)]))
 const progress=(p:{completed:number;total:number})=>{if(mounted.current)setMessage(`Preparing saved headers: ${p.completed} of ${p.total}.`)}
 async function headers(t:HandoffTicket,signal:AbortSignal){return prepareHandoffHeaders(requiredHeaderHeight(t.pkg.current.txid,t.pkg.atomicBeefBase64),signal,progress)}
 async function chooseSource(id:string){setFeeWaiting(false);setSource(id);setFundingReview(undefined);setRequest(undefined);setPrepared(false);resetConsent();setReport(undefined);setSender(senders.find(r=>r.id===id));setMessage('');setError('')}
 const selected=sources.find(t=>sourceKey(t)===source)
 function reviewFee(){if(!selected)return;void run(async signal=>{
  const snapshot=await headers(selected,signal),review=await reviewFunding(selected,await fetchPolicy(signal),await wallet(signal),signal,snapshot);signal.throwIfAborted();setFundingReview(review)
  let r=await senderStore.load(sourceKey(selected));if(!r){r=readSender({kind:'ticketsv-handoff-sender',version:1,id:sourceKey(selected),revision:0,ticket:selected});await senderStore.save(r,undefined)}setSender(r);setMessage('Review the fee preparation below. No funds have been spent.')
 })}
 function fund(){if(!sender||!fundingReview||!consent)return;void run(async signal=>{setPrepared(false);const next=await fundHandoff(sender,fundingReview,await wallet(signal),signal,senderStore);setSender(next);setFundingReview(undefined);setMessage(next.fundAttempt?.outcome==='complete'?'Fee transaction saved. Check its mining evidence before going offline.':'Funding outcome needs review. Do not create another attempt.')})}
 async function prepareHandoffApp(signal:AbortSignal) {
  try { const status=await prepareAttendeeApp(signal);setOfflineUnavailable('');return status }
  catch(failure) { signal.throwIfAborted();if(!(failure instanceof OfflineAppUnavailableError))throw failure;setOfflineUnavailable(failure.message);return 'unavailable' as const }
 }
 function prepareSender(){if(!sender?.funding?.txid)return;void run(async signal=>{
  const status=await fetchStatus(sender.funding!.txid!,signal);if(!status)throw Error('Fee transaction is not reported yet. Check again later; do not fund again.')
  if(['QUEUED','RECEIVED','STORED','ANNOUNCED_TO_NETWORK','REQUESTED_BY_NETWORK','SENT_TO_NETWORK','ACCEPTED_BY_NETWORK','SEEN_ON_NETWORK','SEEN_MULTIPLE_NODES'].includes(status.txStatus)){setFeeWaiting(true);setMessage(`Fee transaction status: ${status.txStatus}. Wait for mining before offline signing.`);return}
  if(status.txStatus!=='MINED'&&status.txStatus!=='IMMUTABLE')throw Error(`Fee transaction status: ${status.txStatus}. Review this transaction before continuing; do not fund again.`)
  const funding=fundingCandidate(sender.funding!,status);await prepareHandoffHeaders(requiredHeaderHeight(funding.txid!,funding.beef!),signal,progress);await headers(sender.ticket,signal)
  const next=readSender({...sender,funding,revision:sender.revision+1},sender);await senderStore.save(next,sender.revision)
  await prepareSigning(next,await wallet(signal),await loadSnapshot(),signal);const app=await prepareHandoffApp(signal);signal.throwIfAborted();setSender(next);setPrepared(app==='ready');setMessage(app==='unavailable'?'Ticket and fee evidence are saved. Offline app reopening is not prepared in this browser.':app==='ready'?'Ticket, fee evidence and app are prepared. Share the invitation so the recipient can prepare their device.':'App update saved. Select Reload in the update notice, then check preparation again.')
 })}
 const senderInvitation=sender?.funding?.beef&&sender.funding.txid&&sender.funding.observation&&sender.fundAttempt?.outcome==='complete'?invitationFor(sender.ticket,Math.max(requiredHeaderHeight(sender.ticket.pkg.current.txid,sender.ticket.pkg.atomicBeefBase64),requiredHeaderHeight(sender.funding.txid,sender.funding.beef))):undefined
 const next=sendNext(sender,Boolean(senderInvitation)),retrying=next?.kind==='retry',review=retrying?sender?.request:request,transferNow=tab==='prepare'||tab==='send'?transferNext(tab,sender,Boolean(senderInvitation),!!request):undefined
 async function loadRequest(value:unknown){if(!sender)throw Error('Choose the prepared ticket first.');const next=readHandoffRequest(value);const expected=invitationFor(sender.ticket,next.invitation.requiredHeight);if(JSON.stringify(next.invitation)!==JSON.stringify(expected))throw Error('This receiving request belongs to another ticket.');setRequest(next);resetConsent();setMessage('Review the recipient and approve this exact transfer.')}
 function sign(){if(!sender||!review||!consent)return;void run(async signal=>{let recorded=true;const next=await signHandoff(sender,review,await wallet(signal),await loadSnapshot(),signal,senderStore,value=>{recorded=value});setSender(next);setMessage(next.transfer?'Signed transfer saved on this device. Share it with the recipient; it has not been broadcast.'+(recorded?'':' Your wallet still lists this ticket. After mining, release it under Confirm.'):"Signing didn't finish. You can retry for the same recipient.");if(next.transfer)await ensureSettlement(next.transfer)})}
 async function ensureSettlement(t:HandoffTicket){let s=await settlementStore.load(settlementKey(t));if(!s){s=newSettlement(t);await settlementStore.save(s,undefined)}setSettlement(s);return s}
 async function loadInvitation(value:unknown){const i=readInvitation(value);if(i.origin!==location.origin)throw Error('Use the same TicketSV website address on both devices.');setInvitation(i);setReviewedOrganiser(null);setRecipient(undefined);resetConsent();setReport(undefined)}
 function prepareRecipient(){if(!invitation||!reviewedOrganiser)return;void run(async signal=>{assertReviewedInvitation(invitation,await organiserReviewStore.load(organiserReviewKey(invitation)));signal.throwIfAborted();if(invitation.requiredHeight===undefined)throw Error('Ask the sender for an invitation after fee mining preparation.');await prepareHandoffHeaders(invitation.requiredHeight,signal,progress);const app=await prepareHandoffApp(signal);setMessage(app==='unavailable'?'Required headers are saved. You can create your receiving request while online. Offline app reopening is not prepared.':app==='ready'?'Device files and headers saved. You can now create your receiving request, including while offline.':'App update waiting. Select Reload in the update notice before disconnecting.')})}
 function makeRequest(){if(!invitation||!consent||!reviewedOrganiser)return;void run(async signal=>{assertReviewedInvitation(invitation,await organiserReviewStore.load(organiserReviewKey(invitation)));signal.throwIfAborted();const r=await createReceivingRequest(await wallet(signal),invitation,signal);signal.throwIfAborted();const saved=readRecipient({kind:'ticketsv-handoff-recipient',version:1,id:recipientKey(r),revision:0,request:r});await recipientStore.save(saved,undefined);setRecipient(saved);setMessage('Your independent receiving request is saved. Share it with the sender.')})}
 async function loadTransfer(value:unknown){if(!recipient)throw Error('Select your independently saved receiving request first.');await run(async signal=>{const latest=await recipientStore.load(recipient.id);if(!latest)throw Error('Receiving request is missing.');const ticket=await receiveHandoffTicket(value,latest.request,latest.request.invitation.trustedVenue,await loadSnapshot());signal.throwIfAborted();const next=readRecipient({...latest,ticket,revision:latest.revision+1},latest);await recipientStore.save(next,latest.revision);setRecipient(next);setReport(await verifyHandoffTicket(ticket,await loadSnapshot()));await ensureSettlement(ticket);dispatchEvent(new Event('ticketsv-handoff-saved'));setMessage('Ticket evidence saved on this device. An unmined transfer still needs online confirmation.')})}
 const receivedSettlement=recipient?.ticket?settlements.find(s=>s.id===settlementKey(recipient.ticket!)&&s.ticket.pkg.current.index===recipient.ticket!.pkg.current.index&&s.ticket.request?.request.requestId===recipient.request.request.requestId):undefined
 const receivedComplete=receivedSettlement?.wallet?.state==='present'
 const receive=receiveSteps({invitation:!!invitation,organiserChecked:!!reviewedOrganiser,requiredHeight:(recipient?.request.invitation??invitation)?.requiredHeight,snapshotTip,request:!!recipient,shown:!!recipient&&shownRequest===recipient.id,ticket:!!recipient?.ticket,verdict:recipient?.ticket?report?.verdict:undefined,confirmed:receivedComplete})
 const receiveNow=receiveNext(receive)
 function receiveStep(){
  if(recipient&&receivedComplete)return <><span className="handoff-panel-kicker">RECEIVING COMPLETE</span><h3>Ticket recorded in your wallet.</h3><p>{recipient.ticket!.event.name}</p><p>Wallet record: <strong>present</strong>{receivedSettlement?.import&&<> · Import response: <strong>{receivedSettlement.import.outcome==='complete'?'accepted':receivedSettlement.import.outcome}</strong></>}</p><p>Last checked {new Date(receivedSettlement!.wallet!.checkedAt).toLocaleString()}. This is a saved wallet observation.</p>
 <details><summary>Review received ticket</summary><div className="actions"><button className="btn" disabled={busy} onClick={()=>verifyReceived(false)}>Recheck saved evidence</button><button className="btn" disabled={busy} onClick={()=>{setSettlement(receivedSettlement);navigate('confirm')}}>View confirmation</button></div><EvidenceLine settlement={receivedSettlement!} /><p>At the door, show the smaller door ticket. The updated ticket is the complete record for the buyer.</p><ExchangeExport value={receivedSettlement!.ticket.pkg} name="door ticket" /><ExchangeExport value={receivedSettlement!.ticket} name="updated ticket" /></details>{result()}</>
  if(recipient?.ticket)return <><h2>{receive.current==='verified'?'Check the ticket on this phone.':"Confirm once you're back online."}</h2><p>Ticket evidence saved on this device. Offline checks cannot rule out an unseen competing transfer.</p><div className="actions"><button className="btn" disabled={busy} onClick={()=>verifyReceived(false)}>Verify locally</button><button className="btn" disabled={busy||!online} onClick={()=>verifyReceived(true)}>Prepare missing headers online</button><button className="btn" disabled={busy} onClick={()=>void run(async()=>{await ensureSettlement(recipient.ticket!);navigate('confirm')})}>Continue to confirmation</button></div>{result()}</>
  if(recipient&&receive.current==='ticket')return <><h2>Scan the sender's ticket.</h2><p>Ask the sender to open Send and tap Show ticket QR, then Show to scanner.</p><ExchangeImport label="ticket" onLoad={loadTransfer} disabled={busy} scanFirst /><button className="btn" disabled={busy} onClick={()=>{setShownRequest(undefined);setMessage('')}}>Show my request again</button></>
  if(recipient)return <><h2>Your request is saved</h2><p>Show it to the sender, by QR or file.</p><ExchangeExport value={recipient.request} name="receiving request" /></>
  if(!invitation)return <><h2>Load the sender's invitation.</h2><p>The sender shares a small invitation file or QR code. It lets you check the published event and its organiser before receiving.</p><ExchangeImport label="invitation" onLoad={loadInvitation} disabled={busy} /></>
  return <><h2>{reviewedOrganiser?'Prepare and create your request.':'Check the organiser.'}</h2><p>Ticket: <code>{invitation.source.txid}.{invitation.source.index}</code></p><OrganiserReview key={JSON.stringify(invitation)} invitation={invitation} disabled={busy} onReviewed={onOrganiserReviewed}/>{reviewedOrganiser&&approve('I authorize receiving-key and identity signatures for this ticket using the saved organiser review. No transaction is created.')}
  <p className="event-help">First prepare this device while online, so it can check the ticket without internet. Then create your request.</p>
  <div className="actions"><button className="btn" disabled={busy||!reviewedOrganiser||!online} onClick={prepareRecipient}>Prepare this device online</button><button className="btn primary" aria-label="Create receiving request" disabled={busy||!consent||!reviewedOrganiser} onClick={makeRequest}>Create receiving request</button></div>
  <details className="receive-other-invitation"><summary>Use a different invitation</summary><ExchangeImport label="invitation" onLoad={loadInvitation} disabled={busy} /></details></>
 }
 const statusBox=<>{(busy||message)&&<div className={feeWaiting?'handoff-status handoff-fee-waiting':'handoff-status'} role="status">{busy?'Working… ':''}{message}{busy&&<button className="btn" onClick={()=>control.current?.abort()}>Cancel operation</button>}</div>}{error&&<p className="event-error" role="alert">{error}</p>}</>
 function verifyReceived(onlinePreparation:boolean){const ticket=receivedSettlement?.ticket??recipient?.ticket;if(!ticket)return;void run(async signal=>{setReport(await measured('Ticket verification',async()=>{if(onlinePreparation)await headers(ticket,signal);return verifyHandoffTicket(ticket,await loadSnapshot())}));setMessage('Verification used local evidence. No admission or current unspentness claim is made.')})}
 async function showMining(prepared:MiningPreparation){
  const next=prepared.settlement;setSettlement(next);setReport(prepared.verification)
  if(prepared.preparationError){setError(prepared.preparationError);setMessage('Provider mining status saved. Header progress is retained; retry Verify mining evidence.');return}
  if(!prepared.verification){setMessage(next.notFoundAt?'Provider reports not found (HTTP 404). This does not prove it was never broadcast.':`Provider status saved: ${next.status?.txStatus}. It is separate from verified mining.`);return}
  const rr=await recipientStore.load(recipientKey(next.ticket.request!))
  if(rr){const updated=readRecipient({...rr,ticket:next.ticket,revision:rr.revision+1},rr);await recipientStore.save(updated,rr.revision)}
  setMessage('Mining inclusion verified against saved local headers. The recipient can now check their wallet record.')
 }
 function verifyMined(){if(!settlement)return;void run(async signal=>showMining(await measured('Mining verification',()=>verifyHandoffMining(settlement,signal,progress),{key:p=>p.verification})))}
 function navigate(next:typeof tab){setFeeWaiting(false);setTab(next);resetConsent();setError('');setMessage('');setReport(undefined)}
 function approve(text:string,kind:'general'|'publish'|'import'='general'){const checked=kind==='publish'?publishConsent:kind==='import'?importConsent:consent;const change=kind==='publish'?setPublishConsent:kind==='import'?setImportConsent:setConsent;return <label className="handoff-consent"><input type="checkbox" checked={checked} disabled={busy} onChange={e=>change(e.target.checked)} />{text}</label>}
 function result(){return report&&<div className="handoff-result" aria-live="polite"><h3>Ticket evidence: {report.verdict}</h3><ul>{report.checks.map(c=><li key={c.name}>{c.name}: {c.status} — {c.reason}</li>)}</ul><p>{report.presentedTransferMined?'Mining inclusion verified against saved headers.':'Current transfer mining is not verified.'}</p>{tab==='receive'&&report.verdict==='verified'&&!report.presentedTransferMined&&<p className="handoff-double-sale">This ticket checks out on this device. No device can rule out that the seller also signed it to someone else offline; whichever transfer is mined first is the valid one, and the door admits only one copy.</p>}<NetworkLine of={report}/></div>}
 // Confirm lists one role per page: transfers this device sent on Transfer, received ones on Receive.
 const roleSettlements=settlements.filter(s=>!senderForSettlement(senders,s)===receiving),sent=!!settlement&&!!senderForSettlement(senders,settlement)
 const steps:typeof tab[]=receiving?['receive','confirm']:['prepare','send','confirm']
 const pageTitle=tab==='confirm'?'Confirm your transfer.':receiving?'Receive a ticket.':'Transfer a ticket.'
 return <div className="workspace workspace-dashboard handoff-workspace">
 
 <div className="shell"><TicketSidebar active={receiving?'receive':'transfer'} disabled={busy}/>
 <main id="main" tabIndex={-1} className="content handoff-page">
 <div className="handoff-page-heading"><div><span className="handoff-eyebrow"><DashboardIcon name={receiving?'receive':'transfer'}/>{receiving?'A TICKET, FROM THEIR WALLET TO YOURS':'READY FOR ITS NEXT CHAPTER'}</span><h1>{pageTitle}</h1><p>{tab==='confirm'?'Check mining evidence and the receiving wallet before calling it complete.':receiving?'Start with the sender’s invitation, or pick up a request you already saved.':'Prepare your ticket, review its next holder, then sign and share when you are ready.'}</p></div><div className="handoff-heading-symbol" aria-hidden="true"><DashboardIcon name="ticket"/></div></div>
 <nav className="handoff-tabs" aria-label="Handoff steps">{steps.map((t,i)=><button key={t} aria-label={t[0].toUpperCase()+t.slice(1)} aria-current={tab===t?'step':undefined} disabled={busy} onClick={()=>navigate(t)}><span>{String(i+1).padStart(2,'0')}</span>{t[0].toUpperCase()+t.slice(1)}{t==='send'&&tab==='prepare'&&!!next&&<em className="handoff-tab-ready">Ready</em>}</button>)}</nav>
 <details className="wallet-advanced"><summary>Wallet connection</summary><label>Connection method<select value={transport} disabled={busy} onChange={e=>{setTransport(e.target.value as WalletTransport);try{sessionStorage.setItem('ticketsv-wallet-transport',e.target.value)}catch{/* Optional connection preference. */}resetConsent();setFundingReview(undefined);setPrepared(false)}}><option value="desktop-http">BSV Desktop · Local HTTP</option><option value="desktop-https">BSV Desktop · Local HTTPS</option><option value="browser-native">BSV Browser · Native wallet</option></select></label><p>Choose the wallet for this handoff. Receiving requests must use the same wallet when the ticket is registered later.</p></details>
 {(tab==='prepare'||tab==='send')&&<section className="handoff-panel"><h2>{tab==='prepare'?'Prepare your ticket.':'Send to its next holder.'}</h2><label>Saved ticket<select aria-label="Choose handoff ticket" value={source} disabled={busy} onChange={e=>void chooseSource(e.target.value)}><option value="">Choose a ticket</option>{sources.map(t=><option key={sourceKey(t)} value={sourceKey(t)}>{t.event.name} · {t.pkg.current.txid.slice(0,12)}</option>)}</select></label>{selected&&<p className="event-help">Current ticket: <code>{txLabel(selected)}</code></p>}
 {tab==='prepare'&&selected&&<><OfflineReadiness ticket={selected} sender={sender} transport={transport} busy={busy}/>{transferNow&&<NextStep step={transferNow}>{!!next&&<button className="btn primary" aria-label="Continue to Send" disabled={busy} onClick={()=>navigate('send')}>Continue to Send</button>}</NextStep>}<p>One separate fee transaction is prepared online. Your ticket stays in its current output until you approve sending it.</p>{!sender?.fundAttempt&&<button className="btn primary" aria-label="Review fee preparation" disabled={busy||!online} onClick={reviewFee}>Review fee preparation</button>}{fundingReview&&!sender?.fundAttempt&&<div className="handoff-review"><h3>Review fee preparation</h3><p>Dedicated transfer fee: <strong>{fundingReview.amount} testnet satoshis</strong>. This entire amount pays the later transfer fee. Your wallet also charges its fee for creating this separate funding transaction and returns its normal change.</p><p>Allow one additional mining wait. Unused funding stays in its output; there is no automatic cleanup.</p>{approve('I authorize creating and broadcasting this separate testnet fee output, including the wallet funding fee.')}<button className="btn primary" aria-label="Prepare transfer fee" disabled={busy||!consent||!online} onClick={fund}>Prepare transfer fee</button></div>}
 {sender?.fundAttempt&&<p>Fee preparation: <strong>{sender.fundAttempt.outcome}</strong>{sender.fundAttempt.reason&&<> ({sender.fundAttempt.reason})</>}{sender.funding?.txid&&<> · <code>{sender.funding.txid}</code></>}</p>}{sender?.fundAttempt?.outcome==='complete'&&!sender.signAttempt&&<button className="btn primary" aria-label="Check mining and prepare device" disabled={busy||!online} onClick={prepareSender}>Check mining and prepare device</button>}{sender?.fundAttempt&&sender.fundAttempt.outcome!=='complete'&&<p role="status">Funding outcome needs review. Reloading or cancelling cannot undo a wallet action. Another funding attempt is blocked.</p>}{prepared&&<p className="event-saved">Prepared in this session. Save the invitation and keep this app and wallet available.</p>}{next?.kind==='invite'&&senderInvitation&&<><h3>Invite the recipient</h3><p>Share this invitation first so the recipient can prepare their device and create a receiving request.</p><ExchangeExport value={senderInvitation} name="invitation" /></>}
 {retrying&&<p className="event-error" role="status">Signing this ticket didn't finish{next.reason&&<> ({next.reason})</>}. It can only be signed again for the same recipient.</p>}</>}
 {tab==='send'&&sender&&<>{transferNow&&<NextStep step={transferNow}/>}{sender.signAttempt&&<p>Signing: <strong>{sender.signAttempt.outcome}</strong>{sender.signAttempt.reason&&<> ({sender.signAttempt.reason})</>}.{sender.transfer?' Signing cannot be repeated for this source ticket.':' Only the same recipient can be used.'}</p>}{sender.transfer?<><h3>Transfer signed and saved</h3><p>Share this ticket package with its intended recipient. It is not broadcast by sharing it.</p><ExchangeExport value={sender.transfer} name="ticket" /><button className="btn" onClick={()=>void run(async()=>{await ensureSettlement(sender.transfer!);navigate('confirm')})}>Continue to confirmation</button></>:sender.fundAttempt?.outcome==='complete'?<>{!retrying&&<ExchangeImport label="receiving request" onLoad={loadRequest} disabled={busy} />}{review&&<div className="handoff-review"><h3>{retrying?'Retry for the same recipient':'Review this handoff'}</h3><p>Recipient identity: <code>{review.recipientIdentity}</code></p><p>Receiving key: <code>{review.request.recipient.publicKey}</code></p><p>Spends ticket <code>{txLabel(sender.ticket)}</code> and fee output <code>{sender.funding?.txid}.{sender.funding?.index}</code>. Fee: {sender.funding?.amount} testnet satoshis. Creates one 1-satoshi ticket for the recipient.</p>{approve('I prepared both devices, disabled external internet for the app and wallet, and authorize signing this exact transfer. Signing does not broadcast it.')}<button className="btn primary" aria-label={retrying?'Retry signing for the same recipient':'Sign offline transfer'} disabled={busy||!consent} onClick={sign}>{retrying?'Retry signing for the same recipient':'Sign offline transfer'}</button></div>}</>:<p>Complete online preparation first.</p>}</>}
 {tab==='send'&&!sender&&<p>Choose a prepared ticket to send.</p>}</section>}
 {tab==='receive'&&<div className="receive-layout">
 {!canReopenOffline()&&<p className="handoff-no-reopen" role="note">This browser cannot reopen TicketSV without internet. Keep this page open and don't reload it until you're back online.</p>}
 {recipients.length>0&&<label className="receive-handoff-picker">Your handoff<select aria-label="Saved receiving request" value={recipient?.id??''} disabled={busy} onChange={e=>{setRecipient(recipients.find(r=>r.id===e.target.value));setInvitation(undefined);setReviewedOrganiser(null);setReport(undefined);resetConsent()}}><option value="">Start a new handoff</option>{recipients.map(r=><option key={r.id} value={r.id}>{r.request.invitation.event.name} · {r.request.request.requestId.slice(0,8)}</option>)}</select></label>}
 <ReceiveSteps items={receive.items} current={receive.current}/>
 <section className="handoff-panel receive-step">{receiveNow&&<NextStep step={receiveNow}>{receive.current==='shown'&&recipient&&<button className="btn primary" aria-label="I've shown it, continue" disabled={busy} onClick={()=>{setShownRequest(recipient.id);setMessage('')}}>I've shown it, continue</button>}</NextStep>}{receiveStep()}{statusBox}</section>
 </div>}

 <ReceivedSync onRestored={reload}/><OfflineBrowserSupport/>
 {tab==='confirm'&&<section className="handoff-panel"><h2>Confirm when connected.</h2><label>Saved transfer<select aria-label="Saved transfer" disabled={busy} value={settlement?.id??''} onChange={e=>{setSettlement(settlements.find(s=>s.id===e.target.value));resetConsent();setReport(undefined)}}><option value="">Choose a transfer</option>{roleSettlements.map(s=><option key={s.id} value={s.id}>{s.ticket.event.name} · {s.ticket.pkg.current.txid.slice(0,12)}</option>)}</select></label>{!roleSettlements.length&&<p>No {receiving?'received':'sent'} transfers on this device yet.</p>}{settlement&&<><p>{sent?'You sent this ticket.':'You received this ticket.'}</p><p>Transfer: <code>{txLabel(settlement.ticket)}</code></p><p>Provider: <strong>{settlement.notFoundAt?'Not found (HTTP 404)':settlement.status?.txStatus??'Not checked'}</strong>. Publication: <strong>{settlement.submit?.outcome??'Not attempted on this device'}</strong>.</p>{settlement.notFoundAt&&<p>Checked at {settlement.notFoundAt}. The provider did not find this transaction. This does not prove it was never broadcast.{settlement.status&&<> Earlier provider observation retained: <strong>{settlement.status.txStatus}</strong>.</>}</p>}<button className="btn" disabled={busy||!online} onClick={()=>void run(async signal=>{await showMining(await checkHandoffMining(settlement,signal,progress))})}>Check transfer status</button>
 {!settlement.submit&&(!settlement.status||settlement.status.txStatus==='UNKNOWN')&&<div className="handoff-review"><h3>Publish the signed transfer</h3><p>Publishing spends the inputs already signed into this transaction. It does not sign again or change the fee.</p><TransferAmounts ticket={settlement.ticket} />{approve('I authorize publishing this exact signed testnet transfer and spending its displayed inputs and fee.','publish')}<button className="btn primary" aria-label="Publish transfer" disabled={busy||!publishConsent||!online} onClick={()=>void run(async signal=>{await headers(settlement.ticket,signal);const published=await submitHandoff(settlement,await loadSnapshot(),signal);setSettlement(published);if(['MINED','IMMUTABLE'].includes(published.status?.txStatus??''))await showMining(await prepareObservedHandoffMining(published,signal,progress));else setMessage('Publication outcome saved. Check status; publication is not verified mining.')})}>Publish transfer</button></div>}
 {settlement.submit?.outcome==='unknown'||settlement.submit?.outcome==='pending'?<p>Publication outcome needs review. Check status without submitting again.</p>:null}
 {(settlement.status?.txStatus==='MINED'||settlement.status?.txStatus==='IMMUTABLE')&&<button className="btn primary" aria-label="Verify mining evidence" disabled={busy} onClick={verifyMined}>Verify mining evidence</button>}{result()}
 {!sent&&<><h3>Recipient wallet</h3><p>Connect the receiving wallet to check or register its exact mined ticket. An accepted import and a present wallet record are separate observations.</p><button className="btn" disabled={busy} onClick={()=>void run(async signal=>{setSettlement(await reconcileReceivedTicket(settlement,await wallet(signal),await loadSnapshot(),signal));setMessage('Read-only wallet observation saved.')})}>Check recipient wallet</button>{settlement.import&&<p>Import response: <strong>{settlement.import.outcome==='complete'?'accepted':settlement.import.outcome}</strong>.</p>}{settlement.wallet&&<p>Wallet record: <strong>{settlement.wallet.state}</strong> · observed {new Date(settlement.wallet.checkedAt).toLocaleString()}. {settlement.wallet.reason}</p>}{!settlement.import&&settlement.wallet?.state==='absent'&&<>{approve('I authorize adding this exact mined ticket to the receiving wallet and updating its ownership and consumed-input records.','import')}<button className="btn primary" aria-label="Add received ticket to wallet" disabled={busy||!importConsent||!online} onClick={()=>void run(async signal=>{setSettlement(await importReceivedTicket(settlement,await wallet(signal),await loadSnapshot(),signal));setMessage('Wallet import outcome saved. Review its receipt and resulting record.')})}>Add received ticket to wallet</button></>}</>}
 <SenderRelease settlement={settlement} senders={senders} busy={busy} run={run} wallet={wallet}/>
 <EvidenceLine settlement={settlement} /><p>At the door, show the smaller door ticket. The updated ticket is the complete record for the buyer.</p><ExchangeExport value={settlement.ticket.pkg} name="door ticket" /><ExchangeExport value={settlement.ticket} name="updated ticket" /></>}</section>}
 {offlineUnavailable&&!(tab==='receive'&&!canReopenOffline())&&<p className="handoff-browser-warning" role="status">{offlineUnavailable}</p>}
 {tab!=='receive'&&statusBox}
 <details className="handoff-limits"><summary>Verification limits</summary><p>Mining is checked against saved headers. Full difficulty adjustment, best-chain selection, current unspentness and admission are outside these checks.</p></details></main></div></div>
}
// Shows the ticket getting smaller once its mining proof replaces the spent ancestors.
function EvidenceLine({settlement}:{settlement:HandoffSettlement}){let text:string;try{text=evidenceChange(settlement.unminedEvidence,evidenceSize(settlement.ticket.pkg))}catch{return null}return <p className="handoff-evidence-size">{text}</p>}
function TransferAmounts({ticket}:{ticket:HandoffTicket}){const tx=Transaction.fromAtomicBEEF(fromBase64(ticket.pkg.atomicBeefBase64));const inputs=tx.inputs.map(i=>({outpoint:`${i.sourceTransaction?.id('hex')??i.sourceTXID}.${i.sourceOutputIndex}`,amount:i.sourceTransaction?.outputs[i.sourceOutputIndex]?.satoshis??0})),fee=inputs.reduce((s,i)=>s+i.amount,0)-tx.outputs.reduce((s,o)=>s+(o.satoshis??0),0);return <><p>Embedded fee: <strong>{fee} testnet satoshis</strong>.</p><ul>{inputs.map(i=><li key={i.outpoint}><code>{i.outpoint}</code>: {i.amount} satoshis</li>)}</ul><p>Recipient key: <code>{ticket.pkg.request.recipient.publicKey}</code></p></>}
