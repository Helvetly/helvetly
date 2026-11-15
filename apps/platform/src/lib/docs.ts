import { localizedHref } from '@helvetly/i18n'
/** The developer docs site (apps/docs): API reference, MCP guide. Set per environment at build time. */
export const DOCS_URL = (process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.helvetly.com').replace(
  /\/$/,
  '',
)

/** A page of the docs site, e.g. docsUrl('/mcp'). */
export const docsUrl = (path = '') => `${DOCS_URL}${localizedHref(path)}`
