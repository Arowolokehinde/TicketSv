# Local SPV feasibility experiment

Implemented and checked on **23 October 2026** in `/dev/feasibility`. This is the next diagnostic after offline signing, not a finished ticket acceptance or scanner flow.

## Use it

1. Open `http://localhost:5175/dev/feasibility` with the development server running. Find **Local SPV experiment**.
2. Load `counterfoil-signing-result.json`. This reads the export locally; it does not access the wallet.
3. While online, select **Sync required headers**. Wait for **Header snapshot saved**. Both public sources must agree; the snapshot is promoted only after validation and the IndexedDB transaction completes.
4. Keep the tab open and disconnect external networking. Select **Verify locally**. Successful verification lists the anchor height, package size and zero verification server contacts.
5. A missing header produces **Verification incomplete — required block header missing**. Reconnect and sync, then verify again. There is no hidden remote fallback.

The package and verification result stay in the tab. Headers persist in this browser/origin's IndexedDB and are revalidated on reload. `localhost` and `127.0.0.1` have separate browser storage. Offline app reopening still needs the planned app-shell cache; it is not implemented here.

## Header trust and scope

The experiment pins testnet checkpoint **1,762,324**:

```text
00000000077273c54c7ef1702e329e7bab4d6bc924f7715b75a2816f9fd3d747
```

On 23 October, WhatsOnChain and BSV Blockchain's public Chaintracks service returned matching serialized headers for that checkpoint and height **1,762,325**, the supplied package's anchor. Public response fixtures are in `tests/fixtures/headers/`. The mined-ancestor fixture contains only an already-mined public transaction and its proof, extracted from the supplied package. It does not include the user's unbroadcast preparation or transfer.

