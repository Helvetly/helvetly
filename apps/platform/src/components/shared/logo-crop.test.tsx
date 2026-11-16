import { fireEvent, render } from '@testing-library/react'

import { pickProblem } from './logo-crop'
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
