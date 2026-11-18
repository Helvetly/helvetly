import type { StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, waitFor, within } from 'storybook/test'

import { clearHandOff, peekHandOff } from '@/components/import/hand-off'
import type { ImportKind } from '@/lib/imports'

import { emptyPage, storySession } from '../screen-fixtures'
import { pageParameters } from './frame'

type Story = StoryObj

const body = () => within(document.body)

/** No unfinished import to offer, so the drawer opens straight on the chosen files. */
const noBatches = http.get('/api/v1/imports', () => HttpResponse.json({ data: [] }))

/** The page with an empty list at `list`, as a new workspace sees it. */
export const emptyList = (pathname: string, list: string) =>
  pageParameters(pathname, {}, [http.get(list, () => HttpResponse.json(emptyPage)), noBatches])

/** The page for a member who may read everything and change nothing. */
export const readOnly = (pathname: string) =>
  pageParameters(pathname, {}, [
    http.get('/api/v1/session', () =>
      HttpResponse.json({ ...storySession, role: 'member', scopes: ['read:*'] }),
    ),
  ])

/** Files from the desktop dragged over the page, the way a browser sends them. */
function drag(type: 'dragenter' | 'dragover' | 'drop', files: File[]) {
  const data = new DataTransfer()
  for (const file of files) data.items.add(file)
  document.body.dispatchEvent(
    new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }),
  )
}

const overlay = () => document.querySelector('[data-slot=drop-overlay]')

/** The empty list offers Import next to its own first action, and says a drop works too. */
export const emptyOffersImport =
  (title: string): Story['play'] =>
  async () => {
    await body().findByText(title, {}, { timeout: 8000 })
    await waitFor(() =>
      expect(body().getByText('or drop files anywhere on this page')).toBeVisible(),
    )
    await expect(body().getByRole('button', { name: 'Import' })).toBeVisible()
  }

/**
 * Dragging a file over the page shows what a drop does; dropping it opens the import (`?import=1`) with the
 * file handed to the drawer. Storybook's router does not follow the URL, so the drawer itself is checked in E2E.
 */
export const dropOpensImport =
  (ready: string, title: string, kind: ImportKind, file: File): Story['play'] =>
  async () => {
    await body().findAllByText(ready, {}, { timeout: 8000 })
    drag('dragenter', [file])
    drag('dragover', [file])
    await waitFor(() => expect(overlay()).toHaveTextContent(title))
    drag('drop', [file])
    await waitFor(() => expect(overlay()).toBeNull())
    await waitFor(() => expect(new URL(window.location.href).searchParams.get('import')).toBe('1'))
    await expect(peekHandOff(kind).map((handed) => handed.name)).toEqual([file.name])
    clearHandOff()
  }

/** Without the right to change the page's records, a drag shows nothing, a drop opens nothing and no hint says otherwise. */
export const noDropTarget =
  (ready: string, kind: ImportKind): Story['play'] =>
  async () => {
    await body().findAllByText(ready, {}, { timeout: 8000 })
    const file = new File(['a'], 'list.csv', { type: 'text/csv' })
    drag('dragenter', [file])
    drag('drop', [file])
    await new Promise((resolve) => setTimeout(resolve, 300))
    await expect(overlay()).toBeNull()
    await expect(new URL(window.location.href).searchParams.get('import')).toBeNull()
    await expect(peekHandOff(kind)).toEqual([])
    await expect(body().queryByText('or drop files anywhere on this page')).toBeNull()
  }
