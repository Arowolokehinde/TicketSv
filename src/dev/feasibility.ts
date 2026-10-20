export type FeasibilityGateId =
  | 'wallet-connect' | 'offline-signing' | 'issuer-verification'
  | 'offline-reopen' | 'arc-access' | 'wallet-import' | 'conflicting-transfers'

export type FeasibilityGate = {
  id: FeasibilityGateId
  label: string
  status: 'not-tested'
}

export const feasibilityGates: readonly FeasibilityGate[] = [
  { id: 'wallet-connect', label: 'BRC-100 wallet connection', status: 'not-tested' },
  { id: 'offline-signing', label: 'Offline PushDrop signing and final Atomic BEEF', status: 'not-tested' },
  { id: 'issuer-verification', label: 'Venue identity signature verification', status: 'not-tested' },
  { id: 'offline-reopen', label: 'Offline reopening and key access', status: 'not-tested' },
  { id: 'arc-access', label: 'Direct browser ARC submission and mining proofs', status: 'not-tested' },
  { id: 'wallet-import', label: 'Wallet import and lost-response reconciliation', status: 'not-tested' },
  { id: 'conflicting-transfers', label: 'Controlled conflicting transfers', status: 'not-tested' },
]
