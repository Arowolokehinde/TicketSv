import {createRoot} from 'react-dom/client'
import {createElement} from 'react'
import App from '../../src/App.tsx'
export function render(){createRoot(document.getElementById('test-root')!).render(createElement(App))}
export {senderStore,recipientStore,readSender,readRecipient,sourceKey,recipientKey} from '../../src/handoff/store.ts'
export {settlementStore,newSettlement} from '../../src/handoff/settlement.ts'
export {saveAttendeeTicket} from '../../src/offline/attendee-store.ts'
export {prepareAttendeeApp} from '../../src/offline/attendee-cache.ts'
