import { Button } from '@helvetly/ui/components/button'
import { Checkbox } from '@helvetly/ui/components/checkbox'
import { ColumnsCustomize, DataTable, type DataColumn } from '@helvetly/ui/components/data-table'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, fireEvent, screen, userEvent, waitFor, within } from 'storybook/test'

const TABLE = 'story'
const KEY = `helvetly.table.${TABLE}.columns.v2`
const ORDER_KEY = `helvetly.table.${TABLE}.order`

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
  {
    id: 'total',
    header: 'Amount',
    size: 140,
    align: 'right',
    sortable: true,
    sortDescFirst: true,
    cell: (row) => row.total,
  },
  { id: 'status', header: 'Status', size: 112, cell: () => 'Paid' },
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
          onSort: (column, desc) => setSort({ column, desc }),
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
      <p>Sorted: {sort.column ? `${sort.column} ${sort.desc ? 'desc' : 'asc'}` : 'none'}</p>
    </>
  )
}

/** A remount, as after a reload: the widths and the order come back from storage. */
function Page() {
  const [mount, setMount] = useState(0)
  return (
    <div className="grid w-[900px] gap-4">
      <div className="rounded-xl border bg-card">
        <Table key={mount} />
      </div>
      <div className="flex items-start gap-4">
        <Button variant="outline" size="sm" onClick={() => setMount(mount + 1)}>
          Reload
        </Button>
        <div className="grid w-64 gap-1 rounded-xl border bg-card p-2" aria-label="Customize">
          <ColumnsCustomize
            table={TABLE}
            columns={COLUMNS.map((column) => ({
              id: column.id,
              label: column.header,
              required: column.id === 'client',
            }))}
            hidden={[]}
            onToggle={() => {}}
          />
        </div>
      </div>
    </div>
  )
}

