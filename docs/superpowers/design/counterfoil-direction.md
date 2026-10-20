# Counterfoil — visual direction

Counterfoil is the visual treatment of the ticket UI study. Updated 2026-10-20: 35 screen variants, including an animated landing page and saved-ticket and first-visit home states. The original role-picker home is replaced by “My tickets.”

Open [counterfoil-ui.html](counterfoil-ui.html). Its companion [counterfoil.css](counterfoil.css) must remain in the same directory. The prototype is self-contained apart from that local stylesheet and uses no remote fonts, libraries or image assets.

## Direction

The interface borrows from physical ticket stubs and printed event programmes: warm paper, oxblood ink, an acid-yellow navigation accent, fine rules, serial numbers, italic event titles and stamped annotations. Large serif headings establish hierarchy; monospaced labels distinguish evidence and identifiers from instructions.

Counterfoil is a working design name, not a new product requirement. Harbour Nights and all cryptographic/network values are illustrative specimen content.

## Palette

| Role | Colour |
|---|---|
| Paper canvas | #efecdf |
| Ticket stock | #faf8ed |
| Main ink | #292a22 |
| Oxblood action / ticket | #722f2e |
| Acid-yellow accent | #dce68b |
| Verified local evidence | #6d382c with warm-paper background |
| Mining result | #355844 |
| Pending attention | #80500e |
| Rejection | #a03227 |

Colour accompanies explicit text and symbols. Offline verification, broadcast, mining and wallet import remain separate states. Neither the ticket illustration nor a verification result establishes current unspentness.

## Layout and interaction

- The outer screen index is hidden by default and opens through “Design screens.” It is review navigation, not product navigation.
- Inner navigation is scoped to the current workspace: Ticket holder, Venue, or Scanner. Ticket holders see My tickets, Receive ticket, Transfer ticket and preparation tools. Venue/Scanner links are available in the landing-page footer and the separate review index.
- Default entry opens the landing page. Static hash routes `#/`, `#/tickets`, `#/venue` and `#/scanner` represent `/`, `/tickets`, `/venue` and `/scanner`. “Open my tickets” enters the holder workspace.
- Desktop uses a task column next to an evidence panel; narrower layouts stack them.
- Phone/Laptop controls change the preview frame. All 35 screen variants are available through the index, including an empty homepage with transfer disabled.
- Role links, screen links, acceptance/rejection and selected flow actions navigate illustrative screens.
- Wallet/network actions show a design-preview notice. No wallet calls, transaction creation, verification or broadcast occurs.
- QR graphics are explicitly marked illustrative and are not scannable payloads.
- The landing page has a floating ticket, entrance animations, and a pause control. Reduced-motion settings remove animations and transitions; visible focus outlines support keyboard navigation.

## Validation performed

2026-10-20 landing update: browser DOM checks confirmed no horizontal overflow at desktop (1280px) and phone (390px) viewports. The pause control changes animation state from running to paused. Landing links target the holder, venue and scanner routes. Screenshot capture failed in the preview tool, so visual screenshot review remains outstanding. The earlier homepage checks below describe the prototype before the landing page became the default.

2026-10-20 homepage update: checked all 34 variants at laptop and phone preview widths with no screen-level horizontal overflow. Confirmed My tickets is the default; the empty state disables both Transfer controls; receiving links target the request screen; Venue and Scanner have separate scoped navigation. The home screen keeps the established colour tokens. These checks concern the static prototype only.

Rendered the prototype in the shared browser and inspected desktop and phone views. Traversed all 33 screens at both preview sizes and checked screen-level horizontal overflow; none was reported. This is visual prototype validation, not blockchain, device-camera or production accessibility certification.

## Implementation handoff

Use the agreed specification and implementation plan for behaviour. This artifact supplies visual tokens, typography, spacing and component treatment; it does not replace the feasibility gates or change the ticket protocol. The previous requirement to prioritize clarity remains: decoration must not conceal verification limits or important actions.

## Landing-page additions — 2026-10-20

Added a three-stage interactive Seller → Buyer → Scanner demonstration with a moving specimen ticket, direct stage selection and next/replay controls. The scanner scene explicitly follows broadcast, mining and updated package/header preparation. All checks are illustrative; no transaction is performed. Added three native expandable evidence notes (venue signature, transaction history, block proof) and four FAQ answers covering preparation, file exchange, offline acceptance and double-sale limitations. Existing palette, pause behaviour and reduced-motion support are preserved.

Browser DOM checks confirmed stage progression and replay, exactly one selected stage, seven expandable sections opening, and no horizontal overflow at desktop (1440px) or phone (390px) widths. Screenshot capture continues to fail in the preview tool; visual screenshot review remains outstanding.

## My tickets refinement — 2026-10-20

