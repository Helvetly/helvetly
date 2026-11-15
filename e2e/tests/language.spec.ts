import { expect, test } from '@playwright/test'

for (const [app, origin] of [
  ['platform', 'http://localhost:8008'],
  ['portal', 'http://localhost:8009'],
]) {
  test(`${app}: language links save the preference without prefixing routes`, async ({ page }) => {
    await page.goto(`${origin}/login?lang=en&source=language-test#form`)
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('title')).toHaveCount(1)
    expect(await page.evaluate(() => localStorage.getItem('helvetly.language'))).toBe('en')
    expect(new URL(page.url()).pathname.replace(/\/$/, '')).toBe('/login')
    expect(new URL(page.url()).searchParams.get('source')).toBe('language-test')
    expect(new URL(page.url()).hash).toBe('#form')

    await page.goto(`${origin}/login?lang=unsupported`)
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('helvetly.language'))).toBe('en')
    await page.goto(`${origin}/login`)
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })
}
