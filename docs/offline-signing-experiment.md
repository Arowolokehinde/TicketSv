# Offline PushDrop signing experiment

Status updated **23 October 2026:** the user's fresh signing run in Counterfoil Isolated Wallet produced matching preparation and final exports that independently pass local transaction-script, metadata-signature and complete-BEEF-structure checks. Original network isolation is operator-reported; header-based SPV, reopening, two-device transfer and expired-batch recovery remain unverified. See the [downloaded evidence review](signing-result-review.md).

The sections below retain the earlier investigation history. The original saved-fixture failure in installed Desktop 3.1.1 was a confirmed batch-resume defect; the first attempt also exposed a separate app-side draft-validation bug. Later success used fresh preparation in the isolated corrected build, not recovery of that original batch.

The subsequent [local SPV experiment](local-spv-experiment.md) verified the same final package against cross-checked, locally validated headers on 23 October. The loaded package has no mining proof for its latest transfer, and the checkpoint/DAA trust limits still apply.

## First live attempt and draft-validation correction

The user's preparation download contains 1,986 bytes of Atomic BEEF, four transactions and one anchor. A read-only local check confirmed atomic structure, complete dependencies, txid agreement and script-only verification. No header-root check was made. BSV Desktop's installed application metadata reports version 3.1.1.

The user then reported `Incomplete Atomic BEEF: full dependencies are required.` The UI had recorded a second wallet action reference and 24 method-log entries. Given this implementation's sequence, the transfer createAction returned a signable draft, and the harness rejected it before requesting the transfer signature or signAction. The exact failed draft bytes were not captured.

