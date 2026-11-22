import { installNetworkRecorder } from './recorder.ts'
// Imported first by main.tsx, before any module can bind window.fetch.
installNetworkRecorder()
