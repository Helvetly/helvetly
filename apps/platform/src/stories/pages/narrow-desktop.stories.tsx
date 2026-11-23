import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { expect, waitFor, within } from 'storybook/test'

import { ClientsPage } from '@/components/clients/clients-page'
import { Dashboard } from '@/components/dashboard/dashboard'
import { DocumentsPage } from '@/components/documents/documents-page'
import { ExpensesPage } from '@/components/expenses/expenses-page'
import { InvoicesPage } from '@/components/invoices/invoices-page'
import { SchedulingPage } from '@/components/scheduling/scheduling-page'
import { sampleState, schedulingHandlers, STORY_NOW, TEAM } from '@/mocks/scheduling'

import { attentionHandlers } from './api'
import { closeHeidi, Frame, pageParameters, shows } from './frame'

/**
 * A desktop window narrowed (devtools open, a split screen, Heidi's panel beside the page): the
 * sidebar stays open above the tablet breakpoint while the page gets far less room than the
 * window. Window widths that leave the panel about 1100, 950 and 800px (below 1024px the tablet
 * layout's icon rail takes over); Heidi open beside it leaves under 400px.
 */
const widths = { content1100: 1372, content950: 1222, content800: 1072 } as const

const viewport = {
  options: Object.fromEntries(
    Object.entries(widths).map(([name, width]) => [
      name,
      { name, styles: { width: `${width}px`, height: '900px' } },
    ]),
  ),
}

const meta = {
  title: 'Pages/Narrow desktop',
  beforeEach: closeHeidi,
  parameters: { ...pageParameters('/'), viewport },
  globals: { viewport: { value: 'content950' } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** Inside a box that scrolls sideways on purpose (the key figures' snap row, a table). */
const inScroller = (node: HTMLElement, main: HTMLElement) => {
  for (let box = node.parentElement; box && box !== main; box = box.parentElement)
    if (/auto|scroll/.test(getComputedStyle(box).overflowX)) return true
  return false
}

const name = (node: HTMLElement) =>
  `${node.tagName.toLowerCase()} "${node.textContent?.slice(0, 40)}"`

/**
 * Nothing visible in the page panel reaches past its right edge, nothing is clipped by a box that
 * hides overflow (an ellipsis is fine), the panel does not scroll sideways, and every control in
 * the page's header is on screen.
 */
const fitsThePanel =
  (...texts: (string | RegExp)[]): Story['play'] =>
  async (context) => {
    await shows(...texts)?.(context)
    const main = await within(document.body).findByRole('main')
    await waitFor(() => {
      const edge = Math.min(main.getBoundingClientRect().right, window.innerWidth)
      const shown = [...main.querySelectorAll('*')].filter(
        (node): node is HTMLElement =>
          node instanceof HTMLElement &&
          !node.closest('[inert]') &&
          !node.classList.contains('sr-only') &&
          node.checkVisibility({ visibilityProperty: true }) &&
          node.getBoundingClientRect().width > 1 &&
          !inScroller(node, main),
      )
      const outside = shown
        .filter((node) => node.getBoundingClientRect().right > edge + 1)
        .map((node) => `outside: ${name(node)}`)
      const cut = shown
        .filter((node) => node.scrollWidth > node.clientWidth + 1)
        .filter((node) => {
          const style = getComputedStyle(node)
          return style.overflowX === 'hidden' && style.textOverflow !== 'ellipsis'
        })
        .map((node) => `cut: ${name(node)}`)
      expect([...outside, ...cut].slice(0, 10)).toEqual([])
      expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth)
    })
    const controls = [...(main.querySelector('header')?.querySelectorAll('button') ?? [])].filter(
      (node) => node.checkVisibility(),
    )
    await expect(controls.length).toBeGreaterThan(0)
    const right = main.getBoundingClientRect().right + 1
    await expect(controls.filter((node) => node.getBoundingClientRect().right > right)).toEqual([])
  }

const at = (width: keyof typeof widths) => ({ viewport: { value: width } })

/** Heidi's panel open at 420px takes that much more from the page. */
const withHeidi = <S extends Story>(story: S): S => ({
  ...story,
  beforeEach: () => {
    localStorage.setItem('helvetly:heidi:panel', JSON.stringify({ open: true, width: 420 }))
    return closeHeidi
  },
})

const page = (
  path: string,
  element: ReactNode,
  texts: (string | RegExp)[],
  handlers: Parameters<typeof pageParameters>[2] = [],
): Story => ({
  parameters: { ...pageParameters(path, {}, handlers), viewport },
  render: () => <Frame>{element}</Frame>,
  play: fitsThePanel(...texts),
})

const dashboard = page('/', <Dashboard />, [/Cash flow/i], attentionHandlers())

/** Five figures, cash flow beside what needs attention: all of it in a 950px panel. */
export const Dashboard950: Story = dashboard
export const Dashboard1100: Story = { ...dashboard, globals: at('content1100') }
export const Dashboard800: Story = { ...dashboard, globals: at('content800') }
/**
 * A desktop window with Heidi open: the page has under 400px. The cards stack, "New invoice" is
 * only its "+" (named for screen readers) and the period button names the period without its dates.
 */
export const DashboardHeidi: Story = withHeidi({
  ...dashboard,
  globals: at('content800'),
  play: async (context) => {
    await fitsThePanel(/Cash flow/i)?.(context)
    const main = await within(document.body).findByRole('main')
    const header = within(main.querySelector('header') ?? main)
    const create = header.getByRole('button', { name: 'New invoice' })
    await expect(create).toBeVisible()
    // Its label is screen-reader only, so the button is about as wide as its icon.
    await expect(create.getBoundingClientRect().width).toBeLessThan(48)
    const period = await header.findByRole('button', { name: /^Period:/ })
    await waitFor(() => expect(period.innerText).toMatch(/^Period:\s*This (month|quarter|year)$/))
  },
})

const invoices = page('/invoices', <InvoicesPage />, ['Sophie Meier'])
export const Invoices800: Story = { ...invoices, globals: at('content800') }
export const InvoicesHeidi: Story = withHeidi(Invoices800)
export const Clients800: Story = {
  ...page('/clients', <ClientsPage />, ['Keller Holzbau AG']),
  globals: at('content800'),
}
export const Expenses800: Story = {
  ...page('/expenses', <ExpensesPage />, ['Swisscom (Schweiz) AG']),
  globals: at('content800'),
}
export const Documents800: Story = {
  ...page('/documents', <DocumentsPage />, ['Receipts 2026']),
  globals: at('content800'),
}

const scheduling = page(
  '/scheduling',
  <SchedulingPage now={STORY_NOW} />,
  ['2 requests waiting'],
  [
    http.get('/api/v1/members', () => HttpResponse.json({ data: TEAM })),
    ...schedulingHandlers(sampleState()),
  ],
)
export const Scheduling800: Story = { ...scheduling, globals: at('content800') }
/** The calendar's controls wrap to a second row instead of leaving the screen. */
export const SchedulingHeidi: Story = withHeidi(Scheduling800)
