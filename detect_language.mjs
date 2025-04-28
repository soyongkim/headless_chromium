import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const scenarios = [
  { label: 'none', headers: {} }, // explicitly set empty
  { label: 'default', headers: null },
  { label: 'en-US', headers: { 'Accept-Language': 'en-US,en;q=0.9' } },
  { label: 'zh-CN', headers: { 'Accept-Language': 'zh-CN,zh;q=0.9' } },
];

const sites = [
  { name: 'Google', url: 'https://www.google.com' },
  { name: 'YouTube', url: 'https://www.youtube.com' },
  { name: 'Wikipedia', url: 'https://www.wikipedia.org' },
  { name: 'Facebook', url: 'https://www.facebook.com' },
  { name: 'Microsoft', url: 'https://www.microsoft.com' },
  { name: 'Amazon', url: 'https://www.amazon.com' },
  { name: 'Reddit', url: 'https://www.reddit.com' },
  { name: 'Netflix', url: 'https://www.netflix.com' },
  { name: 'Baidu', url: 'https://www.baidu.com' },
  { name: 'Naver', url: 'https://www.naver.com' },
];


const screenshotDir = 'language_test_screenshots';
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir);

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: './chrome-headless-shell',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  for (const site of sites) {
    for (const scenario of scenarios) {
      const page = await browser.newPage();

      if (scenario.headers) {
        await page.setExtraHTTPHeaders(scenario.headers);
      }

      await page.goto(site.url, { waitUntil: 'domcontentloaded' });

      const pageTitle = await page.title();
      const finalUrl = page.url();
      const htmlLang = await page.$eval('html', el => el.lang || 'N/A');
      const bodyPreview = await page.$eval('body', el =>
        el.innerText.slice(0, 300).replace(/\s+/g, ' ')
      );

      const screenshotPath = path.join(
        screenshotDir,
        `${site.name}_${scenario.label}.png`
      );
      await page.screenshot({ path: screenshotPath });

      console.log(`🌐 [${site.name}][${scenario.label}]`);
      console.log(`   📄 Title: ${pageTitle}`);
      console.log(`   🌍 HTML lang: ${htmlLang}`);
      console.log(`   🔀 Final URL: ${finalUrl}`);
      console.log(`   📝 Body: ${bodyPreview}`);
      console.log(`   📷 Screenshot: ${screenshotPath}\n`);

      await page.close();
    }
  }

  await browser.close();
})();
