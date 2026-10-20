# Offline Ticket Handoff with SPV Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if the user selects delegation. Steps use checkbox (`- [ ]`) syntax for tracking. Read the specification first. This document authorizes no claim that the feasibility gates have passed.

**Goal:** Build the agreed two-device ticket POC with local SPV verification, QR/file handoff, durable acceptance, online settlement, and five honest demo scenes.

**Architecture:** A static React app isolates wallet access and online services from a deterministic local verification pipeline. IndexedDB stores ticket packages and a separate header snapshot; a service worker caches the app. One transport-independent protocol serves QR and files, and a settlement coordinator resumes accepted transfers without creating replacement transactions.

**Tech Stack:** TypeScript, React/Vite from the minimal Create BSV App starter, @bsv/sdk, BRC-100 WalletClient, @bsv/air-gap, ARC, IndexedDB, service worker, Vitest, fake-indexeddb and Playwright browser tests. Select and pin a QR renderer/camera decoder compatible with the starter during Task 1; use @bsv/air-gap for framing, not a new framing protocol.

**Spec:** [2026-10-16-offline-ticket-design.md](../specs/2026-10-16-offline-ticket-design.md)

**Starting state:** Only docs-to-read.md and these planning documents exist; there is no app or Git repository. No dependency installation, wallet action, broadcast or physical-device test has been performed in this planning step.

## Global Constraints

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
- Exclude atomic payment, production custody/security work, venue integrations, seat maps, pricing, and design polish beyond clarity.
- Never describe a mined inclusion proof as proof that a ticket is currently unspent.
- Never describe an app-only request log as complete observation of native wallet traffic.

## Review Focus

1. A signed venue record copied onto an unrelated output must fail even if SPV and that signature separately pass: Task 4.
2. A wallet import succeeds but its response is lost; reopening must reconcile the expected outpoint instead of creating another transfer: Task 7.
3. Duplicate/interleaved QR frames or oversized files must not create a partial accepted ticket or unbounded work: Task 6.
4. An accepted ticket's anchor moves off the active header snapshot; cached success must not remain a current mined verdict: Tasks 3, 5 and 7.
5. IndexedDB quota failure or private/embedded-browser limitations must not produce a false acceptance or reopening claim: Tasks 1, 5 and 8.

## Execution policy and gates

This is one connected POC, not independent product subsystems. Tasks are ordered by dependency. Task 1 is a feasibility milestone. Tasks 2–9 may proceed only for a tested supported configuration; if Task 1 shows the core two-offline-wallet flow is impossible, report that blocker and revise the design rather than replace it with a backend, exported keys, or a mocked live demo.

The user has authorized finalizing the design and requested this plan. Execution method has not been selected. No product implementation is part of writing this file.

At execution time, initialize Git if still absent and follow using-git-worktrees for isolation where applicable. Do not overwrite docs-to-read.md. Commit each completed task after its checks pass; use explicit task file paths, not an indiscriminate git add. Never commit credentials, wallet state, or private keys.

Node/package manager versions must match the chosen starter and air-gap requirements. Record exact versions and lockfile in Task 1; do not assume the installed wallet uses the latest SDK. Repository research found Desktop 3.1.1 with SDK 2.8.11/toolbox 2.14.5, but these are not compatibility results.

## File structure and responsibility

