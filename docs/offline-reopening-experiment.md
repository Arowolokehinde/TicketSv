# Offline reopening and receiving-key access

This is the next feasibility check after durable same-wallet offline transfer signing. It does not close the independent-buyer, ARC, import, double-sell or admission gates.

## Reviewed transfer evidence — 24 October 2026

Read-only local review of the three Downloads files found:

- Issuance: `ef3cb74395e9c4813aa3bf5aa482fbec3bde608f3ac93573bf932e5f8ed23a92.0`.
- Successor: `324f4e7086e77c4ce905fde90035713f0e1429ffe63c1ca1a6f1d0257ba50d9e.0`.
- Journal: completed transfer, attempt timestamp `2026-10-24T18:26:11.593Z`; earlier preflight error retained.
- Package and separately downloaded buyer request exactly match the journal's package and independently prepared buyer request. Two retained ticket transactions, 1,335-byte Atomic BEEF, anchor height 1,764,948.
- Venue attestation against the previously observed trusted identity, every retained designated ticket spend, recipient lock, complete BEEF structure and applicable unmined transaction scripts passed independent local checks. No network or wallet request was made for this review.
- The current transfer has no mining proof. Signing success is not broadcast acceptance, current unspentness or admission eligibility.

SHA-256 of downloaded file bytes:

| File | SHA-256 |
| --- | --- |
| counterfoil-durable-diagnostic.json | `1760e3ba064e97b79ab713acf700da17561cf69b17649848f7856f518d871799` |
| counterfoil-durable-ticket-package.json | `02e2c09e7ba0b7656f594fb42c1366766e9f6ee925dcf99651e69076c0cd8c48` |
| counterfoil-durable-buyer-request.json | `3963322b086361264096dccce32f6c4d93afc47d7cc18be72dfeadaee69503df` |

The operator separately reported all five local checks passing against stored header snapshot `eb516b9364346c9e41c8dac4b2b883d92c674ce4ef0dd702918b5bbdb115e4f5` (1,762,324–1,764,948), with zero verification server contacts. A modified ticket ID was rejected by issuer and continuity checks while the untouched transaction/anchor/recipient checks passed. These are operator UI observations; the snapshot was not included in the three reviewed downloads. External network isolation was operator-reported, not independently measured. Both holder keys belong to the same isolated wallet.

## Prepare the production preview

Do this only after the completed transfer and downloads are saved. Do not repeat issuance or transfer.

1. Keep the same browser profile and origin, `http://localhost:5175`. IndexedDB belongs to the scheme, hostname and port. `127.0.0.1`, port 4175, another profile or private browsing will not expose your existing saved diagnostic. Do not clear browser storage.
2. In the terminal running the development server, stop **that server only** with Ctrl+C. Keep the isolated wallet running. This server change is necessary because Vite's development/HMR assets are not the deployable offline app.
3. From the repository run:

   ```sh
   npm run build
   npm run preview -- --port 5175
   ```

4. Open `http://localhost:5175/dev/reopening` in the same browser profile. This route loads the saved journal without making wallet requests. Confirm the current outpoint is the successor above and the trusted venue/buyer request match your saved preparation.
5. Click **Prepare app for offline reopening**. Wait for **App files saved**. Reload once online; confirm **This page is controlled by the offline worker**. If an update is waiting, close all reopening tabs and open the same address online again before proceeding.
6. Click **Verify saved transfer locally**. All five checks should pass. Missing/corrupt headers or journal data stop the check; they are never silently replaced or fetched. If headers are missing, use the existing harness to sync while online, then return here. No repeated signing is required.

## Reopen without internet

### Alternative when no completed transfer is saved at this origin

Use the new file-loading controls in section 2 of `/dev/reopening`. No fresh issuance or transfer is necessary. This route supports both the existing experiment diagnostic and separately imported evidence.

1. Ensure the latest production build is being served. In an older cached page, click **Prepare app for offline reopening** while online to check for the updated worker. Close all reopening tabs if an update is waiting, then reopen the same address online. Do not clear browser storage.
2. Confirm **Trusted venue identity for loaded files** independently. For this isolated fixture the previously observed identity is `02828e341092c4a01d8b069b02fba9afc66092f4da2ddb14f4e101976675541d58`. A package never supplies or changes this trust setting.
3. Under **Load downloaded ticket package**, select `counterfoil-durable-ticket-package.json` containing successor `324f4e7086e77c4ce905fde90035713f0e1429ffe63c1ca1a6f1d0257ba50d9e.0`.
4. Under **Load independently saved buyer request**, select `counterfoil-durable-buyer-request.json`, saved before handoff. Do not use a request supplied by a seller as evidence of your own receiving intent.
5. Click **Check and save loaded evidence**. Failed cryptographic checks prevent replacement. A structurally valid, cryptographically checked bundle may be saved with missing headers, explicitly marked **incomplete**. Saving evidence is not ticket acceptance and does not establish that signing occurred offline.
6. If headers are missing, click **Download evidence for header sync**. In the linked development harness, load this export into **Local SPV experiment**, then sync while online. Return to the reopening page and click **Verify saved transfer locally**. Header syncing retains the existing checkpoint, two-source and timing limits. It is never triggered by verification.
7. Ensure **Saved evidence source** is **Downloaded evidence saved on this device** and all five local checks pass. Prepare the app cache if needed, reload online once, then follow the offline steps below. Saved downloaded evidence is selected automatically after reopening, but the verification verdict and key proof are recomputed each session.

