// Isolated optical benchmark. Does not start servers or access wallets/storage.
// Run with Node 22: node --experimental-strip-types scripts/compare-qr-readers.mjs
//   --reference /tmp/phone.png --zxing /tmp/zxing-package --out /tmp/report.json
// The reference is a PNG of an existing TSV2 QR. Keep ticket images out of Git.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib'
import {performance} from 'node:perf_hooks'
import {PNG} from 'pngjs'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import {packCompactTicket,unpackCompactTicket} from '../src/handoff/compact-ticket.ts'

const args=process.argv.slice(2)
function option(name){const at=args.indexOf(name);return at<0?undefined:args[at+1]}
const reference=option('--reference'),zxingDirectory=option('--zxing'),output=option('--out')
if(!reference||!zxingDirectory||!output){
 console.error('Required: --reference <PNG> --zxing <extracted zxing-wasm package> --out <JSON>')
 process.exit(1)
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const original=PNG.sync.read(await readFile(reference))
const raw=jsQR(new Uint8ClampedArray(original.data),original.width,original.height,{inversionAttempts:'dontInvert'})
assert(raw,'The reference must be readable by jsQR to establish the original payload.')
const full=Buffer.from(raw.binaryData)
assert.equal(full.subarray(0,5).toString(),'TSV2:','This comparison expects a binary TSV2 ticket.')
const packedFull=brotliDecompressSync(full.subarray(41),{maxOutputLength:4*1024*1024})
assert.equal(packedFull.length,full.readUInt32BE(5))
assert.equal(sha(packedFull),full.subarray(9,41).toString('hex'))
const handoff=unpackCompactTicket(packedFull)
assert(handoff.pkg,'Reference must contain a handoff ticket with an inner proof package.')
const packedDoor=packCompactTicket(handoff.pkg)
assert(packedDoor,'Inner package must support lossless encoding.')
assert.deepEqual(unpackCompactTicket(packedDoor),handoff.pkg)
const compressed=brotliCompressSync(packedDoor,{params:{[constants.BROTLI_PARAM_QUALITY]:11}})
const door=Buffer.alloc(41+compressed.length)
door.write('TSV2:');door.writeUInt32BE(packedDoor.length,5)
door.set(createHash('sha256').update(packedDoor).digest(),9);door.set(compressed,41)
assert.deepEqual(unpackCompactTicket(brotliDecompressSync(door.subarray(41))),handoff.pkg)

// Supply WASM bytes locally, then refuse fetches throughout all decoding.
const reader=await import(pathToFileURL(join(resolve(zxingDirectory),'dist/es/reader/index.js')).href)
const wasm=await readFile(join(resolve(zxingDirectory),'dist/reader/zxing_reader.wasm'))
let fetchAttempts=0
globalThis.fetch=async()=>{fetchAttempts++;throw Error('Network is disabled for this benchmark.')}
const initStart=performance.now()
await reader.prepareZXingModule({overrides:{wasmBinary:wasm},fireImmediately:true})
const initializationMs=performance.now()-initStart

function resize(image,width){
 const height=Math.round(image.height*width/image.width),data=new Uint8ClampedArray(width*height*4)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const sx=Math.max(0,Math.min(image.width-1,(x+.5)*image.width/width-.5))
  const sy=Math.max(0,Math.min(image.height-1,(y+.5)*image.height/height-.5))
  const x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(x0+1,image.width-1),y1=Math.min(y0+1,image.height-1)
  const fx=sx-x0,fy=sy-y0,at=(y*width+x)*4
  for(let c=0;c<3;c++)data[at+c]=
   image.data[(y0*image.width+x0)*4+c]*(1-fx)*(1-fy)+
   image.data[(y0*image.width+x1)*4+c]*fx*(1-fy)+
   image.data[(y1*image.width+x0)*4+c]*(1-fx)*fy+
   image.data[(y1*image.width+x1)*4+c]*fx*fy
  data[at+3]=255
 }
 return {data,width,height}
}
function blur(image){
 const {width,height}=image,data=new Uint8ClampedArray(image.data.length)
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let sum=0
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   const xx=Math.max(0,Math.min(width-1,x+dx)),yy=Math.max(0,Math.min(height-1,y+dy))
   sum+=image.data[(yy*width+xx)*4]
  }
  const at=(y*width+x)*4;data[at]=data[at+1]=data[at+2]=sum/9;data[at+3]=255
 }
 return {data,width,height}
}
function cameraFrame(image){
 const width=1920,height=1080,data=new Uint8ClampedArray(width*height*4);data.fill(255)
 const left=Math.floor((width-image.width)/2),top=Math.floor((height-image.height)/2)
 for(let y=0;y<image.height;y++)data.set(image.data.subarray(y*image.width*4,(y+1)*image.width*4),((y+top)*width+left)*4)
 return {data,width,height}
}
const cases=[{name:'Supplied phone screenshot',image:original,expected:full}]
for(const width of [472,354])cases.push({name:`Phone screenshot resized to ${width}px wide`,image:resize(original,width),expected:full})
const representations=[]
for(const [name,payload] of [['Complete handoff',full],['Entrance proof package',door]]){
 const segments=[{data:new Uint8Array(payload),mode:'byte'}]
 const qr=QRCode.create(segments,{errorCorrectionLevel:'M'})
 representations.push({name,bytes:payload.length,version:qr.version,modules:qr.modules.size})
 const generated=PNG.sync.read(await QRCode.toBuffer(segments,{errorCorrectionLevel:'M',scale:4,margin:4}))
 cases.push({name:`${name}: exact 2 pixels/module`,image:PNG.sync.read(await QRCode.toBuffer(segments,{errorCorrectionLevel:'M',scale:2,margin:4})),expected:payload})
 for(const width of [240,280,333,416]){
  const image=resize(generated,width)
  cases.push({name:`${name}: ${width}px bilinear`,image,expected:payload})
  cases.push({name:`${name}: ${width}px bilinear + blur`,image:blur(image),expected:payload})
 }
 cases.push({name:`${name}: 333px within 1080p frame`,image:cameraFrame(resize(generated,333)),expected:payload})
 cases.push({name:`${name}: 416px within 1080p frame`,image:cameraFrame(resize(generated,416)),expected:payload})
}
const blank={width:400,height:400,data:new Uint8ClampedArray(400*400*4).fill(255)}
cases.push({name:'Blank negative control',image:blank,expected:null})

