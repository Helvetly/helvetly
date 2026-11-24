import { defaultLocale, isLocale, localeDetails, locales, localizedHref } from '@helvetly/i18n'
import { formatPrice } from '@helvetly/ui/lib/price'

import { compareIn } from '@/lib/compare'
import { readCollection } from '@/lib/content'
import { translatorFor } from '@/lib/i18n'
import { SITE_URL } from '@/lib/metadata'
import {
  extraPersonOf,
  type Plan,
  plansIn,
  priceOf,
  SELF_SERVICE_SEATS,
  TRIAL,
  YEARLY_DISCOUNT_PERCENT,
} from '@/lib/plans'
import { PLATFORM_URL } from '@/lib/site'

const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.helvetly.com'

const link = (title: string, path: string, description: string) =>
  `- [${title}](${SITE_URL}${path}): ${description}`

const people = (n: number) => (n === 1 ? '1 person' : `${n} people`)

/** "Pro: CHF 49 a month (CHF 471 a year) for 2 people, CHF 15 (CHF 144 a year) per extra person, up to 25 people". */
function planLine(plan: Plan): string {
  if (plan.monthly === 0) return `${plan.name}: free forever for ${people(plan.includedPeople)}`
  const seats = SELF_SERVICE_SEATS[plan.id]
  return (
    `${plan.name}: ${formatPrice(priceOf(plan, 'month'))} a month (${formatPrice(priceOf(plan, 'year'))} a year) ` +
    `for ${people(plan.includedPeople)}, ${formatPrice(extraPersonOf(plan, 'month'))} ` +
    `(${formatPrice(extraPersonOf(plan, 'year'))} a year) per extra person, ` +
    (seats === null ? 'any number of people' : `up to ${people(seats)}`)
  )
}

/** The website's llms.txt (https://llmstxt.org): what Helvetly is and where its pages are, for AI agents. */
export function llmsTxt(): string {
  const guides = readCollection('guides', defaultLocale)
  const help = readCollection('help', defaultLocale)
  const { PLANS } = plansIn(defaultLocale)
  const trialPlan = PLANS.find((plan) => plan.id === TRIAL.plan)?.name
  return [
    '# Helvetly',
    '',
    `> ${translatorFor(defaultLocale)('whatIsHelvetlyAnswer')}`,
    '',
    `Plans: ${PLANS.map(planLine).join('; ')}. ` +
      'Each plan has a price that covers its included people, and each further person adds the extra-person price. ' +
      `Prices include tax, are the same figures in CHF, EUR and USD, and are ${YEARLY_DISCOUNT_PERCENT}% lower billed yearly. ` +
      `Every new workspace can try ${trialPlan} free for ${TRIAL.days} days with up to ${people(TRIAL.members)} ` +
      '(a payment card is required); without a paid plan afterwards it continues on Free, its data kept. ' +
      'The site is also in German, French, Italian, Dutch, Czech and Swedish (/de, /fr, /it, /nl, /cs, /sv).',
    '',
    '## Scope and availability',
    '',
    'Built in Switzerland; EU hosting (Frankfurt). The public website supports seven languages; ' +
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
      'the Free, Basic, Pro and Business plans, their prices, limits and a plan comparison',
    ),
    link(
      'Security',
      '/security',
      'EU hosting (Frankfurt), encryption, sign-in and data protection',
    ),
    link('Questions', '/faq', 'frequent questions about plans, data and switching'),
    `- [Sign up](${PLATFORM_URL}/login): sign-in by email code, Google or passkey creates the account; start on Free or with the Pro trial`,
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
