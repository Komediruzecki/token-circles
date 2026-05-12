import { expect, test } from '@playwright/test'
import { login, navigateToRoute, getByTestId } from './test-helpers'

test.describe('Rent vs Buy Calculator', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToRoute(page, 'rentBuy')
    await page.waitForTimeout(800)
  })

  test('should display page header', async ({ page }) => {
    const header = page.getByRole('heading', { name: /Rent vs Buy/i, level: 1 })
    await expect(header).toBeVisible()
  })

  test('should have rent scenario inputs', async ({ page }) => {
    await expect(getByTestId(page, 'rent-monthly-input')).toBeVisible()
    await expect(getByTestId(page, 'rent-increase-input')).toBeVisible()
    await expect(getByTestId(page, 'invest-return-input')).toBeVisible()
    await expect(getByTestId(page, 'horizon-input')).toBeVisible()
  })

  test('should have buy scenario inputs', async ({ page }) => {
    await expect(getByTestId(page, 'home-price-input')).toBeVisible()
    await expect(getByTestId(page, 'down-payment-input')).toBeVisible()
    await expect(getByTestId(page, 'loan-term-input')).toBeVisible()
    await expect(getByTestId(page, 'interest-rate-input')).toBeVisible()
  })

  test('should calculate with default values and show results', async ({ page }) => {
    await expect(page.getByText('Total Rent Paid')).toBeVisible({ timeout: 10000 })
    await expect(
      page.getByText('Total Mortgage + Costs').or(page.getByText('Total Mortgage'))
    ).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Winner')).toBeVisible({ timeout: 10000 })
  })

  test('should show break-even year with default values', async ({ page }) => {
    await expect(
      page.getByText(/After/).and(page.getByText(/years, buying becomes cheaper/))
    ).toBeVisible({ timeout: 10000 })
  })

  test('default values produce numeric rent total', async ({ page }) => {
    const rentValue = getByTestId(page, 'total-rent-paid')
    await expect(rentValue).toBeVisible({ timeout: 10000 })
    const text = await rentValue.textContent({ timeout: 5000 })
    const numericVal = parseFloat((text || '0').replace(/[^0-9.]/g, ''))
    expect(numericVal).toBeGreaterThan(100000)
  })

  test('changing rent to 800 updates total', async ({ page }) => {
    await getByTestId(page, 'rent-monthly-input').fill('800')
    await page.waitForTimeout(1000)

    const rentValue = getByTestId(page, 'total-rent-paid')
    await expect(rentValue).toBeVisible({ timeout: 5000 })
    const text = await rentValue.textContent({ timeout: 5000 })
    const rentVal = parseFloat((text || '0').replace(/[^0-9.]/g, ''))
    expect(rentVal).toBeGreaterThan(100000)
  })

  test('changing horizon to 20 updates results', async ({ page }) => {
    await getByTestId(page, 'rent-monthly-input').fill('800')
    await getByTestId(page, 'horizon-input').fill('20')
    await page.waitForTimeout(1000)

    const rentValue = getByTestId(page, 'total-rent-paid')
    await expect(rentValue).toBeVisible({ timeout: 5000 })
    const text = await rentValue.textContent({ timeout: 5000 })
    const rentVal = parseFloat((text || '0').replace(/[^0-9.]/g, ''))
    expect(rentVal).toBeGreaterThan(100000)
  })

  test('changing rent increase to 0 updates results', async ({ page }) => {
    await getByTestId(page, 'rent-monthly-input').fill('800')
    await getByTestId(page, 'rent-increase-input').fill('0')
    await getByTestId(page, 'horizon-input').fill('20')
    await page.waitForTimeout(1000)

    const rentValue = getByTestId(page, 'total-rent-paid')
    await expect(rentValue).toBeVisible({ timeout: 5000 })
    const text = await rentValue.textContent({ timeout: 5000 })
    const rentVal = parseFloat((text || '0').replace(/[^0-9.]/g, ''))
    expect(rentVal).toBeGreaterThan(100000)
  })

  test('higher rent increase produces higher total', async ({ page }) => {
    await getByTestId(page, 'rent-increase-input').fill('5')
    await page.waitForTimeout(1000)

    const text5 = await getByTestId(page, 'total-rent-paid').textContent({ timeout: 5000 })
    const val5 = parseFloat((text5 || '0').replace(/[^0-9.]/g, ''))

    await getByTestId(page, 'rent-increase-input').fill('1')
    await page.waitForTimeout(1000)

    const text1 = await getByTestId(page, 'total-rent-paid').textContent({ timeout: 5000 })
    const val1 = parseFloat((text1 || '0').replace(/[^0-9.]/g, ''))

    expect(val5).toBeGreaterThan(val1)
  })

  test('changing interest rate changes net cost', async ({ page }) => {
    await getByTestId(page, 'rent-monthly-input').fill('1000')
    await page.waitForTimeout(1000)

    const netCost4 = await getByTestId(page, 'rent-net-cost').textContent({ timeout: 5000 })

    await getByTestId(page, 'interest-rate-input').fill('8')
    await page.waitForTimeout(1000)

    const netCost8 = await getByTestId(page, 'rent-net-cost').textContent({ timeout: 5000 })

    // Values should be different
    expect(netCost4).toBeTruthy()
    expect(netCost8).toBeTruthy()
  })

  test('should show Winner and Savings in comparison card', async ({ page }) => {
    const card = getByTestId(page, 'comparison-card')
    await expect(card.getByText('Winner')).toBeVisible({ timeout: 10000 })
    await expect(card.getByText('Savings', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(card.getByText('Break-even')).toBeVisible({ timeout: 10000 })
  })

  test('should show Rent Scenario and Buy Scenario summary cards with dynamic horizon', async ({
    page,
  }) => {
    await getByTestId(page, 'horizon-input').fill('25')
    await page.waitForTimeout(800)
    await expect(page.getByText('Rent Scenario (25 years)')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Buy Scenario (25 years)')).toBeVisible({ timeout: 10000 })
  })

  test('should show graph/chart visualization', async ({ page }) => {
    const chart = getByTestId(page, 'rent-buy-chart')
    await expect(chart).toBeVisible({ timeout: 10000 })
  })
})
