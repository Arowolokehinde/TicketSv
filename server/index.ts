import { Pool } from 'pg'
import { PrivateKey, ProtoWallet, type WalletInterface } from '@bsv/sdk'
import { existsSync } from 'node:fs'
import { createApp } from './app.ts'
import { migrate } from './database.ts'
import { collectHeadersTick, readHeaderWorkState } from './header-cache.ts'
import {prefetchHeaderTarget} from './header-prefetch.ts'
import { startHeaderCollector } from './header-collector.ts'

if (existsSync('.env')) process.loadEnvFile('.env')
const connectionString = process.env.DATABASE_URL
const secret = process.env.AUTH_SERVER_PRIVATE_KEY
if (!connectionString || !secret || !/^[0-9a-f]{64}$/.test(secret)) throw new Error('Set DATABASE_URL and AUTH_SERVER_PRIVATE_KEY in .env. See docs/backend-auth.md.')
const origins = (process.env.APP_ORIGINS ?? 'http://localhost:5175,http://127.0.0.1:5175,http://localhost:4175,http://127.0.0.1:4175').split(',')
for (const value of origins) {
  const url = new URL(value)
  if (url.origin !== value || url.protocol !== 'https:' && !(['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:')) throw new Error('APP_ORIGINS must contain exact HTTPS origins (HTTP allowed on loopback only).')
}
const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 10_000 })
if (process.argv.includes('--migrate')) { await migrate(pool); await pool.end(); console.log('TicketSV database migrations applied.') }
else {
  if(!(await pool.query('SELECT version FROM ticketsv_migrations WHERE version=6')).rowCount){await pool.end();throw Error('Run npm run db:migrate before starting the API: header preparation metadata needs migration 006. Existing header and ticket records are retained.')}
  const key = PrivateKey.fromHex(secret)
  if (key.toHex().padStart(64, '0') !== secret || key.isZero() || BigInt('0x' + secret) >= BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141')) throw new Error('Invalid server authentication key.')
  const app = createApp({ pool, wallet: new ProtoWallet(key) as WalletInterface, origins: () => origins, trustProxy: 'loopback' })
  const port = Number(process.env.API_PORT ?? 5177)
  const server = app.listen(port, '127.0.0.1', () => console.log(`TicketSV API listening on 127.0.0.1:${port}`))
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000
  const stopCollector=process.env.HEADER_COLLECTOR_LOCAL==='1'
   ? startHeaderCollector(()=>readHeaderWorkState(pool),signal=>collectHeadersTick(pool,signal),error=>console.error('Header collector:',error instanceof Error?error.message:'operation failed'),process.env.HEADER_PREFETCH==='0'?undefined:signal=>prefetchHeaderTarget(pool,signal))
   : async()=>{}
  if(process.env.HEADER_COLLECTOR_LOCAL==='1')console.log(process.env.HEADER_PREFETCH==='0'?'Shared header collector enabled; background height discovery disabled.':'Shared header collector enabled with bounded background preparation once per minute.')
  let closing=false
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
   if(closing)return;closing=true
   const stopped=stopCollector()
   server.close(() => { void stopped.then(()=>pool.end()).then(() => process.exit(0)) }); server.closeIdleConnections()
  })
}
