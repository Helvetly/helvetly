import { defaultLocale, localizedHref } from '@helvetly/i18n'

const BASE = 'http://helvetly.invalid'

// Browsers read "\" as "/" and drop tabs and newlines, so "/\evil.com" or "/\t/evil.com" can turn
// into a protocol-relative URL.
const hasUnsafeChars = (path: string) =>
  [...path].some((char) => char === '\\' || char < ' ' || char === '\u007f')

/** A safe router path without a locale prefix; Next.js adds the current build prefix. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || hasUnsafeChars(next)) return '/'
  const url = new URL(next, BASE)
  if (
    url.origin !== BASE ||
    /^\/(?:[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\/)?login(?:\/|$)/.test(url.pathname)
  )
    return '/'
  return localizedHref(url.pathname + url.search + url.hash, defaultLocale)
}

/** /login, coming back to `path` after signing in. */
export function loginHref(path: string): string {
  const next = safeNextPath(path)
  return next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`
}
