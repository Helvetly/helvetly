import { invoicesApi, type EinvoiceFormat } from '@/lib/invoices'

/** Only a successful XML response becomes a file; API errors stay in the application's error flow. */
export async function downloadEinvoice(id: string, format: EinvoiceFormat): Promise<void> {
  await saveResponse(await invoicesApi.einvoice(id, format), `${id}.xml`)
}

/** Saves a successful API response as a file named by its Content-Disposition, else `fallback`. */
export async function saveResponse(response: Response, fallback: string): Promise<void> {
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download =
    response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? fallback
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    // Give the browser time to start consuming the download before releasing its object URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
