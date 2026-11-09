import type { Pool } from 'pg'
import { readFile } from 'node:fs/promises'

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(84723519)')
    await client.query('CREATE TABLE IF NOT EXISTS ticketsv_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    for (const [version, file] of [[1, '001-auth-events.sql'], [2, '002-venue-issuance.sql'], [3, '003-marketplace.sql'], [4, '004-header-cache.sql'], [5, '005-header-cache-audit.sql'], [6, '006-header-prefetch.sql'], [7, '007-hosted-auth.sql'], [8, '008-received-tickets.sql']] as const) {
      const applied = await client.query('SELECT version FROM ticketsv_migrations WHERE version = $1', [version])
      if (!applied.rowCount) {
        await client.query(await readFile(new URL(`./migrations/${file}`, import.meta.url), 'utf8'))
        await client.query('INSERT INTO ticketsv_migrations(version) VALUES ($1)', [version])
      }
    }
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}
