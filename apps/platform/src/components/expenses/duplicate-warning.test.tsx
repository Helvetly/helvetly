import { render, screen } from '@testing-library/react'

import { DuplicateWarning } from './duplicate-warning'

describe('DuplicateWarning', () => {
  it('links to the earlier expense', () => {
    render(<DuplicateWarning duplicate={{ id: 'exp_7', number: 7, date: '2026-10-02' }} />)
    expect(screen.getByRole('link', { name: 'expense #7' }).getAttribute('href')).toBe(
      '/expenses?id=exp_7',
    )
    expect(screen.getByText(/from 2 Oct 2026/)).toBeTruthy()
  })

  it('renders nothing without a duplicate', () => {
    const { container } = render(<DuplicateWarning duplicate={null} />)
    expect(container.textContent).toBe('')
  })
})
