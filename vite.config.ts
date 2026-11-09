import { defineConfig,loadEnv } from 'vite'
import {PrivateKey} from '@bsv/sdk'
import react from '@vitejs/plugin-react'
import {offlineBuild} from './scripts/offline-build.ts'

const proxy = {
  '/api': { target: process.env.TICKETSV_API_TARGET ?? 'http://127.0.0.1:5177', changeOrigin: false, xfwd: true },
  '/.well-known/auth': { target: process.env.TICKETSV_API_TARGET ?? 'http://127.0.0.1:5177', changeOrigin: false, xfwd: true },
}
// The public origin stays the same for cookies and BRC-104 signed paths.
export default defineConfig(({mode})=>{
  const env=loadEnv(mode,process.cwd(),''),secret=process.env.AUTH_SERVER_PRIVATE_KEY??env.AUTH_SERVER_PRIVATE_KEY
  const identity=secret?PrivateKey.fromHex(secret).toPublicKey().toString():''
  return {
  define:{__TICKETSV_AUTH_IDENTITY__:JSON.stringify(identity)},
  plugins: [react(), offlineBuild()],
  server: { host: '127.0.0.1', port: 5175, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 4175, strictPort: true, proxy },
}
})
