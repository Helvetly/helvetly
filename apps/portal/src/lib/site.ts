import { localizedHref } from '@helvetly/i18n'

/** The public website (apps/web): legal pages. Set per environment at build time, like NEXT_PUBLIC_DOCS_URL. */
const WEB_URL = (process.env.NEXT_PUBLIC_WEB_URL ?? 'https://www.helvetly.com').replace(/\/$/, '')

/** A page of the website, e.g. siteUrl('/privacy'). */
export const siteUrl = (path: string) => `${WEB_URL}${localizedHref(path)}`
