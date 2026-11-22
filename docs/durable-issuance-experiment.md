# Durable issuance and offline resale experiment

This is a separate development harness at `/dev/feasibility`, under **Durable issuance and offline resale**. It implements the original design's online issuance/mining stage before attempting an offline resale. It has not yet passed a live mined-issuance, delayed transfer or wallet-restart test.

## Why this follows the staged fixture

The earlier ticket `a82983583a7a17dd76b647f787686d08fb27cb9329e1385df29f063574901acd.0` was created with `noSend:true`. The restored offline transfer later failed at `createAction` with HTTP 400. Its original response body was lost on reload. A read-only wallet review did not find the original ticket/change in the complete exposed output listings or its issuance/spend in the exposed action listing. This does **not** prove that every reserved input was released.

The isolated wallet's bundled toolbox has a staged action workspace with a maximum lifetime. Its source permits a terminal batch failure to retire that workspace. That is a plausible explanation for the observed disappearance, not a recovered diagnosis of the lost HTTP response. See [the incident record](ticket-authenticity-experiment.md).

The new path uses the wallet's ordinary online issuance processing and waits for a mining proof. It does not attempt to extend, resume or reuse the old issuance batch. It also does not prove that a new offline transfer can allocate fees without network access; that remains the live experiment.

## Review before the first live action

No agent has run these new controls against the live wallet. Keep the isolated wallet on testnet and preserve the original files and action references. Review the old wallet actions/funding state before authorizing another issuance. The old raw transaction includes a 4,955-satoshi change output; its saved ticket package does not include the wallet change derivation metadata. Do not blindly broadcast/import it or assume its change would remain tracked.

The new action is explicit:

- **Issue and broadcast test ticket** creates a **new** ticket ID using the wallet's testnet funding, with a one-satoshi PushDrop ticket output, wallet-managed change and transaction fees.
- It calls `createAction` with `noSend:false`, `acceptDelayedBroadcast:false`, `returnTXIDOnly:false` and a diagnostic label `counterfoil-issuance-<run-id>`.
- The wallet manages the issuance broadcast provider and funding/change records. This panel does not submit directly to ARC. Direct browser ARC settlement by the buyer is still a separate feasibility gate.
- The venue attestation signature is requested after the issuance response. If that signature fails, the issuance may already have been broadcast. The journal retains known references and blocks another mutation.
- A returned signed transaction is not evidence of mining or final settlement. Resale preparation stays disabled until a subject mining proof passes the local verifier.

This new broadcast is a different side effect from the earlier `noSend` controls. The operator must review it and tick the explicit authorization before using it. Existing legacy experiments remain separate; do not use their issue/restore buttons to retry this record.

## Operator sequence after authorization

1. Keep internet access enabled. Open the isolated test wallet on testnet and the app at the same `localhost` origin used previously. Verify the independently trusted venue public key. Set a fresh ticket ID.
2. Review and authorize **Issue and broadcast test ticket** once. Save **Download diagnostic record**, **Download durable ticket package**, **Download current receiving request** and **Download durable buyer request**. Both receiving keys belong to the same wallet in this experiment.
3. Wait for mining, then click **Refresh issuance mining evidence**. This only requests the network, public keys and wallet output evidence. It does not broadcast or import. If no proof is available yet, wait and repeat this read-only check. There is no automatic polling.
4. Download **durable SPV evidence**, load it using **Load signing result for SPV** in the Local SPV panel above, and sync required headers while online. Header range/checkpoint limitations still apply. The wallet candidate proof is not trusted simply because it arrived from the wallet.
5. Click **Prepare mined ticket for offline transfer**. It checks exact issuance bytes, complete BEEF, source availability, venue/lineage bindings, both receiving keys and the subject's mining proof against local headers. Missing headers or invalid evidence stop preparation.
6. Download the updated ticket package and both requests. Disable external networking for both browser and wallet, retaining localhost. Keep the wallet and tab open. Tick the offline acknowledgement and click **Sign offline transfer** once. This uses `noSend:true`, retains full ticket lineage and carries no expired issuance `noSendChange` references. It does not broadcast the transfer.
7. Download the saved diagnostic and transfer package immediately. Load the package and separately saved buyer request into **Venue and ticket provenance**, then verify locally and check the tampered copy. Record the actual result and zero local-verifier contacts; native wallet traffic is not measured by the panel.

## Delay and reopening checks

Before making a transfer, keep the mined issuance across a delay exceeding the old workspace lifetime (at least 65 minutes). Reload the website while online and confirm the same outpoint and prepared buyer request remain. No wallet request should run just from reload. Repeat the explicit read-only preparation after reopening, then disconnect and test signing. A separate wallet restart/unlock can be included before preparation to test durable wallet records; record the exact sequence.

Only one issuance and one transfer are supported in this saved experiment record. Do not run an immediate transfer and then try to repeat it for the delay test. A second independently funded scenario requires reviewed lifecycle/reconciliation support, not deleting the journal to bypass its guard.

The record persists in IndexedDB (`counterfoil-durable-ticket-v1`) at the current browser origin. Changing port, hostname or browser profile changes storage. Clearing site data removes this protection; it does not cancel wallet actions. The record is not a wallet backup, and downloaded diagnostics are not an import/recovery feature.