```text
src/
  app/App.tsx                      screen routing and composition
  config/demo.ts                   pinned network, venue identity, checkpoint
  domain/types.ts                  shared app contracts below
  domain/codec.ts                  bounded request/package serialization
  domain/issuance.ts               canonical issuance preimage
  wallet/adapter.ts                WalletClient calls and tested key conventions
  wallet/issuer.ts                 wallet-backed issuer attestation
  wallet/transfer.ts               final signed noSend transfer
  wallet/import.ts                 tickets basket import/reconciliation
  verification/verifyTicket.ts     orchestrates local verification
  verification/continuity.ts       checks actual ticket lineage/scripts
  verification/compact.ts          mines-proof compaction without losing lineage
  headers/store.ts                 immutable snapshots and canonical mapping
  headers/validate.ts              linkage, compact target and PoW
  headers/tracker.ts               SDK ChainTracker adapter
  headers/sync.ts                  online sources, agreement and reorg handling
  storage/db.ts                    schema/migrations and transactions
  storage/tickets.ts               acceptance and restoration
  transport/files.ts               bounded download/import
  transport/qr.ts                  BRC-141 encode/decode boundary
  settlement/arc.ts                submission/status/proof adapter
  settlement/resume.ts             durable retries and import reconciliation
  network/log.ts                   redacted app request instrumentation
  preparation/prepare.ts           role-specific readiness checks
  ui/PrepareScreen.tsx             explicit preparation checklist
  ui/IssueScreen.tsx               venue issuance
  ui/ReceiveScreen.tsx             buyer request and import/accept
  ui/TransferScreen.tsx            seller selection, sign and export
  ui/DoorScreen.tsx                offline scanner verdict
  ui/EvidencePanel.tsx             per-check results and scoped claims
  ui/StatusStrip.tsx               connection/headers/size/server contacts
  ui/DemoScreen.tsx                clearly labeled fake/conflict demonstrations
  sw.ts                           app-shell precache and update lifecycle
tests/
  fixtures/                       sanitized public fixture files
  helpers/fixtures.ts             loads/version-checks those fixtures
  domain.test.ts
  headers.test.ts
  verification.test.ts
  storage.test.ts
  transport.test.ts
  settlement.test.ts
  offline.browser.test.ts
  demo.browser.test.ts
docs/
  feasibility.md                  measured gates, versions and SDK call recipes
  demo-runbook.md                  setup, five scenes, evidence and timing
  compatibility.md               tested device/browser/wallet matrix
README.md                         purpose, setup, SPV model and limitations
```

Keep generated starter entry/config names where they differ; map them once in docs/feasibility.md rather than create duplicate app entry points. The functional module paths above are new and stable.

## Shared interfaces

Task 2 defines these application-owned contracts. They are not assertions about exact SDK method signatures. SDK calls remain isolated in adapters and are implemented against the pinned types confirmed by Task 1.

```ts
export type Network = 'testnet';
export type Outpoint = { txid: string; index: number };
export type KeyBinding = {
  publicKey: string;
  protocolID: [number, string];
  keyID: string;
  counterparty: string;
};
export type ReceiveRequest = {
  kind: 'ticket-request'; version: 1; network: Network;
  requestId: string; recipient: KeyBinding;
};
export type Issuance = {
  eventId: string; ticketId: string; origin: Outpoint;
  issuerIdentity: string;
  signedBytesBase64: string; signatureBase64: string;
  signingKey: KeyBinding;
};
export type TicketPackage = {
  kind: 'ticket-package'; version: 1; network: Network;
  issuance: Issuance; current: Outpoint;
  request: ReceiveRequest;
  lineageRawTxs: string[]; atomicBeefBase64: string;
};
export type Check = {
  name: 'issuer' | 'continuity' | 'transaction' | 'anchors' | 'recipient';
  status: 'pass' | 'fail' | 'incomplete'; reason: string;
};
export type Verification = {
  verdict: 'verified' | 'incomplete' | 'rejected';
  checks: Check[]; snapshotId: string;
  presentedTransferMined: boolean; anchorHeights: number[];
};
export type HeaderSnapshot = {
  id: string; network: Network; tipHeight: number; tipHash: string;
  headers: ReadonlyMap<number, string>; // raw 80-byte header hex
};
export type VerificationContext = {
  snapshot: HeaderSnapshot; trustedVenueIdentity: string;
  expectedRequest?: ReceiveRequest; // required for buyer acceptance
};
export type ArcStatus =
  | { kind: 'pending'; detail: string }
  | { kind: 'mined'; blockHash: string; height: number; merklePath: string }
  | { kind: 'conflict'; competingTxids: string[]; detail: string }
  | { kind: 'rejected'; detail: string }
  | { kind: 'stale'; blockHash: string };
export interface ArcPort {
  submit(pkg: TicketPackage): Promise<void>;
  status(txid: string): Promise<ArcStatus>;
}
export interface WalletPort {
  receiveRequest(): Promise<ReceiveRequest>;
  issue(eventId: string, ticketId: string): Promise<TicketPackage>;
  transfer(pkg: TicketPackage, request: ReceiveRequest): Promise<TicketPackage>;
  hasOutput(outpoint: Outpoint): Promise<boolean>;
  importTicket(pkg: TicketPackage): Promise<void>;
}
export type ImportState = 'not-attempted' | 'pending' | 'succeeded' | 'failed';
export type StoredTicket = {
  id: string; pkg: TicketPackage; verification: Verification;
  acceptedAt?: string;
  broadcast: 'not-attempted' | 'pending' | 'submitted' | 'mined' | 'conflict' | 'rejected';
  walletImport: ImportState; lastError?: string;
};
export interface TicketRepository {
  get(id: string): Promise<StoredTicket | undefined>;
  list(): Promise<StoredTicket[]>;
  put(record: StoredTicket): Promise<void>;
  accept(pkg: TicketPackage, result: Verification): Promise<StoredTicket>;
}
```

