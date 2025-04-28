import puppeteer from 'puppeteer-core';

const args = process.argv.slice(2);
const argMap = {};
args.forEach(arg => {
  const [key, value] = arg.split('=');
  if (key.startsWith('--')) argMap[key.slice(2)] = value;
});

const sni = argMap['sni'];
const url = `https://${sni}`;
const proxyHost = 'http://localhost:4433';

const launchOptions = {
  headless: true,
  executablePath: './chrome-headless-shell',
  dumpio: false,
  args: [
    '--no-sandbox',
    '--ignore-certificate-errors',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-gpu',
    '--mute-audio',
    // `--proxy-server=${proxyHost}`,
  ],
};

const classifyContent = async (page) => {
  return await page.evaluate(() => {
    const has = (sel) => document.querySelector(sel) !== null;
    const hasMany = (sel, min = 5) => document.querySelectorAll(sel).length >= min;

    const bodyText = document.body?.innerText?.toLowerCase() || '';
    const bodyHTML = document.body?.innerHTML || '';
    const textLength = bodyText.length;
    const nodeCount = document.body?.querySelectorAll('*').length || 0;
    const title = document.title.toLowerCase();

    const anchors = Array.from(document.querySelectorAll('a'));

    const hasVideoTag = document.querySelector('video');
    const hasPlayerIframe = [...document.querySelectorAll('iframe')].some(i =>
      i.src?.match(/(youtube|vimeo|jwplayer|dailymotion|wistia)/i)
    );
    const isVideo = hasVideoTag || hasPlayerIframe;

    const hasPdf = anchors.some(a => a.href?.endsWith('.pdf'));
    const hasDocx = anchors.some(a => a.href?.match(/\.(docx?|xlsx?|pptx?)$/));
    const isDoc = hasPdf || hasDocx;

    const hasForm = has('form input') || has('form textarea') || has('form select');
    const isLogin = has('form input[type="password"]');
    const isForm = hasForm || isLogin;

    const hasDownload = anchors.some(a => a.href?.match(/\.(zip|exe|apk|msi|rar|tar|gz)$/i));

    const is404 = /404|page not found|not exist|error 4\d\d/i.test(bodyText) || title.includes('not found');
    const isBlank = textLength < 30 && nodeCount < 20;

    let category = 'web';
    if (isVideo) category = 'video';
    else if (isDoc) category = 'doc';
    else if (isForm) category = 'form';
    else if (hasDownload) category = 'download';
    else if (is404 || isBlank) category = 'error_or_blank';

    return {
      category,
      meta: {
        textLength,
        nodeCount,
        anchorCount: anchors.length,
        hasVideoTag: !!hasVideoTag,
        hasForm,
        hasDownload,
      },
    };
  });
};


try {
  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();

  const start = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  const category = await classifyContent(page);
  const loadTime = ((Date.now() - start) / 1000).toFixed(2);

  await browser.close();
  console.log(`${category},${loadTime}`);
  process.exit(0);
} catch (err) {
  console.log(`error,0`);
  process.exit(1);
}