The static `/tickets` entry now opens the first-visit variant. A clearly labelled design-preview switch opens either First visit or Saved tickets; these are specimen states, not real persisted tickets. The first-visit layout introduces Prepare → Receive → Verify & save and disables transfer. The saved collection includes a resume notice, independent progress states, links to evidence and broadcast/wallet status, and a preparation link for missing headers. Preparation, header and network-log route aliases now resolve to their existing screens.

Validated JavaScript syntax, rendering of all 35 screen templates, and empty/saved state markup assertions. The collaborative browser retained the earlier page and then disconnected during verification; fresh visual and mobile checks for this refinement remain outstanding. Actual storage restoration and blockchain operations remain implementation work.

## Receiving request refinement — 2026-10-20

B1 now starts with an explanation of wallet-backed request creation and a labelled preview-creation action. The sample ready state offers working QR/file view selectors, an explicitly non-scannable QR illustration, a downloadable JSON design specimen (not a valid protocol request), sample request details, fingerprint comparison guidance, and a link to B2 package receipt. No wallet key, protocol payload, real request persistence or cryptographic operation is implemented. Syntax and all 35 template renders passed, with assertions for initial state, sharing controls and the next-step route.

## Remove populated demo data — 2026-10-20

Removed the populated ticket collection, sample request creation, fake QR and JSON download, and preset records/results from supporting screens. Data-dependent screens now show empty or not-connected states; no successful wallet operation or verification is implied. The landing illustration and explanatory handoff walkthrough remain, using generic ticket wording. Creating a receiving request is disabled until wallet integration exists. Checked all 35 rendered screens for the former invented event, request, ticket and header records; none remain in rendered content. Earlier descriptions of populated states and demo downloads are superseded by this change.

## Restore demo data — 2026-10-20

Demo data is restored by user request. The saved collection and first-visit switch, receiving-request preview, QR/file choices, illustrative file export, and all supporting screen states are populated again. Supporting screens use distinct sample evidence and actions, with a persistent design-prototype label. No real wallet operation is implied.

`counterfoil-demo.js` stores supporting screen fixtures by screen ID so each can be replaced independently. It must accompany the HTML and CSS. Saved collection and request UI fixtures remain alongside their render functions in the HTML. This supersedes the previous removal entry. JavaScript syntax and rendering of all 35 screens were checked.

## Connected buyer flow — 2026-10-20

B2 now has QR/file choices, simulated 68% receipt progress, completed receipt, camera-denied recovery and wrong-file recovery. A labelled scenario selector previews passing verification, missing headers, wrong issuer and wrong recipient. B3/B4/B5 show per-check evidence, acceptance constraints and recovery actions. Acceptance leads to B6 with independent verification, broadcast, mining and import states. Declining is distinct from a failed verification.

These controls simulate transport and checks without accessing the camera, reading device files, creating transactions or persisting tickets. Rendering checks covered all 35 screens and ten transport/state combinations. Browser interaction checks covered camera/file failures, progress, completion, blocked acceptance, wrong-recipient rejection and the accepted state; the 390px phone preview had no horizontal overflow in the receipt flow.

## Connected seller flow — 2026-10-20

S1–S5f now form a connected demo: select and locally check a ticket; scan/import the buyer’s request; compare and confirm the fingerprint; preview wallet authorization; share the resulting package by QR or file. Invalid type, unsupported version, wrong network and malformed recipient key stop before authorization. Camera denial offers file import. Wallet cancellation and bridge failure have retry paths. Large packages disable QR and offer a clearly illustrative JSON download. Sharing does not imply buyer acceptance or broadcast.

All operations remain simulated. Browser checks exercised the local-check gate, invalid-network rejection, fingerprint gate, wallet cancellation/retry, approval, file sharing and large-package QR disabling. No horizontal overflow was detected on the 390px phone share view or any of the six seller screens at the 1440px desktop viewport. JavaScript syntax and rendering of all 35 screens also passed.

## Offline preparation refinement — 2026-10-20

Preparation now presents individual check states, simulated header-sync progress, a current-snapshot panel, and successful/offline/wallet-failure/source-conflict/missing-header scenarios. Failed attempts retain the example snapshot. Header inspection and a session network log are linked; simulated external sync activity and local wallet-bridge failures are distinguished. Logs retain prior attempts and explicitly exclude independently generated native wallet traffic. No real header sync, wallet access or persistence checks occur.

Validated all 35 screen renders and 20 preparation render combinations. Browser checks exercised all five scenarios, confirming success only for the ready case, no external requests for the offline case, and retained session-log rows. Desktop preparation layouts had no horizontal overflow. The preview disconnected while resizing to phone width, so the new phone layout check remains outstanding.

