import { defaultLocale, isLocale, localeDetails, locales, localizedHref } from '@helvetly/i18n'

import { compareIn } from '@/lib/compare'
import { readCollection } from '@/lib/content'
import { translatorFor } from '@/lib/i18n'
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
    `> ${translatorFor(defaultLocale)('whatIsHelvetlyAnswer')}`,
    '',
    'Prices are per person and month, tax included, in CHF, EUR or USD; every new workspace starts with a free ' +
      '7-day Pro trial. The site is also in German, French, Italian, Dutch, Czech and Swedish (/de, /fr, /it, /nl, /cs, /sv).',
    '',
    '## Scope and availability',
    '',
    'Built in Switzerland; Hosted in Frankfurt, Germany (EU). The public website supports seven languages; ' +
      'the application and client portal support English, German, French and Italian. ' +
      'Feature availability and usage limits depend on the plan; employee records and the payroll register are Business features. ' +
      'The payroll register records externally calculated pay; it does not calculate salaries or payroll taxes. ' +
      'E-invoice exports support specific European formats, not universal tax compliance or built-in network delivery. ' +
      'Heidi is optional and requires each user’s approval.',
    '',
    '## Languages',
    '',
    ...Object.keys(locales)
      .filter(isLocale)
      .map((language) =>
        link(
          localeDetails(language).name,
          localizedHref('/', language),
          translatorFor(language)('metaHomeDescription'),
        ),
      ),
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
      'hosted in Frankfurt, Germany (EU), encryption, sign-in and data protection',
    ),
    link('Questions', '/faq', 'frequent questions about plans, data and switching'),
    `- [Start the free trial](${PLATFORM_URL}/login): sign-in by email code, Google or passkey creates the account`,
    '',
    '## Comparisons',
    '',
    ...compareIn(defaultLocale).COMPETITORS.map((c) =>
      link(`Helvetly vs ${c.name}`, `/compare/${c.slug}`, c.summary),
    ),
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