The issuer's identity is pinned in configuration. Package-supplied signing derivation parameters must match the fixed, publicly verifiable convention established by the feasibility fixture; accepting arbitrary signing keys would defeat issuer authentication. The app performs no hidden wallet call inside verifyTicket.

## Task 1: Prove the wallet/browser path and establish reproducible fixtures

**Files:** Create package.json, package-lock.json, starter entry/config files, a temporary dev-only feasibility screen, docs/feasibility.md, docs/compatibility.md, tests/fixtures/manifest.json and sanitized fixture files. Create src/config/demo.ts only after selecting real checkpoint and venue values.

**Consumes:** Specification and linked primary sources. **Produces:** pinned versions; exact successful WalletClient recipes; direct ARC access recipe; public evidence fixtures; a pass/fail gate for each tested device combination. No production adapter contract is considered implemented by this task.

- [ ] Read the current Create BSV App CLI README, inspect its React starter and choose an explicit CLI version. Scaffold in a temporary sibling directory to avoid overwriting existing documentation, using its documented `new ... --starter react --yes` flow. Copy only the needed static React starter files into this workspace.
- [ ] Audit generated connections: remove unused server/relay integrations and external asset dependencies. Establish scripts `test` (Vitest), `typecheck` (tsc --noEmit), `build` (Vite), and `test:browser` (Playwright test). Add playwright.config.ts to start/target the built preview and include only `tests/*.browser.test.ts`; exclude that pattern from Vitest. Pin installed versions with the lockfile. Configure testnet only.
- [ ] On each candidate wallet, record browser/OS/wallet versions. While online, prepare funds, proofs and receiving keys. Observe app and native-wallet external traffic separately. Disconnect external networking while retaining any required local wallet bridge.
- [ ] Use the official PushDrop example to construct and sign a transfer with noSend. Record every real createAction/signAction option and result shape, including how input BEEF is supplied. Reconnect only after exporting the final bytes. Confirm independently that the bytes are a final transaction, not a signable response.
- [ ] Obtain a venue wallet signature over the exact specification preimage. Demonstrate offline SDK verification tied to the pinned venue identity, including its public key derivation. Capture fixed protocolID/keyID/counterparty parameters. Repeat with a wrong identity and changed preimage; both must fail. Do not substitute a generated application private key.
- [ ] Close and reopen the prepared app offline, then request a receiving key and perform signing. Record separately whether cold wallet startup, embedded-browser service workers, cameras and persisted data work. A warm successful session is not evidence for cold reopening.
- [ ] Test direct ARC submission, status and Merkle-proof retrieval from the actual HTTPS browser origin. Record authentication/CORS requirements, redact secrets, and never bundle a provider secret. Treat provider rejection as unresolved access, not permission to add a backend.
- [ ] Test internalizeAction after broadcast, a lost-response retry and expected-output lookup. Record exact protocol and output instructions for the tickets basket. Capture whether import attempts network calls. Test unbroadcast import only as an experiment, not as the acceptance path.
- [ ] Generate two controlled wallet-signed spends of one ticket output, with independent fee inputs if necessary. Record the supported signing method; do not alter reservations or export keys to force it. Capture both offline-verifiable packages and actual post-broadcast results.
- [ ] Save public fixtures: a mined issuance, one unmined handoff, a mined handoff, two conflicting handoffs, needed raw lineage transactions and header segment. manifest.json records network, venue identity, checkpoint, txids, wallet versions and provenance. Remove secrets and private wallet storage.
- [ ] Manually verify every gate above and write measured PASS/FAIL with evidence in docs/feasibility.md. If offline signing or signature verification fails, stop dependent product work and report the exact cause. A fixture mock cannot count as a pass.
- [ ] Commit the minimal harness, lockfile, sanitized fixtures and evidence report after checking their diff for credentials. Do not commit raw wallet logs. This task may require mining time and a second physical device; it is not a two-minute automated test.

## Task 2: Define bounded package encoding and canonical issuance bytes