Normal sync revalidates stored headers locally, cross-checks the last saved header with both sources, and fetches only missing heights through the required anchor. It never shrinks the stored range. **Recheck all headers** explicitly fetches the full range from the checkpoint through the required anchor (or the existing snapshot's end if later). Coinbase anchors additionally require headers through anchor height + 100 for the SDK maturity check, within the same range limit. The app derives this depth requirement from the proof rather than trusting a file label. Each sync remains bound to the checkpoint. The experiment supports **4,096 headers after the checkpoint**, through height **1,766,420**; anchors outside that range require a deliberately reviewed checkpoint/range change. This preserves the original checkpoint while accommodating fresh ticket funding at height 1,764,620. The original 128-header cap was too small for that fixture. It does not download the current chain tip.

For every header the app checks the exact 80-byte encoding, computed hash, claimed height, compact-target bounds, PoW against the declared target, previous-block linkage and agreement between both providers. The local tracker reads only those validated bytes and compares the SDK-computed Merkle root with the stored root.

**Full difficulty-adjustment rules and independent best-chain selection are not implemented.** Verification trusts the pinned checkpoint and agreement between the configured providers. Two sources are a cross-check, not proof of independent upstream infrastructure or a substitute for consensus validation. Results are relative to the stored snapshot, including its age.

Starting a sync clears the displayed verdict. Normal sync saves complete validated prefixes as it advances; errors or cancellation retain the last committed prefix. The user must verify again against that snapshot, and a missing required anchor remains incomplete. A changed cached boundary stops normal sync. Explicitly rechecking the bounded range supports agreed changes after the checkpoint and reports changed heights; that mode replaces history only after the whole range passes. Checkpoint conflicts fail closed. Full product-wide reorg handling and revalidation of saved tickets remain planned.

## Network and persistence boundaries

Online GETs use:

- [WhatsOnChain](https://docs.whatsonchain.com/): `https://api.whatsonchain.com/v1/bsv/test/block/{height}/header`
- [BSV Chaintracks v2](https://github.com/bsv-blockchain/go-chaintracks): `https://arcade-v2-testnet-us-1.bsvblockchain.tech/chaintracks/v2/header/height/{height}`

The current public testnet hostname was checked against the [official Toolbox configuration](https://github.com/bsv-blockchain/ts-stack/blob/main/packages/wallet/wallet-toolbox/src/services/networkConfig.ts). Both services returned `Access-Control-Allow-Origin: *` on the inspected requests (WhatsOnChain tested with the localhost origin). Browser CORS/service availability can change; failure does not bypass checks or enable a relay.

Requests omit credentials, reject redirects, limit bodies to 16 KiB and time out after 20 seconds. WhatsOnChain requests are spaced at least 400 ms apart within a sync. Cancellation aborts requests. Logs contain provider, height, timestamp and success/failure only; they cover this panel's requests, not native wallet traffic. Logs retain the most recent 512 contacts.

`counterfoil-spv-experiment-v1` is a separate IndexedDB database. Validation happens again when loading a saved snapshot. Failed/cancelled writes do not promote it. Browser storage is not a tamper-proof trust boundary against a compromised app or user editing site data, and clearing site data removes the snapshot.

## Actual downloaded result

The new verifier was run locally against the user's supplied signing result and the two-source header records:

| Check | Result |
| --- | --- |
| Transaction | `4458587f0111100ac562621fdad1b852532aba9f07c19cfbde9fccf16321908d` |
| Atomic BEEF size | 2,445 bytes |
| Verified ancestor anchor | 1,762,325 |
| Header snapshot ID | `32d54839b2983938b528587e319456c52e391444dade5686db28554b5774a4b0` |
| BEEF Merkle verification with explicit local tracker | Passed |
| Transaction verification with explicit local tracker | Passed |
| Fetch calls during this local verification | 0; fetch replaced with a throwing function |
| Latest transfer mined | No mining proof in this package |

No wallet was contacted, and nothing was broadcast, signed or imported during these checks. A subsequent live Chromium check used the actual supplied file, fetched four headers directly from the public services (two heights from each), then switched that browser context offline. Verification passed with zero further requests and zero wallet requests. The original signing isolation remains operator-reported. A browser offline-emulation test establishes that this verifier works without external requests in that browser; it does not independently audit the original native-wallet signing run.

SPV transaction evidence does not establish trusted venue authorship, ticket continuity, buyer identity/key ownership, current unspentness or admission eligibility. Those remain separate checks. A loaded export's identity/network labels are not trusted as cryptographic assertions.

## Validation

Unit tests cover real header serialization/PoW/linkage, malformed targets, stored snapshot validation, explicit local tracking, source agreement/outage/range/cancellation, response limits, real Merkle proof validation, missing headers and invalid spends. Browser tests cover explicit sync, offline verification, persistence, corruption and failure retaining the last snapshot. See the execution record in the implementation plan (internal working notes, not published) for final run results.


## Fresh-ticket range extension

The fresh issuance required anchor 1,764,620, beyond the original upper limit of 1,762,452. The range cap was extended to 4,096 without replacing the pinned checkpoint or weakening validation. Existing snapshots remain valid. The original range-extension implementation cross-checked every intervening height on each run. The incremental update below now reuses stored history and saves validated prefixes.

With no prior snapshot, checkpoint 1,762,324 through 1,764,620 means 2,297 headers and 4,594 source requests before retries. WhatsOnChain pacing alone requires about 15 minutes; response latency and retries add time. Any coinbase maturity requirement can increase the target. The UI shows cross-checked-header progress and the total request count, while retaining the latest 512 detailed log entries. No fixed overall timeout interrupts a healthy long sync; individual requests still time out after 20 seconds and the operator can cancel.

Keep the tab online until **Header snapshot saved** appears. Cancellation or source failure retains the most recently committed validated prefix. Normal retry rechecks that prefix’s boundary and resumes from there. This range fix does not prove the new package's SPV result: the user must finish syncing and verify the actual package. No automatic provider downloads or wallet operations are performed by the update.

## Interrupted request handling — 24 October 2026

The operator's next sync reached height 1,762,479. Chaintracks returned that header, but the WhatsOnChain browser fetch failed; the log contained 312 completed source attempts and the previously saved snapshot at 1,762,324–1,762,325 was retained. A limited subsequent GET to each configured endpoint returned HTTP 200, matching block hashes and `Access-Control-Allow-Origin: *`. This shows current availability, not the cause of the earlier browser failure. The generic fetch error cannot distinguish a connection interruption, browser restriction or a throttled response hidden by browser access rules.

The adapter now makes at most **three attempts per provider and height** for network/stream failures, request timeouts, HTTP 408/429 and HTTP 5xx. Backoff is 2 seconds then 4 seconds, or a longer `Retry-After` when the browser exposes it. An exposed delay above 60 seconds stops automatic retry and asks the operator to try later instead of retrying early. Cancellation interrupts backoff. Permanent HTTP failures, invalid JSON/headers, size-limit failures and disagreement between sources are not retried as transient failures.

An automatic retry remains on the failed height within the current sync and retains preceding in-memory work. Exhausting retries ends the operation and retains the latest committed validated prefix; the next manual sync resumes from it. Unchecked or unlinked headers are never persisted. Logs identify provider, height, attempt, failure category and HTTP status when observable. Bounded retry improves resilience but cannot guarantee a provider will recover or complete the full live download.


## Incremental syncing and resumable progress — 24 October 2026

The operator approved removing repeated full-range downloads and retaining validated progress. The checkpoint, 4,096-header range limit, two-source cross-check, proof-of-work/linkage checks, maturity rules and offline verification path are unchanged.

- **Normal sync:** validate the stored snapshot, cross-check its last header with both sources, then fetch missing heights. If the required range is already present, only two source requests are needed (before retries). No new header is accepted from one source alone.
- **Progress saving:** save a validated prefix after the first newly downloaded header and every 32 new headers, and save the complete target on success. Every committed prefix is checked from the pinned checkpoint and stored atomically in the existing header database. Interruption can lose up to 31 downloaded-but-unsaved headers, not the entire download. A shorter saved prefix does not satisfy an absent ticket anchor.
- **Resume after reopening:** the panel reads the latest persisted snapshot on each sync. Concurrent writes compare the snapshot identity in the same IndexedDB transaction; a stale tab stops rather than overwriting another tab’s progress.
- **Changed history:** a changed boundary or source disagreement fails closed. **Recheck all headers** fetches the full range, validates it and reports affected heights. A failed full recheck preserves the prior saved history and publishes no replacement prefix. This remains provider agreement anchored to a checkpoint, not independent best-chain selection.
- **Corrupt snapshot recovery:** normal sync rejects invalid stored headers. Explicit full recheck can rebuild a malformed JSON snapshot record, retaining it until the replacement is completely validated. An exact stored-value comparison prevents recovery from overwriting a concurrent change. Arbitrary non-JSON IndexedDB values are not a supported recovery format.
- **Performance limits:** first-time sync still needs every missing header from both paced sources and can take 15 minutes or longer. Already committed progress is reusable only in the same browser profile and origin. Unpersisted work from the old implementation cannot be recovered by this update.

No live wallet actions, header downloads into the user’s browser, or automatic sync were performed for this change. Existing storage is reused without a schema migration. Reload the online development harness to use the new **Sync required headers** behavior; **Recheck all headers** is deliberately the slower option.

Validation: 121 unit tests passed; full browser suite 115 passed with one existing intentional phone-viewport restart skip. Typecheck/build and whitespace checks passed. New regressions cover cached-tip-only requests, prefix persistence after cancellation and reopening, explicit full recheck, corrupt-record recovery, and concurrent-write protection. Review identified the corrupt-record recovery dead end; it was reproduced, fixed and reviewed again with no remaining blocking findings. Runner output retains the existing NO_COLOR/FORCE_COLOR warning. These are automated results with fixed header fixtures, not a claim that the operator’s live download has finished.
