import { randomUUID } from 'node:crypto'

import { expect, signIn, test } from './fixtures'

test('a teammate joining reaches the bell, which forgets it 5 minutes after it was read', async ({
  api,
  page,
  browser,
  baseURL,
}) => {
  // The browser's clock drives the bubble's 5-minute cutoff (read_after), so it can be moved ahead.
  await page.clock.install()
  await page.goto('/clients')
  // The sidebar's Notifications item, under Ask Heidi; its description is the unread count.
  const bell = page.getByRole('button', { name: 'Notifications', exact: true })
  await expect(bell).toHaveAccessibleDescription('')

  // The action: an invited person signs in and joins; the owner is told.
  const email = `e2e-joiner-${randomUUID()}@example.test`
  await api.save('/members/invitations', { email, role: 'member', send_email: false })
  const joiner = await browser.newContext({ baseURL })
  try {
    await signIn(joiner.request, email)
  } finally {
    await joiner.close()
  }

  // The bell checks every minute.
  await page.clock.runFor(61_000)
  await expect(bell).toHaveAccessibleDescription('1 unread')

  // Opening the bubble marks it read but keeps it marked new while open.
  await bell.click()
  const bubble = page.getByRole('dialog', { name: 'Notifications' })
  const item = bubble.getByRole('link', { name: /joined the workspace/ })
  await expect(item).toBeVisible()
  await expect(bubble.getByText('New', { exact: true })).toBeVisible()
  await expect(bell).toHaveAccessibleDescription('')

  // Read a minute ago: still in the bubble, without the dot.
  await page.keyboard.press('Escape')
  await bell.click()
  await expect(item).toBeVisible()
  await expect(bubble.getByText('New', { exact: true })).toHaveCount(0)

  // Read more than 5 minutes ago: gone from the bubble.
  await page.keyboard.press('Escape')
  await page.clock.fastForward('06:00')
  await bell.click()
  await expect(bubble.getByText('You’re all caught up')).toBeVisible()
  await expect(item).toHaveCount(0)

  // It stays on the Notifications page.
  await bubble.getByRole('link', { name: 'All notifications' }).click()
  await expect(page).toHaveURL(/\/notifications\/?$/)
  await expect(page.getByRole('link', { name: /joined the workspace/ }).first()).toBeVisible()
  const response = await page.request.get('/api/v1/notifications')
  const body: unknown = await response.json()
  expect(JSON.stringify(body)).toContain(email)

  // Preferences open in a drawer over the page, and the old settings tab's address lands there too.
  await page.getByRole('link', { name: 'Preferences' }).click()
  const prefs = page.getByRole('dialog', { name: 'Notification preferences' })
  await expect(prefs.getByRole('button', { name: /Team/ })).toBeVisible()
  // The address follows the drawer (without a navigation), like a record's ?id=.
  await expect(page).toHaveURL(/\/notifications\/?\?prefs=1$/)
  await page.keyboard.press('Escape')
  await expect(prefs).toHaveCount(0)
  await expect(page).toHaveURL(/\/notifications\/?$/)
  await page.goto('/account/notifications')
  await expect(prefs).toBeVisible()
  await expect(page).toHaveURL(/\/notifications\/?(\?prefs=1)?$/)
})
