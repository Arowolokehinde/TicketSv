# Offline signing failure in BSV Desktop 3.1.1

Recorded on **22 October 2026** for the Counterfoil offline-ticket POC.

The main failure was a missing connection between two internal parts of BSV Desktop. Wallet Toolbox requested an operation called `resumeActionBatch`, but Desktop's renderer-side storage adapter did not implement it. The underlying storage supported the operation, yet the request could not reach it.

This stopped the transfer during `createAction`, before the transfer-signing steps. It was not evidence of an invalid private key, failed cryptographic signature, or blockchain rejection. It also did not establish that all offline operations in BSV Desktop were impossible.

**Current outcome, updated 23 October 2026:** after building corrected upstream source with separate test storage, the user reported that fresh preparation and the subsequent offline signing attempt succeeded. The supplied preparation and signing-result files have now passed independent local checks of matching transaction intent, complete BEEF structure, transaction scripts and PushDrop metadata signatures. The subsequent [local SPV experiment](docs/local-spv-experiment.md) also verified the package against cross-checked headers under the pinned-checkpoint trust model. Actual signing network isolation remains user-reported; full difficulty validation and expired-batch recovery remain unverified. See the [downloaded evidence review](docs/signing-result-review.md).

## 1. Which version was affected?

| Item | What we established |
| --- | --- |
| Installed application examined | BSV Desktop **3.1.1**, based on its packaged application metadata |
| Latest published GitHub release | **v3.1.1**, rechecked through the official release API while writing this document on 22 October 2026 |
| Release publication time | `2026-10-11T21:30:42Z` |
| Wallet's reported API version | `wallet-brc100-1.0.0`; this is not the Desktop application version |
| Corrected source used for our build | Commit `361778c75a9933de36614a5ed82dc79b57a9870d`, whose package version is **3.2.2** |
| Counterfoil website SDK | `@bsv/sdk` **2.8.11** |
| Corrected source's wallet dependencies | `@bsv/wallet-toolbox` and `@bsv/wallet-toolbox-client` **2.14.9** |

The official repository contained a correction ahead of its published installer. A source package declaring version 3.2.2 does not mean a signed 3.2.2 installer was available. Our isolated app is a locally modified development build, not an official release.

