import { Button } from '@helvetly/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@helvetly/ui/components/dropdown-menu'
import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Ellipsis, Trash2, X } from 'lucide-react'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ClientContacts } from '@/components/clients/client-contacts'
import { Preview } from '@/components/documents/preview'
import { MembersPage } from '@/components/members/members-page'
import { WorkspaceSettings } from '@/components/settings/workspace-settings'
import type { DocFile } from '@/lib/documents'
import type { Member } from '@/lib/members'
import { sampleClient } from '@/test/invoice-fixtures'

import { screenHandlers, storySession } from './screen-fixtures'

const meta = {
  title: 'Design system/Destructive actions',
  parameters: { msw: { handlers: screenHandlers } },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Elements painted with the destructive token, to compare real controls against. */
function Token() {
  return (
    <span aria-hidden className="flex gap-2">
      <span data-testid="token-text" className="text-destructive">
        Token
      </span>
      <span data-testid="token-fill" className="size-4 bg-destructive" />
    </span>
  )
}

const tokenText = (canvas: HTMLElement) =>
  getComputedStyle(within(canvas).getByTestId('token-text')).color
const tokenFill = (canvas: HTMLElement) =>
  getComputedStyle(within(canvas).getByTestId('token-fill')).backgroundColor

async function isRedText(element: HTMLElement, canvas: HTMLElement) {
  await expect(getComputedStyle(element).color).toBe(tokenText(canvas))
}

export const Variants: Story = {
  render: () => (
    <div className="grid gap-6">
      <Token />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline">Keep it</Button>
        <Button variant="destructive">
          <Trash2 /> Delete client
        </Button>
        <Button variant="destructive-outline">
          <Trash2 /> Delete workspace
        </Button>
        <Button variant="destructive-ghost">
          <Trash2 /> Remove
        </Button>
        <Button variant="destructive-ghost" size="icon-sm" aria-label="Delete file">
          <Trash2 />
        </Button>
        <span className="flex h-6 items-center gap-1 rounded-[5px] bg-muted pr-0.5 pl-2 text-[13px]">
          vip
          <button
            type="button"
            aria-label="Remove vip"
            className="flex size-5 items-center justify-center rounded text-destructive hover:bg-destructive/10"
          >
            <X className="size-3" />
          </button>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Actions">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Edit</DropdownMenuItem>
            <DropdownMenuItem variant="destructive">
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  ),
  play: async ({ canvasElement, parameters }) => {
    const canvas = within(canvasElement)
    const solid = canvas.getByRole('button', { name: 'Delete client' })
    const ghost = canvas.getByRole('button', { name: 'Remove' })
    const neutral = canvas.getByRole('button', { name: 'Keep it' })
    // One role, one shape: the house heights and radius, no shadow on the quiet one.
    await expect(ghost.getBoundingClientRect().height).toBe(neutral.getBoundingClientRect().height)
    await expect(getComputedStyle(solid).borderRadius).toBe(getComputedStyle(neutral).borderRadius)
    await expect(getComputedStyle(ghost).boxShadow).toBe('none')
    await isRedText(ghost, canvasElement)
    const outlined = canvas.getByRole('button', { name: 'Delete workspace' })
    await isRedText(outlined, canvasElement)
    await expect(outlined.getBoundingClientRect().height).toBe(
      neutral.getBoundingClientRect().height,
    )
    await expect(getComputedStyle(outlined).backgroundColor).not.toBe(tokenFill(canvasElement))
    await isRedText(canvas.getByRole('button', { name: 'Delete file' }), canvasElement)
    await isRedText(canvas.getByRole('button', { name: 'Remove vip' }), canvasElement)
    await expect(getComputedStyle(neutral).color).not.toBe(tokenText(canvasElement))
    // Dark mode darkens the fill so the white label stays readable.
    if (parameters.dark === true)
      await expect(getComputedStyle(solid).backgroundColor).not.toBe(tokenFill(canvasElement))
    else await expect(getComputedStyle(solid).backgroundColor).toBe(tokenFill(canvasElement))
    await expect(getComputedStyle(solid).color).toBe('rgb(255, 255, 255)')
    await expect(solid.querySelector('svg')).not.toBeNull()

    await userEvent.click(canvas.getByRole('button', { name: 'Actions' }))
    const item = await within(document.body).findByRole('menuitem', { name: 'Delete' })
    await isRedText(item, canvasElement)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(document.body).queryByRole('menu')).toBeNull())
  },
}

export const VariantsDark: Story = { ...Variants, parameters: { dark: true } }

