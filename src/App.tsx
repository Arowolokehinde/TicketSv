import { useEffect } from 'react'
import { FeasibilityScreen } from './dev/FeasibilityScreen.tsx'
import './styles/tokens.css'

export default function App(): React.JSX.Element | null {
  const path = window.location.pathname

  useEffect(() => {
    if (path === '/') {
      window.location.replace(`/design/counterfoil-ui.html${window.location.hash || '#/'}`)
    }
  }, [path])

  if (path === '/') return null
  if (path === '/dev/feasibility') {
    return <FeasibilityScreen />
  }
  return (
    <main className="development-page">
      <h1>Development route not found</h1>
      <p>Product routes are still part of the design preview.</p>
      <a href="/design/counterfoil-ui.html#/">Open the Counterfoil preview</a>
    </main>
  )
}
