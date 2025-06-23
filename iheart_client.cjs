const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

// 1️⃣ Parse CLI arguments
const argMap = {};
process.argv.slice(2).forEach(arg => {
  const [key, value] = arg.split('=');
  argMap[key.replace(/^--/, '')] = value !== undefined ? value : true;
});

const targetUrl = argMap.url || 'https://www.iheart.com/podcast/true-crime-tonight-277647499/';
const useProxy = argMap['use-proxy'] === true || argMap['use-proxy'] === 'true';
const proxyHost = 'http://localhost:4433';

console.log('[INFO] Target URL:', targetUrl);
console.log('[INFO] Use Proxy:', useProxy);

// 2️⃣ Screenshots directory
const screenshotDir = path.join(__dirname, 'screens');
if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir);
}

(async () => {
  console.log('[INFO] Launching browser...');
  const launchArgs = [
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox',
    '--mute-audio',
    '--disable-gpu',
    '--ignore-certificate-errors',
  ];

  if (useProxy) {
    launchArgs.push(`--proxy-server=${proxyHost}`);
  }

  const browser = await puppeteer.launch({
    headless: 'shell',
    userDataDir: './autoplay_temp_profile',
    args: launchArgs,
  });

  const page = await browser.newPage();

  // Log console messages from the page
  page.on('console', msg => console.log('[PAGE LOG]', msg.text()));

  // Listen for audio streaming requests
  page.on('request', request => {
    const url = request.url();
    if (url.includes('.mp3') || url.includes('/stream/')) {
      console.log('[AUDIO STREAM REQUEST]', url);
    }
  });

  console.log(`[INFO] Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

  console.log('[INFO] Waiting for the Play button...');
  try {
    await page.waitForSelector('button[data-test="play-button"]', { timeout: 15000 });
    console.log('[INFO] Play button found.');

    // Simulate user gesture
    await page.mouse.click(100, 100);
    await page.keyboard.press('Space');
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('[INFO] Clicking Play button...');
    await page.click('button[data-test="play-button"]');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.click('button[data-test="play-button"]'); // toggle

    console.log('[INFO] Play button clicked.');

    // Wait for the player to start buffering or playing
    await page.waitForFunction(() => {
      const btn = document.querySelector('button[data-test="play-button"]');
      if (!btn) return false;
      const state = btn.getAttribute('data-test-state');
      console.log('[DEBUG] Play button state:', state);
      return state === 'playing' || state === 'buffering';
    }, { timeout: 15000 });

    console.log('[INFO] Playback started or buffering...');

    // Screenshot loop
    let screenshotCount = 0;
    let isPlaying = true;

    while (isPlaying) {
      // Take a screenshot
      const filename = path.join(screenshotDir, `autoplay_screenshot_${String(screenshotCount).padStart(2, '0')}.png`);
      await page.screenshot({ path: filename });
      console.log(`[INFO] Screenshot saved: ${filename}`);
      screenshotCount++;

      // Wait 10 seconds before next screenshot
      await new Promise(resolve => setTimeout(resolve, 10000));

      // Check playback state
      const state = await page.evaluate(() => {
        const btn = document.querySelector('button[data-test="play-button"]');
        if (!btn) return 'unknown';
        return btn.getAttribute('data-test-state');
      });

      console.log('[INFO] Current play button state:', state);

      if (state === 'paused') {
        console.log('[INFO] Playback ended.');
        isPlaying = false;
      }
    }

  } catch (err) {
    console.error('[ERROR]', err.message || err);
    const failFilename = path.join(screenshotDir, `error_screenshot.png`);
    await page.screenshot({ path: failFilename });
    console.log(`[INFO] Error screenshot saved: ${failFilename}`);
  } finally {
    await browser.close();
    console.log('[INFO] Browser closed.');
  }
})();
