# Wallet feasibility evidence

**Update — 23 October 2026:** the fresh isolated-wallet signing exports have now passed independent local script, metadata-signature and complete-BEEF-structure checks. Network isolation remains operator-reported, and this does not close the full offline-signing compatibility gate. See the [signing-result review](signing-result-review.md). The dated connection-stage and failure observations below are historical.

**Local SPV:** the [header experiment](local-spv-experiment.md) now verifies the downloaded final transaction against a persisted local snapshot. The actual package passed with anchor 1,762,325; its subject has no mining proof in the loaded package. This does not close venue, buyer, reopening or double-spend gates.

**Venue and ticket provenance:** a separate [authenticity experiment](ticket-authenticity-experiment.md) now implements canonical issuance attestations, retained transfer signatures and recipient-lock verification. Explicit same-wallet testnet controls create fresh evidence; file import and verification are local. Automated coverage is synthetic; subsequent operator observations are recorded below and do not close the full compatibility gate.

**Operator update — 24 October 2026:** the user reported successful issuance at `a82983583a7a17dd76b647f787686d08fb27cb9329e1385df29f063574901acd.0`, then a saved header snapshot through 1,764,620 (`62be01adb7d8d5ca3c898c3baa5298110b1955133bb8120f875e442e06bc80e0`). The posted SPV result passed with zero verification contacts. The posted provenance result passed issuer, original-issuance continuity, transaction and anchors; recipient remained incomplete because the current-holder request was not saved. Only the prepared buyer request was available. This is one retained issuance transaction, not a completed transfer; network isolation is not independently measured by these reports. A read-only current-holder request confirmation control has been added to recover that diagnostic input through the same wallet. Its automated tests do not establish a live recovery result or close the full gate.

**Subsequent operator report — 24 October 2026:** current-holder confirmation succeeded. All five provenance checks passed for the original issuance, and **Check tampered copy** rejected the altered ticket ID (issuer and continuity failed; transaction/anchors/recipient remained valid). Both posted results reported zero local verification contacts. The original package was preserved. These are operator-provided UI results; they do not establish an independently held buyer, a completed transfer, latest-transfer mining or admission. A separate read-only transfer-preparation restoration control now supports the retained original package and independently saved buyer request; its live outcome is still pending.

## Current scope — 22 October 2026

The developer harness at `/dev/feasibility` can explicitly connect to a selected BRC-100 wallet and read its network, wallet protocol version and public identity key. This completes the connection experiment within Task 1 of the parent plan, not the full feasibility phase or a product wallet flow. The seven formal gates remain **Not tested** pending their complete evidence requirements.

The selected SDK substrate is passed to `WalletClient` directly. This avoids automatic transport discovery. Desktop HTTP uses `http://localhost:3321`, desktop HTTPS uses `https://localhost:2121`, and BSV Browser uses the native bridge. No relay, backend, wallet database or new dependency was introduced.

## Live result

On 2026-10-22 at 11:23:03 UTC, the local Mac running BSV Desktop completed the check from `http://localhost:5175/dev/feasibility` in Playwright Chromium 156.0.8078.4, using SDK 2.8.11 and the desktop HTTP transport.

| Call | Observed response |
| --- | --- |
| `getNetwork({})` | HTTP 200; `testnet` |
| `getVersion({})` | HTTP 200; `wallet-brc100-1.0.0` |
| `getPublicKey({ identityKey: true })` | HTTP 200; compressed public key accepted by curve and canonical-encoding checks |
| `getNetwork({})` | HTTP 200; `testnet` |

The identity key is intentionally omitted from this document. It was shown only in the test browser's session result. The reported version identifies the wallet interface; the installed BSV Desktop application release was subsequently inspected and recorded as 3.1.1 during signing diagnosis. The user confirmed the wallet was unlocked on testnet before the check.

