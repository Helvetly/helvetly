import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { SidebarMenuButton, SidebarProvider } from './sidebar'
import { TooltipProvider } from './tooltip'

const item = (defaultOpen: boolean) =>
  render(
    <TooltipProvider delayDuration={0}>
      <SidebarProvider defaultOpen={defaultOpen}>
        <Popover>
          <SidebarMenuButton asChild tooltip="Notifications">
            <PopoverTrigger>Bell</PopoverTrigger>
          </SidebarMenuButton>
          <PopoverContent aria-label="Bubble">Caught up</PopoverContent>
        </Popover>
      </SidebarProvider>
    </TooltipProvider>,
  )

test('in an expanded sidebar Escape closes what the button opened, even with the pointer on it', async () => {
  const user = userEvent.setup()
  item(true)
  const bell = screen.getByRole('button', { name: 'Bell' })
  await user.click(bell)
  expect(screen.getByRole('dialog', { name: 'Bubble' })).toBeInTheDocument()
  await user.unhover(bell)
  await user.hover(bell)
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'Bubble' })).toBeNull()
})

test('the collapsed icon rail names the button in a tooltip', async () => {
  const user = userEvent.setup()
  item(false)
  await user.hover(screen.getByRole('button', { name: 'Bell' }))
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Notifications')
})
