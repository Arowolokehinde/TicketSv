// Browser-test-only entry. Never referenced by the application or production build.
import {createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {SettlementPanel} from '../../src/dev/SettlementPanel.tsx'
export * from '../../src/settlement/store.ts'
export function render(){createRoot(document.getElementById('test-root')!).render(createElement(SettlementPanel))}
