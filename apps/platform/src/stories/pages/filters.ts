import type { StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

type Check = {
  /** Chips the URL's filters show in the search ("Unit: Hours"). */
  chips: string[]
  /** A popover control to open and the option to pick, with the URL key and value it sets. */
  pick: { control: RegExp; option: string | RegExp; key: string; value: string }
  /** URL keys "Clear all" removes. */
  cleared: string[]
  /** The trigger's count, when a range's two chips count once. */
  count?: number
}

const url = (document: Document) => new URL(document.location.href).searchParams

/**
 * A list's Filters popover against the page: the URL's filters show as chips in the search and as
 * set controls in the popover, a pick goes to the URL, and "Clear all" takes every filter out of it.
 * (A story's URL change does not re-render the page, so each step is read from the URL.)
 */
export const filtersPlay =
  ({ chips, pick, cleared, count = chips.length }: Check): StoryObj['play'] =>
  async ({ canvasElement }) => {
    const document = canvasElement.ownerDocument
    const body = within(document.body)
    await body.findByRole('searchbox', {}, { timeout: 8000 })
    const found = await Promise.all(
      chips.map((chip) =>
        body.findByRole('button', { name: `Remove filter ${chip}` }, { timeout: 8000 }),
      ),
    )
    await Promise.all(found.map((chip) => expect(chip).toBeVisible()))
    const trigger = body.getByRole('button', { name: /^Filters/ })
    await expect(trigger).toHaveTextContent(String(count))

    await userEvent.click(trigger)
    const dialog = within(await body.findByRole('dialog', { name: 'Filters' }))
    await userEvent.click(dialog.getByRole('button', { name: pick.control }))
    await userEvent.click(await body.findByRole('option', { name: pick.option }))
    await waitFor(() => expect(url(document).getAll(pick.key)).toContain(pick.value))

    await userEvent.click(dialog.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => {
      for (const key of cleared) expect(url(document).has(key)).toBe(false)
    })
  }
