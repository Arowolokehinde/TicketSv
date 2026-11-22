# Venue authenticity and ticket continuity experiment

Implemented 23 October 2026 in `/dev/feasibility`, under **Venue and ticket provenance**. Automated tests use synthetic keys and transactions. The operator subsequently reported successful issuance, local SPV and issuer/continuity checks; the initial missing current-holder request left recipient verification incomplete. The operator then reported wallet-confirmed request recovery, all five checks passing for the original issuance, and rejection of a tampered copy with zero verification contacts. A ticket successor transfer remains to be recorded. The previously downloaded signing fixture and successful local SPV check remain separate evidence; they do not contain this ticket format.

Validation: 61 unit tests and 68 desktop/phone-viewport browser checks passed; TypeScript and the production build passed. Independent review findings about invalid-anchor precedence and intermediate JSON size expansion were reproduced and fixed with regression coverage. Phone viewports are not physical-device compatibility evidence.

## What this checks

- **Issuer:** a signature derived from the independently configured venue identity authenticates the event ID, ticket ID and finalized original transaction outpoint.
- **Continuity:** the original transaction and every retained ticket transfer form an uninterrupted chain. Each transfer spends its predecessor with a valid ticket-input signature and has exactly one recognized successor for this event/ticket.
- **Recipient:** the actual locking key and request ID match a receiving request saved independently before handoff. This does not prove private-key possession or who is holding the device.
- **Transaction:** complete Atomic BEEF is required and applicable unmined scripts are checked.
- **Anchors:** Merkle proofs are checked using the persisted local header snapshot. Its checkpoint, range and omitted difficulty-adjustment validation remain limitations.

Any failed check makes the result **rejected**, even if headers are missing. Missing headers or an absent expected receiving request leave otherwise valid evidence **incomplete**. A verified package still does not establish current unspentness, admission eligibility or the absence of a conflicting offline transfer.

Available Merkle roots are checked before missing confirmation-depth headers can produce an incomplete result. The SPV diagnostic export uses base64 proof bytes to avoid inflating the proof into a large numeric JSON array; the SPV importer still accepts the original signing-result downloads.

## Live steps

1. Keep the isolated wallet open on testnet with test funds. Use `http://localhost:5175/dev/feasibility`. The new fixture uses Desktop HTTP on port 3321. Keep the original Desktop wallet closed to avoid a port conflict.
2. Compare **Trusted venue identity** with the public identity from your isolated wallet connection. Its default is the identity previously observed in this project; change it explicitly if you use a different test wallet. Never set trust merely because an imported ticket names an issuer.
3. Enter event/ticket IDs. Acknowledge the testnet operation, then select **Issue test ticket** while online. This creates a signed `noSend` transaction, reserves inputs, and requests a separate issuance signature. Both holder keys are prepared in this same wallet for this experiment. It does not broadcast.
4. Download the **ticket package**, **receiving request** (the original holder), and **prepared buyer request** (the future destination). These are two different requests; preserve both. Also download **SPV evidence**, load it in the **Local SPV experiment** above, and sync its headers while online. A new funding source may require different anchors from your earlier fixture. Sync is limited to the pinned checkpoint window; an out-of-range result requires extending/reviewing that experiment, not bypassing validation.
5. Keep the browser tab, local server and wallet open. Disconnect external networking for both browser and wallet while retaining localhost. Check the acknowledgement, then select **Sign test transfer** once. This requests a new draft, signs its designated ticket input and finalizes with `noSend`.
6. Download the successor **ticket package**, **receiving request**, and **SPV evidence**. Select **Verify ticket locally**. Issuer, continuity and recipient checks should pass. Anchors pass only when all required headers are in the snapshot. Any newly needed headers must be synced online before repeating local verification offline.
7. Select **Check tampered copy**. It changes the ticket ID in a copy and should show **rejected**; the original package is preserved. Wrong issuers, copied attestations, broken/duplicated history and wrong recipients are covered by automated tests; their live demonstration remains to be recorded.

For later read-only checks, load the package and the independently saved receiving request in the import controls. Loading files and local verification never call the wallet. Downloads are diagnostic evidence, not product ticket acceptance or a wallet backup. There is no durable acceptance flow or offline reopening in this panel.

### If only the prepared buyer request was saved

The buyer request describes the destination of the future transfer, so it must not be used to validate the original issuance's current lock. Do not mint another ticket or merely copy the request embedded in the package into the expected-request field.

