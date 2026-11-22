# Wallet import and reconciliation: read-only preflight

The first step checks whether the mined buyer ticket is already recorded in the isolated testnet wallet. The same-wallet transfer supplied the `counterfoil-ticket-experiment` basket and receiving-key instructions when it was signed. A matching record may therefore exist before any import.

This panel does **not** call `internalizeAction`, sign, broadcast, retry an action, or edit wallet records. It does not complete the wallet-import feasibility gate. An absent basket result does not establish absence of a transaction/action elsewhere in the wallet.

## Operator steps

1. Keep the isolated test wallet open on testnet. Open `http://localhost:5175/dev/feasibility` in the same browser profile used for settlement and header sync. Reload the page to use the current build.
2. Find **Wallet import review** below **Online transfer submission**. Select the source used for the mined transfer, then **Reload saved mining evidence**. The current expected outpoint is `324f4e7086e77c4ce905fde90035713f0e1429ffe63c1ca1a6f1d0257ba50d9e.0`.
3. If a mining candidate is missing, return to **Online transfer submission**, select the same source and run **Verify mining proof locally**. That stores the candidate. Reload evidence in the wallet-review panel afterward. Do not submit or sign again.
4. Choose **Review wallet ticket record**. This re-verifies mining and ticket evidence locally before opening the local HTTP wallet connection on port 3321. It reads network, wallet interface version, identity public key, buyer receiving public key and the named basket. Any permission prompt should be for these reads.
5. Save **Download wallet review observation** and report the result. No import is triggered by any result.

## Results and limits

- **present:** exact outpoint, amount, locking script, reported spendability and receiving-key instructions match. This is an existing wallet record, not a new successful import or proof of current blockchain unspentness.
- **absent:** the exact output was not listed in a complete named-basket response. This is not proof that there is no wallet action and does not authorize an import retry.
- **inconclusive:** listing is truncated, malformed, over 1,000 outputs, duplicated, or output data differs. Review the records before deciding on import.

The app requires the original same-wallet identity and the independently saved buyer request. It reads identity/network before and after listing. Saved evidence and the header snapshot are reloaded before displaying a completed observation; changes discard the result. Cancellation or a 30-second timeout stops further reads and ignores late results. Opening the panel makes no wallet request. The source journals and header snapshots are never written by this panel.

Native wallet network traffic is not monitored. A matching public key is not a fresh proof of private-key possession; the earlier challenge experiment is separate. Results describe one observation in one isolated same-wallet setup, not independent buyer custody.

## Next decision

Inspect the read result and the pinned wallet's existing action state before deciding whether `internalizeAction` is needed and supported. External ARC mining does not by itself demonstrate that the wallet has reconciled an earlier `noSend` action. Any later mutation needs its own explicit control, exact transaction/output review and durable attempt record. Lost-response reconciliation and controlled conflicting transfers remain untested by this preflight.

The unit and browser tests use synthetic signed tickets and mocked wallet responses. Browser tests replace the synthetic SPV anchor boundary; real proof verification has separate coverage in the existing SPV and ARC suites. These tests are not live wallet compatibility evidence.

Plan: wallet import preflight (internal working notes, not published).

Automated validation: 147 unit tests passed; 141 browser tests passed and one existing duplicate phone process-restart case skipped. Typecheck and build passed. Independent review found no substantive defect. Deferred browser coverage: timeout, unmount/reload and source replacement; explicit cancellation and header replacement are covered. No live wallet record review has been run by the implementation tests.

## Live preflight observation — 25 October 2026

The operator reported **absent** for successor `324f4e7086e77c4ce905fde90035713f0e1429ffe63c1ca1a6f1d0257ba50d9e.0` at `2026-10-25T20:56:04.503Z`, interface version `wallet-brc100-1.0.0`, local header snapshot `1e4537a8046097591d45d2c02bb2613916352ea071619630a32b8823c9210497`. All seven public-read calls returned. This is a basket observation, not a failed chain proof or proof that no internal action exists.

