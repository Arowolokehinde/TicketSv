# Signed sign-in and organiser events

TicketSV now has a TypeScript/Express API and PostgreSQL event storage. The landing page remains public. Venue and Dashboard require a signed-in session; direct URLs and event API requests enforce the same boundary. Scanner and developer experiments remain separate.

This integration saves private event drafts. It does not publish events, issue tickets, move funds, import wallet records, deploy Chaintracks or create a marketplace. Earlier anonymous IndexedDB event drafts are left untouched and are not assigned to whichever wallet signs in first.

## Start locally

Use Node 22.20.0 and npm 11.6.1. This development machine uses the existing PostgreSQL server on `127.0.0.1:5432`, with a dedicated `ticketsv` database and login role. The role has no superuser, database-creation or role-management privileges. The gitignored `.env` already points to that database. Docker is not needed for this setup.

With PostgreSQL running, start the API:

```sh
npm run api
```

In another terminal, start the website:

```sh
npm run dev
```

The initial migrations have been applied. Run `npm run db:migrate` when installing new migrations. Stop each project server with Ctrl+C in its terminal; this leaves the existing PostgreSQL service and its other databases alone.

### Alternative: a fresh Docker setup

For a new machine that does not already have a dedicated PostgreSQL database, the setup script and Compose configuration provide an alternative. Start Docker Desktop before the database command. Do not run this sequence for the configured native PostgreSQL setup above.

```sh
npm ci
npm run backend:setup
docker compose up -d --wait db
npm run db:migrate
npm run api
```

In another terminal:

```sh
npm run dev
```

Open `http://localhost:5175/`. The existing desktop wallet was tested with the `localhost` hostname, so use that rather than switching to `127.0.0.1`. Click Venue or Dashboard, choose your testnet wallet, then select **Connect and sign in**. The wallet may request authentication permissions. After sign-in, open Venue → Create event → Save draft. Reload to check persistence. Account → Sign out ends the server session.

`backend:setup` exclusively creates a gitignored, mode-0600 `.env` with a generated application authentication key and database password. It refuses to overwrite an existing `.env`. Its key is an API service identity, not your personal wallet key. No wallet is contacted by this script. Never paste wallet recovery phrases or private keys into TicketSV or its configuration.

The database binds to `127.0.0.1:5433`, API to `127.0.0.1:5177`, and website to `127.0.0.1:5175`. Compose keeps PostgreSQL data in the `ticketsv_database` volume. `docker compose stop db` stops it without removing data. Do not use `down -v` if you want to keep the drafts. An independently managed PostgreSQL database can be used by setting `DATABASE_URL` to a dedicated TicketSV database before running migrations.

For the existing production preview workflow, keep API and database running and use:

```sh
npm run build
npm run preview -- --port 5175
```

Stop the development server before using the same port for preview. Both Vite modes proxy `/api` and `/.well-known/auth` without changing their public origin or signed paths. Plain `npm run preview` uses 4175. The setup includes both local ports in `APP_ORIGINS`.

## Authentication boundary

- `@bsv/auth-express-middleware` 2.2.10 verifies BRC-103/104 authentication using the existing SDK 2.8.11. Generated-wallet integration tests exercise the real middleware, protocol signatures and PostgreSQL storage.
- A five-minute login nonce is bound to an HttpOnly browser cookie and exact configured origin. Consumption and session creation happen in one transaction. Replays and expired challenges fail.
- Each attempt has a separate random cancellation capability stored hashed. Cancelling revokes that attempt even if its session creation just committed, without logging out a newer attempt in another tab. If the network prevents confirmation, the UI reports an unknown outcome rather than claiming cancellation succeeded.
- Login's wallet adapter permits only public-key, signature and HMAC operations. Payment responses are rejected; transaction, import and spend methods are unavailable through that adapter. The browser checks the selected wallet's testnet setting and public identity before signing. Keys themselves are not network-specific; the session's testnet field describes this application's policy.
- Opaque random session tokens are stored hashed in PostgreSQL. Cookies are HttpOnly, SameSite=Strict, and Secure on HTTPS origins. Sessions last eight hours, with explicit logout and no silent wallet reconnection.
- This proves control of a wallet identity. It does not verify a real-world venue, establish organiser accreditation or prove ownership of a particular ticket.

## Event storage and access

The server derives the owner from the authenticated session. Create/update requests additionally carry the intended identity, preventing a stale editor from writing into a different account after a cookie change. The client discards stale responses and remounts account-owned UI when the identity changes.

Creation uses an owner-scoped request ID so a retry after a lost response returns the existing draft; changed data under the same request ID is rejected. Updates require the current revision, preventing one tab from silently overwriting another. Lists contain at most 25 events per page and omit image bodies; image and edit-detail endpoints check ownership. Images are limited to 2 MB PNG/JPEG/WebP, with MIME/signature validation. Event fields are validated on both sides. No public asset or event endpoint is introduced.

## Deployment and future modules

### Vercel compatibility

