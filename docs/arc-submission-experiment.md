# Direct browser submission: preparation and findings

25 October 2026. Implementation and synthetic validation; no live transfer was submitted.

## Existing evidence

The operator reported successful saved-transfer verification after reopening and a receiving-key challenge passing again after following the isolated-wallet restart instructions. External network isolation and the physical restart are operator observations, not independently monitored. This is a same-wallet test and does not establish independent buyer custody.

The downloaded durable package and independently saved buyer request were read again locally. Issuer, retained history, recipient and complete-BEEF/applicable-script checks passed. No browser header database was accessed by that file check, so anchors were correctly incomplete in that standalone run. The operator's earlier browser result passed anchors at 1,764,948.

The proposed transaction is already signed:

| Item | Value |
| --- | --- |
| Network | BSV testnet |
| Transfer | `324f4e7086e77c4ce905fde90035713f0e1429ffe63c1ca1a6f1d0257ba50d9e` |
| Input 0 | `ef3cb74395e9c4813aa3bf5aa482fbec3bde608f3ac93573bf932e5f8ed23a92.0`, 1 satoshi |
| Input 1 | Same issuance transaction, output 1, 4,955 satoshis |
| Ticket output | Output 0, 1 satoshi, buyer receiving lock |
| Change output | Output 1, 4,816 satoshis |
| Embedded fee | 139 testnet satoshis |
| Raw transaction size | 553 bytes |
| Retained ticket transactions | 2 |

Both inputs have the mined issuance as their immediate parent in the saved evidence. Submission would publish these existing signed bytes and permit their inputs to be spent if accepted. It would not create another signature or change the fee. No claim of current unspentness has been made.

## Provider access observations

All live requests in this preparation were GET or OPTIONS. Browser checks used a fresh temporary Playwright Chromium profile and a minimal locally intercepted page with origin `http://localhost:5175`; they did not open the user's browser profile or call a wallet. Responses below are point-in-time observations around 07:56–07:58 UTC.

TAAL documents `https://arc-test.taal.com/v1` as its testnet endpoint. `GET /policy` returned HTTP 200 without a key in the command-line check, but sent `Access-Control-Allow-Origin: *` twice. A real browser fetch rejected it with the explicit multiple-values CORS error. Command-line access does not establish direct browser compatibility. No proxy or browser-security workaround was used.

Candidate provider: `https://arcade-v2-testnet-us-1.bsvblockchain.tech`, the host already used by the header experiment. The official Arcade project documents an ARC-compatible submission/status interface. Explicitly use this provider in the proposed experiment; do not silently fail over to it or to another network.

- Browser `GET /policy`: HTTP 200; advertised fee 1 satoshi per 1,000 bytes, maximum transaction size 100,000,000 bytes, standard format supported. This is not an acceptance guarantee.
- Browser `GET /tx/324f…50d9e`: HTTP 404, transaction not found. This establishes only this provider's response, not absence from the network.
- Browser `GET /tx/ef3c…23a92`: HTTP 200, `MINED`, height 1,764,948, block hash `0000000021f4d7b83ca6de5e079c92eec27d80a3bd7c06957ad23763fb893c6a`, and a hex BUMP `merklePath`. This was a status observation, not a fresh local proof-verification result.
- `OPTIONS /tx` with localhost origin and requested POST/content-type: HTTP 204, a single wildcard origin and POST/content-type allowed. The preflight observation does not establish successful POST acceptance, response CORS or propagation.

## Implemented experiment

The **Online transfer submission** panel in `/dev/feasibility` reads the original completed diagnostic or downloaded evidence saved by `/dev/reopening`. It validates the transfer against the same browser's local headers, shows its inputs, outputs, recipient and embedded fee, commits a separate attempt record before dispatch, and requires a dedicated broadcast acknowledgement. Status lookup and provider policy requests are separate controls. Opening or reloading the panel makes no provider or wallet request.

Treat a lost POST response as an unknown outcome, retain the attempted bytes and reconcile by transaction ID. A provider's `MINED` label is not enough: validate the returned proof and reported block hash against local headers before offering verified updated evidence. Missing headers use the existing sync workflow and never trigger remote verification. Wallet import, independent custody and conflict experiments remain separate.

### Operator steps

