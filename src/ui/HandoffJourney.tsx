import { useEffect, useRef, useState } from 'react'

const stages = [
  { name: 'Prepare', title: 'Ready before you go.', description: 'Save the ticket and its evidence online. Prepare both wallets and get the recipient’s request.' },
  { name: 'Transfer', title: 'From your hands to theirs.', description: 'Sign for the recipient. Share the ticket and its history by file or QR.' },
  { name: 'Verify', title: 'The proof comes with it.', description: 'Check its origin, history and recipient locally. Reconnect to submit and track confirmation.' },
] as const

function StepIllustration({ step }: { step: number }): React.JSX.Element {
  return (
    <svg className="handoff-illustration" viewBox="0 0 240 150" fill="none" aria-hidden="true">
      <ellipse cx="120" cy="134" rx="78" ry="5" fill="currentColor" opacity=".06" />
      {step === 0 && <>
        <rect x="87" y="12" width="71" height="119" rx="9" className="handoff-paper" />
        <path d="M110 21h25M112 121h21" className="handoff-line" />
        <g className="handoff-save">
          <path d="M72 42h67v20a7 7 0 0 0 0 14v24H72V76a7 7 0 0 0 0-14V42Z" className="handoff-wine" />
          <path d="M85 55h27M85 62h19M85 84h39" stroke="#fff4db" strokeWidth="2" />
          <path d="M122 46v48" stroke="#fff4db" strokeDasharray="3 4" opacity=".5" />
        </g>
        <circle cx="159" cy="97" r="18" className="handoff-acid" />
        <path d="M151 97l5 5 11-12" className="handoff-line" />
      </>}
      {step === 1 && <>
        <rect x="31" y="29" width="51" height="100" rx="7" className="handoff-paper" />
        <rect x="158" y="18" width="51" height="111" rx="7" className="handoff-paper" />
        <path d="M48 38h17M48 119h17M175 28h17M175 119h17" className="handoff-line" />
        <path d="M86 103h65m-6-5 6 5-6 5" className="handoff-line" strokeDasharray="3 5" opacity=".45" />
        <g className="handoff-pass">
          <path d="M87 45h65v14a6 6 0 0 0 0 12v16H87V71a6 6 0 0 0 0-12V45Z" className="handoff-wine" />
          <path d="M99 57h24M99 64h15M135 48v35" stroke="#fff4db" strokeWidth="1.5" strokeDasharray="3 3" />
        </g>
      </>}
      {step === 2 && <>
        <path d="M76 18h77v112l-7-4-7 4-7-4-7 4-7-4-7 4-7-4-7 4-7-4-7 4-7-4V18Z" className="handoff-paper" />
        <path d="M89 33h33M89 41h20" className="handoff-line" />
        <g className="handoff-checks">
          <path d="m89 60 3 3 6-7m-9 22 3 3 6-7m-9 22 3 3 6-7" className="handoff-line" />
          <path d="M108 60h29M108 78h29M108 96h20" className="handoff-line" opacity=".35" />
        </g>
        <g className="handoff-stamp">
          <circle cx="162" cy="99" r="27" className="handoff-acid" />
          <circle cx="162" cy="99" r="21" stroke="currentColor" strokeDasharray="2 3" opacity=".4" />
          <path d="m151 99 7 7 15-17" className="handoff-line" />
        </g>
      </>}
    </svg>
  )
}

export function HandoffJourney(): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry?.isIntersecting ?? false)
    }, { threshold: 0.15 })
    if (container.current) observer.observe(container.current)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={container} className={`handoff-story${visible ? ' is-visible' : ''}`}>
      <ol className="handoff-steps" aria-label="Ticket handoff steps">
        {stages.map((stage, index) => (
          <li className="handoff-step" key={stage.name}>
            <div className="handoff-step-heading"><span className="handoff-number" aria-hidden="true">0{index + 1}</span><h3>{stage.name}</h3></div>
            <div className="handoff-art"><StepIllustration step={index} /></div>
            <h4>{stage.title}</h4>
            <p>{stage.description}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}
