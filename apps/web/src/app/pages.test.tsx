import { publicHref } from '@helvetly/i18n/public-href'
import { LanguageProvider } from '@helvetly/ui/components/language-provider'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { compareIn } from '@/lib/compare'
import { faqIn, TOPICS } from '@/lib/faq'
import { translatorFor } from '@/lib/i18n'
import { OFFER_URL } from '@/lib/offer'
import { plansIn, TRIAL_DAYS } from '@/lib/plans'
import golden from '@/lib/public-offer.golden.json'
import { siteIn } from '@/lib/site'

import cs from '../messages/cs.json'
import de from '../messages/de.json'
import en from '../messages/en.json'
import fr from '../messages/fr.json'
import italian from '../messages/it.json'
import nl from '../messages/nl.json'
import sv from '../messages/sv.json'
import ComparePage from './(default)/compare/[slug]/page'
import CompareIndexPage from './(default)/compare/page'
import FaqPage from './(default)/faq/page'
import PricingPage from './(default)/pricing/page'
import SubprocessorsPage from './(default)/subprocessors/page'
import TermsPage from './(default)/terms/page'
import HomePage from './[lang]/page'

const { COMPETITORS } = compareIn('en')
/** The English route: no language segment. */
const english = { params: Promise.resolve({}) }

/** Answers the API's public offer (or fails to, with offer: false) and Cloudflare's trace. */
function serve({ offer = true, trace = '' } = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    if (String(input) !== OFFER_URL) return new Response(trace)
    if (!offer) throw new TypeError('Failed to fetch')
    return new Response(JSON.stringify({ data: { offer_id: 'helvetly-v1', ...golden } }))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => vi.unstubAllGlobals())

/** Renders a page and lets its requests (the offer, Cloudflare's trace) answer, so their updates land in the test. */
async function renderPage(page: ReactNode) {
  const view = render(page)
  await act(() => new Promise((resolve) => setTimeout(resolve)))
  return view
}

it.each(Object.entries({ en, de, fr, it: italian, nl, cs, sv }))(
  '%s marketing percentages have no preceding whitespace',
  (_, catalog) => {
    expect(Object.entries(catalog).filter(([, message]) => /\s+%/u.test(message))).toEqual([])
  },
)

describe('home page', () => {
  beforeEach(() => serve())

  it('leads with the promise and sends the trial to the platform sign-in', async () => {
    await renderPage(await HomePage(english))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Your back office, Swiss quality.',
    )
    expect(screen.getByText(/Built around the needs of Swiss small businesses/)).toBeTruthy()
    expect(
      screen.getByText(
        /Switzerland is our first market\. We plan to expand into the rest of Europe, then the US and other markets worldwide\./,
      ),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('link', { name: new RegExp(`Start your ${TRIAL_DAYS}-day Pro trial`) })
        .getAttribute('href'),
    ).toBe('http://localhost:8000/login')
  })

  it('shows Heidi’s first example answered, and another one on request', async () => {
    await renderPage(await HomePage(english))
    expect(screen.getByText('Which invoices are overdue?')).toBeTruthy()
    expect(screen.getByText(/Three invoices are overdue/)).toBeTruthy()

    await userEvent.click(screen.getByRole('tab', { name: 'Log work' }))
    expect(screen.getByRole('tab', { name: 'Log work' }).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByText(/Logged · 34.5 of 40 h used/)).toBeTruthy()
  })

  it.each(['en', 'de', 'fr', 'it', 'nl', 'cs', 'sv'] as const)(
    'describes the whole back office and its offers in %s structured data',
    async (lang) => {
      const translate = translatorFor(lang)
      const page = await HomePage({ params: Promise.resolve({ lang }) })
      const { container } = await renderPage(page)
      expect(
        screen.getByRole('heading', { level: 2, name: translate('whatIsHelvetly') }),
      ).toBeTruthy()
      const data = JSON.parse(
        container.querySelector('script[type="application/ld+json"]')?.textContent ?? '{}',
      )
      const app = data['@graph'].find(
        (node: { '@type': string }) => node['@type'] === 'SoftwareApplication',
      )
      expect(app.description).toBe(translate('whatIsHelvetlyAnswer'))
      expect(app.featureList).toContain(translate('employeesAndPayrollRegister'))
      expect(app.featureList).toContain(translate('featureGroupBooks'))
      expect(app.publisher).toEqual({ '@id': 'https://www.helvetly.com/#organization' })
      expect(data['@graph']).toContainEqual(
        expect.objectContaining({
          '@type': 'WebSite',
          name: 'Helvetly',
          inLanguage: ['de-CH', 'en-GB', 'fr-CH', 'it-CH', 'nl-NL', 'cs-CZ', 'sv-SE'],
        }),
      )
      expect(
        app.offers.map((offer: { name: string; price: number }) => [offer.name, offer.price]),
      ).toEqual(plansIn(lang).PLANS.map((plan) => [plan.name, plan.monthly]))
      expect(app.offers[0]).toMatchObject({ price: 0, priceSpecification: { price: 0 } })
    },
  )
})

