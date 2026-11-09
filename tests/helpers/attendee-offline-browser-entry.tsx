/// <reference types="vite/client" />
import { createRoot } from 'react-dom/client'
import App from '../../src/App.tsx'
export { attendeeEvidence } from '../../src/offline/attendee-evidence.ts'
export { listSavedTickets, saveAttendeeTicket, removeSavedTicket } from '../../src/offline/attendee-store.ts'
export { prepareAttendeeApp } from '../../src/offline/attendee-cache.ts'
export function render() { createRoot(document.getElementById('test-root')!).render(<App />) }
export { advanceAuthEpoch } from '../../src/auth/api.ts'
