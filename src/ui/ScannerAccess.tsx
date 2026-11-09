import type {ReactNode} from 'react'
import {RequireAuth,useAuth} from '../auth/AuthProvider.tsx'
export function ScannerAccess({children}:{children:ReactNode}){
 const auth=useAuth()
 if(!auth.loading&&!auth.session&&!navigator.onLine)return <main className="development-page"><h1>Sign in online to use this scanner.</h1><p>Connect, sign in and prepare this device before scanning offline. Saved tickets and headers are retained.</p><a className="btn" href="/tickets">Open Dashboard</a></main>
 return <RequireAuth>{children}</RequireAuth>
}
