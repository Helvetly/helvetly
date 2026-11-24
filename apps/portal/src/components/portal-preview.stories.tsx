import { setCsrfToken } from '@helvetly/ui/lib/http'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { portalHandlers, portalSession, scopedPortal } from '@/mocks/portal'

import { PortalLogin } from './portal-login'
import { PortalProfile } from './portal-profile'
import { PortalShell } from './portal-shell'

const P = '/api/v1/public/portal'
const ended = fn()
const preview = http.get(`${P}/session`, () =>
  HttpResponse.json({ ...portalSession, preview: { started_by: 'Olivia Muster' } }),
)
const end = http.delete(`${P}/session`, () => {
  ended()
  return new HttpResponse(null, { status: 204 })
})

const meta = {
  title: 'Portal/Preview',
  beforeEach: () => setCsrfToken(portalSession.csrf_token),
  parameters: { ownMain: true, msw: { handlers: [preview, end, ...portalHandlers] } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)

/** A member's preview: the banner on every page, every write off with "Read-only preview", and "End preview". */
export const ReadOnly: Story = {
  render: () => (
    <PortalShell>
      <PortalProfile />
    </PortalShell>
  ),
  play: async () => {
    ended.mockClear()
    const banner = await body().findByRole('status', { name: 'Read-only preview' })
    await expect(banner).toHaveTextContent(
      'Preview as Keller AG · read-only · started by Olivia Muster',
    )
    const photo = await body().findByRole('button', { name: /^(Upload|Change) photo$/ })
    await expect(photo).toBeDisabled()
    // The disabled button's wrapper still takes the pointer, so the tooltip says why.
    await userEvent.hover(photo.parentElement!)
    await expect(
      await body().findByRole('tooltip', { name: 'Read-only preview' }),
    ).toBeInTheDocument()
    await userEvent.click(within(banner).getByRole('button', { name: 'End preview' }))
    await waitFor(() => expect(ended).toHaveBeenCalledOnce())
  },
}

/** The client's own session: no banner, the writes stay on. */
export const ClientsOwnSession: Story = {
  parameters: { msw: { handlers: portalHandlers } },
  render: ReadOnly.render,
  play: async () => {
    await expect(
      await body().findByRole('button', { name: /^(Upload|Change) photo$/ }),
    ).toBeEnabled()
    await expect(body().queryByRole('status', { name: 'Read-only preview' })).toBeNull()
  },
}

const signedOut = http.get(`${P}/session`, () =>
  HttpResponse.json({ error: { code: 'unauthenticated', message: 'Sign in.' } }, { status: 401 }),
)

/** A preview link used twice or too late lands on the sign-in page, which says so. */
export const LinkExpired: Story = {
  parameters: { msw: { handlers: [signedOut, scopedPortal(), ...portalHandlers] } },
  beforeEach: () => {
    const before = window.location.href
    const url = new URL(before)
    url.searchParams.set('preview', 'expired')
    window.history.replaceState(window.history.state, '', url)
    return () => window.history.replaceState(window.history.state, '', before)
  },
  render: () => <PortalLogin />,
  play: async () => {
    await expect(await body().findByRole('alert')).toHaveTextContent(
      'This preview link has expired or was already used.',
    )
  },
}
