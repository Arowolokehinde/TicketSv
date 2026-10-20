# Offline Ticket Handoff with SPV — Design Specification

Date: 2026-10-16

Status: Records the agreed design and the remaining defaults the user authorized us to finalize. Implementation has not started. Source research does not establish device compatibility; the feasibility gates below remain mandatory.

## Purpose

Build a two-device proof of concept demonstrating venue issuance, offline resale, an offline door check, fake-ticket rejection, and a double-sale. The ticket carries evidence that each device verifies locally. This is not a production admission system.

## Global constraints

- Use TypeScript, React, @bsv/sdk, BRC-100 WalletClient, BSV Desktop/BSV Browser, and ARC.
- Both seller and buyer must be offline during handoff; the scanner must be offline during door verification.
- Support the same receiving request and ticket package through QR and file exchange.
- Do not introduce an application backend, relay, Message Box, or remote verification fallback.
- The app must never obtain or export wallet private keys.
- Store accepted packages locally before displaying “Verified offline — pending broadcast.”
- Support reopening the prepared app and saved packages while offline.
- Store block headers separately from ticket packages; do not transfer headers in QR for this POC.
- Validate header linkage and proof of work; full difficulty-adjustment validation is excluded.
- Pin dependency versions after feasibility testing and record the tested wallet versions.
- Exclude atomic payment, production custody/security work, venue integrations, seat maps, pricing, and design polish beyond clarity.
- Never describe a mined inclusion proof as proof that a ticket is currently unspent.
- Never describe an app-only request log as complete observation of native wallet traffic.

## Architecture and defaults

### Entry points — approved update, 2026-10-20

A public landing page at `/` introduces the POC, links to My tickets, and provides Venue/Scanner footer links. One app has three separate workspaces: ticket holder at `/tickets`, Venue at `/venue`, and Scanner at `/scanner`. The ticket-holder home is “My tickets,” with Receive a ticket, Transfer a ticket, offline preparation, and saved-package states. A first-visit empty state offers receiving and disables transfer until a ticket exists. Buyer and seller are actions within the ticket-holder experience, not separate account types.

Venue navigation contains issuance tools; Scanner navigation contains scanning/import and evidence results. Neither is in normal ticket-holder navigation. Demo switching belongs to a secondary design/demo menu. Route separation is not authentication or staff authorization; the trusted venue key still determines issuance authenticity. Keep Counterfoil's existing paper, oxblood, acid-yellow and ink palette consistent across the three experiences.

The static UI prototype represents these paths with hash links `#/`, `#/tickets`, `#/venue`, and `#/scanner`. Production routing is implemented when the app is built.

Use a static React application with a service-worker app shell, IndexedDB, a wallet adapter, a pure local verifier, a local header tracker, interchangeable QR/file transports, and an online settlement coordinator. Explicitly inject the local ChainTracker into transaction verification; never fall back to the SDK's remote default. An app-local tracker does not configure a native wallet's internal services.

Use the minimal Create BSV App React starter after auditing generated integrations. A custom wallet would expand custody scope; a relay/backend would violate the handoff constraint. Neither is selected.

Use BSV testnet for the POC, subject to direct browser ARC access passing the feasibility gate. Do not silently add a proxy or switch networks if access fails. A research-time unauthenticated TAAL testnet policy request returned HTTP 403; access is not yet validated.

Target laptop–laptop, laptop–phone and phone–phone using the same protocol. Record actual tested combinations; do not claim untested browsers or wallets work.

## Offline preparation

“Prepare for offline use” checks: cached app assets and activated service worker; persistent storage request where supported; wallet access; required headers stored; seller ticket evidence present; seller funding inputs/proofs ready for signing; buyer receiving-key access; scanner verification data ready.

Use HTTPS for cross-device browser access. A laptop's HTTP LAN address is not a dependable camera/service-worker origin on a phone. Service-worker support inside an embedded wallet browser requires testing.

Show “Preparation complete” for completed checks, not a claim that offline signing has been proven. Verify the latter on real wallet versions. Sync headers automatically while online and retry incomplete packages afterward. Missing data after disconnecting preserves progress and explains what is needed. Browser persistence is best effort; clearing site data can remove tickets.

## Five agreed scenes

### 1. Issue

The venue creates a PushDrop ticket output with event and ticket identifiers. After the transaction is finalized, sign a separate issuance record binding its original outpoint and identifiers. Signing the finalized outpoint outside the transaction avoids a self-referential transaction ID.

Configure one trusted venue identity. Establish the wallet-supported signing/key-derivation convention and offline verification against that identity during feasibility testing. A key merely supplied in a package is not trusted. No private-key extraction or simulated signature may stand in for the venue wallet.

