import { describe, expect, it } from 'vitest'

import { MAX_QUOTE, splitQuote, toQuote, withQuote } from './quote'

describe('quote', () => {
  it('tidies a selection: trimmed lines, no blank ones', () => {
    expect(toQuote('  Overdue: 2 invoices \n\n  Total CHF 1,200\n')).toBe(
      'Overdue: 2 invoices\nTotal CHF 1,200',
    )
  })

  it('cuts a long selection with an ellipsis', () => {
    const quote = toQuote('a'.repeat(MAX_QUOTE + 50))
    expect(quote).toHaveLength(MAX_QUOTE + 1)
    expect(quote.endsWith('…')).toBe(true)
  })

  it('round-trips a multi-line quote through the sent message', () => {
    const sent = withQuote('First line\nSecond line', 'Why is that?')
    expect(sent).toBe('> First line\n> Second line\n\nWhy is that?')
    expect(splitQuote(sent)).toEqual({ quote: 'First line\nSecond line', body: 'Why is that?' })
  })

  it('leaves a message without a quote as it is', () => {
    expect(splitQuote('Hello > there')).toEqual({ body: 'Hello > there' })
  })
})
