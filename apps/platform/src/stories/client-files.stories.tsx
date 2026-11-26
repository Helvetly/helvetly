import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ClientFiles } from '@/components/clients/client-files'
import type { ClientFile } from '@/lib/clients'

import { sessionHandler } from './screen-fixtures'

const receipt: ClientFile = {
  id: 'doc_1',
  name: 'Receipt Migros.pdf',
  size: 8_192,
  content_type: 'application/pdf',
  created_at: '2026-11-06T10:00:00Z',
  uploaded_by: { id: 'usr_1', name: 'Anna Muster' },
}
const contract: ClientFile = {
  id: 'doc_2',
  name: 'Framework agreement 2026 with a long name that has to truncate.docx',
  size: 2_400_000,
  content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  created_at: '2026-10-20T10:00:00Z',
  uploaded_by: null,
}
const logo: ClientFile = {
  id: 'doc_3',
  name: 'logo.png',
  size: 52_000,
  content_type: 'image/png',
  created_at: '2026-09-02T10:00:00Z',
  uploaded_by: { id: 'usr_1', name: 'Anna Muster' },
}

const uploaded = fn()
const deleted = fn()
const requests = fn()

const handlers = (initial: ClientFile[]) => {
  let files = initial
  let next = 0 // ids stay unique across packs
  return [
    sessionHandler(),
    http.get('/api/v1/clients/cli_1/files', () => HttpResponse.json({ data: files })),
    http.post('/api/v1/clients/cli_1/files', async ({ request }) => {
      const form = await request.formData()
      requests(form.getAll('files[]').length)
      // The stored record describes the file that was sent, as the server's does.
      const added = form
        .getAll('files[]')
        .filter((entry) => entry instanceof File)
        .map((file): ClientFile => {
          uploaded(file.name)
          return {
            id: `new_${next++}`,
            name: file.name,
            size: file.size,
            content_type: file.type,
            created_at: '2026-11-11T10:00:00Z',
            uploaded_by: receipt.uploaded_by,
          }
        })
      files = [...added, ...files]
      return HttpResponse.json({ data: added }, { status: 201 })
    }),
    http.delete('/api/v1/clients/cli_1/files/:fileId', ({ params }) => {
      deleted(params.fileId)
      files = files.filter((file) => file.id !== params.fileId)
      return new HttpResponse(null, { status: 204 })
    }),
  ]
}

const meta = {
  title: 'Clients/Files',
  parameters: { msw: { handlers: handlers([receipt, contract, logo]) } },
  render: () => (
    <div className="max-w-3xl bg-background p-5">
      <ClientFiles clientId="cli_1" />
      <Toaster />
    </div>
  ),
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = within(document.body)
/** A real drag event: Testing Library's fireEvent copies only own properties, so a DataTransfer arrives empty. */
const drag = (target: Element, type: string, dataTransfer: DataTransfer) =>
  target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }))
const panel = async () =>
  within((await body.findByRole('heading', { name: /^Files/ })).closest('section') ?? document.body)

