import { fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'

import { StagedReceipts } from './expense-receipts'

const photo = new File(['x'], 'lunch.jpg', { type: 'image/jpeg' })

function trackUrls() {
  const created: string[] = []
  const revoked: string[] = []
  vi.stubGlobal(
    'URL',
    Object.assign(function URLStub() {}, {
      createObjectURL: () => {
        const url = `blob:test/${created.length}`
        created.push(url)
        return url
      },
      revokeObjectURL: (url: string) => revoked.push(url),
    }),
  )
  return { created, revoked }
}

afterEach(() => vi.unstubAllGlobals())

test('under StrictMode the shown thumbnail is never revoked, and every other URL is released', () => {
  const { created, revoked } = trackUrls()
  const { container, unmount } = render(
    <StrictMode>
      <StagedReceipts files={[photo]} onRemove={() => {}} />
    </StrictMode>,
  )
  const shown = container.querySelector('img')?.getAttribute('src') ?? ''
  expect(decodeURIComponent(shown)).toContain('blob:test/')
  expect(
    revoked.some((url) => shown.includes(encodeURIComponent(url)) || shown.includes(url)),
  ).toBe(false)
  expect(created.length - revoked.length).toBe(1)
  unmount()
  expect(revoked).toHaveLength(created.length)
})

test('an image the browser cannot decode falls back to the file icon', () => {
  trackUrls()
  const { container } = render(<StagedReceipts files={[photo]} onRemove={() => {}} />)
  const image = container.querySelector('img')
  expect(image).not.toBeNull()
  if (image) fireEvent.error(image)
  expect(container.querySelector('img')).toBeNull()
  expect(screen.getByText('lunch.jpg')).toBeInTheDocument()
})

test('a different file under the same name and size is tried again after a failed one', () => {
  const { created, revoked } = trackUrls()
  const corrupt = new File(['x'], 'lunch.jpg', { type: 'image/jpeg' })
  const valid = new File(['y'], 'lunch.jpg', { type: 'image/jpeg' })
  const { container, rerender } = render(<StagedReceipts files={[corrupt]} onRemove={() => {}} />)
  const failed = container.querySelector('img')
  if (failed) fireEvent.error(failed)
  expect(container.querySelector('img')).toBeNull()

  rerender(<StagedReceipts files={[valid]} onRemove={() => {}} />)
  const shown = container.querySelector('img')?.getAttribute('src') ?? ''
  expect(created).toContain(shown)
  expect(revoked).not.toContain(shown)
})