const meta = {
  title: 'Data/Data table',
  parameters: { layout: 'padded' },
  render: () => <Page />,
  beforeEach: () => {
    for (const key of Object.keys(localStorage))
      if (key.startsWith('helvetly.table.story')) localStorage.removeItem(key)
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

type Canvas = ReturnType<typeof within>

const header = (canvas: Canvas, name: string) => {
  const head = canvas.getByRole('columnheader', { name })
  return { head, width: () => Math.round(head.getBoundingClientRect().width) }
}

/** Every column's width by its header's name (the empty room right of them is not a column). */
const widths = (canvas: Canvas) =>
  Object.fromEntries(
    canvas
      .getAllByRole('columnheader')
      .map((head: HTMLElement) => [
        head.getAttribute('aria-label') ?? (head.textContent?.trim() || 'select'),
        Math.round(head.getBoundingClientRect().width),
      ]),
  )
const sum = (sizes: Record<string, number>) =>
  Object.values(sizes).reduce((total, width) => total + width, 0)
const order = (canvas: Canvas) =>
  canvas
    .getAllByRole('columnheader')
    .map((head: HTMLElement) => head.textContent?.trim() || 'select')

/** Runs `step` for each item in turn, each after the one before has finished. */
const inTurn = <T,>(items: readonly T[], step: (item: T) => Promise<void>) =>
  items.reduce<Promise<void>>((done, item) => done.then(() => step(item)), Promise.resolve())

const point = (handle: HTMLElement) => {
  const box = handle.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

/**
 * Drags the handle by `dx` pixels as a mouse does: down on the handle, then moves and up on the
 * document, off the handle, as TanStack's resize handler listens for them. A frame between moves,
 * since TanStack applies at most one move per frame.
 */
async function drag(handle: HTMLElement, dx: number) {
  handle.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  const { x, y } = point(handle)
  // A pointer lands on whatever is on top there: the handle must not sit under the next header.
  await expect(document.elementFromPoint(x, y)).toBe(handle)
  fireEvent.mouseDown(handle, { button: 0, clientX: x, clientY: y })
  await inTurn([dx / 4, dx / 2, dx], async (step) => {
    fireEvent.mouseMove(document, { clientX: x + step, clientY: y + 30 })
    await new Promise(requestAnimationFrame)
  })
  fireEvent.mouseUp(document, { clientX: x + dx, clientY: y + 30 })
}

/** The same with a finger. */
async function swipe(handle: HTMLElement, dx: number) {
  handle.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  const { x, y } = point(handle)
  const touch = (clientX: number) => [
    new Touch({ identifier: 1, target: handle, clientX, clientY: y }),
  ]
  fireEvent.touchStart(handle, { touches: touch(x) })
  fireEvent.touchMove(document, { touches: touch(x + dx) })
  await new Promise(requestAnimationFrame)
  fireEvent.touchEnd(document, { touches: [], changedTouches: touch(x + dx) })
}

const resizer = (canvas: Canvas, name: string) =>
  canvas.getByRole('button', { name: `Resize ${name}` })

/**
 * Asserts that dragging `name`'s edge by `dx` changes that column, and the table, by exactly `dx`
 * and leaves every other column as it was.
 */
async function expectDragChangesOnly(
  canvas: Canvas,
  name: string,
  dx: number,
  move: (handle: HTMLElement, dx: number) => Promise<void> = drag,
) {
  const before = widths(canvas)
  await move(resizer(canvas, name), dx)
  await waitFor(() => expect(widths(canvas)[name]).toBe((before[name] ?? 0) + dx))
  await expect(widths(canvas)).toEqual({ ...before, [name]: (before[name] ?? 0) + dx })
  await expect(sum(widths(canvas))).toBe(sum(before) + dx)
}

/** The box the table sits in: 900 px less its 1 px border on each side. */
const BOX = 898

/**
 * Every resizable column, the client one too, follows the pointer 1:1: +80 then -40 changes only
 * that column, and the table's width by the same; nothing sorts, no text is selected; a reload
 * keeps the widths.
 */
export const DragResizes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Before any resize the columns share the box, the client one getting the most of the room.
    await waitFor(() => expect(sum(widths(canvas))).toBe(BOX))
    const start = widths(canvas)
    await expect(start.Number).toBeGreaterThan(128)
    await expect((start.Client ?? 0) - 240).toBeGreaterThan((start.Number ?? 0) - 128)
    await inTurn(['Number', 'Client', 'Due', 'Amount'], async (name) => {
      await expectDragChangesOnly(canvas, name, 80)
      await expectDragChangesOnly(canvas, name, -40)
    })
    await expect(canvas.getByText('Sorted: none')).toBeVisible()
    await expect(window.getSelection()?.toString()).toBe('')
    const box = canvasElement.querySelector('table')?.parentElement
    if (!box) throw new Error('The table has no box')
    // Wider than its box now: the table is as wide as its columns and the box scrolls sideways.
    await expect(box.scrollWidth).toBe(BOX + 4 * 40)
    await expect(getComputedStyle(box).overflowX).toBe('auto')
    const stored = widths(canvas)
    const kept: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    await expect(kept).toMatchObject({
      number: (start.Number ?? 0) + 40,
      client: stored.Client,
      due: (start.Due ?? 0) + 40,
      total: (start.Amount ?? 0) + 40,
    })
    await userEvent.click(canvas.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(widths(canvas)).toEqual(stored))
  },
}

/** A finger drags every edge the same way. */
export const TouchResizes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(sum(widths(canvas))).toBe(BOX))
    await inTurn(['Number', 'Client', 'Due', 'Amount'], async (name) => {
      await expectDragChangesOnly(canvas, name, 80, swipe)
      await expectDragChangesOnly(canvas, name, -40, swipe)
    })
  },
}

/**
 * Narrower than its box, the table leaves the room right of its columns empty, as in TanStack's
 * example, but its header and rows still reach the box's edge.
 */
export const LeavesRoomWhenNarrower: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(sum(widths(canvas))).toBe(BOX))
    await expectDragChangesOnly(canvas, 'Client', -60)
    await expect(sum(widths(canvas))).toBe(BOX - 60)
    const row = canvas.getByText('Muster AG').closest('tr')
    await expect(Math.round(row?.getBoundingClientRect().width ?? 0)).toBe(BOX)
    // Growing again changes only the column, the room right of it shrinks.
    await expectDragChangesOnly(canvas, 'Number', 20)
  },
}

/** A column stops at its max and its min, and keeps following the pointer back from there. */
export const StopsAtItsRange: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const number = header(canvas, 'Number')
    const due = header(canvas, 'Due')
    await waitFor(() => expect(sum(widths(canvas))).toBe(BOX))
    const client = header(canvas, 'Client').width()
    await drag(resizer(canvas, 'Number'), 400)
    await waitFor(() => expect(number.width()).toBe(260))
    await drag(resizer(canvas, 'Number'), -400)
    await waitFor(() => expect(number.width()).toBe(80))
    await drag(resizer(canvas, 'Due'), 900)
    await waitFor(() => expect(due.width()).toBe(640))
    await expect(header(canvas, 'Client').width()).toBe(client)
  },
}