1. Use the current production build at `http://localhost:5175/dev/feasibility`, in the same browser/profile containing the saved ticket and headers. Reload that page after rebuilding. Do not issue or sign another ticket.
2. Find **Online transfer submission** and select the evidence source containing `324f…50d9e`. Choose **Review saved transfer**. Confirm both inputs, the buyer key/request, the 1-satoshi ticket, 4,816-satoshi change and **139-satoshi fee** against the table above.
3. Choose **Check provider policy**, then **Check transfer status**. These are explicit GET requests, with no broadcast. If the provider already knows the transaction, review its status rather than submitting again. The earlier 404 is not evidence of its current status.
4. Only when ready to publish those exact signed bytes, tick the broadcast acknowledgement and choose **Submit reviewed transfer to testnet** once. This POST can spend the displayed testnet inputs if accepted; cancelling cannot undo it. The panel checks policy and local evidence again immediately before dispatch.
5. If the result is pending or unknown, use **Check transfer status**. A freshly pending attempt has a 60-second review delay to avoid racing a live request. No automatic retry occurs. After a status check, only an unknown/not-found status with no earlier known acceptance, rejection, conflict or stale-block observation permits an explicit identical-byte retry, with a separate acknowledgement and a maximum of three attempts. Earlier known statuses permanently block submission in this experiment, even after a later 404 or UNKNOWN. A 404 never proves the earlier POST was not received. Do not clear storage to bypass the record.
6. Once status reports `MINED` or `IMMUTABLE`, choose **Verify mining proof locally**. If headers are missing, **Download candidate evidence for header sync**, load it in Local SPV above and sync the required heights. Then repeat local verification. An unusable proof or different block/root fails; out-of-range headers require reviewed rebootstrap.
7. Only a fresh locally verified inclusion result enables **Download updated ticket package**. Export rechecks evidence, status and headers. **Download settlement observation** captures bounded attempt/status/check diagnostics. Reload requires a new verification verdict.

The provider's status and the local proof result are separate. This panel does not update the wallet, accept a ticket, prove current unspentness, or change the original journal, reopening evidence or header stores. A stale-block status clears the displayed verification result. Earlier submission responses remain in immutable attempt history. The latest 32 explicit GET checks, including timestamped 404 results and bounded mining proofs, are retained separately and included in the observation export. History also starts when a status check occurs before any POST; the retry prohibition survives history rollover.

### Validation boundary

Tests use synthetic signed tickets and intercepted provider calls; no test submits the operator's transfer. The browser UI harness stubs the synthetic ticket's SPV and mining-anchor boundaries because it has no genuine mined anchor. It exercises successful package export and clearing a verified display after headers go missing. Real proof membership, block-hash and Merkle-root checks are separately tested against public mined fixtures and validated headers. A live successful POST, later transfer proof, and export backed by a genuine mined ticket remain operator checks; mocked responses do not close the ARC feasibility gate.

Implementation plan: ARC submission (internal working notes, not published).

### Operator-reported live result — 25 October 2026

After the implementation checks above, the operator reported one saved submission attempt, an initial `RECEIVED` response, then `MINED` observed at `2026-10-25T20:27:08.923Z`. Local verification initially lacked header **1765176**. After syncing, the operator reported **Mining proof verification: verified**: issuer, continuity, recipient, transaction and anchors all passed, with zero local-verification server contacts. Subject: `324f4e7086e77c4ce905fde90035713f0e1429ffe63c1ca1a6f1d0257ba50d9e`.

This records the supplied UI result for the isolated same-wallet test. It does not independently re-audit the downloaded proof, establish current unspentness or admission, or demonstrate wallet import. Retain the updated ticket package, settlement observation and independent buyer request. Next: [read-only wallet record review](wallet-import-experiment.md); do not broadcast this transfer again.

## Primary references

- [TAAL ARC endpoints](https://docs.taal.com/core-products/transaction-processing/arc-endpoints).
- [ARC API schema](https://github.com/bitcoin-sv/arc/blob/main/pkg/api/arc.yaml): status, submission and hex BUMP response fields.
- [Official Arcade API overview](https://github.com/bsv-blockchain/arcade#api-usage): root `/tx`, `/tx/{txid}` and status lifecycle.
- Installed `@bsv/sdk` 2.8.11: Transaction EF serialization, MerklePath, Atomic BEEF and ARC response handling. The planned transport retains the status and proof rather than reducing the response to a broadcast-success flag.

Automated validation after independent review fixes: 140 unit tests passed; 131 browser tests passed, with one existing duplicate phone-viewport process-restart check skipped. TypeScript and production build passed. Review corrections preserve earlier known-status retry blocks, retain the latest 32 GET observations, and clear obsolete mining verdicts when revalidating.