**Files:** src/domain/types.ts, src/domain/codec.ts, src/domain/issuance.ts, tests/helpers/fixtures.ts, tests/domain.test.ts.

**Consumes:** fixture files and fixed signature convention from Task 1. **Produces:** shared types; `encodeMessage(value: ReceiveRequest | TicketPackage): Uint8Array`; `decodeMessage(bytes: Uint8Array): ReceiveRequest | TicketPackage`; `issuanceBytes(network: Network, eventId: string, ticketId: string, origin: Outpoint): Uint8Array`.

Fixture helper contract: `loadFixture(name: 'unmined' | 'mined' | 'conflict-a' | 'conflict-b'): Promise<{ pkg: TicketPackage; context: VerificationContext }>` reads public files and checks manifest network/version. Never embed private keys. Use the helper for genuine evidence, not for deriving expected cryptographic results from the implementation under test.

- [ ] Write codec tests before implementation:

```ts
it('round-trips the exact package and rejects excess input', async () => {
  const { pkg } = await loadFixture('unmined');
  expect(decodeMessage(encodeMessage(pkg))).toEqual(pkg);
  expect(() => decodeMessage(new Uint8Array(4 * 1024 * 1024 + 1))).toThrow();
});
it('has deterministic issuance bytes', () => {
  const origin = { txid: 'ab'.repeat(32), index: 0 };
  expect(new TextDecoder().decode(issuanceBytes('testnet', 'E', 'T', origin)))
    .toBe(JSON.stringify(['offline-ticket-issuance', 1, 'testnet', 'E', 'T', origin.txid, 0]));
});
```

- [ ] Run `npm test -- --run tests/domain.test.ts`; confirm failures are missing behaviour, not test configuration.
- [ ] Implement bounded parsing with strict UTF-8, exact message discriminator/version/network, integer output indices, ID length bounds, base64 validation, and maximum lineage length. Reject unknown fields where they could change signed/recipient semantics. Canonical preimage code:

```ts
return new TextEncoder().encode(JSON.stringify([
  'offline-ticket-issuance', 1, network, eventId, ticketId, origin.txid, origin.index,
]));
```

- [ ] Add table-driven rejection tests for invalid UTF-8, malformed JSON/base64, mainnet/unknown network, unsupported version, negative/fractional index, empty/oversized IDs, and 101 lineage entries. Confirm request imports cannot be treated as ticket imports.
- [ ] Run the focused tests and typecheck; commit the codec and contracts.

## Task 3: Build local headers, explicit ChainTracker and online synchronization

**Files:** src/headers/store.ts, validate.ts, tracker.ts, sync.ts, src/network/log.ts, tests/headers.test.ts.

**Consumes:** HeaderSnapshot and Task 1 checkpoint/header fixtures. **Produces:** `createLocalTracker(snapshot: HeaderSnapshot): ChainTracker`; `validateHeaderSegment(headers: string[], previousHash: string): void`; `reconcileSources(a: HeaderSnapshot, b: HeaderSnapshot): HeaderSnapshot`; `syncHeaders(): Promise<{ snapshot: HeaderSnapshot; affectedHeights: number[] }>` using configured source adapters; redacted `loggedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>`.

- [ ] Write a no-network tracker test using the mined fixture:

```ts
it('does not fetch when a required height is absent', async () => {
  const { context } = await loadFixture('mined');
  const snapshot = { ...context.snapshot, headers: new Map<number, string>() };
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
  const tracker = createLocalTracker(snapshot);
  await expect(tracker.isValidRootForHeight('00'.repeat(32), 1)).rejects.toThrow('HEADER_MISSING');
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});
```

- [ ] Run `npm test -- --run tests/headers.test.ts` and confirm the test fails before implementation.
- [ ] Implement exact pinned SDK ChainTracker methods (including currentHeight if required). Extract the Merkle root from validated header bytes and compare with the SDK's required endianness. Throw a typed missing-header error; never invoke a remote tracker.
- [ ] Implement PoW/linkage using SDK hashing and bigint compact-target arithmetic. Cover zero/negative/overflow/out-of-range target, wrong previous hash, wrong header length and hash above target. Use real positive fixtures and independently altered negative fixtures.
- [ ] Implement source agreement at overlapping heights. Persist a snapshot only after validation and agreement; reject conflicting common-height hashes. Test differing tips with agreeing overlap, conflicts, and no overlap. No overlap must not count as cross-check success.
- [ ] Implement immutable snapshot promotion and common-ancestor reorg handling. Return affected heights for ticket re-verification. At/below-checkpoint conflict blocks sync with an explicit rebootstrap message. Make no DAA/best-chain independence claim.
- [ ] Add request logging around online source adapters, redacting authorization/query secrets. Test redaction and that local tracker calls add zero log entries. Verify with focused tests and typecheck, then commit.