Broadcast, retrieve a mining proof, and prepare the initial holder's evidence. Display venue signature result, issuance block, and output locking key separately.

### 2. Offline resale

After preparation both participants disconnect. The buyer creates a receiving request with a random request ID, network, and public key/derivation information required by the tested wallet transfer convention. Send it by QR or file.

The seller checks its existing ticket locally, imports the request, confirms the recipient, and authorizes the transfer. Preserve noSend through createAction and signAction where required. Export only the final signed, independently verifiable Atomic BEEF; intermediate signable responses and unresolved txid-only dependencies are not acceptable.

The buyer checks issuer authenticity, ticket continuity, transaction evidence against local headers, and the actual recipient locking script. Bind the received package to its saved receiving request. An envelope's recipient label alone does not prove the script pays that key.

“Accept” stores the complete package and verification result atomically before displaying “Verified offline — pending broadcast.” State that the new transfer is unmined and a double-sale cannot be ruled out. If headers are missing, save as incomplete and block acceptance until sync and re-verification succeed.

There is no automatic seller acknowledgement in this two-way exchange; the buyer can show their acceptance screen. Once signed bytes are shared, app cancellation is not reliable revocation of those bytes.

Remote users may send files through their chosen external channel. Remote delivery requires connectivity or physical transport; downloaded files can be verified offline. The app adds no messaging service.

### 3. Door

Before disconnecting, obtain the presented transfer's mining proof and sync its headers to the scanner. The scanner checks the same authenticity, continuity and blockchain evidence.

| Condition | Result |
|---|---|
| Checks pass and presented transfer is mined | Passes POC door policy |
| Transfer is unmined | Online check required |
| Required header/evidence missing | Verification incomplete — sync/evidence required |
| Signature, continuity or proof invalid | Rejected, with specific reason |

This does not prove current unspentness, the presenter's private-key control, absence of a later transfer, or absence of reuse at another disconnected scanner. Admission tracking and presenter challenge-response are excluded.

### 4. Fake

Demonstrate a changed signed field and a ticket signed by an untrusted venue. Reject locally with distinct reasons. A valid venue signature copied into an unrelated ticket output must also fail origin/continuity checks. Invalid packages never become accepted tickets.

### 5. Double-sell

Prepare two validly signed transactions spending the same ticket outpoint to different buyers. Both can verify offline and be saved pending broadcast. Submit both after reconnecting and display actual network states. Submission order or HTTP success is not settlement.

Obtain proof of the transfer mined in the accepted chain. The conflicting package remains flagged for online checking at the offline door unless conflict evidence is already available. Mark confirmed conflict only with supporting network evidence; never imply the offline scanner detected it independently.

The wallet may prevent a normal second spend. Producing controlled conflicts with supported wallet signing and without corrupting wallet state is a feasibility gate. Use separate funding inputs where needed to isolate the ticket conflict. Demonstrate actors sequentially on two devices with separate buyer state.

## Package and ticket rules

Use a versioned UTF-8 JSON envelope with base64 binary fields and distinct request/ticket message types. Reject unknown versions/networks before wallet interaction. POC resource limits: 4 MiB total envelope and 100 retained ticket transfers. BRC-141 v1 QR payload limit: 64 KiB; larger packages use the existing file path, not a custom multi-message protocol.

Include network/version, event/ticket IDs, issuance record and signature, trusted-identity reference, original and current outpoints, request/recipient binding, retained ticket-lineage transactions, and Atomic BEEF targeting the current transaction. Store signed bytes exactly. Define the issuance preimage as UTF-8 JSON of this ordered array:

```text
["offline-ticket-issuance", 1, network, eventId, ticketId, originTxid, originOutputIndex]
```

Version 1 has no other event/ticket metadata. IDs are nonempty, at most 128 Unicode code points; hash is lowercase 32-byte hexadecimal; output index is a nonnegative integer and must exist. Decode UTF-8 strictly and do not silently normalize signed strings.

Each transfer spends the preceding designated ticket outpoint and creates exactly one recognized successor output for this ticket. Match immutable fields and origin reference. Inspect actual scripts and transactions, not envelope assertions. Reject broken links, cycles, duplicated successors, wrong recipient, wrong target transaction, and unrelated metadata copies.

These are application rules; basic PushDrop does not make miners enforce ticket uniqueness. Offline verification cannot rule out an unseen conflicting branch.

After mining, prune unnecessary transaction-validation ancestry while preserving the venue attestation and ticket lineage required by these rules. Display Atomic BEEF size and total package size before/after independently; total package size does not necessarily decrease at every hop.