Full offline page reopening is **not** implemented here. There is no new service worker or app-shell cache. The tests establish diagnostic persistence on page reload and no automatic wallet activity, not that an unloaded website can start without a server or internet. Independent buyer custody and a second physical device also remain separate tests.

## Failure handling and evidence boundaries

A pending journal is committed before calling a wallet mutation. Atomic compare-and-swap prevents another tab with stale state from claiming the same experiment. Returned action references are persisted before the next signing step. A failed/lost/timed-out attempt remains pending or failed after reload, and additional mutations are blocked. A late response cannot continue to the next signing call. Storage failure before the claim prevents the wallet call; storage failure afterward leaves the pending attempt for manual review.

The panel has no automatic retry, broadcast, cancellation, internalization, deletion or reset. A timer ends waiting after 60 seconds; it cannot undo a wallet action already submitted. Save the diagnostic record and review the wallet before deciding any next action.

Proof refresh preserves the canonical attestation and raw issuance. It requires exactly one spendable ticket output, a complete bounded listing and complete BEEF with the unchanged target transaction. Read-only preparation requires local verification of the **issuance itself**, not just a mined ancestor. Local headers still check only the declared target, linkage and configured checkpoint/two-source agreement: full DAA and best-chain selection are outside this POC.

Even a locally verified mined issuance does not prove present unspentness globally, safe offline payment, no conflicting spend, admission eligibility or independent buyer key possession.

## Automated checks

- `tests/durable-ticket.test.ts`: issuance options; full/exact source evidence; required mining proof and local proof gate; receiving-key and network checks; no stale issuance change references. Synthetic proofs isolate adapter behaviour; tests do not claim a live mining result.
- `tests/durable-ticket.browser.test.ts`: explicit authorization, saved record/reload, no automatic wallet calls, storage failures, cross-tab claims, failed/lost response blocking and late-response suppression. All wallet calls are intercepted by the test runner.
- Existing SPV, ticket authenticity and wallet tests continue to cover their own boundaries.

Live wallet compatibility remains pending until the operator completes and records the sequence above.

Validation on 24 October 2026: 97 unit tests and 92 browser checks passed; production build and typecheck passed. Independent review found no actionable defects within this scope. Direct browser coverage of the new durable flow currently exercises issuance journaling, not a successful durable transfer or transfer-specific storage/timeout failures. This remains an evidence limitation alongside the pending live test.

## Mined-source preflight bug and scoped recovery — 24 October 2026

The operator's mined issuance `ef3cb74395e9c4813aa3bf5aa482fbec3bde608f3ac93573bf932e5f8ed23a92.0` obtained a proof at height 1,764,948. The operator reported a saved header snapshot `eb516b9364346c9e41c8dac4b2b883d92c674ce4ef0dd702918b5bbdb115e4f5`, then successful mined preparation. The next offline transfer attempt failed with `Expected a newly created, unmined transaction.` and last method `getPublicKey`.

This was a harness integration defect: the existing source was passed into the validator for a newly returned transaction. That validator intentionally rejects a subject Merkle path. A regression reproduced the exact error before the transfer's first `createAction`. The corrected path uses a distinct source-evidence validator; the new transfer draft/final transaction must still be unmined. The durable preparation retains its independent local mining-proof check. Tests now execute the complete synthetic mined-source-to-signed-successor path, not only the preparation adapter.

The saved failure remains blocked on reload. An explicit **Review mined-source preflight failure** control is available only for this exact legacy local error: failed transfer, last method `getPublicKey`, no wallet error response, exactly the original issuance reference, original-issuance package, saved buyer request, and no previous scoped recovery. The error text by itself is not sufficient. Generic HTTP failures, pending/lost responses and attempts with later action references remain blocked.

To resume this specific incident:

1. Save **Download diagnostic record** before refreshing. Reconnect external networking and keep the isolated testnet wallet open.
2. Reload the website at the same origin, then click **Review mined-source preflight failure**. It only reads the wallet and validates source evidence against local headers. It does not sign, broadcast, import or cancel anything.
3. If all checks pass, it atomically preserves the original failed attempt and error in `recoveredPreflight`, restores issuance readiness and prepares the mined ticket again. The issued ticket ID/outpoint remains unchanged; no replacement ticket is created.
4. Download the updated diagnostic, ticket package and receiving requests. Disconnect external internet, acknowledge isolation and sign once when ready. If any new failure occurs, retain its diagnostics and stop; the scoped recovery cannot be applied a second time.

This is an audited one-time preflight recovery, not a general reset or automatic retry. Storage conflict/failure or failed source/header/key checks cannot enable transfer. The actual live offline transfer remains unverified until the operator reports and exports a successful result. Automated tests use synthetic wallet transactions; they do not establish native offline fee allocation or independent buyer custody.

## Completed offline resale observation — 24 October 2026

The recovered preparation subsequently produced successor `324f4e7086e77c4ce905fde90035713f0e1429ffe63c1ca1a6f1d0257ba50d9e.0`. The saved journal records transfer complete, the package retains issuance plus successor, and downloaded evidence passes independent local signature/history/recipient/script checks. The operator reported verified local SPV against 1,764,948 and rejection of the tampered copy, with zero verification contacts. Network isolation remains operator-reported; both holder keys are in the same wallet, and the successor is saved without a mining proof or agent broadcast. See [the evidence review and reopening runbook](offline-reopening-experiment.md). Do not repeat issuance or transfer to test reopening.
