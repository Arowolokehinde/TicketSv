# TicketSV — Offline Ticket Handoff

A BSV ticket-handoff proof of concept with a native React website. The landing page, ticket-holder workspace, venue workspace and scanner workspace use the approved Counterfoil design. The developer harness contains explicit BRC-100 connection, noSend signing, local SPV and ticket-provenance experiments. Signed wallet sign-in and account-owned event drafts are integrated; ticket issuance, transport and durable ticket acceptance are not yet connected to the product screens. Product sample tickets are explicitly labelled; experiments do not broadcast automatically.

## Run locally

Use Node **22.20.0** (`nvm use`) and npm **11.6.1**. Venue and Dashboard use the Express/PostgreSQL backend. Follow [backend setup and authentication](docs/backend-auth.md) before signing in; the public landing page can run by itself.

```bash
npm ci
npm run dev
```

- Website: <http://localhost:5175/> renders the React landing page directly.
- Dashboard / ticket holder: <http://localhost:5175/tickets>, including receive, transfer and sample evidence pages.
- Venue: <http://localhost:5175/venue>.
- Scanner: <http://localhost:5175/scanner>.
- Developer harness: <http://localhost:5175/dev/feasibility> offers connection, signing, header/SPV and venue-provenance controls. Seven full integration gates remain **Not tested** pending complete live evidence. Nothing contacts a wallet on page load.

Each workspace has `/prepare`, `/headers` and `/activity` pages. Their initial states are real: no wallet connection, stored header snapshot or blockchain operation. Dependent actions are disabled until implemented. The sample collection can be hidden to see the empty state; that display choice is not persisted.

The development server binds only to this machine. Physical-device tests will need a deliberately configured HTTPS origin; localhost does not make this accessible from another device. Existing prototype server port 5173 is left available.

To inspect a production build:

```bash
npm run build
npm run preview
```

Use port **4175** for the built app. Stop a manually running preview before browser tests, which start their own server on that port. Port conflicts fail explicitly rather than silently changing the URL.

## Checks

```bash
npm run test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:browser
```

The default Vitest run skips the PostgreSQL integration suite; run `npm run test:backend` and `npm run test:auth:browser` separately as described in the backend guide. Playwright runs `*.browser.test.ts` against a fresh production build at desktop and phone viewport sizes. Checks cover native page navigation/reloads, workspace separation, sample labelling, disabled unsupported operations, responsive layouts, reduced motion, startup requests and explicit wallet connection, testnet gating, cancellation, timeout and retry in the developer harness. They do not establish offline or blockchain compatibility.

## Preserve the design

The design references are `docs/superpowers/design/counterfoil-ui.html`, `counterfoil.css` and `counterfoil-demo.js`. These remain unchanged. `predev` and `prebuild` copy them to the ignored `public/design/` directory for explicit reference at `/design/counterfoil-ui.html#/`. The website does not redirect there or load its scripts.

Native pages live in `src/ui/`; `src/App.tsx` owns pathname routing. Approved design primitives are ported into `src/styles/base.css` and `approved.css`, with viewport adjustments in `website.css`. The landing's motion control and educational handoff journey use React state. There is no iframe, injected prototype HTML, device frame or design-screen selector.

Navigation uses ordinary links, so browser back, direct URLs and refresh work with Vite. A deployment host must serve `index.html` for product paths such as `/tickets/receive`; preserve static-asset paths. No deployment has been configured. Offline reopening still requires the planned service worker and persistence work.

## Integration boundary

The Create BSV App React starter supplied the foundation. Its relay/auth/server-discovery helpers were omitted after audit. WalletClient uses an explicit local desktop or native bridge transport; wallet access requires an operator action. Local proof verification also uses @bsv/sdk. There is no automatic wallet discovery or remote tracker. The network constant is testnet. The product now uses an Express API, PostgreSQL sessions and organiser event drafts. The reopening experiment has a dedicated offline worker; relay and hosted chain-service integration remain separate. The SPV experiment stores validated header snapshots in IndexedDB.

The architecture uses wallet-held keys and local SPV verification. Explicit header sync requires connectivity; ARC submission is still planned. Offline SPV does not prove current unspentness, and mining evidence does not prevent repeated entrance use. The current header experiment validates a bounded range from a pinned checkpoint without full difficulty-adjustment validation. See the [SPV runbook](docs/local-spv-experiment.md) for exact trust limits.

## Wallet evidence and remaining feasibility work

The online, read-only BSV Desktop check succeeded on testnet from `localhost`. BSV Desktop rejected the IP-address origin `127.0.0.1` for public identity requests. Read the [live evidence and repeatable runbook](docs/feasibility.md) and [compatibility observations](docs/compatibility.md). This does not prove offline signing or any ticket operation.

Continue Task 1 of the [parent implementation plan](docs/superpowers/plans/2026-10-16-offline-ticket.md) for real tests of:

1. BRC-100 wallet connection and exact tested versions.
2. Offline signed PushDrop handoff using `noSend` and final Atomic BEEF.
3. Venue identity signature verification, wrong identity and changed-preimage rejection.
4. Offline closing/reopening and required key/signing access.
5. Direct browser ARC access, status and mined-proof retrieval.
6. Post-broadcast wallet import and lost-response reconciliation.
7. Controlled conflicting transfers and actual outcomes.

The harness cannot mark these gates passed. Record reproducible real evidence before building dependent product integrations or claiming the five live scenes work. Keep private keys, provider secrets and raw wallet storage out of this repository.

The [offline signing runbook](docs/offline-signing-experiment.md) records the earlier app and Desktop wallet failures and the isolated-build experiment. The user's subsequent signing exports passed [independent evidence checks](docs/signing-result-review.md), followed by local SPV at anchor 1,762,325 with zero verification server contacts. Network isolation remains operator-reported; these observations do not close reopening or two-device compatibility gates.

Next live experiment: [venue authenticity and ticket continuity](docs/ticket-authenticity-experiment.md). It creates a fresh same-wallet ticket fixture, verifies the venue's finalized-origin attestation, retains signed ticket lineage after proof compaction, and compares the actual recipient lock with an independently saved request. Synthetic tests cover these checks, but the new live controls still await operator evidence.

See [scaffolding provenance and audit](docs/scaffolding.md), [the website correction plan](docs/superpowers/plans/2026-10-20-counterfoil-website.md), and [the design specification](docs/superpowers/specs/2026-10-16-offline-ticket-design.md).
