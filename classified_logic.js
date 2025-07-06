import dns from 'dns/promises';
import fs from 'fs';
import fetch from 'node-fetch';
import path from 'path';
import puppeteer from 'puppeteer-core';

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

// Accumulators
let totalBytes = 0;
let mainStatus = null;
let mainHeaders = {};

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
  } catch (_) {
    return { country: 'unknown', ip: null };
  }
}

// 🚀 Detect Japanese Content
async function detectJapaneseContent(page) {
  return await page.evaluate(() => {
    const textContent = document.body?.innerText || '';
    const hasJapaneseText = /[\u3040-\u30ff\u4e00-\u9faf]/.test(textContent);

    const htmlLang = (document.documentElement.lang || '').toLowerCase();
    const isHtmlLangJapanese = htmlLang.startsWith('ja');

    const metaLangs = Array.from(document.querySelectorAll('meta[http-equiv="Content-Language"], meta[name="language"]'))
      .map(meta => (meta.content || '').toLowerCase())
      .filter(content => content.includes('ja'));

    return { hasJapaneseText, isHtmlLangJapanese, metaLangs };
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

  // ---------- Event Listeners ---------- //
  page.on('request', req => {
    const type = req.resourceType().toUpperCase();
    console.log(`[${type}] ${req.method()} ${req.url().slice(0, 100)}`);
  });

  page.on('response', async res => {
    const req = res.request();

    // Capture main‑document status & headers
    if (req.frame() === page.mainFrame() && req.resourceType() === 'document') {
      mainStatus = res.status();
      mainHeaders = res.headers();
    }

    // Byte counting
    let len = 0;
    if (res.headers()['content-length']) {
      len = parseInt(res.headers()['content-length'], 10);
    }
    if (!len) {
      try { len = (await res.buffer()).length; } catch { len = 0; }
    }
    totalBytes += isNaN(len) ? 0 : len;
  });

  try {
    console.log('Starting page load...');
    const t0 = Date.now();

    const response = await page.goto(`https://${targetUrl}`, { waitUntil: 'load' });

    // Fallback if listener missed the main document
    if (mainStatus === null) {
      mainStatus = response.status();
      mainHeaders = response.headers();
    }

    const loadTime = ((Date.now() - t0) / 1000).toFixed(2);
    const countryInfo = await getCountryFromDNS(targetUrl);

    console.log(`${mainStatus} ${response.url()}, ${countryInfo.country}`);
    console.log(`Load time: ${loadTime}s | Bytes: ${(totalBytes/1024).toFixed(2)} KB`);

    const jp = await detectJapaneseContent(page);

    // ---------- CSV ---------- //
    const csvPath = path.resolve('webpage_test_results.csv');
    const header = 'url,use_proxy,status,load_time,total_bytes,japanese_text,html_lang,meta_langs,response_headers\n';
    const headersJson = JSON.stringify(mainHeaders).replace(/"/g, '""');
    const line = `"${targetUrl}","${useProxy}","${mainStatus}","${loadTime}","${totalBytes}","${jp.hasJapaneseText}","${jp.isHtmlLangJapanese}","${jp.metaLangs.join(';')}","${headersJson}"\n`;

    if (!fs.existsSync(csvPath)) fs.writeFileSync(csvPath, header);
    fs.appendFileSync(csvPath, line);

  } catch (err) {
    console.error('Failed:', err.message);
  } finally {
    await browser.close();
  }
})();
