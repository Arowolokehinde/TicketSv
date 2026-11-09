import {createRoot} from 'react-dom/client'
import App from '../../src/App.tsx'
export function mount(){createRoot(document.getElementById('root')!).render(<App/>)}