/** A double-click on the edge gives the column its default width again, the client one too. */
export const DoubleClickResets: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const number = header(canvas, 'Number')
    const client = header(canvas, 'Client')
    await waitFor(() => expect(sum(widths(canvas))).toBe(BOX))
    const initial = number.width()
    const fill = client.width()
    await drag(resizer(canvas, 'Number'), 40)
    await waitFor(() => expect(number.width()).toBe(initial + 40))
    await userEvent.dblClick(resizer(canvas, 'Number'))
    await waitFor(() => expect(number.width()).toBe(initial))
    await drag(resizer(canvas, 'Client'), 50)
    await waitFor(() => expect(client.width()).toBe(fill + 50))
    await userEvent.dblClick(resizer(canvas, 'Client'))
    await waitFor(() => expect(client.width()).toBe(fill))
  },
}

/** The handle is reachable by keyboard; the arrow keys resize in 16 px steps, Enter resets. */
export const KeyboardResizes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const due = header(canvas, 'Due')
    await waitFor(() => expect(sum(widths(canvas))).toBe(BOX))
    const initial = due.width()
    resizer(canvas, 'Due').focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await waitFor(() => expect(due.width()).toBe(initial + 32))
    await userEvent.keyboard('{ArrowLeft}')
    await waitFor(() => expect(due.width()).toBe(initial + 16))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(due.width()).toBe(initial))
  },
}

/**
 * A handle sits between two data columns: a dashed 1 px line at the right edge of every one but the
 * last, in a 12 px strip that takes the pointer.
 */
export const HandlesOnlyOnResizable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Resize Status' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Resize Amount' })).not.toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Resize Select all' })).toBeNull()
    await expect(canvas.getAllByRole('button', { name: /^Resize / })).toHaveLength(4)
    const handle = resizer(canvas, 'Client')
    await expect(getComputedStyle(handle).cursor).toBe('col-resize')
    await expect(getComputedStyle(handle).touchAction).toBe('none')
    await expect(handle.getBoundingClientRect().width).toBe(12)
    const bar = handle.firstElementChild
    if (!bar) throw new Error('The handle has no bar')
    await expect(bar.getBoundingClientRect().width).toBe(1)
    await expect(getComputedStyle(bar).borderRightStyle).toBe('dashed')
    await expect(getComputedStyle(bar).transitionDuration).toBe('0s')
  },
}

/** Moves the `from` header onto `to` with the browser's drag and drop. */
function dragHeader(canvas: Canvas, from: string, to: string) {
  const source = canvas.getByRole('columnheader', { name: from }).querySelector('[draggable=true]')
  const target = canvas.getByRole('columnheader', { name: to })
  if (!source) throw new Error(`${from} cannot be dragged`)
  const dataTransfer = new DataTransfer()
  fireEvent.dragStart(source, { dataTransfer })
  fireEvent.dragEnter(target, { dataTransfer })
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
  fireEvent.dragEnd(source, { dataTransfer })
}

/**
 * A header dragged onto another takes its place; the checkbox column stays first and cannot be
 * a target; nothing sorts; the order comes back after a reload.
 */
