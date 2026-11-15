import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { COMPETITORS } from '@/lib/compare'

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

  it('shows yearly prices first and monthly ones on request', async () => {
    render(<PricingPage />)
    const pro = screen.getAllByRole('article')[1]!
    expect(within(pro).getByText('471')).toBeTruthy()
    expect(within(pro).getByText('CHF 39.25 a month, billed yearly, incl. VAT')).toBeTruthy()

    await userEvent.click(screen.getByRole('radio', { name: 'Monthly' }))
    expect(within(pro).getByText('49')).toBeTruthy()
    expect(within(pro).getByText('Billed monthly, incl. VAT')).toBeTruthy()
  })

  it('compares every limit per plan', () => {
    render(<PricingPage />)
    const row = screen.getByRole('rowheader', { name: /^Clients$/ }).closest('tr')!
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['50', '1’000', 'Unlimited'])
  })
})

describe('comparison with Magic Heidi', () => {
  it('says where each product is ahead', async () => {
    render(await ComparePage({ params: Promise.resolve({ slug: 'magic-heidi' }) }))
    const portal = screen.getByRole('rowheader', { name: 'Client portal' }).closest('tr')!
    expect(within(portal).getByText('Yes')).toBeTruthy()
    expect(within(portal).getByText('Not offered')).toBeTruthy()
    expect(screen.getByText(/as of 11 November 2026/)).toBeTruthy()
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
