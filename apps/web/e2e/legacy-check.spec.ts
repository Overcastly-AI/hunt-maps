import { expect, test } from '@playwright/test';
import { DESKTOP, gotoAndSettle, waitForRectStable } from './helpers/settle';
import { chipText, clearTiles, jumpTo, observeChipLabels, remeasure, seedTilesForView } from './helpers/offline';

// Reproduces the ORIGINAL R8 field failure against the legacy chip: tiles are
// on the device when the app boots, so the mount sample says green — and it
// stays green five hundred miles away.
test('legacy stale green', async ({ page, context }) => {
  await gotoAndSettle(page, DESKTOP);
  await clearTiles(page);
  await seedTilesForView(page, 1);
  await page.reload();                      // boot with a non-empty store
  await page.getByTestId('map-canvas').waitFor({ state: 'visible' });
  await waitForRectStable(page.locator('.rl-sheet'));
  await remeasure(page);
  await expect.poll(() => chipText(page), { timeout: 20_000 }).toBe('COVERED');

  await context.setOffline(true);
  await jumpTo(page, -92.54, 39.43);
  const labels = await observeChipLabels(page, 4000);
  console.log('LABELS AFTER 500-MILE PAN:', JSON.stringify(labels));
  expect(labels, `badge sequence: ${labels.join(' -> ')}`).not.toContain('COVERED');
});
