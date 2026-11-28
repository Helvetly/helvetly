const endpoint = 'https://api.helvetly.com/api/v1/public/ads/measurement'
const apiOrigin = new URL(endpoint).origin
const marker = '__Host-helvetly_signup'
export const adsAllowed = () => document.cookie.split('; ').includes('helvetly_ads=yes')

export function adClick(search: string) {
  const input = new URLSearchParams(search)
  const click = new URLSearchParams()
  for (const key of ['gclid', 'gbraid', 'wbraid']) {
    const value = input.get(key)
    if (value && /^[\w.~-]{1,512}$/.test(value)) click.set(key, value)
  }
  return click.toString()
}

export function adsSignupId() {
  return document.cookie.match(/(?:^|; )__Host-helvetly_signup=([A-Z2-7]{26})(?:;|$)/)?.[1]
}

/** The Google script runs on a separate origin with no access to either parent page. */
export function measureAds(
  event: { type: 'signup'; id: string } | { type: 'landing'; click: string },
) {
  if (!adsAllowed()) return
  const frame = document.createElement('iframe')
  frame.hidden = true
  frame.title = 'Google Ads'
  frame.referrerPolicy = 'no-referrer'
  frame.addEventListener('load', () => {
    if (adsAllowed())
      frame.contentWindow?.postMessage(
        event.type === 'signup' ? event : { type: 'landing' },
        apiOrigin,
      )
  })
  const confirmed = (ack: MessageEvent) => {
    if (
      event.type === 'signup' &&
      ack.origin === apiOrigin &&
      ack.source === frame.contentWindow &&
      ack.data?.type === 'signup-sent' &&
      ack.data.id === event.id &&
      adsSignupId() === event.id
    ) {
      document.cookie = marker + '=; Path=/; Secure; SameSite=Lax; Max-Age=0'
      cleanup()
    }
  }
  const cleanup = () => {
    window.removeEventListener('message', confirmed)
    frame.remove()
  }
  window.addEventListener('message', confirmed)
  frame.src = endpoint + (event.type === 'landing' ? '?' + event.click : '')
  document.body.append(frame)
  return cleanup
}

// GA4 on ordinary pages cannot grant advertising consent. Only the isolated measurement frame may do so.
export function denyAnalyticsAdvertising() {
  const target = window as Window & { dataLayer?: IArguments[] }
  target.dataLayer ??= []
  function queue(_command: string, _operation: string, _value: unknown) {
    target.dataLayer?.push(arguments)
  }
  queue('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  })
  queue('set', 'ads_data_redaction', true)
}
