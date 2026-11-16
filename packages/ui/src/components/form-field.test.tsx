import { render, screen } from '@testing-library/react'

import { FormField } from './form-field'
import { Segmented } from './segmented'

test('a field labels its control and carries its grid width', () => {
  render(
    <FormField id="zip" label="ZIP" width="xs" required>
      <input id="zip" />
    </FormField>,
  )
  const input = screen.getByRole('textbox', { name: 'ZIP' })
  expect(input.closest('[data-slot="form-field"]')).toHaveAttribute('data-width', 'xs')
})

test('a group field names its set of choices, with no label pointing at nothing', () => {
  const { container } = render(
    <FormField id="language" label="Document language" group>
      <Segmented
        label="Document language"
        value="de"
        options={[
          { value: 'de', label: 'Deutsch' },
          { value: 'en', label: 'English' },
        ]}
        onChange={() => {}}
      />
    </FormField>,
  )
  // One group, the Segmented's own: the caption does not wrap it in a second one.
  expect(screen.getAllByRole('group', { name: 'Document language' })).toHaveLength(1)
  expect(container.querySelector('label[for]')).toBeNull()
  expect(screen.getByRole('radio', { name: 'Deutsch' })).toBeChecked()
})

test('each control sits in its own box, an empty child adds none, and the error stays after them', () => {
  const { container } = render(
    <FormField id="terms" label="Terms" error="Enter 0 to 365.">
      <input id="terms" />
      {null}
      <span>days</span>
    </FormField>,
  )
  const field = container.querySelector('[data-slot="form-field"]')
  // label, one box per control (the null child makes none), then the error
  expect([...(field?.children ?? [])].map((child) => child.tagName)).toEqual([
    'SPAN',
    'DIV',
    'DIV',
    'P',
  ])
  expect(screen.getByText('Enter 0 to 365.')).toHaveAttribute('id', 'terms-error')
})
