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

// 🚀 NEW FUNCTION: Detect Japanese Content
async function detectJapaneseContent(page) {
  return await page.evaluate(() => {
    const textContent = document.body?.innerText || '';
    const japaneseChars = textContent.match(/[\u3040-\u30ff\u4e00-\u9faf]/g) || [];
    const percentageJapanese = (japaneseChars.length / textContent.length) * 100;

    const htmlLang = document.documentElement.lang;
    const isHtmlLangJapanese = htmlLang && htmlLang.toLowerCase().startsWith('ja');

    const metaLangs = Array.from(document.querySelectorAll('meta[http-equiv="Content-Language"], meta[name="language"]'))
      .map(meta => meta.content?.toLowerCase() || '')
      .filter(content => content.includes('ja'));

    return {
      hasJapaneseText: japaneseChars.length > 0,
      percentageJapanese: percentageJapanese.toFixed(2),
      isHtmlLangJapanese,
      metaLangs,
      htmlLang // for debugging
    };
  });
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
    const country = await getCountryFromDNS(targetUrl);

    console.log(`${res.status()} ${res.url()}, ${country.country}`);

    const end = Date.now();
    const loadTime = ((end - start) / 1000).toFixed(2);

    console.log(`Done loading: ${targetUrl}`);
    console.log(`Page load time: ${loadTime} seconds`);

    // 🚀 Detect Japanese content
    const jpContent = await detectJapaneseContent(page);
    console.log(`Japanese Text Detected: ${jpContent.hasJapaneseText}`);
    console.log(`Japanese Text Density: ${jpContent.percentageJapanese}%`);
    console.log(`HTML <html lang>: ${jpContent.htmlLang} (Japanese detected: ${jpContent.isHtmlLangJapanese})`);
    console.log(`Meta tags indicating Japanese: ${jpContent.metaLangs.join(', ') || 'None'}`);

    // Save CSV results
    const csvPath = path.resolve('webpage_results.csv');
    const header = 'url,use_proxy,load_time,japanese_text,html_lang,meta_langs,category\n';
    const line = `"${targetUrl}","${useProxy}","${loadTime}","${jpContent.hasJapaneseText}","${jpContent.isHtmlLangJapanese}","${jpContent.metaLangs.join(';')}"\n`;
    if (!fs.existsSync(csvPath)) {
      fs.writeFileSync(csvPath, header);
    }
    fs.appendFileSync(csvPath, line);

  } catch (error) {
    console.error('Failed to load page:', error.message);
  }

  await browser.close();
})();
