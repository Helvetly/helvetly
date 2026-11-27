import { Meter } from '@helvetly/ui/components/meter'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { UserAvatar } from '@/components/user-avatar'
import { samplePhoto } from '@/mocks/data'

const picture = samplePhoto

const meta = {
  title: 'Design system/People and markers',
  parameters: { layout: 'padded' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** A member with an uploaded photo shows it; one without falls back to initials. Clients keep their initials. */
export const MemberPhotoOrInitials: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <span data-testid="with-photo" className="flex items-center gap-2">
        <UserAvatar name="Renata Giannini" url={picture} className="size-5" />
        Renata Giannini
      </span>
      <span data-testid="without-photo" className="flex items-center gap-2">
        <UserAvatar name="Luca Bianchi" className="size-5" />
        Luca Bianchi
      </span>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const withPhoto = canvas.getByTestId('with-photo')
    await waitFor(() =>
      expect(withPhoto.querySelector('[data-slot="avatar-image"]')).toBeInTheDocument(),
    )
    expect(withPhoto).not.toHaveTextContent(/^RG/)
    const without = canvas.getByTestId('without-photo')
    expect(without.querySelector('[data-slot="avatar-image"]')).toBeNull()
    expect(without).toHaveTextContent('LB')
  },
}

/** The "expected by now" notch stays visible over the coloured fill and over the grey track, with a tooltip. */
export const ExpectedMarker: Story = {
  render: () => (
    <div className="grid max-w-sm gap-6 p-4">
      <div data-testid="over-fill">
        <Meter
          label="30 of 40 h"
          value={30}
          max={40}
          marker={20}
          markerLabel="Expected by now: 28.6 h"
          size="lg"
        />
      </div>
      <div data-testid="over-track">
        <Meter
          label="10 of 40 h"
          value={10}
          max={40}
          marker={28.6}
          markerLabel="Expected by now: 28.6 h"
          size="lg"
        />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    for (const id of ['over-fill', 'over-track']) {
      const marker = canvas.getByTestId(id).querySelector<HTMLElement>('[data-part="marker"]')
      if (!marker) throw new Error('no marker')
      const style = getComputedStyle(marker)
      // The notch has its own colour and outline, so it never blends into the fill.
      expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
      expect(style.boxShadow).not.toBe('none')
      expect(marker.getBoundingClientRect().width).toBe(2)
    }
    const track = canvas.getByTestId('over-fill').querySelector('[data-slot="meter"]')!
    const marker = canvas.getByTestId('over-fill').querySelector('[data-part="marker"]')!
    expect(marker.getBoundingClientRect().height).toBeGreaterThan(
      track.getBoundingClientRect().height,
    )
    await userEvent.hover(canvas.getAllByRole('button', { name: 'Expected by now: 28.6 h' })[0]!)
    expect(await within(document.body).findAllByText('Expected by now: 28.6 h')).not.toHaveLength(0)
  },
}

export const ExpectedMarkerDark: Story = { ...ExpectedMarker, parameters: { dark: true } }
