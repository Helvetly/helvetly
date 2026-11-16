import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'

import { billingFixture } from '@/components/billing/billing-fixture'

import type { Defaults } from './product-form-model'

const shown = vi.hoisted(() => vi.fn<(defaults: Defaults) => void>())
vi.mock('./product-form', () => ({
  ProductForm: ({ defaults }: { defaults: Defaults }) => {
    shown(defaults)
    return <div>Form in {defaults.currency}</div>
  },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn<(url: string) => void>() }),
  usePathname: () => '/products',
  useSearchParams: () => new URLSearchParams('new=1'),
}))

import { ProductsPage } from './products-page'

afterEach(() => vi.unstubAllGlobals())

test('"New product" from Quick Actions waits for the workspace settings before taking its defaults', async () => {
  const settings = Promise.withResolvers<Response>()
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async (input) =>
      String(input).includes('/invoice-settings')
        ? settings.promise
        : String(input).includes('/billing')
          ? Response.json({ data: billingFixture() })
          : Response.json({ data: [], meta: { page: 1, page_size: 20, total: 0, total_pages: 0 } }),
    ),
  )
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <SidebarProvider>
          <ProductsPage />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )

  settings.resolve(
    Response.json({ data: { currency: 'EUR', vat_registered: false, default_vat_rate: '8.1' } }),
  )
  expect(await screen.findByText('Form in EUR')).toBeVisible()
  expect(shown).not.toHaveBeenCalledWith(expect.objectContaining({ currency: 'CHF' }))
})
