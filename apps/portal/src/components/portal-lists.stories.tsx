import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import {
  portalDocuments,
  portalEngagementHistory,
  portalEngagements,
  portalHandlers,
  portalSignatures,
} from '@/mocks/portal'

import { PortalDocuments } from './portal-documents'
import { PortalEngagements } from './portal-engagements'

const meta = {
  title: 'Portal/Lists',
  parameters: { msw: { handlers: portalHandlers } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const P = '/api/v1/public/portal'
const engagements = (data: unknown) => ({
  msw: {
    handlers: [http.get(`${P}/engagements`, () => HttpResponse.json({ data })), ...portalHandlers],
  },
})
type Resolver = Parameters<typeof http.get>[1]
const noSignatures: Resolver = () => HttpResponse.json({ data: [] })
const documents = (response: Resolver, signatures = noSignatures) => ({
  msw: {
    handlers: [
      http.get(`${P}/documents`, response),
      http.get(`${P}/signatures`, signatures),
      ...portalHandlers,
    ],
  },
})
const retainer = portalEngagements[0]

/** Active and Past tabs with counts; each engagement a compact row with its numbers on the right. */
export const Engagements: Story = {
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Support retainer')).toBeVisible()
    await expect(canvas.getByRole('tab', { name: 'Active 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(canvas.getByRole('tab', { name: 'Past 1' })).toBeVisible()
    await expect(canvas.getByText('Website maintenance')).toBeVisible()
    await expect(canvas.queryByText('Office move')).toBeNull()
    await expect(canvas.getAllByText(/10 hours per month/)[0]).toBeVisible()
    await expect(canvas.getAllByRole('progressbar')).toHaveLength(2)
    await expect(canvas.getByText(/Overage 1\.5 hours/)).toBeVisible()
    await expect(canvas.getAllByText(/days? left|Last day/)).toHaveLength(2)
  },
}

export const EngagementsDark: Story = { ...Engagements, parameters: { dark: true } }

/** A row is compact: name and numbers on one line, the agreement and period on the next, a thin bar. */
export const EngagementRowCompact: Story = {
  parameters: engagements([retainer]),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Support retainer')).toBeVisible()
    await expect(canvas.getByRole('progressbar')).toHaveAccessibleName('4 of 10 hours used')
    await expect(canvas.getByText('4 / 10 h')).toBeVisible()
    await expect(canvas.getByText('· 40%')).toBeVisible()
    await expect(canvas.queryByText(/Overage/)).toBeNull()
    const row = canvas.getByRole('listitem')
    await expect(row.getBoundingClientRect().height).toBeLessThan(110)
  },
}

/** One unit, one hour; several, hours: never "10 hour". */
export const EngagementUnitsPlural: Story = {
  parameters: engagements([
    {
      ...retainer,
      quantity: '1',
      current_period: { ...retainer?.current_period, used: '1', remaining: '0', overage: '0' },
    },
  ]),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(/^1 hour per month/)).toBeVisible()
    await expect(canvas.getByRole('progressbar')).toHaveAccessibleName('1 of 1 hour used')
  },
}

export const EngagementOverage: Story = {
  parameters: engagements([
    {
      ...retainer,
      current_period: { ...retainer?.current_period, used: '12', remaining: '0', overage: '2' },
    },
  ]),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(/Overage 2 hours/)).toBeVisible()
    await expect(canvas.getByRole('progressbar')).toHaveAccessibleName('12 of 10 hours used')
    await expect(canvasElement.querySelector('[data-part=overage]')).not.toBeNull()
  },
}

export const EngagementWithoutPeriod: Story = {
  parameters: engagements([
    { ...retainer, recurrence: 'none', status: 'active', current_period: null },
  ]),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(/No period is running right now\./)).toBeVisible()
    await expect(canvas.getByText(/10 hours in total/)).toBeVisible()
    await expect(canvas.queryByRole('progressbar')).toBeNull()
  },
}

/** Past: ended, cancelled, expired and used-up engagements, each saying why, below their own tab. */
export const EngagementsPast: Story = {
  parameters: engagements([
    retainer,
    ...(['ended', 'cancelled', 'expired', 'used_up'] as const).map((status, index) => ({
      ...retainer,
      id: `eng_p${index}`,
      name: `Past ${status}`,
      status,
    })),
  ]),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('tab', { name: 'Past 4' }))
    const reasons = {
      ended: 'Ended',
      cancelled: 'Cancelled',
      expired: 'Expired',
      used_up: 'Fully used',
    }
    for (const [status, badge] of Object.entries(reasons)) {
      const row = canvas.getByText(`Past ${status}`).closest('li')
      expect(row && within(row).getByText(badge)).toBeVisible()
    }
    // A past engagement does not count down days.
    await expect(canvas.queryByText(/days? left/)).toBeNull()
    await expect(canvas.queryByText('Support retainer')).toBeNull()
  },
}

