import {useEffect,useId,useRef,useState} from 'react'
import {DashboardIcon} from './DashboardIcon.tsx'
import QRCode from 'qrcode'
import jsQRModule, {type QRCode as DecodedQR,type Options as QROptions} from 'jsqr'
// jsQR is CommonJS at runtime; Vite unwraps its default callable export.
const decodeQR = jsQRModule as unknown as (data:Uint8ClampedArray,width:number,height:number,options?:QROptions)=>DecodedQR|null
import {encodeFrames,FrameAssembler} from '../handoff/transport.ts'
import {MAX_PACKAGE_BYTES} from '../tickets/codec.ts'
export function ExchangeExport({value,name}:{value:unknown;name:string}){
 const [show,setShow]=useState(false),[index,setIndex]=useState(0),[play,setPlay]=useState(false),[frames,setFrames]=useState<string[]>([]),[url,setUrl]=useState(''),[error,setError]=useState('')
 const text=JSON.stringify(value)
 useEffect(()=>{setShow(false);setIndex(0);setPlay(false);setError('')},[text])
 useEffect(()=>{let active=true;if(show&&frames[index])void QRCode.toDataURL(frames[index],{errorCorrectionLevel:'M',width:480,margin:4}).then(v=>{if(active)setUrl(v)}).catch(e=>{if(active)setError(String(e))});return()=>{active=false}},[frames,index,show])
 useEffect(()=>{if(!play||!show||frames.length<2)return;const timer=setInterval(()=>setIndex(i=>(i+1)%frames.length),900);return()=>clearInterval(timer)},[play,show,frames.length])
 function download(){const blob=new Blob([text],{type:'application/json'}),link=document.createElement('a'),u=URL.createObjectURL(blob);link.href=u;link.download=`ticketsv-${name}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
 return <div className="handoff-exchange"><div className="actions"><button className="btn" onClick={download}>Save {name} file</button><button className="btn" onClick={()=>{try{setFrames(encodeFrames(text));setIndex(0);setShow(v=>!v);setError('')}catch(e){setError((e as Error).message)}}}>{show?'Hide':'Show'} {name} QR</button></div>{show&&<div className="handoff-qr">{url&&<img src={url} width="320" height="320" alt={`${name} QR frame ${index+1} of ${frames.length}`} />}<p>Frame {index+1} of {frames.length}. Keep scanning until all frames arrive.</p><div className="actions"><button className="btn" disabled={frames.length<2} onClick={()=>setIndex(i=>(i+frames.length-1)%frames.length)}>Previous frame</button><button className="btn" disabled={frames.length<2} onClick={()=>setIndex(i=>(i+1)%frames.length)}>Next frame</button><button className="btn" disabled={frames.length<2} onClick={()=>setPlay(v=>!v)}>{play?'Pause':'Play'} frames</button></div>{frames.length>100&&<p>A file is faster for this large package. Transfer it directly between devices.</p>}</div>}{error&&<p role="alert">{error}</p>}</div>
}
export function ExchangeImport({label,onLoad,disabled=false}:{label:string;onLoad:(value:unknown)=>void|Promise<void>;disabled?:boolean}){
 const fileInput=useRef<HTMLInputElement>(null),fileId=useId()
 const [fileName,setFileName]=useState('No file chosen')
 const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|undefined>(undefined),generation=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),assembler=useRef(new FrameAssembler()),active=useRef(true)
 const [scanning,setScanning]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState('')
 function stop(){generation.current++;stream.current?.getTracks().forEach(t=>t.stop());stream.current=undefined;clearTimeout(timer.current);if(video.current)video.current.srcObject=null;if(active.current)setScanning(false)}
 useEffect(()=>{active.current=true;return()=>{active.current=false;stop()}},[])
 useEffect(()=>{if(disabled)stop()},[disabled])
 function chooseFile(){
  if(disabled||scanning||!fileInput.current)return
  setError('')
  try{
   // Keep the native picker call synchronous with this explicit user click.
   // No promises, wallet checks or other work may consume user activation first.
   if(typeof fileInput.current.showPicker==='function')fileInput.current.showPicker()
   else fileInput.current.click()
  }catch(error){setError(`The browser could not open the local file chooser: ${error instanceof Error?error.message:'try again from Choose File.'}`)}
 }
 async function accept(text:string){if(new TextEncoder().encode(text).length>MAX_PACKAGE_BYTES)throw Error('This file exceeds 4 MiB.');await onLoad(JSON.parse(text))}
 async function scan(){
  stop();assembler.current.reset();setError('');setProgress('');setScanning(true);const session=generation.current
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access is unavailable. Use a file on this device.')
   const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1280}},audio:false})
   if(!active.current||session!==generation.current){media.getTracks().forEach(t=>t.stop());return}
   stream.current=media;const v=video.current!;v.srcObject=media;await v.play()
   const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true})!
   const tick=async()=>{
    if(!active.current||session!==generation.current)return
    try{
     if(v.readyState>=2&&v.videoWidth){const scale=Math.min(1,960/v.videoWidth);canvas.width=Math.floor(v.videoWidth*scale);canvas.height=Math.floor(v.videoHeight*scale);ctx.drawImage(v,0,0,canvas.width,canvas.height);const image=ctx.getImageData(0,0,canvas.width,canvas.height),code=decodeQR(image.data,image.width,image.height,{inversionAttempts:'dontInvert'});if(code){const text=assembler.current.add(code.data);setProgress(`${assembler.current.received} of ${assembler.current.total} frames received`);if(text){stop();await accept(text);return}}}
     timer.current=setTimeout(()=>void tick(),180)
    }catch(e){stop();if(active.current)setError((e as Error).message)}
   }
   if(session===generation.current)void tick()
  }catch(e){stop();if(active.current)setError((e as Error).message)}
 }
 return <div className="handoff-exchange"><div className="handoff-file"><label htmlFor={fileId} className="handoff-file-title"><DashboardIcon name="receive"/>Load {label} file</label><input id={fileId} ref={fileInput} style={{display:'none'}} aria-label={`Load ${label} file`} type="file" accept="application/json,.json" disabled={disabled||scanning} onChange={async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;setFileName(file.name);setError('');try{if(file.size>MAX_PACKAGE_BYTES)throw Error('This file exceeds 4 MiB.');await accept(await file.text())}catch(e){if(active.current)setError((e as Error).message)}}} /><div className="handoff-file-choose"><button type="button" className="btn" aria-label={`Choose ${label} file`} disabled={disabled||scanning} onClick={chooseFile}>Browse local files</button><span className="handoff-file-name">{fileName}</span></div><span className="handoff-file-hint">JSON file · up to 4 MiB</span></div><button className="btn" disabled={disabled} onClick={()=>scanning?stop():void scan()}><DashboardIcon name="scan"/>{scanning?'Stop camera':`Scan ${label} QR`}</button><video className={scanning?'handoff-camera':'handoff-camera hidden'} ref={video} muted playsInline aria-label="Handoff camera preview" />{progress&&<p role="status">{progress}</p>}{error&&<p role="alert">{error}</p>}</div>
}
