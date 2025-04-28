const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

(async () => {
  const screenshotDir = path.join(__dirname, 'screens');
  const logPath = path.join(__dirname, 'request_response_log.json');
  const playerMetaPath = path.join(screenshotDir, 'ytInitialPlayerResponse.json');
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir);

  const requestLog = [];

  console.log('[INFO] Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: './chrome-headless-shell',
    userDataDir: './youtube_temp_profile',
    dumpio: false,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
      '--mute-audio',
      '--disable-gpu',
      '--ignore-certificate-errors',
    ],
  });

  const page = await browser.newPage();

  // 🔍 Log request and response details
  page.on('request', (req) => {
    requestLog.push({
      type: 'request',
      url: req.url(),
      method: req.method(),
      headers: req.headers(),
      postData: req.postData(),
      timestamp: Date.now(),
    });
  });

  page.on('response', async (res) => {
    const headers = res.headers();
    const status = res.status();
    const url = res.url();
    let body = '';

    // Try reading JSON/text if it looks like JSON or HTML
    if (headers['content-type'] && headers['content-type'].includes('application/json')) {
      try {
        body = await res.text();
      } catch (e) {
        body = '[error reading body]';
      }
    }

    requestLog.push({
      type: 'response',
      url,
      status,
      headers,
      bodySnippet: body.slice(0, 500), // just a small preview
      timestamp: Date.now(),
    });

    // 🔁 Log video stream fetches
    if (url.includes('googlevideo.com') && url.includes('mime=video')) {
      console.log(`[VIDEO CHUNK] ${status} ${url.split('?')[0]}`);
    }
  });

  console.log('[INFO] Navigating to YouTube embed...');
  await page.goto('https://www.youtube.com/embed/5YGW2JRxWUU?autoplay=1&mute=1', { waitUntil: 'networkidle2' });

  console.log('[INFO] Waiting for <video> element...');
  await page.waitForSelector('video');

  // 🧠 Dump ytInitialPlayerResponse metadata
  const playerResponse = await page.evaluate(() => {
    const match = document.documentElement.innerHTML.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\});/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch (e) {
        return { error: 'Failed to parse ytInitialPlayerResponse' };
      }
    }
    return { error: 'ytInitialPlayerResponse not found' };
  });

  fs.writeFileSync(playerMetaPath, JSON.stringify(playerResponse, null, 2));
  console.log(`[INFO] Saved ytInitialPlayerResponse metadata to ${playerMetaPath}`);

  // 🎥 Continue with playback monitor as before
  await page.evaluate(() => {
    const video = document.querySelector('video');
    if (!video) return;

    const log = (...args) => console.log('[VIDEO]', ...args);

    video.addEventListener('playing', () => log('playing'));
    video.addEventListener('waiting', () => log('waiting (buffering)'));
    video.addEventListener('ended', () => log('ended'));
    video.addEventListener('timeupdate', () => {
      log('timeupdate:', video.currentTime.toFixed(2));
    });

    video.play().catch(err => {
      log('initial play error:', err);
    });
  });

  let done = false;
  let screenshotCount = 0;

  while (!done) {
    try {
      const { buffered, duration, ended } = await page.evaluate(() => {
        const video = document.querySelector('video');
        const bufferedEnd = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
        return { buffered: bufferedEnd, duration: video.duration, ended: video.ended };
      });

      console.log(`[INFO] Buffered: ${buffered.toFixed(2)} / ${duration.toFixed(2)}`);

      const filename = path.join(screenshotDir, `screenshot_${screenshotCount.toString().padStart(2, '0')}.png`);
      await page.screenshot({ path: filename });
      console.log(`[INFO] Screenshot saved: ${filename}`);
      screenshotCount++;

      if (ended || buffered >= duration - 0.5) done = true;
      else await new Promise(res => setTimeout(res, 5000));
    } catch (err) {
      console.error(`[ERROR] ${err.message}`);
      break;
    }
  }

  fs.writeFileSync(logPath, JSON.stringify(requestLog, null, 2));
  console.log(`[INFO] Request/Response logs saved to ${logPath}`);

  await browser.close();
})();
