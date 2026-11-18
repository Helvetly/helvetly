import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { AIWrite } from '@/components/ai/ai-write'
import type { AIWriteInput } from '@/lib/ai-write'

import { sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Shared flows/Write with AI',
  parameters: { layout: 'centered' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)

let asked: AIWriteInput[] = []

const handlers = [
  sessionHandler(),
  http.post<never, AIWriteInput>('/api/v1/ai/write', async ({ request }) => {
    const input = await request.json()
    asked.push(input)
    return HttpResponse.json({
      data: {
        text:
          input.action === 'draft'
            ? 'Hourly web design: layout, two revision rounds and the handover of all files.'
            : 'Web design by the hour, with two revision rounds and every file handed over.',
      },
    })
  }),
]

/** A description field with Write with AI under it, as the product form has it. */
function Field({ initial }: { initial: string }) {
  const [text, setText] = useState(initial)
  return (
    <div className="grid w-[480px] gap-1.5">
      <textarea
        aria-label="Description"
        value={text}
        readOnly
        className="min-h-20 rounded-md border p-2 text-sm"
      />
      <AIWrite
        field="product_description"
        text={text}
        maxLength={1000}
        context={{ name: 'Web design, hourly', price: 'CHF 120.00', unit: undefined }}
        onApply={setText}
      />
    </div>
  )
}

/** Empty: Heidi drafts from the rest of the form; the text is shown first and only Use this fills the field. */
export const DraftFromTheForm: Story = {
  beforeEach: () => {
    asked = []
  },
  parameters: { msw: { handlers } },
  render: () => <Field initial="" />,
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Write with AI' }))
    await userEvent.click(await body().findByRole('button', { name: 'Write a draft' }))
    await expect(await body().findByText(/Hourly web design/)).toBeVisible()
    await expect(body().getByRole('textbox', { name: 'Description' })).toHaveValue('')
    await expect(asked[0]).toMatchObject({
      field: 'product_description',
      action: 'draft',
      text: '',
      max_length: 1000,
      context: { name: 'Web design, hourly', price: 'CHF 120.00' },
    })
    await userEvent.click(body().getByRole('button', { name: 'Use this' }))
    await waitFor(() =>
      expect(body().getByRole('textbox', { name: 'Description' })).toHaveValue(
        'Hourly web design: layout, two revision rounds and the handover of all files.',
      ),
    )
  },
}

/** With text: a quick action or the person's own words; Replace swaps it, Add below keeps the original. */
export const ImproveWhatIsWritten: Story = {
  beforeEach: () => {
    asked = []
  },
  parameters: { msw: { handlers } },
  render: () => <Field initial="web design per hour, 2 revisions" />,
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Write with AI' }))
    await userEvent.type(
      body().getByRole('textbox', { name: 'What should Heidi write?' }),
      'mention the handover{Enter}',
    )
    await expect(await body().findByText(/Web design by the hour/)).toBeVisible()
    await expect(asked[0]).toMatchObject({ action: 'custom', instruction: 'mention the handover' })
    await userEvent.click(body().getByRole('button', { name: 'Add below' }))
    await waitFor(() =>
      expect(body().getByRole('textbox', { name: 'Description' })).toHaveValue(
        'web design per hour, 2 revisions\nWeb design by the hour, with two revision rounds and every file handed over.',
      ),
    )
  },
}
