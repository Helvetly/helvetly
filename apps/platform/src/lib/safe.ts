const BASE = 'http://helvetly.invalid'

// Browsers read "\" as "/" and drop tabs and newlines, so "/\evil.com" or "/\t/evil.com" can turn
// into a protocol-relative URL.
const hasUnsafeChars = (path: string) =>
  [...path].some((char) => char === '\\' || char < ' ' || char === '\u007f')

/** A same-origin path for a `?next=` redirect (never /login), or "/". */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || hasUnsafeChars(next)) return '/'
  const url = new URL(next, BASE)
  if (url.origin !== BASE || url.pathname === '/login' || url.pathname === '/login/') return '/'
  return url.pathname + url.search + url.hash
}

/** /login, coming back to `path` after signing in. */
export function loginHref(path: string): string {
  const next = safeNextPath(path)
  return next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`
}
