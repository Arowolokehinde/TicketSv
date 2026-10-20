# Counterfoil — Offline Ticket Handoff

A BSV ticket-handoff proof of concept with a native React website. The landing page, ticket-holder workspace, venue workspace and scanner workspace use the approved Counterfoil design. Wallet, SPV, transport and persistence integrations are not implemented yet: no real ticket is minted, verified, saved, transferred or broadcast. Sample tickets are explicitly labelled.

## Run locally

Use Node **22.20.0** (`nvm use`) and npm **11.6.1**. There is no application backend or environment-secret requirement.

```bash
npm ci
npm run dev
```

- Website: <http://127.0.0.1:5175/> renders the React landing page directly.
- Ticket holder: <http://127.0.0.1:5175/tickets>, including receive, transfer and sample evidence pages.
- Venue: <http://127.0.0.1:5175/venue>.
- Scanner: <http://127.0.0.1:5175/scanner>.
- Developer harness: <http://127.0.0.1:5175/dev/feasibility> lists seven integration gates as **Not tested**.

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

Vitest runs unit tests only. Playwright runs `*.browser.test.ts` against a fresh production build at desktop and phone viewport sizes. Checks cover native page navigation/reloads, workspace separation, sample labelling, disabled unsupported operations, responsive layouts, reduced motion, startup requests and the inert developer harness. They do not establish offline or blockchain compatibility.

## Preserve the design

The design references are `docs/superpowers/design/counterfoil-ui.html`, `counterfoil.css` and `counterfoil-demo.js`. These remain unchanged. `predev` and `prebuild` copy them to the ignored `public/design/` directory for explicit reference at `/design/counterfoil-ui.html#/`. The website does not redirect there or load its scripts.

Native pages live in `src/ui/`; `src/App.tsx` owns pathname routing. Approved design primitives are ported into `src/styles/base.css` and `approved.css`, with viewport adjustments in `website.css`. The landing's motion control and educational handoff journey use React state. There is no iframe, injected prototype HTML, device frame or design-screen selector.

Navigation uses ordinary links, so browser back, direct URLs and refresh work with Vite. A deployment host must serve `index.html` for product paths such as `/tickets/receive`; preserve static-asset paths. No deployment has been configured. Offline reopening still requires the planned service worker and persistence work.

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

See [scaffolding provenance and audit](docs/scaffolding.md), [the website correction plan](docs/superpowers/plans/2026-10-20-counterfoil-website.md), and [the design specification](docs/superpowers/specs/2026-10-16-offline-ticket-design.md).
