const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const proxyHost = 'http://localhost:4433';


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
      '--ignore-certificate-errors',
      '--enable-unsafe-swiftshader',
      '--log-net-log=netlog.json',
      '--net-log-capture-mode=IncludeCookiesAndCredentials',
      `--proxy-server=${proxyHost}`,
    ],
  });

  const page = await browser.newPage();

  // Browser console logs
  page.on('console', msg => console.log('[PAGE LOG]', msg.text()));

  page.on('request', async request => {
    const url = request.url();
    const method = request.method();
    const type = request.resourceType().toUpperCase();

    // Log video chunk fetches
    if (url.includes('googlevideo.com') && url.includes('mime=video')) {
      console.log(`[VIDEO CHUNK] ${method} ${type} ${url.split('?')[0]}`);
    }
  });


  page.on('response', async (res) => {
    const url = res.url();
    const status = res.status();
  
    // Log video chunk fetches
    if (url.includes('googlevideo.com') && url.includes('mime=video')) {
      console.log(`[VIDEO CHUNK] ${status} ${url.split('?')[0]}`);
    }
  });

  console.log('[INFO] Navigating to YouTube embed...');
  
  // Japan-blocked video
  await page.goto('https://www.youtube.com/embed/5YGW2JRxWUU?autoplay=1&mute=1', {
    waitUntil: 'domcontentloaded',
  });

  // // Japan-blocked music
  //   await page.goto('https://music.youtube.com/watch?v=muoWDA6zmsY&autoplay=1', {
  //   waitUntil: 'domcontentloaded',
  // });

  // 30sec video
  // await page.goto('https://www.youtube.com/embed/tWoo8i_VkvI?autoplay=1&mute=1', {
  //   waitUntil: 'domcontentloaded',
  // });


  // not blocked video
  // await page.goto('https://www.youtube.com/embed/YE7VzlLtp-4?autoplay=1&mute=1', {
  //   waitUntil: 'domcontentloaded',
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
      if (video.currentTime === 0) {
        log("waiting for processing...");
        return; // Ignore the initial timeupdate
      } // Ignore the initial timeupdate
      log('timeupdate:', video.currentTime.toFixed(2));
    });
    video.addEventListener('progress', () => {
      const buf = [];
      for (let i = 0; i < video.buffered.length; i++) {
        buf.push(`[${video.buffered.start(i).toFixed(2)} - ${video.buffered.end(i).toFixed(2)}]`);
      }
      log('progress:', buf.join(', '));
    });

    // // just for catching the initial play error
    // video.play().then(() => {
    //   log('initial play success');
    // }).catch(err => {
    //   log('initial play error:', err);
    // });

    // Retry if necessary
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

  // Poll until fully buffered or ended
  let fullyBuffered = false;
  let ended = false;
  let waitingshotCount = 0;
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
  
      if(result.buffered === 0) { 
        console.log(`[INFO] Video is not playing yet. Waiting more...`);
        const failFilename = path.join(screenshotDir, `waitshot_${String(waitingshotCount).padStart(2, '0')}.png`);
        await page.screenshot({ path: failFilename });
        console.log(`[INFO] Waiting screenshot saved: ${failFilename}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        waitingshotCount++;
        continue;
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
  
      await new Promise(resolve => setTimeout(resolve, 5000)); // wait 10 seconds
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