An earlier request from `http://127.0.0.1:5175` reached network/version methods but failed at public identity: HTTP 400, `IP address originators are not permitted.` No permission prompt appeared, as reported by the user. Changing the actual browser origin to `localhost` resolved it; the app does not spoof its originator or bypass wallet permissions. The first automation wait also timed out without a confirmed result; the successful result above comes from a later instrumented run.

This establishes online, read-only connectivity on this machine. It does not establish signing permission, venue trust, offline operation, cold reopening, funding, transaction creation or import. Browser observations do not capture network requests made inside the native wallet.

## Repeat the check

1. Run `npm run dev`, then open **http://localhost:5175/dev/feasibility** on the same computer as BSV Desktop. Use `localhost`, not `127.0.0.1`, for wallet testing.
2. Open and unlock BSV Desktop; select testnet.
3. Choose **BSV Desktop — local HTTP (3321)** and select **Connect wallet**. Review any permission prompt in the wallet.
4. Confirm the session result shows testnet, the reported interface version, public identity key and timestamp. The method log should show only network, version, identity and network recheck.
5. Clear the result or reload. The app forgets it and does not reconnect automatically. This does not revoke permissions already granted inside the wallet.

Mainnet is rejected before requesting identity. Attempts can be cancelled and time out after 30 seconds, including while SDK assets are loading. A late response cannot complete an old attempt. HTTP requests are aborted; a native wallet prompt may need to be dismissed separately. Errors shown in the app use fixed messages rather than exposing raw wallet responses.

HTTPS and the native bridge remain separate, unverified device paths. HTTPS requires a trusted certificate. A phone viewport in Playwright is not a physical phone or a BSV Browser test. Local development does not yet support offline reopening: the service worker and durable ticket/header storage are still planned.

## Automated evidence for the connection phase

- `npm test`: 10 unit tests passed.
- `npm run test:browser`: 38 browser tests passed across desktop and phone viewport sizes, against a fresh production build. TypeScript and Vite build passed as part of that command.
- Connection tests use controlled wallet responses, not real funds or signing. They cover explicit requests, testnet gating, invalid/noncanonical keys, network changes, cancellation, late responses, timeout, retry, absent native bridge, session-only state and no startup wallet calls.
- Review found that cancellation could wait indefinitely for a stalled lazy import. Regression tests failed before the fix and passed afterward; they hold the SDK chunk, cancel or expire the attempt, and retry after releasing it.

## Remaining experiments

The **Offline signing experiment** controls are implemented in the harness. Live preparation returned a 1,986-byte fixture that passes local structure and script checks. The first transfer attempt exposed a harness bug: complete proof ancestry was required at the intermediate signing-draft stage, although Desktop intentionally returns raw immediate parents only. That distinction is now fixed and regression-tested; successful live offline transfer signing remains unproven. The first failed draft was cancelled through the wallet from its actual browser origin, and the saved preparation reloads successfully using read-only wallet calls. A subsequent offline attempt failed at createAction; the captured error and installed-code reproduction now identify a missing batch-resume method in Desktop 3.1.1's storage bridge. This saved-fixture path is blocked pending a tested wallet build and state review. Research found the exact official upstream correction in commit `edf71fac721124ace32ce5857f144b9fc94d4543`; it is present in source but not in the latest published installer returned by the release API. Earlier spendable listings include a possible in-memory overlay and do not prove durable persistence. Error details can be downloaded on failures. See the [signing runbook](offline-signing-experiment.md) for evidence, reservation handling and the corrected recipe.

Continue the parent plan with exact wallet application/device versions and controlled testnet fixtures:

1. Prepare funding and required wallet data while online, then prove a signed PushDrop transfer with `noSend: true` while both parties are offline. Inspect whether final Atomic BEEF requires a separate signing step in the tested wallet.
2. Verify venue authenticity and transfer continuity, including wrong issuer and changed payload cases and evidence retained after proof shrinking.
3. Repeat with closing and reopening the app and wallet, recording which capabilities require connectivity.
4. Test direct ARC submission, status and mined-proof retrieval, including browser access constraints and lost responses.
5. Test post-broadcast `internalizeAction`, basket storage and retry/reconciliation behavior.
6. Test controlled conflicting transfers and scanner decisions. Offline verification alone cannot prove current unspentness or detect all duplicate entrance use.

