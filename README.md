# TicketSV

A BSV testnet proof of concept for issuing, transferring and verifying event tickets, including prepared offline handoffs and scanning.

**Live website:** <https://ticketsv.vercel.app>

## Features

- Create and publish events, receive attendee requests and issue tickets.
- Transfer tickets through JSON files or QR codes, with explicit wallet approval.
- Verify issuer signatures, ticket history and mining evidence locally against saved headers.
- Keep offline ticket copies and synchronise received handoffs across devices.
- Scan tickets with a signed-in wallet and prepare time-limited offline scanner access.
- Demonstrate tampered-ticket rejection and controlled conflicting transfers.

Built with React, Vite, Express, PostgreSQL and the BSV SDK. Private wallet keys remain in the wallet.

## How a ticket is verified

Verification runs on the device, against evidence the ticket carries and block headers saved in the browser:

1. **Organiser signature.** The organiser signs the event ID, ticket ID and the ticket's first on-chain output. The device derives the signing key from the organiser's identity (`KeyDeriver('anyone')`, issuance protocol, key ID = that output) and checks the signature.
2. **Ticket history.** The ticket keeps every transfer's raw transaction back to the signed output. Each step must spend the previous ticket output (`Spend.validate`), create exactly one recognised 1-satoshi successor, and keep the original reference.
3. **Mining evidence.** The current transaction travels as Atomic BEEF. Its Merkle proofs are checked against headers saved on the device. Once a transfer is mined, its own proof replaces the ancestors it spent, so the ticket gets smaller. The confirmation screen shows the size before and after: the real test ticket goes from 1.9 KB (3 transactions, 2 mining proofs) to 0.8 KB (1 transaction, 1 mining proof). Those headers are validated from a pinned checkpoint (block 1,762,324): each must link to the previous one and meet its declared proof-of-work target. Headers come from WhatsOnChain and Chaintracks and must agree, or from TicketSV's shared cache when it is enabled.
4. **Verdict.** `verified` when every check passes; `incomplete` when evidence or headers are missing; `rejected` when anything contradicts (wrong signature, broken history, a Merkle root that does not match a saved header).

Each verification report also states the network requests the page made during that check, measured, and the **Activity** page lists them. Verification does not establish that the ticket is still unspent, does not detect a sale the device has not seen, and is not an admission decision. Full difficulty adjustment and best-chain selection are not checked.

## What the demo needs

The brief asked for "no server, no platform". Verification and offline signing need none; the services below support issuing, sign-in, sharing and settlement around them.

| Service | Used for | Needed offline? |
| --- | --- | --- |
| Organiser and attendee wallets (BSV Desktop on localhost, or BSV Browser) | Sign-in, issuing, funding, signing transfers | Yes, for signing: the wallet runs on the device |
| TicketSV website (Vercel, static files) | Loading the app | No, once the offline pages (`/offline/handoff`, `/offline/tickets`, `/scanner`) are cached on the device |
| TicketSV API (Vercel function and Neon PostgreSQL) | Wallet sign-in (BRC-104), events and requests, issuance records, account backup of received tickets, scanner permits, shared header cache | No |
| WhatsOnChain and Chaintracks | Block headers for local verification | No, once the required headers are saved |
| ARC (`arcade-v2-testnet`) | Broadcasting a transfer and fetching its mining proof | No: transfers are signed offline and broadcast later |

Without the API, a device can still verify tickets it already holds, sign a prepared transfer, and exchange tickets by QR or file. It cannot sign in, issue tickets, or back them up to the account.

## Setup time and offline readiness

An offline transfer needs, on the sender's device: the ticket mined, a separate transfer fee output created and mined, block headers saved up to both, and the offline app saved. The **Before you go offline** list on the handoff Prepare step shows each item as done, waiting or to do. A newly issued or received ticket is therefore not ready straight away: plan for **two mining waits**, the ticket and then the fee output, each usually one testnet block (about 10 minutes, but irregular).

Header preparation, measured on 17 November 2026 for 6,497 headers from the checkpoint:

