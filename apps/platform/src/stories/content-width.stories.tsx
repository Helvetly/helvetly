import { Button } from '@helvetly/ui/components/button'
import { FormField } from '@helvetly/ui/components/form-field'
import { Input } from '@helvetly/ui/components/input'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { KeyRound, Mail, Smartphone, UserRound } from 'lucide-react'
import { expect, within } from 'storybook/test'

import { GoogleMark } from '@/components/auth/sign-in'
import { FieldGrid, SettingsPage, SettingsRow, SettingsSection } from '@/components/settings/layout'

const sizes = { phone: 390, laptop: 1280, desktop: 1680, wide: 2560 } as const
const viewport = {
  options: Object.fromEntries(
    Object.entries(sizes).map(([name, width]) => [
      name,
      { name, styles: { width: `${width}px`, height: '1000px' } },
    ]),
  ),
}

const meta = {
  title: 'Design system/Content width and icons',
  parameters: { layout: 'fullscreen', viewport },
  render: () => (
    <SettingsPage
      title="Account settings"
      description="Your profile and how you sign in. These follow you into every workspace you belong to, so a change here applies everywhere at once."
    >
      <SettingsSection
        id="profile"
        icon={UserRound}
        title="Profile"
        description="How you appear to your team, on activity and in emails Helvetly sends for you."
      >
        <FieldGrid>
          <FormField id="name" label="Full name" width="md">
            <Input id="name" defaultValue="Anna Muster" />
          </FormField>
          <FormField id="email" label="Email" width="md">
            <Input id="email" disabled defaultValue="anna@example.com" />
          </FormField>
        </FieldGrid>
      </SettingsSection>
      <SettingsSection
        id="sign-in"
        icon={KeyRound}
        title="Sign-in methods"
        description="Helvetly has no passwords. Sign in with a code sent to your email, your Google account or a passkey."
      >
        <ul className="divide-y">
          <SettingsRow
            icon={<Mail />}
            title="Email code"
            meta="A 6-digit code to anna@example.com"
          />
          <SettingsRow icon={<GoogleMark />} title="Google" meta="Sign in with one click">
            <Button variant="outline" size="sm">
              Connect
            </Button>
          </SettingsRow>
          <SettingsRow
            icon={<Smartphone />}
            title="Authenticator app"
            meta="Recommended for owners"
          />
        </ul>
      </SettingsSection>
    </SettingsPage>
  ),
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const transparent = 'rgba(0, 0, 0, 0)'

/** The rows' icons are outlined and unfilled, set apart from the page's icon tile. */
const iconsApart: Story['play'] = async ({ canvasElement }) => {
  const card = within(canvasElement).getByRole('region', { name: 'Sign-in methods' })
  const rows = [...card.querySelectorAll<HTMLElement>('[data-slot="row-icon"]')]
  await expect(rows).toHaveLength(3)
  await expect(
    rows.map((row) => {
      const style = getComputedStyle(row)
      return { background: style.backgroundColor, border: style.borderTopWidth }
    }),
  ).toEqual(rows.map(() => ({ background: transparent, border: '1px' })))
}

/** The page uses the panel's whole width, sections are bands, no sideways scroll. */
const widthFollowsScreen: Story['play'] = async ({ canvasElement }) => {
  const body = canvasElement.querySelector<HTMLElement>('[data-slot="settings-page"]')
  await expect(body).not.toBeNull()
  if (!body) return
  const width = window.innerWidth
  // No centred column: the page spans the screen, only the side padding is left.
  await expect(getComputedStyle(body).maxWidth).toBe('none')
  const panel = body.parentElement?.getBoundingClientRect().width ?? 0
  await expect(body.getBoundingClientRect().width).toBeGreaterThan(panel - 1)
  await expect(panel).toBeGreaterThan(width - 80)
  await expect(Number.parseFloat(getComputedStyle(body).paddingLeft)).toBeGreaterThanOrEqual(16)
  // What the page is for is one line under its title, readable without a tooltip.
  await expect(body.querySelector('[data-slot="settings-page-description"]')?.textContent).toMatch(
    /how you sign in/,
  )
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width)

  // A section is a band: its title on the left, its fields stacked on the right, label above control.
  const profile = within(body).getByRole('region', { name: 'Profile' })
  const label = within(profile).getByText('Full name')
  const field = within(profile).getByLabelText(/^Full name\*?$/)
  await expect(field.getBoundingClientRect().top).toBeGreaterThan(
    label.getBoundingClientRect().bottom - 1,
  )
  // No boxed card and no hairlines between a section's fields; the form grid at most 44rem, an md
  // field half of it, side by side with the next one when there is room.
  await expect(getComputedStyle(profile).boxShadow).toBe('none')
  await expect(getComputedStyle(profile).borderLeftWidth).toBe('0px')
  const row = field.closest<HTMLElement>('[data-slot="form-field"]')
  await expect(row && getComputedStyle(row).borderTopWidth).toBe('0px')
  const fields = profile.querySelector<HTMLElement>('[data-slot="settings-fields"]')
  const style = fields ? getComputedStyle(fields) : null
  const columns = style?.gridTemplateColumns.split(' ').map(Number.parseFloat) ?? []
  const grid =
    columns.slice(0, 12).reduce((sum, column) => sum + column, 0) +
    11 * Number.parseFloat(style?.columnGap ?? '0')
  await expect(columns.length).toBeGreaterThanOrEqual(12)
  // The form grid is at most 44rem; in a wide card (64rem of sections) the title column takes
  // 7.5rem more and the form 7.5rem less, so the section keeps its width and fields their sizes.
  const sections = body.querySelector<HTMLElement>('[data-slot="settings-sections"]')
  const wideCard = (sections?.getBoundingClientRect().width ?? 0) >= 1024
  await expect(grid).toBeLessThanOrEqual(wideCard ? 584.5 : 704.5)
  if (wideCard) {
    const header = profile.querySelector('header')?.getBoundingClientRect().width ?? 0
    await expect(header).toBeGreaterThan(423)
    await expect(header).toBeLessThan(425)
  }
  await expect(field.getBoundingClientRect().width).toBeLessThanOrEqual(width < 600 ? width : 345)
  const email = within(profile).getByLabelText('Email').getBoundingClientRect()
  if (width >= 600) await expect(email.top).toBe(field.getBoundingClientRect().top)
}

