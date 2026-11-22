import './network/install.ts'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { startOfflineApp } from './offline/update.ts'
import { UpdateBanner } from './ui/UpdateBanner.tsx'

startOfflineApp()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdateBanner />
  </StrictMode>,
)