## Connected Scanner flow — 2026-10-20

D0 now supports simulated QR/file receipt, progress, camera denial and wrong-file recovery. A labelled scenario selector covers mined, unmined, missing header, missing mining proof, tampered data and wrong issuer. These lead to D1–D4: passes POC policy, online check required, incomplete, or rejected. Results list evidence and distinguish unperformed checks from successful ones. Scan next resets receipt state and the example scenario. Missing evidence offers preparation guidance. Mined inclusion and repeated-entry limitations remain visible; no admission record is created.

Validated all 35 templates and all six outcome routes. Browser checks exercised both transport errors, receipt, results and reset. No horizontal overflow was found on the desktop results or the five scanner screens in the phone preview frame. All operations remain simulated; no camera, parser, verifier or blockchain service is called.

## Connected Venue issuance — 2026-10-20

V1–V3 now cover connecting the preconfigured venue wallet, identity-match gating, editable event/ticket details, selecting the sample initial recipient request, reviewing and authorizing PushDrop issuance, cancellation/retry, broadcast failure/retry, pending mining and mined-proof evidence. The venue identity is pinned; no registration or venue-creation system was added. Signature authenticity, signed transaction, broadcast and mining are separate states. New issuance clears the ticket identifier while retaining the venue wallet and event context.

The entire flow remains a simulation: no identity lookup, private key, PushDrop construction, signature, ARC call or proof verification occurs. Form values are escaped before rendering. All 35 screens rendered; browser checks passed for the identity gate, review, cancellation, broadcast failure/retry, mining and new-ticket reset. All three venue screens had no horizontal overflow in the 376px phone preview frame.

## Connected double-sell demonstration — 2026-10-20

X1/X2 now show two distinct recipient requests and transfers spending the same ticket output. Preview both offline checks and acceptance, reconnect, submit each buyer’s package, then reveal a selectable mined/conflict outcome. Either buyer can be the simulated winner; submission order is not presented as a confirmation guarantee. The Scanner comparison requires updated winner evidence and prepared headers. It distinguishes the loser’s unmined package (offline online-check flag) from online conflict evidence supporting rejection. Network errors alone do not establish a double-spend. Restart clears the scenario.

No conflicting transaction is created or submitted. All 35 templates rendered, and browser tests exercised both winners, submission gating, conflict results, scanner comparison and restart. No horizontal overflow was found for desktop results or the two screens in the phone preview frame.

## Proof-size comparison refinement — 2026-10-20

Z1 now compares before/after-mining package structure, with independent total-package and Atomic BEEF metric selectors, byte tables, calculated reduction bars, and expandable retained-evidence explanations. Values come from the explicit PROOF_SIZE_DEMO fixture in counterfoil-demo.js; they are not live measurements. The page explains that pruning removes ancestry no longer needed for SPV while preserving ticket-authenticity and continuity evidence, and that total-package shrinkage is not guaranteed. It links back to the accepted ticket and double-sell demonstration. B7 links to this comparison.

Validated all 35 renders, four stage/metric combinations, and fixture reductions (47.9% package, 56.7% Atomic BEEF). Browser controls and all five evidence expansions passed; no horizontal overflow was found on desktop or in the phone preview frame. No actual pruning or verification occurs.

## Five-scene walkthrough — 2026-10-20

Completed a fresh browser walkthrough of issuance, seller-to-buyer offline resale, Scanner policy, tampered/wrong-issuer rejection, and double-sell resolution. Corrected these review findings:

- Returning to My tickets after an accepted/saved demo ticket now keeps the populated collection for the current page session. The explicit first-visit preview resets that selection. This is not durable ticket persistence.
- Fake, double-sell and proof-size scenes use the holder workspace instead of inheriting Venue navigation.
- Fake-ticket buttons set the intended failure fixture independently of previous selections.
- A wrong-issuer failure no longer marks downstream buyer evidence as passed.
- Direct scanner result screens show the header height associated with their result fixture.
- The reconnecting status screen identifies its sample connection as online; submitting the venue form no longer triggers an unrelated preview toast.

The shared preview disconnected during the final run. Completed verification with headless Chrome using Playwright after the preview tool explicitly reported no host and allowed a fallback. All five connected scene paths passed, along with both fake variants, saved-collection navigation and workspace isolation. Audited all 35 screen templates at desktop (1440px) and phone (390px) viewport widths: 70 layouts, no broken internal links, no horizontal screen overflow and no browser JavaScript errors.

These are prototype interaction and layout checks, not SPV/security validation. Wallet signing, actual PushDrop construction, ARC, header validation, real QR/file transport, durable reopening and live two-device airplane-mode scenes remain implementation/feasibility work. This walkthrough does not establish the POC's production or live-demo acceptance criteria.
