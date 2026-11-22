import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { MembersPage } from '@/components/members/members-page'

import { members } from './api'
import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'

const meta = {
  title: 'Pages/Members',
  beforeEach: closeHeidi,
  parameters: pageParameters('/members'),
  render: () => (
    <Frame>
      <MembersPage />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const List: Story = { play: shows('Luca Rossi', 'jonas@muster.ch') }
export const ListDark = dark(List)
export const ListPhone = phone(List)

const page = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)
const wait = { timeout: 8000 }
const absent = (canvasElement: HTMLElement, ...texts: string[]) =>
  Promise.all(texts.map((text) => expect(page(canvasElement).queryAllByText(text)).toHaveLength(0)))

/** Typing goes to the URL (?q=) after a pause; the list follows the URL. */
export const Search: Story = {
  play: async (context) => {
    await shows('Luca Rossi')?.(context)
    const body = page(context.canvasElement)
    await userEvent.type(body.getByRole('searchbox', { name: 'Search members' }), 'luca@')
    await waitFor(() => expect(window.location.search).toContain('q=luca%40'), wait)
  },
}

/** The search covers names and emails, members and invitations alike, ignoring case. */
export const Searched: Story = {
  parameters: pageParameters('/members', { q: 'LUCA@' }),
  play: async (context) => {
    await shows('Luca Rossi')?.(context)
    await absent(context.canvasElement, 'Mia Keller', 'jonas@muster.ch')
  },
}
export const SearchedPhone = phone(Searched)

/** Picking a role in Filters goes to the URL (?role=). */
export const RoleFilter: Story = {
  play: async (context) => {
    await shows('Luca Rossi')?.(context)
    const body = page(context.canvasElement)
    await userEvent.click(body.getByRole('button', { name: 'Filters' }))
    const filters = within(await body.findByRole('dialog', { name: 'Filters' }))
    await userEvent.click(filters.getByRole('button', { name: /^Role/ }))
    await userEvent.click(await body.findByRole('option', { name: 'Member' }))
    await waitFor(() => expect(window.location.search).toContain('role=member'), wait)
    await userEvent.keyboard('{Escape}')
  },
}

/** The role filter keeps members and invitations of the picked roles, and counts itself. */
export const RoleFiltered: Story = {
  parameters: pageParameters('/members', { role: 'member' }),
  play: async (context) => {
    await shows('Mia Keller', 'jonas@muster.ch')?.(context)
    await absent(context.canvasElement, 'Luca Rossi')
    await expect(
      page(context.canvasElement).getByRole('button', { name: /Filters/ }),
    ).toHaveTextContent('1')
  },
}
export const RoleFilteredDark = dark(RoleFiltered)

/** Nobody matches: the empty state clears the search and the roles. */
export const NoMatches: Story = {
  parameters: pageParameters('/members', { q: 'nobody', role: 'owner' }),
  play: async (context) => {
    await shows('Nothing matches “nobody”')?.(context)
    const body = page(context.canvasElement)
    await userEvent.click(body.getByRole('button', { name: 'Clear search and filters' }))
    await expect(body.getByRole('searchbox', { name: 'Search members' })).toHaveValue('')
    await expect(window.location.search).not.toMatch(/q=|role=/)
  },
}
export const NoMatchesPhone = phone(NoMatches)
export const NoMatchesDark = dark(NoMatches)

/** A reload keeps the view, the search and the roles: all come back from the URL. */
export const UrlRestore: Story = {
  parameters: pageParameters('/members', { view: 'invited', q: 'jonas', role: 'member' }),
  play: async (context) => {
    await shows('jonas@muster.ch')?.(context)
    const body = page(context.canvasElement)
    await expect(body.getByRole('searchbox', { name: 'Search members' })).toHaveValue('jonas')
    const views = body.getByRole('navigation', { name: 'Views' })
    await expect(within(views).getByRole('button', { current: 'page' })).toHaveTextContent(
      'Invited',
    )
    await expect(body.getByRole('button', { name: /Filters/ })).toHaveTextContent('1')
    await absent(context.canvasElement, 'Luca Rossi', 'Mia Keller')
  },
}

/** Alone in the workspace: no role change and no leaving for the last owner, so no "…" menu. */
export const SoleOwner: Story = {
  parameters: pageParameters('/members', {}, [
    http.get('/api/v1/members/invitations', () => HttpResponse.json({ data: [] })),
    http.get('/api/v1/members', () => HttpResponse.json({ data: members.slice(0, 1) })),
  ]),
  play: async (context) => {
    await shows('Anna Muster', 'Work together')?.(context)
    const body = page(context.canvasElement)
    await expect(body.getByText('Anyone can leave; the last owner stays.')).toBeVisible()
    await expect(body.queryByRole('button', { name: 'Actions for Anna Muster' })).toBeNull()
  },
}
export const SoleOwnerPhone = phone(SoleOwner)

/** A header sorts: the sorted column says so, and a click on another one writes it to the URL. */
export const SortedByColumn: Story = {
  parameters: pageParameters('/members', { sort: 'member' }),
  play: async (context) => {
    await shows('Luca Rossi')?.(context)
    const body = page(context.canvasElement)
    await expect(body.getByRole('button', { name: 'Member' }).closest('th')).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    await userEvent.click(body.getByRole('button', { name: 'Last active' }))
    await waitFor(() => expect(window.location.search).toContain('sort=-active'), wait)
  },
}