For this same-wallet issuance experiment, load the original ticket package and use **Confirm current-holder request with wallet** with the isolated testnet wallet open. The explicit action validates the issuer and issuance lineage locally, then reads the wallet network, public identity and derived receiving public key. It rechecks the network/identity and compares the returned key against the actual ticket lock and request ID. Only `getNetwork` and `getPublicKey` are permitted; it never creates, signs, imports or broadcasts a transaction. A wallet permission prompt may still appear.

On success, download **Receiving request**, then use **Verify ticket locally**. If the read fails, no request is accepted; check the wallet and retry the read-only action. This confirms a current-holder key binding through the wallet; it does not reconstruct a buyer's pre-handoff intent, prove private-key possession, restore the lost transfer preparation or establish spendability. Recovery is restricted to the original issuance. Keep the prepared buyer request for the later transfer.

If a wallet operation fails or times out, do not repeat it or refresh to retry until its action references and reserved inputs have been reviewed. Stopping the browser's wait does not roll back wallet activity. Download available action references. This experiment does not cancel actions or broadcast them automatically.

## Restore transfer preparation after losing the tab state

Use the existing original issuance; do not issue a replacement ticket. Keep the same isolated wallet open on testnet. This control is specific to the pinned isolated Desktop build (wallet-toolbox 2.14.9), not a general BRC-100 recovery guarantee.

1. Under **Load existing evidence**, load `counterfoil-ticket-package.json` containing the original issuance (one retained transaction).
2. Under **Resume the existing ticket transfer**, use **Load prepared buyer request** for the independently saved `counterfoil-prepared-buyer-request.json`. This is separate from the current-holder receiving-request input.
3. Select **Restore transfer preparation** while online. This explicitly reads the network, identity, both derived public keys, the ticket basket and wallet-managed change outputs. It creates no action or signature and does not broadcast, import or cancel anything. Permissions may be requested by the wallet.
4. On success, download the ticket package and current-holder receiving request. Preserve the prepared buyer request. Restoration resets the download/offline acknowledgements and locks the loaded context.
5. Keep the tab, local server and isolated wallet running, disconnect external internet, and check the offline acknowledgement. **Sign test transfer** is a separate testnet action: it may reserve fee inputs and requests signatures; `noSend` remains enabled. Trigger it once.
6. Save the successor package and its receiving request, then select **Verify ticket locally**. Expect two retained transactions and a recipient match to the prepared buyer request. Missing headers require online sync before repeating verification offline.

Recovery verifies the full evidence, issuer and issuance lineage before restoring. Source and buyer keys must be different and re-derived by this wallet. The ticket must be listed as spendable. Only managed change from this issuance is selected, with exact outpoint, amount and locking-script matches against its transaction. The ordinary `default` basket is not sufficient evidence that an output is wallet-managed change.

The read-only managed-change selector is wallet-toolbox's `specOpWalletManagedUtxos`, basket `284570a6213a74ba861c38b1cf790e1e400d9cf9324454b76ea98860b6031c1a`. Its behavior was inspected in the packaged isolated build: `sdk/types.js`, `Wallet.js`, `signer/actionBatch/ActionBatchWorkspace.js` and `storage/methods/ListOutputsSpecOp.js`. It includes unconsumed staged managed change. No invalid-output release, batch abort, storage repair or change-parameter operation is used.

Each listing must be complete and no larger than 1,000 outputs; duplicates, missing funding, mismatches and profile/network changes stop recovery. There is no fallback to guessing change or selecting unrelated funds. These are point-in-time local wallet observations, not proof of current network unspentness, absence of conflicting actions, or guaranteed offline funding. Staged listings do not check the batch reservation expiry; later signing can require a reservation renewal even when recovery succeeds. Wallet restarts can lose staged visibility; this control does not resume a missing wallet workspace. Report a failure instead of reissuing or forcing a retry after an ambiguous signing attempt. A failed read-only restoration can be retried; a failed mutation remains blocked in that tab. Downloads are diagnostic evidence, not a wallet backup or durable product acceptance.

## Exact wire and signing conventions

Both JSON envelopes use version 1 and network `testnet`. Their kinds are `ticket-package` and `ticket-request`. The total envelope is limited to 4 MiB; event, ticket and request IDs are nonempty and at most 128 Unicode code points. Invalid UTF-8/surrogates are rejected and IDs are not normalized. Binary fields use canonical base64. At most 100 transfers plus the original issuance may be retained.

Issuance signing bytes are UTF-8 JSON of this ordered array:

```text
["offline-ticket-issuance",1,"testnet",eventId,ticketId,originTxid,originOutputIndex]
```

