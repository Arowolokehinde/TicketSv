import {createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {WalletImportPanel} from '../../src/dev/WalletImportPanel.tsx'
export * from '../../src/settlement/store.ts'
export * from '../../src/wallet/import-journal.ts'
export function render(){createRoot(document.getElementById('test-root')!).render(createElement(WalletImportPanel))}