Root cause: the installed wallet's bundled `makeSignableTransactionBeef` intentionally serializes only the unsigned subject and each input's raw immediate parent. It omits deeper ancestry and anchors. The harness incorrectly applied final-evidence completeness checks to this intermediate signing envelope. The same behavior is visible in the [wallet-toolbox implementation](https://raw.githubusercontent.com/bsv-blockchain/ts-stack/main/packages/wallet/wallet-toolbox/src/signer/methods/createAction.ts).

Correction: draft parsing now requires a correctly framed Atomic BEEF subject, no unrelated included transactions, an unmined subject, and all immediate input source transactions/output indices. Expected ticket input/output checks still run before any signature request. Preparation and final signed evidence still require the full dependency graph and successful script checks. No remote fetch or weakened final-proof acceptance was added.

Tests now reproduce Desktop's partial draft format instead of supplying unrealistic full ancestry. They failed with the original error before the fix and pass afterward, including rejection of missing immediate parents/outputs and incomplete final signed results. The failed wallet draft must be reviewed/released through supported wallet operations before attempting another spend; reloading alone does not clear it.

Recovery confirmed: the initial Node-side abortAction request returned HTTP 400 because the action belonged to a different originator. Running the supported cancellation from the actual browser origin, `http://localhost:5175`, returned `{ aborted: true }`. A subsequent read-only basket query listed the prepared source output as spendable. The source action remains `nosend`. No replacement transaction or broadcast was requested.

The new **Load saved preparation** control was checked against the user's existing download and real BSV Desktop. It restored successfully using only getNetwork, getPublicKey and listOutputs; transfer stayed disabled until a fresh isolation acknowledgement. It validates the source evidence, field signatures, derived wallet keys, network, identity and output availability. This is online restoration of this diagnostic fixture, not ticket acceptance, wallet recovery or offline reopening.

## Subsequent createAction failure and diagnostics

After loading the recovered preparation, the user's method log showed successful read calls followed by `createAction — failed` (20 entries total). No transfer createSignature or signAction was reached. The underlying response was not retained in browser DevTools. This observation cannot distinguish a wallet error, transport failure or SDK response-validation error, and does not demonstrate that Desktop cannot sign offline.

A subsequent read-only check from the original browser origin confirmed testnet and the saved identity. The prepared source was still listed as spendable. listActions returned four actions in total; the two matching experiment descriptions were preparation actions with `nosend` status. No transfer action was returned. This is a point-in-time wallet observation, not independent proof that all possible reservations are absent. No signing, creation, cancellation or broadcast was requested during this check.

The harness now provides **Error details** and **Download failure details** after a failed attempt. The optional developer HTTP observer reads at most 8 KiB from a clone of an unsuccessful response and retains only status, method, name, code and a bounded message. It captures these fields before the SDK replaces some errors with generic HTTP failures. The report also includes the SDK error summary, phase, timestamp, method log and known references. It excludes request bodies, stack traces and full response objects; messages remain untrusted diagnostic text and are rendered as text. Long hexadecimal strings are redacted. A malformed or oversized response yields status/method only. This does not change SDK response validation or retry mutations.

Reload online and load the existing preparation before the next controlled offline attempt. On failure, download the report before refreshing and review it before any further attempt. Reports from earlier failures cannot be reconstructed retroactively.

## Confirmed Desktop batch-resume defect — 22 October 2026

The next user-supplied report, timestamp `2026-10-22T14:54:53.929Z`, contains HTTP 400 from createAction and the wallet message `action batch resume is not available`. This is distinct from the earlier application-side draft-validation error.

Read-only inspection of `/Applications/BSV-Desktop.app/Contents/Resources/app.asar` established:

- Application package version: 3.1.1.
- Bundled `@bsv/wallet-toolbox/out/src/storage/WalletStorageManager.js`, `resumeActionBatch`: throws that exact message when the active writer has no resumeActionBatch method.
- Bundled renderer `dist/assets/index-C8vc48aL.js`: the class identified by its `StorageElectronIPC` log messages forwards beginActionBatch, extendActionBatch and renewActionBatch, but has no resumeActionBatch method. The backend StorageProvider implementation does have that operation.
- Bundled `signer/actionBatch/ActionBatchWorkspace.js`: an expired workspace calls resumeActionBatch when the negotiated capability says resume is supported. `canResume` checks the storage manager's wrapper method, which exists, rather than the underlying IPC writer. The failing call occurs before this transfer's planner/signing work.
- Bundled storage defaults are a 15-minute lease and a 60-minute hard lifetime. These are implementation defaults, not a measured timestamp for the user's active batch. The observed error and call path are consistent with expiry while the fixture remained in the wallet session.
- Related noSend actions reuse the workspace when their explicit input or noSendChange refers to a staged output. Removing noSendChange alone does not bypass the workspace when the ticket input still refers to the staged source.
- The wallet constructor supports `actionBatchMode: 'legacy'`; the inspected public BRC-100 createAction options expose no equivalent per-request switch. No app-side workaround was verified.

An isolated Node VM loaded the installed public ActionBatchWorkspace and WalletStorageManager implementations. With a synthetic expired workspace and a writer lacking resumeActionBatch, renewIfNeeded produced the exact observed message. Adding that method to the synthetic writer renewed the synthetic lease successfully. No real wallet, storage database, private key, signature, transaction or network operation was used. This reproduces the missing-method defect; it does not establish that a patched wallet completes the entire transfer.

The [official releases page](https://github.com/bsv-blockchain/bsv-desktop/releases) still listed 3.1.1 as latest when checked. No published corrective release was verified. A wallet-side fix must wire resumeActionBatch through StorageElectronIPC and verify backend routing/capability negotiation. Disabling the optimization in a separate development build is another candidate to evaluate, not a proven offline workaround. Neither approach should be installed over the user's current wallet without reviewing the concrete build and state handling.

Do not repeat the same saved-fixture transfer expecting a different result. Do not restart or clear the wallet merely to remove the workspace: its listActions/listOutputs methods overlay in-memory staged actions, so earlier listings did not establish durable persistence of the unbroadcast source. Keep the diagnostic download and preparation. Wallet lifecycle recovery and a corrected test build must be reviewed before the next live attempt. The app's ordinary signing request, noSend protections and strict final evidence checks remain unchanged.

## Fix research — official upstream correction found

Research on 22 October 2026 found an existing upstream fix, so a new wallet patch need not be invented. The earlier conclusion that the installed build is defective stands; the earlier recommendation was incomplete because the official source already contains the correction.

### Source and release status

- Official fix: [edf71fac721124ace32ce5857f144b9fc94d4543](https://github.com/bsv-blockchain/bsv-desktop/commit/edf71fac721124ace32ce5857f144b9fc94d4543), `fix(storage): support BRC-177 noSend expiry and batch uploads over IPC`, authored 12 October 2026.
- Inspected upstream checkout: [361778c75a9933de36614a5ed82dc79b57a9870d](https://github.com/bsv-blockchain/bsv-desktop/tree/361778c75a9933de36614a5ed82dc79b57a9870d), downloaded into `/tmp/counterfoil-wallet-fix-research`. Its package version is 3.2.2. This is source metadata, not evidence of a released installer.
- The [upstream changelog](https://github.com/bsv-blockchain/bsv-desktop/blob/361778c75a9933de36614a5ed82dc79b57a9870d/CHANGELOG.md) explicitly names the exact batch-resume error and its correction.
- Live GitHub API checks of both `/releases/latest` and the recent releases list still returned v3.1.1 as the newest published release. Source is ahead of published installers. The release-page statement was accurate; an intermediate suggestion that the release listing was stale was not supported by the live API.

### What the upstream fix actually changes

`src/lib/StorageElectronIPC.ts` now forwards resumeActionBatch, putActionBatchPack and commitActionBatchByDigest. `electron/storage.ts` permits all three through its storage-method allow-list. Fixing the renderer proxy alone would leave the request rejected by the main process. The same commit separately fixes BRC-177 expiry methods and monitor gating; our experiment does not opt into BRC-177 reclaim/expiry labels.

The upstream `test/storageIpcOptionalMethods.test.ts` exercises proxy-to-main forwarding and real StorageKnex entry points. Its resume case deliberately uses a nonexistent batch and checks for the expected backend missing-batch error. That proves routing coverage, not a successful expired-batch recovery or a full offline handoff. Initially inspected only; these tests subsequently passed in the authorized build work below.

Executed research check: transpiled the actual upstream StorageElectronIPC class, instantiated it with a synthetic identity and stub IPC transport, and compared it with the pre-fix class. All three methods are absent before the fix and forward their arguments/results after it. Three checks passed; zero live wallet calls. The first assertion used the wrong IPC argument-envelope shape and was corrected to the actual array envelope before the three checks passed. No backend SQLite integration or packaged wallet test was performed in this research.

### Decision

Use a pinned build of official BSV Desktop source containing the upstream fix for the next compatibility experiment, with a fresh testnet-only wallet in an isolated environment. First run the upstream IPC/storage tests and build checks. This preserves BRC-100, WalletClient and wallet-held private keys. It does not require a ticket-platform backend or changing the website's signing API. No wallet application was installed, launched, upgraded or patched during research.

A separate app name or Electron userData directory alone is insufficient isolation: current source supports BSV_DESKTOP_USER_DATA for vault/browser settings, but database paths and wallet-portability bindings still use the operating-system home directory's `.bsv-desktop`. Ports 3321/2121 are also shared. Prefer a separate OS account or VM for live testing; do not reuse the current identity/database in parallel. Resolve the original staged preparation separately rather than importing private keys or treating its file as a wallet backup.

### Why the other routes are not the first choice

| Route | Research finding | Decision |
| --- | --- | --- |
| Official source build with the existing fix | Exact error is addressed in both IPC layers | First candidate; live offline result still required |
| Set actionBatchMode to legacy | Internal wallet constructor option, not a public app request option; ordinary storage planning can still consult a ChainTracker | Fallback research only; not a verified offline fix |
| Assemble the transaction in the app and request signatures | Could avoid createAction planning but adds explicit funding/reservation/tracking responsibilities and changes the agreed integration | Do not switch architecture before testing the official correction |
| Retry faster, refresh, remove noSendChange, or stay online | Does not repair missing IPC support; explicit ticket input also selects the same batch | Not an acceptable resolution |

### Remaining offline dependencies and acceptance checks

The installed toolbox distinguishes soft-expired and hard-expired batches. Defaults are 15 minutes and 60 minutes; resume rejects the hard-expired state. The fix does not make the old in-memory preparation indefinitely reusable. Batch leases belong to wallet transaction assembly, not to ticket validity. A real ticket should survive independently of a temporary wallet batch.

Ordinary storage createAction code can verify input BEEF through Services.getChainTracker. Desktop's service factory configures a ChaintracksServiceClient. A complete proof package therefore does not, by itself, prove that every wallet path avoids network access. Funding inputs, source scripts and proof data also need to be locally available. These are risks to test, not additional observed failures. Disabling proof validation would not be an acceptable workaround.

Required sequence before declaring this blocker cleared:

1. Build the pinned official source and run its IPC/storage tests in isolation; verify the packaged build contains all three methods and backend allow-list entries.
2. On a fresh testnet wallet, prepare local fee funds and complete ancestry, then disconnect external networking for the browser, wallet and native worker while retaining localhost.
3. Run createAction, wallet-backed signing and signAction; export the final Atomic BEEF before reconnecting. Preserve errors and native process network observations.
4. Repeat across the soft-expiry boundary. Exercise hard-expiry as a lifecycle case; do not accept a workflow that relies on finishing within a short timer.
5. Test the intended durable scenario using an already issued/confirmed ticket and prepared fee funds, then create the buyer-specific transfer at offline handoff. Repeat app/wallet reopening and a second real device. This is a separate fixture from the current fully-unbroadcast diagnostic chain.
6. Verify the recipient's complete package against local headers and issuer evidence, persist acceptance, and broadcast/import only in their authorized later stages.

The research identifies a concrete upstream correction for the observed blocker. It does not yet prove packaged-wallet compatibility, offline reopening, indefinite staged noSend persistence, or the full two-device flow.

## Corrected wallet build evidence — 22 October 2026

Built the pinned official source with Node 22.20.0 and locked dependencies. Renderer TypeScript/Vite compilation and Electron compilation passed. Upstream regression tests `storageIpcOptionalMethods.test.ts`, `walletCreateActionWire.test.ts` and `monitorWorker.test.ts` passed: **35 tests across 3 files, none skipped**, including the real SQLite storage cases. This is a targeted regression run, not the full upstream suite or a live offline signing result.

The test package uses product name `Counterfoil Wallet Test` and app ID `org.counterfoil.wallet-test`. Do not launch it in the existing wallet profile. Prefer a disposable macOS VM with a fresh testnet wallet; a separate OS user still shares bridge ports and requires the original bridge to be stopped first. `BSV_DESKTOP_USER_DATA` does not relocate all wallet database paths. Startup also retains upstream updater and certificate-trust flows; do not install certificates or accept updates during this test. Use the existing HTTP connection for the diagnostic.

No existing wallet application, database or key was replaced. No live wallet request, signature or broadcast was made during this build work. The old staged preparation is not repaired by compiling the fix. Live signing, lease boundaries, reopening and two-device SPV remain open gates.

Package verification passed: all 67 compiled JavaScript/HTML/CSS files in the archive match the build output, all three corrected methods are present in both layers, and bundle identity/version/arm64 architecture match the intended test build. Running only Electron's Node mode (without the wallet entry point) loaded packaged better-sqlite3 and executed `SELECT 1` against an in-memory database under Electron 41.10.7. The bundle has no Developer ID signature or notarization; its executable has an ad-hoc linker signature. This is a local development artifact, not an official installer.

The package and evidence are stored in ignored `artifacts/wallet-test/` in the Counterfoil repository. See `BUILD-RECORD.md` there for provenance, checksum and launch restrictions. The wallet UI has not been launched.

## Current-account isolated wallet fork

The user chose a local isolation patch instead of changing macOS accounts. The new **Counterfoil Isolated Wallet** uses a fixed `~/.counterfoil-wallet-test-v1` root for automatic storage, explicit Electron browser/log paths, guarded worker paths, and disabled updates/certificate installation. It is a local fork of the corrected upstream source, not a published BSV Desktop release. The older Counterfoil Wallet Test ZIP/shared kit remains unchanged and must not be confused with it.

Artifacts, patch, build logs and first-launch instructions are under `artifacts/wallet-test/isolated/` (ignored by Git). See the isolation plan and evidence (internal working notes, not published). All critical activity must be explained to the user in advance. The wallet UI has not been launched, and no old wallet data was accessed. Existing BSV Desktop must be quit before a future isolated launch because ports remain shared. Use a fresh testnet identity and HTTP 3321. User-selected file imports/exports and OS Keychain services remain outside the automatic-storage separation; this is not an OS sandbox. Live offline signing remains open.

## What this isolates

Use one BSV Desktop wallet to create a one-satoshi PushDrop fixture while online, then attempt to transfer it to a second key in the same wallet after external internet access is disabled. Both transactions remain unbroadcast. The wallet retains all private keys.

This checks the wallet's ability to assemble and sign a custom input with supplied ancestry. It does not complete venue issuance, establish the recipient convention for a separate buyer wallet, implement ticket acceptance, or prove the five demo scenes. The embedded PushDrop field signature is not the separate trusted-venue attestation required by the ticket specification.

## Prerequisites

- Run `npm run dev` and open **http://localhost:5175/dev/feasibility** on the computer running BSV Desktop. The IP-address origin `127.0.0.1` is unsuitable for this wallet's identity requests.
- Select testnet and unlock the wallet. Use its testnet funding/faucet flow if available. The [official development guide](https://hub.bsvblockchain.org/bsv-code-academy/beginner-path/beginner/development-environment) describes the built-in faucet. Faucet availability has not been tested in this session; do not substitute mainnet funds.
- Have enough test funds for a one-satoshi token and wallet-selected fees. Funding amount and fee availability have not yet been measured against the live wallet.
- Record the installed wallet application release, OS and browser. `wallet-brc100-1.0.0` from getVersion is an interface version, not the desktop application release.
- Keep the local wallet bridge at HTTP port 3321 available. Native wallet service access must be observed separately from browser requests.

## Run the experiment

1. In **Offline signing experiment**, acknowledge test funding and the wallet reservation effects, then select **Prepare signing fixture** while online. This performs wallet key derivation, signs the PushDrop fields and creates a self-owned fixture with `noSend: true`.
2. Confirm that preparation returned signed bytes. Download the preparation JSON and verify that the file was saved. It contains public experiment metadata, exact source Atomic BEEF, derivation identifiers and noSendChange outpoints. It can be loaded again by this diagnostic while online; it is not an accepted ticket or a wallet backup.
3. Keep the page and wallet open. Disable all external networking used by the browser and native wallet, including alternate adapters/VPN paths, while retaining localhost. Do not use browser-only offline emulation as evidence that the wallet is offline. Do not close or reload the app: offline reopening is a later gate.
4. Record how isolation was established. Acknowledge that preparation was saved and external networking isolated; select **Attempt transfer signing**. Approve wallet prompts if shown.
5. On success, download the signing result before reconnecting. It contains the exact final Atomic BEEF and source fixture. The page reports local script checks, not SPV or independently observed offline success.
6. Record outcome, method sequence, timestamps, byte counts and any failed stage. Keep signed evidence controlled: reconnecting or abandoning the UI does not revoke signed transaction bytes. No broadcast control is included here.

## Resume the recovered preparation

1. With internet available and BSV Desktop unlocked on testnet, reload **http://localhost:5175/dev/feasibility**.
2. Under **Load saved preparation**, choose `counterfoil-signing-preparation.json` from Downloads. Do not create a new fixture. Wait for the source transaction and **Download preparation** button to appear.
3. Keep the tab, local development server and wallet running. Disable external internet access, retaining localhost.
4. Tick the isolation acknowledgement and select **Attempt transfer signing** once.
5. Download the signing result if it succeeds. If it fails, retain the error and action references for review before another attempt.

The downloaded JSON is human-reviewable diagnostic evidence. It contains no private key, but it includes the wallet's public identity and transaction data; it is not automatically committed to the repository. Review/redact it before creating public fixtures.

## Pinned SDK recipe

SDK: `@bsv/sdk` 2.8.11. Transport: explicit `WalletClient(new HTTPWalletJSON(...))` to the local desktop HTTP endpoint; no discovery, relay or backend.

Preparation:

- Read testnet and identity, then use protocol `[2, "counterfoil signing experiment"]` with unique run-specific source/destination key IDs and counterparty `self`.
- Generate both self-owned PushDrop scripts before disconnecting, including their field signatures. Recheck network/identity before creating the source transaction.
- Create a one-satoshi output with `options: { noSend: true, returnTXIDOnly: false, randomizeOutputs: false }`. Save `noSendChange` for the chained transfer.
- Reject a signable-only response as final source evidence. Preserve any returned action reference or txid for manual investigation.

Transfer:

- Check testnet and the same wallet identity. Recheck the source bytes and designated output.
- Supply source Atomic BEEF as `inputBEEF`; request its outpoint using `unlockingScriptLength: 73`; create a one-satoshi successor with the precomputed script.
- Use `options: { noSend: true, signAndProcess: false, returnTXIDOnly: false, randomizeOutputs: false, noSendChange }`.
- Keep the returned `signableTransaction.reference`. Parse the signing-only Atomic BEEF, require every immediate source output, and match the intended input and output before requesting a signature. Do not require full ancestry at this draft stage.
- Recheck network/identity. Use `PushDrop.unlock(protocol, sourceKeyId, "self", "all", false)` to obtain the wallet-backed unlocking script.
- Call `signAction({ reference, spends, options: { noSend: true, returnTXIDOnly: false } })`. No `sendWith`, broadcast or import is called.
- Require a final txid matching the returned transaction, a complete atomic dependency graph without txid-only entries, the expected output, nonempty unlocking scripts and successful `tx.verify('scripts only')`. Compare final inputs, outputs, sequences, version and lock time with the approved draft.

The script-only verifier never uses the default remote ChainTracker. It deliberately skips header-root validation at supplied anchors. Thus complete BEEF structure and valid scripts do not establish that the anchors belong to the accepted chain. The local-header SPV implementation remains required.

## Failure and reservation handling

The UI waits at most 60 seconds per phase. It never retries a mutation automatically. A timeout, lost response or local validation error may leave a wallet action or reserved inputs even if the UI has no final result. Known references remain visible. Review wallet state before another attempt; reload/reset is not cancellation or reversal. The experiment does not manipulate wallet storage or forcibly release reservations.

Preparation warms the SDK modules in the current tab. A browser test blocks subsequent app-asset requests during transfer, but this is not evidence of native-wallet isolation, service-worker support or cold reopening.

## Evidence required before a live pass

Record successful preparation, exact real wallet application/device versions, independently established network isolation, final bytes exported before reconnection, script verification outcome and observed native-wallet traffic. Then repeat against a second real wallet/device and with the actual trusted-venue ticket format. A warm same-wallet signing result alone must not close the full offline handoff gate.

## Automated validation — 22 October 2026

- Full unit suite after the diagnostic update: **23 passed**, including thirteen signing tests with a deterministic test wallet and explicitly invented anchor.
- Full browser suite: **52 passed** across desktop and phone viewport sizes. Type checking and production build passed as part of this run.
- Signing browser checks cover downloadable wallet failure details without retry/signing, literal rendering of error messages, saved-preparation loading without mutation and a fresh isolation acknowledgement, preparation/signing/download, no new app-asset loading after preparation, explicit acknowledgements, mainnet rejection, timeout and lost createAction/signAction responses. A delayed response cannot turn a timed-out attempt into success or trigger a repeat mutation; known signing references remain visible.
- Independent review found no material implementation defect and requested mutation-specific lost-response coverage; those tests were added and passed. Additional focused unit cases for changed input and alternative final transactions remain useful follow-up coverage, not live evidence.
- The original implementation checks involved no live wallet mutation. The user's subsequent live preparation and failed transfer-draft attempt are recorded above; corrected offline signing has not yet been demonstrated.

## Reference material

The implementation follows the wallet-backed custom-input signing pattern in the official [PushDrop example](https://bsv-blockchain.github.io/wallet-toolbox-examples/pushdrop.html), with `noSend` retained in both stages as described in the [noSend examples](https://bsv-blockchain.github.io/wallet-toolbox-examples/nosend.html). Exact method shapes were checked against the installed SDK types and implementation.

See [feasibility evidence](feasibility.md), [compatibility](compatibility.md) and the bounded implementation plan (internal working notes, not published).

## Follow-up: durable issuance

The staged signing fixture is not a durable ticket issuance workflow. The separate [durable issuance experiment](durable-issuance-experiment.md) uses ordinary online wallet issuance, waits for locally verified mining evidence and then tests a new offline transfer without old issuance change references. Its explicit broadcast control has different effects from this document's `noSend` fixture; read the runbook before authorizing it. Live compatibility is still unproven.
