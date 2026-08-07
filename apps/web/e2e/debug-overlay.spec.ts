import { expect, test } from '@playwright/test';
import { DESKTOP, gotoAndSettle, waitForRectStable } from './helpers/settle';
import { chipText, clearTiles, remeasure, seedTilesForView } from './helpers/offline';

test('debug overlay', async ({ page }) => {
  page.on('console', (m) => console.log('PAGE:', m.type(), m.text().slice(0, 200)));
  await gotoAndSettle(page, DESKTOP);
  await waitForRectStable(page.locator('.rl-sheet'));
  await clearTiles(page);
  const seeded = await seedTilesForView(page, 0.5);
  console.log('seeded', seeded);
  await remeasure(page);
  await page.waitForTimeout(3000);
  console.log('chip:', await chipText(page));
  const info = await page.evaluate(() => {
    const map = (window as any).__ridgeline.map;
    const style = map.getStyle();
    const src: any = map.getSource('rl-offline-coverage');
    return {
      layers: style.layers.map((l: any) => l.id),
      hasSource: Boolean(src),
      data: src ? JSON.stringify(src._data).slice(0, 200) : null,
      styleLoaded: map.isStyleLoaded(),
      hasImage: map.hasImage('rl-offline-hatch'),
      q: map.getLayer('rl-offline-coverage-fill')
        ? map.queryRenderedFeatures({ layers: ['rl-offline-coverage-fill'] }).length
        : 'no layer',
      qsrc: src ? map.querySourceFeatures('rl-offline-coverage').length : 'nosrc',
    };
  });
  console.log(JSON.stringify(info, null, 2));
  expect(true).toBe(true);
});
