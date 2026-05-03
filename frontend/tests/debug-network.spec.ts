import { test, expect } from '@playwright/test';

test('debug - network requests', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('currentProfileId', '1')
    localStorage.setItem('darkMode', 'false')
  })
  
  // Capture all network requests
  const requests: any[] = []
  page.on('request', request => {
    requests.push({ url: request.url(), method: request.method() })
  })

  await page.goto('#dashboard', { waitUntil: 'load', timeout: 30000 })
  
  // Wait for page interactions
  await page.waitForTimeout(5000)
  
  // Check requests
  console.log('=== Network Requests ===')
  requests.forEach(r => console.log(r.url))
  
  // Check page state
  const rootContent = await page.locator('#root').innerHTML()
  console.log('=== Root HTML ===')
  console.log(rootContent.substring(0, 300))
})