/** Nothing past yet: the Past tab says what will show there. */
export const EngagementsPastEmpty: Story = {
  parameters: engagements([retainer]),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('tab', { name: 'Past 0' }))
    await expect(await canvas.findByText('No past engagements')).toBeVisible()
  },
}

/** A link to `/engagements#eng_2` (from the overview's usage card) opens that engagement's details. */
export const EngagementDeepLink: Story = {
  beforeEach: () => {
    window.history.replaceState(null, '', '#eng_2')
    return () => window.history.replaceState(null, '', window.location.pathname)
  },
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const region = await canvas.findByRole('region', { name: 'Website maintenance' })
    await expect(region).toBeVisible()
    await expect(canvas.queryByRole('region', { name: 'Support retainer' })).toBeNull()
  },
}

/** A deep link to a past engagement opens the Past tab on it. */
export const EngagementDeepLinkPast: Story = {
  beforeEach: () => {
    window.history.replaceState(null, '', '#eng_3')
    return () => window.history.replaceState(null, '', window.location.pathname)
  },
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('region', { name: 'Office move' })).toBeVisible()
    await expect(canvas.getByRole('tab', { name: 'Past 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  },
}

// The history's dates are fixed, so its current period is too, whatever day the story runs on.
const novemberRetainer = retainer && {
  ...retainer,
  current_period: retainer.current_period && {
    ...retainer.current_period,
    starts_on: '2026-11-01',
    ends_on: '2026-11-30',
  },
}
/** One engagement whose history answers with response. */
const withHistory = (response: Parameters<typeof http.get>[1]) => ({
  msw: {
    handlers: [
      http.get(`${P}/engagements`, () => HttpResponse.json({ data: [novemberRetainer] })),
      http.get(`${P}/engagements/:id/entries`, response),
      ...portalHandlers,
    ],
  },
})
const phone = {
  viewport: { options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } } },
}
const openActivity = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement)
  const details = await canvas.findByRole('button', { name: 'Details' })
  await userEvent.click(details)
  // The baseline shows the opened list at rest, without the click's hover tint or focus ring.
  await userEvent.unhover(details)
  details.blur()
  return canvas
}

/**
 * Details opens the activity inside the row's card. Its panel is headed "<name> · this period", each day once with its
 * total on the right and its entries as compact rows: a note, a note with "For you", only "For you", or neither
 * ("Work logged"). The arrows step to earlier periods and back.
 */
