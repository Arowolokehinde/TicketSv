import { copyFile, mkdir } from 'node:fs/promises'

const source = new URL('../docs/superpowers/design/', import.meta.url)
const target = new URL('../public/design/', import.meta.url)
await mkdir(target, { recursive: true })
for (const name of ['counterfoil-ui.html', 'counterfoil.css', 'counterfoil-demo.js']) {
  await copyFile(new URL(name, source), new URL(name, target))
}
console.log('Synced the three unchanged Counterfoil preview assets.')
