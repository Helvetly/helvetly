import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './accordion'
import { Checkbox } from './checkbox'

test('opens a section from its header and keeps header actions outside the toggle', async () => {
  const user = userEvent.setup()
  const onAction = vi.fn<(checked: boolean | 'indeterminate') => void>()
  render(
    <Accordion type="multiple" defaultValue={['a']}>
      <AccordionItem value="a">
        <AccordionTrigger>First</AccordionTrigger>
        <AccordionContent>First body</AccordionContent>
      </AccordionItem>
      <AccordionItem value="b">
        <AccordionTrigger
          actions={<Checkbox checked="indeterminate" onCheckedChange={onAction} aria-label="All" />}
        >
          Second
        </AccordionTrigger>
        <AccordionContent>Second body</AccordionContent>
      </AccordionItem>
    </Accordion>,
  )
  expect(screen.getByText('First body')).toBeVisible()
  expect(screen.queryByText('Second body')).toBeNull()
  const all = screen.getByRole('checkbox', { name: 'All' })
  expect(all).toHaveAttribute('aria-checked', 'mixed')
  const second = screen.getByRole('button', { name: 'Second' })
  expect(second).not.toContainElement(all)
  await user.click(all)
  expect(onAction).toHaveBeenCalledWith(true)
  expect(second).toHaveAttribute('aria-expanded', 'false')
  await user.click(second)
  expect(screen.getByText('Second body')).toBeVisible()
})
