# Downloaded signing evidence review

Reviewed **23 October 2026** using the project's installed `@bsv/sdk` **2.8.11**. The result file records the experiment at `2026-10-22T20:57:24.507Z` (21:57:24 in Lagos).

**Outcome: local transaction and signature checks passed.** The final transaction spends the exact prepared source output and creates the intended one-satoshi successor. This confirms the downloaded result of the user's reported offline signing run in Counterfoil Isolated Wallet. It does not establish full SPV or independently establish the original run's network isolation.

**Subsequent check, also 23 October:** the new local SPV verifier now checks this final package against cross-checked, PoW/linkage-validated testnet headers from the pinned checkpoint. Both BEEF and transaction verification passed with zero fetch calls; the latest transfer has no mining proof in the loaded package. See [local SPV evidence and trust limits](local-spv-experiment.md). The original inspection below records the earlier scripts-only check.

## Files inspected

Both originals were read from the user's Downloads folder without modification. No signed transaction bytes were copied into this document.

| File | JSON file bytes | SHA-256 of original file |
| --- | ---: | --- |
| `counterfoil-signing-preparation (1).json` | 21,671 | `52896898e1621675b5d0199dce7e610c27e2dda5d52631bfdc311e64b6aa2157` |
| `counterfoil-signing-result.json` | 51,508 | `bfc9015bc8f5416657174b7d58f15be9437206eb28ddb1abcb929ee795b35815` |

The result's embedded preparation exactly matches the standalone preparation, including its source bytes, scripts and run ID: `b717b44b-6032-498a-a4e8-c859d8c0b892`.

## Checks performed

A separate local inspection script parsed the supplied bytes directly with the SDK. It did not call the application's wallet workflow or trust the exported `checks` label as a verification result.

- Both byte arrays contain structurally valid Atomic BEEF, with complete dependencies back to included Merkle proofs and no reliance on txid-only placeholders (`Beef.isValid(false)`).
- Computed transaction IDs match the exported IDs and Atomic BEEF subject IDs.
- The source transaction embedded in the final transfer matches the preparation's raw source transaction exactly.
- The prepared token output is spent exactly once within the transfer. This is a transaction-structure check, not a global unspentness check.
- Each expected output appears exactly once, holds one satoshi and has the exact prepared locking script.
- Both PushDrop scripts contain the expected experiment label and run ID. Their metadata signatures verify against their respective embedded locking public keys.
- The source and destination locking public keys differ. The files alone do not establish their derivation from the claimed wallet identity; this diagnostic was designed to use two keys in the same wallet.
- Both preparation and final transaction pass `tx.verify('scripts only')`. This checks the unmined transaction chain's scripts; included Merkle anchors remain unauthenticated against headers.
- Changing the final transaction's lock time in memory makes script verification fail. The original files were not changed.
- The inspection blocked Node HTTP, HTTPS, socket, TLS and fetch entry points. It recorded **zero network attempts**. No wallet request, signature request, cancellation, import or broadcast occurred.

## Transaction details

| Property | Preparation | Signed transfer |
| --- | --- | --- |
| Transaction ID | `c5753f1421e1a728b5c89589c2912044c26ed76176989d565cafe459810809b8` | `4458587f0111100ac562621fdad1b852532aba9f07c19cfbde9fccf16321908d` |
| Atomic BEEF bytes | 1,953 | 2,445 |
| Raw transaction bytes | 377 | 491 |
| Transactions in BEEF | 4 | 5 |
| Merkle proofs in BEEF | 1 | 1 |
| Expected token output index | 0 | 0 |
| Expected token value | 1 satoshi | 1 satoshi |
| Fee encoded by input/output difference | 95 satoshis | 123 satoshis |

The preparation spends 5,052 satoshis, creates the one-satoshi token and 4,956 satoshis of change, leaving a 95-satoshi fee. The transfer spends both the token and that change, creates the one-satoshi successor and 4,833 satoshis of change, leaving a 123-satoshi fee. These are encoded transaction amounts, not evidence that any fee has been mined or that current relay policy accepts the transaction.

The final package is 492 bytes larger because it includes the new transaction and its serialization overhead. This is expected for an additional unmined hop; proof shrinking has not been demonstrated by these files.

Both packages contain a proof declaring height **1,762,325** and computing the root:

```text
aa337eefdc22fd1320d8a4ad1a2cea367c31f99868377e7ecdc0a096df10a9c7
```

No block headers were supplied. The height and computed root are proof contents, not an independently authenticated blockchain anchor. The source and final subject transactions have no attached mining proof. The JSON labels both packages `testnet`, but transaction bytes and a label alone do not authenticate a network.

## What is established and what remains

The downloaded evidence confirms a correctly signed, self-owned PushDrop transfer with complete BEEF structure. Together with the user's report, it supports a successful fresh signing experiment in the isolated build. It does not show whether that attempt invoked `resumeActionBatch`, recover the old failed workspace, or establish general support in the published Desktop 3.1.1 installer.

Remaining evidence includes:

1. The exact original network-disconnection method; the export says `isolation: operator-reported`.
2. Local header validation and verification of the declared Merkle root against the accepted chain.
3. A transfer to an independently controlled buyer, venue identity authentication and ticket transfer continuity.
4. Reopening the app and wallet, expired-batch behavior, and durable preparation/recovery.
5. Broadcast, mining proof retrieval, wallet import and controlled conflicting transfers.

The current files do not prove current unspentness or prevent an offline double-sale. No broadcast or wallet mutation is authorized or performed merely by reviewing these exports.

Related records: [error explanation](signing-incident-report.md), [signing experiment history](offline-signing-experiment.md), [compatibility observations](compatibility.md).
