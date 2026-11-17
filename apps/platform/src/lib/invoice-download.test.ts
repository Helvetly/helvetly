import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { downloadEinvoice } from './invoice-download'

const server = setupServer()
const createObjectURL = vi.fn<(value: Parameters<typeof URL.createObjectURL>[0]) => string>(
  () => 'blob:invoice-test',
)
const revokeObjectURL = vi.fn<(url: string) => void>()

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  class DownloadURL extends URL {
    static override createObjectURL = createObjectURL
    static override revokeObjectURL = revokeObjectURL
  }
  vi.stubGlobal('URL', DownloadURL)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => {
  server.resetHandlers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

test('downloads successful XML with the server filename and releases the object URL', async () => {
  server.use(
    http.get('/api/v1/invoices/inv_1/einvoice', ({ request }) => {
      expect(new URL(request.url).searchParams.get('format')).toBe('xrechnung-cii')
      return new HttpResponse('<?xml version="1.0"?><Invoice/>', {
        headers: {
          'content-type': 'application/xml',
          'content-disposition': 'attachment; filename="2026-0042.xml"',
        },
      })
    }),
  )
  const downloads: { url: string; name: string }[] = []
  vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push({ url: this.href, name: this.download })
  })
  await downloadEinvoice('inv_1', 'xrechnung-cii')
  expect(downloads).toEqual([{ url: 'blob:invoice-test', name: '2026-0042.xml' }])
  expect(createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/xml' }))
  expect(document.querySelector('a[download]')).toBeNull()
  await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:invoice-test'), {
    timeout: 1500,
  })
})

test('an API refusal never becomes a downloaded JSON file', async () => {
  server.use(
    http.get('/api/v1/invoices/inv_1/einvoice', () =>
      HttpResponse.json(
        {
          error: {
            code: 'einvoice_endpoint_missing',
            message: 'Electronic addresses are required.',
            details: {},
          },
        },
        { status: 409 },
      ),
    ),
  )
  await expect(downloadEinvoice('inv_1', 'peppol')).rejects.toMatchObject({
    status: 409,
    code: 'einvoice_endpoint_missing',
    message: 'Electronic addresses are required.',
  })
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
  expect(createObjectURL).not.toHaveBeenCalled()
})

test('a Factur-X file without a server filename is saved as a PDF', async () => {
  server.use(
    http.get('/api/v1/invoices/inv_1/einvoice', ({ request }) => {
      expect(new URL(request.url).searchParams.get('format')).toBe('factur-x')
      return new HttpResponse('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } })
    }),
  )
  const names: string[] = []
  vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    names.push(this.download)
  })
  await downloadEinvoice('inv_1', 'factur-x')
  expect(names).toEqual(['inv_1.pdf'])
})
