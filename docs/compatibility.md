# Wallet compatibility observations

Updated 23 October 2026. These are bounded observations, not a general certification of wallet support.

**New evidence:** the user's fresh Counterfoil Isolated Wallet signing exports passed independent local script, metadata-signature and complete-BEEF-structure checks. Network isolation remains operator-reported; full SPV, reopening and two-device ownership transfer remain unverified. This does not change the installed Desktop 3.1.1 findings below, which record the earlier investigation. See the [signing-result review](signing-result-review.md).

**Subsequent local SPV observation:** the same package verified against the persisted testnet header snapshot at anchor 1,762,325 with zero verification server contacts, as reported by the user and documented in the [local SPV experiment](local-spv-experiment.md). This is bounded checkpoint-based validation, not full chain consensus validation. The new [ticket authenticity controls](ticket-authenticity-experiment.md) have automated coverage but await a live run; they do not change the wallet compatibility gates.

| Configuration | Read-only connection | Limits |
| --- | --- | --- |
| BSV Desktop, local Mac, HTTP 3321, app at `http://localhost:5175`, Playwright Chromium 156.0.8078.4 | Observed success: testnet, `wallet-brc100-1.0.0`, valid public identity, testnet recheck | Desktop 3.1.1: preparation and loading observed; saved-fixture transfer blocked by missing IPC batch-resume method; ticket import and reopening unproven |
| Same wallet with app at `http://127.0.0.1:5175` | Network/version returned; identity rejected with HTTP 400 | Wallet rejects IP-address originators; use the actual `localhost` browser origin |
| BSV Desktop, HTTPS 2121 | Not tested end to end | Listener observed; browser certificate trust and successful RPC not established |
| BSV Browser, native bridge | Not tested on a real device | Automated bridge mocks cover UI behavior only |

Offline PushDrop signing: live preparation succeeded. The first transfer attempt returned a signing draft but hit an app validation bug before transfer signing. The code fix accepts Desktop's intermediate-parent-only format while retaining strict final-proof checks; live signing remains unproven. Installed Desktop application metadata was independently inspected on 22 October 2026 and reports **3.1.1**. See the [experiment runbook](offline-signing-experiment.md). No wallet compatibility pass was inferred from synthetic signing tests.

The failed transfer draft was cancelled successfully from its actual browser origin. The prepared source is listed as spendable, and online loading of the saved preparation succeeded with read-only wallet calls.

The subsequent failure report identified `action batch resume is not available`. Installed-code inspection and isolated reproduction confirmed the missing StorageElectronIPC resumeActionBatch method. This blocks the expired batch path used by this saved fixture; it does not establish that every offline operation fails. No wallet patch, restart or new live mutation was performed. See the runbook for exact evidence and recovery limits.

An official source fix was subsequently found in commit `edf71fac721124ace32ce5857f144b9fc94d4543`, covering the proxy and backend allow-list. The inspected current source contains it; the live release API still lists 3.1.1 as the latest installer. Three isolated proxy-forwarding checks passed. A pinned source build with fresh testnet state is the recommended next experiment; no corrected live-wallet result is claimed. See the runbook’s fix-research section.

SDK: `@bsv/sdk` **2.8.11**, pinned in the lockfile. The wallet-reported version above is an interface version and must not be presented as the installed desktop application release.

Evidence is session-only. A profile or network change requires a new connection check. The wallet holds private keys; the app never imports them. HTTP and native bridge calls are not equivalent to public blockchain requests, and the app's method log cannot audit native-wallet network traffic.

Before making offline compatibility claims, record the wallet application release, OS, browser, transport, preparation steps, network isolation method, closing/reopening behavior and the actual signed transaction/proof outcome. See the [feasibility runbook](feasibility.md).
