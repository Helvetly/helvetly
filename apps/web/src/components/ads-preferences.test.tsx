// @vitest-environment-options {"url":"https://www.helvetly.com/?gclid=sample"}
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { AdsPreferences } from './ads-preferences'

afterEach(() => {
  document.cookie = 'helvetly_ads=; Domain=helvetly.com; Path=/; Max-Age=0'
})
it('waiting and declining send no ad click; a later opt-in and withdrawal take effect immediately', () => {
  render(<AdsPreferences />)
  expect(screen.getByRole('complementary', { name: 'Ad measurement' })).toBeVisible()
  expect(document.querySelector('iframe')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
  expect(document.cookie).toContain('helvetly_ads=no')
  expect(document.querySelector('iframe')).toBeNull()
  const settings = screen.getByRole('button', { name: 'Ad measurement' })
  fireEvent.click(settings)
  expect(screen.getByRole('button', { name: 'Decline' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
  expect(document.querySelector('iframe')?.src).toBe(
    'https://api.helvetly.com/api/v1/public/ads/measurement?gclid=sample',
  )
  document.cookie = '_gcl_aw=click; Domain=helvetly.com; Path=/'
  fireEvent.click(settings)
  fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
  expect(document.cookie).not.toContain('_gcl_aw=')
  expect(document.querySelector('iframe')).toBeNull()
  expect(settings).toHaveFocus()
})
