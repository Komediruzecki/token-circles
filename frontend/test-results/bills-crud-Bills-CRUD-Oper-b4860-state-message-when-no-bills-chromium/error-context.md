# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: bills-crud.spec.ts >> Bills CRUD Operations >> should show empty state message when no bills
- Location: tests/bills-crud.spec.ts:376:3

# Error details

```
Error: locator.textContent: Test ended.
Call log:
  - waiting for locator('.empty-state')

```

# Test source

```ts
  281 |     const modal = page.locator('.modal-overlay');
  282 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  283 |       const freqSelect = modal.locator('select');
  284 |       await expect(freqSelect).toBeVisible();
  285 |     }
  286 |   });
  287 | 
  288 |   test('should have autopay toggle', async ({ page }) => {
  289 |     await page.locator('.page-header button:has-text("Add Bill")').click();
  290 | 
  291 |     const modal = page.locator('.modal-overlay');
  292 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  293 |       const autopayToggle = modal.locator('.toggle-switch');
  294 |       const hasToggle = await autopayToggle.isVisible({ timeout: 2000 }).catch(() => false);
  295 |       expect(hasToggle).toBeTruthy();
  296 |     }
  297 |   });
  298 | 
  299 |   test('should have modal footer with cancel and submit buttons', async ({ page }) => {
  300 |     await page.locator('.page-header button:has-text("Add Bill")').click();
  301 | 
  302 |     const modal = page.locator('.modal-overlay');
  303 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  304 |       const footer = modal.locator('.modal-footer');
  305 |       await expect(footer).toBeVisible();
  306 | 
  307 |       const buttons = footer.locator('button');
  308 |       const count = await buttons.count();
  309 |       expect(count).toBeGreaterThanOrEqual(2);
  310 |     }
  311 |   });
  312 | 
  313 |   test('should have cancel button in modal footer', async ({ page }) => {
  314 |     await page.locator('.page-header button:has-text("Add Bill")').click();
  315 | 
  316 |     const modal = page.locator('.modal-overlay');
  317 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  318 |       const footer = modal.locator('.modal-footer');
  319 |       await expect(footer).toBeVisible();
  320 | 
  321 |       const cancelBtn = footer.locator('button:has-text("Cancel")');
  322 |       await expect(cancelBtn).toBeVisible();
  323 |     }
  324 |   });
  325 | 
  326 |   test('should have add button in modal footer', async ({ page }) => {
  327 |     await page.locator('.page-header button:has-text("Add Bill")').click();
  328 | 
  329 |     const modal = page.locator('.modal-overlay');
  330 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  331 |       const footer = modal.locator('.modal-footer');
  332 |       await expect(footer).toBeVisible();
  333 | 
  334 |       const addBtn = footer.locator('button:has-text("Add")');
  335 |       await expect(addBtn).toBeVisible();
  336 |     }
  337 |   });
  338 | 
  339 |   test('should close modal when clicking outside modal content', async ({ page }) => {
  340 |     await page.locator('.page-header button:has-text("Add Bill")').click();
  341 | 
  342 |     const modalContent = page.locator('.modal-content');
  343 |     if (await modalContent.isVisible({ timeout: 2000 }).catch(() => false)) {
  344 |       // Click the overlay/background, not the modal content itself
  345 |       await page.locator('.modal-overlay').click({ position: { x: 0, y: 0 } });
  346 |       await page.waitForTimeout(200);
  347 | 
  348 |       const isClosed = await modalContent.isVisible({ timeout: 500 }).catch(() => false);
  349 |       expect(isClosed).toBeFalsy();
  350 |     }
  351 |   });
  352 | 
  353 |   test('should close modal when clicking cancel button', async ({ page }) => {
  354 |     await page.locator('.page-header button:has-text("Add Bill")').click();
  355 | 
  356 |     const modal = page.locator('.modal-overlay');
  357 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  358 |       await modal.locator('.modal-close').click();
  359 |       await page.waitForTimeout(200);
  360 | 
  361 |       const isClosed = await modal.isVisible({ timeout: 500 }).catch(() => false);
  362 |       expect(isClosed).toBeFalsy();
  363 |     }
  364 |   });
  365 | 
  366 |   test('should handle empty bills state', async ({ page }) => {
  367 |     await page.goto('#bills');
  368 |     await page.waitForLoadState('networkidle');
  369 | 
  370 |     const emptyState = page.locator('.empty-state');
  371 |     const hasEmptyState = await emptyState.isVisible({ timeout: 2000 }).catch(() => false);
  372 |     // Empty state should be hidden if there are no bills
  373 |     expect(hasEmptyState).toBeFalsy();
  374 |   });
  375 | 
  376 |   test('should show empty state message when no bills', async ({ page }) => {
  377 |     await page.goto('#bills');
  378 |     await page.waitForLoadState('networkidle');
  379 | 
  380 |     const emptyState = page.locator('.empty-state');
> 381 |     const emptyText = emptyState.textContent();
      |                                  ^ Error: locator.textContent: Test ended.
  382 |     const hasEmptyText = await emptyState.isVisible({ timeout: 2000 }).catch(() => false);
  383 |     expect(hasEmptyText).toBeFalsy();
  384 |   });
  385 | 
  386 |   test('should handle console errors gracefully', async ({ page }) => {
  387 |     const errors: string[] = [];
  388 |     page.on('console', (msg) => {
  389 |       if (msg.type() === 'error') {
  390 |         errors.push(msg.text());
  391 |       }
  392 |     });
  393 | 
  394 |     page.on('pageerror', (error) => {
  395 |       errors.push(error.message);
  396 |     });
  397 | 
  398 |     await page.goto('#bills');
  399 |     await page.waitForLoadState('networkidle');
  400 | 
  401 |     // Should not have critical errors
  402 |     const criticalErrors = errors.filter((msg) =>
  403 |       msg.includes('Error') && !msg.includes('Failed to fetch')
  404 |     );
  405 |     expect(criticalErrors.length).toBeLessThan(3);
  406 |   });
  407 | 
  408 |   test('should display loading state', async ({ page }) => {
  409 |     await page.goto('#bills');
  410 |     await page.waitForTimeout(500);
  411 | 
  412 |     const loadingText = page.locator('.empty-state:has-text("Loading")');
  413 |     const hasLoading = await loadingText.isVisible({ timeout: 2000 }).catch(() => false);
  414 |     // May or may not show loading state
  415 |     expect(hasLoading).toBeFalsy();
  416 |   });
  417 | 
  418 |   test('should have responsive bill cards', async ({ page }) => {
  419 |     await page.waitForLoadState('networkidle');
  420 | 
  421 |     const billCards = page.locator('.bill-card');
  422 |     const hasCards = await billCards.isVisible({ timeout: 2000 }).catch(() => false);
  423 |     expect(hasCards).toBeFalsy(); // Cards exist but may be hidden
  424 |   });
  425 | 
  426 |   test('should have proper form validation', async ({ page }) => {
  427 |     await page.locator('.page-header button:has-text("Add Bill")').click();
  428 | 
  429 |     const modal = page.locator('.modal-overlay');
  430 |     if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
  431 |       // Try to submit form without required fields
  432 |       const submitBtn = modal.locator('.modal-footer button:has-text("Add")');
  433 |       await submitBtn.click();
  434 |       await page.waitForTimeout(200);
  435 | 
  436 |       // Form should still be open
  437 |       const isModalOpen = await modal.isVisible({ timeout: 500 }).catch(() => false);
  438 |       expect(isModalOpen).toBeTruthy();
  439 |     }
  440 |   });
  441 | 
  442 |   test('should be visible on page', async ({ page }) => {
  443 |     await page.goto('#bills');
  444 |     await page.waitForSelector('.page-bills', { state: 'attached', timeout: 5000 });
  445 |     await expect(page.locator('.page-bills')).toBeVisible();
  446 |   });
  447 | 
  448 |   test('should render all page elements correctly', async ({ page }) => {
  449 |     await page.goto('#bills');
  450 |     await page.waitForLoadState('networkidle');
  451 | 
  452 |     // Check for page structure
  453 |     await expect(page.locator('.page.page-bills')).toBeVisible();
  454 |     await expect(page.locator('.page-header')).toBeVisible();
  455 |     await expect(page.locator('.page-subtitle')).toBeVisible();
  456 |   });
  457 | 
  458 |   test('should format currency correctly', async ({ page }) => {
  459 |     await page.waitForLoadState('networkidle');
  460 | 
  461 |     const currencyValues = page.locator('.amount-value');
  462 |     const count = await currencyValues.count();
  463 |     expect(count).toBeGreaterThanOrEqual(0);
  464 |   });
  465 | 
  466 |   test('should format date correctly', async ({ page }) => {
  467 |     await page.waitForLoadState('networkidle');
  468 | 
  469 |     const dateText = page.locator('.bill-details');
  470 |     const hasDate = await dateText.isVisible({ timeout: 2000 }).catch(() => false);
  471 |     expect(hasDate).toBeFalsy(); // Date exists but may not be visible
  472 |   });
  473 | });
```