/** Each section title has its icon before it: small, muted and hidden from screen readers. */
const titleIcons: Story['play'] = async ({ canvasElement }) => {
  const titles = [
    ...canvasElement.querySelectorAll<HTMLElement>('[data-slot="settings-section"] h2'),
  ]
  await expect(titles).toHaveLength(2)
  await expect(
    titles.map((title) => {
      const icon = title.firstElementChild
      return (
        icon && {
          slot: icon.getAttribute('data-slot'),
          hidden: icon.getAttribute('aria-hidden'),
          width: icon.getBoundingClientRect().width,
          muted: getComputedStyle(icon).color !== getComputedStyle(title).color,
        }
      )
    }),
  ).toEqual(
    titles.map(() => ({ slot: 'settings-section-icon', hidden: 'true', width: 16, muted: true })),
  )
}

const play: Story['play'] = async (context) => {
  await iconsApart(context)
  await widthFollowsScreen(context)
  await titleIcons(context)
}

export const Phone: Story = { globals: { viewport: { value: 'phone' } }, play }
export const Laptop: Story = { globals: { viewport: { value: 'laptop' } }, play }
export const Desktop: Story = { globals: { viewport: { value: 'desktop' } }, play }
export const Wide: Story = { globals: { viewport: { value: 'wide' } }, play }
export const WideDark: Story = {
  globals: { viewport: { value: 'wide' } },
  parameters: { dark: true },
  play,
}
export const PhoneDark: Story = {
  globals: { viewport: { value: 'phone' } },
  parameters: { dark: true },
  play,
}
