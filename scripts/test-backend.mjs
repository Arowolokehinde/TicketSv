// Disposable PostgreSQL cluster: never connects to an existing user database.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'

const directory = await mkdtemp(join(tmpdir(), 'ticketsv-pg-test-'))
const probe = createServer()
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
const port = probe.address().port
await new Promise(resolve => probe.close(resolve))
let started = false
try {
  execFileSync('initdb', ['-D', join(directory, 'data'), '-U', 'ticketsv_test', '-A', 'trust', '--no-locale'], { stdio: 'ignore' })
  execFileSync('pg_ctl', ['-D', join(directory, 'data'), '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${directory}`, '-w', 'start'], { stdio: 'ignore' })
  started = true
  const command = process.argv.slice(2)
  const child = spawn(command[0] ?? 'npx', command.length ? command.slice(1) : ['vitest', 'run', 'tests/backend.test.ts', 'tests/header-cache.backend.test.ts'], {
    stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: `postgres://ticketsv_test@127.0.0.1:${port}/postgres` },
  })
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal))
  process.exitCode = await new Promise(resolve => child.on('exit', code => resolve(code ?? 1)))
} finally {
  if (started) execFileSync('pg_ctl', ['-D', join(directory, 'data'), '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' })
  await rm(directory, { recursive: true, force: true })
}
