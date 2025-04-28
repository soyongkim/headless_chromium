const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const proxyHost = 'http://localhost:4433';
const requestMap = new Map();

(async () => {
  const screenshotDir = path.join(__dirname, 'screens');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir);
  }

  console.log('[INFO] Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'shell',
    userDataDir: './youtube_temp_profile',
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
      '--mute-audio',
      '--disable-gpu',
      '--enable-unsafe-swiftshader',
      '--ignore-certificate-errors',
      '--enable-logging=stderr',
      '--v=1',
      `--proxy-server=${proxyHost}`,
    ],
  });

  const page = await browser.newPage();

  // Enable DevTools protocol to capture low-level network activity
  const client = await page.target().createCDPSession();
  await client.send('Network.enable');

  // Optional: allow Chrome to use cache explicitly (can be omitted if not overriding)
  await client.send('Network.setCacheDisabled', { cacheDisabled: false });

  // Log where the response was served from
  client.on('Network.responseReceived', (event) => {
    const { response } = event;
    const cacheType = response.fromDiskCache
      ? 'fromDiskCache'
      : response.fromMemoryCache
      ? 'fromMemoryCache'
      : 'fromNetwork';
    console.log(`[CACHE] ${cacheType} - ${response.status} ${response.url}`);
  });


  // client.on('Network.dataReceived', (event) => {
  //   console.log(`[DATA] requestId=${event.requestId} length=${event.dataLength} encoded=${event.encodedDataLength}`);
  // });

  // Browser console logs
  page.on('console', msg => console.log('[PAGE LOG]', msg.text()));

  const dns = require('dns').promises;
  const { URL } = require('url');
  
  page.on('request', async request => {
    const url = new URL(request.url());
    requestMap.set(request.url(), {
      method: request.method(),
      startTime: Date.now(),
      headers: request.headers(),
    });
    const hostname = url.hostname;

  
    const pseudoHeaders = {
      ':method': request.method(),
      ':path': url.pathname + url.search,
      ':authority': url.host,
      ':scheme': url.protocol.replace(':', '')
    };
  
    const headers = request.headers();
  
    const totalHeaderBytes = [
      ...Object.entries(pseudoHeaders),
      ...Object.entries(headers)
    ].reduce(
      (total, [key, value]) =>
        total + Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8'),
      0
    );
  
    console.log(`[REQUEST] (${totalHeaderBytes} bytes) - ${request.method()} ${url.pathname}`, {
      ...pseudoHeaders,
      ...headers
    });
  });

  page.on('response', async response => {
    const url = response.url();
    const status = response.status();
    const endTime = Date.now();

    const req = requestMap.get(url);
    if (req) {
      const duration = endTime - req.startTime;
      console.log(`[RESPONSE] ${status} ${url} (duration: ${duration} ms)`);
    } else {
      console.log(`[RESPONSE] ${status} ${url} (untracked request)`);
    }
  });

  console.log('[INFO] Navigating to YouTube embed...');
  await page.goto('https://www.youtube.com/embed/5YGW2JRxWUU?autoplay=1&mute=1', {
    waitUntil: 'networkidle2',
  });


  // console.log('[INFO] Navigating to Test YouTube embed...');
  // await page.goto('https://www.youtube.com/embed/tWoo8i_VkvI?autoplay=1&mute=1', {
  //   waitUntil: 'networkidle2',
  // });

  console.log('[INFO] Waiting for <video> element...');
  await page.waitForSelector('video');

  console.log('[INFO] Attaching video event listeners and starting playback...');
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
    video.addEventListener('progress', () => {
      const buf = [];
      for (let i = 0; i < video.buffered.length; i++) {
        buf.push(`[${video.buffered.start(i).toFixed(2)} - ${video.buffered.end(i).toFixed(2)}]`);
      }
      log('progress:', buf.join(', '));
    });

    video.play().then(() => {
      log('initial play success');
    }).catch(err => {
      log('initial play error:', err);
    });

    setTimeout(() => {
      if (video.paused || video.readyState < 3) {
        video.play().then(() => {
          log('force play success after delay');
        }).catch(err => {
          log('force play error after delay:', err);
        });
      }
    }, 1000);
  });

  let fullyBuffered = false;
  let ended = false;
  let screenshotCount = 0;

  while (!fullyBuffered && !ended) {
    let result;
    try {
      result = await page.evaluate(() => {
        const video = document.querySelector('video');
        if (!video) throw new Error('No video element found.');
        const bufferedEnd = video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;
        return {
          buffered: bufferedEnd,
          duration: video.duration,
          ended: video.ended
        };
      });

      if (isNaN(result.buffered) || isNaN(result.duration)) {
        throw new Error('Buffered or duration returned NaN.');
      }

      console.log(`[INFO] Buffered: ${result.buffered.toFixed(2)} / ${result.duration.toFixed(2)} sec`);

      const filename = path.join(screenshotDir, `screenshot_${String(screenshotCount).padStart(2, '0')}.png`);
      await page.screenshot({ path: filename });
      console.log(`[INFO] Screenshot saved: ${filename}`);
      screenshotCount++;

      if (result.ended || result.buffered >= result.duration - 0.5) {
        fullyBuffered = true;
        ended = result.ended;
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 10000));
    } catch (err) {
      console.error(`[ERROR] ${err.message || err}`);
      const failFilename = path.join(screenshotDir, `error_screenshot.png`);
      await page.screenshot({ path: failFilename });
      console.log(`[INFO] Error screenshot saved: ${failFilename}`);
      await browser.close();
      process.exit(1);
    }
  }

  console.log(`[INFO] Done. Video status: ${ended ? 'Ended' : 'Buffered to end'}`);
  await browser.close();
})();