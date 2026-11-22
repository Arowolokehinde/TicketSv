import {createRoot} from 'react-dom/client'
import App from '../../src/App.tsx'
export function mount(){createRoot(document.getElementById('root')!).render(<App/>)}

export {attendeeEvidence} from '../../src/offline/attendee-evidence.ts'
export {attendeeImportStore} from '../../src/wallet/attendee-import-store.ts'