export const ReordersByDrag: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const initial = ['select', 'Number', 'Client', 'Due', 'Amount', 'Status']
    await expect(order(canvas)).toEqual(initial)
    dragHeader(canvas, 'Due', 'Number')
    await waitFor(() =>
      expect(order(canvas)).toEqual(['select', 'Due', 'Number', 'Client', 'Amount', 'Status']),
    )
    dragHeader(canvas, 'Number', 'Status')
    await waitFor(() =>
      expect(order(canvas)).toEqual(['select', 'Due', 'Client', 'Amount', 'Status', 'Number']),
    )
    // The checkbox column is no target: dropping on it changes nothing.
    const select = canvas.getAllByRole('columnheader')[0]
    const source = canvas.getByRole('columnheader', { name: 'Client' }).querySelector('[draggable]')
    if (!select || !source) throw new Error('No header to drag')
    fireEvent.dragStart(source, { dataTransfer: new DataTransfer() })
    fireEvent.drop(select)
    fireEvent.dragEnd(source)
    await expect(order(canvas)[0]).toBe('select')
    await expect(canvas.getByText('Sorted: none')).toBeVisible()
    await expect(JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]')).toEqual([
      'due',
      'client',
      'total',
      'status',
      'number',
    ])
    await userEvent.click(canvas.getByRole('button', { name: 'Reload' }))
    await waitFor(() =>
      expect(order(canvas)).toEqual(['select', 'Due', 'Client', 'Amount', 'Status', 'Number']),
    )
    // Widths follow their columns, and resizing still changes only the dragged one.
    await expectDragChangesOnly(canvas, 'Status', 80)
    // A press on a handle never drags the header, even once the widened column brings its
    // label under the point the press began at.
    const handle = resizer(canvas, 'Due')
    const { x, y } = point(handle)
    fireEvent.mouseDown(handle, { button: 0, clientX: x, clientY: y })
    fireEvent.mouseMove(document, { clientX: x + 40, clientY: y })
    await new Promise(requestAnimationFrame)
    const label = canvas.getByRole('columnheader', { name: 'Due' }).querySelector('[draggable]')
    if (!label) throw new Error('Due has no label')
    await expect(label).toHaveAttribute('draggable', 'false')
    await expect(fireEvent.dragStart(label, { dataTransfer: new DataTransfer() })).toBe(false)
    fireEvent.mouseUp(document, { clientX: x + 40, clientY: y })
    await expect(order(canvas)).toEqual(['select', 'Due', 'Client', 'Amount', 'Status', 'Number'])
  },
}

/** The Customize list moves columns up and down in step with the table; Reset restores it. */
export const ReordersInCustomize: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const customize = within(canvas.getByLabelText('Customize'))
    const reset = customize.getByRole('button', { name: 'Reset to default' })
    await expect(reset).toBeDisabled()
    await expect(customize.getByRole('button', { name: 'Move Number up' })).toBeDisabled()
    await expect(customize.getByRole('button', { name: 'Move Status down' })).toBeDisabled()
    await userEvent.click(customize.getByRole('button', { name: 'Move Amount up' }))
    await waitFor(() =>
      expect(order(canvas)).toEqual(['select', 'Number', 'Client', 'Amount', 'Due', 'Status']),
    )
    await userEvent.click(customize.getByRole('button', { name: 'Move Number down' }))
    await waitFor(() =>
      expect(order(canvas)).toEqual(['select', 'Client', 'Number', 'Amount', 'Due', 'Status']),
    )
    await expect(customize.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Client',
      'Number',
      'Amount',
      'Due',
      'Status',
    ])
    // The client column always shows.
    await expect(customize.getByRole('checkbox', { name: 'Client' })).toBeDisabled()
    await userEvent.click(canvas.getByRole('button', { name: 'Reload' }))
    await waitFor(() =>
      expect(order(canvas)).toEqual(['select', 'Client', 'Number', 'Amount', 'Due', 'Status']),
    )
    await userEvent.click(reset)
    await waitFor(() =>
      expect(order(canvas)).toEqual(['select', 'Number', 'Client', 'Due', 'Amount', 'Status']),
    )
    await expect(localStorage.getItem(ORDER_KEY)).toBeNull()
  },
}

