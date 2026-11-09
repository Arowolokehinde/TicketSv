# TicketSV

A BSV testnet proof of concept for issuing, transferring and verifying event tickets, including prepared offline handoffs and scanning.

**Live website:** <https://ticketsv.vercel.app>

## Features

- Create and publish events, receive attendee requests and issue tickets.
- Transfer tickets through JSON files or QR codes, with explicit wallet approval.
- Verify issuer signatures, ticket history and mining evidence locally against saved headers.
- Keep offline ticket copies and synchronise received handoffs across devices.
- Scan tickets with a signed-in wallet and prepare time-limited offline scanner access.
- Demonstrate tampered-ticket rejection and controlled conflicting transfers.

Built with React, Vite, Express, PostgreSQL and the BSV SDK. Private wallet keys remain in the wallet.

## Run locally

Use Node **22.20.0** and npm **11.6.1**.

```bash
npm ci
```

Configure `.env` with:

- `DATABASE_URL`: your PostgreSQL connection string.
- `AUTH_SERVER_PRIVATE_KEY`: a separate 64-character hexadecimal application authentication key, not your wallet key.
- `APP_ORIGINS`: `http://localhost:5175,http://localhost:4175`.

Apply migrations, then start the API:

```bash
npm run db:migrate
npm run api
```

In another terminal:

```bash
npm run dev
```

Open <http://localhost:5175>. The API uses port **5177**. For a production preview, run `npm run build` followed by `npm run preview` and open <http://localhost:4175>.

## Checks

```bash
npx playwright install chromium
npm test
npm run build
```

The build includes TypeScript checks. Database integration tests require a separate PostgreSQL test setup. Additional browser checks are available through `npm run test:browser`; they start their own preview server.

## Offline use and verification limits

Sign in and prepare the device online before disconnecting. Scanner authorisation expires with the current session, after at most eight hours. Ticket evidence, account backups and wallet registration are separate records.

Local SPV verification does not establish current unspentness, prevent an unseen double-sale or guarantee admission. Header validation retains checkpoint, linkage and declared-target proof-of-work checks; full difficulty adjustment and best-chain selection are outside this POC. Physical-device and wallet testing remain necessary before claiming live compatibility.