The signature is requested after the origin transaction is finalized. This avoids trying to embed a signature over a transaction's own ID inside that transaction. The BRC-100 signing protocol is `[2,"counterfoil ticket issuance"]`, key ID is `originTxid.index`, counterparty is `anyone`. Verification derives the expected public signing key from the trusted venue identity using SDK `KeyDeriver('anyone')` and verifies the DER signature locally. The key included in the package must match that derived key; it cannot establish venue trust by itself.

Receiving keys use protocol `[2,"counterfoil ticket receiving"]`, key ID equal to the receiving request ID, counterparty `self`, and `forSelf: true`. The test fixture prepares separate source and destination keys in one wallet. An independent buyer/device remains a separate live test.

The PushDrop script uses a compressed public key followed by `OP_CHECKSIG`, one canonical JSON field, and `OP_DROP`. Each ticket output contains one satoshi. Its field is:

```text
["offline-ticket",1,"testnet",eventId,ticketId,originTxidOrNull,originIndexOrNull,requestId]
```

Original issuance uses `null, null` for origin. Successors reference the original outpoint. There is no inline metadata signature; the detached issuance signature authenticates the finalized origin, including its locking script. The verifier reconstructs and compares the exact script encoding.

## Evidence that survives proof shrinking

`lineageRawTxs` retains the original transaction and each designated ticket transfer in order, even when mined ancestors disappear from Atomic BEEF. The verifier checks IDs, origin references, one recognized successor per hop and exact predecessor spends. It validates each retained ticket-input signature with SDK `Spend` against its retained preceding output. Fee ancestry and mining evidence are handled separately by BEEF/SPV.

Automated compaction coverage gives a synthetic current transaction a mining proof and prunes its BEEF ancestry while retaining lineage. Altering a retained transfer then fails verification. This is not evidence of a live mined transfer or a measured live proof-size reduction.

## Remaining boundaries

This is a feasibility panel, not the final buyer/seller flow. Two-device handoff, independently held buyer keys, persistent acceptance, cold offline reopening, direct ARC submission, mining-proof updates, wallet import/reconciliation, conflicting transfers and scanner admission remain separate work. The local method log does not observe native wallet network traffic. Record actual wallet build, browser, network isolation, downloaded packages and verification results before closing live compatibility gates.


## Failed restored transfer — 24 October 2026

The operator reported successful transfer-preparation restoration, then HTTP 400 from `createAction` during the offline transfer attempt. No successor package was reported. The ticket panel previously retained only the SDK's HTTP status string, omitting the wallet response body; the browser request was unavailable and the operator reloaded. The actual error message is therefore unknown. Do not infer that it is the earlier missing-IPC method defect or an expired reservation solely from HTTP 400.

The panel now uses the existing bounded diagnostic response reader and exposes **Error details** and **Download failure details** (`counterfoil-ticket-failure.json`). It records phase, method, timestamp and allow-listed error fields, not request bodies, stacks or full replies. Details survive subsequent local verification within the tab; download them before a reload or another wallet attempt. No retries or wallet-state changes are introduced by diagnostics.

A subsequent read-only API review at 2026-10-24T13:28–13:29Z matched the configured isolated wallet identity and testnet before and after queries. `listActions` returned a complete listing with no original issuance or action spending its outputs. Separate complete `listOutputs` listings for the ticket basket and managed-change selector contained no outputs from `a82983583a7a17dd76b647f787686d08fb27cb9329e1385df29f063574901acd`. Queries used `seekPermission: false` and ordinary read arguments; no action creation, signature, broadcast, cancellation or reservation-release operation was invoked. These observations concern this wallet API's current visible records, not all storage reservations or network unspentness. They do not establish a safe mutation retry. The operator subsequently confirmed only the website was reloaded; no wallet restart or account/network switch was reported.


Source investigation found a plausible lifecycle explanation, not a confirmed historical error: the packaged toolbox `storage/methods/actionBatch.js` sets `ACTION_BATCH_HARD_LIFETIME_MS` to 60 minutes and rejects hard-expired batches. `ActionBatchController.recover` in `signer/actionBatch/ActionBatchWorkspace.js` retires a workspace after terminal batch-state errors, attempts its internal abort, then clears the workspace reference. Meanwhile its output-listing overlay does not check expiry. Thus restoration can see staged records that a later transfer cannot use; a terminal failure can subsequently remove those records from visible listings without an application restart. The agent did not invoke that retirement or abort path. Since the actual HTTP error body was lost, this remains a hypothesis for this incident. No safe signing retry or completed lifecycle fix is claimed.

Diagnostic validation: all 87 unit tests and 14 ticket browser checks passed, including a synthetic HTTP 400 test proving that error details survive local verification, omit arbitrary response fields/stacks, and never trigger signing retries. TypeScript and the production build passed as part of browser validation.
