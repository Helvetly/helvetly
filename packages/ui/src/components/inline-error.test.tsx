import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FieldError, InlineError } from './inline-error'

describe('InlineError', () => {
  it('announces the failure as an alert', () => {
    render(<InlineError>No client matches.</InlineError>)
    expect(screen.getByRole('alert')).toHaveTextContent('No client matches.')
  })
  it('ties a field error to its id', () => {
    render(<FieldError id="x-error">Required</FieldError>)
    expect(screen.getByText('Required').closest('p')).toHaveAttribute('id', 'x-error')
  })
})
