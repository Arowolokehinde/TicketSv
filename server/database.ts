import type { Pool, PoolClient } from 'pg'
import { readFile } from 'node:fs/promises'
import { requestsCloseAt } from './event-close.ts'

// An idle client disconnect is emitted on the pool; without a listener it would
// terminate the process. The message never includes connection details.
export function handlePoolErrors(pool: Pool, log: (message: string) => void = console.error): void {
  pool.on('error', () => log('PostgreSQL idle connection failed; the pool will reconnect on the next query.'))
}

// Fills closing instants for publications saved before migration 009. A row
// whose date or timezone Node rejects stays null, which listings treat as closed.
export async function backfillRequestsCloseAt(client: PoolClient): Promise<void> {
  const rows = (
    await client.query(
      "SELECT event_id, details->>'date' AS date, details->>'timezone' AS timezone FROM event_publications WHERE requests_close_at IS NULL",
    )
  ).rows
  for (const row of rows) {
    let closeAt: Date | undefined
    try {
      closeAt = requestsCloseAt(row.date, row.timezone)
    } catch {
      continue
    }
    await client.query('UPDATE event_publications SET requests_close_at=$1 WHERE event_id=$2', [closeAt, row.event_id])
  }
}

export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(84723519)')
    await client.query(
      'CREATE TABLE IF NOT EXISTS ticketsv_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    )
    for (const [version, file] of [
      [1, '001-auth-events.sql'],
      [2, '002-venue-issuance.sql'],
      [3, '003-marketplace.sql'],
      [4, '004-header-cache.sql'],
      [5, '005-header-cache-audit.sql'],
      [6, '006-header-prefetch.sql'],
      [7, '007-hosted-auth.sql'],
      [8, '008-received-tickets.sql'],
      [9, '009-publication-close.sql'],
      [10, '010-issuance-owner-ids.sql'],
    ] as const) {
      const applied = await client.query('SELECT version FROM ticketsv_migrations WHERE version = $1', [version])
      if (!applied.rowCount) {
        await client.query(await readFile(new URL(`./migrations/${file}`, import.meta.url), 'utf8'))
        if (version === 9) await backfillRequestsCloseAt(client)
        await client.query('INSERT INTO ticketsv_migrations(version) VALUES ($1)', [version])
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
