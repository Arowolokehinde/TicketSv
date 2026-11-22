# TicketSV two-device demo script

A ticket is issued online, transferred between two devices with no internet, verified offline, then settled once the devices reconnect. Allow **about 45 minutes**. Most of it is two mining waits, which can be prepared in advance.

## People and devices

| Role | Device | Wallet |
| --- | --- | --- |
| Organiser | Computer | BSV Desktop |
| Sender (holds the ticket first) | Computer | BSV Desktop |
| Recipient | iPhone or second computer | BSV Browser, or BSV Desktop |
| Door scanner (optional) | Any device | Organiser's sign-in |

## Wallet setup (once per device)

1. **BSV Desktop:** install **3.3.1** from the [BSV Desktop releases page](https://github.com/bsv-blockchain/bsv-desktop/releases/tag/v3.3.1). Check the download against `SHA256SUMS` from the same release. On macOS, run `shasum -a 256 <file>` and compare. Version 3.3.1 includes the upstream fix for the offline signing failure in 3.1.1 (see the [signing incident report](signing-incident-report.md)); no source build is needed.
2. **BSV Browser:** install it on the recipient's phone and open TicketSV inside it.
3. Select **testnet** in each wallet and fund it with testnet coins. Each issued ticket and each transfer costs well under 1,000 testnet satoshis.
4. Open <https://ticketsv.vercel.app>, choose the wallet connection (BSV Desktop · Local HTTP, or BSV Browser · Native wallet) and sign in.
5. The first time, each wallet asks for permission to use TicketSV's baskets (ticket and fee lists). Approve them.

## Before the audience arrives (about 30 minutes)

| Step | Who | Where and what | Wait |
| --- | --- | --- | --- |
| 1 | Organiser | **Create event**: create the event. Saving opens **My events** → **Publication** → publish | — |
| 2 | Sender | **Explore events** → the event → **Request ticket** | — |
| 3 | Organiser | **My events (1)** → **Review** on the sender's request → tick consent → **Issue and broadcast ticket** | About 1 minute |
| 4 | — | Ticket mining | **One block: about 10 minutes, sometimes longer** |
| 5 | Sender | **Dashboard** → the ticket → **Check mining evidence**, then **Save for offline use** | Seconds |
| 6 | Sender | **Transfer ticket**: choose the ticket. The **Before you go offline** list shows what is done and what is waiting. **Review fee preparation** → consent → **Prepare transfer fee** | About 1 minute |
| 7 | — | Fee output mining | **One more block: about 10 minutes** |
| 8 | Sender | **Check mining and prepare device**. This saves headers and the offline app. The list should read **Ready for offline transfer**. Share the invitation (QR or file) | Seconds with shared headers (see timing) |
| 9 | Recipient | **Receive ticket**: load the invitation → **Create receiving request** → **Prepare this device online**. Share the receiving request back | Seconds |

Run steps 1–5 for the next demo while presenting this one; the mining waits then overlap.

## With the audience (about 10 minutes)

1. **Disconnect** both devices from the internet: Wi-Fi off, or airplane mode. Keep BSV Desktop open: TicketSV reaches it on the same computer, not over the internet.
2. **Sender:** **Send** → load the recipient's receiving request → read the summary (ticket, fee output, recipient key) → consent → **Sign offline transfer**. Open the ticket QR and press **Show to scanner** so it fills the screen; the recipient scans it. Or share the file.
3. **Recipient:** scan or load the ticket → **Verify locally**. The report shows the checks and the line **Network during this check: none.**
4. **Optional, door scan:** the recipient opens **Show door ticket QR** → **Show to scanner**. The scanner device, prepared earlier with **Save event and prepare offline**, scans it and runs **Verify locally** with no internet. Expect **Online check required** and **Not admitted**: the transfer isn't mined yet, and the door admits only mined tickets. After settlement below, refresh the scanner's preparation and show the mined door ticket again: **Passes POC door policy** → **Admit**. The sender's own earlier door ticket now shows **Not admitted: this ticket has been transferred to someone else.**

5. **Optional, the double sale (scene 5):** before the audience arrives, prepare two signed transfers of the same ticket to different buyers. The normal handoff refuses to sign a ticket twice, so use the conflict experiment on the development screens, in a local build with `VITE_DEV_ROUTES=true` (`npm run dev`); the production site leaves those screens out. Publish both and wait for mining before the audience arrives; only one can be mined. Download each branch's **updated ticket for scanner**. Keep the scanner **online** for this scene. The double-sold ticket is issued from the development screen, not through TicketSV's server, so it isn't on the organiser's ticket list, and an offline door would refuse it as one it can't check. At the door: the losing copy shows **Online check required** and **Not admitted**, because its transfer is never mined. The winning copy shows **Passes POC door policy**, **Spend check: live, not spent** → **Admit**. Scan the losing copy again: **Already admitted at this door…** and **This is a different copy of the same ticket. It may have been sold twice.**

Point out what verification does *not* show: that the ticket is still unspent, or that the sender has not signed a conflicting transfer elsewhere. Settlement below answers that.

## After reconnecting (about 15 minutes)

1. **Recipient:** open `/tickets/activity` (also linked as **View app activity** from **Device details** on the non-dashboard pages). The log is kept on the device, so it shows the offline check and any requests that failed while offline, with times. The page needs a live sign-in, so open it after reconnecting.
2. **Either device:** **Confirm** → **Publish transfer**. This broadcasts the transfer signed offline.
3. Wait about one block, then **Verify mining evidence**. Mining is verified against the device's saved headers.
4. **Recipient:** **Add received ticket to wallet**.
5. **Sender:** if the panel offers it, **Release spent outputs**, so the sender's wallet stops listing the spent ticket and fee.

## Timing to record during the demo

| Measurement | Expected | Measured |
| --- | --- | --- |
| Ticket mining (step 4) | About 10 minutes | |
| Fee output mining (step 7) | About 10 minutes | |
| Header preparation (step 8), shared cache | Seconds; 6,497 headers took 7.3 s on 17 Nov 2026 | |
| Header preparation when the ticket is newer than the shared cache | Under a few minutes while the server catches up | |
| Offline signing and QR exchange | About 1 minute | |
| Transfer mining after publishing | About 10 minutes | |

If the shared cache is unavailable, the device downloads headers from WhatsOnChain and Chaintracks instead: about 0.5 s per header, so close to an hour on a fresh device.

## If something goes wrong

- **A step says it needs review:** do not repeat it. Wallet actions are recorded once, and repeating one can spend twice. Reload the page and read the saved outcome.
- **The list stays on "Waiting for mining":** testnet blocks are irregular. Check again later; do not fund again.
- **"Offline app saved on this device" stays To do:** the browser cannot save the app (for example, private browsing). Keep the page open instead of reopening it offline.
