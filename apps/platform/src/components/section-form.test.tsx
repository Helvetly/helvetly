import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import { ApiError } from '@/lib/api'

import {
  apiFieldErrors,
  SectionFooter,
  useLeaveGuard,
  useSectionForm,
  type FieldErrors,
  type SectionState,
} from './section-form'

const push = vi.fn<(href: string) => void>()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn<() => void>(), success: vi.fn<() => void>() } }))

type Values = { name: string; city: string; days: string }
const initial: Values = { name: 'Muster AG', city: 'Zürich', days: '30' }

function Part({
  label,
  section,
  children,
}: {
  label: string
  section: SectionState
  children: ReactNode
}) {
  const { attach } = section
  return (
    <section aria-label={label} ref={attach}>
      {children}
      <SectionFooter state={section} />
    </section>
  )
}

function Form({
  save,
  fieldErrors,
  draft,
}: {
  save: (values: Values) => Promise<unknown>
  fieldErrors?: (error: unknown) => FieldErrors | null
  draft?: Values
}) {
  const form = useSectionForm({
    initial,
    draft,
    sections: [
      { id: 'company', fields: ['name', 'city'] },
      { id: 'defaults', fields: ['days'] },
    ],
    validate: (values) => (/^\d+$/.test(values.days) ? {} : { days: 'Whole days.' }),
    save,
    fieldErrors,
    savedMessage: (id) => `${id} saved.`,
  })
  const field = (name: keyof Values) => (
    <>
      <input
        aria-label={name}
        value={form.values[name]}
        onChange={(e) => form.set(name, e.target.value)}
      />
      {form.errors[name] && <span role="alert">{form.errors[name]}</span>}
    </>
  )
  const company = form.section('company')
  const defaults = form.section('defaults')
  return (
    <>
      <p>dirty: {form.dirtySections.join(',') || 'none'}</p>
      <Part label="Company" section={company}>
        {field('name')}
        {field('city')}
      </Part>
      <Part label="Defaults" section={defaults}>
        {field('days')}
      </Part>
    </>
  )
}

const button = (section: string, name: string) =>
  within(screen.getByRole('region', { name: section })).getByRole('button', { name })
const noButton = (section: string, name: string) =>
  within(screen.getByRole('region', { name: section })).queryByRole('button', { name })

beforeEach(() => {
  vi.mocked(toast.success).mockClear()
  vi.mocked(toast.error).mockClear()
})

test('a section is dirty only for its own fields, and discard puts them back', async () => {
  const user = userEvent.setup()
  render(<Form save={vi.fn<() => Promise<unknown>>()} />)
  expect(button('Company', 'Save')).toBeDisabled()
  expect(noButton('Company', 'Discard')).toBeNull()

  await user.type(screen.getByLabelText('city'), ' 1')
  expect(screen.getByText('dirty: company')).toBeVisible()
  expect(button('Company', 'Save')).toBeEnabled()
  expect(button('Defaults', 'Save')).toBeDisabled()
  expect(screen.getByText('Unsaved changes')).toBeVisible()

  await user.click(button('Company', 'Discard'))
  expect(screen.getByLabelText('city')).toHaveValue('Zürich')
  expect(screen.getByText('dirty: none')).toBeVisible()
})

test('a draft starts unsaved: its section is dirty and Discard goes back to what was saved', async () => {
  const user = userEvent.setup()
  render(<Form save={vi.fn<() => Promise<unknown>>()} draft={{ ...initial, days: '45' }} />)
  expect(screen.getByLabelText('days')).toHaveValue('45')
  expect(screen.getByText('dirty: defaults')).toBeVisible()
  await user.click(button('Defaults', 'Discard'))
  expect(screen.getByLabelText('days')).toHaveValue('30')
})

test('saving a section sends the saved values with only its own edits, then says Saved', async () => {
  const user = userEvent.setup()
  const save = vi.fn<(values: Values) => Promise<unknown>>()
  const pending = Promise.withResolvers<unknown>()
  save.mockReturnValue(pending.promise)
  render(<Form save={save} />)
  await user.type(screen.getByLabelText('name'), ' 2')
  await user.clear(screen.getByLabelText('days'))
  await user.type(screen.getByLabelText('days'), '45')

  await user.click(button('Company', 'Save'))
  expect(save.mock.calls[0]?.[0]).toEqual({ name: 'Muster AG 2', city: 'Zürich', days: '30' })
  expect(button('Company', 'Saving…')).toBeDisabled()
  expect(button('Defaults', 'Save')).toBeDisabled() // one save at a time
  await act(async () => pending.resolve(null))

  expect(await screen.findByText('Saved')).toBeVisible()
  expect(toast.success).toHaveBeenCalledWith('company saved.')
  expect(screen.getByText('dirty: defaults')).toBeVisible() // the other section keeps its edit
})