## Task 4: Verify issuer, ticket continuity and transaction evidence locally

**Files:** src/verification/verifyTicket.ts, continuity.ts, tests/verification.test.ts.

**Consumes:** package types, canonical issuance bytes, fixed venue signature convention, local tracker. **Produces:** `verifyTicket(pkg: TicketPackage, context: VerificationContext): Promise<Verification>` and `doorVerdict(result: Verification): 'pass' | 'online-required' | 'incomplete' | 'reject'`.

- [ ] Write tests against real Task 1 fixtures:

```ts
it('verifies a fresh handoff but does not pass the mined-only door', async () => {
  const { pkg, context } = await loadFixture('unmined');
  const result = await verifyTicket(pkg, context);
  expect(result.verdict).toBe('verified');
  expect(result.presentedTransferMined).toBe(false);
  expect(doorVerdict(result)).toBe('online-required');
});
it('rejects a changed signed ticket identifier', async () => {
  const { pkg, context } = await loadFixture('mined');
  const changed = structuredClone(pkg);
  changed.issuance.ticketId += '-changed';
  expect((await verifyTicket(changed, context)).verdict).toBe('rejected');
});
```

- [ ] Run `npm test -- --run tests/verification.test.ts` and observe the expected failures.
- [ ] Implement in order: schema and network checks; reconstruct/compare canonical issuance bytes; verify trusted venue identity/signature with the Task 1 convention; decode actual lineage scripts and enforce origin/unique successor/spends; parse Atomic BEEF and match target/current outpoint; run tx.verify with the injected tracker; compare actual recipient script with the saved request; report each check independently.
- [ ] Determine presented-transfer mining from that transaction's verified proof, not a mined funding ancestor. Keep anchor heights distinct. Missing required evidence produces incomplete; definitive failed signatures/scripts produce rejected. A known failure cannot be hidden by an unrelated incomplete check.
- [ ] Add fixture mutations for copied attestation onto another output, broken lineage, duplicate successor, wrong target, wrong buyer request, untrusted venue, incomplete BEEF dependency, invalid Merkle path and missing header. Assert zero fetch and zero wallet calls throughout verification. Include both conflicting spends: each must independently verify offline.
- [ ] Implement door mapping explicitly:

```ts
if (result.verdict === 'rejected') return 'reject';
if (result.verdict === 'incomplete') return 'incomplete';
return result.presentedTransferMined ? 'pass' : 'online-required';
```

- [ ] Run focused tests and typecheck; commit. Never add a live UTXO query to make these tests pass.

## Task 5: Persist acceptance and restore it after reopening

**Files:** src/storage/db.ts, tickets.ts, tests/storage.test.ts; use fake-indexeddb for unit tests and the actual browser later.

**Consumes:** TicketPackage, Verification. **Produces:** `openTicketRepository(name: string): Promise<TicketRepository>` with deterministic record ID `${txid}:${index}`; transactional accept and independent settlement/import states.

- [ ] Write acceptance/reopening tests:

```ts
it('restores exactly the accepted package through another repository instance', async () => {
  const { pkg, context } = await loadFixture('unmined');
  const result = await verifyTicket(pkg, context);
  const first = await openTicketRepository('acceptance-test');
  const saved = await first.accept(pkg, result);
  const second = await openTicketRepository('acceptance-test');
  expect((await second.get(saved.id))?.pkg).toEqual(pkg);
  expect(saved.broadcast).toBe('pending');
});
```

- [ ] Run `npm test -- --run tests/storage.test.ts` before implementation.
- [ ] Implement IndexedDB schema with tickets and pending requests; keep header stores separate. Resolve accept only on transaction completion, not on the first successful put request. Reject accepting incomplete/rejected reports or reports lacking a passing expected-recipient check.
- [ ] Test duplicate acceptance is idempotent for identical bytes; reject differing bytes under the same identity rather than overwrite. Force an abort/quota exception and assert no accepted record/status is returned. Persist incomplete packages without acceptedAt.
- [ ] Store snapshot IDs; on reopening with a new snapshot re-run verification before showing a current mined verdict. Keep original accepted bytes and history of acceptance even when current evidence becomes incomplete.
- [ ] Run tests and typecheck; commit. Actual close/reopen persistence remains a browser gate in Task 8.

