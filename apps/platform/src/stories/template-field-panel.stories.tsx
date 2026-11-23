import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test'

import { PrintSettingsFields } from '@/components/templates/print-settings'
import { TemplateEditor } from '@/components/templates/template-editor'
import type { PrintSettings, Template } from '@/lib/templates'
import { blankPdf } from '@/mocks/blank-pdf'

import { screenHandlers } from './screen-fixtures'

const meta = {
  title: 'Templates/Field panel',
  parameters: {
    msw: {
      handlers: [
        // A real page, so placed fields are drawn on it.
        http.get('/api/v1/documents/doc_story/content', () =>
          HttpResponse.text(blankPdf(), { headers: { 'Content-Type': 'application/pdf' } }),
        ),
        ...screenHandlers,
      ],
    },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function Panel() {
  const [value, setValue] = useState<PrintSettings>({})
  return (
    <div className="w-[308px] rounded-xl border p-3">
      <PrintSettingsFields
        value={value}
        sample="23.11.2026"
        onChange={(change) => setValue({ ...value, ...change })}
      />
      <output data-testid="settings">{JSON.stringify(value)}</output>
    </div>
  )
}

const settings = (canvas: HTMLElement): PrintSettings =>
  JSON.parse(within(canvas).getByTestId('settings').textContent ?? '{}')

// The size steps by whole points between 8 and 24, typed sizes are clamped, and presets set it at once.
export const FontSizeStepper: Story = {
  render: () => <Panel />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const size = canvas.getByRole('textbox', { name: 'Font size' })
    const smaller = canvas.getByRole('button', { name: 'Smaller' })
    await expect(size).toHaveValue('10')
    await userEvent.click(smaller)
    await userEvent.click(smaller)
    await expect(size).toHaveValue('8')
    await expect(smaller).toBeDisabled()

    await userEvent.clear(size)
    await userEvent.type(size, '40{Enter}')
    await expect(size).toHaveValue('24')
    await expect(canvas.getByRole('button', { name: 'Larger' })).toBeDisabled()
    await expect(settings(canvasElement).font_size).toBe(24)

    await userEvent.click(canvas.getByRole('button', { name: 'Common sizes' }))
    await userEvent.click(await within(document.body).findByRole('button', { name: '14 pt' }))
    await expect(size).toHaveValue('14')
    await expect(settings(canvasElement).font_size).toBe(14)
    // the preview prints at the chosen size
    await expect(canvas.getByText('23.11.2026').closest('p')?.style.fontSize).toBe('14pt')
  },
}

// Alignment is one segmented control; Auto-fit a switch whose explanation sits in a (?) tooltip.
export const AlignmentAndAutoFit: Story = {
  render: () => <Panel />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const centre = canvas.getByRole('button', { name: 'Centre' })
    await userEvent.click(centre)
    await expect(centre).toHaveAttribute('aria-pressed', 'true')
    await expect(canvas.getByRole('button', { name: 'Align left' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await expect(settings(canvasElement).align).toBe('center')

    const autoFit = canvas.getByRole('switch', { name: 'Auto-fit' })
    await userEvent.click(autoFit)
    await expect(autoFit).toBeChecked()
    await expect(settings(canvasElement).auto_fit).toBe(true)
    await expect(canvas.queryByText(/Shrinks long text/)).toBeNull()
    await expect(canvasElement.querySelector('select')).toBeNull()
  },
}

const box = { page: 1, w: 0.3, h: 0.06 }
const template: Template = {
  id: 'tpl_panel',
  name: 'Offer letter',
  description: null,
  document: { id: 'doc_story', name: 'Offer letter.pdf' },
  signers: [],
  fields: [
    { id: 'fld_name', kind: 'client.name', signer: null, ...box, x: 0.1, y: 0.1, label: null },
    { id: 'fld_today', kind: 'today', signer: null, ...box, x: 0.16, y: 0.3, label: null },
  ],
  used_count: 0,
  last_used_at: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
}

const editor = () => (
  <>
    <TemplateEditor
      template={template}
      initialDocument={null}
      folderId={null}
      onClose={fn()}
      onSaved={fn()}
    />
    <Toaster />
  </>
)

// Remove field goes at once, and the toast's Undo puts it back.
export const RemoveWithUndo: Story = {
  render: editor,
  play: async () => {
    const body = within(document.body)
    const placed = await body.findByRole('region', { name: 'In this document' })
    await userEvent.click(within(placed).getByRole('button', { name: /^Today’s date/ }))
    const panel = body.getByRole('region', { name: 'Field settings' })
    await expect(within(panel).getByText('p. 1')).toBeVisible()
    await userEvent.click(within(panel).getByRole('button', { name: 'Remove field' }))
    await waitFor(() => expect(within(placed).getAllByRole('listitem')).toHaveLength(1))
    // the toaster sits outside the modal sheet, so it is hidden from the sheet's accessibility tree
    await userEvent.click(await body.findByRole('button', { name: 'Undo', hidden: true }))
    await waitFor(() => expect(within(placed).getAllByRole('listitem')).toHaveLength(2))
  },
}

const fieldBox = (caption: string) => {
  const element = [...document.querySelectorAll<HTMLElement>('[data-field-key]')].find(
    (candidate) => candidate.textContent === caption,
  )
  if (!element) throw new Error(`no field ${caption}`)
  return element
}

// Dragging with Shift snaps the field's left edge to the other field's and shows a guide; without, it moves freely.
export const ShiftSnapsToOtherFields: Story = {
  render: editor,
  play: async () => {
    await within(document.body).findByRole('region', { name: 'In this document' })
    await waitFor(() => fieldBox('Today’s date'), { timeout: 8000 })
    const target = fieldBox('Client name').getBoundingClientRect().left
    const drag = (shiftKey: boolean) => {
      const moving = fieldBox('Today’s date')
      const start = moving.getBoundingClientRect()
      const from = { clientX: start.left + 10, clientY: start.top + 5, pointerId: 1 }
      // to 3 px right of the other field's left edge
      const to = { ...from, clientX: from.clientX + target + 3 - start.left, shiftKey }
      fireEvent.pointerDown(moving, { ...from, button: 0 })
      fireEvent.pointerMove(moving, to)
      return { moving, to }
    }

    const snapped = drag(true)
    await waitFor(() =>
      expect(Math.abs(fieldBox('Today’s date').getBoundingClientRect().left - target)).toBeLessThan(
        0.75,
      ),
    )
    await expect(document.querySelector('[data-snap-guide="x"]')).not.toBeNull()
    fireEvent.pointerUp(snapped.moving, snapped.to)
    await waitFor(() => expect(document.querySelector('[data-snap-guide]')).toBeNull())

    const free = drag(false)
    await waitFor(() =>
      expect(fieldBox('Today’s date').getBoundingClientRect().left - target).toBeGreaterThan(2),
    )
    fireEvent.pointerUp(free.moving, free.to)
  },
}
