import { expect, openPage, test } from './fixtures'

const png = (buffer: Buffer) => {
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

const gifFrame = (pixel: number) => [
  0x21,
  0xf9,
  4,
  0,
  1,
  0,
  0,
  0,
  0x2c,
  0,
  0,
  0,
  0,
  1,
  0,
  1,
  0,
  0,
  2,
  2,
  pixel,
  1,
  0,
]

/** A GIF whose logical screen is 300 × 300, of two 1 × 1 frames (red, then blue), looping for ever. */
const twoFrameGif = () => {
  const header = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x2c, 0x01, 0x2c, 0x01, 0x80, 0, 0]
  const palette = [0xff, 0, 0, 0, 0, 0xff]
  const loop = [0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0]
  return Buffer.from(header.concat(palette, loop, gifFrame(0x44), gifFrame(0x4c), [0x3b]))
}

const svg = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120">
     <script>window.top.svgRan = true</script>
     <image href="https://logo-fetch-probe.invalid/x.png" width="10" height="10"/>
     <rect x="20" y="20" width="260" height="80" fill="#c0392b"/>
   </svg>`,
)

const picked = (name: string, mimeType: string, buffer: Buffer) => ({ name, mimeType, buffer })

test('a GIF, an SVG and a WebP are saved as the same PNG logos the API already accepts', async ({
  page,
  api,
}) => {
  await api.settings()
  const probes: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('logo-fetch-probe')) probes.push(request.url())
  })
  await openPage(page, '/settings/workspace', 'Workspace')
  const workspace = page.getByTestId('workspace-logo').locator('input[type=file]')
  const webp = Buffer.from(
    await page.evaluate(async () => {
      const canvas = window.document.createElement('canvas')
      canvas.width = 600
      canvas.height = 240
      const context = canvas.getContext('2d')
      if (!context) throw new Error('no canvas')
      context.fillStyle = '#1f2937'
      context.fillRect(60, 60, 480, 120)
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/webp', 1),
      )
      if (!blob) throw new Error('no webp')
      return [...new Uint8Array(await blob.arrayBuffer())]
    }),
  )

  const save = async (input: typeof workspace, file: ReturnType<typeof picked>, url: string) => {
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' && new URL(response.url()).pathname === url,
    )
    await input.setInputFiles(file)
    await page.getByRole('button', { name: 'Use this logo' }).click()
    expect((await saved).ok()).toBe(true)
    await expect(page.getByRole('dialog')).toBeHidden()
    const stored = await page.request.get(url)
    expect(stored.headers()['content-type']).toBe('image/png')
    return png(await stored.body())
  }

  const gif = picked('logo.gif', 'image/gif', twoFrameGif())
  const vector = picked('logo.svg', 'image/svg+xml', svg)
  const still = picked('logo.webp', 'image/webp', webp)

  // One upload at a time: both logos keep a per-workspace guard against concurrent replacement.
  const square = { width: 512, height: 512 }
  expect(await save(workspace, gif, '/api/v1/workspace/logo')).toEqual(square)
  expect(await save(workspace, vector, '/api/v1/workspace/logo')).toEqual(square)
  expect(await save(workspace, still, '/api/v1/workspace/logo')).toEqual(square)

  // The document logo lives on the company settings page.
  await openPage(page, '/settings/company', 'Company')
  const document = page.getByRole('region', { name: 'Logo' }).locator('input[type=file]')
  // The document logo keeps the picture's own shape (1 : 1 to 5 : 1) after an even margin is trimmed, at most 640 px
  // high: the square GIF stays square, the SVG and the WebP lose their transparent margin around the drawn box.
  expect(await save(document, gif, '/api/v1/invoice-settings/logo')).toEqual({
    width: 300,
    height: 300,
  })
  expect(await save(document, vector, '/api/v1/invoice-settings/logo')).toEqual({
    width: 1788,
    height: 640,
  })
  expect(await save(document, still, '/api/v1/invoice-settings/logo')).toEqual({
    width: 480,
    height: 120,
  })

  expect(probes).toEqual([])
  expect(await page.evaluate(() => Reflect.get(window, 'svgRan'))).toBeUndefined()
})

test('a logo with too little detail for its purpose is refused before anything is sent', async ({
  page,
  api,
}) => {
  await api.settings()
  await openPage(page, '/settings/workspace', 'Workspace')
  let writes = 0
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().includes('/logo')) writes += 1
  })
  const small = Buffer.from(
    await page.evaluate(async () => {
      const canvas = window.document.createElement('canvas')
      canvas.width = 48
      canvas.height = 48
      const context = canvas.getContext('2d')
      if (!context) throw new Error('no canvas')
      context.fillRect(0, 0, 48, 48)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('no png')
      return [...new Uint8Array(await blob.arrayBuffer())]
    }),
  )
  await page
    .getByTestId('workspace-logo')
    .locator('input[type=file]')
    .setInputFiles(picked('small.png', 'image/png', small))
  await page.getByRole('button', { name: 'Use this logo' }).click()
  await expect(page.getByRole('alert')).toContainText('too small')
  expect(writes).toBe(0)
})

test('what is not a picture is refused by its bytes, whatever the name says', async ({
  page,
  api,
}) => {
  await api.settings()
  await openPage(page, '/settings/workspace', 'Workspace')
  await page
    .getByTestId('workspace-logo')
    .locator('input[type=file]')
    .setInputFiles(picked('logo.png', 'image/png', Buffer.from('%PDF-1.7 not a picture')))
  await expect(page.getByTestId('workspace-logo')).toContainText(
    'Choose a PNG, JPG, WebP, SVG or GIF image',
  )
  await expect(page.getByRole('dialog')).toBeHidden()
})
