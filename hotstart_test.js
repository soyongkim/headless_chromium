import puppeteer from 'puppeteer-core';
import fetch from 'node-fetch';
import dns from 'dns/promises';
import fs from 'fs';
import path from 'path';

// Simple command-line argument parser
const args = process.argv.slice(2);
const argMap = {};
args.forEach(arg => {
  const [key, value] = arg.split('=');
  if (key.startsWith('--')) {
    argMap[key.slice(2)] = value === undefined ? true : value;
  }
});

const targetUrl = argMap.url;
const useProxy = argMap['use-proxy'] === true || argMap['use-proxy'] === 'true';
const proxyHost = 'http://localhost:4433';

if (!targetUrl) {
  console.error('Missing required --url argument. Example: node webpage_test.js --url=example.com');
  process.exit(1);
}

// Function to get country from DNS
async function getCountryFromDNS(hostname) {
  try {
    const { address } = await dns.lookup(hostname);
    const geo = await fetch(`https://ipwho.is/${address}`);
    const data = await geo.json();

    if (data && data.success && data.country_code) {
      return { country: data.country_code, ip: address };
    } else {
      return { country: 'unknown', ip: address };
    }
  } catch (err) {
    return { country: 'unknown', ip: null };
  }
}

// 🚀 Detect Japanese Content
async function detectJapaneseContent(page) {
  return await page.evaluate(() => {
    const textContent = document.body?.innerText || '';
    const hasJapaneseText = /[\u3040-\u30ff\u4e00-\u9faf]/.test(textContent);

    const htmlLang = document.documentElement.lang;
    const isHtmlLangJapanese = htmlLang === 'ja';

    const metaLangs = Array.from(document.querySelectorAll('meta[http-equiv="Content-Language"], meta[name="language"]'))
      .map(meta => meta.content?.toLowerCase() || '')
      .filter(content => content.includes('ja'));

    return {
      hasJapaneseText,
      isHtmlLangJapanese,
      metaLangs
    };
  });
}

// 🚀 Classify Content
const classifyContent = async (page) => {
  return await page.evaluate(() => {
    const has = (sel) => document.querySelector(sel) !== null;

    const bodyText = document.body?.innerText?.toLowerCase() || '';
    const textLength = bodyText.length;
    const nodeCount = document.body?.querySelectorAll('*').length || 0;

    const anchors = Array.from(document.querySelectorAll('a'));
    const anchorCount = anchors.length;

    const downloadFilePattern = /\.(zip|exe|apk|msi|rar|tar|gz|7z|dmg|pkg|bin)(\?|$)/i;

    const hasDownloadLink = anchors.some(a => a.href && downloadFilePattern.test(a.href));
    const hasMetaRefreshDownload = Array.from(document.querySelectorAll('meta[http-equiv="refresh"]'))
      .some(meta => downloadFilePattern.test(meta.content || ''));
    const downloadKeywords = [
      'window.location',
      'document.location',
      'location.href',
      'location.assign',
      'setTimeout',
      'download',
    ];
    const scriptSignals = Array.from(document.scripts)
      .map(s => s.textContent || '')
      .filter(script => downloadFilePattern.test(script) && downloadKeywords.some(k => script.includes(k)));
    const hasScriptDownload = scriptSignals.length > 0;
    const isDownloadPage = hasDownloadLink || hasMetaRefreshDownload || hasScriptDownload;

    const hasPdf = anchors.some(a => a.href?.endsWith('.pdf'));
    const hasDocx = anchors.some(a => a.href?.match(/\.(docx?|xlsx?|pptx?)$/));
    const isDoc = hasPdf || hasDocx;

    const hasVideoTag = document.querySelector('video');
    const isVideo = hasVideoTag && textLength < 3000;

    const isBlank = textLength < 40 && nodeCount < 20;

    let category = 'web';
    if (isDoc) category = 'doc';
    else if (isDownloadPage) category = 'download';
    else if (isVideo) category = 'video';
    else if (isBlank) category = 'blank';

    return {
      category,
      meta: {
        textLength,
        nodeCount,
        anchorCount,
        hasDownloadLink,
        hasMetaRefreshDownload,
        hasScriptDownload,
        matchedScriptSnippets: scriptSignals.slice(0, 2),
      },
    };
  });
};

