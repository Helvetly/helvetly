import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useMemo } from 'react'
import { expect, waitFor } from 'storybook/test'

import { PdfView } from '@/components/invoices/pdf-view'

/** A valid one-page PDF, blank, so the viewer draws a page. */
function blankPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((body, i) => {
    const at = pdf.length
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
    return at
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}

const meta = {
  title: 'Invoices/PDF view',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The PDF tab of a drawer: the viewer shares the drawer's surface, so there is no box around the page. */
export const OnDrawerSurface: Story = {
  render: function Render() {
    const src = useMemo(
      () => URL.createObjectURL(new Blob([blankPdf()], { type: 'application/pdf' })),
      [],
    )
    return (
      <div
        data-testid="drawer"
        className="flex h-[560px] flex-col gap-3 bg-panel p-4 dark:bg-background"
      >
        <p className="text-body-sm text-muted-foreground">1 page, as last sent</p>
        <PdfView src={src} title="PDF" className="min-h-0 flex-1" />
      </div>
    )
  },
  play: async ({ canvasElement, canvas }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector('canvas[data-pdf-page="1"]')).toBeTruthy(),
    )
    const drawer = canvas.getByTestId('drawer')
    const viewer = canvas.getByRole('document')
    await expect(getComputedStyle(viewer).backgroundColor).toBe(
      getComputedStyle(drawer).backgroundColor,
    )
  },
}
