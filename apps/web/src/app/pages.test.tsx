import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { COMPETITORS } from '@/lib/compare'
import { BENEFITS, LIMITS, USAGE_DETAILS } from '@/lib/plans'

import LegalPage from './[legal]/page'
import ComparePage from './compare/[slug]/page'
import CompareIndexPage from './compare/page'
import HomePage from './page'
import PricingPage from './pricing/page'

describe('home page', () => {
  it('leads with the promise and sends the trial to the platform sign-in', () => {
    render(<HomePage />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Your Swiss back office, beautifully in order.',
    )
    expect(screen.getByRole('link', { name: /Start your 7-day trial/ }).getAttribute('href')).toBe(
      'http://localhost:8000/login',
    )
  })

  it('shows Heidi’s first example answered, and another one on request', async () => {
    render(<HomePage />)
    expect(screen.getByText('Which invoices are overdue?')).toBeTruthy()
    expect(screen.getByText(/Three invoices are overdue/)).toBeTruthy()

    await userEvent.click(screen.getByRole('tab', { name: 'Log work' }))
    expect(screen.getByRole('tab', { name: 'Log work' }).getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByText(/Logged · 34.5 of 40 h used/)).toBeTruthy()
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
  beforeEach(() => inZone('Europe/Zurich'))
  afterEach(() => vi.restoreAllMocks())

  it('shows the same figures in the visitor’s currency', () => {
    inZone('Europe/Berlin')
    render(<PricingPage />)
    const pro = screen.getAllByRole('article')[1]!
    expect(within(pro).getByText('EUR')).toBeTruthy()
    expect(within(pro).getByText('EUR 39.25 a month, billed yearly, incl. VAT')).toBeTruthy()
  })

  it('prefers the country Cloudflare saw to the time zone', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('h=helvetly.com\nloc=GB\n')),
    )
    render(<PricingPage />)
    const pro = screen.getAllByRole('article')[1]!
    expect(await within(pro).findByText('USD 39.25 a month, billed yearly, incl. tax')).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith('/cdn-cgi/trace', expect.anything())
    vi.unstubAllGlobals()
  })

  it('shows yearly prices first and monthly ones on request', async () => {
    render(<PricingPage />)
    const pro = screen.getAllByRole('article')[1]!
    expect(within(pro).getByText('471')).toBeTruthy()
    expect(within(pro).getByText('CHF 39.25 a month, billed yearly, incl. VAT')).toBeTruthy()

    await userEvent.click(screen.getByRole('radio', { name: 'Monthly' }))
    expect(within(pro).getByText('49')).toBeTruthy()
    expect(within(pro).getByText('Billed monthly, incl. VAT')).toBeTruthy()
  })

  it('compares the twelve benefits and the eleven allowances from lib/plans', () => {
    render(<PricingPage />)
    const benefits = screen.getByRole('table', { name: 'What each plan includes' })
    const allowances = screen.getByRole('table', { name: 'Usage allowances of each plan' })
    expect(
      within(benefits)
        .getAllByRole('rowheader')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(BENEFITS.map((b) => b.label))
    expect(
      within(allowances)
        .getAllByRole('rowheader')
        .map((r) => r.getAttribute('aria-label')),
    ).toEqual(USAGE_DETAILS.map((k) => LIMITS[k].label))
    expect(cells(allowances, 'Clients')).toEqual(['30', '300', '1’500'])
    expect(cells(allowances, 'Document storage')).toEqual(['500 MB', '5 GB', '20 GB'])
    expect(cells(benefits, 'Heidi AI assistant')[0]).toBe('Not included')
    expect(cells(benefits, 'Client portal')).toEqual(['Not included', 'Not included', 'Included'])
  })

  it('recommends Pro without claiming popularity', () => {
    render(<PricingPage />)
    expect(within(screen.getAllByRole('article')[1]!).getByText('Recommended')).toBeTruthy()
    expect(screen.queryByText(/most popular|every feature/i)).toBeNull()
  })
})

describe('comparison with Magic Heidi', () => {
  it('says where each product is ahead', async () => {
    render(await ComparePage({ params: Promise.resolve({ slug: 'magic-heidi' }) }))
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
    render(await ComparePage({ params: Promise.resolve({ slug }) }))
    const them = COMPETITORS.find((c) => c.slug === slug)!
    expect(screen.getByRole('columnheader', { name: them.name })).toBeTruthy()
    expect(
      screen.getByRole('link', { name: new URL(them.url).hostname.replace(/^www\./, '') }),
    ).toBeTruthy()
  })

  it('lists every comparison on the index and in the footer', () => {
    render(<CompareIndexPage />)
    for (const c of COMPETITORS)
      expect(screen.getByRole('link', { name: new RegExp(`Helvetly vs ${c.name}`) })).toBeTruthy()
  })
})

describe('legal pages', () => {
  it('render the Markdown with linked section headings', async () => {
    render(await LegalPage({ params: Promise.resolve({ legal: 'terms' }) }))
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of service' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: '1. Parties and scope' }).id).toBe(
      '1-parties-and-scope',
    )
    expect(
      screen.getAllByRole('link', { name: 'data processing agreement' })[0]!.getAttribute('href'),
    ).toBe('/dpa')
  })

  it('lets the keyboard scroll a wide table (WCAG 2.1.1)', async () => {
    render(await LegalPage({ params: Promise.resolve({ legal: 'subprocessors' }) }))
    const table = screen.getAllByRole('table')[0]!
    const scroller = table.parentElement!
    expect(scroller.tabIndex).toBe(0)
    expect(screen.getAllByRole('region', { name: 'Table' })[0]).toBe(scroller)
  })
})