/** A header with the count and Upload, then tidy rows with name, size, date and uploader. */
export const List: Story = {
  play: async () => {
    const files = await panel()
    await expect(await files.findByText('Receipt Migros.pdf')).toBeVisible()
    await expect(files.getByRole('heading', { name: 'Files 3' })).toBeVisible()
    await expect(files.getAllByTitle('8 KB · 6 Nov 2026 · Anna Muster')[0]).toBeVisible()
    // An uploader whose account is gone is left out.
    await expect(files.getByText('2.3 MB · 20 Oct 2026')).toBeVisible()
    await expect(files.getByRole('link', { name: 'Receipt Migros.pdf' })).toHaveAttribute(
      'href',
      '/api/v1/clients/cli_1/files/doc_1',
    )
    await expect(files.getByRole('link', { name: 'Preview Receipt Migros.pdf' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/documents\/?\?file=doc_1$/),
    )
    await expect(files.getByRole('link', { name: 'Download Receipt Migros.pdf' })).toHaveAttribute(
      'href',
      '/api/v1/clients/cli_1/files/doc_1',
    )
    // No standing drop zone: the drop area only shows while dragging.
    await expect(body.queryByText('Drop to upload to this client')).toBeNull()
  },
}

/** Every icon-only action names itself in a tooltip; keyboard focus reveals the row's actions. */
export const RowActions: Story = {
  play: async () => {
    const files = await panel()
    const preview = await files.findByRole('link', { name: 'Preview Receipt Migros.pdf' })
    await userEvent.hover(preview)
    await expect(
      await body.findByRole('tooltip', { name: 'Preview in Documents' }),
    ).toBeInTheDocument()
    await userEvent.unhover(preview)
    await userEvent.hover(files.getByRole('button', { name: 'Delete Receipt Migros.pdf' }))
    await expect(await body.findByRole('tooltip', { name: 'Delete' })).toBeInTheDocument()
    await userEvent.hover(files.getByRole('button', { name: 'Upload' }))
    await expect(
      await body.findByRole('tooltip', {
        name: 'PDF, images, Office, CSV or text · up to 25 MB each',
      }),
    ).toBeInTheDocument()
  },
}

/** Delete asks first, says the file goes to the Trash, then the row leaves. */
export const Delete: Story = {
  parameters: { msw: { handlers: handlers([receipt, contract]) } },
  play: async () => {
    deleted.mockClear()
    const files = await panel()
    await userEvent.click(await files.findByRole('button', { name: 'Delete Receipt Migros.pdf' }))
    const dialog = await body.findByRole('dialog', { name: 'Delete Receipt Migros.pdf?' })
    await expect(dialog).toHaveTextContent('Trash in Documents')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete file' }))
    await waitFor(() => expect(deleted).toHaveBeenCalledWith('doc_1'))
    await expect(
      await body.findByText('Receipt Migros.pdf moved to the Trash.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(files.queryByText('Receipt Migros.pdf')).toBeNull())
  },
}

/** Upload picks files through the same upload flow; the new file lands at the top of the list. */
export const Upload: Story = {
  parameters: { msw: { handlers: handlers([receipt]) } },
  play: async () => {
    uploaded.mockClear()
    const files = await panel()
    await files.findByText('Receipt Migros.pdf')
    await userEvent.upload(
      files.getByLabelText('Upload files'),
      new File(['hello'], 'Offer.pdf', { type: 'application/pdf' }),
    )
    await waitFor(() => expect(uploaded).toHaveBeenCalledWith('Offer.pdf'))
    await expect(await files.findByText('Offer.pdf')).toBeVisible()
    await expect(await body.findByText('Offer.pdf uploaded.')).toBeInTheDocument()
  },
}

const MB = 1024 * 1024
/** Distinct files of almost 20 MB each: five of them pass the 95 MB that one request may carry. */
const bigFiles = (count: number) =>
  Array.from(
    { length: count },
    (_, i) =>
      new File([new Uint8Array(19.5 * MB - i)], `Scan ${i + 1}.pdf`, { type: 'application/pdf' }),
  )

/** Over 95 MB in all: the files go in two requests under Cloudflare's 100 MB, with one progress and one toast. */
export const UploadInPacks: Story = {
  parameters: { msw: { handlers: handlers([]) } },
  play: async () => {
    uploaded.mockClear()
    requests.mockClear()
    const files = await panel()
    await files.findByText('No files yet')
    await userEvent.upload(files.getByLabelText('Upload files'), bigFiles(5))
    await expect(
      await body.findByText('5 files uploaded.', {}, { timeout: 10_000 }),
    ).toBeInTheDocument()
    await expect(requests.mock.calls).toEqual([[4], [1]])
    await expect(await files.findByText('Scan 5.pdf')).toBeVisible()
  },
}

/** The same bytes twice, in different packs: sent once, the copy dropped before anything is sent. */
export const DuplicateAcrossPacks: Story = {
  parameters: { msw: { handlers: handlers([]) } },
  play: async () => {
    requests.mockClear()
    const files = await panel()
    await files.findByText('No files yet')
    const picked = bigFiles(5)
    const first = picked[0]
    if (!first) throw new Error('No files')
    const copy = new File([first], 'Scan 1 copy.pdf', { type: 'application/pdf' })
    uploaded.mockClear()
    await userEvent.upload(files.getByLabelText('Upload files'), [...picked, copy])
    // The same bytes twice in one upload go once: the copy is dropped, the rest is sent.
    await waitFor(() => expect(uploaded).toHaveBeenCalledTimes(picked.length), { timeout: 10_000 })
    await expect(uploaded).not.toHaveBeenCalledWith('Scan 1 copy.pdf')
  },
}

/** A file over 25 MB is refused before anything is sent. */
export const TooLarge: Story = {
  parameters: { msw: { handlers: handlers([]) } },
  play: async () => {
    requests.mockClear()
    const files = await panel()
    await files.findByText('No files yet')
    await userEvent.upload(files.getByLabelText('Upload files'), [
      new File(['ok'], 'Small.pdf', { type: 'application/pdf' }),
      new File([new Uint8Array(25 * MB + 1)], 'Huge.pdf', { type: 'application/pdf' }),
    ])
    await expect(await body.findByText('Huge.pdf is larger than 25 MB.')).toBeInTheDocument()
    await expect(requests).not.toHaveBeenCalled()
  },
}

/** Dragging files over the tab shows the drop overlay; dropping uploads them. */
export const DragAndDrop: Story = {
  parameters: { msw: { handlers: handlers([]) } },
  play: async () => {
    uploaded.mockClear()
    const files = await panel()
    const area = (await files.findByText('No files yet')).closest('[data-slot="empty-state"]')
    if (!area) throw new Error('The empty state is missing')
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(new File(['x'], 'Contract.pdf', { type: 'application/pdf' }))
    drag(area, 'dragenter', dataTransfer)
    await expect(await body.findByText('Drop to upload to this client')).toBeVisible()
    drag(area, 'drop', dataTransfer)
    await waitFor(() => expect(body.queryByText('Drop to upload to this client')).toBeNull())
    await waitFor(() => expect(uploaded).toHaveBeenCalledWith('Contract.pdf'))
    await expect(await files.findByText('Contract.pdf')).toBeVisible()
  },
}

/** A dragged link or text is not a file: no overlay. */
export const DragText: Story = {
  play: async () => {
    const files = await panel()
    const row = await files.findByText('Receipt Migros.pdf')
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/plain', 'a link')
    drag(row, 'dragenter', dataTransfer)
    await expect(body.queryByText('Drop to upload to this client')).toBeNull()
  },
}

/** Nothing yet: one calm empty state that says what to drop. */
export const Empty: Story = {
  parameters: { msw: { handlers: handlers([]) } },
  play: async () => {
    const files = await panel()
    await expect(await files.findByText('No files yet')).toBeVisible()
    await expect(files.getByRole('heading', { name: 'Files' })).toBeVisible()
  },
}

export const ListDark: Story = { ...List, parameters: { ...List.parameters, dark: true } }

export const ListPhone: Story = {
  ...List,
  parameters: {
    ...List.parameters,
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
  play: async (context) => {
    await List.play?.(context)
    // The row's actions stay visible without hover on a phone.
    const files = await panel()
    await expect(files.getByRole('button', { name: 'Delete Receipt Migros.pdf' })).toBeVisible()
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth),
    )
  },
}
