import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useMemo } from 'react'
import { expect, waitFor } from 'storybook/test'

import { PdfView } from '@/components/invoices/pdf-view'
import { blankPdf } from '@/mocks/blank-pdf'

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
