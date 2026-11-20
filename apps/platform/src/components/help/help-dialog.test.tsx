import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { HelpDialog } from './help-dialog'

const toast = vi.hoisted(() => ({ success: vi.fn<(message: string) => void>() }))
vi.mock('sonner', () => ({ toast }))

let received: FormData | undefined
const server = setupServer(
  http.post('/api/v1/feedback', async ({ request }) => {
    received = await request.formData()
    return HttpResponse.json({ id: 'f1' }, { status: 201 })
  }),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const onOpenChange = vi.fn<(open: boolean) => void>()
const renderDialog = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <HelpDialog open onOpenChange={onOpenChange} />
      </TooltipProvider>
    </QueryClientProvider>,
  )

test('asks for a description before sending', async () => {
  renderDialog()
  await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Describe what happened')
})

test('lists screenshots with a remove button and flags more than five', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:shot')
  vi.spyOn(URL, 'revokeObjectURL').mockReturnValue()
  renderDialog()
  const files = Array.from(
    { length: 6 },
    (_, i) => new File(['x'], `s${i + 1}.png`, { type: 'image/png' }),
  )
  await userEvent.upload(screen.getByLabelText(/Screenshots/), files)
  expect(await screen.findByRole('alert')).toHaveTextContent('at most 5')
  await userEvent.click(screen.getByRole('button', { name: 'Remove screenshot 6: s6.png' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('sends the report, closes and thanks the person', async () => {
  renderDialog()
  await userEvent.click(screen.getByRole('radio', { name: /Suggest an idea/ }))
  await userEvent.type(screen.getByLabelText(/Description/), 'Dark invoices')
  await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  expect(received?.get('kind')).toBe('feature')
  expect(received?.get('description')).toBe('Dark invoices')
  expect(toast.success).toHaveBeenCalledWith('Thanks! Your feedback was sent.')
})

test('shows the server error and stays open', async () => {
  server.use(
    http.post('/api/v1/feedback', () =>
      HttpResponse.json(
        { error: { code: 'rate_limited', message: 'Too many reports.' } },
        { status: 429 },
      ),
    ),
  )
  onOpenChange.mockClear()
  renderDialog()
  await userEvent.type(screen.getByLabelText(/Description/), 'Broken')
  await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Too many reports.')
  expect(onOpenChange).not.toHaveBeenCalled()
})
