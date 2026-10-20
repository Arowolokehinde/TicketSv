# Counterfoil — Offline Ticket Handoff

A BSV ticket-handoff proof of concept, currently at the frontend-scaffolding stage. The reviewed Counterfoil interface uses **demo data**. No real ticket is minted, verified, saved, transferred or broadcast by this scaffold.

## Run locally

Use Node **22.20.0** (`nvm use`) and npm **11.6.1**. There is no application backend or environment-secret requirement.

```bash
npm ci
npm run dev
```

- Design preview: <http://127.0.0.1:5175/> redirects to the unchanged 35-screen HTML prototype.
- Developer harness: <http://127.0.0.1:5175/dev/feasibility> lists seven integration gates as **Not tested**.

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

Vitest runs unit tests only. Playwright runs `*.browser.test.ts` against a fresh production build at desktop and phone viewport sizes. The browser checks verify unchanged prototype assets, entry routes and an inert developer harness with no wallet/API connections. They do not establish offline or blockchain compatibility.

## Preserve the design

The sources of truth are `docs/superpowers/design/counterfoil-ui.html`, `counterfoil.css` and `counterfoil-demo.js`. `predev` and `prebuild` copy exactly these files to the ignored `public/design/` directory. Do not edit those generated copies. Existing colours, typography, interactions and demo labels are preserved byte for byte; React product-screen migration comes later.

The React application currently contains the redirect, development-only not-found recovery, and developer harness. Product routes `/tickets`, `/venue` and `/scanner` are still available **inside the prototype as hash routes**, not as implemented React product pages. Example: `/design/counterfoil-ui.html#/scanner`.

## Integration boundary

The Create BSV App React starter supplied the foundation. Its relay/auth/server-discovery helpers were omitted after audit; @bsv/sdk is installed but no WalletClient or remote tracker is instantiated. The network constant is testnet. No Express server, relay, hosted database, service worker or IndexedDB implementation has been added.

The planned architecture uses wallet-held keys, local ticket/header storage and local SPV verification. Header sync and ARC submission will require connectivity. Offline SPV does not prove current unspentness, and mining evidence does not prevent repeated entrance use. Those are requirements for the following implementation stages, not claims about this scaffold.

## Next: real feasibility evidence

Follow Task 1 of the [parent implementation plan](docs/superpowers/plans/2026-10-16-offline-ticket.md) for real tests of:

1. BRC-100 wallet connection and exact tested versions.
2. Offline signed PushDrop handoff using `noSend` and final Atomic BEEF.
3. Venue identity signature verification, wrong identity and changed-preimage rejection.
4. Offline closing/reopening and required key/signing access.
5. Direct browser ARC access, status and mined-proof retrieval.
6. Post-broadcast wallet import and lost-response reconciliation.
7. Controlled conflicting transfers and actual outcomes.

The harness cannot mark these gates passed. Record reproducible real evidence before building dependent product integrations or claiming the five live scenes work. Keep private keys, provider secrets and raw wallet storage out of this repository.

See [scaffolding provenance and audit](docs/scaffolding.md), [the scaffold plan](docs/superpowers/plans/2026-10-20-counterfoil-scaffolding.md), and [the design specification](docs/superpowers/specs/2026-10-16-offline-ticket-design.md).
