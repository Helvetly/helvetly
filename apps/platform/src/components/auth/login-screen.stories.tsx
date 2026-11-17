import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, within } from 'storybook/test'

import { LoginScreen } from './login-screen'

const meta = {
  title: 'Auth/LoginScreen',
  component: LoginScreen,
  parameters: {
    bare: true,
    ownMain: true,
    msw: {
      handlers: [
        http.get('/api/v1/session', () =>
          HttpResponse.json(
            { error: { code: 'unauthenticated', message: 'Sign in.' } },
            { status: 401 },
          ),
        ),
        http.get('/api/v1/auth/config', () =>
          HttpResponse.json({ email: true, google: false, passkey: false, dev_codes: false }),
        ),
      ],
    },
  },
} satisfies Meta<typeof LoginScreen>
export default meta
type Story = StoryObj<typeof meta>

export const Languages: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Change language/ }))
    const page = within(document.body)

    await Promise.all(
      ['Deutsch', 'English', 'Français', 'Italiano'].map((name) =>
        expect(within(page.getByRole('dialog')).getByRole('button', { name })).toBeVisible(),
      ),
    )

    await userEvent.keyboard('{Escape}')
    await expect(await canvas.findByRole('button', { name: /^Change language/ })).toHaveFocus()
  },
}

export const Dark: Story = { ...Languages, parameters: { dark: true } }
export const Phone: Story = {
  ...Languages,
  parameters: {
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
}
