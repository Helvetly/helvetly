import { createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Pencil, Trash2, Upload } from 'lucide-react'

import { PageContextMenu, RowContextMenu, RowMenuButton, type RowMenuSpec } from './menus'

vi.mock('@/lib/permissions', () => ({ useCanWriteHere: () => true }))

const edit = vi.fn<() => void>()
const remove = vi.fn<() => void>()
const openRow = vi.fn<() => void>()
const menu: RowMenuSpec = {
  title: '#7 · Muster AG',
  items: ({ Item, Separator }) => (
    <>
      <Item onSelect={edit}>
        <Pencil /> Edit
      </Item>
      <Separator />
      <Item variant="destructive" onSelect={remove}>
        <Trash2 /> Delete
      </Item>
    </>
  ),
}

function Row({ bulk }: { bulk?: Parameters<typeof RowContextMenu>[0]['bulk'] }) {
  return (
    <RowContextMenu menu={menu} bulk={bulk}>
      <div data-testid="row">
        <button type="button" onClick={openRow}>
          Muster AG
        </button>
        <input aria-label="Note" />
        <RowMenuButton label="Actions for Muster AG" menu={menu} />
      </div>
    </RowContextMenu>
  )
}

const names = () => screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())

beforeEach(() => vi.clearAllMocks())

test('right-click shows the same actions as the row’s “…” menu, under its title', async () => {
  render(<Row />)
  await userEvent.click(screen.getByRole('button', { name: 'Actions for Muster AG' }))
  const fromButton = names()
  await userEvent.keyboard('{Escape}')

  fireEvent.contextMenu(screen.getByRole('button', { name: 'Muster AG' }))
  const context = await screen.findByRole('menu')
  expect(within(context).getByText('#7 · Muster AG')).toBeInTheDocument()
  expect(names()).toEqual(fromButton)
  expect(names()).toEqual(['Edit', 'Delete'])

  await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
  expect(edit).toHaveBeenCalledOnce()
  // Right-click neither opens the row nor selects it.
  expect(openRow).not.toHaveBeenCalled()
})

test('a row in a larger selection offers the bulk actions, destructive last', async () => {
  const exportCsv = vi.fn<() => void>()
  const deleteAll = vi.fn<() => void>()
  render(
    <Row
      bulk={{
        count: 3,
        actions: [
          { label: 'Delete', icon: <Trash2 />, onClick: deleteAll, destructive: true },
          { label: 'Export CSV', icon: <Upload />, onClick: exportCsv },
        ],
      }}
    />,
  )
  fireEvent.contextMenu(screen.getByTestId('row'))
  const context = await screen.findByRole('menu')
  expect(within(context).getByText('3 selected')).toBeInTheDocument()
  expect(names()).toEqual(['Export CSV', 'Delete'])
  expect(within(context).getByRole('separator')).toBeInTheDocument()

  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
  expect(deleteAll).toHaveBeenCalledOnce()
  expect(remove).not.toHaveBeenCalled()
})

test('a selection of one is just the row', async () => {
  render(<Row bulk={{ count: 1, actions: [] }} />)
  fireEvent.contextMenu(screen.getByTestId('row'))
  expect(await screen.findByText('#7 · Muster AG')).toBeInTheDocument()
})

test('text fields keep the browser’s own menu', () => {
  render(<Row />)
  const input = screen.getByRole('textbox', { name: 'Note' })
  const event = createEvent.contextMenu(input)
  fireEvent(input, event)
  expect(event.defaultPrevented).toBe(false)
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

test('the page menu: its actions, select all, views and refresh; rows keep their own', async () => {
  const create = vi.fn<() => void>()
  const selectAll = vi.fn<() => void>()
  const pick = vi.fn<(index: number) => void>()
  const refresh = vi.fn<() => void>()
  render(
    <PageContextMenu
      title="Clients"
      primary={{ label: 'New client', onSelect: create }}
      items={({ Item }) => <Item onSelect={vi.fn<() => void>()}>Export CSV</Item>}
      views={{ tabs: ['All', 'Active'], active: 0, onSelect: pick }}
      selectAll={{ onSelect: selectAll }}
      onRefresh={refresh}
    >
      <div data-testid="surface">
        <Row />
      </div>
    </PageContextMenu>,
  )

  fireEvent.contextMenu(screen.getByTestId('row'))
  expect(await screen.findByText('#7 · Muster AG')).toBeInTheDocument()
  expect(screen.getAllByRole('menu')).toHaveLength(1)
  await userEvent.keyboard('{Escape}')

  fireEvent.contextMenu(screen.getByTestId('surface'))
  const context = await screen.findByRole('menu')
  expect(within(context).getByText('Clients')).toBeInTheDocument()
  expect(names()).toEqual(['New client', 'Export CSV', 'Select all', 'View', 'Refresh'])

  await userEvent.click(screen.getByRole('menuitem', { name: 'View' }))
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Active' }))
  expect(pick).toHaveBeenCalledWith(1)

  fireEvent.contextMenu(screen.getByTestId('surface'))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'New client' }))
  expect(create).toHaveBeenCalledOnce()
})