export const EngagementActivity: Story = {
  parameters: withHistory(() => HttpResponse.json({ data: portalEngagementHistory })),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const details = await canvas.findByRole('button', { name: 'Details' })
    await expect(details).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByRole('region')).toBeNull()

    // A click anywhere on the row opens it, not only on the button: the button covers the row.
    const text = canvas.getByText(/10 hours per month/).getBoundingClientRect()
    const hit = document.elementFromPoint(text.left + 4, text.top + text.height / 2)
    await expect(hit).toBe(details)
    await userEvent.click(details)
    await expect(details).toHaveAttribute('aria-expanded', 'true')
    const region = await canvas.findByRole('region', { name: 'Support retainer' })
    await expect(details).toHaveAttribute('aria-controls', region.id)

    // This period: no second bar, the row above has it.
    const current = await within(region).findByRole('region', {
      name: 'Support retainer · this period',
    })
    await expect(within(current).queryByRole('progressbar')).toBeNull()
    const days = within(current).getAllByRole('time')
    await expect(days.map((day) => day.textContent)).toEqual([
      'Wed 18 Nov',
      'Wed 11 Nov',
      'Wed 4 Nov',
    ])
    await expect(days[0]?.parentElement).toHaveTextContent('2 h on this day')
    await expect(days[1]?.parentElement).toHaveTextContent('3 h on this day')
    const day = (index: number) =>
      within(days[index]?.closest('li') ?? current).getAllByRole('listitem')
    // Note + For you, and a note alone.
    const [both, noteOnly] = day(0)
    await expect(both).toHaveTextContent('Server updates and backup check')
    await expect(both).toHaveTextContent('For you: Quick answers, access ready on time')
    await expect(both).toHaveTextContent('1.5 h')
    await expect(noteOnly).toHaveTextContent('Printer set up at reception')
    await expect(noteOnly).not.toHaveTextContent('For you')
    // Only For you: no placeholder above it.
    const [, forYouOnly] = day(1)
    await expect(forYouOnly).toHaveTextContent('For you: Thank you for the quick answers')
    await expect(forYouOnly).not.toHaveTextContent('Work logged')
    // Neither: a calm "Work logged".
    const [neither] = day(2)
    await expect(neither).toHaveTextContent('Work logged')
    await expect(neither).toHaveTextContent('0.5 h')

    // Earlier periods, one step at a time, each headed with its dates and total.
    const later = within(region).getByRole('button', { name: 'Later period' })
    await expect(later).toBeDisabled()
    await userEvent.click(within(region).getByRole('button', { name: 'Earlier period' }))
    const october = await within(region).findByRole('region', {
      name: /^Support retainer · 1\s–\s31 Oct 2026$/,
    })
    await expect(october).toHaveTextContent('3 / 10 h')
    await expect(october).toHaveTextContent('Onboarding of two new staff')
    await expect(october).toHaveTextContent('For you: Well prepared')
    await userEvent.click(within(region).getByRole('button', { name: 'Earlier period' }))
    await expect(await within(region).findByText('Nothing logged in this period.')).toBeVisible()
    await expect(within(region).getByRole('button', { name: 'Earlier period' })).toBeDisabled()
    await userEvent.click(within(region).getByRole('button', { name: 'Later period' }))
    await userEvent.click(within(region).getByRole('button', { name: 'Later period' }))
    await within(region).findByRole('region', { name: 'Support retainer · this period' })

    await userEvent.click(details)
    await expect(details).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByRole('region')).toBeNull()
    await userEvent.click(details)
    await canvas.findByRole('region', { name: 'Support retainer' })
    await userEvent.unhover(details)
    details.blur()
  },
}

export const EngagementActivityDark: Story = {
  ...EngagementActivity,
  parameters: { ...EngagementActivity.parameters, dark: true },
}

/** Several entries on one day line up: one date with the day's total, quantities in one right-aligned column. */
export const EngagementDaySeveralEntries: Story = {
  parameters: withHistory(() =>
    HttpResponse.json({
      data: [
        {
          starts_on: '2026-11-01',
          ends_on: '2026-11-30',
          entries: [
            { id: 'a', date: '2026-11-19', quantity: '2', note: 's', client_performance: null },
            { id: 'b', date: '2026-11-19', quantity: '5', note: null, client_performance: null },
            { id: 'c', date: '2026-11-19', quantity: '2', note: 'iiii', client_performance: null },
          ],
        },
      ],
    }),
  ),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = await openActivity(canvasElement)
    const date = await canvas.findByRole('time')
    await expect(date).toHaveTextContent('Thu 19 Nov')
    await expect(date.parentElement).toHaveTextContent('9 h on this day')
    const rows = within(date.closest('li') ?? canvasElement).getAllByRole('listitem')
    await expect(rows.map((row) => row.textContent)).toEqual(['s2 h', 'Work logged5 h', 'iiii2 h'])
    const rights = rows.map((row) =>
      Math.round(row.lastElementChild?.getBoundingClientRect().right ?? 0),
    )
    await expect(new Set(rights).size).toBe(1)
    await expect(canvas.queryByRole('button', { name: 'Earlier period' })).toBeNull()
  },
}

/**
 * A click anywhere on the row (its text, its bar) opens the details inside the same card, marked open, and closes them
 * again; the keyboard opens them with Enter or Space on Details.
 */
export const EngagementRowToggle: Story = {
  parameters: withHistory(() => HttpResponse.json({ data: portalEngagementHistory })),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const details = await canvas.findByRole('button', { name: 'Details' })
    const card = canvasElement.querySelector<HTMLElement>(`li[id="${novemberRetainer?.id}"]`)!
    await expect(card).not.toHaveAttribute('data-open')
    // The bar is drawn above the row: a click on it still reaches the toggle.
    const bar = card.querySelector('[data-slot="meter"]')!.getBoundingClientRect()
    await expect(document.elementFromPoint(bar.left + bar.width / 2, bar.top + 1)).toBe(details)
    // What a pointer on the row's text hits: the toggle, not the text under it.
    const onText = () => {
      const text = canvas.getByText(/10 hours per month/).getBoundingClientRect()
      return document.elementFromPoint(text.left + 4, text.top + text.height / 2)!
    }
    await userEvent.click(onText())
    await expect(details).toHaveAttribute('aria-expanded', 'true')
    await expect(card).toHaveAttribute('data-open', 'true')
    const panel = await canvas.findByRole('region', { name: 'Support retainer' })
    await expect(panel).toHaveAttribute('data-engagement-details', novemberRetainer?.id)
    await expect(card.contains(panel)).toBe(true)
    await userEvent.click(onText())
    await expect(details).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByRole('region', { name: 'Support retainer' })).toBeNull()

    details.focus()
    await userEvent.keyboard('{Enter}')
    await expect(details).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard(' ')
    await expect(details).toHaveAttribute('aria-expanded', 'false')
    await userEvent.keyboard(' ')
    await expect(await canvas.findByRole('region', { name: 'Support retainer' })).toBeVisible()
    details.blur()
  },
}

