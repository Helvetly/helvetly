import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LogoCropDialog, pickProblem } from './logo-crop'
import { WorkspaceMark } from './workspace-mark'

const png = (width: number, height: number, bytes = 24, type = 'image/png') => {
  const data = new Uint8Array(bytes)
  const view = new DataView(data.buffer)
  view.setUint32(0, 0x89504e47)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return new File([data], 'logo.png', { type })
}

describe('pickProblem', () => {
  test.each(['workspace', 'document'] as const)(
    'lets a PNG of a sensible size through (%s)',
    async (kind) => expect(await pickProblem(png(800, 300), kind)).toBeNull(),
  )

  test('refuses what is not a PNG or JPEG, or is over 2 MB, before reading it', async () => {
    expect(await pickProblem(png(100, 100, 24, 'image/webp'), 'document')).toMatch(/PNG or JPEG/)
    expect(await pickProblem(png(100, 100, 3 * 1024 * 1024), 'document')).toMatch(/2 MB/)
  })

  test('refuses a file whose header is not a picture, or is enormous, with a reason', async () => {
    const text = new File(['hello'], 'logo.png', { type: 'image/png' })
    expect(await pickProblem(text, 'workspace')).toMatch(/can’t be read/)
    expect(await pickProblem(png(9000, 9000), 'workspace')).toMatch(/64–1024 pixels/)
    expect(await pickProblem(png(9000, 9000), 'document')).toMatch(/64–4000 pixels/)
  })
})

describe('WorkspaceMark', () => {
  test('shows the initial without a logo', () => {
    const { container } = render(<WorkspaceMark name="Muster GmbH" />)
    expect(container).toHaveTextContent('M')
    expect(container.querySelector('img')).toBeNull()
  })

  test('shows the logo, and the initial again when it cannot load', () => {
    const { container } = render(
      <WorkspaceMark name="Muster GmbH" logoUrl="/api/v1/workspace/logo?v=1" />,
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(container).not.toHaveTextContent('M')
    if (img) fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
    expect(container).toHaveTextContent('M')
  })
})

const picture = () =>
  screen.findByRole('button', { name: /arrow keys/ }).then((frame) => frame.querySelector('img'))

const open = (file: File) => {
  const onSave = vi.fn<(logo: Blob) => void>()
  render(
    <LogoCropDialog
      kind="document"
      file={file}
      url="blob:logo"
      saving={false}
      progress={null}
      error=""
      onCancel={vi.fn<() => void>()}
      onSave={onSave}
    />,
  )
  return onSave
}

describe('LogoCropDialog, document logo', () => {
  test('a picture of the field shape, shown whole, is saved as the very file picked', async () => {
    const file = png(1000, 400)
    const onSave = open(file)
    await picture()
    expect(screen.getByRole('button', { name: 'Fit the whole picture' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Use this logo' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(file))
  })

  test('a JPEG of the field shape is never saved as picked: its EXIF turn only survives decoding', async () => {
    const decode = vi.fn<() => Promise<ImageBitmap>>().mockRejectedValue(new Error('decoded'))
    vi.stubGlobal('createImageBitmap', decode)
    try {
      const file = png(1000, 400, 24, 'image/jpeg')
      const onSave = open(file)
      await picture()
      await userEvent.click(screen.getByRole('button', { name: 'Use this logo' }))
      await waitFor(() => expect(decode).toHaveBeenCalledWith(file))
      expect(onSave).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('a JPEG labelled as a PNG is still decoded, since the bytes decide', async () => {
    const decode = vi.fn<() => Promise<ImageBitmap>>().mockRejectedValue(new Error('decoded'))
    vi.stubGlobal('createImageBitmap', decode)
    try {
      // A JPEG start, then a start-of-frame header saying 1000 × 400.
      const bytes = new Uint8Array([
        0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x01, 0x90, 0x03, 0xe8, 3, 0, 0, 0, 0, 0,
      ])
      const file = new File([bytes], 'logo.png', { type: 'image/png' })
      const onSave = open(file)
      await picture()
      await userEvent.click(screen.getByRole('button', { name: 'Use this logo' }))
      await waitFor(() => expect(decode).toHaveBeenCalledWith(file))
      expect(onSave).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('a portrait picture starts contained and centred, moves with the arrow keys, and fits again', async () => {
    open(png(300, 400))
    const img = (await picture())?.parentElement
    const left = () => parseFloat(img?.style.left ?? '')
    const start = left()
    expect(img?.style.height).toBe('100%')
    expect(start).toBeCloseTo(35, 5)
    expect(screen.getByText(/wide area on documents/)).toBeInTheDocument()

    const group = screen.getByRole('button', { name: /arrow keys/ })
    fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(left()).toBeLessThan(start)
    for (let press = 0; press < 40; press += 1) fireEvent.keyDown(group, { key: 'ArrowLeft' })
    expect(left()).toBe(0)

    await userEvent.click(screen.getByRole('button', { name: 'Fit the whole picture' }))
    expect(left()).toBeCloseTo(start, 5)
    fireEvent.keyDown(group, { key: '+' })
    expect(parseFloat(img?.style.height ?? '')).toBeCloseTo(110, 5)
  })

  test('once decoded, the picture’s own size wins over the header (an EXIF-turned JPEG is wider in the header than on screen)', async () => {
    // The header says 600 × 400; the browser decodes it turned, 400 × 600.
    open(png(600, 400))
    const img = await picture()
    const box = img?.parentElement
    expect(parseFloat(box?.style.width ?? '')).toBeCloseTo(60, 5)
    if (img) {
      Object.defineProperty(img, 'naturalWidth', { value: 400 })
      Object.defineProperty(img, 'naturalHeight', { value: 600 })
      fireEvent.load(img)
    }
    await waitFor(() => expect(parseFloat(box?.style.width ?? '')).toBeCloseTo(26.667, 2))
    expect(box?.style.height).toBe('100%')
    expect(parseFloat(box?.style.left ?? '')).toBeCloseTo(36.667, 2)
  })

  test('an unreadable picture says so', async () => {
    open(png(300, 400))
    const img = await picture()
    if (img) fireEvent.error(img)
    expect((await screen.findByRole('alert')).textContent).toMatch(/can’t be read/)
  })
})