## Task 6: Add identical file and animated-QR protocol paths

**Files:** src/transport/files.ts, qr.ts, tests/transport.test.ts.

**Consumes:** encodeMessage/decodeMessage. **Produces:** `importFile(file: File): Promise<ReceiveRequest | TicketPackage>`; `exportFile(message: ReceiveRequest | TicketPackage): Blob`; `transportFor(bytes: Uint8Array): 'qr' | 'file'`; air-gap session wrapper with `nextFrame(): string` and `receiveFrame(frame: string): Uint8Array | undefined`.

- [ ] Write boundary tests:

```ts
it('uses file fallback above the BRC-141 v1 limit', () => {
  expect(transportFor(new Uint8Array(65536))).toBe('qr');
  expect(transportFor(new Uint8Array(65537))).toBe('file');
});
it('imports the same bytes through a file', async () => {
  const { pkg } = await loadFixture('unmined');
  const file = new File([encodeMessage(pkg)], 'ticket.json');
  expect(await importFile(file)).toEqual(pkg);
});
```

- [ ] Run focused tests before implementation. Implement file-size checks before reading the file, then strict decoding. Reject files above 4 MiB. QR selection uses actual serialized bytes, not raw transaction size.
- [ ] Wrap @bsv/air-gap's pinned encoder/decoder API confirmed in Task 1. Add tests with dropped, duplicated and reordered frames; assert no return until complete and exact reconstructed bytes after completion. Feed interleaved sessions and verify no mixed payload is accepted. Apply decoder resource bounds and reset on cancellation.
- [ ] Keep QR rendering/camera capture outside framing. Camera denial/unavailability provides the file path. Requests and packages use the same codec but distinct expected message types at each screen.
- [ ] Run tests and a camera smoke test between physical devices, record measured payload size/scan time, then commit. Checksums do not substitute for Task 4 verification.

## Task 7: Implement wallet adapters and resumable settlement

**Files:** src/wallet/adapter.ts, issuer.ts, transfer.ts, import.ts, src/settlement/arc.ts, resume.ts, tests/settlement.test.ts.

**Consumes:** successful exact SDK recipes from Task 1; WalletPort, ArcPort, TicketRepository; local verification. **Produces:** production adapters and `resumeTicket(id: string, deps: { repo: TicketRepository; wallet: WalletPort; arc: ArcPort; context: VerificationContext }): Promise<StoredTicket>`.

- [ ] Write a lost-import-response recovery test with mock ports (unit isolation only; live adapters remain gated):

```ts
it('does not re-import an output that already exists', async () => {
  const { pkg, context } = await loadFixture('unmined');
  const repo = await openTicketRepository('resume-test');
  const saved = await repo.accept(pkg, await verifyTicket(pkg, context));
  await repo.put({ ...saved, broadcast: 'submitted', walletImport: 'pending' });
  const importTicket = vi.fn();
  const wallet = { hasOutput: vi.fn().mockResolvedValue(true), importTicket } as unknown as WalletPort;
  const arc = { submit: vi.fn(), status: vi.fn().mockResolvedValue({ kind: 'pending', detail: 'seen' }) };
  const result = await resumeTicket(saved.id, { repo, wallet, arc, context });
  expect(result.walletImport).toBe('succeeded');
  expect(importTicket).not.toHaveBeenCalled();
  expect(arc.submit).not.toHaveBeenCalled();
});
```

- [ ] Run focused tests before implementation. Implement WalletPort by copying the validated call sequence, not by guessing current main-branch signatures. Ensure all transfer signing steps retain noSend; verify final package locally before export. Locking-script reconstruction must use the same request key convention as receiveRequest.
- [ ] Implement ARC adapter with the pinned SDK's accepted submission encoding; do not assume Atomic BEEF JSON is a valid rawTx body. Map real statuses without treating receipt/observation as mining. Wrap external requests in loggedFetch or equivalent instrumented SDK HTTP client.
- [ ] Persist state before/after side effects. For submitted records, query status rather than resubmit immediately. For interrupted submission, reconcile by txid then retry identical bytes if still appropriate. Use one in-flight operation per ticket across tabs (browser lock or transactional lease). Retry transient failures at 2, 5 and 15 seconds, then expose manual retry; no unbounded polling loop.
- [ ] Reconcile expected wallet outpoint before repeating an uncertain import. Keep import failure independent from broadcast success. Do not import a confirmed rejected/conflicting transfer as settled. Verify mined Merkle evidence and header snapshot before promoting to mined/proof available.
- [ ] Add tests for timeout before/after submission, wallet import failure, duplicate reconnect events, a rejected transaction without conflict evidence, conflicting spend evidence, malformed returned proof, and stale-block status. Assert no replacement transaction/signing occurs during retry and no unverified proof produces a mined verdict.
- [ ] Repeat real broadcast/import/reopen checks on pinned wallets. Run tests and typecheck, then commit.

