import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PlanBadge } from './plan-badge'

describe('PlanBadge', () => {
  it('names its plan and draws the lock only when locked', () => {
    const { container } = render(
      <>
        <PlanBadge plan="business" locked>
          Business
        </PlanBadge>
        <PlanBadge plan="pro">Pro</PlanBadge>
      </>,
    )
    expect(screen.getByText('Business')).toHaveAttribute('data-plan', 'business')
    expect(screen.getByText('Business').querySelector('svg')).toHaveAttribute('aria-hidden')
    expect(screen.getByText('Pro').querySelector('svg')).toBeNull()
    expect(container.querySelectorAll('svg')).toHaveLength(1)
  })
  it('falls back to the neutral tone for an unknown plan', () => {
    render(<PlanBadge plan="gold">Upgrade</PlanBadge>)
    expect(screen.getByText('Upgrade')).toHaveAttribute('data-plan', 'basic')
  })
})
