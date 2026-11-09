import { writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { PrivateKey } from '@bsv/sdk/primitives'

const password = randomBytes(24).toString('hex')
const content = `# Local TicketSV service credentials. Never commit this file.\nPOSTGRES_PASSWORD=${password}\nDATABASE_URL=postgres://ticketsv:${password}@127.0.0.1:5433/ticketsv\nAUTH_SERVER_PRIVATE_KEY=${PrivateKey.fromRandom().toHex().padStart(64, '0')}\nAPP_ORIGINS=http://localhost:5175,http://127.0.0.1:5175,http://localhost:4175,http://127.0.0.1:4175\nAPI_PORT=5177\n`
try { await writeFile('.env', content, { flag: 'wx', mode: 0o600 }); console.log('Created .env for the TicketSV API. No wallet was accessed.') }
catch (error) { if (error.code === 'EEXIST') throw new Error('.env already exists; it was not changed. Configure the backend values manually.'); throw error }
