import { LanguageProvider } from '@helvetly/ui/components/language-provider'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { compareIn } from '@/lib/compare'
import { faqIn, TOPICS } from '@/lib/faq'
import { OFFER_URL } from '@/lib/offer'
import { plansIn } from '@/lib/plans'
import golden from '@/lib/public-offer.golden.json'
import { siteIn } from '@/lib/site'

import ComparePage from './[lang]/compare/[slug]/page'
import CompareIndexPage from './[lang]/compare/page'
import FaqPage from './[lang]/faq/page'
import HomePage from './[lang]/page'
import PricingPage from './[lang]/pricing/page'
import SubprocessorsPage from './[lang]/subprocessors/page'
import TermsPage from './[lang]/terms/page'

const { COMPETITORS } = compareIn('en')
const { FEATURE_GROUPS } = plansIn('en')
/** The English route: no language segment. */
const english = { params: Promise.resolve({}) }

/** Answers the API's public offer (or fails to, with offer: false) and Cloudflare's trace. */
function serve({ offer = true, trace = '' } = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    if (String(input) !== OFFER_URL) return new Response(trace)
    if (!offer) throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify({ data: { offer_id: 'helvetly-v2', ...golden } }))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

describe('home page', () => {
  beforeEach(() => serve())

  it('leads with the promise and sends the trial to the platform sign-in', async () => {
    render(await HomePage(english))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Your Swiss back office, beautifully in order.',
    )
    expect(screen.getByRole('link', { name: /Start your 7-day trial/ }).getAttribute('href')).toBe(
      'http://localhost:8000/login',
    )
  })

  it('shows Heidi’s first example answered, and another one on request', async () => {
    render(await HomePage(english))
    expect(screen.getByText('Which invoices are overdue?')).toBeTruthy()
    expect(screen.getByText(/Three invoices are overdue/)).toBeTruthy()

    await userEvent.click(screen.getByRole('tab', { name: 'Log work' }))
    expect(screen.getByRole('tab', { name: 'Log work' }).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByText(/Logged · 34.5 of 40 h used/)).toBeTruthy()
  })
})

describe('home page in German', () => {
  beforeEach(() => serve())

  it('is worded in German, links to German pages and signs in in German', async () => {
    render(
      <LanguageProvider language="de">
        {await HomePage({ params: Promise.resolve({ lang: 'de' }) })}
      </LanguageProvider>,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Ihr Schweizer Backoffice, einfach organisiert.',
    )
    expect(screen.getByRole('link', { name: /Preise ansehen/ }).getAttribute('href')).toBe(
      '/de/pricing',
    )
    expect(screen.getByRole('link', { name: /Starten Sie Ihre/ }).getAttribute('href')).toBe(
      'http://localhost:8000/login?lang=de',
    )
    const internal = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '')
      .filter((href) => href.startsWith('/'))
    expect(internal.filter((href) => !href.startsWith('/de/'))).toEqual([])
  })
})

const real = Intl.DateTimeFormat.prototype.resolvedOptions
/** The visitor's time zone, which picks the currency. */
function inZone(timeZone: string) {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...real.call(this), timeZone }
  })
}

/** The cells of a table's row, by its row header. */
const cells = (table: HTMLElement, name: string) =>
  within(within(table).getByRole('rowheader', { name }).closest('tr')!)
    .getAllByRole('cell')
    .map((c) => c.textContent)