/** Each row opens on its own: both can be open at once, and closing one leaves the other open. */
export const EngagementsSeveralOpen: Story = {
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('Support retainer')
    const [first, second] = canvas.getAllByRole('button', { name: 'Details' })
    if (!first || !second) throw new Error('Two engagements expected')
    await userEvent.click(first)
    await userEvent.click(second)
    const cards = () =>
      canvas.queryAllByRole('region', { name: /^(Support retainer|Website maintenance)$/ })
    await waitFor(() => expect(cards()).toHaveLength(2))
    await userEvent.click(first)
    await expect(first).toHaveAttribute('aria-expanded', 'false')
    await expect(second).toHaveAttribute('aria-expanded', 'true')
    await expect(cards()).toHaveLength(1)
  },
}

const long = 'Long session covering the yearly closing, '.repeat(8).trim()
/** A long note and "For you" wrap inside the row and never push the page sideways on a phone. */
export const EngagementActivityLongTextPhone: Story = {
  parameters: {
    ...phone,
    ...withHistory(() =>
      HttpResponse.json({
        data: [
          {
            starts_on: '2026-11-01',
            ends_on: '2026-11-30',
            entries: [
              {
                id: 'ent_l',
                date: '2026-11-18',
                quantity: '12.25',
                note: long,
                client_performance: long,
              },
            ],
          },
        ],
      }),
    ),
  },
  globals: { viewport: { value: 'phone' } },
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = await openActivity(canvasElement)
    await expect(await canvas.findByText('12.25 h')).toBeVisible()
    await expect(canvas.getByText('For you')).toBeVisible()
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth),
    )
  },
}

export const EngagementActivityEmpty: Story = {
  parameters: withHistory(() => HttpResponse.json({ data: [] })),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = await openActivity(canvasElement)
    await expect(await canvas.findByText('Nothing logged yet.')).toBeVisible()
    await expect(canvas.getByRole('region').querySelector('ol')).toBeNull()
  },
}

let activityCalls = 0
/** The activity failing to load says so inside the row; Try again asks once more and shows it. */
export const EngagementActivityError: Story = {
  parameters: withHistory(() =>
    ++activityCalls === 1
      ? HttpResponse.json({}, { status: 500 })
      : HttpResponse.json({ data: portalEngagementHistory }),
  ),
  beforeEach: () => {
    activityCalls = 0
  },
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = await openActivity(canvasElement)
    await expect(await canvas.findByRole('alert')).toHaveTextContent(
      'The history couldn’t be loaded',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await expect(await canvas.findByText('Mailbox migration')).toBeVisible()
  },
}

export const EngagementsEmpty: Story = {
  parameters: engagements([]),
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('No active engagements')).toBeVisible()
    await expect(canvas.getByRole('tab', { name: 'Active 0' })).toBeVisible()
  },
}

export const EngagementsError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(`${P}/engagements`, () => HttpResponse.json({}, { status: 500 })),
        ...portalHandlers,
      ],
    },
  },
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('alert')).toBeVisible()
    await userEvent.hover(canvas.getByRole('button', { name: 'Try again' }))
  },
}

export const EngagementsLoading: Story = {
  parameters: {
    msw: {
      handlers: [http.get(`${P}/engagements`, () => new Promise(() => {})), ...portalHandlers],
    },
  },
  render: () => <PortalEngagements />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getAllByRole('status', { name: 'Loading' })[0]).toBeVisible(),
    )
  },
}

