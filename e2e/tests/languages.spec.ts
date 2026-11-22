import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { signIn } from './fixtures'

// The portal's shared address signs nobody in: its page points to the suppliers' own links.
const languages = [
  {
    code: 'de',
    name: 'Deutsch',
    platform: 'Willkommen bei Helvetly',
    portal: 'Melden Sie sich über den Portal-Link Ihres Anbieters an',
    change: 'Sprache ändern',
  },
  {
    code: 'fr',
    name: 'Français',
    platform: 'Bienvenue sur Helvetly',
    portal: 'Connectez-vous via le lien du portail de votre fournisseur',
    change: 'Changer de langue',
  },
  {
    code: 'it',
    name: 'Italiano',
    platform: 'Benvenuto su Helvetly',
    portal: 'Accedi tramite il link al portale del tuo fornitore',
    change: 'Cambia lingua',
  },
]

for (const app of [
  { origin: 'http://localhost:8008', title: 'Welcome to Helvetly', area: 'platform' },
  {
    origin: 'http://localhost:8009',
    title: "Sign in through your supplier's portal link",
    area: 'portal',
  },
]) {
  for (const language of languages) {
    test(`${app.area}: ${language.code} selection survives navigation and reload`, async ({
      page,
    }) => {
      const title = app.area === 'platform' ? language.platform : language.portal
      await page.goto(`${app.origin}/login?next=%2Finvoices#details`)
      await page.getByRole('button', { name: 'Change language' }).click()
      await page
        .getByRole('dialog')
        .getByRole('button', { name: language.name, exact: true })
        .click()

      await expect(page).toHaveURL(
        `${app.origin}/login?next=%2Finvoices&lang=${language.code}#details`,
      )
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('lang', language.code)
      await expect(page.getByRole('button', { name: language.change })).toBeVisible()

      await page.goto(`${app.origin}/login`)
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
      await page.reload()
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()

      await page.goto(`${app.origin}/login?lang=en`)
      await expect(page.getByRole('heading', { name: app.title, exact: true })).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    })
  }
}

test('signed-in navigation keeps the chosen language and module-level labels', async ({ page }) => {
  await signIn(page.request, `languages-${randomUUID()}@example.test`)
  await page.goto('/clients?lang=de')
  await expect(page.getByRole('button', { name: 'Alle Kunden', exact: true })).toBeVisible()

  const screenshots = join(process.env.TMPDIR ?? tmpdir(), 'helvetly', 'panel-portal-languages')
  await mkdir(screenshots, { recursive: true })
  await page.screenshot({ path: join(screenshots, 'clients-de.png'), animations: 'disabled' })

  await page.getByRole('link', { name: 'Rechnungen', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Rechnungen', exact: true })).toBeVisible()
  await expect(page.getByText('Noch keine Rechnungen', { exact: true })).toBeVisible()
  await expect(page.getByText('Ausstehend', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Neue Rechnung', exact: true })).toHaveCount(2)
  await page.screenshot({ path: join(screenshots, 'invoices-de.png'), animations: 'disabled' })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Rechnungen', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'de')
})
