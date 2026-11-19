import { defaultLocale } from '@helvetly/i18n'

import { readCollection } from '@/lib/content'
import { SITE_URL } from '@/lib/metadata'
import { PLATFORM_URL } from '@/lib/site'

const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.helvetly.com'

const link = (title: string, path: string, description: string) =>
  `- [${title}](${SITE_URL}${path}): ${description}`

/** The website's llms.txt (https://llmstxt.org): what Helvetly is and where its pages are, for AI agents. */
export function llmsTxt(): string {
  const guides = readCollection('guides', defaultLocale)
  const help = readCollection('help', defaultLocale)
  return [
    '# Helvetly',
    '',
    '> Business software for small Swiss companies: clients, quotes and invoices with the Swiss QR bill and e-invoice ' +
      'XML, payment reminders, expenses, documents, e-signatures, a client portal, the books and VAT return, ' +
      'employees, and Heidi, an AI assistant that knows your books. Hosted in Switzerland, passwordless sign-in.',
    '',
    'Prices are per person and month, tax included, in CHF, EUR or USD; every new workspace starts with a free ' +
      '7-day Pro trial. The site is also in German, French, Italian, Dutch, Czech and Swedish (/de, /fr, /it, /nl, /cs, /sv).',
    '',
    '## Product',
    '',
    link('Home', '/', 'what Helvetly does, feature by feature'),
    link(
      'Pricing',
      '/pricing',
      'the Basic, Pro and Business plans, their limits and a plan comparison',
    ),
    link(
      'Security',
      '/security',
      'hosting in Switzerland, encryption, sign-in and data protection',
    ),
    link('Questions', '/faq', 'frequent questions about plans, data and switching'),
    `- [Start the free trial](${PLATFORM_URL}/login): sign-in by email code, Google or passkey creates the account`,
    '',
    '## Guides',
    '',
    ...guides.map((a) => link(a.title, `/guides/${a.slug}`, a.description)),
    '',
    '## Help',
    '',
    ...help.map((a) => link(a.title, `/help/${a.slug}`, a.description)),
    '',
    '## Developers',
    '',
    `- [API documentation](${DOCS_URL}): the REST API and its OpenAPI catalogue, with personal API tokens`,
    `- [MCP server](${PLATFORM_URL}/api/mcp): remote MCP (Streamable HTTP) with the API's operations as tools; ` +
      'authenticate with a personal API token (Authorization: Bearer hvt_…)',
    '',
    '## Optional',
    '',
    link('Terms', '/terms', 'terms of service'),
    link('Privacy', '/privacy', 'privacy policy'),
    link('Subprocessors', '/subprocessors', 'the services that process customer data'),
    link('Imprint', '/imprint', 'the company behind Helvetly'),
    '',
  ].join('\n')
}
