import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { AIApprovalProvider } from '@/components/ai/ai-approval'
import { billingFixture, publicOfferFixture } from '@/components/billing/billing-fixture'
import { queryKeys } from '@/lib/queries'

import { ImportDrawer } from './import-drawer'

const push = vi.fn<(href: string) => void>()
const replace = vi.fn<(href: string) => void>()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => '/welcome',
  useSearchParams: () => new URLSearchParams(),
}))

const server = setupServer(
  http.get('/api/v1/billing', () => HttpResponse.json({ data: billingFixture() })),
  http.get('/api/v1/public/offers/current', () => HttpResponse.json({ data: publicOfferFixture })),
  http.get('/api/v1/session', () => HttpResponse.json({ data: null })),
  http.get('/api/v1/imports', () => HttpResponse.json({ data: [] })),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

test('the plan notice opens the plans over the drawer and leaves the page where it is', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn<() => void>()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.authConfig, {
    google: false,
    email: true,
    passkey: false,
    dev_codes: false,
    ai_available: true,
  })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <AIApprovalProvider>
          <ImportDrawer kind="auto" onClose={onClose} />
        </AIApprovalProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  const notice = await screen.findByText(/to use the AI import/)
  expect(notice).toHaveTextContent(
    'Upgrade to Pro to use the AI import. Imports already read stay open for review.',
  )
  await user.click(screen.getByRole('button', { name: 'Upgrade to Pro' }))
  const plans = await screen.findByRole('dialog', { name: 'Choose a plan' })
  expect(await within(plans).findByText('Basic')).toBeVisible()
  expect(push).not.toHaveBeenCalled()
  expect(replace).not.toHaveBeenCalled()
  expect(screen.getByText('Import documents')).toBeInTheDocument()
  expect(onClose).not.toHaveBeenCalled()
})
