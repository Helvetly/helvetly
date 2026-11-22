import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { AIApprovalProvider } from '@/components/ai/ai-approval'
import { AIWrite } from '@/components/ai/ai-write'
import { TextareaBox } from '@/components/textarea-box'
import type { AIWriteInput } from '@/lib/ai-write'
import { aiConsent, aiNotice } from '@/mocks/ai-notice'

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

/** A description field with Write with AI inside it, as the product form has it. */
function Field({ initial }: { initial: string }) {
  const [text, setText] = useState(initial)
  return (
    <div className="w-[480px]">
      <TextareaBox
        aria-label="Description"
        value={text}
        readOnly
        max={1000}
        tools={
          <AIWrite
            field="product_description"
            text={text}
            maxLength={1000}
            context={{ name: 'Web design, hourly', price: 'CHF 120.00', unit: undefined }}
            onApply={setText}
          />
        }
      />
    </div>
  )
}

/** Idle: one prompt with quiet suggestions under it; the prompt has focus and nothing is asked yet. */
export const Idle: Story = {
  beforeEach: () => {
    asked = []
  },
  parameters: { msw: { handlers } },
  render: () => <Field initial="web design per hour, 2 revisions" />,
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Write with AI' }))
    const prompt = await body().findByRole('textbox', { name: 'What should Heidi write?' })
    await waitFor(() => expect(prompt).toHaveFocus())
    await expect(prompt).toHaveAttribute(
      'placeholder',
      expect.stringMatching(/^Tell Heidi what to change/),
    )
    await expect(body().getByRole('button', { name: 'Ask Heidi' })).toBeDisabled()
    await expect(body().getByRole('button', { name: 'Improve' })).toBeVisible()
    await expect(body().getByRole('button', { name: 'Shorter' })).toBeVisible()
    await expect(body().getByRole('button', { name: 'More formal' })).toBeVisible()
    await expect(body().queryByText(/nothing changes until/)).toBeNull()
    await expect(body().getByRole('button', { name: /nothing changes until/ })).toBeVisible()
    await expect(asked).toHaveLength(0)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body().queryByRole('dialog')).toBeNull())
  },
}

/** Writing: the same panel shows a quiet placeholder where the proposal will be; the prompt keeps its focus. */
export const Writing: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        http.post('/api/v1/ai/write', async () => {
          await delay('infinite')
          return HttpResponse.json({ data: { text: '' } })
        }),
      ],
    },
  },
  render: () => <Field initial="web design per hour, 2 revisions" />,
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Write with AI' }))
    await userEvent.click(await body().findByRole('button', { name: 'Shorter' }))
    await expect(
      await body().findByRole('status', { name: 'Heidi is writing…' }),
    ).toBeInTheDocument()
    await expect(body().getByRole('textbox', { name: 'What should Heidi write?' })).toHaveFocus()
    await expect(body().getByRole('button', { name: 'Shorter' })).toBeDisabled()
  },
}

/** Answer: an empty field gets a draft from the rest of the form; the panel grows to show it, the field stays as it was. */
export const Answer: Story = {
  beforeEach: () => {
    asked = []
  },
  parameters: { msw: { handlers } },
  render: () => <Field initial="" />,
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Write with AI' }))
    const panel = await body().findByRole('dialog', { name: 'Write with AI' })
    const before = panel.getBoundingClientRect()
    await userEvent.click(body().getByRole('button', { name: 'Write a draft' }))
    await expect(await body().findByText(/Hourly web design/)).toBeVisible()
    await waitFor(() => {
      const after = panel.getBoundingClientRect()
      expect(after.height).toBeGreaterThan(before.height)
      expect(after.width).toBeGreaterThan(before.width)
    })
    await expect(body().getByRole('textbox', { name: 'Description' })).toHaveValue('')
    await expect(body().getByRole('button', { name: 'Use this' })).toBeVisible()
    await expect(body().getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(body().queryByRole('button', { name: 'Add below' })).toBeNull()
    await expect(asked[0]).toMatchObject({
      field: 'product_description',
      action: 'draft',
      text: '',
      max_length: 1000,
      context: { name: 'Web design, hourly', price: 'CHF 120.00' },
    })
    await userEvent.click(body().getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(asked).toHaveLength(2))
    await expect(asked[1]).toMatchObject({ action: 'draft', text: '' })
  },
}

