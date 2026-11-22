# Controlled conflicting transfers

This separate test creates one new testnet ticket and two dedicated fee outputs. It signs two transactions which spend the same ticket to different receiving keys. Both may pass local verification while unmined; that does not mean both can settle or pass the POC door policy.

The successful ticket `324f4e7086e77c4ce905fde90035713f0e1429ffe63c1ca1a6f1d0257ba50d9e.0` and its import, reopening and settlement journals are not reused. A separate IndexedDB database, `counterfoil-conflict-experiment-v1`, holds each run and its attempts. No live wallet action occurred during implementation.

## Costs and signing method

The new issuance creates a 1-satoshi ticket, fee A of 1,000 satoshis and fee B of 1,000 satoshis, plus ordinary wallet funding/change and issuance fees. The wallet chooses its funding inputs and issuance fee. Those amounts are not an estimate of the full issuance fee. Review any wallet approval. Each signed branch spends the ticket and only its corresponding fee output; its only output is a 1-satoshi successor, giving a fixed fee of 1,000 testnet satoshis. Provider policy is checked again before publication. No signed fee is changed automatically.

SDK 2.8.11 `PushDrop.unlock(...).sign(...)` requests signatures via the wallet's public `createSignature` API. Keys stay in the wallet. This experiment deliberately assembles both competing transactions locally rather than cancelling or rewriting a wallet spending action. The signatures do not reserve outputs or update wallet spend records. Keep this dedicated fixture out of ordinary wallet/ticket operations. Signed bytes can be published later and cannot be revoked by closing the page. The losing branch's dedicated fee output may remain unspent; there is no automatic cleanup or wallet import.

Both buyers use separate keys in the same isolated wallet. This does not test independent custody. A native-wallet refusal is a compatibility result, not authorization to extract keys, change wallet databases or substitute simulated signatures.

## Operator sequence

Use the current production build at `http://localhost:5175/dev/feasibility`, the same browser profile/origin as your saved headers, and the isolated testnet wallet. Find **Controlled conflicting transfers** below **Import mined ticket**. Do not repeat the earlier successful import.

1. Expand **Create a separate fixture record**. Confirm the venue public identity and set distinct event/ticket IDs. Click **Create separate local conflict record**. This step only saves configuration; no wallet request runs.
2. Read the funding notice. Check the new-fixture authorization and click **Issue and broadcast conflict fixture** once. This broadcasts a NEW issuance, then requests its venue attestation. The attestation can fail after broadcast. A failed/pending/unknown attempt blocks further mutations; download the diagnostic and review it instead of creating another run to retry.
3. Wait for mining, then explicitly click **Refresh conflict issuance mining evidence**. Once it succeeds, use **Download conflict issuance SPV evidence**, load that file in **Local SPV**, and sync its required headers while online. Normal header sync reuses existing validated history.
4. Click **Prepare conflict branches for offline signing**. It validates the mined source against local headers and reads all receiving/fee keys from the wallet. Save the diagnostic, issuance package, source request and both buyer requests. Keep the requests independent from the later received packages.
5. Disable external internet for both app and wallet while retaining localhost. Keep the isolated wallet and tab open. A browser offline indicator is not sufficient evidence of wallet network isolation. Check the offline/signature authorization and click **Sign both conflict branches offline** once. Four transaction signatures are requested. No branch is broadcast by this action.
6. When both branches are saved, download both ticket packages and the diagnostic. Click **Verify both branches locally**. Each branch should verify, but each unmined branch's door result must be **online-check-required**. The pair view knows about both branches; a scanner given only one does not discover an unseen conflict.
7. Reconnect. Click **Review branch A for submission**. It checks local evidence, provider policy and current status. Review its exact transaction ID, fee, inputs and buyer, then explicitly authorize **Submit reviewed conflict branch**. This publishes only A. It does not submit B.
8. Separately review and authorize B. If A's outcome is unknown, stop and preserve its diagnostic; the app blocks further mutations rather than assuming failure. **Check branch A/B status** is read-only and never retries publication. A provider refusal can be legitimate, but a generic HTTP error is not a locally verified conflict.
9. When a branch has candidate mining evidence, download its candidate SPV file, sync required headers in Local SPV, then use **Verify conflict mining evidence locally**. A confirmed result is labelled **conflicting-spend-mined-in-local-snapshot**, with the experiment's chain-validation limits. Provider `MINED` alone does not suffice. Invalid proofs reject; missing headers stay incomplete; conflicting mined candidates require manual chain review.
10. Download the final conflict diagnostic. Record external isolation method, wallet application/interface versions, browser/OS, transaction IDs, package sizes, provider observations and local snapshot. Do not label the live gate complete until real records support the whole sequence.

## Persistence and failure handling

Claims are saved before issuance, attestation, branch signing and publication. Concurrent tabs use revision checks. A pending or unknown step blocks further mutations; there is no reset or retry. A complete branch A may remain saved if signing B fails; partial B is not exported as a completed ticket. Status observations never rewrite an unknown attempt as successful. After a pending attempt, status checking waits at least 60 seconds to reduce races with an active call.

Reload makes no wallet/network requests and discards signing/submission authorization. Preparation requires a fresh check. Composite operations time out after 60 seconds; ARC transport requests additionally have their existing 30-second bound. Cancellation stops waiting, not an already dispatched wallet operation or broadcast. If saving a result fails, the earlier pending claim remains protective.

Diagnostics can be downloaded but are not imported to reconstruct mutation authorization in this slice. Exported ticket packages and independent requests can be checked with existing verification controls. Clearing storage loses the run's duplicate protection and is not recovery. Do not use a new browser, origin or run to bypass it.

## Evidence boundaries

This experiment does not establish current unspentness, full difficulty adjustment, best-chain selection, presenter private-key control or admission. Two-device independent buyer custody and real-wallet lost-response recovery remain separate. The POC door policy accepts only locally verified mined evidence within its stated limits; a structurally valid unmined transfer requires an online check.

Automated tests use synthetic keys and intercepted HTTP wallet/provider calls. Browser fixtures substitute the synthetic SPV anchor boundary while retaining real transaction signatures, scripts, React controls, SDK transport and IndexedDB. They do not demonstrate native BSV Desktop compatibility or real mining. Live outcome: **not tested**.

Plan: controlled conflicts (internal working notes, not published).

## Implementation validation — 26 October 2026

178 unit tests and 171 browser tests passed; one existing duplicate phone process-restart case was skipped. Production build/typecheck passed. Independent review findings were fixed with regressions: stale cross-tab verification results are invalidated, returned issuance receipts are persisted before subsequent checks, and settlement tests cover positive winner binding, invalid proofs, stale observations and contradictory mined branches. Positive settlement boundary mocks do not establish live mining.

No live wallet or provider action was performed during implementation. The next step is the operator sequence above; live acceptance remains pending.
