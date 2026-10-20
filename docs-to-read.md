# Offline Ticket Handoff with SPV — Reading List

Read these in order. Start with explanations and examples; you do not need to understand every code sample or binary format on your first reading.

## 1. SPV — how a device checks blockchain evidence

Read [BRC-67: Simplified Payment Verification](https://github.com/bsv-blockchain/BRCs/blob/master/transactions/0067.md).

Focus on transaction inputs, signature/script checks, Merkle paths, and following unmined transactions back to mined ancestors.

**For our POC:** this explains how the buyer can verify the evidence received from the seller.

## 2. BEEF and Atomic BEEF — what travels with the ticket

Start with [Verifying a BEEF Structure](https://docs.bsvblockchain.org/guides/sdks/ts/examples/example_verifying_beef).

Then read:

- [BRC-62: BEEF](https://github.com/bsv-blockchain/BRCs/blob/master/transactions/0062.md) — packaging transactions and their supporting proofs.
- [BRC-95: Atomic BEEF](https://github.com/bsv-blockchain/BRCs/blob/master/transactions/0095.md) — identifying the particular transaction the package is about.

**For our POC:** these explain what we mean by “the ticket carries its own proof.” Skip the byte-format details on your first reading.

## 3. Merkle proofs and ChainTracker — connecting evidence to stored headers

Read the introduction to [BRC-74: BSV Unified Merkle Path — BUMP](https://github.com/bsv-blockchain/BRCs/blob/master/transactions/0074.md).

Then use the [SDK transaction reference](https://bsv-blockchain.github.io/ts-sdk/reference/transaction/) and search within the page for `MerklePath`, `ChainTracker`, and `verify`.

**For our POC:** understand how a transaction’s proof leads to a Merkle root, and how our local ChainTracker checks that root against a stored block header.

## 4. PushDrop — representing and transferring the ticket

Read:

- [BRC-48: Pay to Push Drop](https://github.com/bsv-blockchain/BRCs/blob/master/scripts/0048.md).
- [Wallet Toolbox PushDrop example](https://bsv-blockchain.github.io/wallet-toolbox-examples/pushdrop.html).

Focus on the information placed in an output, the key controlling its spending, and how spending it creates a new output.

**For our POC:** this is the mechanism underneath issuing and handing over a ticket. Our ticket authenticity and continuity rules still need to be defined on top of it.

## 5. BRC-100 and WalletClient — how the app uses a wallet

Read the introduction to [BRC-100: Wallet-to-Application Interface](https://github.com/bsv-blockchain/BRCs/blob/master/wallet/0100.md), then consult the [SDK wallet reference](https://bsv-blockchain.github.io/ts-sdk/reference/wallet/).

Focus only on these methods initially:

| Method or option | Why we need it |
|---|---|
| `getPublicKey` | Obtain the receiving or identity public key. |
| `createAction` | Construct a transaction. |
| `noSend` | Request creation without broadcasting. |
| `signAction` | Complete signing when a separate signing step is required. |
| `internalizeAction` | Import a received transaction into the wallet. |
| `createSignature` / `verifySignature` | Sign and check application data. |

**For our POC:** these explain the boundary between our app and the wallet that holds the private keys.

## 6. ARC — what happens after reconnecting

Read the [ARC project overview](https://github.com/bitcoin-sv/arc). Keep its [API specification](https://github.com/bitcoin-sv/arc/blob/main/pkg/api/arc.yaml) as a reference.

Focus on submitting transactions, checking their status, mining results, and double-spend reporting.

**For our POC:** this explains the difference between accepting a package offline, broadcasting it, and having it mined.

## 7. Animated QR — moving the package without internet

Read [BRC-141: Fountain-Coded Air-Gap Transport](https://github.com/bsv-blockchain/BRCs/blob/master/peer-to-peer/0141.md), followed by the [air-gap helper README](https://github.com/bsv-blockchain/ts-stack/tree/main/packages/helpers/air-gap).

**For our POC:** this explains how a package can be spread across QR frames and reconstructed by the other device. Transporting the bytes and verifying the ticket are separate operations.

## Implementation references for later

- [BSV TypeScript stack](https://github.com/bsv-blockchain/ts-stack) — where the SDK, wallet tooling and helpers fit together.
- [Create BSV App documentation](https://github.com/bsv-blockchain/ts-stack/tree/main/packages/helpers/create-bsv-app) — scaffolding the application.
- [MDN: Using service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers) — making the prepared app open offline.
- [MDN: IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) — storing accepted ticket packages locally.

## Where to start

Start with readings 1–3. They establish the central concepts.

Keep this distinction in mind throughout: **evidence of inclusion in a block is not, by itself, evidence that an output remains unspent now.**
