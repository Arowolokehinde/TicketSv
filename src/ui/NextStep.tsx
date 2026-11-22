import type { NextStep as Step } from '../handoff/receive-steps.ts'

// What was just finished and the one thing to do now, with its button when there is one.
export function NextStep({ step, children }: { step: Step; children?: React.ReactNode }): React.JSX.Element {
  return (
    <section className="handoff-next" aria-label="Next step">
      {step.done && (
        <p className="handoff-next-done">
          <span aria-hidden="true">✓</span> Done: {step.done}
        </p>
      )}
      <p>
        <strong>Next:</strong> {step.next}
      </p>
      {children && <div className="actions">{children}</div>}
    </section>
  )
}