// 🚀 Detect VPN/Proxy Blocking Page
async function detectVPNBlock(page) {
  const bodyText = await page.evaluate(() => document.body?.innerText || '');
  const vpnBlockKeywords = [
    'Looks like you are connecting through a VPN',
    'proxy or unblocker service',
    'VPN detected',
    'Proxy detected',
    'Streaming content is not available',
  ];
  const matchedKeywords = vpnBlockKeywords.filter(keyword =>
    bodyText.toLowerCase().includes(keyword.toLowerCase())
  );

  return matchedKeywords.length > 0 ? matchedKeywords.join('; ') : 'No VPN Block Detected';
}

(async () => {
  const launchOptions = {
    headless: true,
    executablePath: './chromium/chrome-headless-shell-linux64/chrome-headless-shell',
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
      '--mute-audio',
      '--disable-gpu',
      '--enable-unsafe-swiftshader',
      '--ignore-certificate-errors',
      '--enable-quic',
      '--log-net-log=netlog.json',
    ],
  };

  if (useProxy) {
    launchOptions.args.push(`--proxy-server=${proxyHost}`);
    console.log(`Proxy enabled: ${proxyHost}`);
  } else {
    console.log('Proxy disabled');
  }

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();

  browser.on('disconnected', () => {
    console.log('Browser disconnected');
  });

  page.on('request', request => {
    const method = request.method();
    const type = request.resourceType().toUpperCase();
    const url = request.url();
    const shortenedUrl = url.length > 100 ? url.slice(0, 100) + '...' : url;
    console.log(`[${type}] ${method} ${shortenedUrl}`);
  });

  page.on('response', async (response) => {
    const status = response.status();
    const type = response.request().resourceType().toUpperCase();
    const url = response.url();
    const shortenedUrl = url.length > 100 ? url.slice(0, 100) + '...' : url;
    console.log(`[${type}] ${status} ${shortenedUrl}`);
  });

  try {
    console.log('Starting page load...');
    const start = Date.now();

    const res = await page.goto("https://" + targetUrl, { waitUntil: 'networkidle2' });
    // const res = await page.goto("https://" + targetUrl, { waitUntil: 'domcontentloaded' });

    const country = await getCountryFromDNS(targetUrl);

    console.log(`${res.status()} ${res.url()}, ${country.country}`);

    const end = Date.now();
    const loadTime = ((end - start) / 1000).toFixed(2);

    console.log(`Done loading: ${targetUrl}`);
    console.log(`Page load time: ${loadTime} seconds`);

    // 🚀 Detect Japanese content
    const jpContent = await detectJapaneseContent(page);
    console.log(`Japanese Text Detected: ${jpContent.hasJapaneseText}`);
    console.log(`HTML <html lang="ja">: ${jpContent.isHtmlLangJapanese}`);
    console.log(`Meta tags indicating Japanese: ${jpContent.metaLangs.join(', ') || 'None'}`);

    const classification = await classifyContent(page);
    console.log(`Content Category: ${classification.category}`);
    console.log(`Page Metadata:`, classification.meta);

    // 🚀 Detect VPN Block
    const vpnBlockStatus = await detectVPNBlock(page);
    console.log(`VPN Block Status: ${vpnBlockStatus}`);

    // Save CSV results
    const csvPath = path.resolve('webpage_test_results.csv');
    const header = 'url,use_proxy,load_time,japanese_text,html_lang,meta_langs,category,vpn_block_status\n';
    const line = `"${targetUrl}","${useProxy}","${loadTime}","${jpContent.hasJapaneseText}","${jpContent.isHtmlLangJapanese}","${jpContent.metaLangs.join(';')}","${classification.category}","${vpnBlockStatus}"\n`;
    if (!fs.existsSync(csvPath)) {
      fs.writeFileSync(csvPath, header);
    }
    fs.appendFileSync(csvPath, line);

  } catch (error) {
    console.error('Failed to load page:', error.message);
  }

  await browser.close();
})();
