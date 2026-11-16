import { act, render, screen } from '@testing-library/react'

import { TypedWelcomeTitle } from './welcome-intro'

const visible = (container: HTMLElement) =>
  container.querySelector('[aria-hidden]')?.textContent ?? ''
const typedText = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[aria-hidden] > span'))
    .map((part) =>
      Array.from(part.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join(''),
    )
    .join('')

/** Typing is one timer per letter, each set after a render: advance them one act at a time. */
function type(letters: number) {
  act(() => void vi.advanceTimersByTime(350))
  for (let i = 0; i < letters; i++) act(() => void vi.advanceTimersByTime(38))
}

function reducedMotion(on: boolean) {
  window.matchMedia = ((query: string) =>
    ({ matches: on, media: query }) as MediaQueryList) as typeof window.matchMedia
}

beforeEach(() => {
  vi.useFakeTimers()
  reducedMotion(false)
})
afterEach(() => vi.useRealTimers())

describe('TypedWelcomeTitle', () => {
  it('names the whole title for assistive tech from the first frame', () => {
    render(
      <h1>
        <TypedWelcomeTitle title="Welcome to Helvetly" />
      </h1>,
    )
    expect(screen.getByRole('heading', { name: 'Welcome to Helvetly' })).toBeInTheDocument()
  })

  it('types the title once, keeps the rest laid out, and ends complete', () => {
    const { container } = render(<TypedWelcomeTitle title="Welcome to Helvetly" />)
    expect(typedText(container)).toBe('')
    expect(visible(container)).toBe('Welcome to Helvetly')
    type(5)
    expect(typedText(container)).toHaveLength(6)
    expect(typedText(container).startsWith('Welcom')).toBe(true)
    type(80)
    expect(typedText(container)).toBe('Welcome to Helvetly')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('sets the brand word, and only it, in the accent italic', () => {
    const { container } = render(<TypedWelcomeTitle title="Welcome to Helvetly, Anna" />)
    type(80)
    const accent = container.querySelectorAll('.accent')
    expect(accent).toHaveLength(1)
    expect(accent[0]).toHaveTextContent('Helvetly')
    expect(typedText(container)).toBe('Welcome to Helvetly, Anna')
  })

  it('types plainly when a translation does not carry the brand word', () => {
    const { container } = render(<TypedWelcomeTitle title="Willkommen" />)
    type(80)
    expect(container.querySelector('.accent')).toBeNull()
    expect(typedText(container)).toBe('Willkommen')
  })

  it('never splits a grapheme', () => {
    const name = 'Zoë 👩‍👩‍👧 é 漢字'
    const { container } = render(<TypedWelcomeTitle title={`Welcome to Helvetly, ${name}`} />)
    const seen = new Set<string>()
    for (let i = 0; i < 60; i++) {
      act(() => void vi.advanceTimersByTime(i === 0 ? 350 : 38))
      seen.add(typedText(container))
    }
    const whole = `Welcome to Helvetly, ${name}`
    const letters = Array.from(
      new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(whole),
      (s) => s.segment,
    )
    const prefixes = new Set(letters.map((_, i) => letters.slice(0, i + 1).join('')))
    for (const text of [...seen].filter(Boolean)) expect(prefixes).toContain(text)
    expect(typedText(container)).toBe(`Welcome to Helvetly, ${name}`)
  })

  it('does not restart when it renders again with the same title', () => {
    const { container, rerender } = render(<TypedWelcomeTitle title="Welcome to Helvetly" />)
    type(4)
    const before = typedText(container)
    rerender(<TypedWelcomeTitle title="Welcome to Helvetly" />)
    expect(typedText(container)).toBe(before)
  })

  it('shows everything at once, with no caret or timer, for reduced motion', () => {
    reducedMotion(true)
    const { container } = render(<TypedWelcomeTitle title="Welcome to Helvetly" />)
    expect(typedText(container)).toBe('Welcome to Helvetly')
    expect(container.querySelector('[data-caret]')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
