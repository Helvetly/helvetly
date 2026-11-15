import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Composer } from '@/components/heidi/composer'
import { MAX_MESSAGE } from '@/lib/heidi'
import { MAX_IMPORT_FILES } from '@/lib/imports'

const meta = { title: 'Heidi/Composer' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
const send = fn()
const stop = fn()
const emptyAttachments: File[] = []

function Editor({
  initial = '',
  busy = false,
  attachments = emptyAttachments,
}: {
  initial?: string
  busy?: boolean
  attachments?: File[]
}) {
  const [value, setValue] = useState(initial)
  const [files, setFiles] = useState(attachments)
  return (
    <div className="max-w-lg">
      <Composer
        value={value}
        onChange={setValue}
        files={files}
        onAddFiles={(added) => setFiles((current) => [...current, ...added])}
        onRemoveFile={(file) => setFiles((current) => current.filter((entry) => entry !== file))}
        onSend={send}
        onStop={stop}
        busy={busy}
        placeholder="Ask Heidi…"
      />
    </div>
  )
}

export const EmptyCannotSend: Story = {
  render: () => <Editor />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled()
    await userEvent.type(canvas.getByRole('textbox', { name: 'Message Heidi' }), '   ')
    await userEvent.keyboard('{Enter}')
    await expect(send).not.toHaveBeenCalled()
  },
}

export const EnterSendsShiftEnterDoesNot: Story = {
  render: () => <Editor />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByRole('textbox', { name: 'Message Heidi' }), 'Create a draft')
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    await expect(send).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    await expect(send).toHaveBeenCalledOnce()
  },
}

export const MessageLimit: Story = {
  render: () => <Editor initial={'a'.repeat(MAX_MESSAGE + 1)} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('textbox', { name: 'Message Heidi' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled()
    await expect(canvas.getByText(`${MAX_MESSAGE + 1} / ${MAX_MESSAGE}`)).toBeVisible()
  },
}

export const StreamingCanBeStopped: Story = {
  render: () => <Editor busy initial="Create an invoice" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Stop' }))
    await expect(stop).toHaveBeenCalledOnce()
  },
}

export const AttachmentLimitAndRemoval: Story = {
  render: () => (
    <Editor
      attachments={Array.from(
        { length: MAX_IMPORT_FILES },
        (_, index) => new File(['x'], `receipt-${index + 1}.pdf`, { type: 'application/pdf' }),
      )}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Attach files' })).toBeDisabled()
    await userEvent.click(canvas.getByRole('button', { name: 'Remove receipt-1.pdf' }))
    await expect(canvas.getByRole('button', { name: 'Attach files' })).toBeEnabled()
    await expect(canvas.queryByText('receipt-1.pdf')).not.toBeInTheDocument()
  },
}
