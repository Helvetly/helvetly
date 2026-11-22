import { Button } from '@helvetly/ui/components/button'
import { DataTable, type DataColumn } from '@helvetly/ui/components/data-table'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'

const TABLE = 'story'
const KEY = `helvetly.table.${TABLE}.columns`

type Row = { id: string; number: string; client: string; due: string; total: string }
const ROWS: Row[] = [
  {
    id: '1',
    number: '2026/INV/001',
    client: 'Muster AG',
    due: '18 Dec 2026',
    total: 'CHF 1’611.60',
  },
  {
    id: '2',
    number: '2026/INV/002',
    client: 'Shuchi Kumra',
    due: '19 Feb 2027',
    total: 'CHF 99.00',
  },
]

const COLUMNS: DataColumn<Row>[] = [
  {
    id: 'number',
    header: 'Number',
    size: 128,
    minSize: 80,
    maxSize: 260,
    sortable: true,
    cell: (row) => row.number,
  },
  {
    id: 'client',
    header: 'Client',
    flex: true,
    minSize: 200,
    sortable: true,
    cell: (row) => row.client,
  },
  { id: 'due', header: 'Due', size: 128, minSize: 96, cell: (row) => row.due },
  { id: 'total', header: 'Amount', size: 140, align: 'right', cell: (row) => row.total },
  { id: 'status', header: 'Status', size: 112, resizable: false, cell: () => 'Paid' },
]

function Table() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [sort, setSort] = useState<{ column?: string; desc: boolean }>({ desc: false })
  const [opened, setOpened] = useState('')
  return (
    <>
      <DataTable
        id={TABLE}
        columns={COLUMNS}
        data={ROWS}
        getRowId={(row) => row.id}
        sorting={{
          column: sort.column,
          desc: sort.desc,
          onSort: (column) =>
            setSort({ column, desc: sort.column === column ? !sort.desc : false }),
        }}
        selection={{
          selected,
          onChange: setSelected,
          allLabel: 'Select all',
          rowLabel: (row) => `Select ${row.number}`,
        }}
        onRowClick={(row) => setOpened(row.number)}
      />
      <p>Opened: {opened}</p>
      <p>Selected: {selected.size}</p>
    </>
  )
}

/** A remount, as after a reload: the widths come back from storage. */
function Page() {
  const [mount, setMount] = useState(0)
  return (
    <div className="grid w-[900px] gap-4">
      <div className="rounded-xl border bg-card">
        <Table key={mount} />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => setMount(mount + 1)}
      >
        Reload
      </Button>
    </div>
  )
}

const meta = {
  title: 'Data/Data table',
  parameters: { layout: 'padded' },
  render: () => <Page />,
  beforeEach: () => {
    localStorage.removeItem(KEY)
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const header = (canvas: ReturnType<typeof within>, name: string) => {
  const head = canvas.getByRole('columnheader', { name })
  return { head, width: () => Math.round(head.getBoundingClientRect().width) }
}

/** Drags the handle by `dx` pixels, as a pointer would. */
async function drag(handle: HTMLElement, dx: number) {
  const box = handle.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  // A pointer lands on whatever is on top there: the handle must not sit under the next header.
  await expect(document.elementFromPoint(x, y)).toBe(handle)
  fireEvent.pointerDown(handle, { button: 0, clientX: x, clientY: y, pointerId: 1 })
  fireEvent.pointerMove(window, { clientX: x + dx / 2, clientY: y, pointerId: 1 })
  fireEvent.pointerMove(window, { clientX: x + dx, clientY: y, pointerId: 1 })
  fireEvent.pointerUp(window, { clientX: x + dx, clientY: y, pointerId: 1 })
}

/** Dragging an edge resizes its column, the client column gives the room, and a reload keeps it. */
export const DragResizes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const number = header(canvas, 'Number')
    const client = header(canvas, 'Client')
    const table = canvasElement.querySelector('table')
    const box = table?.parentElement
    await waitFor(() => expect(number.width()).toBe(128))
    const before = client.width()
    // The table fills its box exactly: no gap, no sideways scroll.
    await expect(table?.getBoundingClientRect().width).toBe(box?.clientWidth)
    await drag(canvas.getByLabelText('Resize Number'), 72)
    await waitFor(() => expect(number.width()).toBe(200))
    await expect(client.width()).toBe(before - 72)
    await expect(table?.getBoundingClientRect().width).toBe(box?.clientWidth)
    await expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({ number: 200 })
    await userEvent.click(canvas.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(header(canvas, 'Number').width()).toBe(200))
  },
}