// Warm both decoders; initialization is reported separately from scan latency.
jsQR(new Uint8ClampedArray(original.data),original.width,original.height,{inversionAttempts:'dontInvert'})
await reader.readBarcodes({data:new Uint8ClampedArray(original.data),width:original.width,height:original.height},{formats:['QRCode'],tryHarder:true,maxNumberOfSymbols:1})
const results=[]
for(const item of cases){
 const engines={}
 for(const engine of ['jsQR','ZXing']){
  const times=[];let correct=0,wrongPayloads=0,errors=0
  for(let run=0;run<3;run++){
   const image={data:new Uint8ClampedArray(item.image.data),width:item.image.width,height:item.image.height}
   const start=performance.now();let bytes=null
   try{
    if(engine==='jsQR'){
     const decoded=jsQR(image.data,image.width,image.height,{inversionAttempts:'dontInvert'})
     if(decoded)bytes=Buffer.from(decoded.binaryData)
    }else{
     const decoded=await reader.readBarcodes(image,{formats:['QRCode'],tryHarder:true,maxNumberOfSymbols:1})
     if(decoded[0]?.isValid)bytes=Buffer.from(decoded[0].bytes)
    }
    if(item.expected===null?!bytes:bytes?.equals(item.expected))correct++
    if(bytes&&(!item.expected||!bytes.equals(item.expected)))wrongPayloads++
   }catch{errors++}
   times.push(performance.now()-start)
  }
  engines[engine]={correctRuns:correct,runs:3,wrongPayloads,errors,medianMs:Number(times.sort((a,b)=>a-b)[1].toFixed(2))}
 }
 results.push({name:item.name,width:item.image.width,height:item.image.height,negativeControl:item.expected===null,engines})
 console.log(`${item.name}: jsQR ${engines.jsQR.correctRuns}/3; ZXing ${engines.ZXing.correctRuns}/3`)
}
assert.equal(fetchAttempts,0,'A decoder attempted to use the network.')
assert(results.every(r=>Object.values(r.engines).every(e=>!e.wrongPayloads&&!e.errors)),'Decoder error or incorrect payload encountered.')
const report={
 createdAt:new Date().toISOString(),scope:'Optical comparison only; no physical webcam, signature, SPV or admission verdict is established.',
 referenceImageSHA256:sha(await readFile(reference)),
 versions:{node:process.version,jsQR:'1.4.0',zxing:reader.ZXING_WASM_VERSION},
 wasm:{bytes:wasm.length,sha256:sha(wasm),initializationMs:Number(initializationMs.toFixed(2))},
 networkFetchAttempts:fetchAttempts,entrancePackageRoundtrip:'Exact equality with original inner ticket package',
 methodology:'Three runs per case on identical pixels; generated medium-correction QR with four-module margin; deterministic bilinear resizing and 3x3 box blur; no perspective, glare or actual camera noise simulated.',
 representations,results,
 summary:Object.fromEntries(['jsQR','ZXing'].map(engine=>[engine,{
  positiveCases:results.filter(r=>!r.negativeControl).length,
  positiveCasesDecoded:results.filter(r=>!r.negativeControl&&r.engines[engine].correctRuns===3).length,
  blankRejected:results.filter(r=>r.negativeControl).every(r=>r.engines[engine].correctRuns===3),
 }]))
}
if(args.includes('--browser')){
 const {build}=await import('vite'),{chromium}=await import('@playwright/test')
 const directory=await mkdtemp(join(tmpdir(),'ticketsv-qr-browser-'))
 let browser
 try{
  const entry=join(directory,'entry.js')
  await writeFile(entry,`import {prepareZXingModule,readBarcodes} from ${JSON.stringify(join(resolve(zxingDirectory),'dist/es/reader/index.js'))};window.QRBenchmark={prepareZXingModule,readBarcodes};`)
  const built=await build({configFile:false,publicDir:false,logLevel:'silent',build:{write:false,minify:true,lib:{entry,name:'QRBenchmark',formats:['iife']}}})
  const result=Array.isArray(built)?built[0]:built
  assert('output' in result)
  const bundle=result.output.filter(item=>item.type==='chunk').map(item=>item.code).join('\n')
  browser=await chromium.launch({headless:true})
  const context=await browser.newContext(),page=await context.newPage()
  let requests=0
  await context.route('**/*',route=>{
   if(route.request().isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<div>Isolated QR comparison</div>'})
   requests++;return route.abort()
  })
  await page.goto('https://ticketsv-qr-benchmark.test')
  await context.setOffline(true)
  await page.addScriptTag({content:bundle})
  const inputs=cases.filter(item=>['Supplied phone screenshot','Phone screenshot resized to 472px wide','Entrance proof package: 333px within 1080p frame','Blank negative control'].includes(item.name))
  report.browser=await page.evaluate(async({wasm,inputs})=>{
   let fetchAttempts=0
   globalThis.fetch=async()=>{fetchAttempts++;throw Error('Browser network disabled.')}
   await window.QRBenchmark.prepareZXingModule({overrides:{wasmBinary:Uint8Array.from(atob(wasm),c=>c.charCodeAt(0))},fireImmediately:true})
   const results=[]
   for(const input of inputs){
    const image=new Image();image.src='data:image/png;base64,'+input.png;await image.decode()
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0)
    const found=await window.QRBenchmark.readBarcodes(ctx.getImageData(0,0,image.width,image.height),{formats:['QRCode'],tryHarder:true,maxNumberOfSymbols:1})
    const bytes=found[0]?.isValid?Array.from(found[0].bytes):null
    results.push({name:input.name,correct:JSON.stringify(bytes)===JSON.stringify(input.expected)})
   }
   return {userAgent:navigator.userAgent,offline:navigator.onLine===false,fetchAttempts,results}
  },{
   wasm:wasm.toString('base64'),
   inputs:inputs.map(item=>({
    name:item.name,
    png:PNG.sync.write({width:item.image.width,height:item.image.height,data:Buffer.from(item.image.data)}).toString('base64'),
    expected:item.expected?Array.from(item.expected):null,
   })),
  })
  report.browser.interceptedNonNavigationRequests=requests
  assert.equal(report.browser.fetchAttempts,0)
  assert.equal(requests,0)
  assert.equal(report.browser.offline,true)
  assert(report.browser.results.every(result=>result.correct),'Offline browser decoded incorrect or missing payload.')
  console.log('Offline Chromium check: all four cases matched expected bytes/results; no network requests.')
 }finally{await browser?.close();await rm(directory,{recursive:true,force:true})}
}
await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600})
console.log(JSON.stringify({summary:report.summary,report:resolve(output)}))