After informing the operator, a separate read-only local HTTP review at `2026-10-25T20:58:55.628Z` checked testnet and the expected public identity before and after `listActions`. The request used empty labels, inputs/outputs included, limit 1,000, offset zero, and `seekPermission:false`. The wallet returned all five actions in its reported listing. The target successor and actions spending its ticket or the issuance ticket were not found. The original issuance `ef3cb74395e9c4813aa3bf5aa482fbec3bde608f3ac93573bf932e5f8ed23a92` was present with status `completed`; output zero was reported as spendable in `counterfoil-ticket-experiment` with one satoshi. This wallet-local spendability report is not chain unspentness. The listing does not inspect every reservation or hidden/staged record.

Only `getNetwork`, `getPublicKey` and `listActions` were called; there was no import, signature, broadcast, cancellation or direct native database access. The first sandboxed connection was blocked by EPERM; the approved loopback read then completed successfully.

Read-only inspection of the packaged isolated app's `app.asar` found wallet-toolbox version 2.14.9 and an explicit mined import path in `out/src/storage/methods/internalizeAction.js`: it can insert an unknown mined transaction, or merge an existing record; a `nosend` merge with a mining proof promotes the transaction and proof request to `completed`. It updates ownership records and marks consumed wallet inputs spent. Its signer verifies Atomic BEEF using the configured chain tracker. This describes the packaged code inspected on disk, not a live successful import or proof that every installed copy is identical.

Decision: prepare a controlled import of this exact mined successor and output zero, with the independently saved receiving instructions, fresh proof/key checks and durable attempt tracking. Explain the wallet-record changes in the import control and require explicit authorization before invoking it. Do not reissue, resign, rebroadcast or cancel the old transaction to resolve the missing basket entry. The actual import and lost-response reconciliation remain pending.

## Controlled import controls

The separate **Import mined ticket** panel now implements the next step. The original **Wallet import review** panel remains read-only. No live import was run during implementation.

1. Stay online with the isolated testnet wallet open. Reload `/dev/feasibility` in the same browser profile/origin containing settlement evidence and headers.
2. Find **Import mined ticket** below the read-only review. Choose the same evidence source, then **Reload import evidence**. Confirm successor `324f4e7086e77c4ce905fde90035713f0e1429ffe63c1ca1a6f1d0257ba50d9e.0` and saved buyer request.
3. Click **Review mined ticket for import**. This reads the wallet, re-verifies the mined ticket locally, and requires the exact output to be absent from a complete listing. Existing or inconclusive records stop import. Review the displayed consumed inputs and recipient key. Keep the same wallet profile/network selected throughout.
4. Read and tick the import acknowledgement, then **Import reviewed mined ticket** once. This is a wallet mutation: it inserts/updates the existing transaction and ticket ownership metadata and may mark consumed wallet inputs spent. It calls `internalizeAction` with the exact mined Atomic BEEF and only the current ticket output as a `basket insertion`. It does not create/sign another transfer, change the fee, submit to ARC, or classify unrelated change as a new wallet payment. The native wallet may contact its own services to verify proof.
5. An accepted response triggers a read-only output check. Expected display: **Import response: accepted**, **Latest wallet observation: present**. These are two separate observations; acceptance alone does not establish the resulting output. Download **Wallet import diagnostic**.
6. For **unknown** or **pending**, do not repeat import. Use **Reconcile wallet import**; a pending attempt younger than 60 seconds must wait to avoid racing a live operation. This queries the expected output and appends an observation without importing. A matching output after a lost response does not rewrite the original response as accepted. Save the diagnostic even if the result remains absent/inconclusive.

The independent `counterfoil-wallet-import-v1` IndexedDB journal commits one attempt before dispatch. Concurrent tabs cannot both claim the same transaction. It preserves original evidence, accepted/unknown response, and up to 16 subsequent observations. A storage failure before the claim prevents mutation; failure after dispatch retains the pending claim and blocks duplicates. Timeout/cancellation ignores late responses and retains uncertainty. Closing the tab can leave a pending record, which remains protected on reload. No retry/reset control is exposed; clearing site data or using a different browser bypasses this local protection and must not be used to force another attempt.

The live API cannot atomically bind a sequence of profile checks to an import. The app rechecks network, identity and receiving key after the journal claim and before dispatch, but the operator must not change wallet profiles mid-operation. Full lifecycle safety for all wallets is not inferred from this isolated build.

This is diagnostic tooling. Product acceptance, independent buyer custody, controlled conflicts, current chain unspentness and admission remain separate. Unit/browser tests simulate responses and lost connections; they do not close the live wallet-import feasibility gate.

