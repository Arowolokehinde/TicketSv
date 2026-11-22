import { useEffect, useId, useRef, useState } from 'react'
import { matchTimes, parseTime } from '../events/time-slots.ts'

// Works like the timezone picker beside it: quarter-hour times, and typing a time
// ("19:30", "7pm") picks it, even off the quarter-hour grid.
export function StartTimePicker({ value, onChange }: { value: string; onChange: (time: string) => void }) {
  const id = useId(),
    input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [active, setActive] = useState(-1),
    [above, setAbove] = useState(false)
  const options = matchTimes(query, value)
  function show() {
    if (open) return
    const box = input.current?.getBoundingClientRect()
    setAbove(Boolean(box && window.innerHeight - box.bottom < 270 && box.top > 300))
    setQuery('')
    // Start at the chosen time, or early evening for a new event.
    setActive(matchTimes('', value).indexOf(value || '18:00'))
    setOpen(true)
  }
  function close() {
    setOpen(false)
    setQuery('')
    setActive(-1)
  }
  function choose(time: string) {
    onChange(time)
    close()
  }
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, id])
  // On opening, put the starting time in the middle of the list, with times either side.
  const opened = useRef(false)
  useEffect(() => {
    if (open && !opened.current && active >= 0) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'center' })
    opened.current = open
  }, [open, active, id])
  return (
    <div
      className="time-picker"
      onBlur={event => {
        if (event.currentTarget.contains(event.relatedTarget)) return
        // Leaving the field keeps a typed time; anything else leaves the old value.
        const typed = open && query ? parseTime(query) : undefined
        if (typed) choose(typed)
        else close()
      }}
    >
      <label htmlFor={id}>Start time</label>
      <div className="time-input-wrap">
        <input
          id={id}
          ref={input}
          required
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? `${id}-options` : undefined}
          aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
          autoComplete="off"
          inputMode="text"
          value={open ? query : value}
          placeholder={open ? 'Type a time, such as 19:30 or 7pm' : 'Choose a time'}
          onFocus={show}
          onClick={show}
          onChange={event => {
            show()
            setQuery(event.target.value)
            setActive(-1)
          }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (!open) {
                show()
                return
              }
              setActive(index =>
                options.length
                  ? event.key === 'ArrowDown'
                    ? Math.min(index + 1, options.length - 1)
                    : index < 0
                      ? options.length - 1
                      : Math.max(index - 1, 0)
                  : -1,
              )
            } else if (event.key === 'Enter' && open) {
              event.preventDefault()
              const typed = query ? parseTime(query) : undefined
              if (active >= 0 && options[active]) choose(options[active])
              else if (typed) choose(typed)
            } else if (event.key === 'Escape' && open) {
              event.preventDefault()
              event.stopPropagation()
              close()
            }
          }}
        />
        <span className="time-chevron" aria-hidden="true">
          ⌄
        </span>
      </div>
      {open && (
        <div className={`time-menu${above ? ' time-menu-above' : ''}`}>
          <div className="time-menu-caption">Every 15 minutes, or type any time</div>
          <div id={`${id}-options`} role="listbox" aria-label="Times" className="time-options">
            {options.map((time, index) => (
              <div
                key={time}
                id={`${id}-${index}`}
                role="option"
                aria-selected={time === value}
                className={active === index ? 'time-option active' : 'time-option'}
                onPointerDown={event => event.preventDefault()}
                onClick={() => choose(time)}
              >
                <span>{time}</span>
                {time === value && <span aria-hidden="true">✓</span>}
              </div>
            ))}
            {!options.length && <p role="status">No matching times.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
