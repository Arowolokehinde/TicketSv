import { Pool } from 'pg'
import { PrivateKey, ProtoWallet, type WalletInterface } from '@bsv/sdk'
import { createApp } from '../server/app.ts'
import { migrate } from '../server/database.ts'

if (!process.env.TEST_DATABASE_URL) throw new Error('Run through the disposable PostgreSQL test harness.')
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL })
await migrate(pool)
const server = createApp({ pool, wallet: new ProtoWallet(PrivateKey.fromRandom()) as WalletInterface, origins: () => ['http://127.0.0.1:4175'] }).listen(5197, '127.0.0.1')
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { server.close(() => { void pool.end().then(() => process.exit(0)) }); server.closeIdleConnections() })