## Task 8: Compose preparation, screens and offline reopening

**Approved navigation update (2026-10-20):** Add src/ui/HomeScreen.tsx and src/ui/HomeScreen.test.tsx. Route `/` to the introductory landing page with a My tickets CTA, Venue/Scanner footer links, and optional motion with pause and reduced-motion support. Route `/tickets` to ticket-holder “My tickets”; route `/venue` to issuance and `/scanner` to scanner verification. Buyer and seller share the holder navigation. Do not expose Venue/Scanner in that navigation; keep cross-workspace demo links in the secondary demo menu. Preserve the existing Counterfoil colour tokens. Provide empty and saved-ticket home states, Receive/Transfer actions, and offline preparation; disable transfer when no ticket exists. Route boundaries do not grant issuer/staff authority. Add navigation tests asserting landing default entry and its My tickets CTA, plus home tests asserting empty-state transfer disabled, Receive opens the receiving request, Transfer opens ticket selection, and absence of Venue/Scanner links in holder navigation.

**Files:** src/app/App.tsx, src/preparation/prepare.ts, all src/ui screens listed above, src/sw.ts, tests/offline.browser.test.ts.

**Consumes:** repository, verifier, transports, wallet and settlement adapters. **Produces:** five usable role/demo screens with a shared status strip and evidence panel; precached app shell; `prepare(role: 'seller' | 'buyer' | 'scanner'): Promise<Array<{ name: string; ready: boolean; reason: string }>>`.

- [ ] Add browser tests before composing acceptance UI. Example acceptance/reload assertion after fixture import and local checks:

```ts
await page.getByRole('button', { name: 'Accept' }).click();
await expect(page.getByText('Verified offline — pending broadcast', { exact: true })).toBeVisible();
await page.reload();
await expect(page.getByText('Verified offline — pending broadcast', { exact: true })).toBeVisible();
```

- [ ] Run the test against the unimplemented flow and confirm failure. Implement role-specific preparation with individual results. Include storage, wallet, cache, headers, seller signing resources and buyer receiving-key access. Failed checks have specific remedies; none trigger hidden remote verification.
- [ ] Build Issue, Transfer and Receive screens around the existing adapters. Buyer request/export precedes seller signing/export. Offer Scan QR and Import/Export file. Disable Accept until verification passes for the saved request. Await repository acceptance before displaying success.
- [ ] Build the Door screen using doorVerdict only. Show presented-transfer mining separately from ancestor anchors. Provide specific fake rejection reasons. Show request-recipient locking rather than claiming presenter ownership.
- [ ] Implement status strip and evidence panel with app-observed contacts, local bridge separation, snapshot height/age and exact byte sizes. Clear per-verification counters explicitly; do not erase the overall log. Redact credentials.
- [ ] Precache all same-origin build assets with a versioned service worker; avoid CDN fonts/scripts. Activate updates only outside an in-progress handoff and preserve IndexedDB. Register after a secure-origin check. Request persistent storage without claiming it is guaranteed.
- [ ] Test offline navigation/reload and cold reopen on physical target devices. Browser test isolation: use one test with the service worker enabled for reopening and another with external requests blocked/observed for local verification. Include storage rejection and camera denial paths. Do not claim browser context offline mode proves a native wallet made no requests.
- [ ] Run focused browser tests, typecheck and build; commit. Document unsupported combinations precisely.

## Task 9: Complete the five-scene demo, pruning evidence and README

**Files:** src/ui/DemoScreen.tsx, src/verification/compact.ts, tests/verification.test.ts, tests/demo.browser.test.ts, docs/demo-runbook.md, docs/compatibility.md, docs/feasibility.md, README.md.

