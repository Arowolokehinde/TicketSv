# Offline Ticket Handoff with SPV — UI Design

Date: 2026-10-16

Inputs: [design specification](../specs/2026-10-16-offline-ticket-design.md) and [implementation plan](../plans/2026-10-16-offline-ticket.md). Visual designs: [counterfoil-ui.html](counterfoil-ui.html) (see [counterfoil-direction.md](counterfoil-direction.md)).

This document covers the UI only. It adds no features and does not change the agreed flows. Blockchain and wallet integration happen behind the adapters described in the plan.

## Design principles

1. **Four separate facts.** These four facts are never merged into a single "done" state:
   - **Offline verification** (warm ink on paper): the local checks passed against the stored header snapshot.
   - **Broadcast** (violet): submitted to ARC or observed by the network.
   - **Mining** (green): a Merkle proof was retrieved and verified locally.
   - **Wallet import** (gray/teal): the transaction was imported into the wallet's tickets basket.

   Each has its own row, label and colour. A verified mining proof uses green styling. Offline verification uses warm ink and does not imply settlement or current unspentness.
2. **Scoped claims.** Every verdict has a visible "What this does not prove" line taken directly from the spec. These lines are never hidden behind a tooltip.
3. **Evidence before verdict.** The evidence panel always lists the five checks in the same order: Issuer → Continuity → Transaction evidence → Anchor block(s) → Recipient locking key. Each check shows pass, fail or incomplete and a specific reason.
4. **Same flow on every transport.** Every exchange point offers **Show QR / Scan QR** and **Export file / Import file**. A package over 64 KiB disables QR and explains why. A denied or unavailable camera falls back to the file option.
5. **Honest labels.** Prepared fixtures always carry a "Prepared example" badge. Live actions carry a "Live" badge.

## Persistent status strip (every screen)

| Segment | Content | Notes |
|---|---|---|
| Connectivity | `● Offline` / `● Online` | Offline uses a solid dark pill so it is noticeable during handoff. |
| Server contacts | `App-observed contacts: 0 this check · 14 session` + `Wallet bridge (local): 6` | External contacts and local wallet bridge traffic are counted separately. Clicking opens the network log. Footnote: "App log only — native wallet traffic is not observed." |
| Headers | `Headers 1,712,388 · snapshot s-7f3a · 2 h old` | Turns amber when headers required by the current package are missing. |
| Sizes | `Package 18.4 KB · Atomic BEEF 12.1 KB` | Exact byte counts are shown on hover or tap. Shown only when a package is open. |

On a phone the strip collapses to one row (connectivity dot, contacts count, header height, package size). Tapping it opens the full strip as a sheet.

## Screen map

```
Landing (`/`) → Open my tickets (`/tickets`); Venue/Scanner links in the footer.
Ticket holder home: My tickets (saved-ticket + first-visit empty states)
├── Prepare for offline use ............ P1 checklist · P2 complete · P3 incomplete after disconnect
├── Headers & snapshot ................. H1 snapshot / cross-check · H2 source conflict
├── Network log (drawer) ............... N1
├── Venue
│   └── Issue ticket ................... V1 form · V2 progress · V3 issued (evidence ready)
├── Buyer
│   ├── Create receiving request ....... B1 request (QR / file)
│   ├── Receive package ................ B2 scanning (animated QR) · B2e transport errors
│   ├── Verification ................... B3 verified → Accept · B4 incomplete · B5 rejected
│   ├── Accepted ....................... B6 "Verified offline — pending broadcast"
│   └── Ticket detail / settlement ..... B7 four status tracks + retry
├── Seller
│   ├── My tickets ..................... S1 list + local check
│   ├── Import receiving request ....... S2 scan / file
│   ├── Confirm recipient & authorize .. S3 confirm · S4 wallet signing (noSend)
│   └── Share package .................. S5 QR + file · S5f file only (> 64 KiB)
├── Scanner (separate entry point)
│   ├── Scan ........................... D0
│   └── Verdict ........................ D1 pass · D2 online check required · D3 incomplete · D4 rejected
└── Demo (prepared examples)
    ├── Fake tickets ................... F1 changed field · untrusted venue · copied signature
    ├── Double-sell .................... X1 two accepted offline · X2 after reconnect
    └── Proof size comparison .......... Z1 before/after pruning
```

## User flows

### Preparation (every role, online)
Open preparation from the current workspace. Ticket holder (`/tickets`), Venue (`/venue`) and Scanner (`/scanner`) have separate entry points; the home page has no role picker. **P1 Prepare for offline use** runs checks for that workspace. **P2 Preparation complete** lists completed checks only and states that offline signing must be tested on real wallets. After disconnecting, missing data becomes **P3**, preserving progress and explaining recovery.

