import { useState } from 'react'

const stages = [
  {
    name: 'Seller', status: 'SELLER / PREPARED OFFLINE',
    title: 'Make the transfer for this buyer.',
    description: 'The buyer shares a receiving request. The seller checks the ticket’s evidence locally, then uses their wallet to sign a transfer to the buyer’s key. The package goes back by QR or file.',
    note: 'Both devices must be prepared online before the handoff.',
  },
  {
    name: 'Buyer', status: 'BUYER / LOCAL VERIFICATION',
    title: 'Check it. Save the package.',
    description: 'The buyer checks the venue signature, ticket history and Merkle proofs against stored block headers. Accepting saves the package locally, pending broadcast.',
    note: 'Passing these checks offline cannot rule out a double-sale. Broadcast happens after reconnecting.',
  },
  {
    name: 'Scanner', status: 'SCANNER / CHECK THE LATEST TRANSFER',
    title: 'Bring the ticket. Bring its proof.',
    description: 'The scanner checks the evidence against its own stored headers. This POC requires proof that the latest transfer is mined. Unmined transfers need an online check.',
    note: 'Mined inclusion does not prove current unspentness or prevent repeated entry.',
  },
] as const

export function HandoffJourney(): React.JSX.Element {
  const [step, setStep] = useState(0)
  const stage = stages[step]!
  return (
    <div className="journey" data-step={step}>
      <div className="journey-stops" role="group" aria-label="Handoff stages">
        {stages.map((item, index) => (
          <button key={item.name} aria-pressed={step === index} onClick={() => setStep(index)}>
            <span>0{index + 1}</span>{' '}{item.name}
          </button>
        ))}
      </div>
      <div className="journey-track" aria-hidden="true">
        <div className="journey-ticket"><small>TICKET / EVIDENCE</small><strong>Your ticket.</strong><span>TICKET + EVIDENCE</span></div>
      </div>
      <div className="journey-description" aria-live="polite" aria-atomic="true">
        <span className="journey-status">{stage.status}</span>
        <h3>{stage.title}</h3><p>{stage.description}</p><small>{stage.note}</small>
      </div>
      <button className="journey-next" onClick={() => setStep((step + 1) % stages.length)}>
        Next: {stages[(step + 1) % stages.length]!.name} →
      </button>
    </div>
  )
}