describe('home page in German', () => {
  beforeEach(() => serve())

  it('is worded in German, links to German pages and signs in in German', async () => {
    await renderPage(
      <LanguageProvider language="de">
        {await HomePage({ params: Promise.resolve({ lang: 'de' }) })}
      </LanguageProvider>,
    )
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Ihr Backoffice, Schweizer Qualität.',
    )
    expect(screen.getByRole('link', { name: /Preise ansehen/ }).getAttribute('href')).toBe(
      '/de/preise',
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

describe.each(['fr', 'it', 'nl', 'cs', 'sv'] as const)('home page in %s', (language) => {
  beforeEach(() => serve())

  it('is worded in the language, links to its pages and hands the language to sign-in', async () => {
    const translate = translatorFor(language)
    const inEnglish = translatorFor('en')
    await renderPage(
      <LanguageProvider language={language}>
        {await HomePage({ params: Promise.resolve({ lang: language }) })}
      </LanguageProvider>,
    )
    const title = screen.getByRole('heading', { level: 1 }).textContent
    expect(title).toBe(
      translate('yourSwissBackOffice') + translate('beautifully') + translate('inOrder'),
    )
    expect(title).not.toBe(
      inEnglish('yourSwissBackOffice') + inEnglish('beautifully') + inEnglish('inOrder'),
    )
    expect(screen.getByRole('link', { name: translate('seePricing') }).getAttribute('href')).toBe(
      publicHref('/pricing', language),
    )
    const anchors = screen.getAllByRole('link')
    const trial = anchors.find((link) => link.textContent?.includes(translate('startYour').trim()))
    expect(trial?.getAttribute('href')).toBe(`http://localhost:8000/login?lang=${language}`)
    const internal = anchors
      .map((link) => link.getAttribute('href') ?? '')
      .filter((href) => href.startsWith('/'))
    expect(internal.filter((href) => !href.startsWith(`/${language}/`))).toEqual([])
    const faq = siteIn(language)
      .FOOTER.flatMap(({ links }) => links)
      .find(({ href }) => href === publicHref('/faq', language))
    expect(faq?.label).toBe(translate('questions'))
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

/** The plans in order: Free's row under the cards, then the cards Basic, Pro, Business. */
const card = (index: number) =>
  index === 0
    ? document.querySelector<HTMLElement>('[data-slot="free-plan"]')!
    : screen.getAllByRole('article')[index - 1]!

describe('pricing page', () => {
  beforeEach(() => {
    inZone('Europe/Zurich')
    serve()
    window.history.replaceState(null, '', '/')
    sessionStorage.clear()
  })
  afterEach(() => vi.restoreAllMocks())

  describe.each(['en', 'de', 'fr', 'it', 'nl', 'cs', 'sv'] as const)(
    '%s yearly pricing',
    (language) => {
      it.each([
        ['home', HomePage],
        ['pricing', PricingPage],
      ] as const)('names each year’s price and keeps percentages joined on %s', async (_, Page) => {
        const { container } = await renderPage(
          <LanguageProvider language={language}>
            {await Page({ params: Promise.resolve({ lang: language }) })}
          </LanguageProvider>,
        )
        await waitFor(() => expect(fetch).toHaveBeenCalledWith(OFFER_URL, expect.anything()))
        expect(container.textContent?.match(/\S*\s+%/gu) ?? []).toEqual([])
        expect(container.textContent).toContain('20%')
        for (const [index, amount] of ['CHF 183', 'CHF 471', 'CHF 1’431'].entries())
          expect(card(index + 1).textContent?.replaceAll("'", '’')).toContain(amount)
      })
    },
  )

  it('shows the same figures in the visitor’s currency', async () => {
    inZone('Europe/Berlin')
    await renderPage(await PricingPage(english))
    expect(within(card(2)).getByText('EUR')).toBeTruthy()
    expect(within(card(2)).getByText('EUR 471 / year')).toBeTruthy()
  })

  it('prefers the country Cloudflare saw to the time zone', async () => {
    serve({ trace: 'h=helvetly.com\nloc=GB\n' })
    await renderPage(await PricingPage(english))
    expect(await within(card(2)).findByText('USD 471 / year')).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith('/cdn-cgi/trace', expect.anything())
  })

  it('asks the API for the offer once for the cards and the table', async () => {
    const fetch = serve()
    await renderPage(await PricingPage(english))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(OFFER_URL, expect.anything()))
    expect(fetch.mock.calls.filter(([url]) => url === OFFER_URL)).toHaveLength(1)
    expect(screen.queryByText('Pricing is temporarily unavailable.')).toBeNull()
    expect(
      within(card(1))
        .getByRole('link', { name: /Choose Basic/ })
        .getAttribute('href'),
    ).toBe('http://localhost:8000/login')
    expect(within(card(2)).getByRole('link', { name: /Try Pro free for 14 days/ })).toBeTruthy()
  })

  it('shows no paid price and no checkout while the API cannot confirm the offer', async () => {
    serve({ offer: false })
    await renderPage(await PricingPage(english))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Pricing is temporarily unavailable.')).toBeTruthy()
    expect(within(alert).getByRole('button', { name: 'Retry' }).getAttribute('aria-busy')).toBe(
      'false',
    )
    for (const index of [1, 2, 3]) {
      expect(card(index).textContent).not.toMatch(/CHF|billed|\b(19|49|149|183|471)\b/i)
      expect(within(card(index)).getByText('Price unavailable')).toBeTruthy()
    }
    for (const name of [/Choose Basic/, /Try Pro free/, /Choose Business/])
      for (const button of screen.getAllByRole('button', { name }))
        expect(button.hasAttribute('disabled')).toBe(true)
    expect(
      screen.queryByRole('link', { name: /Choose (Basic|Business)|Try Pro free for/ }),
    ).toBeNull()
    // Free costs nothing to confirm.
    expect(within(card(0)).getByRole('link', { name: /Start free/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'support@helvetly.com' }).getAttribute('href')).toBe(
      'mailto:support@helvetly.com',
    )

    const answered = Promise.withResolvers<void>()
    const again = vi.fn<typeof globalThis.fetch>(async (input) => {
      await answered.promise
      return String(input) === OFFER_URL
        ? new Response(JSON.stringify({ data: { offer_id: 'helvetly-v1', ...golden } }))
        : new Response('')
    })
    vi.stubGlobal('fetch', again)
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    const checking = await within(alert).findByRole('button', { name: 'Checking…' })
    expect(checking.hasAttribute('disabled')).toBe(true)
    expect(checking.getAttribute('aria-busy')).toBe('true')
    answered.resolve()
    await waitFor(() =>
      expect(screen.queryByText('Pricing is temporarily unavailable.')).toBeNull(),
    )
    expect(again).toHaveBeenCalledExactlyOnceWith(OFFER_URL, expect.anything())
    expect(within(card(2)).getByText('39.25')).toBeTruthy()
  })

  it('shows yearly prices first, monthly ones on request, and keeps the choice in the address', async () => {
    await renderPage(await PricingPage(english))
    const pro = card(2)
    expect(within(pro).getByText('39.25')).toBeTruthy()
    expect(pro).toHaveTextContent('2 people incl. · +CHF 15 / person')
    expect(pro).toHaveTextContent('CHF 471 / year · save CHF 117')
    expect(screen.getByText('Save 20% — CHF 45 a year on Basic')).toBeTruthy()

    await userEvent.click(screen.getByRole('radio', { name: 'Monthly' }))
    expect(within(pro).getByText('49')).toBeTruthy()
    expect(pro).toHaveTextContent('2 people incl. · +CHF 15 / person')
    expect(pro).toHaveTextContent('Billed monthly')
    expect(window.location.search).toBe('?billing=monthly')
    // Free is a small, inviting row under the three paid cards, with three facts and no limits block.
    expect(screen.getAllByRole('article').map((a) => a.dataset.plan)).toEqual([
      'basic',
      'pro',
      'business',
    ])
    const free = card(0)
    expect(within(free).getByRole('heading', { name: 'Just starting? Start free.' })).toBeTruthy()
    expect(within(free).getByText('CHF 0 forever · 1 person · no card needed')).toBeTruthy()
    expect(within(free).getByRole('link', { name: 'Start free' })).toBeTruthy()
    expect(
      within(within(free).getByRole('list', { name: 'What Free includes' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['3 invoices & 3 quotes / month', 'Swiss QR bills', '5 clients'])
    expect(within(free).queryByRole('definition')).toBeNull()
  })

  it('compares every feature by group, with allowances in words', async () => {
    await renderPage(await PricingPage(english))
    const table = screen.getByRole('table', { name: 'Compare every feature' })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .slice(0, 5)
        .map((h) => h.textContent),
    ).toEqual([
      'Features',
      expect.stringMatching(/^FreeCHF 0/),
      expect.stringMatching(/^BasicCHF 15.25/),
      expect.stringMatching(/^ProCHF 39.25/),
      expect.stringMatching(/^BusinessCHF 119.25/),
    ])
    expect(cells(table, 'Clients')).toEqual(['5', '30', '300', 'Unlimited'])
    expect(cells(table, 'Quotes')).toEqual(['3 / month', '5 / month', '100 / month', 'Unlimited'])
    expect(cells(table, 'Heidi, your AI assistant')[1]).toBe('Not included')
    expect(cells(table, 'White-labelled client portal on your own domain')).toEqual([
      'Not included',
      'Not included',
      'Not included',
      'Included',
    ])
    expect(table.textContent).not.toContain('∞')
  })

  it('keeps each card compact: five features, three stats, short price lines, no limits table', async () => {
    await renderPage(await PricingPage(english))
    for (const index of [1, 2, 3]) {
      const article = card(index)
      const features = article.querySelector('[data-slot="plan-features"]')!
      expect(within(features as HTMLElement).getAllByRole('listitem').length).toBeLessThanOrEqual(5)
      const stats = article.querySelector('[data-slot="plan-stats"]')!.textContent!.split(' · ')
      expect(stats.length).toBeLessThanOrEqual(3)
      expect(article.querySelector('dl')).toBeNull()
      for (const line of article.querySelectorAll('[data-slot="plan-price-terms"] p'))
        expect(line.textContent!.length).toBeLessThanOrEqual(38)
    }
    expect(within(card(1)).getByText('Up to 5 people')).toBeTruthy()
    const stats = (index: number) => card(index).querySelector('[data-slot="plan-stats"]')
    expect(stats(1)).toHaveTextContent('15 invoices / mo · 30 clients · 500 MB')
    expect(within(card(2)).getByText('AI import & smart capture')).toBeTruthy()
    expect(within(card(3)).getByText('Everything in Pro')).toBeTruthy()
    expect(within(card(3)).getByText('Approvals')).toBeTruthy()
    expect(stats(3)?.textContent).toMatch(/^Unlimited invoices · Unlimited clients · \d+ GB$/)
    expect(screen.getByRole('link', { name: 'Compare all features' }).getAttribute('href')).toBe(
      '/pricing#compare-plans',
    )
  })

  it('recommends Pro without claiming popularity', async () => {
    await renderPage(await PricingPage(english))
    expect(within(card(2)).getByText('Recommended')).toBeTruthy()
    expect(screen.queryByText(/most popular|every feature in every plan/i)).toBeNull()
  })
})

describe('comparison with Magic Heidi', () => {
  beforeEach(() => serve())

  it('says where each product is ahead, in short cells with the detail behind a (?)', async () => {
    await renderPage(
      await ComparePage({ params: Promise.resolve({ lang: 'en', slug: 'magic-heidi' }) }),
    )
    const portal = screen.getByRole('rowheader', { name: 'Client portal' }).closest('tr')!
    expect(within(portal).getByText('Yes')).toBeTruthy()
    expect(within(portal).getByText('Not offered')).toBeTruthy()
    expect(within(portal).getByRole('button', { name: 'About: Client portal' })).toBeTruthy()
    const sessions = screen
      .getByRole('rowheader', { name: 'Client sessions and booking' })
      .closest('tr')!
    expect(within(sessions).getByText('Not compared')).toBeTruthy()
    expect(sessions.dataset.win).toBeUndefined()
    const features = within(portal.closest('table')!)
    expect(
      features
        .getAllByRole('rowheader')
        .slice(0, 2)
        .map((row) => row.textContent),
    ).toEqual(['What Helvetly includes', 'Swiss QR bill'])
    expect(features.queryByText(/CHF/)).toBeNull()
    expect(portal.dataset.win).toBe('true')
    const feeds = screen.getByRole('rowheader', { name: 'Bank feeds' }).closest('tr')!
    expect(feeds.dataset.win).toBeUndefined()
    expect(screen.getByText(/as of 11 November 2026/)).toBeTruthy()
  })

  it('prices a year for 1, 3 and 5 people side by side', async () => {
    await renderPage(
      await ComparePage({ params: Promise.resolve({ lang: 'en', slug: 'magic-heidi' }) }),
    )
    const year = screen.getByRole('table', { name: 'A year by team size' })
    const pro = within(year).getByRole('rowheader', { name: 'Helvetly Pro' }).closest('tr')!
    expect(
      within(pro)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['CHF 471', 'CHF 615', 'CHF 903'])
    const theirs = within(year)
      .getByRole('rowheader', { name: /^Magic Heidi Pro/ })
      .closest('tr')!
    expect(within(theirs).getAllByText('CHF 299')).toHaveLength(3)
  })

  it('shows the cost for a team apart, with their prices as published', async () => {
    serve({ trace: 'loc=CH' })
    await renderPage(await ComparePage({ params: Promise.resolve({ lang: 'en', slug: 'bexio' }) }))
    expect(screen.getByRole('heading', { name: 'What it costs for your team' })).toBeTruthy()
    expect(screen.getByText('Team of 3 people')).toBeTruthy()
    const pro = document.querySelector('[data-plan="pro"]')!
    expect(pro).toHaveTextContent('CHF 615 / year')
    expect(pro).toHaveTextContent('+CHF 15 / person')
    expect(pro).toHaveTextContent('Billed yearly −20% · save CHF 153')
    expect(screen.getByText(/Advanced CHF 504/)).toBeTruthy()
    expect(screen.getByText(/As published on 15 November 2026/)).toBeTruthy()
    await userEvent.click(screen.getByRole('radio', { name: 'Monthly' }))
    expect(pro).toHaveTextContent('CHF 64 / month')
    const payroll = screen.getByRole('rowheader', { name: 'Employees and payroll' })
    expect(within(payroll.closest('tr')!).getByText('Payroll as an add-on')).toBeTruthy()
  })

  it.each(COMPETITORS.map((c) => c.slug))('has a page for %s with a dated source', async (slug) => {
    await renderPage(await ComparePage({ params: Promise.resolve({ lang: 'en', slug }) }))
    const them = COMPETITORS.find((c) => c.slug === slug)!
    expect(screen.getAllByRole('columnheader', { name: them.name })).toHaveLength(2)
    // The table's sources and the prices' source.
    expect(
      screen.getAllByRole('link', { name: new URL(them.url).hostname.replace(/^www\./, '') }),
    ).toHaveLength(2)
  })

  it('lists every comparison on the index and in the footer', async () => {
    await renderPage(await CompareIndexPage(english))
    for (const c of COMPETITORS)
      expect(screen.getByRole('link', { name: new RegExp(`Helvetly vs ${c.name}`) })).toBeTruthy()
  })
})

describe('legal pages', () => {
  it('render the Markdown with linked section headings', async () => {
    await renderPage(await TermsPage(english))
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of service' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: '1. Parties and scope' }).id).toBe(
      '1-parties-and-scope',
    )
    expect(
      screen.getAllByRole('link', { name: 'data processing agreement' })[0]!.getAttribute('href'),
    ).toBe('/dpa')
  })

  it('lets the keyboard scroll a wide table (WCAG 2.1.1)', async () => {
    await renderPage(await SubprocessorsPage(english))
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
    const { container } = await renderPage(await FaqPage(english))
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
      await renderPage(await Page(english))
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
    await renderPage(
      <LanguageProvider language="de">
        {await HomePage({ params: Promise.resolve({ lang: 'de' }) })}
      </LanguageProvider>,
    )
    expect(
      screen
        .getByRole('link', { name: `Alle ${questions.length} Fragen ansehen` })
        .getAttribute('href'),
    ).toBe('/de/haeufige-fragen')
    const footerLinks = siteIn('de').FOOTER.flatMap(({ links }) => links)
    expect(footerLinks.find(({ label }) => label === 'Fragen')?.href).toBe('/de/haeufige-fragen')
  })
})
