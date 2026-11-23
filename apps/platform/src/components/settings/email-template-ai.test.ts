import { lineDiff } from './email-template-ai'

describe('lineDiff', () => {
  it('keeps common lines and marks the rest', () => {
    expect(lineDiff('Hello\n\nBye', 'Dear {client}\n\nBye\nThanks')).toEqual([
      { kind: 'added', text: 'Dear {client}' },
      { kind: 'removed', text: 'Hello' },
      { kind: 'same', text: '' },
      { kind: 'same', text: 'Bye' },
      { kind: 'added', text: 'Thanks' },
    ])
  })
  it('is all same for equal texts', () => {
    expect(lineDiff('a\nb', 'a\nb').every((line) => line.kind === 'same')).toBe(true)
  })
})
