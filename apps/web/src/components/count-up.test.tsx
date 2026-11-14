import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CountUp, formatSwiss } from './count-up'

describe('formatSwiss', () => {
  it.each([
    [0, 0, '0'],
    [860, 0, '860'],
    [4860, 2, '4’860.00'],
    [1234567.891, 2, '1’234’567.89'],
  ])('formats %d with %d decimals as %s', (value, decimals, out) => {
    expect(formatSwiss(value, decimals)).toBe(out)
  })
})

describe('CountUp', () => {
  it('renders the final figure before it is seen', () => {
    render(<CountUp to={48260} />)
    expect(screen.getByText('48’260')).toBeTruthy()
  })
})