/** A stored order naming a removed column and missing a new one still shows every column. */
export const StoredOrderMerges: Story = {
  beforeEach: () => {
    localStorage.setItem(ORDER_KEY, JSON.stringify(['status', 'gone', 'due', 'number']))
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(order(canvas)).toEqual(['select', 'Status', 'Due', 'Amount', 'Number', 'Client'])
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

/** The sort icon of a sortable header: `none`, `asc` or `desc`. */
const sortIcon = (canvas: Canvas, name: string) =>
  canvas.getByRole('columnheader', { name }).querySelector('svg')?.getAttribute('data-sort')

/**
 * TanStack's sorting: a header sorts ascending (Amount, `sortDescFirst`, descending), a second
 * click reverses and never removes it; the icon shows the direction at once. A row click opens
 * it, a checkbox only selects.
 */
export const SortsAndSelects: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const client = () => canvas.getByRole('columnheader', { name: 'Client' })
    await expect(sortIcon(canvas, 'Client')).toBe('none')
    await expect(canvas.queryByRole('button', { name: 'Due' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Client' }))
    await expect(client()).toHaveAttribute('aria-sort', 'ascending')
    await expect(sortIcon(canvas, 'Client')).toBe('asc')
    await userEvent.click(canvas.getByRole('button', { name: 'Client' }))
    await expect(client()).toHaveAttribute('aria-sort', 'descending')
    await expect(sortIcon(canvas, 'Client')).toBe('desc')
    await userEvent.click(canvas.getByRole('button', { name: 'Client' }))
    await expect(canvas.getByText('Sorted: client asc')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Amount' }))
    await expect(canvas.getByText('Sorted: total desc')).toBeVisible()
    await expect(client()).not.toHaveAttribute('aria-sort')
    await expect(sortIcon(canvas, 'Amount')).toBe('desc')
    await expect(sortIcon(canvas, 'Client')).toBe('none')
    const svg = client().querySelector('svg')
    await expect(svg?.getBoundingClientRect().width).toBe(14)
    await expect(getComputedStyle(svg ?? client()).transitionDuration).toBe('0s')
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Select 2026/INV/001' }))
    await expect(canvas.getByText('Selected: 1')).toBeVisible()
    await expect(canvas.getByText('Opened:')).toBeVisible()
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Select all' }))
    await expect(canvas.getByText('Selected: 2')).toBeVisible()
    await userEvent.click(canvas.getByText('Shuchi Kumra'))
    await expect(canvas.getByText('Opened: 2026/INV/002')).toBeVisible()
  },
}

const right = (element: Element) => Math.round(element.getBoundingClientRect().right)

/**
 * The row menu column is 48 px, has no handle, cannot be dragged and stays at the right edge, also
 * when the columns leave room; it holds its button without clipping it into an ellipsis.
 */
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
    const head = canvas.getByRole('columnheader', { name: 'Actions' })
    await expect(Math.round(head.getBoundingClientRect().width)).toBe(48)
    await expect(canvas.queryByRole('button', { name: 'Resize Actions' })).toBeNull()
    // No bar at the row menu's edge: Status, the last data column, has none; Amount, before it, has.
    await expect(canvas.queryByRole('button', { name: 'Resize Status' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Resize Amount' })).not.toBeNull()
    await expect(head.querySelector('[draggable=true]')).toBeNull()
    await expectDragChangesOnly(canvas, 'Client', -60)
    await expect(right(head)).toBe(right(head.closest('tr') ?? head))
    await expect(right(cell)).toBe(right(cell.closest('tr') ?? cell))
  },
}

const MANY: Row[] = Array.from({ length: 1000 }, (_, index) => ({
  id: String(index + 1),
  number: `2026/INV/${String(index + 1).padStart(4, '0')}`,
  client: `Client ${index + 1}`,
  due: '18 Dec 2026',
  total: `CHF ${index + 1}.00`,
}))

/** A server-paged list: the story answers each page from `total` rows, as the API would. */
function Paged({ total = 312, initialSize = 25 }: { total?: number; initialSize?: number }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialSize)
  const rows = MANY.slice(0, total).slice((page - 1) * pageSize, page * pageSize)
  return (
    <div className="w-[900px] rounded-xl border bg-card">
      <DataTable
        id={`${TABLE}-paged`}
        columns={COLUMNS}
        data={rows}
        getRowId={(row) => row.id}
        pagination={{
          page,
          pageSize,
          total,
          onChange: (next, size) => {
            setPage(next)
            setPageSize(size)
          },
        }}
      />
    </div>
  )
}

/**
 * TanStack's pagination drives the pager: first, previous, numbered pages with gaps, next and
 * last, rows per page, and the range shown.
 */
export const Paginates: Story = {
  render: () => <Paged />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const pages = within(canvas.getByRole('navigation', { name: 'Pages' }))
    const pageButton = (page: number) => pages.getByRole('button', { name: `Page ${page}` })
    const numbers = () =>
      pages.getAllByRole('button', { name: /^Page \d+$/ }).map((button) => button.textContent)
    await expect(pages.getByText('1–25 of 312')).toBeVisible()
    await expect(numbers()).toEqual(['1', '2', '3', '4', '5', '13'])
    await expect(pageButton(1)).toHaveAttribute('aria-current', 'page')
    await expect(pages.queryByRole('spinbutton')).toBeNull()
    await expect(pages.getByRole('button', { name: 'First page' })).toBeDisabled()
    await expect(pages.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    await userEvent.click(pages.getByRole('button', { name: 'Next page' }))
    await expect(pages.getByText('26–50 of 312')).toBeVisible()
    await expect(canvas.getByText('2026/INV/0026')).toBeVisible()
    await expect(pageButton(2)).toHaveAttribute('aria-current', 'page')
    await expect(pageButton(1)).not.toHaveAttribute('aria-current')
    await userEvent.click(pages.getByRole('button', { name: 'Last page' }))
    await expect(pages.getByText('301–312 of 312')).toBeVisible()
    await expect(numbers()).toEqual(['1', '9', '10', '11', '12', '13'])
    await expect(pages.getByRole('button', { name: 'Next page' })).toBeDisabled()
    await expect(pages.getByRole('button', { name: 'Last page' })).toBeDisabled()
    await userEvent.click(pages.getByRole('button', { name: 'Previous page' }))
    await expect(pages.getByText('276–300 of 312')).toBeVisible()
    await userEvent.click(pages.getByRole('button', { name: 'First page' }))
    await expect(pages.getByText('1–25 of 312')).toBeVisible()
    await userEvent.click(pageButton(5))
    await expect(pages.getByText('101–125 of 312')).toBeVisible()
    await expect(numbers()).toEqual(['1', '4', '5', '6', '13'])
    await userEvent.click(pageButton(1))
    await userEvent.click(pages.getByRole('button', { name: '25 / page' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: '100' }))
    await expect(pages.getByText('1–100 of 312')).toBeVisible()
    await expect(numbers()).toEqual(['1', '2', '3', '4'])
    await expect(canvas.getAllByRole('row')).toHaveLength(101)
  },
}

/** Every row fits the smallest page: no pager at all, the list ends with its last row. */
export const OnePageHidesPager: Story = {
  render: () => <Paged total={7} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('2026/INV/0007')).toBeVisible()
    await expect(canvas.queryByRole('navigation', { name: 'Pages' })).toBeNull()
  },
}

/**
 * One page of a bigger size keeps the count and rows per page (to page again with a smaller one),
 * without the page buttons; two pages bring them back.
 */
export const OnePageKeepsRowsPerPage: Story = {
  render: () => <Paged total={60} initialSize={100} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const pages = within(canvas.getByRole('navigation', { name: 'Pages' }))
    await expect(pages.getByText('1–60 of 60')).toBeVisible()
    await expect(pages.queryByRole('button', { name: 'Next page' })).toBeNull()
    await userEvent.click(pages.getByRole('button', { name: '100 / page' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: '50' }))
    await expect(pages.getByText('1–50 of 60')).toBeVisible()
    await userEvent.click(pages.getByRole('button', { name: 'Page 2' }))
    await expect(pages.getByText('51–60 of 60')).toBeVisible()
    await expect(canvas.getByText('2026/INV/0060')).toBeVisible()
  },
}

/**
 * A thousand rows render only those in view (and a few around them); scrolling brings the rest,
 * and the table keeps its columns, header and row count for assistive technology.
 */
export const VirtualizesLongLists: Story = {
  render: () => (
    <div
      className="h-[600px] w-[900px] overflow-y-auto rounded-xl border bg-card"
      data-testid="scroller"
    >
      <DataTable id={`${TABLE}-many`} columns={COLUMNS} data={MANY} getRowId={(row) => row.id} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scroller = canvas.getByTestId('scroller')
    const table = canvas.getByRole('table')
    await expect(table).toHaveAttribute('aria-rowcount', '1001')
    await waitFor(() => expect(canvas.getByText('2026/INV/0001')).toBeVisible())
    const rendered = () => table.querySelectorAll('tbody tr[aria-rowindex]').length
    await expect(rendered()).toBeLessThan(40)
    // The body is as tall as all thousand rows, so the scrollbar is right.
    await expect(scroller.scrollHeight).toBeGreaterThan(1000 * 58)
    scroller.scrollTop = scroller.scrollHeight
    await waitFor(() => expect(canvas.getByText('2026/INV/1000')).toBeVisible())
    await expect(canvas.queryByText('2026/INV/0001')).toBeNull()
    await expect(rendered()).toBeLessThan(40)
    scroller.scrollTop = 500 * 58
    await waitFor(() => expect(canvas.getByText('2026/INV/0505')).toBeVisible())
    // Widths still apply: the header and the rows line up.
    const number = canvas.getByRole('columnheader', { name: 'Number' }).getBoundingClientRect()
    const cell = canvas.getByText('2026/INV/0505').getBoundingClientRect()
    await expect(Math.round(cell.width)).toBe(Math.round(number.width))
  },
}
