# Counterfoil Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a reproducible React/TypeScript BSV development foundation without overwriting or redesigning the approved Counterfoil prototype.

**Architecture:** Generate the React-only starter in a temporary sibling directory and promote only audited application files. Keep the existing prototype as the visual source of truth, served as an unchanged static design preview; the React entry exposes a development-only integration harness. Port individual product screens to native React in subsequent integration tasks, rather than disguising the existing HTML as React components.

**Tech Stack:** Create BSV App 1.1.2; React, TypeScript, Vite, @bsv/sdk; npm lockfile; Vitest and Playwright. No application server.

**Spec:** [Offline Ticket design specification](../specs/2026-10-16-offline-ticket-design.md), [approved visual direction and review record](../design/counterfoil-direction.md), and [parent implementation plan, Task 1](2026-10-16-offline-ticket.md#task-1-prove-the-walletbrowser-path-and-establish-reproducible-fixtures).

## Global Constraints

Copied from the governing specification; these constrain subsequent integration as well as scaffold decisions:

- Use TypeScript, React, @bsv/sdk, BRC-100 WalletClient, BSV Desktop/BSV Browser, and ARC.
- Both seller and buyer must be offline during handoff; the scanner must be offline during door verification.
- Support the same receiving request and ticket package through QR and file exchange.
- Do not introduce an application backend, relay, Message Box, or remote verification fallback.
- The app must never obtain or export wallet private keys.
- Store accepted packages locally before displaying “Verified offline — pending broadcast.”
- Support reopening the prepared app and saved packages while offline.
- Store block headers separately from ticket packages; do not transfer headers in QR for this POC.
- Validate header linkage and proof of work; full difficulty-adjustment validation is excluded.
- Pin dependency versions after feasibility testing and record the tested wallet versions.
- Never describe a mined inclusion proof as proof that a ticket is currently unspent.
- Never describe an app-only request log as complete observation of native wallet traffic.

Additional scope decisions: preserve all existing files under `docs/` and `docs-to-read.md`; retain the paper, oxblood and acid-yellow palette; use testnet only; make no wallet calls on application startup. Initial dependency pins are provisional until real compatibility testing. All current demo claims remain explicitly simulated.

## Review Focus

1. Generation into the populated documentation folder must not overwrite the approved prototype — Task 1 baseline checks and Task 2 byte comparisons.
2. Starter wallet defaults may trigger relays, login APIs or auto-connection — Task 1 dependency audit and Task 3 startup network test.
3. A copied preview may work in development but lose its CSS/fixture script after production build — Task 2 built-preview test.
4. Demo flags must never masquerade as wallet readiness or completed feasibility — Task 3 untested-state and no-wallet assertions.
5. Browser tests accidentally included in Vitest, unsupported Node versions, or an untracked dependency update must not produce irreproducible checks — Task 1 runner separation and clean-install checks.

---

## Scope and starting state

There is no package.json, application scaffold or Git repository in this folder. There are planning documents and a reviewed 35-screen prototype:

- `docs/superpowers/design/counterfoil-ui.html`
- `docs/superpowers/design/counterfoil.css`
- `docs/superpowers/design/counterfoil-demo.js`

This plan covers only the scaffolding portion of the parent plan's Task 1. It does **not** complete that feasibility gate or authorize claiming offline signing, durable reopening, camera transport, SPV, ARC access or wallet import works. Those real experiments follow this scaffold, before dependent product work.

No React conversion of all 35 screens is included. During this phase `/` redirects to the preserved design preview; `/dev/feasibility` is the React development harness. There is no iframe, HTML injection into React, or replacement customer-facing homepage. Product routing specified as `/tickets`, `/venue` and `/scanner` will be introduced with native React screen migration; existing preview hash routes remain usable meanwhile.

## Source verification

Checked 2026-10-20:

- [CLI README](https://github.com/bsv-blockchain/ts-stack/tree/main/packages/helpers/create-bsv-app): React starter, non-interactive generation, skip-install, no-glue, network and package-manager flags.
- [Package metadata](https://registry.npmjs.org/create-bsv-app/1.1.2): published version 1.1.2, Node >=22. Local tools: Node v22.20.0 and npm 11.6.1. Record exact runtime versions at execution; Vite may impose a higher minimum.
- [Starter catalogue](https://github.com/bsv-blockchain/ts-stack/blob/main/packages/helpers/create-bsv-app/src/starters.ts): React-only generation is separate from Express/full-stack.

Registry integrity observed for the CLI: `sha512-ev9vHwl0iHJx8XJ5TFVJmAAvSqc0uYiB9SdwGkxQCifVm7QS0tH8WR+uwG850+nU6rrw2KHDuh0jjYnNzMsnOA==`.

The starter can include wallet connectivity helpers; generation does not prove they match this project's no-relay requirements. Audit before installation and execution.

## Files and responsibilities

| File | Responsibility |
|---|---|
| `package.json`, `package-lock.json`, `.npmrc`, `.nvmrc`, `.gitignore` | Reproducible toolchain and scripts |
| `bsv-scaffold.json` | Generator provenance; document promotion from temporary directory |
| `index.html`, `src/main.tsx`, `src/App.tsx`, `vite.config.ts`, `tsconfig*.json` | Static React application foundation and entry routing |
| `src/config/network.ts` | Application-owned testnet constant; no endpoint secrets |
| `src/dev/FeasibilityScreen.tsx` | Untested integration gate list, no live wallet operations |
| `src/dev/feasibility.ts` | Typed gate records |
| `src/styles/tokens.css` | Approved visual tokens for the developer harness |
| `scripts/sync-design-preview.mjs` | Deterministic copy of exactly the three approved preview assets |
| `public/design/` | Generated preview copies, ignored by Git |
| `vitest.config.ts`, `playwright.config.ts` | Separate unit and built-browser test runners |
| `tests/scaffold.test.ts`, `tests/feasibility.test.ts` | Configuration and untested-state checks |
| `tests/design-preview.browser.test.ts`, `tests/scaffold.browser.test.ts` | Preview fidelity, routing and startup network checks |
| `docs/scaffolding.md`, `README.md` | Versions, audit, commands, scope and next feasibility gates |

Keep starter-generated tsconfig filenames. Record a one-time mapping in `docs/scaffolding.md` if entry/config paths differ; normalize the application-owned `src/` paths listed above. Do not retain unused starter logo/UI assets, generated app wiring, unused authentication/server helpers or relay clients.

### Task 1: Produce an audited, reproducible React-only foundation

**Files:** Create the package/config files, provenance manifest, `src/main.tsx`, `src/App.tsx`, `src/config/network.ts`, `vitest.config.ts`, `tests/scaffold.test.ts`, `docs/scaffolding.md`.

**Interfaces:** Consumes existing documentation and the pinned CLI. Produces `export const BSV_NETWORK = 'testnet' as const` in `src/config/network.ts`; generated configuration uses its documented `test` network spelling. Scripts: `dev` (Vite port 5175, strict port), `typecheck` (TypeScript project build with no emitted application files), `build` (typecheck then Vite), `test` (Vitest run). Preserve port 5173 for the existing prototype server.

- [ ] At execution, use the isolation skill. Initialize Git if still absent, establish an explicit documentation baseline commit, and record SHA-256 hashes of the existing files. Keep dependency installation and generated assets out of this baseline.
- [ ] Inspect CLI 1.1.2 help and Node/package requirements. Generate into a unique empty sibling directory with the following command, replacing only the absolute temporary target:

```bash
npx --yes create-bsv-app@1.1.2 new /absolute/temporary/offline-ticket-react --starter react --network test --package-manager npm --skip-install --no-glue --yes
```

- [ ] Read generated instructions, manifest and package.json. Audit every generated import and dependency for relay, server/login, external assets and auto-connect behaviour. Record keep/remove decisions and the original manifest in `docs/scaffolding.md`; retain relevant license notices. Do not execute generated wallet hooks to inspect them.
- [ ] Copy only the audited React configuration, manifest and necessary SDK dependencies into the isolated project. Create `.npmrc` with `save-exact=true`, record the compatible Node version in `.nvmrc`, and install with npm. Save a lockfile. If a generated dependency requires a newer runtime, use that supported runtime and record it rather than ignoring its engine requirement.
- [ ] Configure Vitest to include `tests/**/*.test.ts` and exclude `tests/**/*.browser.test.ts`; add a minimal React entry and application-owned network constant. Remove unused generated UI/wiring and all application-server scripts. No `SERVER_PRIVATE_KEY` or `VITE_API_URL` requirement should survive this frontend-only audit.
- [ ] Add configuration assertions in `tests/scaffold.test.ts`:

```ts
expect(BSV_NETWORK).toBe('testnet');
expect(packageJson.scripts).not.toHaveProperty('dev:server');
expect(packageJson.scripts).not.toHaveProperty('start:server');
```

Also assert that the dependency keys do not include `express`, `@bsv/message-box-client` or `@bsv/wallet-toolbox-client`; these are unnecessary for this scaffold. This denylist supplements the import audit; it does not replace it.

- [ ] Run `npm ci`, `npm run test`, `npm run typecheck`, and `npm run build`. Expect successful exit codes and `dist/index.html`. Confirm the pre-existing document hashes are unchanged. Record resolved React/Vite/SDK/test-runner versions and npm/Node versions.
- [ ] Commit only the task's explicit file list and lockfile: `chore: scaffold audited React BSV foundation`. No wallet keys, credentials, node_modules or build outputs.

### Task 2: Serve Counterfoil unchanged from development and production builds

**Files:** Create `scripts/sync-design-preview.mjs`, `playwright.config.ts`, `tests/design-preview.browser.test.ts`; modify package scripts, `.gitignore`, `src/App.tsx`, `docs/scaffolding.md`.

**Interfaces:** Consumes the three original prototype assets. Produces `/design/counterfoil-ui.html` with its relative stylesheet and script intact. The sync script takes no arguments and copies exactly those three files to `public/design/`. `predev` and `prebuild` run it. Script `test:browser` invokes Playwright; its webServer command builds and serves Vite preview on 127.0.0.1:4175 with strict port, matching only `tests/**/*.browser.test.ts`.

- [ ] Write the failing built-browser test. Load `/`, follow the redirect, assert the existing “The ticket” heading appears and URL is `/design/counterfoil-ui.html#/`. Assert CSS has `--wine: #722f2e` and `--acid: #dce68b`, `DEMO_SCREENS` exists, and the original prototype exposes 35 screens. Expect failure before copying/redirect wiring.
- [ ] Implement the deterministic copy script using Node filesystem APIs. Preserve bytes exactly; never edit originals, fetch assets or copy unrelated documentation. Ignore `/public/design/` and `/dist/` in Git.
- [ ] Implement `App(): React.JSX.Element | null` in `src/App.tsx`: `/dev/feasibility` will render Task 3's harness; until then render a clearly labelled temporary development placeholder there. For `/`, replace the location with `/design/counterfoil-ui.html` plus the current hash or `#/`. Unknown paths show a small development-only not-found message linking to the design preview. Do not introduce product routes or a second visual design.
- [ ] Extend `tests/design-preview.browser.test.ts` to compare HTTP response bodies for all three served assets byte-for-byte against their source files. Assert no failed same-origin asset requests and no `pageerror` during the preview load. Check landing, holder, venue and scanner hashes reload successfully; assert the prototype label remains visible.
- [ ] Run `npm run test:browser -- tests/design-preview.browser.test.ts`. Expect PASS on the built app at desktop 1440×1050 and phone 390×844. Keep this test to asset preservation and entry routing; do not rebuild every prototype interaction test in the scaffolding task.
- [ ] Commit explicit task files: `feat: preserve Counterfoil preview in Vite builds`.

### Task 3: Add the honest feasibility harness and execution handoff

**Files:** Create `src/dev/feasibility.ts`, `src/dev/FeasibilityScreen.tsx`, `src/styles/tokens.css`, `tests/feasibility.test.ts`, `tests/scaffold.browser.test.ts`, `README.md`; modify `src/App.tsx`, `docs/scaffolding.md`.

**Interfaces:** Produces:

```ts
export type FeasibilityGateId =
  | 'wallet-connect' | 'offline-signing' | 'issuer-verification'
  | 'offline-reopen' | 'arc-access' | 'wallet-import' | 'conflicting-transfers';
export type FeasibilityGate = {
  id: FeasibilityGateId;
  label: string;
  status: 'not-tested';
};
export const feasibilityGates: readonly FeasibilityGate[];
export function FeasibilityScreen(): React.JSX.Element;
```

The harness does not let users set a gate to passed. Real pass/fail evidence belongs to the following feasibility work. It imports SDK types only where needed; no WalletClient instance or remote ChainTracker is created during startup.

- [ ] Write `tests/feasibility.test.ts` asserting seven unique IDs and that every gate has status `not-tested`. Run the focused test and confirm it fails before implementation.
- [ ] Implement the records with readable labels and a React list at `/dev/feasibility`. Show “Development harness”, “Testnet”, “Wallet: not connected”, and “Not tested” for each gate. Link to the design preview. Use the existing paper `#efecdf`, card `#faf8ed`, ink `#292a22`, oxblood `#722f2e`, and acid `#dce68b` tokens; system serif/monospace only. No signing/broadcast buttons are added yet.
- [ ] Add `tests/scaffold.browser.test.ts`: attach request listeners before navigation to the **built** harness, collect non-loopback requests, and assert the collection stays empty through load and one second idle. Assert seven “Not tested” labels, no pass/connected claim, no service worker registration, and no global wallet object created by app code. Reload `/dev/feasibility` and verify it remains usable without a wallet installed. No offline-readiness claim is made from this check.
- [ ] Document commands, both preview/harness URLs, generated-file provenance, excluded starter integrations and compatibility versions in `README.md`/`docs/scaffolding.md`. Explicitly distinguish prototype sample data from the untested harness. List the parent Task 1 real experiments next; leave every feasibility gate unpassed.
- [ ] Run the complete checks from a clean install: `npm ci`, `npm run test`, `npm run typecheck`, `npm run build`, `npm run test:browser`. Confirm no original prototype/doc content changed, that `dist` has no server dependency/runtime, and that only audited frontend assets are served. Record actual results; test failure is not permission to add a backend.
- [ ] Commit explicit task files: `feat: add untested wallet feasibility harness`.

## Completion and self-review

Scaffolding is complete when a reproducible React build exists, the existing Counterfoil preview is unchanged and available, and the developer harness accurately shows that real integrations remain untested. Native React product-screen migration, service-worker storage, wallet calls, SPV and ARC are deliberately deferred to the parent plan; this plan does not claim to implement their global requirements.

Self-review completed: all three task interfaces agree; five review risks have owning assertions; prototype preservation is tested on built output; no new backend or venue-registration scope; no simulated pass can close a feasibility gate. Exact generated dependencies are chosen from the audited output and lockfile at execution, not guessed from repository versions.

## Execution handoff

Recommend **Native** execution for these three closely related scaffolding tasks. Review this plan and select Native or Subagent-driven before implementation, as required by the writing-plans workflow. No scaffolding has been executed while writing this plan.
