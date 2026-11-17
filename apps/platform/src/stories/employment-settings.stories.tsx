import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { EmploymentSettings } from '@/components/settings/employment-settings'

import { hr } from './pages/api'
import { closeHeidi, dark, desktop, Frame, phone } from './pages/frame'
import { billingOn, hrPage } from './pages/hr'
import { sessionHandler } from './screen-fixtures'

const saved = fn()
// The API answers a save like a read: the stored settings with how many members may approve payroll.
const saveWith = (approvers: number) =>
  http.put('/api/v1/employment/settings', async ({ request }) => {
    const body = await request.json()
    saved(body)
    return HttpResponse.json({
      data: { ...Object(body), payroll_approvers: approvers, updated_at: '2026-11-15T10:00:00Z' },
    })
  })
const save = saveWith(hr.employmentSettings.payroll_approvers)

const meta = {
  title: 'Settings/Employment',
  beforeEach: () => {
    closeHeidi()
    saved.mockClear()
  },
  parameters: hrPage('/settings/employment', {}, [save]),
  render: () => (
    <Frame>
      <EmploymentSettings />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The profile pre-fills new employees; switching to a country with states asks for the state. */
export const Profile: Story = {
  play: async () => {
    const body = within(document.body)
    const canton = await body.findByRole('combobox', { name: 'Canton' }, { timeout: 8000 })
    await expect(canton).toHaveValue('ZH')
    await expect(body.getByRole('button', { name: 'About the employment profile' })).toBeVisible()
    await userEvent.selectOptions(canton, 'GE')
    await userEvent.click(body.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith({
        employing_entity: 'Muster AG',
        country: 'CH',
        region: 'GE',
        require_second_approver: false,
      }),
    )
  },
}
export const ProfileDark = dark(Profile)
export const ProfilePhone = phone(Profile)

/** A 422 lands on its field. */
export const RefusedRegion: Story = {
  parameters: hrPage('/settings/employment', {}, [
    http.put('/api/v1/employment/settings', () =>
      HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Check the highlighted fields.',
            details: { fields: { region: 'Choose a canton of Switzerland.' } },
          },
        },
        { status: 422 },
      ),
    ),
  ]),
  play: async () => {
    const body = within(document.body)
    const canton = await body.findByRole('combobox', { name: 'Canton' }, { timeout: 8000 })
    await userEvent.selectOptions(canton, 'BE')
    await userEvent.click(body.getByRole('button', { name: 'Save' }))
    await expect(await body.findByText('Choose a canton of Switzerland.')).toBeVisible()
  },
}

/** Employees edit without payroll edit: the fields are shown, disabled, and there is no Save. */
export const ReadOnly: Story = {
  parameters: hrPage('/settings/employment', {}, [
    sessionHandler({ role: 'member', scopes: ['*:*', 'write:employees', 'read:payroll'] }),
  ]),
  play: async () => {
    const body = within(document.body)
    await expect(
      (
        await body.findAllByText(
          'Only people with Employees and Payroll edit access can change this.',
          undefined,
          { timeout: 8000 },
        )
      )[0],
    ).toBeVisible()
    await expect(
      body.getByRole('switch', { name: /Require a second person to approve payroll/ }),
    ).toBeDisabled()
    await expect(body.getByRole('textbox', { name: 'Employing company' })).toBeDisabled()
    await expect(body.queryByRole('button', { name: 'Save' })).toBeNull()
  },
}

/** Four-eyes on with nobody else to approve: the setting says so and points to Members. */
export const SecondApproverAlone: Story = {
  parameters: hrPage('/settings/employment', {}, [
    saveWith(1),
    http.get('/api/v1/employment/settings', () =>
      HttpResponse.json({ data: { ...hr.employmentSettings, payroll_approvers: 1 } }),
    ),
  ]),
  play: async () => {
    const body = within(document.body)
    const toggle = await body.findByRole(
      'switch',
      { name: /Require a second person to approve payroll/ },
      { timeout: 8000 },
    )
    await expect(
      body.getByRole('button', { name: 'About Require a second person to approve payroll' }),
    ).toBeVisible()
    await expect(body.queryByText(/Nobody else can approve payroll yet/)).toBeNull()
    await userEvent.click(toggle)
    await expect(await body.findByText(/Nobody else can approve payroll yet/)).toBeVisible()
    await expect(body.getByRole('link', { name: 'Open Members' })).toHaveAttribute(
      'href',
      '/members/',
    )
    await userEvent.click(body.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith(
        expect.objectContaining({ require_second_approver: true }),
      ),
    )
    // Still said once saved: four-eyes is on and nobody else can approve.
    await expect(await body.findByText(/Nobody else can approve payroll yet/)).toBeVisible()
  },
}
export const SecondApproverAloneDark = dark(SecondApproverAlone)

/** The owner after a downgrade: the lock is said high up, every control is off with its reason. */
export const OwnerAfterDowngrade: Story = {
  parameters: hrPage('/settings/employment', {}, [billingOn('pro')]),
  play: async () => {
    const body = within(document.body)
    await expect(
      await body.findByText(/you can view and export it, but not change it/, undefined, {
        timeout: 8000,
      }),
    ).toBeVisible()
    // in the page's content, in the warning tone, not a banner above it
    const notice = body.getByText(/you can view and export it/).closest('[data-tone]')
    await expect(notice).toHaveAttribute('data-tone', 'warning')
    await expect(body.getByRole('link', { name: /See Business/ })).toHaveAttribute(
      'href',
      '/settings/billing/plans/',
    )
    await expect(await body.findByRole('textbox', { name: 'Employing company' })).toBeDisabled()
    await expect(
      body.getByRole('switch', { name: /Require a second person to approve payroll/ }),
    ).toBeDisabled()
  },
}
export const OwnerAfterDowngradePhone = phone(OwnerAfterDowngrade)
export const OwnerAfterDowngradeDark = dark(OwnerAfterDowngrade)

/** A plan without the module and no employee records: no Employment tab, nothing about the module. */
export const HiddenWithoutRecords: Story = {
  parameters: hrPage('/settings/employment', {}, [billingOn('pro', false)]),
  play: async () => {
    const body = within(document.body)
    // the other tabs are there, so the missing one is not just a header that has not rendered
    // the sidebar is there, and loses Employees once billing says the plan lacks it
    await expect(
      await body.findByRole('link', { name: /^Clients/ }, { timeout: 8000 }),
    ).toBeVisible()
    await waitFor(() => expect(body.queryByRole('link', { name: /^Employees/ })).toBeNull(), {
      timeout: 8000,
    })
    await expect(body.queryByRole('button', { name: /^Employment/ })).toBeNull()
    await expect(body.queryByText(/Business does/)).toBeNull()
  },
}
