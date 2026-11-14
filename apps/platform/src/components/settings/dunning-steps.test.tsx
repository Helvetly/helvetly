import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

import type { FieldErrors } from '@/components/section-form'

import {
  DunningSteps,
  sortSteps,
  stepSummary,
  stepTitle,
  timingProblems,
  validFee,
  type StepDraft,
} from './dunning-steps'

const step = (change: Partial<StepDraft>): StepDraft => ({
  key: crypto.randomUUID(),
  name: '',
  timing: 'after_due',
  days: '10',
  fee: '0.00',
  text: '',
  qr_bill: true,
  ...change,
})

const three = () => [
  step({ key: 'a' }),
  step({ key: 'b', timing: 'after_previous', days: '14', fee: '20' }),
  step({ key: 'c', timing: 'after_previous', days: '14', fee: '30.00', text: 'Zahlen Sie.' }),
]

test.each([
  [step({}), '10 days after due · no fee · standard text'],
  [step({ timing: 'before_due', days: '3' }), '3 days before due · friendly note · standard text'],
  [
    step({ timing: 'after_previous', days: '14', fee: '20', text: 'Bitte.' }),
    '14 days after the previous · CHF 20.00 fee · own text',
  ],
  [step({ days: '1', qr_bill: false }), '1 day after due · no fee · standard text · no QR bill'],
])('a step reads as one line', (draft, line) => {
  expect(stepSummary(draft, 'CHF')).toBe(line)
})

test('steps are named by their place among the reminders after the due date', () => {
  const steps = [step({ timing: 'before_due', days: '3' }), ...three(), step({ days: '60' })]
  expect(steps.map((_, i) => stepTitle(steps, i))).toEqual([
    'Payment due soon',
    'Payment reminder',
    'Reminder 2',
    'Reminder 3',
    'Final reminder',
  ])
  expect(stepTitle([step({ name: '  Hinweis ' })], 0)).toBe('Hinweis')
})

test('the order follows the planned day, and a step out of place says why', () => {
  const sorted = sortSteps([
    step({ key: 'late', days: '20' }),
    step({ key: 'note', timing: 'before_due', days: '3' }),
  ])
  expect(sorted.map((s) => s.key)).toEqual(['note', 'late'])
  expect(timingProblems([step({ timing: 'after_previous' })])).toEqual([
    'The first reminder counts from the due date.',
  ])
  expect(
    timingProblems([step({ timing: 'before_due', days: '3' }), step({ timing: 'after_previous' })]),
  ).toEqual(['', 'Count from the due date after a note before it.'])
  expect(timingProblems([step({}), step({})])[1]).toBe(
    'Each reminder must come after the one before it.',
  )
})

test.each([
  ['', true],
  ['20', true],
  ['2.35', true],
  ['2.33', false],
  ['1000.00', true],
  ['1000.05', false],
  ['-5', false],
  ['abc', false],
])('a fee of %j is valid: %s', (typed, valid) => {
  expect(validFee(typed)).toBe(valid)
})

const NO_ERRORS: FieldErrors = {}

function Harness({ initial, errors = NO_ERRORS }: { initial: StepDraft[]; errors?: FieldErrors }) {
  const [steps, setSteps] = useState(initial)
  return (
    <TooltipProvider>
      <DunningSteps steps={steps} currency="CHF" errors={errors} onChange={setSteps} />
      <output data-testid="steps">{JSON.stringify(steps)}</output>
    </TooltipProvider>
  )
}

const saved = () => JSON.parse(screen.getByTestId('steps').textContent ?? '[]') as StepDraft[]
const rows = () => within(screen.getByRole('list', { name: 'Reminders' })).getAllByRole('listitem')

test('lists each step with its summary around the due date', () => {
  render(<Harness initial={[step({ timing: 'before_due', days: '3' }), ...three()]} />)
  expect(rows().map((row) => row.textContent)).toEqual([
    expect.stringContaining('Payment due soon3 days before due · friendly note'),
    'Due date',
    expect.stringContaining('Payment reminder10 days after due · no fee · standard text'),
    expect.stringContaining('Reminder 214 days after the previous · CHF 20.00 fee'),
    expect.stringContaining('Final reminder14 days after the previous · CHF 30.00 fee · own text'),
  ])
})