Vercel is a viable deployment target, but the current local setup has not been deployed or validated there. PostgreSQL does not prevent deployment: use a hosted PostgreSQL database through a provider such as Neon or Supabase, or another reachable managed PostgreSQL service. The laptop's `127.0.0.1:5432` database remains for local development. See [Vercel's PostgreSQL integrations](https://vercel.com/docs/postgres).

Vercel supports [Express applications as Vercel Functions](https://vercel.com/docs/frameworks/backend/express). Before deploying this repository:

- Configure the Vite frontend and Express entry point/routing together, preserving `/api` and `/.well-known/auth` on the intended public origin. The local Vite proxy alone is not production routing.
- Configure hosted database credentials, a stable server authentication key and exact HTTPS origins as server-side environment variables. Use separate development, preview and production databases/secrets; do not expose them through `VITE_` variables.
- Adapt the existing `pg` pool for function suspension and provider connection limits using [Vercel's connection-pooling guidance](https://vercel.com/kb/guide/connection-pooling-with-functions), and run migrations as a controlled deployment step.
- Resolve process-local BRC authentication handshake state and rate limits before relying on multiple function instances. PostgreSQL application sessions already persist, but the current `SessionManager` and rate-limit map do not share state between instances. Validate an appropriate shared-state implementation, or host the API on a persistent service behind same-origin routing while using Vercel for the frontend.
- Validate deployed HTTPS wallet connectivity, signed request paths, cookie/origin and proxy handling, login across instances/restarts, and event persistence before declaring deployment ready.

No Vercel deployment or hosted database provisioning has been performed. Any future continuous Chaintracks synchronization worker needs a separately assessed runtime; frontend hosting does not establish support for a continuously running worker.

This is a single API process with modular authentication, event and database code. PostgreSQL sessions survive process restarts; in-flight BRC handshake state and rate limits are bounded in-process. Before running multiple replicas, provide shared protocol/rate-limit state or a deliberate affinity strategy.

For deployment, terminate HTTPS at a trusted reverse proxy, preserve Host and signed request paths, proxy both API/auth routes, and set an exact HTTPS `APP_ORIGINS` allowlist. The API trusts loopback proxy addresses only; a public reverse proxy must overwrite forwarded client-address headers and prevent direct external access to the API. Apply edge rate limits as well. Configure managed secrets and PostgreSQL TLS/backups/restore tests; do not expose `.env`. Keep authentication keys stable across ordinary restarts. No deployment is performed by this implementation.

A future Chaintracks module can provide cached header synchronization behind an adapter. It must not make an online login necessary for already-prepared local ticket evidence verification, and it does not automatically supply full difficulty-adjustment or best-chain validation. Existing checkpoint/DAA limits remain unchanged. Ticket issuance, settlement reconciliation and public event discovery can be added as separate API modules with their own authorization and idempotency rules.

## Checks and limits

```sh
npm run test
npm run typecheck
npm run build
npm run test:backend
npm run test:auth:browser
npx playwright test tests/website.browser.test.ts tests/workspace-wallet.browser.test.ts tests/venue-events.browser.test.ts
```

`test:backend` and `test:auth:browser` need PostgreSQL's `initdb`, `pg_ctl` and `postgres` on PATH. They create and remove a temporary cluster on a separate port; they never use `DATABASE_URL` or the user's database. Browser authentication tests use generated software keys through an intercepted wallet transport. They do not contact a real wallet, request real signatures, issue tickets or broadcast transactions. The auth browser suite runs a temporary API on 5197 and preview on 4175. The normal UI suite uses API fixtures; it is not evidence of cryptographic authentication.

Real Desktop/Browser wallet interoperability and a deployed HTTPS environment still need operator testing. Existing offline experiments remain the place to evaluate offline wallet access and ticket verification; online account drafts are not a replacement for those experiments.

## Venue ticket issuance

A saved event now has **Issue ticket**. This first integration issues one testnet ticket to a receiving key in the connected organiser wallet. It does not yet deliver to an independently controlled buyer wallet or populate the Dashboard.

1. Open Venue, choose an event's Issue ticket, then Review new ticket. This reads the wallet identity/network/receiving key and saves the event revision and receiving request; it does not create a transaction.
2. Review the recipient and funding explanation. Explicitly authorize the one-satoshi ticket output, wallet-selected funding/fees, broadcast and venue attestation, then choose Issue and broadcast ticket.
3. The ticket package, receiving request and issuance record can optionally be exported under Downloads and records. The wallet creates/broadcasts once; the venue signature follows. A failed signature or lost response may leave a broadcast issuance, so pending attempts cannot be retried automatically.
4. Use Refresh mining evidence to read wallet proof data, then Verify ticket. This checks local evidence first and automatically downloads missing headers from the existing two sources when online, saves validated progress, and verifies again. Progress and cancellation stay on Venue; no JSON export or feasibility-page visit is required. Saved headers are reused, including for offline checks. An offline device with missing headers remains incomplete and is asked to reconnect. Invalid evidence is rejected without fetching headers. A saved package or wallet mining response alone is not a verified mining result. The existing checkpoint/range and two-source rules remain unchanged; a changed boundary or invalid stored snapshot still requires reviewed recovery.

Migration 002 adds `venue_issuances` to the dedicated TicketSV database. Attempts are account-owned, retain the event snapshot and use a one-way execution claim; concurrent tabs cannot both claim the same attempt. One unresolved attempt blocks further issuance for that event. The event remains a private draft: issuing does not publish an event listing.

The existing signature format binds the event ID, ticket ID and original output, not all display metadata. The browser retains a separate IndexedDB evidence recovery copy. **Save existing evidence again** uploads existing bytes only and makes no wallet request. Unknown outcomes require manual review; no reset, rebroadcast or automatic wallet import is provided. Local verification retains the existing checkpoint/difficulty/best-chain limitations.

Validation uses a synthetic wallet and disposable PostgreSQL. The operator must perform the actual isolated-wallet issuance. No live testnet issuance was performed by the coding agent.
