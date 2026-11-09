import type {Express} from 'express'
import type {Pool} from 'pg'
import {ApiError} from './events.ts'
import {validateReceivedArchive,archiveIdentity,archiveBinding} from '../src/handoff/archive.ts'

export function receivedTicketRoutes(app:Express,pool:Pool){
 app.post('/api/tickets/received',async(req,res)=>{
  let archive
  try{archive=await validateReceivedArchive(req.body,res.locals.owner)}catch(error){throw new ApiError(400,error instanceof Error?error.message:'Invalid received ticket.')}
  const owner=res.locals.owner,id=archiveIdentity(archive),t=archive.ticket,binding=archiveBinding(t),db=await pool.connect()
  try{
   await db.query('BEGIN')
   // Serialise one account's archive changes. No wallet or publication action.
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,84723522))',[owner])
   const old=await db.query('SELECT id,binding FROM received_ticket_archives WHERE owner_key=$1 AND txid=$2 AND output_index=$3',[owner,t.pkg.current.txid,t.pkg.current.index])
   if(old.rows.some(r=>r.binding!==binding))throw new ApiError(409,'This output already has different signed ticket context. Local evidence is retained.')
   const exists=old.rows.some(r=>r.id===id)
   if(!exists){
    if(old.rowCount!>=64)throw new ApiError(409,'Evidence history limit reached for this output. Local evidence is retained.')
    const count=await db.query('SELECT count(*)::integer AS n FROM received_ticket_archives WHERE owner_key=$1',[owner])
    if(count.rows[0].n>=10000)throw new ApiError(409,'Account evidence archive limit reached. Local evidence is retained.')
    await db.query('INSERT INTO received_ticket_archives(owner_key,id,txid,output_index,binding,evidence) VALUES($1,$2,$3,$4,$5,$6)',[owner,id,t.pkg.current.txid,t.pkg.current.index,binding,archive])
   }
   await db.query('COMMIT');res.status(exists?200:201).json({id,synchronised:true})
  }catch(error){await db.query('ROLLBACK');throw error}finally{db.release()}
 })
 app.get('/api/tickets/received',async(req,res)=>{
  const offset=req.query.offset===undefined?0:Number(req.query.offset)
  if(!Number.isSafeInteger(offset)||offset<0||offset>10000)throw new ApiError(400,'Invalid received ticket page.')
  const result=await pool.query(`SELECT id,txid,output_index,created_at FROM received_ticket_archives WHERE owner_key=$1
   ORDER BY created_at,id LIMIT 26 OFFSET $2`,[res.locals.owner,offset])
  res.json({tickets:result.rows.slice(0,25).map(r=>({id:r.id,txid:r.txid,index:Number(r.output_index),savedAt:r.created_at})),nextOffset:result.rows.length>25?offset+25:null})
 })
 app.get('/api/tickets/received/:id',async(req,res)=>{
  if(!/^[0-9a-f]{64}$/.test(String(req.params.id)))throw new ApiError(404,'Received ticket not found.')
  const row=(await pool.query('SELECT evidence FROM received_ticket_archives WHERE owner_key=$1 AND id=$2',[res.locals.owner,req.params.id])).rows[0]
  if(!row)throw new ApiError(404,'Received ticket not found.')
  res.json(row.evidence)
 })
}