The bundle is held in `counterfoil-reopening-evidence-v1`, separate from the wallet diagnostic and header stores. It contains the package, independent request and configured trust, without attempt state, wallet action references or cached verdicts. Failed/pending wallet diagnostics remain unchanged. Concurrent replacement fails rather than overwriting another tab's saved evidence. Downloaded diagnostics are not accepted as recovery input. Rejected files or failed writes leave previously saved evidence intact.

### Offline steps

1. Disable external networking for both browser and isolated wallet, retaining localhost. Browser offline emulation alone does not establish native-wallet isolation.
2. Close the reopening tab and reopen exactly `http://localhost:5175/dev/reopening`. Keep the wallet running for this first test. Click **Verify saved transfer locally** again. The verdict is recomputed; a prior result is not restored as a current verdict.
3. Confirm the same successor, five passing checks and zero local verification contacts. Download the reopening observation.
4. To check wallet key access separately, select the consent checkbox and click **Check receiving key access**. This requests a fresh random, purpose-labelled challenge signature using the independently saved buyer receiving key. It locally verifies the signature and checks testnet and original same-wallet identity before and after. It never calls createAction, signAction, internalizeAction or a broadcaster, and uses no transaction fees. Review any wallet permission prompt. Public-key lookup alone is not a successful key-access result.
5. Download the updated observation after **Receiving-key challenge signature verified this session**. Record whether external networking was disabled and whether the wallet had remained running. The exported browser online flag is not proof of network isolation.
6. For a separate cold-wallet test, after saving observations, quit **only the isolated test wallet**, reopen and unlock it while still offline, then repeat the local verification and consented key check. Failure to unlock or sign is a feasibility result to record, not a reason to create another ticket. Closing the entire browser and reopening in the same profile while offline is another manual check; automated new-tab tests do not prove a full physical browser/wallet restart.

## Boundaries

- Only `/dev/reopening` has the service worker scope. Product pages and `/dev/feasibility` are not advertised as offline-ready by this experiment.
- Cache contains build HTML and emitted assets, including lazy SDK chunks. No third-party API, wallet response, ticket package or header snapshot enters the app cache. Ticket diagnostics, imported reopening evidence and headers use separate IndexedDB stores.
- Worker installation is explicit and production-only. No skipWaiting or clients.claim takeover. A new build waits for controlled tabs to close; old app caches are cleaned only after activation. IndexedDB is not cleared or migrated by the worker.
- Incomplete caching fails preparation. Browser data clearing, quota/eviction, private browsing and changing origin can remove offline access; the app does not guarantee storage durability. This is diagnostic persistence, not the product's accepted-ticket store or a wallet backup.
- Verification uses the same checkpoint, declared-target proof of work and header validation limits as Local SPV; full DAA and best-chain selection are not checked.
- Journal failures/pending actions stay blocked. This page cannot import a journal, reset a failed attempt, restore transfer preparation or retry a transaction.
- Key proof is session evidence for this same-wallet fixture. It does not establish two-device independent buyer custody, current unspentness or admission. Native wallet networking remains outside the browser log.

Automated results and live observations must be recorded separately. A phone viewport does not establish mobile wallet support.

## File-loading follow-up verification — 24 October 2026

- Unit suite: 116 passed. Typecheck and production build passed.
- Full browser suite: 109 passed, one intentional phone-viewport skip. After review, the added stale two-tab regression passed in both desktop and phone projects (two additional checks).
- Imported evidence persists across offline tab closing/reopening, never supplies its own trust, and does not alter a failed wallet diagnostic. Rejected replacement retains prior evidence. Concurrent replacement is rejected. Imported receiving-key challenges use the same real-signature validation and do not create transactions.
- Independent review reported no blocking implementation issues and requested the stale-tab regression, now covered. Physical wallet restart/network isolation, full consensus checks and admission remain outside these automated results.
- This follow-up did not call the live wallet, access user browser storage, stop the operator's server or modify files outside the project. The production build was regenerated for the operator's existing preview.

## Automated verification — 24 October 2026

- `npm test`: 114 tests passed across 11 files.
- `npm run test:browser`: 107 passed, one intentional skip. The browser-process restart test runs once in the desktop project; repeating it with a phone viewport would not establish a physical phone result.
- TypeScript and production build passed as part of the browser run; `git diff --check` passed. Runner output includes the existing NO_COLOR/FORCE_COLOR environment warning only.
- Reopening coverage includes offline new-tab/reload, a complete isolated Chromium process restart with its own test profile, journal/header retention, missing/corrupt data, failed asset caching, cache eviction repair, waiting updates, and no wallet/provider requests during local verification. The synthetic saved ticket deliberately has an anchor outside the genuine checkpoint: its cryptographic checks pass while anchor validation remains incomplete. Existing SPV tests separately exercise valid public anchored evidence. A full successful reopening of the operator's real transfer is still a live check.
- Real SDK signature tests cover fresh challenges, wrong network/key/signature, cancellation of in-flight reads and stalled client loading, and suppression of late wallet calls.
- Independent code review found a stalled-client-loading cancellation gap; a regression and abort race fixed it. Follow-up review found no remaining findings.
- No live wallet was called, no transfer broadcast, no user browser storage modified and no development server stopped during implementation.
