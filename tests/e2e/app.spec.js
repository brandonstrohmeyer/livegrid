import { test, expect } from '@playwright/test'

test('loads the app and shows core panels', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible()
  await expect(page.getByText('Run Groups')).toBeVisible()
})
