import {expect,it,vi} from 'vitest'
import {Pool} from 'pg'
import {handlePoolErrors} from '../server/database.ts'

// An idle PostgreSQL disconnect is emitted as a pool 'error' event. Without a
// listener Node treats it as unhandled and the local API process exits.
it('keeps the process alive and logs only a generic message for idle pool errors',async()=>{
 const pool=new Pool({connectionString:'postgres://user:secret@127.0.0.1:1/ticketsv'}),log=vi.fn()
 handlePoolErrors(pool,log)
 expect(()=>pool.emit('error',new Error('Connection terminated unexpectedly: postgres://user:secret@host'))).not.toThrow()
 expect(log).toHaveBeenCalledWith('PostgreSQL idle connection failed; the pool will reconnect on the next query.')
 await pool.end()
})
