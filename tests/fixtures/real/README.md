# Real testnet fixtures

Unaltered public testnet data, used so verification tests run without stubs.

- `handoff-mined.json`, `handoff-unmined.json`: the same real B→C ticket transfer (`bb7ce48a…34bc`), event "BSV in Nigeria", saved by the recipient before and after mining. Taken from the received-ticket archive backup made on 18 November 2026, before the live event reset. They contain public keys, transactions and event details only.
- `headers-1762324-1768820.bin`: 6,497 raw 80-byte testnet block headers, from the pinned checkpoint (1,762,324) through the transfer's mining block (1,768,820). Fetched from TicketSV's shared header cache and cross-checked against WhatsOnChain at 1,762,324, 1,765,000 and 1,768,820.
