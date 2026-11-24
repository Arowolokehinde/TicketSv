import { expect, it } from 'vitest'
import { encodeFrames, FrameAssembler } from '../src/handoff/transport.ts'
it('assembles bounded Unicode JSON frames out of order with identical duplicates', () => {
  const text = JSON.stringify({ text: '🧡'.repeat(1800) }),
    frames = encodeFrames(text),
    assembler = new FrameAssembler()
  expect(frames.length).toBeGreaterThan(1)
  expect(assembler.add(frames[1])).toBeUndefined()
  expect(assembler.add(frames[1])).toBeUndefined()
  let result: string | undefined
  for (const f of frames.toReversed()) result = assembler.add(f) ?? result
  expect(result).toBe(text)
})
it('rejects mixed exchanges, conflicting duplicates, tampering and oversized envelopes', () => {
  const a = encodeFrames(JSON.stringify({ value: 'a'.repeat(2500) })),
    b = encodeFrames(JSON.stringify({ value: 'b'.repeat(2500) })),
    assembler = new FrameAssembler()
  assembler.add(a[0])
  expect(() => assembler.add(b[1])).toThrow('Mixed handoff frames; reset before scanning another exchange.')
  const conflict = JSON.parse(a[0])
  conflict.payload = conflict.payload.replace(/./, 'x')
  expect(() => assembler.add(JSON.stringify(conflict))).toThrow('Conflicting duplicate exchange frame.')
  assembler.reset()
  const bad = a.map(s => JSON.parse(s))
  bad[0].payload = bad[0].payload.slice(0, -4) + 'YWFh'
  expect(() => bad.forEach(f => assembler.add(JSON.stringify(f)))).toThrow('Invalid ticket package or receiving request')
  expect(() => encodeFrames('x'.repeat(4 * 1024 * 1024 + 1))).toThrow('Handoff envelope exceeds 4 MiB.')
  expect(() => encodeFrames('not json')).toThrow('Unexpected token \'o\', "not json" is not valid JSON')
  expect(() => new FrameAssembler().add(JSON.stringify({ ...JSON.parse(a[0]), count: 4097 }))).toThrow('Invalid exchange frame.')
})
