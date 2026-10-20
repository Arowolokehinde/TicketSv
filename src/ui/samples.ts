// Visual examples only. Never pass these records to a wallet or verifier.
export const sampleTicket = {
  event: 'Harbour Nights',
  id: 'GA-0142',
  type: 'General admission',
  status: 'Verified offline — pending broadcast',
  tracks: [
    ['Verification', 'Passed locally'],
    ['Broadcast', 'Not submitted'],
    ['Mining', 'No proof yet'],
    ['Wallet import', 'Not attempted'],
  ],
  evidence: [
    ['Venue signature', 'Matches the pinned venue identity.'],
    ['Ticket continuity', 'Two transfers link back to the issued ticket.'],
    ['Transaction evidence', 'Unmined transfer traces to mined ancestors.'],
    ['Merkle anchors', 'Ancestors are anchored; the latest transfer is not mined.'],
    ['Recipient output', 'Locked to the receiving key in the buyer’s request.'],
  ],
} as const
