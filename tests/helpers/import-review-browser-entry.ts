// Test-only entry; never imported by the application.
import {createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {WalletImportReviewPanel} from '../../src/dev/WalletImportReviewPanel.tsx'
export * from '../../src/settlement/store.ts'
export function render(){createRoot(document.getElementById('test-root')!).render(createElement(WalletImportReviewPanel))}
