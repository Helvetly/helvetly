// A workspace's own portal lives under /w/<slug>/ on the portal's host (the API's internal/portalscope): the same
// static pages, with the scope read from the address. Pages, links and API calls stay under the prefix.
import { setApiBase } from '@helvetly/ui/lib/http'

const SCOPED = /^\/w\/([a-z0-9-]+)(?=\/|$)/

/** The workspace slug of a path, null outside a workspace's portal. */
export function slugOf(pathname: string): string | null {
  return SCOPED.exec(pathname)?.[1] ?? null
}

/** The path prefix of the current page's scope: "/w/<slug>", or "" for the shared portal. */
export function scopePrefix(): string {
  if (typeof window === 'undefined') return ''
  const slug = slugOf(window.location.pathname)
  return slug ? `/w/${slug}` : ''
}

/** A portal path ("/invoices") inside the current scope. */
export const scoped = (path: string) => scopePrefix() + path

/** The portal path of a scoped pathname: "/w/acme/invoices/" → "/invoices/". */
export const unscoped = (pathname: string) => pathname.replace(SCOPED, '') || '/'

/** Sends every API call of this page under its scope; run once before the first call. */
export function applyScope() {
  setApiBase(scopePrefix())
}