## Headers and trust

Select and record a network checkpoint hash/height before all proof anchors needed by the demo, including funding ancestry. Check header serialization/hash, linkage, compact-target bounds and PoW against the declared target. Store by hash with a canonical-height mapping and snapshot ID.

Cross-check two independent sources at common heights. Different tip heights alone are not a conflict. Conflicting hashes block promotion of the new snapshot and preserve the last accepted snapshot. Reorganizations require finding the common ancestor and revalidating affected evidence. Conflicts at/below the checkpoint require explicit rebootstrap.

Full DAA validation is excluded, so this retains trust in the checkpoint and cross-checked header sources. Claimed-target PoW and source agreement do not replace difficulty validation or independently prove the best chain. Offline results are relative to the stored snapshot.

## Persistence and settlement

Store the complete package, receiving request, verification report/snapshot ID, accepted time, txid, broadcast state, and independent wallet-import state. Acceptance is one IndexedDB transaction; storage failure leaves the package unaccepted. Reopen restores data. Revalidate affected evidence after a header snapshot change.

Ticket states: received; verification incomplete; rejected; verified offline/pending broadcast; submitted/awaiting confirmation; mined/proof available; conflict confirmed. Import states: not attempted, pending, succeeded, failed.

On reconnect, process accepted pending transfers with bounded retries, identical signed bytes and the same txid. Track submission, observation and mining separately. Import to the tickets basket after successful submission through the tested wallet protocol. An import failure does not undo successful broadcast. After a lost import response, query the expected output before retrying; validate this on pinned wallet versions.

Retrieve status and Merkle proofs explicitly. Validate retrieved proofs locally before showing them as verified. Stale-block results invalidate the affected mined verdict pending refresh. Network errors are retryable, never proof of fraud or conflict.

## Verification display and network log

Every screen shows connectivity, app-observed server contacts, local header height/snapshot age, and package/proof sizes. Each verification separately shows issuer, continuity, transaction evidence, anchor block(s), and recipient locking-key checks. For a scanner, do not say “owned by you.”

Log app request time, destination, purpose and result without credentials or ticket bodies. Distinguish local wallet bridge traffic from external services. External observation is needed for native wallet traffic; an empty app log alone is not sufficient.

Allowed online work: header sync, wallet preparation, broadcast, status and mining-proof retrieval. This corrects the original “only header sync and broadcasts” requirement. Local verification makes zero external requests.

## Demo, validation and acceptance

Use genuine prepared mined examples for the door and size comparison, labeled as prepared. Demonstrate a fresh live handoff and broadcast separately. Mining within ten minutes cannot be guaranteed; show pending live status honestly.

Before the full UI, establish: offline signed PushDrop transfer; issuer signature checked offline against pinned identity; reopening after acceptance; complete final Atomic BEEF; direct browser ARC access/status/proof retrieval; import/retry behaviour; controlled conflicting spends. Failures must not be bypassed with mocks in the live demo.

Final acceptance requires all five scenes on two physical devices, both handoff participants and scanner offline at the stated moments; successful QR/file paths; saved packages after reopening; specific rejection reasons; observed network boundaries; measured sizes; and a README documenting the limits above. Record OS/browser/wallet versions and transport for each tested combination.

## Sources and research status

- [Reading list](../../../docs-to-read.md)
- [TypeScript stack](https://github.com/bsv-blockchain/ts-stack)
- [Create BSV App](https://github.com/bsv-blockchain/ts-stack/tree/main/packages/helpers/create-bsv-app)
- [BRC-100](https://github.com/bsv-blockchain/BRCs/blob/master/wallet/0100.md)
- [PushDrop example](https://bsv-blockchain.github.io/wallet-toolbox-examples/pushdrop.html)
- [BEEF](https://github.com/bsv-blockchain/BRCs/blob/master/transactions/0062.md) and [Atomic BEEF](https://github.com/bsv-blockchain/BRCs/blob/master/transactions/0095.md)
- [BRC-141](https://github.com/bsv-blockchain/BRCs/blob/master/peer-to-peer/0141.md)
- [ARC API](https://github.com/bitcoin-sv/arc/blob/main/pkg/api/arc.yaml)
- [BSV header PoW/difficulty implementation](https://github.com/bitcoin-sv/bitcoin-sv/blob/master/src/pow.cpp)

Inspected installed metadata: Desktop 3.1.1, SDK 2.8.11, wallet-toolbox 2.14.5. This is not a compatibility test. Remote main-branch sources can differ from released wallets.
