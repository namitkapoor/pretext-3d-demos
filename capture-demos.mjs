import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const OUT = '/Users/namit/Documents/personal/code/pretext/demo-captures';
mkdirSync(`${OUT}/videos`, { recursive: true });

const browser = await chromium.launch({ headless: true });

// Step 1: scrape all demo links from the index
const indexCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const indexPage = await indexCtx.newPage();
await indexPage.goto('https://pretextjs.dev/pretext-demo/', { waitUntil: 'networkidle', timeout: 30000 });

const demoLinks = await indexPage.evaluate(() => {
  return [...document.querySelectorAll('a[href*="pretext-demo"]')]
    .map(a => ({ href: a.href, text: a.innerText.trim() }))
    .filter(l => l.href !== window.location.href && l.text);
});

console.log('Found demo links:');
demoLinks.forEach(l => console.log(' ', l.text.split('\n')[0].trim(), '->', l.href));

await indexCtx.close();

// Deduplicate by href
const seen = new Set();
const demos = [
  { name: 'index', url: 'https://pretextjs.dev/pretext-demo/' },
  { name: 'showcase-mesmerizing', url: 'https://pretextjs.dev/pretext-demo/showcase-mesmerizing-animation' },
];
for (const l of demoLinks) {
  if (seen.has(l.href) || l.href.includes('pretextjs.dev/pretext-demo/') === false) continue;
  const slug = l.href.split('/pretext-demo/')[1]?.replace(/\/$/, '');
  if (!slug) continue;
  const name = slug.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  if (demos.find(d => d.url === l.href)) continue;
  seen.add(l.href);
  demos.push({ name, url: l.href });
}

console.log('\nCapturing', demos.length, 'demos...\n');

// Step 2: capture each demo
for (const demo of demos) {
  console.log(`Capturing: ${demo.name} (${demo.url})`);
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: `${OUT}/videos/${demo.name}`, size: { width: 1280, height: 800 } },
  });
  const page = await ctx.newPage();

  try {
    await page.goto(demo.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${demo.name}.png` });

    for (let i = 1; i <= 5; i++) {
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${OUT}/${demo.name}-t${i}s.png` });
    }
    console.log('  ✓ done');
  } catch (e) {
    console.log('  ✗ failed:', e.message);
  }

  await ctx.close();
}

await browser.close();
console.log(`\nAll captures saved to ${OUT}`);