| Source | Requests | Time |
| --- | --- | --- |
| TicketSV shared header cache (enabled in production with `VITE_SHARED_HEADERS=true`) | 13 batches of up to 512, 508 KB | 7.3 s |
| WhatsOnChain and Chaintracks directly (cache disabled or unavailable) | Two per header, paced | About 0.53 s per header: roughly 58 minutes |

If a ticket was mined after the shared cache's newest header, the server collects the missing headers on demand while the signed-in device waits. The header checkpoint (block 1,762,324) is deliberately not moved at releases: a ticket mined below a newer checkpoint could no longer be verified. The shared cache is the setup-time fix. The [demo script](docs/demo-script.md) gives a full two-device timeline and a timing sheet.

**Wallet setup:** use the published **BSV Desktop 3.3.1** ([release](https://github.com/bsv-blockchain/bsv-desktop/releases/tag/v3.3.1), verified against its `SHA256SUMS`), which includes the upstream fix for the 3.1.1 offline signing failure (commit `edf71fac`); 3.1.1 does not. No source build is needed. On a phone, use BSV Browser. Select testnet and approve TicketSV's basket permissions on first use.

## Run locally

Use Node **22.20.0** and npm **11.6.1**.

```bash
npm ci
```

Configure `.env` with:

- `DATABASE_URL`: your PostgreSQL connection string.
- `AUTH_SERVER_PRIVATE_KEY`: a separate 64-character hexadecimal application authentication key, not your wallet key.
- `APP_ORIGINS`: `http://localhost:5175,http://localhost:4175`.

Apply migrations, then start the API:

```bash
npm run db:migrate
npm run api
```

In another terminal:

```bash
npm run dev
```

Open <http://localhost:5175>. The API uses port **5177**. For a production preview, run `npm run build` followed by `npm run preview` and open <http://localhost:4175>.

## Checks

```bash
npx playwright install chromium
npm test
npm run build
```

The build includes TypeScript checks. Test suites:

| Command | What it runs |
| --- | --- |
| `npm test` | Unit tests only: no browser, about 6 seconds. A guard test keeps browser launches out of this suite. |
| `npm run test:ui` | Vitest suites that launch Chromium (`tests/*.ui.test.ts`). |
| `npm run test:browser` | Playwright end-to-end suites (`tests/*.browser.test.ts`); they build with `VITE_DEV_ROUTES=true` and start their own preview server. |
| `npm run test:backend` | API and database tests against a disposable PostgreSQL. |

## Hosted deployment notes

- **Migrate before deploying.** The hosted API refuses to serve until migration 010 exists. Run `npm run db:migrate` against the hosted database, then deploy. Migration 010 makes ticket IDs unique per organiser (see **Ticket IDs** below). Migration 009 stores each publication's request closing time, which is computed in Node from the event's local date and timezone. Listings compare timestamps and never ask PostgreSQL to read timezone names. Publications whose closing time cannot be computed count as closed.
- **Login rate limit.** On Vercel, the API trusts exactly one proxy hop, so each client IP that Vercel writes gets its own in-process count. The limit shared across function instances is the Vercel Firewall rule **TicketSV login rate limit**, active on the production project (checked 24 November 2026). A new deployment needs the same rule:
  - **Condition:** path matches `^/(api/auth/(challenge|login|logout|scanner-permit)|\.well-known/auth)$`
  - **Action:** rate limit, keyed by IP, fixed window of 60 seconds, 120 requests, responding with 429.

  Vercel counts each edge region separately.
- **Shared header ranges.** Complete header batches below the saved tip are immutable, so `/api/headers/range` marks them cacheable at Vercel's CDN for a week. The batch at the tip is never cached. Each range request reads only its slice of the saved history.
- **Ticket IDs.** Ticket IDs are random UUIDs, unique within each organiser's tickets rather than across all organisers. Creating a ticket checks only the organiser's own tickets, so it never reveals whether another organiser uses an ID. An attendee's ticket is fetched with its event ID, which tells apart two organisers' tickets that share an ID.

## Naming

The project was first called Counterfoil. Everything a person reads, and the code's own names, now say TicketSV. Identifiers that are stored, signed or recorded keep the old prefix on purpose, because renaming them would make existing data unreadable:

- Key-derivation protocol IDs (`counterfoil ticket receiving`, `counterfoil ticket issuance`, `counterfoil conflict fees`): tickets already issued are locked to keys derived from them.
- Browser database, cache, wallet basket and wallet label names, for example `counterfoil-spv-experiment-v1` and `counterfoil-ticket-experiment`: devices and wallets already hold data under them.
- Evidence `kind` values, for example `counterfoil-reopening-evidence`: saved files are validated against them.
- The development screens' download file names, which the published experiment records cite with checksums.

## Development screens

The experiment screens (`/dev/feasibility`, `/dev/reopening`) are built only by `npm run dev` or when `VITE_DEV_ROUTES=true` is set at build time. Production builds leave their code out. The Playwright browser suite builds with the flag on.

## Ticket QR codes

A ticket is shown as **one** QR code that carries the complete ticket evidence; it is never a lookup key for a server.

- `TSV1:` codes hold the ticket JSON compressed (deflate) in alphanumeric mode, up to 3,391 characters (QR version 40, medium error correction).
- `TSV2:` codes hold a compact binary encoding of the ticket compressed with Brotli, up to 2,331 bytes.
- Both carry the length and SHA-256 of the original data, and the scanner rejects a code whose content does not match.
- A ticket too large for one code must be shared as a file. The app says so.
- **Reading:** cameras decode with ZXing (zxing-wasm 3.1.7). Its WASM ships with the app and is cached for offline use, never fetched from a CDN. Each fresh camera frame is decoded as soon as the previous one finishes; a 1080p frame takes about 20 ms. In tests on degraded images ZXing read 11 to 12 of 16 entrance codes where the previous reader (jsQR) read 3 to 7.
- **Door ticket:** the door needs only the ticket package (about 1,200 bytes, QR version 29), not the complete handoff record (about 1,950 bytes, version 37). The handoff's receive and Confirm steps offer both: **door ticket** for the entrance, **updated ticket** for the buyer.
- **Show to scanner** opens a code full screen, as large as the screen allows, and keeps the screen awake where the browser supports it. Error correction stays at level M: level L gained one read in sixteen and loses tolerance for screen glare.

The scanner also reads the older multi-frame sequences: 1,000-byte frames shown one after another, every frame required (at most 4,096), assembled and checked against a SHA-256 of the whole package. This is not BRC-141 fountain coding: there is no redundancy, so a missed frame must be scanned again. See `src/handoff/static-qr.ts`, `src/handoff/ticket-qr-payload.ts` and `src/handoff/transport.ts`.

## At the door

The scanner keeps a memory of what it admits, on the scanner device only, for the prepared event. A ticket is identified by its event and its original issuance, which every transfer and both copies of a double sale share.

- The door admits only a mined ticket. After **Verify locally**, **Admit** appears only when the ticket's latest transfer is proven mined against the scanner's saved headers (**Passes POC door policy**), and it is admitted as **Admitted**.
- An unmined transfer shows **Online check required** and **Not admitted**. The holder must publish it, wait for mining, select **Verify mining evidence** and show the updated door ticket. Rejected and incomplete tickets are never admitted.
- The result shows the size of the ticket checked, for example **Ticket evidence: 0.8 KB · 1 transaction · 1 mining proof**.
- A mined ticket must also be unspent. Mining proves a copy was real once, not that it is still current. A seller who resold a ticket still holds their earlier mined copy, and its output is now spent.
  - Online, the door asks WhatsOnChain whether the ticket's output was spent and checks any reported spending transaction against the ticket's lock. It shows **Spend check: live, not spent** or **Spend check: live, spent**.
  - Offline, it uses the list saved at **Save event and prepare offline** or **Refresh preparation**, which follows every ticket of the event through its transfers. It shows **Spend check: saved list from 18:40**.
  - A spent copy shows **Not admitted: this ticket has been transferred to someone else.**
  - A ticket the door can't check shows **Not admitted: this door can't check whether the ticket was transferred. Reconnect or refresh preparation.** This covers a scanner with no saved list, and a ticket issued after the last refresh.
  - Only the event's organiser can read its ticket list, so only the organiser's scanner saves one (**Ticket transfers: Not saved (organiser only)** otherwise).
  - Limits: an "unspent" answer from WhatsOnChain is trusted, because no second source reports spends. The saved list misses resales mined after the last refresh, so refresh just before doors open. The list covers the event's latest 100 tickets.
- Any later copy of an admitted ticket is refused: **Already admitted at this door at 19:42**. A different copy adds **This is a different copy of the same ticket. It may have been sold twice.** and is kept as evidence. There is no re-entry.
- Back online, **Check admitted tickets** asks ARC about every copy and checks each mining proof against the scanner's headers. The admitted copy proven mined is **Confirmed**; another copy proven mined means the admitted ticket **Lost the double sale**, and both transactions are shown. Without a proof, the state stays **Waiting for mining**; only tickets admitted before the door became mined-only can show it. A provider's word alone never confirms or condemns an admission.

This is the PoC's answer to an offline double sale. Offline checks cannot catch it, because both copies are genuine. So the door admits only a mined copy whose output is still unspent, which mining has already decided, and its memory admits one person. Several door devices would each need the others' memory, which needs a network, so the PoC uses one scanner per event.

## Pinned BSV packages

`@bsv/sdk` is pinned at **2.8.11** and `@bsv/auth-express-middleware` at **2.2.10**. Every wallet experiment, the recorded evidence, and the tests were checked against these versions. As of 17 November 2026:

- `@bsv/sdk` 2.8.11 is the last 2.x release. Majors 3.0.0 (3 October 2026) and 4.0.0 (23 October 2026) followed; 4.1.1 is current. The public changelog stops at 2.0.16, so what changed in those majors is not documented.
- `@bsv/auth-express-middleware` 2.4.0 is current and declares support for SDK `^2.8.5 || ^3.0.0 || ^4.0.1`, so upgrading the middleware does not force an SDK upgrade.

Upgrade one package at a time, then run `npm test`, `npm run test:backend`, the browser suite and the live wallet tests (sign-in, issuing, offline handoff, release) before relying on it. Atomic BEEF, PushDrop and BRC-104 behaviour are what matter most here.

## Records

- [Two-device demo script](docs/demo-script.md): timeline, setup and timing sheet.
- [Signing incident report](docs/signing-incident-report.md): the BSV Desktop 3.1.1 offline signing failure and how it was resolved.
- Experiments: [feasibility](docs/feasibility.md), [wallet compatibility](docs/compatibility.md), [offline signing](docs/offline-signing-experiment.md), [signing result review](docs/signing-result-review.md), [local SPV](docs/local-spv-experiment.md), [ticket authenticity](docs/ticket-authenticity-experiment.md), [durable issuance](docs/durable-issuance-experiment.md), [offline reopening](docs/offline-reopening-experiment.md), [wallet import](docs/wallet-import-experiment.md), [ARC submission](docs/arc-submission-experiment.md), [conflicting transfers](docs/conflicting-transfers-experiment.md).
- [Backend authentication](docs/backend-auth.md).

## After a handoff: sender wallet

Offline transfers are built and signed by the app, using the wallet's PushDrop signatures, then published directly to ARC. This works around a BSV Desktop 3.1.1 defect: a missing batch-resume method breaks the wallet-managed `createAction` (`noSend`) and `signAction` flow (see the [signing incident report](docs/signing-incident-report.md)). Because no wallet action records the spend, the sender's wallet keeps listing the spent ticket (`ticketsv-tickets`) and its fee output (`ticketsv-handoff-fees`).

On the device that signed the transfer, open **Confirm** for that transfer. Verify its mining evidence, then approve **Release spent outputs**. TicketSV checks that the mined transfer spends exactly those two outputs. It then asks the wallet to remove each one from its basket (`relinquishOutput`) and rechecks the wallet. Each outcome is saved, and a declined, cancelled or unanswered request is never retried automatically.

Release only removes outputs from the wallet's lists. The wallet history will not show the transfer as an outgoing spend. Release does not prevent a dishonest sender from signing a second, conflicting transfer before the first is mined.

Release worked live on 18 November 2026 with BSV Desktop: both spent outputs of a mined transfer were removed (Test 2 of the live test guide). Wallet support beyond that, from source inspection:

| Wallet | `relinquishOutput` |
| --- | --- |
| BSV Desktop 3.3.1 (published 23 October 2026; use this for the demo) | Routed through the local HTTP port, the permission manager (basket removal access) and storage |
| BSV Desktop 3.2.2 (source build used during development) | Routed the same way |
| BSV Browser 1.6.3 and 1.8.0 | Routed through the native bridge and permission manager |

Your wallet may ask permission once for each basket.

New handoffs first ask the wallet to build and record the transfer itself (`createAction` with `noSend`, then `signAction`). The wallet then marks the ticket and fee outputs as spent when they are signed, and completes the action once mining is found. The dedicated fee output is sized for BSV Desktop's 250 sat/kB rate (about 150 testnet satoshis), so the wallet adds no change or inputs of its own. If the wallet's transaction is not exactly the ticket and fee in, with one ticket out, TicketSV cancels the unsigned action and signs the transfer itself, and the release step above applies.

## Stuck ticket issuance

An issuance attempt is marked started before the wallet is asked to create the ticket. If the wallet prompt is declined or times out, the attempt shows **Check wallet**. TicketSV asks the organiser wallet for transactions labelled `ticketsv-issuance-<ticketId>` (`listActions`). If none exists, or every one failed, the attempt returns to approval with the same ticket ID. If one exists, its transaction ID is saved instead. The server resets an attempt only while no transaction ID is saved. The venue signature is requested only after that ID is saved, so a late wallet transaction can never verify as a second ticket.

An attempt whose transaction ID is saved but whose evidence never reached the server shows **Recover ticket**. This happens when the signature prompt is declined or times out after the transaction was created, when the wallet's reply is lost and **Check wallet** finds only the transaction ID, or when the evidence save fails on another device. If this device still holds the evidence, it shows **Save existing evidence again** instead.

**Recover ticket** creates no transaction. TicketSV fetches the transaction and its parents' BEEF from WhatsOnChain and rebuilds the unmined ticket evidence. The bytes must hash to the saved transaction ID, and the one 1-satoshi output must pay the reviewed recipient. The organiser's wallet then signs the ticket again. Signing is deterministic, so the package equals any copy that was lost. The evidence is saved through the normal route, which still accepts only unmined first evidence with its scripts checked.

If WhatsOnChain does not know the transaction, **Check for a failed transaction** appears. Only when the organiser's wallet reports that transaction as failed, and the network still does not know it, does the attempt return to approval (the server clears the transaction ID only when it is named). A failed transaction never reaches the chain, so any signature made for it names an output that never exists.

## Offline use and verification limits

**On this device** (`/offline/tickets`) is the offline home: each saved ticket with its status (Current, Sent, Received, In your wallet, and whether mining is verified), handoffs in progress with their next step, the activity log, and whether the browser keeps TicketSV's data. **Remove all from this device** keeps anything whose wallet, signing or publishing step is unfinished or unknown, and says why.

One offline worker (`ticketsv-offline-worker.js`, scope `/`) saves the app (about 3 MB) in the background on any online visit. Offline, the handoff, saved-ticket and scanner pages open from that copy, and any other page sends you to **On this device**; `/api` is never answered from it. A new version shows **Update available. Reload when you're ready.** only once it is completely saved, and **Reload** (never automatic) reloads every TicketSV tab together. The previous version's files stay until the next update. Saving a ticket or headers asks the browser to keep TicketSV's data permanently; browsers decide. Where a browser cannot run the worker (some in-app browsers), keep the page open and don't reload it until back online.

Sign in and prepare the device online before disconnecting. Scanner authorisation expires with the current session, after at most eight hours. Ticket evidence, account backups and wallet registration are separate records.

Local SPV verification does not establish current unspentness, prevent an unseen double-sale or guarantee admission. Header validation retains checkpoint, linkage and declared-target proof-of-work checks; full difficulty adjustment and best-chain selection are outside this POC. Physical-device and wallet testing remain necessary before claiming live compatibility.
