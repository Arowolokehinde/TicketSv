import {useEffect,useId,useRef,useState} from 'react'

const zones=['UTC',...Intl.supportedValuesOf('timeZone')]
const label=(zone:string)=>zone==='UTC'?'UTC — Coordinated Universal Time':zone.replaceAll('_',' ').replaceAll('/',' / ')

export function TimezonePicker({value,onChange}:{value:string;onChange:(zone:string)=>void}){
 const id=useId(),input=useRef<HTMLInputElement>(null)
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(-1),[above,setAbove]=useState(false)
 const options=(zones.includes(value)?zones:[value,...zones]).filter(zone=>label(zone).toLowerCase().includes(query.toLowerCase().trim()))
 function show(){
  if(open)return
  const box=input.current?.getBoundingClientRect()
  setAbove(Boolean(box&&window.innerHeight-box.bottom<270&&box.top>300))
  setQuery('');setActive(-1);setOpen(true)
 }
 function choose(zone:string){onChange(zone);setOpen(false);setQuery('');setActive(-1)}
 useEffect(()=>{
  if(open&&active>=0)document.getElementById(`${id}-${active}`)?.scrollIntoView({block:'nearest'})
 },[open,active,id])
 return <div className="timezone-picker" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget)){setOpen(false);setActive(-1)}}}>
  <label htmlFor={id}>Timezone</label>
  <div className="timezone-input-wrap">
   <input id={id} ref={input} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open?`${id}-options`:undefined} aria-activedescendant={open&&active>=0?`${id}-${active}`:undefined} aria-describedby="event-zone-help" autoComplete="off" value={open?query:label(value)} placeholder="Search city or region…" onFocus={show} onClick={show} onChange={event=>{show();setQuery(event.target.value);setActive(-1)}} onKeyDown={event=>{
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
     event.preventDefault();if(!open){show();return}
     setActive(index=>options.length?event.key==='ArrowDown'?Math.min(index+1,options.length-1):index<0?options.length-1:Math.max(index-1,0):-1)
    }else if(event.key==='Enter'&&open){event.preventDefault();if(active>=0&&options[active])choose(options[active])}
    else if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);setActive(-1)}
   }}/>
   <span className="timezone-chevron" aria-hidden="true">⌄</span>
  </div>
  {open&&<div className={`timezone-menu${above?' timezone-menu-above':''}`}>
   <div className="timezone-menu-caption">Search worldwide timezones</div>
   <div id={`${id}-options`} role="listbox" aria-label="Timezones" className="timezone-options">
    {options.map((zone,index)=><div key={zone} id={`${id}-${index}`} role="option" aria-selected={zone===value} className={active===index?'timezone-option active':'timezone-option'} onPointerDown={event=>event.preventDefault()} onClick={()=>choose(zone)}><span>{label(zone)}</span>{zone===value&&<span aria-hidden="true">✓</span>}</div>)}
    {!options.length&&<p role="status">No matching timezones.</p>}
   </div>
  </div>}
 </div>
}
