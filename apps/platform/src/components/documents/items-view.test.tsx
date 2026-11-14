import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import type { DocFile } from '@/lib/documents'

import { ItemsView } from './items-view'
import { clickSelect, EMPTY_SELECTION, fileKey, type Selection } from './selection'

vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    disconnect() {}
  },
)

const file = (id: string, name: string): DocFile => ({
  id,
  name,
  folder_id: null,
  folder: null,
  size: 1200,
  content_type: 'text/plain',
  kind: 'text',
  sha256: null,
  previewable: false,
  links: [],
  retained_until: null,
  uploaded_by: null,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
  deleted_at: null,
  deleted_by: null,
  purge_at: null,
})

const files = [file('a', 'a.txt'), file('b', 'b.txt')]
const order = files.map((entry) => fileKey(entry.id))

function Harness({ layout }: { layout: 'grid' | 'list' }) {
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION)
  return (
    <ItemsView
      layout={layout}
      folders={[]}
      files={files}
      selected={selection.keys}
      focused={null}
      renaming={null}
      showLocation={false}
      from={null}
      sort="name"
      desc={false}
      onSort={() => {}}
      // A plain click replaces the selection: the checkboxes must not reach it.
      onClick={(key) => setSelection({ keys: new Set([key]), anchor: key })}
      onToggle={(key) =>
        setSelection(clickSelect(selection, key, order, { shift: false, toggle: true }))
      }
      onToggleAll={() => {}}
      onOpen={() => {}}
      onRenameDone={() => {}}
      onContext={() => {}}
      menu={() => null}
      onBand={() => {}}
      onBackground={() => {}}
      collapsed={new Set()}
      onToggleSection={() => {}}
    />
  )
}

test.each(['grid', 'list'] as const)(
  'in the %s, clicking two checkboxes selects both',
  async (layout) => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Harness layout={layout} />
      </QueryClientProvider>,
    )

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select a.txt' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select b.txt' }))

    expect(screen.getByRole('checkbox', { name: 'Select a.txt' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select b.txt' })).toBeChecked()
  },
)
