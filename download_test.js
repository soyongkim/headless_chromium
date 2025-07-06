import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fileUrl = process.argv[2]; // Example: https://example.com/file.pdf

const downloadDir = path.resolve(__dirname, './downloads');
if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

function waitForFileCompletion(downloadDir, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const files = fs.readdirSync(downloadDir);
      const downloading = files.some(f => f.endsWith('.crdownload'));

      if (!downloading && files.length > 0) {
        clearInterval(interval);
        resolve();
      }

      if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error('Download timeout'));
      }
    }, 500);
  });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: './chromium/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();

  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDir,
  });

  await page.goto('about:blank');

  console.log('Triggering download...');
  const startTime = Date.now();

  await page.evaluate(url => {
    const a = document.createElement('a');
    a.href = url;
    a.download = '';
    document.body.appendChild(a);
    a.click();
  }, fileUrl);

  try {
    await waitForFileCompletion(downloadDir);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Download complete in ${elapsed} seconds`);
  } catch (err) {
    console.error(`Download failed or timed out: ${err.message}`);
  }

  const files = fs.readdirSync(downloadDir);
  console.log('Downloaded files:', files);

  await browser.close();
})();
