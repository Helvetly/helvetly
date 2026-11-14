import { Button } from '@helvetly/ui/components/button'
import { ConfirmDialog } from '@helvetly/ui/components/confirm-dialog'
import { FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { FileText } from 'lucide-react'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { LoadProblem } from '@/components/data/load-problem'
import { State } from '@/components/data/table-page'
import { newUploads, type Upload } from '@/components/documents/upload-queue'
import { UploadTray } from '@/components/documents/upload-tray'
import { WizardSheet } from '@/components/wizard-sheet'
import { ApiError } from '@/lib/api'

const meta = { title: 'Shared flows/States' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const retry = fn()
export const OfflineRetry: Story = {
  render: () => (
    <LoadProblem
      error={new ApiError(0, 'network_error', 'Offline')}
      what="The catalogue"
      onRetry={retry}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent('Check your connection')
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await expect(retry).toHaveBeenCalledOnce()
  },
}

export const EmptyList: Story = {
  render: () => (
    <State
      icon={<FileText />}
      title="No invoices yet"
      text="Create an invoice when you are ready."
      action={<Button>New invoice</Button>}
    />
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(within(canvasElement).getByText('No invoices yet')).toBeVisible())
    await expect(within(canvasElement).getByRole('button', { name: 'New invoice' })).toBeEnabled()
  },
}

function Confirmation({ destructive = true }: { destructive?: boolean }) {
  const [decision, setDecision] = useState<boolean | null>(null)
  return decision === null ? (
    <ConfirmDialog
      title="Delete draft?"
      body="The draft will be removed. Issued financial records are kept."
      confirmLabel="Delete draft"
      tone={destructive ? 'destructive' : 'default'}
      onDecide={setDecision}
    />
  ) : (
    <output aria-label="Decision">{decision ? 'Approved' : 'Cancelled'}</output>
  )
}

export const DestructiveConfirmation: Story = {
  render: () => <Confirmation />,
  play: async () => {
    const body = within(document.body)
    await waitFor(() => expect(body.getByRole('dialog', { name: 'Delete draft?' })).toBeVisible())
    const confirm = body.getByRole('button', { name: 'Delete draft' })
    await expect(confirm).toHaveAttribute('data-variant', 'destructive')
    await userEvent.click(confirm)
    await expect(body.getByRole('status', { name: 'Decision' })).toHaveTextContent('Approved')
  },
}

export const EscapeCancelsConfirmation: Story = {
  render: () => <Confirmation />,
  play: async () => {
    await userEvent.keyboard('{Escape}')
    await expect(
      await within(document.body).findByRole('status', { name: 'Decision' }),
    ).toHaveTextContent('Cancelled')
  },
}

const closeWizard = fn()
const changeStep = fn()
function Wizard({ busy = false }: { busy?: boolean }) {
  return (
    <WizardSheet
      icon={<FileText />}
      title="Prepare document"
      steps={['Document', 'Recipients', 'Review']}
      step={1}
      onStep={changeStep}
      dirty
      busy={busy}
      discardTitle="Discard this document?"
      onClose={closeWizard}
      status={busy ? 'Saving document…' : 'Changes not saved'}
      action={<Button disabled={busy}>{busy ? 'Saving…' : 'Next'}</Button>}
    >
      <div className="p-6">
        <FormField id="wizard-title" label="Document title">
          <Input id="wizard-title" defaultValue="Contract" />
        </FormField>
      </div>
    </WizardSheet>
  )
}

export const UnsavedWizard: Story = {
  render: () => <Wizard />,
  play: async () => {
    const body = within(document.body)
    await userEvent.click(body.getByRole('button', { name: 'Close' }))
    await waitFor(() =>
      expect(body.getByRole('dialog', { name: 'Discard this document?' })).toBeVisible(),
    )
    await userEvent.click(body.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() =>
      expect(body.getByRole('dialog', { name: 'Prepare document' })).toBeVisible(),
    )
    await expect(closeWizard).not.toHaveBeenCalled()
  },
}

export const BusyWizardCannotCloseOrNavigate: Story = {
  render: () => <Wizard busy />,
  play: async () => {
    const body = within(document.body)
    await expect(body.getByRole('button', { name: 'Close' })).toBeDisabled()
    await expect(body.getByRole('button', { name: 'Back' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(body.getByRole('dialog', { name: 'Prepare document' })).toBeVisible(),
    )
    await expect(closeWizard).not.toHaveBeenCalled()
    await expect(changeStep).not.toHaveBeenCalled()
  },
}

function DuplicateUpload() {
  const [uploads, setUploads] = useState(() => {
    const initial = newUploads(
      [new File(['same content'], 'renamed.pdf', { type: 'application/pdf' })],
      null,
      'Documents',
    )
    return initial.map((upload): Upload =>
      Object.assign(upload, {
        status: 'failed' as const,
        error: 'This file has already been uploaded as original.pdf.',
      }),
    )
  })
  return (
    <UploadTray
      uploads={uploads}
      act={(action) => {
        if (action.type === 'clear') setUploads([])
      }}
    />
  )
}

export const DuplicateFileFeedback: Story = {
  render: () => <DuplicateUpload />,
  play: async () => {
    const body = within(document.body)
    await expect(body.getByRole('region', { name: 'Uploads' })).toHaveTextContent(
      'This file has already been uploaded as original.pdf.',
    )
    await expect(body.getByRole('region', { name: 'Uploads' })).toHaveTextContent('1 failed')
    await expect(body.queryByText('Upload complete', { exact: true })).not.toBeInTheDocument()
  },
}
