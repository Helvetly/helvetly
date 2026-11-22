import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
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

const point = (handle: HTMLElement) => {
  const box = handle.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

/** Drags the handle by `dx` pixels with a mouse, as TanStack's resize handler listens for it. */
async function drag(handle: HTMLElement, dx: number) {
  const { x, y } = point(handle)
  // A pointer lands on whatever is on top there: the handle must not sit under the next header.
  await expect(document.elementFromPoint(x, y)).toBe(handle)
  fireEvent.mouseDown(handle, { button: 0, clientX: x, clientY: y })
  fireEvent.mouseMove(document, { clientX: x + dx / 2, clientY: y })
  fireEvent.mouseMove(document, { clientX: x + dx, clientY: y })
  fireEvent.mouseUp(document, { clientX: x + dx, clientY: y })
}

/** The same with a finger. */
async function swipe(handle: HTMLElement, dx: number) {
  const { x, y } = point(handle)
  const touch = (clientX: number) => [
    new Touch({ identifier: 1, target: handle, clientX, clientY: y }),
  ]
  fireEvent.touchStart(handle, { touches: touch(x) })
  fireEvent.touchMove(document, { touches: touch(x + dx) })
  fireEvent.touchEnd(document, { touches: [], changedTouches: touch(x + dx) })
}

/**
 * Dragging an edge resizes only its column, 1:1 with the pointer; the client column, which fills
 * the rest of the box, gives the room; a reload keeps the width.
 */
export const DragResizes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const number = header(canvas, 'Number')
    const client = header(canvas, 'Client')
    const due = header(canvas, 'Due')
    const table = canvasElement.querySelector('table')
    const box = table?.parentElement
    await waitFor(() => expect(number.width()).toBe(128))
    const before = client.width()
    // The table fills its box exactly: no gap, no sideways scroll.
    await expect(table?.getBoundingClientRect().width).toBe(box?.clientWidth)
    await drag(canvas.getByLabelText('Resize Number'), 72)
    await waitFor(() => expect(number.width()).toBe(200))
    await expect(client.width()).toBe(before - 72)
    await expect(due.width()).toBe(128)
    await expect(table?.getBoundingClientRect().width).toBe(box?.clientWidth)
    // The drag neither sorted nor left a text selection.
    await expect(number.head).not.toHaveAttribute('aria-sort')
    await expect(window.getSelection()?.toString()).toBe('')
    await expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({ number: 200 })
    await userEvent.click(canvas.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(header(canvas, 'Number').width()).toBe(200))
  },
}

/** A finger drags the edge too. */
export const TouchResizes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const due = header(canvas, 'Due')
    await waitFor(() => expect(due.width()).toBe(128))
    await swipe(canvas.getByLabelText('Resize Due'), 40)
    await waitFor(() => expect(due.width()).toBe(168))
  },
}

/**
 * A column stops at its max and its min. Once the columns need more than the box, the client
 * column keeps its min and the box scrolls sideways instead of squeezing the others.
 */
export const StopsAtItsRange: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const number = header(canvas, 'Number')
    const due = header(canvas, 'Due')
    const client = header(canvas, 'Client')
    const total = header(canvas, 'Amount')
    await drag(canvas.getByLabelText('Resize Number'), 400)
    await waitFor(() => expect(number.width()).toBe(260))
    await drag(canvas.getByLabelText('Resize Number'), -400)
    await waitFor(() => expect(number.width()).toBe(80))
    await drag(canvas.getByLabelText('Resize Due'), 900)
    await waitFor(() => expect(due.width()).toBe(640))
    await expect(client.width()).toBe(200)
    await expect(total.width()).toBe(140)
    const box = canvasElement.querySelector('table')?.parentElement
    if (!box) throw new Error('The table has no box')
    await expect(box.scrollWidth).toBeGreaterThan(box.clientWidth)
    await expect(getComputedStyle(box).overflowX).toBe('auto')
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

/** The handle is reachable by keyboard; the arrow keys resize in 16 px steps, Enter resets. */
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
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(due.width()).toBe(128))
  },
}

/** Only resizable columns get a handle: not the select, flexible client or status column. */
export const HandlesOnlyOnResizable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByLabelText('Resize Client')).toBeNull()
    await expect(canvas.queryByLabelText('Resize Status')).toBeNull()
    await expect(canvas.getAllByRole('slider')).toHaveLength(3)
    const handle = canvas.getByLabelText('Resize Number')
    await expect(getComputedStyle(handle).cursor).toBe('col-resize')
    await expect(handle.getBoundingClientRect().width).toBeGreaterThanOrEqual(12)
  },
}

/** Every corner of the checkbox and its 3 px focus ring is inside its cell and on top there. */
async function expectUnclipped(checkbox: HTMLElement) {
  const cell = checkbox.closest('th, td')
  if (!cell) throw new Error('The checkbox has no cell')
  const box = checkbox.getBoundingClientRect()
  const room = cell.getBoundingClientRect()
  await expect(box.left - 3).toBeGreaterThanOrEqual(room.left)
  await expect(box.right + 3).toBeLessThanOrEqual(room.right)
  const corners = [
    [box.left + 1, box.top + 1],
    [box.right - 1, box.top + 1],
    [box.left + 1, box.bottom - 1],
    [box.right - 1, box.bottom - 1],
  ] as const
  await expect(
    corners.filter(([x, y]) => !checkbox.contains(document.elementFromPoint(x, y))),
  ).toEqual([])
}

/** The select-all and row checkboxes are whole: none is cut by its cell or covered by the next. */
export const CheckboxesUnclipped: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectUnclipped(canvas.getByRole('checkbox', { name: 'Select all' }))
    await expectUnclipped(canvas.getByRole('checkbox', { name: 'Select 2026/INV/001' }))
  },
}

/** A page's own checkbox column (the documents list) gets the same fixed, unclipped width. */
export const OwnSelectColumnUnclipped: Story = {
  render: () => (
    <div className="w-[900px] rounded-xl border bg-card">
      <DataTable
        id={`${TABLE}-own-select`}
        columns={[
          {
            id: 'select',
            header: 'Select all',
            headerContent: <Checkbox aria-label="Select all" className="bg-card" />,
            cell: (row) => <Checkbox aria-label={`Select ${row.number}`} className="bg-card" />,
          },
          ...COLUMNS,
        ]}
        data={ROWS}
        getRowId={(row) => row.id}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expectUnclipped(canvas.getByRole('checkbox', { name: 'Select all' }))
    await expectUnclipped(canvas.getByRole('checkbox', { name: 'Select 2026/INV/002' }))
    await expect(canvas.queryByLabelText('Resize Select all')).toBeNull()
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