test('edits a step in the dialog; Apply changes the list, Cancel does not', async () => {
  const user = userEvent.setup()
  render(<Harness initial={three()} />)
  await user.click(screen.getByRole('button', { name: 'Edit Reminder 2' }))
  let dialog = screen.getByRole('dialog', { name: 'Edit Reminder 2' })
  expect(within(dialog).getByText(/Despite our reminder, invoice \[number\]/)).toBeVisible()
  const fee = within(dialog).getByRole('textbox', { name: 'Fee' })
  await user.clear(fee)
  await user.type(fee, '2.33')
  await user.click(within(dialog).getByRole('button', { name: 'Apply' }))
  expect(within(dialog).getByText('From 0 to 1000.00, in steps of 0.05.')).toBeVisible()
  await user.clear(fee)
  await user.type(fee, '25')
  await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Zweite Mahnung')
  await user.click(within(dialog).getByRole('switch', { name: /QR bill/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Apply' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(saved()[1]).toMatchObject({ name: 'Zweite Mahnung', fee: '25', qr_bill: false })
  expect(
    screen.getByText('14 days after the previous · CHF 25.00 fee · standard text · no QR bill'),
  ).toBeVisible()

  await user.click(screen.getByRole('button', { name: 'Edit Final reminder' }))
  dialog = screen.getByRole('dialog', { name: 'Edit Final reminder' })
  await user.clear(within(dialog).getByRole('textbox', { name: 'Days' }))
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(saved()[2]?.days).toBe('14')
})

test('adds a note before the due date at the top, without a fee', async () => {
  const user = userEvent.setup()
  render(<Harness initial={three()} />)
  await user.click(screen.getByRole('button', { name: 'Add a reminder' }))
  const dialog = screen.getByRole('dialog', { name: 'New reminder' })
  await user.click(within(dialog).getByRole('radio', { name: 'Before due' }))
  expect(within(dialog).queryByRole('textbox', { name: 'Fee' })).not.toBeInTheDocument()
  const days = within(dialog).getByRole('textbox', { name: 'Days' })
  await user.clear(days)
  await user.type(days, '45')
  await user.click(within(dialog).getByRole('button', { name: 'Apply' }))
  expect(within(dialog).getByText('From 1 to 30 days.')).toBeVisible()
  await user.clear(days)
  await user.type(days, '3')
  await user.click(within(dialog).getByRole('button', { name: 'Apply' }))
  expect(saved()).toHaveLength(4)
  expect(saved()[0]).toMatchObject({ timing: 'before_due', days: '3', fee: '0.00' })
  expect(rows()[1]?.textContent).toBe('Due date')
})

test('a step out of order is refused in the dialog', async () => {
  const user = userEvent.setup()
  render(<Harness initial={three()} />)
  await user.click(screen.getByRole('button', { name: 'Add a reminder' }))
  const dialog = screen.getByRole('dialog', { name: 'New reminder' })
  await user.click(within(dialog).getByRole('radio', { name: 'After previous' }))
  await user.click(within(dialog).getByRole('radio', { name: 'After due' }))
  const days = within(dialog).getByRole('textbox', { name: 'Days' })
  await user.clear(days)
  await user.type(days, '10')
  await user.click(within(dialog).getByRole('button', { name: 'Apply' }))
  expect(within(dialog).getByText('Each reminder must come after the one before it.')).toBeVisible()
  expect(saved()).toHaveLength(3)
})

test('removes a step after confirming; the last one cannot go', async () => {
  const user = userEvent.setup()
  render(<Harness initial={three()} />)
  await user.click(screen.getByRole('button', { name: 'Edit Reminder 2' }))
  await user.click(screen.getByRole('button', { name: 'Remove reminder' }))
  await user.click(screen.getByRole('button', { name: 'Keep it' }))
  expect(saved()).toHaveLength(3)
  await user.click(screen.getByRole('button', { name: 'Remove reminder' }))
  await user.click(screen.getByRole('button', { name: 'Remove' }))
  expect(saved().map((s) => s.fee)).toEqual(['0.00', '30.00'])
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  render(<Harness initial={[step({})]} />, {
    container: document.body.appendChild(document.createElement('div')),
  })
  const [, only] = screen.getAllByRole('button', { name: 'Edit Payment reminder' })
  if (!only) throw new Error('second list expected')
  await user.click(only)
  expect(screen.queryByRole('button', { name: 'Remove reminder' })).not.toBeInTheDocument()
})

test('the server’s errors mark the step and show in its dialog', async () => {
  const user = userEvent.setup()
  render(
    <Harness
      initial={three()}
      errors={{ 'dunning_steps.2.fee': 'Enter a fee from 0 to 1000.00, in steps of 0.05.' }}
    />,
  )
  expect(rows()[3]).toHaveTextContent('Enter a fee from 0 to 1000.00, in steps of 0.05.')
  await user.click(screen.getByRole('button', { name: 'Edit Final reminder' }))
  const fee = within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Fee' })
  expect(fee).toHaveAttribute('aria-invalid', 'true')
})

test('stops offering more steps at ten', () => {
  render(<Harness initial={Array.from({ length: 10 }, (_, i) => step({ days: String(i + 1) }))} />)
  expect(screen.queryByRole('button', { name: 'Add a reminder' })).not.toBeInTheDocument()
})
