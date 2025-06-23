import puppeteer from 'puppeteer-core';

(async () => {
  const launchOptions = {
    headless: false, // Headful to see the video actually playing
    executablePath: './chromium/chrome-headless-shell-linux64/chrome-headless-shell',
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--autoplay-policy=no-user-gesture-required',
    ],
  };

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();

  // Enable console logging from the page context
  page.on('console', msg => console.log(`PAGE LOG: ${msg.text()}`));

  const videoUrl = 'https://music.youtube.com/watch?v=muoWDA6zmsY&autoplay=1';

  console.log(`Navigating to ${videoUrl}`);
  await page.goto(videoUrl, { waitUntil: 'networkidle2' });

  // Simulate a click to bypass autoplay restrictions if needed
  try {
    await page.click('body');
    console.log('Simulated user click on body.');
  } catch (err) {
    console.log('No body to click or click failed.');
  }

  // Check if video element is playing
  try {
    const isPlaying = await page.evaluate(() => {
      const video = document.querySelector('video');
      if (!video) {
        console.log('No video element found.');
        return false;
      }
      return !video.paused;
    });

    if (isPlaying) {
      console.log('✅ The video is playing!');
    } else {
      console.log('❌ The video is not playing.');
    }
  } catch (err) {
    console.error('Error evaluating video element:', err.message);
  }

  // Wait a bit so you can see what's happening
  await page.waitForTimeout(10000); // 10 seconds

  await browser.close();
})();