/** Refine: words typed under a proposal rewrite that proposal in place, not the field's text. */
export const Refine: Story = {
  beforeEach: () => {
    asked = []
  },
  parameters: { msw: { handlers } },
  render: () => <Field initial="web design per hour, 2 revisions" />,
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Write with AI' }))
    await userEvent.type(
      await body().findByRole('textbox', { name: 'What should Heidi write?' }),
      'mention the handover{Enter}',
    )
    await expect(await body().findByText(/Web design by the hour/)).toBeVisible()
    await expect(asked[0]).toMatchObject({
      action: 'custom',
      text: 'web design per hour, 2 revisions',
      instruction: 'mention the handover',
    })
    const prompt = body().getByRole('textbox', { name: 'What should Heidi write?' })
    await expect(prompt).toHaveValue('')
    await expect(prompt).toHaveAttribute('placeholder', expect.stringMatching(/^Refine it/))
    await userEvent.type(prompt, 'in German{Enter}')
    await waitFor(() => expect(asked).toHaveLength(2))
    await expect(asked[1]).toMatchObject({
      action: 'custom',
      text: 'Web design by the hour, with two revision rounds and every file handed over.',
      instruction: 'in German',
    })
    await expect(await body().findByText(/Web design by the hour/)).toBeVisible()
  },
}

/** Use this: the proposal replaces the field's text and the panel closes; the toast's Undo brings the old text back. */
export const UseThis: Story = {
  parameters: { msw: { handlers } },
  render: () => (
    <>
      <Field initial="web design per hour, 2 revisions" />
      <Toaster />
    </>
  ),
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Write with AI' }))
    await userEvent.click(await body().findByRole('button', { name: 'Improve' }))
    await userEvent.click(await body().findByRole('button', { name: 'Use this' }))
    const description = body().getByRole('textbox', { name: 'Description' })
    await waitFor(() =>
      expect(description).toHaveValue(
        'Web design by the hour, with two revision rounds and every file handed over.',
      ),
    )
    await waitFor(() => expect(body().queryByRole('dialog')).toBeNull())
    await userEvent.click(await body().findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(description).toHaveValue('web design per hour, 2 revisions'))
  },
}

/** A failed call reads as a notice, never a raw "Not found."; a busy model offers Try again. */
export const Errors: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        http.post('/api/v1/ai/write', () =>
          HttpResponse.json(
            { error: { code: 'ai_busy', message: 'Another AI request is in progress.' } },
            { status: 503 },
          ),
        ),
      ],
    },
  },
  render: () => <Field initial="" />,
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Write with AI' }))
    await userEvent.click(await body().findByRole('button', { name: 'Write a draft' }))
    await expect(await body().findByRole('alert')).toHaveTextContent(
      'The AI is busy right now. Try again in a minute.',
    )
    await expect(body().getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(body().queryByRole('button', { name: 'Use this' })).toBeNull()
  },
}

/** AI use not approved: the approval asks first; Not now sends nothing and leaves the field alone. */
export const NoConsent: Story = {
  beforeEach: () => {
    asked = []
  },
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/heidi/usage', () =>
          HttpResponse.json({
            period: '2026-11',
            tokens_used: 0,
            tokens_included: 500_000,
            tokens_purchased: 0,
            tokens_remaining: 500_000,
            provider_available: true,
            consent: aiConsent(false),
          }),
        ),
        http.get('/api/v1/heidi/consent', () =>
          HttpResponse.json({ data: aiConsent(false), notice: aiNotice }),
        ),
        ...handlers,
      ],
    },
  },
  render: () => (
    <AIApprovalProvider>
      <Field initial="web design per hour, 2 revisions" />
    </AIApprovalProvider>
  ),
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Write with AI' }))
    await userEvent.click(await body().findByRole('button', { name: 'Shorter' }))
    await userEvent.click(await body().findByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(body().queryByRole('button', { name: 'Not now' })).toBeNull())
    await expect(asked).toHaveLength(0)
    await expect(body().getByRole('textbox', { name: 'Description' })).toHaveValue(
      'web design per hour, 2 revisions',
    )
  },
}

/** The box resizes, not the textarea, so the grip sits in the box's bottom-right corner below the tools row. */
export const ResizeFromTheCorner: Story = {
  parameters: { msw: { handlers } },
  render: () => <Field initial="web design per hour, 2 revisions" />,
  play: async () => {
    const textarea = body().getByRole('textbox', { name: 'Description' })
    const box = textarea.closest<HTMLElement>('[data-slot="textarea-box"]')
    if (!box) throw new Error('TextareaBox wrapper not found')
    await expect(getComputedStyle(box).resize).toBe('vertical')
    await expect(getComputedStyle(textarea).resize).toBe('none')
    const before = textarea.getBoundingClientRect().height
    box.style.height = `${box.getBoundingClientRect().height + 100}px`
    await waitFor(() =>
      expect(textarea.getBoundingClientRect().height).toBeCloseTo(before + 100, 0),
    )
    const count = body()
      .getByText(/ \/ 1000$/)
      .getBoundingClientRect()
    await expect(box.getBoundingClientRect().right - count.right).toBeGreaterThanOrEqual(16)
  },
}
