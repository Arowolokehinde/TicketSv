import {createElement} from 'react'
import {createRoot} from 'react-dom/client'
import {ConflictExperimentPanel} from '../../src/dev/ConflictExperimentPanel.tsx'
export * from '../../src/conflicts/store.ts'
export function render(){createRoot(document.getElementById('test-root')!).render(createElement(ConflictExperimentPanel))}