/** A column stops at its max, at its min, and where the client column reaches its min. */
export const StopsAtItsRange: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const number = header(canvas, 'Number')
    const due = header(canvas, 'Due')
    const client = header(canvas, 'Client')
    await drag(canvas.getByLabelText('Resize Number'), 400)
    await waitFor(() => expect(number.width()).toBe(260))
    await drag(canvas.getByLabelText('Resize Number'), -400)
    await waitFor(() => expect(number.width()).toBe(80))
    await drag(canvas.getByLabelText('Resize Due'), 900)
    await waitFor(() => expect(client.width()).toBe(200))
    await expect(due.width()).toBeGreaterThan(128)
  },
}

/** A double-click on the edge gives the column its default width again. */
export const DoubleClickResets: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const number = header(canvas, 'Number')
    const handle = canvas.getByLabelText('Resize Number')
    await drag(handle, 40)
    await waitFor(() => expect(number.width()).toBe(168))
    await userEvent.dblClick(handle)
    await waitFor(() => expect(number.width()).toBe(128))
    await expect(localStorage.getItem(KEY)).toBeNull()
  },
}

/** The handle is reachable by keyboard; the arrow keys resize in 16 px steps. */
export const KeyboardResizes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const due = header(canvas, 'Due')
    const handle = canvas.getByRole('slider', { name: 'Resize Due' })
    handle.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await waitFor(() => expect(due.width()).toBe(160))
    await expect(handle).toHaveValue('160')
    await userEvent.keyboard('{ArrowLeft}')
    await waitFor(() => expect(due.width()).toBe(144))
  },
}

/** Only resizable columns get a handle: not the flexible client column, not the status. */
export const HandlesOnlyOnResizable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByLabelText('Resize Client')).toBeNull()
    await expect(canvas.queryByLabelText('Resize Status')).toBeNull()
    await expect(canvas.getAllByRole('slider')).toHaveLength(3)
  },
}

/** A sortable header sorts, then reverses; a row click opens it, a checkbox only selects. */
export const SortsAndSelects: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Client' }))
    await expect(canvas.getByRole('columnheader', { name: 'Client' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Client' }))
    await expect(canvas.getByRole('columnheader', { name: 'Client' })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Select 2026/INV/001' }))
    await expect(canvas.getByText('Selected: 1')).toBeVisible()
    await expect(canvas.getByText('Opened:')).toBeVisible()
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Select all' }))
    await expect(canvas.getByText('Selected: 2')).toBeVisible()
    await userEvent.click(canvas.getByText('Shuchi Kumra'))
    await expect(canvas.getByText('Opened: 2026/INV/002')).toBeVisible()
  },
}

/** The row menu column (48 px) holds its button without clipping it into an ellipsis. */
export const RowMenuFits: Story = {
  render: () => (
    <div className="w-[900px] rounded-xl border bg-card">
      <DataTable
        id={`${TABLE}-menu`}
        columns={[
          ...COLUMNS,
          {
            id: 'actions',
            header: 'Actions',
            headerContent: <span className="sr-only">Actions</span>,
            size: 48,
            resizable: false,
            cell: (row) => (
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.number}`}>
                ⋯
              </Button>
            ),
          },
        ]}
        data={ROWS}
        getRowId={(row) => row.id}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const cell = (await canvas.findByRole('button', { name: 'Actions for 2026/INV/001' }))
      .parentElement
    if (!cell) throw new Error('The row menu has no cell')
    await expect(cell.scrollWidth).toBe(cell.clientWidth)
  },
}
