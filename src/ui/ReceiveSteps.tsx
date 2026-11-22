import '../styles/readiness.css'
import type { ReceiveStep, StepKey } from '../handoff/receive-steps.ts'

const stateText = { done: 'Done', waiting: 'Waiting', todo: 'To do' } as const
// The receiver's steps in order, styled like Transfer's "Before you go offline" list.
export function ReceiveSteps({ items, current }: { items: ReceiveStep[]; current: StepKey | undefined }): React.JSX.Element {
  return (
    <section className="handoff-readiness receive-checklist" aria-label="Receive steps">
      <h3>{current ? 'Steps to receive' : 'Handoff complete'}</h3>
      <ol>
        {items.map((item, index) => (
          <li key={item.key} data-state={item.state} data-current={item.key === current || undefined}>
            <span className="step-mark" aria-hidden="true">
              {item.state === 'done' ? '✓' : index + 1}
            </span>
            <strong>{item.label}</strong>
            <span className="readiness-state">{item.key === current ? 'Now' : stateText[item.state]}</span>
            <p>{item.detail}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
