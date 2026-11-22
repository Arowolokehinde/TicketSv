import { expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'

// Unit tests stay fast and browser-free. Browser-launching Vitest files end in
// .ui.test.ts (npm run test:ui); Playwright suites end in .browser.test.ts.
it('keeps browser launches out of the unit suite', async () => {
  const names = (await readdir('tests')).filter(
    name => name.endsWith('.test.ts') && !name.endsWith('.ui.test.ts') && !name.endsWith('.browser.test.ts'),
  )
  const launching: string[] = []
  for (const name of names) if ((await readFile(`tests/${name}`, 'utf8')).includes('chromium' + '.launch(')) launching.push(name)
  expect(launching).toEqual([])
})