describe('pricing page', () => {
  beforeEach(() => {
    inZone('Europe/Zurich')
    serve()
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows the same figures in the visitor’s currency', async () => {
    inZone('Europe/Berlin')
    render(await PricingPage(english))
    const pro = screen.getAllByRole('article')[1]!
    expect(within(pro).getByText('EUR')).toBeTruthy()
    expect(within(pro).getByText('EUR 471 a year, billed yearly')).toBeTruthy()
  })

  it('prefers the country Cloudflare saw to the time zone', async () => {
    serve({ trace: 'h=helvetly.com\nloc=GB\n' })
    render(await PricingPage(english))
    const pro = screen.getAllByRole('article')[1]!
    expect(await within(pro).findByText('USD 471 a year, billed yearly')).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith('/cdn-cgi/trace', expect.anything())
  })

  it('asks the API for the offer once for the cards and the table', async () => {
    const fetch = serve()
    render(await PricingPage(english))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(OFFER_URL, expect.anything()))
    expect(fetch.mock.calls.filter(([url]) => url === OFFER_URL)).toHaveLength(1)
    expect(screen.queryByText('Pricing is temporarily unavailable.')).toBeNull()
    expect(screen.getByRole('link', { name: /Choose Pro/ }).getAttribute('href')).toBe(
      'http://localhost:8000/login',
    )
  })

  it('shows no price and no checkout while the API cannot confirm the offer', async () => {
    serve({ offer: false })
    render(await PricingPage(english))
    expect(await screen.findByText('Pricing is temporarily unavailable.')).toBeTruthy()
    for (const card of screen.getAllByRole('article')) {
      expect(card.textContent).not.toMatch(/CHF|\/ person \/|billed|\b(19|49|99|183|471|951)\b/)
      expect(within(card).getByText('Price unavailable')).toBeTruthy()
    }
    for (const name of [/Choose Basic/, /Choose Pro/, /Choose Business/, /Start with Pro/])
      for (const button of screen.getAllByRole('button', { name }))
        expect(button.hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('link', { name: /Choose|Start with/ })).toBeNull()
    expect(screen.getByRole('link', { name: 'support@helvetly.com' }).getAttribute('href')).toBe(
      'mailto:support@helvetly.com',
    )

    const again = serve()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() =>
      expect(screen.queryByText('Pricing is temporarily unavailable.')).toBeNull(),
    )
    expect(again).toHaveBeenCalledExactlyOnceWith(OFFER_URL, expect.anything())
    expect(within(screen.getAllByRole('article')[1]!).getByText('39')).toBeTruthy()
  })

  it('shows yearly prices first and monthly ones on request', async () => {
    render(await PricingPage(english))
    const pro = screen.getAllByRole('article')[1]!
    expect(within(pro).getByText('39')).toBeTruthy()
    expect(within(pro).getByText('CHF 471 a year, billed yearly')).toBeTruthy()

    await userEvent.click(screen.getByRole('radio', { name: 'Monthly' }))
    expect(within(pro).getByText('49')).toBeTruthy()
    expect(within(pro).getByText('Billed monthly')).toBeTruthy()
  })

  it('compares every feature by area, with allowances in their cells', async () => {
    render(await PricingPage(english))
    const table = screen.getByRole('table', { name: 'What each plan includes' })
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(FEATURE_GROUPS.flatMap((g) => g.rows.map((r) => r.label)))
    expect(cells(table, 'Clients and contacts')).toEqual([
      '30per workspace',
      '300per workspace',
      'Unlimited',
    ])
    expect(cells(table, 'Quotes')).toEqual([
      '5per team member a month',
      '100per team member a month',
      'Unlimited',
    ])
    expect(within(table).getByRole('rowheader', { name: 'Automated actions' }).textContent).toMatch(
      /Each automatic step counts once/,
    )
    expect(cells(table, 'Heidi AI assistant')[0]).toBe('Not included')
    expect(cells(table, 'Client portal')).toEqual(['Not included', 'Not included', 'Included'])
  })

  it('lists only what a plan includes on its card', async () => {
    render(await PricingPage(english))
    expect(within(screen.getAllByRole('article')[0]!).queryByText(/not included/i)).toBeNull()
  })

  it('recommends Pro without claiming popularity', async () => {
    render(await PricingPage(english))
    expect(within(screen.getAllByRole('article')[1]!).getByText('Recommended')).toBeTruthy()
    expect(screen.queryByText(/most popular|every feature/i)).toBeNull()
  })
})