Sources: [published v3.1.1 release](https://github.com/bsv-blockchain/bsv-desktop/releases/tag/v3.1.1), [latest-release API](https://api.github.com/repos/bsv-blockchain/bsv-desktop/releases/latest), [pinned source package](https://github.com/bsv-blockchain/bsv-desktop/blob/361778c75a9933de36614a5ed82dc79b57a9870d/package.json).

## 2. What we were trying to do

The feasibility page tests a smaller operation than the complete ticket product:

1. While online, derive two keys through the wallet and create two PushDrop locking scripts.
2. Create a one-satoshi, self-owned source output using `createAction` with `noSend: true`.
3. Save the source transaction's Atomic BEEF and preparation metadata.
4. Disconnect external networking while retaining the local browser-to-wallet connection.
5. Ask the wallet to construct a transaction spending that source into the second precomputed script.
6. Obtain the wallet-backed unlocking signature, call `signAction`, validate the final result and download it.

Both keys belong to the same wallet in this diagnostic. This is not yet an independently owned buyer's ticket or a two-device transfer. The source is also unbroadcast, so the experiment exercises chained, staged wallet actions rather than only spending a previously mined ticket.

The offline transfer request includes:

```ts
options: {
  noSend: true,
  signAndProcess: false,
  returnTXIDOnly: false,
  randomizeOutputs: false,
  noSendChange: prepared.noSendChange
}
```

`noSend` prevents this action from being sent to the network through this request. It does **not** promise that every internal wallet operation is network-free or that the wallet makes no local state changes. `signAndProcess: false` requests a signing draft so our app can provide the custom input's unlocking script before finalization.

Implementation: [src/wallet/signing-experiment.ts](src/wallet/signing-experiment.ts).

## 3. The error we captured

The useful failure report was:

```json
{
  "name": "Error",
  "message": "HTTPWalletJSON createAction failed with HTTP status 400",
  "phase": "transfer",
  "method": "createAction",
  "walletResponse": {
    "method": "createAction",
    "status": 400,
    "message": "action batch resume is not available"
  },
  "observedAt": "2026-10-22T14:54:53.929Z"
}
```

The HTTP status alone was not a diagnosis. It told us the local wallet rejected the request. The inner message identified the unavailable operation.

The method log showed successful network/identity reads followed by:

```text
createAction — started
createAction — failed
```

This transfer attempt did not reach the subsequent unlocking-signature request or `signAction`. Earlier online preparation had already involved signing; saying this transfer failed before signing does not mean no signatures had ever been created during the experiment.

The source implementation throws `WERR_NOT_IMPLEMENTED` for the missing operation. That error classification was established from code inspection; the captured HTTP response above did not itself expose that code.

## 4. What is an action batch, and why does it expire?

An action batch is an internal wallet workspace for constructing related transactions. It coordinates reserved inputs and staged transaction data. This matters when one unbroadcast transaction creates an output that a later transaction wants to spend.

Think of the workspace as the wallet's temporary working record for those related actions. Our saved JSON contains transaction evidence and preparation metadata; it is not a complete backup of that internal workspace.

The inspected implementation had these defaults:

| Mechanism | Default | Meaning |
| --- | --- | --- |
| Lease | 15 minutes | A temporary reservation period that the wallet can renew; an expired lease can lead to a resume attempt |
| Hard lifetime | 60 minutes | An upper bound on this batch's lifetime; ordinary resume does not revive a hard-expired batch |

These durations belong to wallet transaction assembly. They are **not ticket expiry times**, blockchain confirmation rules, or proof that a ticket is invalid after an hour.

We did not capture the original batch's creation and expiry timestamps. Therefore, we cannot assert exactly how long it had been idle. The observed message and inspected call path are consistent with the expired-workspace resume path, and that path was reproduced with synthetic state.

Relevant bundled implementation files are `signer/actionBatch/ActionBatchWorkspace.js`, `storage/WalletStorageManager.js` and `storage/methods/actionBatch.js` under `@bsv/wallet-toolbox/out/src/`. See also the [official source correction](https://github.com/bsv-blockchain/bsv-desktop/commit/edf71fac721124ace32ce5857f144b9fc94d4543).

## 5. Where the internal connection was missing

BSV Desktop uses Electron, which separates its interface from its native storage process. **IPC**, or inter-process communication, is how those parts exchange requests.

The intended route was:

```text
Counterfoil website
  → WalletClient / HTTPWalletJSON
  → local BSV Desktop wallet request handler
  → Wallet Toolbox action-batch workspace
  → WalletStorageManager.resumeActionBatch
  → StorageElectronIPC.resumeActionBatch
  → Electron main-process storage allow-list
  → native storage provider / SQLite
```

Two pieces of Desktop's IPC route were incomplete:

- `StorageElectronIPC` lacked the forwarding method for `resumeActionBatch`.
- The main-process allow-list lacked that method too. Adding only the renderer method would still leave the backend route blocked.

The underlying storage provider supported resume. Its capability advertisement and the storage manager's wrapper made resume appear available to the workspace. When the wrapper examined the actual writer—the IPC adapter—it found no implementation and threw the error.

In simplified pseudocode:

```text
workspace decides it needs to resume
storage manager receives resume request
storage manager checks active writer
active writer has no resume method
storage manager rejects the request
```

The observed error occurs at that writer check; it is not a failed SQLite query or a rejected blockchain broadcast.

The upstream commit explains why normal TypeScript compilation did not catch this: these storage interface methods were optional. An adapter could compile while omitting an operation that the runtime capability path later tried to use. Integration tests must check the complete route, not only the backend implementation.

Source references: [corrected renderer adapter](https://github.com/bsv-blockchain/bsv-desktop/blob/361778c75a9933de36614a5ed82dc79b57a9870d/src/lib/StorageElectronIPC.ts), [corrected main-process routing](https://github.com/bsv-blockchain/bsv-desktop/blob/361778c75a9933de36614a5ed82dc79b57a9870d/electron/storage.ts), [upstream commit explanation](https://github.com/bsv-blockchain/bsv-desktop/commit/edf71fac721124ace32ce5857f144b9fc94d4543).

## 6. How we established the cause

The diagnosis combined several kinds of evidence:

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| User's HTTP error report | The transfer's `createAction` failed with the batch-resume message | Exact batch age or every internal state change |
| Read-only inspection of installed 3.1.1 application code | The missing adapter method and the matching error-throwing branch | A successful corrected live transfer |
| Synthetic reproduction using the installed public implementations | An expired workspace with a writer lacking resume produces the exact error; supplying the operation permits the synthetic resume | Recovery of the user's original batch |
| Official upstream fix | Maintainers corrected the missing forwarding and routing | Availability of a published fixed installer |
| Tests and package inspection of our build | The corrected route and isolation changes are present and tested | Full SPV, real-world network isolation or two-device ownership transfer |
| User's subsequent successful attempt and reviewed download | A reported successful fresh signing run, with downloaded transaction bytes independently passing local script and structure checks | Independent observation of network isolation or proof that this run invoked expired-batch resume |

No private keys or real wallet database were needed for the synthetic reproduction. Tests used synthetic state; they were not retries against the user's funds.

## 7. The earlier Atomic BEEF error was a separate problem

Before the batch-resume diagnosis, the application displayed:

```text
Incomplete Atomic BEEF: full dependencies are required.
```

That first failure was caused by **our application's validation rule**, not the missing Desktop method.

Desktop can return an intermediate signing envelope containing the unsigned subject transaction and its immediate input parents, without all deeper ancestry and Merkle anchors. Our harness incorrectly demanded the same evidence completeness at that stage as it required for final signed output.

We changed draft validation to check the immediate source transactions, input/output indices and expected transaction intent. We retained strict completeness and script checks for preparation and final signed evidence. We did not solve that error by trusting an incomplete final ticket or fetching missing data during offline verification.

| Failure | Stage | Correction |
| --- | --- | --- |
| Incomplete Atomic BEEF | Application validation after a signing draft was returned | Apply draft-specific checks; retain strict final-evidence checks |
| Batch resume unavailable | Wallet `createAction`, before the transfer draft/signature stage | Restore the missing Desktop IPC route |

This distinction explains why correcting the first problem did not make the later attempt succeed automatically.

## 8. Why the first message was not useful enough

Initially, the UI displayed a generic wallet request/evidence failure. The SDK's outer HTTP error did not retain the useful inner explanation in the message shown to the user, and the request response was not available in the user's DevTools capture.

We added bounded diagnostics that inspect a clone of an unsuccessful HTTP response before SDK normalization. They retain selected error fields, method, phase, HTTP status and timestamp, with size limits and redaction. They do not retain complete request bodies, private keys or a full wallet response, and do not retry the mutation.

That change exposed the actionable batch-resume message. An empty browser network log is still not evidence that the native wallet made no external requests.

Relevant files: [connection.ts](src/wallet/connection.ts), [diagnostics.ts](src/wallet/diagnostics.ts), [SigningExperimentPanel.tsx](src/dev/SigningExperimentPanel.tsx).

## 9. What the upstream fix changed

The official correction is commit [`edf71fac721124ace32ce5857f144b9fc94d4543`](https://github.com/bsv-blockchain/bsv-desktop/commit/edf71fac721124ace32ce5857f144b9fc94d4543), authored on **12 October 2026**.

For the action-batch route, it adds forwarding methods and corresponding main-process allow-list entries for:

- `resumeActionBatch`
- `putActionBatchPack`
- `commitActionBatchByDigest`

The same commit also repairs BRC-177 expiry-related methods and monitor capability reporting. Our experiment did **not** opt into the BRC-177 expiry-label flow. That related change should not be confused with the particular batch-resume error we observed.

The upstream tests exercise the IPC-to-storage route. In particular, a nonexistent-batch resume case checks that the request reaches the backend and receives a backend missing-batch error. Passing that test proves routing; it does not prove that a real expired batch successfully resumes offline.

Read the [upstream regression tests](https://github.com/bsv-blockchain/bsv-desktop/blob/361778c75a9933de36614a5ed82dc79b57a9870d/test/storageIpcOptionalMethods.test.ts) alongside the [changelog](https://github.com/bsv-blockchain/bsv-desktop/blob/361778c75a9933de36614a5ed82dc79b57a9870d/CHANGELOG.md).

## 10. Why we built a separate isolated app

Updating the website's SDK alone would not install missing code inside Desktop. We built the corrected official source and then added local isolation changes so it could be tested in the same macOS account without using the installed wallet's automatic storage paths.

The resulting **Counterfoil Isolated Wallet**:

- Uses `~/.counterfoil-wallet-test-v1` for automatic wallet storage and explicit Electron data paths.
- Disables automatic/manual updates and certificate-trust installation.
- Guards worker database/cursor paths, automatic export filenames and selected symlink-sensitive storage paths.
- Retains the original bridge ports, so the installed wallet must be closed before testing.

The upstream correction fixes the missing operation. **Our isolation patch serves a different purpose: separating the test app's storage and behavior from the installed app.** It does not remove signature validation, SPV checks or the requirement for valid transactions.

The full final test command passed **767 tests**. A separate focused run passed **28 tests**, including eight isolation cases; those counts overlap and should not be added together. Package inspection matched 70 compiled files, and both packaged SQLite copies passed in-memory checks under Electron 41.10.7. These are build/regression results, not 767 live offline-wallet tests.

During packaging we also caught a SQLite binary built for Node rather than Electron. Rebuilding it for the Electron runtime resolved that packaging issue. It was a separate build-time problem, not the cause of the original 3.1.1 batch-resume error.

Records: [isolation plan](docs/superpowers/plans/2026-10-22-isolated-wallet.md), [artifact instructions](artifacts/wallet-test/isolated/READ-ME-FIRST.md), [exact local patch](artifacts/wallet-test/isolated/counterfoil-isolation.patch). Artifact files are local and Git-ignored.

## 11. Why retries, refreshing and reconnecting were not fixes

**Retrying:** does not add the missing method. It can create ambiguity about reserved inputs or partially completed actions if a response is lost.

**Reconnecting to the internet:** does not repair missing local IPC code. This error was discovered during an offline experiment, but its cause was not simply a lack of internet access.

**Removing `noSendChange`:** does not necessarily avoid the workspace. The explicit ticket input itself can refer to a staged output and select the same batch.

**Refreshing the page:** resets browser UI state, not wallet reservations, signed bytes or batch lifecycle. The earlier failed draft required a supported `abortAction` from its actual browser origin. That cancellation did not broadcast or revoke the source transaction.

**Restarting the wallet:** is not proof of recovery. Some staged state can be in memory, and wallet output listings can include that state. A listed spendable output is not proof that an unbroadcast chain will survive reopening.

**Using an internal legacy-mode switch:** the inspected wallet has an internal constructor option, but no equivalent public per-request BRC-100 option was verified. It was not an established app-side workaround.

**Disabling verification:** would undermine the POC and was not used.

## 12. What the successful attempt means, and what remains

The user subsequently reported successful connection, fresh online preparation, an offline signing attempt and a downloaded signing result in the isolated build.

This is encouraging evidence that the fresh same-wallet signing path can work in that environment. However, multiple conditions changed: the wallet code was newer, the identity/preparation was fresh, and the action-batch timing was different. The success does not by itself prove that `resumeActionBatch` was exercised during that attempt or that the original expired workspace is recoverable.

The next evidence checks are:

1. **Completed 23 October:** inspect the matching preparation and signing-result JSON files. Transaction IDs, dependency completeness, the intended spend/output and script validation passed. See the [review](docs/signing-result-review.md).
2. Record the actual network-isolation method. The app's wallet-call list cannot observe all native-wallet traffic.
3. Run a controlled lease-expiry test to exercise resume explicitly, then test the hard-expiry/lifecycle behavior separately. Review existing action state before another mutation.
4. Test the durable scenario: an issued/confirmed ticket and prepared fee funds, followed by a buyer-specific offline transfer.
5. Test app and wallet reopening, a second independently owned device, and complete issuer/transfer-continuity verification.
6. Verify Merkle anchors against locally validated headers. The current `tx.verify('scripts only')` check deliberately does not establish the accepted chain's header roots.

The signed-result bytes have now been independently reviewed locally; no broadcast/import outcome is claimed here. Offline signing success does not solve offline double-selling: conflicting valid-looking spends can still be handed to different buyers before network reconciliation.

## Reading order

For the failure and correction, read these in order:

1. [Official fix commit](https://github.com/bsv-blockchain/bsv-desktop/commit/edf71fac721124ace32ce5857f144b9fc94d4543) — the maintainers' explanation and changes.
2. [StorageElectronIPC](https://github.com/bsv-blockchain/bsv-desktop/blob/361778c75a9933de36614a5ed82dc79b57a9870d/src/lib/StorageElectronIPC.ts) — search for `resumeActionBatch`.
3. [Main-process storage](https://github.com/bsv-blockchain/bsv-desktop/blob/361778c75a9933de36614a5ed82dc79b57a9870d/electron/storage.ts) — inspect the allow-list and capabilities.
4. [IPC regression tests](https://github.com/bsv-blockchain/bsv-desktop/blob/361778c75a9933de36614a5ed82dc79b57a9870d/test/storageIpcOptionalMethods.test.ts) — distinguish forwarding tests from actual recovery tests.
5. [Our signing experiment](src/wallet/signing-experiment.ts) — follow `prepareSigning`, `transferSigning` and the final-evidence checks.
6. [Detailed experiment history](docs/offline-signing-experiment.md) — historical observations and recovery decisions. Earlier entries there describe what was known at that stage; this document includes the later user-reported success.