test('the saved check fades after about two seconds', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Form save={() => Promise.resolve()} />)
    await user.type(screen.getByLabelText('city'), 'x')
    await user.click(button('Company', 'Save'))
    expect(await screen.findByText('Saved')).toBeVisible()
    await act(async () => vi.advanceTimersByTime(2100))
    expect(screen.queryByText('Saved')).toBeNull()
  } finally {
    vi.useRealTimers()
  }
})

test('a refused save keeps the edits and shows the server’s field errors and a toast', async () => {
  const user = userEvent.setup()
  const refusal = new ApiError(422, 'validation_failed', 'Check', {
    fields: { 'seller.city': 'Unknown city.' },
  })
  render(
    <Form
      save={() => Promise.reject(refusal)}
      fieldErrors={(error) => apiFieldErrors(error, (name) => name.replace('seller.', ''))}
    />,
  )
  await user.type(screen.getByLabelText('city'), 'x')
  await user.click(button('Company', 'Save'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Unknown city.')
  expect(screen.getByLabelText('city')).toHaveValue('Zürichx')
  expect(toast.error).toHaveBeenCalledWith('Couldn’t save: check the highlighted fields.')
  expect(screen.getByText('dirty: company')).toBeVisible()
})

test('an error that is not about fields is a toast with its message', async () => {
  const user = userEvent.setup()
  render(<Form save={() => Promise.reject(new ApiError(500, 'internal', 'Server down.'))} />)
  await user.type(screen.getByLabelText('city'), 'x')
  await user.click(button('Company', 'Save'))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Server down.'))
})

test('an invalid section is not sent; its problems show', async () => {
  const user = userEvent.setup()
  const save = vi.fn<(values: Values) => Promise<unknown>>()
  render(<Form save={save} />)
  await user.clear(screen.getByLabelText('days'))
  await user.type(screen.getByLabelText('days'), 'ab')
  await user.click(button('Defaults', 'Save'))
  expect(save).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('Whole days.')
  expect(toast.error).toHaveBeenCalled()
})

test('⌘Enter or Ctrl+Enter saves the section the focus is in', async () => {
  const user = userEvent.setup()
  const save = vi.fn<(values: Values) => Promise<unknown>>(() => Promise.resolve())
  render(<Form save={save} />)
  await user.type(screen.getByLabelText('days'), '0')
  await user.keyboard('{Meta>}{Enter}{/Meta}')
  expect(save.mock.lastCall?.[0]).toEqual({ ...initial, days: '300' })
  await screen.findByText('Saved')

  await user.type(screen.getByLabelText('name'), '!')
  await user.keyboard('{Control>}{Enter}{/Control}')
  expect(save.mock.lastCall?.[0]).toEqual({ ...initial, name: 'Muster AG!', days: '300' })
  await user.keyboard('{Enter}') // a plain Enter is not a save
  expect(save).toHaveBeenCalledTimes(2)
})

/** Whether the page asked the browser to confirm closing it. */
const unload = () => {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

function GuardedPage() {
  const guard = useLeaveGuard()
  return (
    <>
      {guard.dialog}
      <Link href="/clients">Clients</Link>
      <button type="button" onClick={() => guard.leave(() => push('/settings/billing'))}>
        Billing
      </button>
      <Form save={() => Promise.resolve()} />
    </>
  )
}

test('leaving with unsaved edits asks first, by link, by tab and on unload', async () => {
  const user = userEvent.setup()
  render(<GuardedPage />)
  expect(unload()).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Billing' }))
  expect(push).toHaveBeenCalledWith('/settings/billing')
  push.mockClear()

  await user.type(screen.getByLabelText('city'), 'x')
  expect(unload()).toBe(true)
  await user.click(screen.getByRole('link', { name: 'Clients' }))
  expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Stay' }))
  expect(push).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'Billing' }))
  await user.click(screen.getByRole('button', { name: 'Discard and leave' }))
  expect(push).toHaveBeenCalledWith('/settings/billing')
})

vi.mock('@helvetly/i18n/locales.json', () => ({
  default: {
    defaultLocale: 'en',
    locales: {
      en: { name: 'English', languageTag: 'en-GB', numberLocale: 'de-CH' },
      de: { name: 'Deutsch', languageTag: 'de-DE', numberLocale: 'de-DE' },
    },
  },
}))

test('discarding edits sends an unprefixed localized link to the Next router', async () => {
  const user = userEvent.setup()
  render(
    <>
      <GuardedPage />
      <Link href="/de/clients">Localized clients</Link>
    </>,
  )
  await user.type(screen.getByLabelText('city'), 'x')
  await user.click(screen.getByRole('link', { name: 'Localized clients' }))
  await user.click(screen.getByRole('button', { name: 'Discard and leave' }))
  expect(push).toHaveBeenCalledWith('/clients')
})