### Scene 1: Issue (venue, online)
**V1** Enter the event ID and ticket ID (counters show up to 128 characters). The trusted venue identity is fixed and read-only. → **V2** progress: create output → finalize → sign issuance record → broadcast → wait for mining proof → verify proof locally. Mining time is not guaranteed, so the screen can be left. → **V3** shows the venue signature result, the issuance block and the output locking key as three separate facts.

### Scene 2: Offline resale (buyer and seller, both offline)
1. Buyer **B1**: creates a receiving request, which is saved locally, and shows a QR code or exports a file.
2. Seller **S1**: chooses a ticket. Its local check runs. → **S2**: imports the request by scanning or from a file. Unknown versions, unknown networks or the wrong message type are rejected *before* the wallet is called.
3. Seller **S3**: confirms the recipient by request ID and key fingerprint → **S4**: authorizes in the wallet (noSend). → **S5**: shows the QR code and offers file export. A warning says that shared bytes cannot be revoked by cancelling in the app. The seller never receives an acknowledgement, so the screen says: "Ask the buyer to show their acceptance screen."
4. Buyer **B2**: scans or imports the file. → Checks run locally with zero network requests →
   - **B3** all checks pass and the package matches the saved request → **Accept** (saved atomically) → **B6** "Verified offline — pending broadcast". It warns that the transfer is unmined and that a double-sale cannot be ruled out.
   - **B4** missing headers → saved as *incomplete*, Accept blocked, "Sync headers when online, then re-verify."
   - **B5** a definite failure → rejected with the specific reason. The package is never saved as a ticket.
5. When the device reconnects, **B7** runs submit → status → mining proof → wallet import. Each track is shown separately. Retries happen at 2, 5 and 15 s, then a manual Retry button appears.

### Scene 3: Door (scanner, offline)
Before disconnecting: prepare the scanner (P1, scanner role) and sync headers for the presented transfer. **D0**: scan or import a file. → verdict mapping (`doorVerdict` only):

| Verdict | Screen | Tone |
|---|---|---|
| pass | D1 "Passes POC door policy" | green |
| online-required | D2 "Online check required — transfer not mined" | amber |
| incomplete | D3 "Verification incomplete — sync/evidence required" | gray-amber |
| reject | D4 "Rejected — {specific reason}" | red |

Each verdict shows the presented transfer's mining status separately from ancestor anchors. It shows "Locks to the key in request {id}", never "owned by you". Every door verdict includes this limit line: *Does not prove the ticket is unspent now, that the presenter controls the key, that no later transfer exists, or that it wasn't used at another offline scanner.*

### Scene 4: Fake (demo)
**F1** has three cards for prepared examples: a changed signed field, an untrusted venue, and a valid venue signature copied onto an unrelated output. Each card runs the real verifier and shows its distinct rejection reason. None can be accepted.

### Scene 5: Double-sell (demo)
**X1** shows Buyer A's and Buyer B's packages side by side. Both spend the same outpoint and both are "Verified offline — pending broadcast". → reconnect → **X2** shows the actual network state for each: submission, then observation, then mining. The winner is shown only when it is mined in the accepted chain. The other package is "Conflict confirmed" only when network evidence is shown. Otherwise it stays "Online check required". A note says that HTTP success and submission order do not mean settlement, and that the offline scanner did not detect the conflict.

## State vocabulary (exact UI labels)

| Model value | Label |
|---|---|
| received | Received |
| verification incomplete | Verification incomplete |
| rejected | Rejected |
| verified offline / pending broadcast | Verified offline — pending broadcast |
| submitted / awaiting confirmation | Submitted — awaiting confirmation |
| mined / proof available | Mined — proof verified locally |
| conflict confirmed | Conflict confirmed (network evidence) |
| import: not-attempted / pending / succeeded / failed | Wallet import: not attempted / pending / imported / failed |

Network errors always read "Network error — retryable". They are never shown as fraud or as a conflict.

## Responsive layout
- **Laptop (≥ 900 px):** status strip across the top, a left role nav, and the content in two columns (action column + evidence panel).
- **Phone (< 600 px):** compact strip, a single column, the evidence panel as a collapsible section below the verdict, and primary actions in a sticky bottom bar. QR codes fill the width for scanning.

## Out of scope (per spec)
Seat maps, pricing, venue integrations, admission tracking, presenter challenge-response, and visual polish beyond clarity.
