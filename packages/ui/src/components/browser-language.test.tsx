import { render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('?lang=en') }))

import { BrowserLanguage } from './browser-language'

describe('browser language shell', () => {
  it('keeps locale-dependent content out of the static shell and renders it in the browser', () => {
    const content = (
      <BrowserLanguage>
        <p>Language-dependent content</p>
      </BrowserLanguage>
    )
    expect(renderToString(content)).not.toContain('Language-dependent content')
    render(content)
    expect(screen.getByText('Language-dependent content')).toBeVisible()
    expect(document.documentElement.lang).toBe('en')
  })
})
