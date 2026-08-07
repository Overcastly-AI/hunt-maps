/**
 * Manual cold-start-offline verification, driven through a real browser.
 *
 * The scenario that matters is not "works after I used it online". It is:
 * download a region, close the app, come back tomorrow with no signal, from a
 * cold page load, and see the truth about the ground in front of you.
 */
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:4173';
const VIEW = '#14/39.4340/-82.5400';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
// A persistent-ish context is not needed: OPFS lives per origin in the profile,
// and we keep one context across the whole run, closing only the page.
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const log = [];
const say = (m) => { log.push(m); console.log(m); };

async function chip(page) {
  return (await page.getByTestId('coverage-chip').innerText()).replace(/[●○◐◌!]/g, '').trim();
}
async function detail(page) {
  return (await page.getByTestId('coverage-detail').innerText()).trim();
}

// ---- Session 1: online, download the region the hunter cares about ---------
let page = await context.newPage();
await page.goto(`${BASE}/${VIEW}`);
await page.getByTestId('map-canvas').waitFor({ state: 'visible' });
await page.waitForTimeout(4000);
say(`[online, before download] chip = ${await chip(page)}`);

const seeded = await page.evaluate(async () => {
  const h = window.__ridgeline;
  const b = h.map.getBounds();
  const bounds = { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() };
  const tiles = h.offline.tilesForView(bounds, h.map.getZoom());
  const z = tiles[0].z;
  const xs = tiles.map((t) => t.x), ys = tiles.map((t) => t.y);
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const ctx = c.getContext('2d'); ctx.fillStyle = 'rgb(128,200,0)'; ctx.fillRect(0, 0, 256, 256);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const bytes = await blob.arrayBuffer();
  const store = await h.offline.store();
  let n = 0;
  for (let x = Math.min(...xs) - 1; x <= Math.max(...xs) + 1; x++)
    for (let y = Math.min(...ys) - 1; y <= Math.max(...ys) + 1; y++) {
      await store.put(h.offline.tileKey({ z, x, y }), bytes.slice(0)); n++;
    }
  h.offline.invalidate();
  const stats = await store.stats();
  return { n, backend: stats.backend, tileCount: stats.tileCount,
           persisted: await navigator.storage.persisted() };
});
say(`[download] wrote ${seeded.n} tiles, backend = ${seeded.backend}, persisted = ${seeded.persisted}`);

// ---- Close the app entirely ----------------------------------------------
await page.close();
say('[app closed]');

// ---- Session 2: NO SIGNAL, cold page load --------------------------------
await context.setOffline(true);
page = await context.newPage();
say('[offline: true] cold-loading the app from nothing…');
await page.goto(`${BASE}/${VIEW}`);
await page.getByTestId('map-canvas').waitFor({ state: 'visible', timeout: 30000 });
await page.waitForTimeout(6000);
say(`[cold start, offline, downloaded ground] chip   = ${await chip(page)}`);
say(`[cold start, offline, downloaded ground] detail = ${await detail(page)}`);

// ---- Walk off the edge of the download, still with no signal --------------
await page.evaluate(() => {
  const m = window.__ridgeline.map;
  m.jumpTo({ center: [-92.54, 39.43], zoom: m.getZoom() });
});
const seen = [];
for (let i = 0; i < 60; i++) {
  const t = await chip(page);
  if (seen[seen.length - 1] !== t) seen.push(t);
  await page.waitForTimeout(60);
}
say(`[panned 500 miles, offline] badge sequence = ${JSON.stringify(seen)}`);
say(`[panned 500 miles, offline] detail = ${await detail(page)}`);

// ---- Half-covered: the state where the overlay is the whole point ---------
await page.evaluate(() => {
  const m = window.__ridgeline.map;
  m.jumpTo({ center: [-82.5195, 39.434], zoom: m.getZoom() }); // straddle the stored edge
});
await page.waitForTimeout(3000);
say(`[straddling the stored edge, offline] chip = ${await chip(page)}`);
const drawn = await page.evaluate(() => {
  const m = window.__ridgeline.map;
  return m.getLayer('rl-offline-coverage-fill')
    ? m.queryRenderedFeatures({ layers: ['rl-offline-coverage-fill'] }).length : 'layer missing';
});
say(`[straddling the stored edge, offline] rendered coverage features = ${drawn}`);
await page.screenshot({ path: '/tmp/claude-0/-home-user-hunt-maps/7874b2bb-ba11-5d45-bd9c-bcee24ca8ff5/scratchpad/coldstart-partial.png' });

await browser.close();
