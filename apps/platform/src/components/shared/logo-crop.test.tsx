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

const svg = (text: string) => new File([text], 'logo.svg', { type: 'image/svg+xml' })

describe('pickProblem', () => {
  test('lets a PNG of a sensible size through', async () =>
    expect(await pickProblem(png(800, 300))).toBeNull())

  test('goes by the bytes: a PNG called a WebP is a PNG, a WebP called a PNG is a WebP', async () => {
    expect(await pickProblem(png(100, 100, 24, 'image/webp'))).toBeNull()
    const webp = new Uint8Array(40)
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c])
    webp.set([0x2f, 0x63, 0xc0, 0x18, 0], 20)
    expect(await pickProblem(new File([webp], 'logo.png', { type: 'image/png' }))).toBeNull()
  })

  test('refuses what is over 2 MB before reading it, and what is no picture at all', async () => {
    expect(await pickProblem(png(100, 100, 3 * 1024 * 1024))).toMatch(/2 MB/)
    expect(await pickProblem(new File(['%PDF-1.7'], 'logo.png', { type: 'image/png' }))).toMatch(
      /PNG, JPG, WebP, SVG or GIF/,
    )
  })

  test('refuses a picture without a readable size, an enormous one, and an SVG without dimensions', async () => {
    expect(await pickProblem(png(0, 0))).toMatch(/could not be read/)
    expect(await pickProblem(png(9000, 9000))).toMatch(/40 million pixels/)
    expect(await pickProblem(svg('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toMatch(/viewBox/)
    expect(
      await pickProblem(svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 30"/>')),
    ).toBeNull()
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

  test.each([
    [160, 64],
    [264, 106],
  ])(
    'a %i × %i PNG of the field shape does not bypass the 150 dpi floor',
    async (width, height) => {
      const onSave = open(png(width, height))
      await picture()
      await userEvent.click(screen.getByRole('button', { name: 'Use this logo' }))
      expect((await screen.findByRole('alert')).textContent).toMatch(/crop is too small/)
      expect(onSave).not.toHaveBeenCalled()
    },
  )

  test('a 270 × 108 PNG, the least that keeps 150 dpi, is still saved as the very file picked', async () => {
    const file = png(270, 108)
    const onSave = open(file)
    await picture()
    await userEvent.click(screen.getByRole('button', { name: 'Use this logo' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(file))
  })

  test('a low-resolution refusal is cleared by correcting the crop, and the same dialog then saves', async () => {
    const file = png(1000, 400)
    const onSave = open(file)
    await picture()
    const group = screen.getByRole('button', { name: /arrow keys/ })
    // Zoomed to the top, 1000 px over a quarter of the field is below 150 dpi.
    for (let press = 0; press < 30; press += 1) fireEvent.keyDown(group, { key: '+' })
    await userEvent.click(screen.getByRole('button', { name: 'Use this logo' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/crop is too small/)
    expect(screen.getByRole('button', { name: 'Use this logo' })).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Fit the whole picture' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use this logo' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(file))
  })

  test('zooming back out also clears the refusal, and a still-too-small crop is refused again on save', async () => {
    const onSave = open(png(1000, 400))
    await picture()
    const group = screen.getByRole('button', { name: /arrow keys/ })
    for (let press = 0; press < 30; press += 1) fireEvent.keyDown(group, { key: '+' })
    await userEvent.click(screen.getByRole('button', { name: 'Use this logo' }))
    await screen.findByRole('alert')
    fireEvent.keyDown(group, { key: '+' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use this logo' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/crop is too small/)
    expect(onSave).not.toHaveBeenCalled()
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
    // A portrait picture gets the square field: 75 % of it wide, centred.
    expect(start).toBeCloseTo(12.5, 5)
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
    // As the header says, 3 : 2 fills its own field.
    expect(parseFloat(box?.style.width ?? '')).toBeCloseTo(100, 5)
    if (img) {
      Object.defineProperty(img, 'naturalWidth', { value: 400 })
      Object.defineProperty(img, 'naturalHeight', { value: 600 })
      fireEvent.load(img)
    }
    await waitFor(() => expect(parseFloat(box?.style.width ?? '')).toBeCloseTo(66.667, 2))
    expect(box?.style.height).toBe('100%')
    expect(parseFloat(box?.style.left ?? '')).toBeCloseTo(16.667, 2)
  })

  test('an unreadable picture says so', async () => {
    open(png(300, 400))
    const img = await picture()
    if (img) fireEvent.error(img)
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be read/)
  })
})
