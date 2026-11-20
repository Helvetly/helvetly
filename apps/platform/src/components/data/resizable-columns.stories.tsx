import { Button } from '@helvetly/ui/components/button'
import { cn } from '@helvetly/ui/lib/utils'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'

import { columnWidthsKey } from '@/lib/column-widths'

import { listTable } from './list-table'
import {
  ResetColumnWidths,
  ResizableHead,
  ResizableTable,
  useResizableColumns,
  type ResizableColumns,
} from './resizable-columns'

const TABLE = 'story'
const COLUMNS = ['number', 'client', 'due', 'total']
const ROWS = [
  { number: '2026/INV/001', client: 'Muster AG', due: '18 Dec 2026', total: 'CHF 1’611.60' },
  { number: '2026/INV/002', client: 'Shuchi Kumra', due: '19 Feb 2027', total: 'CHF 99.00' },
]

function Table({ columns }: { columns: ResizableColumns }) {
  return (
    <ResizableTable columns={columns} className={listTable.table}>
      <thead>
        <tr className={listTable.head}>
          <ResizableHead
            columns={columns}
            column="number"
            label="Number"
            className={cn(listTable.th, 'w-[128px]')}
          />
          <ResizableHead
            columns={columns}
            column="client"
            label="Client"
            className={listTable.th}
          />
          <ResizableHead
            columns={columns}
            column="due"
            label="Due"
            className={cn(listTable.th, 'w-[128px]')}
          />
          <ResizableHead
            columns={columns}
            column="total"
            label="Amount"
            className={cn(listTable.th, listTable.numeric, 'w-[17%]')}
          />
          <th className={cn(listTable.th, 'w-[112px]')}>Status</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => (
          <tr key={row.number} className={listTable.row}>
            <td className={listTable.td}>{row.number}</td>
            <td className={listTable.td}>{row.client}</td>
            <td className={listTable.td}>{row.due}</td>
            <td className={cn(listTable.td, listTable.numeric)}>{row.total}</td>
            <td className={listTable.td}>Paid</td>
          </tr>
        ))}
      </tbody>
    </ResizableTable>
  )
}

function Widths() {
  const columns = useResizableColumns(TABLE, COLUMNS, { flex: 'client' })
  return (
    <div className="grid gap-3">
      <Table columns={columns} />
      <div className="flex w-56 flex-col gap-1">
        <ResetColumnWidths columns={columns} />
      </div>
    </div>
  )
}

/** A remount, as after a reload: the widths come back from storage. */
function Page() {
  const [mount, setMount] = useState(0)
  return (
    <div className="grid gap-4">
      <div className="rounded-xl border bg-card">
        <Widths key={mount} />
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
  title: 'Data/Resizable columns',
  parameters: { layout: 'padded' },
  render: () => <Page />,
  beforeEach: () => {
    localStorage.removeItem(columnWidthsKey(TABLE))
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const header = (canvas: ReturnType<typeof within>, name: string) => {
  // The exact name: the handle inside the header does not add its value to it.
  const head = canvas.getByRole('columnheader', { name })
  return { head, width: () => Math.round(head.getBoundingClientRect().width) }
}

/** Drags the handle by `dx` pixels, as a mouse would. */
async function drag(handle: HTMLElement, dx: number) {
  const box = handle.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  fireEvent.pointerDown(handle, { button: 0, clientX: x, clientY: y, pointerId: 1 })
  fireEvent.pointerMove(window, { clientX: x + dx / 2, clientY: y, pointerId: 1 })
  fireEvent.pointerMove(window, { clientX: x + dx, clientY: y, pointerId: 1 })
  fireEvent.pointerUp(window, { clientX: x + dx, clientY: y, pointerId: 1 })
}

/** Dragging a column's edge resizes it, the client column gives the room, and a reload keeps it. */
export const DragResizes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const number = header(canvas, 'Number')
    const client = header(canvas, 'Client')
    const table = canvasElement.querySelector('table')
    await expect(number.width()).toBe(128)
    const before = client.width()
    const tableWidth = table?.getBoundingClientRect().width

    await drag(canvas.getByLabelText('Resize Number'), 72)
    await waitFor(() => expect(number.width()).toBe(200))
    await expect(client.width()).toBe(before - 72)
    // No gap, no scroll: the table keeps its width.
    await expect(table?.getBoundingClientRect().width).toBe(tableWidth)
    await expect(JSON.parse(localStorage.getItem(columnWidthsKey(TABLE)) ?? '{}')).toEqual({
      columns: COLUMNS.join(','),
      widths: { number: 200 },
    })

    await userEvent.click(canvas.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(header(canvas, 'Number').width()).toBe(200))
  },
}

/** A double-click on the edge gives the column its own width again. */
export const DoubleClickResets: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const number = header(canvas, 'Number')
    const handle = canvas.getByLabelText('Resize Number')
    await drag(handle, 40)
    await waitFor(() => expect(number.width()).toBe(168))
    await userEvent.dblClick(handle)
    await waitFor(() => expect(number.width()).toBe(128))
    await expect(localStorage.getItem(columnWidthsKey(TABLE))).toBeNull()
  },
}

/** The handle is reachable by keyboard; the arrow keys resize in 16 px steps. */
export const KeyboardResizes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const due = header(canvas, 'Due')
    const handle = canvas.getByRole('slider', { name: 'Resize Due' })
    await userEvent.tab()
    await userEvent.tab()
    await userEvent.tab()
    await expect(handle).toHaveFocus()
    await waitFor(() => expect(handle).toHaveValue('128'))
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await waitFor(() => expect(due.width()).toBe(160))
    await expect(handle).toHaveValue('160')
    await userEvent.keyboard('{ArrowLeft}')
    await waitFor(() => expect(due.width()).toBe(144))
  },
}

/** Widening the client column past the page scrolls the table sideways instead of squeezing. */
export const FlexibleColumnScrolls: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const client = header(canvas, 'Client')
    const table = canvasElement.querySelector('table')
    const scroller = table?.parentElement
    const width = client.width()
    await drag(canvas.getByLabelText('Resize Client'), 120)
    await waitFor(() => expect(client.width()).toBe(width + 120))
    await expect(scroller?.scrollWidth).toBeGreaterThan(scroller?.clientWidth ?? 0)
    await userEvent.click(canvas.getByRole('button', { name: 'Reset column widths' }))
    await waitFor(() => expect(client.width()).toBe(width))
    await expect(scroller?.scrollWidth).toBe(scroller?.clientWidth)
    await expect(canvas.getByRole('button', { name: 'Reset column widths' })).toBeDisabled()
  },
}

/** Widths saved for another set of columns are ignored: every column keeps its own width. */
export const StaleStorageIgnored: Story = {
  beforeEach: () => {
    localStorage.setItem(
      columnWidthsKey(TABLE),
      JSON.stringify({ columns: 'number,client', widths: { number: 300 } }),
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(header(canvas, 'Number').width()).toBe(128)
    await expect(canvas.getByRole('button', { name: 'Reset column widths' })).toBeDisabled()
  },
}