describe('comparison with Magic Heidi', () => {
  it('says where each product is ahead', async () => {
    render(await ComparePage({ params: Promise.resolve({ lang: 'en', slug: 'magic-heidi' }) }))
    const portal = screen.getByRole('rowheader', { name: 'Client portal' }).closest('tr')!
    expect(within(portal).getByText('In Business')).toBeTruthy()
    expect(within(portal).getByText('Not offered')).toBeTruthy()
    expect(screen.getByText(/as of 11 November 2026/)).toBeTruthy()
    const cost = screen
      .getByRole('rowheader', { name: 'A year for 1 and for 3 people' })
      .closest('tr')!
    expect(within(cost).getByText(/Pro CHF 471 \/ 1’413/)).toBeTruthy()
    expect(within(cost).getByText('Pro CHF 299 / 299, incl. VAT')).toBeTruthy()
  })

  it.each(COMPETITORS.map((c) => c.slug))('has a page for %s with a dated source', async (slug) => {
    render(await ComparePage({ params: Promise.resolve({ lang: 'en', slug }) }))
    const them = COMPETITORS.find((c) => c.slug === slug)!
    expect(screen.getByRole('columnheader', { name: them.name })).toBeTruthy()
    expect(
      screen.getByRole('link', { name: new URL(them.url).hostname.replace(/^www\./, '') }),
    ).toBeTruthy()
  })

  it('lists every comparison on the index and in the footer', async () => {
    render(await CompareIndexPage(english))
    for (const c of COMPETITORS)
      expect(screen.getByRole('link', { name: new RegExp(`Helvetly vs ${c.name}`) })).toBeTruthy()
  })
})

describe('legal pages', () => {
  it('render the Markdown with linked section headings', async () => {
    render(await TermsPage(english))
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of service' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: '1. Parties and scope' }).id).toBe(
      '1-parties-and-scope',
    )
    expect(
      screen.getAllByRole('link', { name: 'data processing agreement' })[0]!.getAttribute('href'),
    ).toBe('/dpa')
  })

  it('lets the keyboard scroll a wide table (WCAG 2.1.1)', async () => {
    render(await SubprocessorsPage(english))
    const table = screen.getAllByRole('table')[0]!
    const scroller = table.parentElement!
    expect(scroller.tabIndex).toBe(0)
    expect(screen.getAllByRole('region', { name: 'Table' })[0]).toBe(scroller)
  })
})

describe('questions', () => {
  beforeEach(() => serve())
  const questions = faqIn('en')

  it('answers every question on one page, grouped by topic, each with its own anchor', async () => {
    const { container } = render(await FaqPage(english))
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Getting started',
      'Prices and plans',
      'Limits and AI',
      'Swiss invoicing and VAT',
      'Data and privacy',
    ])
    expect(Object.keys(TOPICS)).toHaveLength(5)
    for (const { id, q } of questions) {
      expect(container.querySelector(`details#${id} summary`)?.textContent).toContain(q)
    }
    expect(new Set(questions.map(({ id }) => id)).size).toBe(questions.length)
    const data = JSON.parse(
      container.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}',
    )
    expect(data['@type']).toBe('FAQPage')
    expect(data.mainEntity).toHaveLength(questions.length)
    expect(data.mainEntity[3].acceptedAnswer.text).toMatch(/privacy policy and the list of/)
  })

  it.each([
    ['home', HomePage],
    ['pricing', PricingPage],
  ] as const)(
    'leads the %s page with a few questions and links to all of them',
    async (teaser, Page) => {
      render(await Page(english))
      for (const item of questions.filter((q) => q.teaser === teaser)) {
        expect(screen.getByText(item.q)).toBeTruthy()
      }
      expect(screen.queryByText(questions.find((q) => !q.teaser)?.q ?? '')).toBeNull()
      expect(
        screen
          .getByRole('link', { name: `See all ${questions.length} questions` })
          .getAttribute('href'),
      ).toBe('/faq')
    },
  )

  it('links the German teaser to the German page', async () => {
    render(
      <LanguageProvider language="de">
        {await HomePage({ params: Promise.resolve({ lang: 'de' }) })}
      </LanguageProvider>,
    )
    expect(
      screen
        .getByRole('link', { name: `Alle ${questions.length} Fragen ansehen` })
        .getAttribute('href'),
    ).toBe('/de/faq')
    const footerLinks = siteIn('de').FOOTER.flatMap(({ links }) => links)
    expect(footerLinks.find(({ label }) => label === 'Fragen')?.href).toBe('/de/faq')
  })
})
