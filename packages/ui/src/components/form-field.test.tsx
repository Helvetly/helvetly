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
