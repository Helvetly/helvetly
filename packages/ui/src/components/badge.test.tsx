import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Badge, BADGE_TONES, TONES } from './badge'

describe('Badge', () => {
  it('is a soft neutral badge by default', () => {
    render(<Badge>Draft</Badge>)
    const badge = screen.getByText('Draft')
    expect(badge).toHaveAttribute('data-variant', 'soft')
    expect(badge).toHaveAttribute('data-tone', 'neutral')
  })
  it('draws a hidden dot only in the dot variant', () => {
    render(
      <>
        <Badge variant="dot" tone="green">
          Live
        </Badge>
        <Badge tone="green">Paid</Badge>
      </>,
    )
    expect(screen.getByText('Live').querySelector('[aria-hidden]')).not.toBeNull()
    expect(screen.getByText('Paid').querySelector('[aria-hidden]')).toBeNull()
  })
  it('gives every tone a tint for icon tiles', () => {
    for (const tone of BADGE_TONES) expect(TONES[tone]).toContain(`--badge-surface:`)
  })
})
