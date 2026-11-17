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
const openTemplate = async (kind = 'Invoice', language?: string) => {
  await userEvent.click(
    await body().findByRole('button', { name: `Edit the ${kind} email` }, { timeout: 8000 }),
  )
  const box = within(await body().findByRole('dialog'))
  if (language) await userEvent.click(box.getByRole('radio', { name: new RegExp(`^${language}`) }))
  return box
}
const field = (box: ReturnType<typeof within>, name: string) =>
  box.getByRole('textbox', { name: new RegExp(`^${name}`) })

/** One row per document type; a row opens its email in a dialog, where the language is chosen and a chip puts
 * its variable at the cursor and explains itself in a tooltip. */
export const Default: Story = {
  play: async () => {
    const list = await body().findByRole('list', { name: 'Email templates' }, { timeout: 8000 })
    await expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    const box = await openTemplate()
    await expect(box.getAllByRole('radio')).toHaveLength(4)
    const text = field(box, 'Message')
    await expect(text).toHaveDisplayValue(/\{number\}/)
    await userEvent.clear(text)
    await userEvent.type(text, 'Hi ')
    await userEvent.click(box.getByRole('button', { name: '{client}' }))
    await expect(text).toHaveValue('Hi {client}')
    await userEvent.hover(box.getByRole('button', { name: '{due_date}' }))
    await expect(await body().findByText('Due date, e.g. 31.12.2026')).toBeVisible()
  },
}
export const DefaultDark = dark(Default)
export const DefaultPhone = phone(Default)

/** Subject and message are required: an empty one is named under its field and nothing is sent. */
export const Required: Story = {
  play: async () => {
    const box = await openTemplate()
    await userEvent.clear(field(box, 'Subject'))
    await userEvent.clear(field(box, 'Message'))
    await userEvent.click(box.getByRole('button', { name: 'Save' }))
    await expect(await box.findByText('Enter a subject.')).toBeVisible()
    await expect(box.getByText('Enter a message.')).toBeVisible()
    await expect(body().getByRole('dialog')).toBeVisible()
  },
}

/** Saved wording marks its language in the dialog and the row, and Reset to default appears. */
export const Custom: Story = {
  play: async () => {
    let box = await openTemplate('Invoice', 'Français')
    await userEvent.clear(field(box, 'Message'))
    await userEvent.type(field(box, 'Message'), 'Bonjour {{client}')
    await userEvent.click(box.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(body().queryByRole('dialog')).toBeNull())
    await expect(await body().findByText('1 language customised')).toBeVisible()
    box = await openTemplate('Invoice', 'Français')
    await expect(box.getByRole('radio', { name: 'Français, customised' })).toBeChecked()
    await expect(field(box, 'Message')).toHaveValue('Bonjour {client}')
    await expect(box.getByRole('button', { name: 'Reset to default' })).toBeVisible()
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
    await expect(body().queryByRole('list', { name: 'Email templates' })).toBeNull()
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
    const box = await openTemplate()
    const subject = field(box, 'Subject')
    await userEvent.type(subject, '!')
    await userEvent.click(box.getByRole('button', { name: 'Save' }))
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
    const box = await openTemplate()
    await waitFor(() => expect(field(box, 'Message')).toBeDisabled())
    await expect(field(box, 'Subject')).toBeDisabled()
    await expect(box.queryByRole('button', { name: 'Save' })).toBeNull()
    await expect(box.queryByRole('button', { name: '{client}' })).toBeNull()
  },
}
export const ReadOnlyPhone = phone(ReadOnly)
