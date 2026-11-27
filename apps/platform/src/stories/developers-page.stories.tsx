import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, spyOn, userEvent, within } from 'storybook/test'

import { DevelopersPage } from '@/components/api/developers-page'
import { accountHandlers, resetAccountMock } from '@/mocks/account'

import { screenHandlers } from './screen-fixtures'

const meta = {
  title: 'Developers/API & MCP',
  decorators: [
    (Story) => (
      <SidebarProvider>
        <div className="flex min-w-0 flex-1 flex-col bg-card">
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
    ownMain: true,
    nextjs: { navigation: { pathname: '/developers' } },
    msw: { handlers: [...accountHandlers, ...screenHandlers] },
  },
  beforeEach: () => resetAccountMock(),
  render: () => <DevelopersPage />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/**
 * Its own page (under Ask Heidi in the sidebar), not a settings tab: tokens, connecting an AI assistant over MCP with
 * a setup per client, and the REST API, each a card with a link to the docs site; Developer docs in the header.
 */
export const Page: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('Claude')
    // One page, no tabs: the header bar names it.
    await expect(canvas.queryByRole('navigation', { name: 'Views' })).toBeNull()
    // The header bar's title for screen readers, then the page's own.
    await expect(
      canvas.getAllByRole('heading', { level: 1, name: 'API & MCP' }).at(-1),
    ).toBeVisible()
    await expect(canvas.getByRole('link', { name: /Developer docs/ })).toHaveAttribute(
      'href',
      'https://docs.helvetly.com',
    )
    await expect(canvas.getByRole('link', { name: /MCP guide/ })).toHaveAttribute(
      'href',
      'https://docs.helvetly.com/mcp',
    )

    const mcp = within(canvas.getByRole('region', { name: 'Connect an AI assistant' }))
    const url = `${window.location.origin}/api/mcp`
    await expect(mcp.getByText(url)).toBeVisible()
    await expect(mcp.getByLabelText('Claude Code setup')).toHaveTextContent(
      `claude mcp add --transport http helvetly ${url}`,
    )
    await expect(mcp.getByText('hvt_YOUR_TOKEN')).toBeVisible()
    await userEvent.click(mcp.getByRole('tab', { name: 'Claude Desktop' }))
    await expect(mcp.getByLabelText('Claude Desktop setup')).toHaveTextContent('mcp-remote')
    const writeText = spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await userEvent.click(mcp.getByRole('button', { name: 'Copy Claude Desktop setup' }))
    await expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"AUTH_HEADER": "Bearer'))

    const rest = within(canvas.getByRole('region', { name: 'REST API' }))
    await expect(rest.getByText(`${window.location.origin}/api/v1`)).toBeVisible()
  },
}

export const PageDark: Story = { ...Page, parameters: { ...meta.parameters, dark: true } }

export const PagePhone: Story = {
  ...Page,
  parameters: {
    ...meta.parameters,
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
}

/** No tokens yet: the empty state's one primary action; the MCP setup is still there to read. */
export const PageNoTokens: Story = {
  parameters: {
    ...meta.parameters,
    msw: {
      handlers: [
        http.get('/api/v1/account/tokens', () => HttpResponse.json({ data: [] })),
        ...accountHandlers,
        ...screenHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('No API tokens yet')).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: 'Create token' })).toHaveLength(1)
    await expect(canvas.getByRole('region', { name: 'Connect an AI assistant' })).toBeVisible()
  },
}

/** The server names its API host (PUBLIC_API_URL): the MCP and REST setups point tokens there, not at the platform. */
export const ApiHost: Story = {
  parameters: {
    ...meta.parameters,
    msw: {
      handlers: [
        http.get('/api/v1/auth/config', () =>
          HttpResponse.json({
            google: true,
            email: true,
            passkey: true,
            dev_codes: false,
            api_url: 'https://api.helvetly.com',
          }),
        ),
        ...accountHandlers,
        ...screenHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const mcp = within(await canvas.findByRole('region', { name: 'Connect an AI assistant' }))
    await expect(await mcp.findByText('https://api.helvetly.com/api/mcp')).toBeVisible()
    const rest = within(canvas.getByRole('region', { name: 'REST API' }))
    await expect(rest.getByText('https://api.helvetly.com/api/v1')).toBeVisible()
  },
}
