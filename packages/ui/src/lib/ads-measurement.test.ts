import { afterEach, expect, it } from 'vitest'

import { adClick, measureAds } from './ads-measurement'

afterEach(() => {
  document.cookie = 'helvetly_ads=; Path=/; Max-Age=0'
  document.body.replaceChildren()
})

it('passes only valid Google ad click IDs to the measurement frame', () => {
  expect(adClick('?gclid=Ab_123-4&email=private&code=secret&wbraid=xy.z')).toBe(
    'gclid=Ab_123-4&wbraid=xy.z',
  )
  expect(adClick('?gclid=x%26private%3D42&gbraid=' + 'a'.repeat(513))).toBe('')
})

it('loads the frame only after consent and removes it on cleanup', () => {
  const event = { type: 'landing', click: 'gclid=a' } as const
  measureAds(event)
  expect(document.querySelector('iframe')).toBeNull()
  document.cookie = 'helvetly_ads=yes; Path=/'
  const cleanup = measureAds(event)
  const frame = document.querySelector('iframe')
  expect(frame?.src).toBe('https://api.helvetly.com/api/v1/public/ads/measurement?gclid=a')
  expect(frame?.referrerPolicy).toBe('no-referrer')
  cleanup?.()
  expect(document.querySelector('iframe')).toBeNull()
})
