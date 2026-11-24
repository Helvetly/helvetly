import { locale } from '@helvetly/i18n'
import { publicHref } from '@helvetly/i18n/public-href'

/** The public website (apps/web): legal pages. Set per environment at build time, like NEXT_PUBLIC_DOCS_URL. */
const WEB_URL = (process.env.NEXT_PUBLIC_WEB_URL ?? 'https://www.helvetly.com').replace(/\/$/, '')

/** A page of the website, e.g. siteUrl('/privacy'). */
export const siteUrl = (path: string) => `${WEB_URL}${publicHref(path, locale)}`
