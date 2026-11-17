import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { EmailTemplatesSections } from '@/components/settings/email-templates-settings'
import { SettingsPage } from '@/components/settings/layout'
import { SettingsHeader } from '@/components/settings/settings-tabs'
import { emailTemplateHandlers, resetEmailTemplatesMock } from '@/mocks/email-templates'

import { closeHeidi, dark, desktop, Frame, pageParameters, phone } from './pages/frame'
import { sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Settings/Email templates',
  beforeEach: () => {
    closeHeidi()
    resetEmailTemplatesMock()
  },
  parameters: pageParameters('/settings/workspace', {}, [...emailTemplateHandlers]),
  render: () => (
    <Frame>
      <SettingsHeader />
      <SettingsPage title="Workspace" description="">
        <EmailTemplatesSections />
      </SettingsPage>
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)
const message = () => body().findByRole('textbox', { name: 'Message' }, { timeout: 8000 })

/** The standard wording; a chip puts its variable at the cursor of the field last used. */
export const Default: Story = {
  play: async () => {
    const text = await message()
    await expect(text).toHaveDisplayValue(/\{number\}/)
    await userEvent.clear(text)
    await userEvent.type(text, 'Hi ')
    await userEvent.click(body().getByRole('button', { name: '{client}' }))
    await expect(text).toHaveValue('Hi {client}')
    await userEvent.hover(body().getByRole('button', { name: '{due_date}' }))
    await expect(await body().findByText('Due date, e.g. 31.12.2026')).toBeVisible()
    // The two pickers are one control of one height, like the other settings pages' choices.
    const kinds = body().getByRole('group', { name: 'Document type' })
    const languages = body().getByRole('group', { name: 'Language' })
    await expect(within(languages).getByRole('radio', { name: 'Deutsch' })).toBeChecked()
    await expect(languages.getBoundingClientRect().height).toBe(
      kinds.getBoundingClientRect().height,
    )
    // The wording is its own section, divided from the picker by a hairline like every other one.
    const wording = text.closest('section')
    await expect(wording && getComputedStyle(wording).borderTopWidth).toBe('1px')
  },
}
export const DefaultDark = dark(Default)
export const DefaultPhone = phone(Default)

/** Saved wording shows a dot on its language, and Reset to default appears. */
export const Custom: Story = {
  play: async () => {
    const text = await message()
    await userEvent.click(body().getByRole('radio', { name: 'Français' }))
    const french = await body().findByRole('textbox', { name: 'Message' })
    await userEvent.clear(french)
    await userEvent.type(french, 'Bonjour {client}')
    await userEvent.click(body().getByRole('button', { name: 'Save' }))
    await expect(
      await body().findByRole('radio', { name: 'Français, customised' }),
    ).toBeInTheDocument()
    await expect(await body().findByRole('button', { name: 'Reset to default' })).toBeVisible()
    await expect(text).toBeInTheDocument()
  },
}
export const CustomDark = dark(Custom)

export const Loading: Story = {
  parameters: pageParameters('/settings/workspace', {}, [
    http.get('/api/v1/email-templates', async () => {
      await delay('infinite')
      return HttpResponse.json({ data: [] })
    }),
  ]),
  play: async () => {
    await waitFor(() => expect(body().getByRole('status', { name: 'Loading' })).toBeVisible(), {
      timeout: 8000,
    })
    await expect(body().queryByRole('textbox', { name: 'Message' })).toBeNull()
  },
}

export const LoadError: Story = {
  parameters: pageParameters('/settings/workspace', {}, [
    http.get('/api/v1/email-templates', () =>
      HttpResponse.json({ error: { code: 'unavailable', message: 'Down.' } }, { status: 503 }),
    ),
  ]),
  play: async () => {
    await expect(
      await body().findByRole('button', { name: /Try again/ }, { timeout: 8000 }),
    ).toBeVisible()
  },
}

/** The server's refusal lands under its field. */
export const ValidationError: Story = {
  parameters: pageParameters('/settings/workspace', {}, [
    http.put('/api/v1/email-templates/:kind/:language', () =>
      HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Check the fields.',
            details: { fields: { subject: 'Enter a subject of at most 200 characters.' } },
          },
        },
        { status: 422 },
      ),
    ),
    ...emailTemplateHandlers,
  ]),
  play: async () => {
    await message()
    const subject = body().getByRole('textbox', { name: 'Subject' })
    await userEvent.type(subject, '!')
    await userEvent.click(body().getByRole('button', { name: 'Save' }))
    await expect(
      await body().findByText('Enter a subject of at most 200 characters.'),
    ).toBeVisible()
    await waitFor(() => expect(subject).toHaveAttribute('aria-invalid', 'true'))
  },
}

/** Without invoice-settings edit the fields are shown, disabled, with no Save and no chips. */
export const ReadOnly: Story = {
  parameters: pageParameters('/settings/workspace', {}, [
    sessionHandler({ role: 'member', scopes: ['read:workspace', 'read:invoice-settings'] }),
    ...emailTemplateHandlers,
  ]),
  play: async () => {
    const text = await message()
    await waitFor(() => expect(text).toBeDisabled())
    await expect(body().getByRole('textbox', { name: 'Subject' })).toBeDisabled()
    await expect(body().queryByRole('button', { name: 'Save' })).toBeNull()
    await expect(body().queryByRole('button', { name: '{client}' })).toBeNull()
  },
}
export const ReadOnlyPhone = phone(ReadOnly)
