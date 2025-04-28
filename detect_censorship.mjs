import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const locales = ['en-US', 'zh-CN', 'ru-RU'];
const screenshotDir = 'locale_screenshot';

// Ensure the screenshot directory exists
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: './chrome-headless-shell', // Update with your actual path
    dumpio: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors',
      '--disable-web-security',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-gpu',
      '--mute-audio',
      '--disable-dev-shm-usage',
    ],
  });

  const results = [];

  for (const locale of locales) {
    const page = await browser.newPage();

    await page.setExtraHTTPHeaders({ 'Accept-Language': locale });

    await page.emulateTimezone('Asia/Shanghai');
    await page.evaluateOnNewDocument(lang => {
      Object.defineProperty(navigator, "language", { get: () => lang });
      Object.defineProperty(navigator, "languages", { get: () => [lang] });
    }, locale);

    await page.goto('https://www.youtube.com', { waitUntil: 'networkidle2' });

    const title = await page.title();
    const htmlLang = await page.$eval('html', el => el.lang || 'N/A');
    const previewText = await page.$eval('body', el => el.innerText.slice(0, 300));

    const screenshotPath = path.join(screenshotDir, `google_${locale}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const info = {
      locale,
      htmlLang,
      title,
      textPreview: previewText.replace(/\n/g, ' ').slice(0, 300),
      screenshot: screenshotPath,
    };
    results.push(info);

    console.log(`✅ Locale: ${locale}`);
    console.log(`   🌍 HTML lang: ${htmlLang}`);
    console.log(`   📄 Title: ${title}`);
    console.log(`   📝 Preview: ${info.textPreview}`);
    console.log(`   🖼️ Screenshot saved: ${screenshotPath}\n`);

    await page.close();
  }

  fs.writeFileSync('locale_results.json', JSON.stringify(results, null, 2));
  console.log('📁 All results saved to locale_results.json');

  await browser.close();
})();