**Consumes:** all implemented flows and real sanitized fixtures. **Produces:** repeatable two-device demonstration, measured evidence, final user documentation, and `compactMinedPackage(pkg: TicketPackage, context: VerificationContext): Promise<TicketPackage>` for a package whose presented transfer already has a locally verified mining proof.

- [ ] Add an integration assertion that removing required ticket lineage is not treated as successful proof shrinking:

```ts
it('does not accept a mined package whose required provenance was removed', async () => {
  const { pkg, context } = await loadFixture('mined');
  const pruned = { ...pkg, lineageRawTxs: [] };
  const result = await verifyTicket(pruned, context);
  expect(result.verdict).not.toBe('verified');
});
```

Use a mined fixture with at least one transfer where the removed lineage is not otherwise available in BEEF; otherwise this test would incorrectly reject a complete package.

- [ ] Implement compactMinedPackage using the pinned SDK BEEF operations only after a locally verified mining proof is attached. Reject an unmined input. Keep the separate issuer/lineage evidence. Verify before and after with the same context, and display measured BEEF and total package sizes. Do not force a shrink claim when measured totals do not shrink. Add this positive companion test:

```ts
it('preserves verification and provenance after compaction', async () => {
  const { pkg, context } = await loadFixture('mined');
  const compacted = await compactMinedPackage(pkg, context);
  expect((await verifyTicket(compacted, context)).verdict).toBe('verified');
  expect(compacted.issuance).toEqual(pkg.issuance);
  expect(compacted.lineageRawTxs).toEqual(pkg.lineageRawTxs);
});
```
- [ ] Build demo actions that import explicitly labeled prepared fake/conflict fixtures and show their real verification results. Do not change production verifier outcomes to make a scene succeed. Keep deliberate conflicting-spend generation out of the ordinary transfer button.
- [ ] Write the runbook: online issuance/preparation; fresh two-way offline handoff; saved-package reopen; prepared mined door example; changed-field/wrong-issuer rejection; two offline-valid conflicting packages; actual online status/proof; offline door flags for the unresolved package. Record which evidence is prepared and which steps are live.
- [ ] Schedule the ten-minute presentation around prepared mined examples. Allow live mining to remain pending. Update scanner headers before taking it offline for any newly mined example.
- [ ] Run on two physical devices and record OS/browser/wallet/version/transport, reopening results, server contacts, proof sizes and scene verdicts. Exercise laptop–laptop, laptop–phone and phone–phone when equipment is available; mark unavailable combinations untested, not passed.
- [ ] Write README sections: setup and pinned versions; preparation; QR/file flows; issuer vs SPV vs continuity; header trust/DAA exclusion; broadcast vs mined vs imported; proof shrinking; double-sale and stale/replay limits; remote file connectivity; local persistence limits; network-log coverage; reproducible five-scene instructions. Link docs-to-read.md and the source map.
- [ ] Run `npm test -- --run`, `npm run typecheck`, `npm run build`, and `npm run test:browser`. Inspect the rendered screens and test reports. Fix relevant failures, then commit only reviewed files. Do not mark physical-device gates complete from automated mocks.

## Coverage and completion review

| Requirement | Owning tasks |
|---|---|
| Issue and trusted issuer signature | 1, 2, 4, 7, 8 |
| Both-offline two-way handoff | 1, 4, 6, 7, 8 |
| Offline door policy and limits | 3, 4, 8, 9 |
| Fake and copied-attestation rejection | 2, 4, 9 |
| Double-sell and network resolution | 1, 4, 7, 9 |
| Local acceptance and reopening | 5, 8 |
| Header sync, missing headers and reorgs | 3, 4, 5, 7 |
| QR/file parity and oversize fallback | 2, 6, 8 |
| ARC/import retries | 1, 7 |
| No external verification requests | 3, 4, 8, 9 |
| Visible evidence, sizes and network scope | 8, 9 |
| Safe proof shrinking | 4, 9 |
| Device compatibility and README | 1, 8, 9 |

Completion means evidence for the specification's acceptance criteria exists, including physical-device results. If a required gate cannot be tested, report the exact missing device/access/capability and keep that gate incomplete. No real-world result is inferred from passing unit tests.

## Execution recommendation

Recommend native execution initially: the first milestone depends on interactive wallet/device experiments and its results constrain the later adapters. Revisit delegation only if the user selects it. Planning alone creates no Git commit because this workspace currently has no repository; initialize version control at implementation time.
