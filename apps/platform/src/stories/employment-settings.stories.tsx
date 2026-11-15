import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { EmploymentSettings } from '@/components/settings/employment-settings'

import { closeHeidi, dark, desktop, Frame, pageParameters, phone } from './pages/frame'
import { sessionHandler } from './screen-fixtures'

const saved = fn()
const save = http.put('/api/v1/employment/settings', async ({ request }) => {
  const body = await request.json()
  saved(body)
  return HttpResponse.json({ data: { ...Object(body), updated_at: '2026-11-15T10:00:00Z' } })
})

const meta = {
  title: 'Settings/Employment',
  beforeEach: () => {
    closeHeidi()
    saved.mockClear()
  },
  parameters: pageParameters('/settings/employment', {}, [save]),
  render: () => (
    <Frame>
      <EmploymentSettings />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The profile pre-fills new employees; switching to a country with states asks for the state. */
export const Profile: Story = {
  play: async () => {
    const body = within(document.body)
    const canton = await body.findByRole('combobox', { name: 'Canton' }, { timeout: 8000 })
    await expect(canton).toHaveValue('ZH')
    await expect(body.getByRole('button', { name: 'About the employment profile' })).toBeVisible()
    await userEvent.selectOptions(canton, 'GE')
    await userEvent.click(body.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        employing_entity: 'Muster AG',
        country: 'CH',
        region: 'GE',
      }),
    )
  },
}
export const ProfileDark = dark(Profile)
export const ProfilePhone = phone(Profile)

/** A 422 lands on its field. */
export const RefusedRegion: Story = {
  parameters: pageParameters('/settings/employment', {}, [
    http.put('/api/v1/employment/settings', () =>
      HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Check the highlighted fields.',
            details: { fields: { region: 'Choose a canton of Switzerland.' } },
          },
        },
        { status: 422 },
      ),
    ),
  ]),
  play: async () => {
    const body = within(document.body)
    const canton = await body.findByRole('combobox', { name: 'Canton' }, { timeout: 8000 })
    await userEvent.selectOptions(canton, 'BE')
    await userEvent.click(body.getByRole('button', { name: 'Save' }))
    await expect(await body.findByText('Choose a canton of Switzerland.')).toBeVisible()
  },
}

/** Read without write: the fields are shown, disabled, and there is no Save. */
export const ReadOnly: Story = {
  parameters: pageParameters('/settings/employment', {}, [
    sessionHandler({ role: 'member', scopes: ['*:*', 'read:employees'] }),
  ]),
  play: async () => {
    const body = within(document.body)
    await expect(
      await body.findByText('Only people who can edit employees can change this.', undefined, {
        timeout: 8000,
      }),
    ).toBeVisible()
    await expect(body.getByRole('textbox', { name: 'Employing company' })).toBeDisabled()
    await expect(body.queryByRole('button', { name: 'Save' })).toBeNull()
  },
}