export const ClientContactDelete: Story = {
  render: () => (
    <div className="grid max-w-xl gap-4">
      <Token />
      <ClientContacts
        client={sampleClient({
          contacts: [
            {
              id: 'con_1',
              name: 'Anna Muster',
              role: null,
              email: null,
              phone: null,
              is_primary: true,
            },
            {
              id: 'con_2',
              name: 'Lena Huber',
              role: null,
              email: null,
              phone: null,
              is_primary: false,
            },
          ],
        })}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Actions for Lena Huber' }))
    const item = await within(document.body).findByRole('menuitem', { name: 'Delete' })
    await isRedText(item, canvasElement)
    await userEvent.click(item)
    const confirm = await within(document.body).findByRole('button', { name: 'Remove contact' })
    await expect(getComputedStyle(confirm).backgroundColor).toBe(tokenFill(canvasElement))
    await expect(
      getComputedStyle(within(document.body).getByRole('button', { name: 'Keep it' })).color,
    ).not.toBe(tokenText(canvasElement))
  },
}

const member = (over: Partial<Member>): Member => ({
  user_id: 'usr_story',
  name: 'Anna Muster',
  email: 'anna@example.com',
  avatar_url: null,
  role: 'owner',
  scopes: null,
  joined_at: '2026-01-05T09:00:00Z',
  last_active_at: null,
  is_you: true,
  ...over,
})

export const MemberRemove: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/members', () =>
          HttpResponse.json({
            data: [
              member({}),
              member({
                user_id: 'usr_2',
                name: 'Lena Huber',
                email: 'lena@example.com',
                role: 'member',
                scopes: [],
                is_you: false,
              }),
            ],
          }),
        ),
        http.get('/api/v1/members/invitations', () => HttpResponse.json({ data: [] })),
        ...screenHandlers,
      ],
    },
  },
  render: () => (
    <SidebarProvider>
      <div className="grid w-full content-start gap-4">
        <Token />
        <MembersPage />
      </div>
    </SidebarProvider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'Actions for Lena Huber' }))
    const item = await within(document.body).findByRole('menuitem', {
      name: 'Remove from workspace',
    })
    await isRedText(item, canvasElement)
    await userEvent.click(item)
    const confirm = await within(document.body).findByRole('button', { name: 'Remove member' })
    await expect(getComputedStyle(confirm).backgroundColor).toBe(tokenFill(canvasElement))
  },
}

export const WorkspaceDeleteConfirm: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/heidi/usage', () =>
          HttpResponse.json({ enabled: false, used: 0, limit: 0 }),
        ),
        ...screenHandlers,
      ],
    },
  },
  render: () => (
    <SidebarProvider>
      <div className="grid w-full content-start gap-4">
        <Token />
        <WorkspaceSettings />
      </div>
    </SidebarProvider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // In the page's danger zone it is a red outline button; the dialog's confirm is the solid one.
    const open = await canvas.findByRole('button', { name: 'Delete workspace' })
    await expect(open).toHaveAttribute('data-variant', 'destructive-outline')
    await isRedText(open, canvasElement)
    await expect(getComputedStyle(open).backgroundColor).not.toBe(tokenFill(canvasElement))
    await userEvent.click(open)
    const dialog = await within(document.body).findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Delete workspace' })
    await waitFor(() =>
      expect(getComputedStyle(confirm).backgroundColor).toBe(tokenFill(canvasElement)),
    )
    await expect(confirm.querySelector('svg')).not.toBeNull()
    await expect(
      getComputedStyle(within(dialog).getByRole('button', { name: 'Keep it' })).color,
    ).not.toBe(tokenText(canvasElement))
  },
}

const storyDocument: DocFile = {
  id: 'doc_story',
  name: 'Service agreement.pdf',
  folder_id: null,
  folder: null,
  size: 2048,
  content_type: 'application/pdf',
  kind: 'pdf',
  sha256: '0'.repeat(64),
  tags: [],
  ai_filing: null,
  previewable: true,
  links: [],
  retained_until: null,
  uploaded_by: storySession.user,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  deleted_at: null,
  deleted_by: null,
  purge_at: null,
}

export const DocumentMoveToTrash: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/documents/doc_story', () => HttpResponse.json({ data: storyDocument })),
        ...screenHandlers,
      ],
    },
  },
  render: () => (
    <>
      <Token />
      <Preview
        id="doc_story"
        siblings={[]}
        commands={{
          rename: fn(),
          move: fn(),
          copy: fn(),
          trash: fn(),
          restore: fn(),
          link: fn(),
          unlink: fn(),
          openFolder: fn(),
          sign: fn(),
        }}
        onNavigate={fn()}
        onClose={fn()}
      />
    </>
  ),
  play: async ({ canvasElement }) => {
    const body = within(document.body)
    await userEvent.click(await body.findByRole('button', { name: 'More' }))
    const item = await body.findByRole('menuitem', { name: 'Move to Trash' })
    await isRedText(item, canvasElement)
    await expect(item.querySelector('svg')).not.toBeNull()
  },
}