Those experiments use controlled testnet fixtures and extend beyond this read-only check. This connection experiment created no transactions and requested no signatures or funds.

## Sources and inspected interfaces

- [TS Stack architecture layers](https://bsv-blockchain.github.io/ts-stack/architecture/layers/)
- [Wallet-aware app guide](https://bsv-blockchain.github.io/ts-stack/guides/wallet-aware-app/)
- [BRC-100 architecture](https://bsv-blockchain.github.io/ts-stack/architecture/brc-100/)
- Installed `@bsv/sdk` 2.8.11: `WalletClient`, `HTTPWalletJSON`, `ReactNativeWebView`, wallet argument/result validation and public-key primitives. The direct SDK path keeps transport selection explicit; convenience helpers are not required for this experiment.

See [compatibility](compatibility.md) and the connection implementation plan (internal working notes, not published).


## Restored ticket transfer failure — 24 October 2026

The operator reported restoration success followed by `HTTPWalletJSON createAction failed with HTTP status 400`. The underlying wallet message was not captured, and a subsequent page reload discarded tab state. This is an unresolved live transfer failure; no ticket successor or offline-transfer success is claimed. Detailed error capture has been added to the ticket panel using the existing diagnostic reader. A read-only review of the same testnet wallet found no currently listed original-issuance action, related spending action, ticket output or source managed change. Missing API records do not prove the absence of reservations or authorize retry. See [the incident details](ticket-authenticity-experiment.md#failed-restored-transfer--24-october-2026).

### Durable issuance follow-up (24 October 2026)

A separate **Durable issuance and offline resale** panel now prepares an online wallet-broadcast issuance, persists a diagnostic mutation journal and requires locally verified subject mining evidence before offline transfer preparation. See [the runbook](durable-issuance-experiment.md). The old staged ticket is not automatically broadcast, imported or retried. No new live issuance or transfer has been performed by this implementation. Automated persistence/proof-gating tests do not close the delayed signing, wallet-restart, offline app reopening or independent-buyer gates.

### Mined-source transfer preflight defect — 24 October 2026

The operator reported a mined issuance at `ef3cb74395e9c4813aa3bf5aa482fbec3bde608f3ac93573bf932e5f8ed23a92.0`, local headers through 1,764,948 and successful mined preparation. Its subsequent offline transfer failed locally before `createAction`: the harness wrongly applied a new-unmined-transaction validator to the mined source. A test reproduced this exact failure and the source/final validation distinction is now corrected. A tightly scoped, explicit read-only recovery control preserves the original failed record and revalidates wallet/source/local headers before restoring preparation; uncertain wallet failures remain blocked. See [the incident and recovery steps](durable-issuance-experiment.md#mined-source-preflight-bug-and-scoped-recovery--24-october-2026). This is an automated fix result, not a successful live transfer report.

### Successful durable transfer follow-up — 24 October 2026

The operator subsequently reported the durable successor `324f4e7086e77c4ce905fde90035713f0e1429ffe63c1ca1a6f1d0257ba50d9e.0` signed and saved without broadcast. Its downloaded package, diagnostic and prepared buyer request have now passed independent local issuer/continuity/recipient/complete-BEEF/applicable-script checks. The operator's UI showed all five checks passing against headers at 1,764,948, then rejected a changed ticket ID with zero local verification contacts. This supersedes the earlier “not yet successful” wording for this specific same-wallet run, not the full compatibility gate. File hashes, evidence boundaries and the next reopening runbook are in [offline reopening](offline-reopening-experiment.md).

### Direct submission implementation — 25 October 2026

The **Online transfer submission** panel now reviews existing signed evidence, obtains provider policy/status explicitly, and requires a separate acknowledgement before POST. A separate IndexedDB journal records the attempt before dispatch, preserves unknown outcomes and prevents stale-tab replacement. Mining inclusion requires a matching subject proof, reported block hash and locally validated header; provider `MINED` alone is insufficient. Source wallet journals, reopening evidence and headers are not modified by this panel. See [the ARC runbook](arc-submission-experiment.md) for the 139-testnet-satoshi transfer review and operator steps.

No live POST or wallet operation occurred during this implementation. Direct POST acceptance and later proof retrieval/verification remain untested live. Reported same-wallet offline reopening and receiving-key checks do not establish independent buyer custody. Wallet import/reconciliation and controlled conflict tests remain separate work.

### Operator-reported settlement result and next preflight — 25 October 2026

The operator subsequently reported one submission of transfer `324f4e7086e77c4ce905fde90035713f0e1429ffe63c1ca1a6f1d0257ba50d9e`, provider `MINED`, and **Mining proof verification: verified** with all five checks passing against stored headers at **1765176**, with zero local-verification server contacts. This supersedes the preceding untested-live statement for this specific run. It is reported UI evidence, not a new independent audit of downloaded artifacts or a general wallet/platform compatibility claim.

The next [wallet import preflight](wallet-import-experiment.md) reads the existing same-wallet ticket basket before any import is proposed. It requires fresh local verification of the saved mined settlement candidate. Matching output records do not close the import/reconciliation gate. No live wallet call or import was performed while implementing this preflight.

### Wallet import controls — 25 October 2026

The subsequent live read-only preflight found the successor absent from the named basket and exposed action listing, while the original issuance remained recorded. See the [wallet import runbook](wallet-import-experiment.md) for exact observations and limits. A separate **Import mined ticket** control now requires explicit consent, fresh local mining verification, an absent complete wallet listing and matching wallet/receiving identity. It claims one durable attempt before `internalizeAction`, blocks duplicates after reload and supports read-only output reconciliation after an uncertain response. Import response and output observation stay separate. No live mutation was performed during implementation; actual import acceptance and reconciliation evidence remain pending.

The operator subsequently reported a successful live import at `2026-10-25T21:19:13.289Z` and matching ticket output at `2026-10-25T21:19:17.771Z`, with one returned `internalizeAction` call. This establishes reported success for that same-wallet run; it does not close lost-response recovery or independent-custody tests. Preserve the downloaded diagnostic and confirm persistence with a read-only reconciliation after reload. Details: [live import result](wallet-import-experiment.md#operator-reported-live-import-success--25-october-2026).

The operator then reported the same accepted attempt and a fresh **present** observation at `2026-10-25T21:21:50.560Z`. Ordinary reconciliation is therefore reported successful for this run. A subsequent automated response-loss exercise passed on desktop and phone viewports: unknown outcomes survive reload, present/absent read-only reconciliation never retries or rewrites the response, and diagnostic exports retain the original attempt. Validation: 16 targeted browser tests and 158 unit tests passed, with build/typecheck passing. These use intercepted HTTP wallet responses and synthetic fixtures, not the live wallet. Native lost-response recovery remains unproven. See [scope and results](wallet-import-experiment.md#follow-up-reconciliation-and-controlled-response-loss-tests--25-october-2026).

### Controlled conflicting transfers implementation — 26 October 2026

A separate conflict panel now prepares a fresh three-output fixture, signs two branches through the wallet's public signature API, verifies them locally, and supports separately authorized per-branch ARC submissions. Its dedicated journal preserves uncertain outcomes and does not reuse the successful ticket's import/settlement records. See the [operator runbook](conflicting-transfers-experiment.md) for costs and exact steps.

Automated validation passed: 178 unit tests, 171 browser tests, one existing browser case skipped, and production build/typecheck. An independent review's three Important findings were fixed with regression coverage. No live wallet or provider action ran during implementation. Controlled conflicts, independent buyer custody, native lost-response behavior and physical-device acceptance remain pending live evidence.