export const Documents: Story = {
  render: () => <PortalDocuments />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Contract.pdf')).toBeVisible()
    await expect(canvas.getByText(/Shared 2 days ago/)).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Download Contract.pdf' })).toHaveAttribute(
      'href',
      '/api/v1/public/portal/documents/doc_1/download',
    )
    // A sent quote is one of the documents, named by its number and revision, with no answer to give.
    const quote = `Quote Q-${new Date().getFullYear()}-002 · Rev. 2`
    await expect(canvas.getByText(quote)).toBeVisible()
    await expect(canvas.getByRole('link', { name: `Download ${quote}` })).toHaveAttribute(
      'href',
      '/api/v1/public/portal/documents/doc_5/download',
    )
    await expect(canvas.queryByRole('button', { name: /Accept|Decline/ })).toBeNull()
    // Five documents: no search box yet.
    await expect(canvas.queryByRole('searchbox')).toBeNull()
    // Documents sent for signature come first, under their own title, each with its status.
    await expect(canvas.getByRole('heading', { name: 'Signatures' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Shared files' })).toBeVisible()
    const toSign = canvas.getByText('Service agreement').closest('li')!
    await expect(within(toSign).getByText('To sign')).toBeVisible()
    await expect(
      within(toSign).getByText('Sign with the link in the email you received'),
    ).toBeVisible()
    await expect(within(toSign).queryByRole('link')).toBeNull()
    const contract = `Contract ${new Date().getFullYear()}/C/001`
    const signed = canvas.getByText(contract).closest('li')!
    await expect(within(signed).getByText('Signed')).toBeVisible()
    await expect(within(signed).getByText(/^Signed .+/)).toBeVisible()
    await expect(
      within(signed).getByRole('link', { name: `Download the signed PDF of ${contract}` }),
    ).toHaveAttribute('href', '/api/v1/public/portal/signatures/sig_2/download')
    const declined = canvas.getByText('Data processing agreement').closest('li')!
    await expect(within(declined).getByText('Declined')).toBeVisible()
    await expect(within(declined).queryByRole('link')).toBeNull()
  },
}

export const DocumentsDark: Story = { ...Documents, parameters: { dark: true } }

/** From seven documents on, a search box filters them by name. */
export const DocumentsSearch: Story = {
  parameters: documents(() =>
    HttpResponse.json({
      data: [
        ...portalDocuments,
        ...portalDocuments.slice(0, 3).map((doc, n) =>
          Object.assign({}, doc, {
            id: `doc_x${n}`,
            name: `Archive ${n + 1} ${doc.name}`,
            quote: null,
          }),
        ),
      ],
    }),
  ),
  render: () => <PortalDocuments />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const search = await canvas.findByRole('searchbox', { name: 'Search documents' })
    await userEvent.type(search, 'archive')
    await expect(canvas.getAllByRole('listitem')).toHaveLength(3)
    await userEvent.clear(search)
    await userEvent.type(search, 'nothing like this')
    await expect(canvas.getByText('No matching documents')).toBeVisible()
  },
}

/** Only documents for signature: no empty "shared files" card and no section titles to tell apart. */
export const SignaturesOnly: Story = {
  parameters: documents(
    () => HttpResponse.json({ data: [] }),
    () => HttpResponse.json({ data: portalSignatures }),
  ),
  render: () => <PortalDocuments />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Service agreement')).toBeVisible()
    await expect(canvas.queryByText('Nothing has been shared with you yet')).toBeNull()
    await expect(canvas.queryByRole('heading', { name: 'Shared files' })).toBeNull()
  },
}

/** Signatures that fail to load say so in their own section; the shared files still show. */
export const SignaturesError: Story = {
  parameters: documents(
    () => HttpResponse.json({ data: portalDocuments }),
    () => HttpResponse.json({}, { status: 500 }),
  ),
  render: () => <PortalDocuments />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const alert = await canvas.findByRole('alert')
    await expect(alert).toHaveTextContent('Your signatures')
    await expect(within(alert).getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(canvas.getByText('Contract.pdf')).toBeVisible()
  },
}

export const DocumentsEmpty: Story = {
  parameters: documents(() => HttpResponse.json({ data: [] })),
  render: () => <PortalDocuments />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('Nothing has been shared with you yet'),
    ).toBeVisible()
  },
}

export const DocumentsError: Story = {
  parameters: documents(() => HttpResponse.json({}, { status: 500 })),
  render: () => <PortalDocuments />,
  play: async ({ canvasElement }) => {
    const alert = await within(canvasElement).findByRole('alert')
    await expect(within(alert).getByRole('button', { name: 'Try again' })).toBeVisible()
  },
}

export const DocumentsLoading: Story = {
  parameters: documents(() => new Promise(() => {})),
  render: () => <PortalDocuments />,
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getAllByRole('status', { name: 'Loading' })[0]).toBeVisible(),
    )
  },
}
