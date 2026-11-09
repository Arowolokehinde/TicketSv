import {test,expect} from '@playwright/test'
import {syntheticSigningWallet} from './helpers/synthetic-signing-wallet.ts'
import {ticketFixture} from './helpers/ticket-fixture.ts'
import {readFile} from 'node:fs/promises'
import {readSigningEvidence} from '../src/verification/signing-spv.ts'
import {issueTicketExperiment} from '../src/wallet/ticket-experiment.ts'
test('confirms a missing issuance request with public reads and subsequently verifies the recipient locally',async({page,context})=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey
 const prep=await issueTicketExperiment(wallet,identity,'event','ticket','read-only-recovery'),calls:string[]=[]
 await page.route('http://localhost:3321/**',async r=>{const name=new URL(r.request().url()).pathname.slice(1) as keyof typeof wallet;calls.push(name);if(name!=='getNetwork'&&name!=='getPublicKey'){await r.abort();return}await r.fulfill({json:await wallet[name](r.request().postDataJSON())})})
 await page.goto('/dev/feasibility');const panel=page.locator('.ticket-auth-panel')
 await panel.getByLabel('Trusted venue identity').fill(identity)
 await panel.getByLabel('Load ticket package').setInputFiles({name:'issuance.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(prep.pkg))})
 expect(calls).toEqual([])
 await panel.getByRole('button',{name:'Confirm current-holder request with wallet',exact:true}).click()
 await expect(panel.getByText('Current-holder request confirmed with the wallet. Download it before continuing.',{exact:true})).toBeVisible()
 const downloaded=page.waitForEvent('download');await panel.getByRole('button',{name:'Download receiving request',exact:true}).click()
 const path=await (await downloaded).path();expect(JSON.parse(await readFile(path!,'utf8'))).toEqual(prep.source)
 expect(calls).toEqual(['getNetwork','getPublicKey','getPublicKey','getNetwork','getPublicKey'])
 await context.setOffline(true);await panel.getByRole('button',{name:'Verify ticket locally',exact:true}).click()
 await expect(panel.getByText('recipient: pass',{exact:false})).toBeVisible()
 expect(calls).toHaveLength(5)
 await expect(panel.getByRole('button',{name:'Sign test transfer',exact:true})).toHaveCount(0)
})
test('a timed-out read-only recovery can retry without accepting a late request',async({page})=>{
 await page.clock.install()
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey
 const prep=await issueTicketExperiment(wallet,identity,'event','ticket','recovery-timeout')
 let entered=false,release!:()=>void;const held=new Promise<void>(r=>{release=r}),calls:string[]=[]
 await page.route('http://localhost:3321/**',async r=>{
  const name=new URL(r.request().url()).pathname.slice(1) as keyof typeof wallet;calls.push(name)
  if(name!=='getNetwork'&&name!=='getPublicKey'){await r.abort();return}
  const result=await wallet[name](r.request().postDataJSON())
  if(!entered){entered=true;await held}
  await r.fulfill({json:result}).catch(()=>{})
 })
 try{
  await page.goto('/dev/feasibility');const panel=page.locator('.ticket-auth-panel')
  await panel.getByLabel('Trusted venue identity').fill(identity)
  await panel.getByLabel('Load ticket package').setInputFiles({name:'issuance.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(prep.pkg))})
  const button=panel.getByRole('button',{name:'Confirm current-holder request with wallet',exact:true})
  await button.click();await expect.poll(()=>entered).toBe(true);await page.clock.fastForward(60100)
  await expect(panel.getByRole('alert')).toContainText('Read-only wallet check timed out')
  release();await expect(button).toBeEnabled()
  await expect(panel.getByRole('button',{name:'Download receiving request',exact:true})).toHaveCount(0)
  await button.click();await expect(panel.getByRole('button',{name:'Download receiving request',exact:true})).toBeVisible()
  expect(calls.every(c=>c==='getNetwork'||c==='getPublicKey')).toBe(true)
 }finally{release()}
})
test('loads a package/request independently and rejects tampering offline with no wallet calls',async({page,context})=>{
 const f=await ticketFixture(),calls:string[]=[]
 await page.route('http://localhost:3321/**',r=>{calls.push(r.request().url());return r.abort()})
 await page.goto('/dev/feasibility');const panel=page.locator('.ticket-auth-panel')
 await expect(panel.getByRole('heading',{name:'Venue and ticket provenance.'})).toBeVisible()
 await panel.getByLabel('Trusted venue identity').fill(f.identity)
 await panel.getByLabel('Load ticket package').setInputFiles({name:'ticket.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(f.pkg))})
 await panel.getByLabel('Load saved receiving request').setInputFiles({name:'request.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(f.destination))})
 await context.setOffline(true);await panel.getByRole('button',{name:'Verify ticket locally',exact:true}).click()
 await expect(panel.getByText('issuer: pass',{exact:false})).toBeVisible();await expect(panel.getByText('continuity: pass',{exact:false})).toBeVisible();await expect(panel.getByText('recipient: pass',{exact:false})).toBeVisible()
 await expect(panel.getByText('Ticket verification: incomplete',{exact:true})).toBeVisible()
 await panel.getByRole('button',{name:'Check tampered copy',exact:true}).click()
 await expect(panel.getByText('Ticket verification: rejected',{exact:true})).toBeVisible()
 expect(calls).toEqual([])
 await panel.getByLabel('Trusted venue identity').fill('02'+'11'.repeat(32))
 await expect(panel.getByText('Ticket verification: rejected',{exact:true})).toHaveCount(0)
})
test('creates and transfers only after explicit acknowledgements and exports a real signed synthetic package',async({page})=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey,calls:string[]=[]
 await page.route('http://localhost:3321/**',async r=>{const name=new URL(r.request().url()).pathname.slice(1) as keyof typeof wallet;calls.push(name);const fn=wallet[name] as (a:unknown)=>Promise<unknown>;await r.fulfill({json:await fn(r.request().postDataJSON())})})
 await page.goto('/dev/feasibility');const panel=page.locator('.ticket-auth-panel')
 expect(calls).toEqual([]);await expect(panel.getByRole('button',{name:'Issue test ticket',exact:true})).toBeDisabled()
 await panel.getByLabel('Trusted venue identity').fill(identity)
 await panel.getByLabel('I authorize testnet issuance and an attestation signature; wallet inputs may be reserved.').check()
 await panel.getByRole('button',{name:'Issue test ticket',exact:true}).click()
 await expect(panel.getByRole('button',{name:'Download ticket package',exact:true})).toBeVisible()
 await panel.getByRole('button',{name:'Download ticket package',exact:true}).click()
 await panel.getByLabel('I saved the issuance package and disconnected external networking, keeping the local wallet running.').check()
 await panel.getByRole('button',{name:'Sign test transfer',exact:true}).click()
 await expect(panel.getByText('Signed successor package ready.',{exact:true})).toBeVisible()
 const exported=page.waitForEvent('download');await panel.getByRole('button',{name:'Download SPV evidence',exact:true}).click()
 const path=await (await exported).path();expect(readSigningEvidence(await readFile(path!,'utf8')).anchors).toEqual([1])
 expect(calls.filter(c=>c==='createAction')).toHaveLength(2);expect(calls.filter(c=>c==='signAction')).toHaveLength(1)
 await panel.getByRole('button',{name:'Verify ticket locally',exact:true}).click()
 await expect(panel.getByText('continuity: pass',{exact:false})).toBeVisible()
})
test('stalled issuance cannot retry or publish a late result',async({page})=>{
 await page.clock.install();let release!:()=>void;const held=new Promise<void>(r=>{release=r}),wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey
 let mutations=0
 await page.route('http://localhost:3321/**',async r=>{const name=new URL(r.request().url()).pathname.slice(1) as keyof typeof wallet;const fn=wallet[name] as (a:unknown)=>Promise<unknown>;const response=await fn(r.request().postDataJSON());if(name==='createAction'){mutations++;await held}await r.fulfill({json:response}).catch(()=>{})})
 await page.goto('/dev/feasibility');const panel=page.locator('.ticket-auth-panel')
 await panel.getByLabel('Trusted venue identity').fill(identity);await panel.getByLabel('I authorize testnet issuance and an attestation signature; wallet inputs may be reserved.').check();await panel.getByRole('button',{name:'Issue test ticket',exact:true}).click()
 await expect.poll(()=>mutations).toBe(1);await page.clock.fastForward(60100)
 await expect(panel.getByRole('alert')).toContainText('outcome may be unknown');release()
 await expect(panel.getByRole('button',{name:'Issue test ticket',exact:true})).toBeDisabled();await expect(panel.getByRole('button',{name:'Download ticket package',exact:true})).toHaveCount(0)
 expect(mutations).toBe(1)
})

test('restores an imported issuance with a separately loaded buyer request, then signs only after explicit offline acknowledgement',async({page})=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey
 const prep=await issueTicketExperiment(wallet,identity,'event','ticket','restored-transfer'),calls:string[]=[]
 const {Transaction}=await import('@bsv/sdk'),tx=Transaction.fromHex(prep.pkg.lineageRawTxs[0])
 wallet.listOutputs=async args=>{const index=args.basket==='counterfoil-ticket-experiment'?0:1;return {totalOutputs:1,outputs:[{outpoint:`${tx.id('hex')}.${index}`,satoshis:tx.outputs[index].satoshis!,lockingScript:tx.outputs[index].lockingScript.toHex(),spendable:true}]}}
 await page.route('http://localhost:3321/**',async r=>{const name=new URL(r.request().url()).pathname.slice(1) as keyof typeof wallet;calls.push(name);const fn=wallet[name] as (a:unknown)=>Promise<unknown>;await r.fulfill({json:await fn(r.request().postDataJSON())})})
 await page.goto('/dev/feasibility');const panel=page.locator('.ticket-auth-panel')
 await panel.getByLabel('Trusted venue identity').fill(identity)
 await panel.getByLabel('Load ticket package').setInputFiles({name:'issuance.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(prep.pkg))})
 const restore=panel.getByRole('button',{name:'Restore transfer preparation',exact:true})
 await expect(restore).toBeDisabled()
 await panel.getByLabel('Load prepared buyer request').setInputFiles({name:'buyer.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(prep.destination))})
 expect(calls).toEqual([]);await restore.click()
 await expect(panel.getByRole('button',{name:'Sign test transfer',exact:true})).toBeDisabled()
 expect(calls.every(c=>['getNetwork','getPublicKey','listOutputs'].includes(c))).toBe(true)
 await expect(panel.getByLabel('Load ticket package')).toBeDisabled()
 await panel.getByRole('button',{name:'Download ticket package',exact:true}).click()
 await expect(panel.getByRole('button',{name:'Sign test transfer',exact:true})).toBeDisabled()
 await panel.getByLabel('I saved the issuance package and disconnected external networking, keeping the local wallet running.').check()
 await panel.getByRole('button',{name:'Sign test transfer',exact:true}).click()
 await expect(panel.getByText('Signed successor package ready.',{exact:true})).toBeVisible()
 const exported=page.waitForEvent('download');await panel.getByRole('button',{name:'Download ticket package',exact:true}).click()
 const path=await (await exported).path(),pkg=JSON.parse(await readFile(path!,'utf8'))
 expect(pkg.lineageRawTxs).toHaveLength(2);expect(pkg.request).toEqual(prep.destination)
 expect(calls.filter(c=>c==='createAction')).toHaveLength(1)
})

test('captures a failed transfer wallet response without retrying and keeps downloadable diagnostics after local checks',async({page})=>{
 const wallet=syntheticSigningWallet(),identity=(await wallet.getPublicKey({identityKey:true})).publicKey,calls:string[]=[]
 await page.route('http://localhost:3321/**',async r=>{
  const name=new URL(r.request().url()).pathname.slice(1) as keyof typeof wallet,args=r.request().postDataJSON();calls.push(name)
  if(name==='createAction'&&args.inputs?.length){await r.fulfill({status:400,json:{name:'WalletError',code:'TEST_BATCH_STATE',message:'Synthetic reservation is unavailable',stack:'DO_NOT_EXPORT_STACK',privatePayload:'DO_NOT_EXPORT_PAYLOAD'}});return}
  const fn=wallet[name] as (a:unknown)=>Promise<unknown>;await r.fulfill({json:await fn(args)})
 })
 await page.goto('/dev/feasibility');const panel=page.locator('.ticket-auth-panel')
 await panel.getByLabel('Trusted venue identity').fill(identity)
 await panel.getByLabel('I authorize testnet issuance and an attestation signature; wallet inputs may be reserved.').check()
 await panel.getByRole('button',{name:'Issue test ticket',exact:true}).click()
 await panel.getByRole('button',{name:'Download ticket package',exact:true}).click()
 await panel.getByLabel('I saved the issuance package and disconnected external networking, keeping the local wallet running.').check()
 await panel.getByRole('button',{name:'Sign test transfer',exact:true}).click()
 await expect(panel.getByRole('alert')).toContainText('HTTP status 400')
 await panel.getByText('Error details',{exact:true}).click()
 await expect(panel.locator('pre')).toContainText('Synthetic reservation is unavailable')
 await panel.getByRole('button',{name:'Verify ticket locally',exact:true}).click()
 const exported=page.waitForEvent('download');await panel.getByRole('button',{name:'Download failure details',exact:true}).click()
 const path=await (await exported).path(),text=await readFile(path!,'utf8'),data=JSON.parse(text)
 expect(data.failure.phase).toBe('transfer');expect(data.failure.method).toBe('createAction')
 expect(data.failure.walletResponse).toMatchObject({status:400,code:'TEST_BATCH_STATE',message:'Synthetic reservation is unavailable'})
 expect(text).not.toContain('DO_NOT_EXPORT')
 expect(calls.filter(c=>c==='createAction')).toHaveLength(2);expect(calls).not.toContain('signAction')
 await expect(panel.getByRole('button',{name:'Sign test transfer',exact:true})).toBeDisabled()
})
