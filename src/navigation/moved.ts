// Placeholder pages were removed; old links land on the real flows instead.
const moved: Record<string, string> = {
  '/tickets/receive': '/offline/handoff?step=receive',
  '/tickets/transfer': '/offline/handoff?step=prepare',
  '/tickets/sample': '/tickets',
  '/tickets/prepare': '/tickets',
  '/venue/prepare': '/venue',
}
export const movedRoute = (path: string): string | undefined => moved[path]