The import registers only the ticket output. Recovery/tracking of the seller's managed change is not established by this basket-insertion test; do not infer full wallet balance reconciliation from a present ticket output.

Controlled-import automated validation: 158 unit tests passed, 155 browser tests passed, one existing duplicate phone case skipped; typecheck/build passed. Independent review found no substantive defect. Regression tests cover unknown outcomes, final-persistence failure, accepted-response retention after a failed read, two-tab claims, reload protection, timeout/late responses and a wallet/source change before dispatch. No live import was run by the agent.

## Operator-reported live import success — 25 October 2026

The operator subsequently reported **Import response: accepted**, attempt saved at `2026-10-25T21:19:13.289Z`, followed by **Latest wallet observation: present** at `2026-10-25T21:19:17.771Z`. Exact output: `324f4e7086e77c4ce905fde90035713f0e1429ffe63c1ca1a6f1d0257ba50d9e.0`; buyer request: `4423ebd4-89e4-4d51-816f-cf510ccfbf0a-buyer`. The supplied call log shows one `internalizeAction — started/returned` pair and the subsequent read-only network, identity, receiving-key and output checks returning.

This is successful reported import acknowledgement plus a matching basket-record observation for this isolated same-wallet run. It supersedes the pending live-import statement above for this run. It is operator-supplied UI evidence, not a newly independent audit of the downloaded journal. Native lost-response recovery, independent custody, managed-change recovery and conflicts remain separate. A historical matching output does not prove current chain unspentness.

The former observation text “No import was performed” described only the read-only observation, not the preceding import. The UI now scopes this wording explicitly, including for older saved present observations; original diagnostic evidence is not rewritten.

Next: download the wallet import diagnostic, reload this same browser origin/profile and use **Reconcile wallet import**. The import response should remain accepted and a fresh matching-record observation should be present, with no additional import call. This checks persistence and ordinary reconciliation; it does not simulate a lost import response. Do not import this transaction again.

## Follow-up reconciliation and controlled response-loss tests — 25 October 2026

The operator subsequently reported the original accepted attempt still saved at `2026-10-25T21:19:13.289Z`, with a fresh **present** observation at `2026-10-25T21:21:50.560Z`. This records the reported ordinary reconciliation result; it is not independent inspection of the downloaded journal or evidence of a lost native-wallet response.

The next controlled test used disposable Playwright browser profiles, synthetic ticket fixtures and intercepted wallet HTTP requests. No request reached BSV Desktop, no live ticket was imported again, and the operator's profile, journal and successful ticket were not changed. Production import controls, SDK HTTP transport, IndexedDB persistence and reconciliation code were exercised. The synthetic fixture's SPV boundary was substituted, so this run makes no new proof-verification claim.

Two response-loss cases were exercised on desktop and phone viewports:

1. The simulated wallet records the output, then its import HTTP response is dropped. The app saves **unknown**. Reload makes no wallet call and keeps import blocked. Explicit reconciliation finds **present** using only public reads, while the original attempt remains **unknown**.
2. The import HTTP response is dropped and the output remains absent from the simulated wallet. After reload, reconciliation finds **absent**, preserves **unknown** and still blocks import. Absence does not authorize retry.

Both cases check that exactly one import was dispatched, the downloaded diagnostic matches the persisted record, original attempt/evidence stay unchanged, and a second reload preserves the reconciled observation without wallet calls. Existing timeout, late-response, concurrent-claim and storage-failure cases also passed.

Validation: `npx playwright test tests/mined-wallet-import.browser.test.ts` — **16 passed**; its production build and typecheck passed. `npm test` — **158 passed** across 15 files. Only the targeted browser suite was rerun for this test-only extension. Playwright emitted its existing `NO_COLOR`/`FORCE_COLOR` warning. No production behavior or wallet configuration changed.

This establishes automated app recovery under controlled transport faults. It does **not** establish native BSV Desktop behavior under a real lost response, wallet process crash or independent-buyer import. A live fault-injection test requires a separate eligible mined fixture and explicit explanation/authorization of its wallet mutation; do not reuse the successful ticket or clear its attempt protection. Controlled conflicting transfers and independent buyer custody remain separate pending experiments.
