/*  webpage_test.js
 *  Usage examples
 *    node webpage_test.js --url=example.com
 *    node webpage_test.js --url=example.com --use-proxy=true --csv=batch_01.csv
 *
 *  Features:
 *    - Records detailed resource information (URL, domain, CDN, type, method)
 *    - Tracks domains and their success/failure status 
 *    - Detects TCP RST packets and connection failures when using proxy
 *    - Identifies CDN providers based on domain names
 *    - Records failed domains with error details and CDN info in CSV output
 *    - Provides statistics on resource and domain loading success rates
 *
 *  ─────────────────────────────────────────────────────────────────────────── */

import dns from 'dns/promises';
import fs from 'fs';
import fetch from 'node-fetch';
import path from 'path';
import puppeteer from 'puppeteer-core';

// ── CLI flags ────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const argMap  = {};
args.forEach(arg => {
  const [k, v] = arg.split('=');
  if (k.startsWith('--')) argMap[k.slice(2)] = v === undefined ? true : v;
});

const targetUrl = argMap.url;
const useProxy  = argMap['use-proxy'] === true || argMap['use-proxy'] === 'true';
const csvFile   = argMap.csv || 'webpage_test_results.csv';
const proxyHost = 'http://localhost:4433';

if (!targetUrl) {
  console.error('Missing required --url argument.  Example: node webpage_test.js --url=example.com');
  process.exit(1);
}

// ── Accumulators ─────────────────────────────────────────────────────────────
let totalBytes    = 0;
let mainStatus    = null;
let mainHeaders   = {};
let failedResources = [];
let requestedResources = [];
let succeededResources = new Set();
let pendingResources = new Map(); // Track pending requests

// ── Helper: Geo lookup ───────────────────────────────────────────────────────
async function getCountryFromDNS (hostname) {
  try {
    const { address } = await dns.lookup(hostname);
    const r   = await fetch(`https://ipwho.is/${address}`);
    const geo = await r.json();
    return geo && geo.success && geo.country_code
         ? { country: geo.country_code, ip: address }
         : { country: 'unknown',        ip: address };
  } catch {
    return { country: 'unknown', ip: null };
  }
}

// ── Helper: Japanese-content detector ────────────────────────────────────────
async function detectJapaneseContent (page) {
  return await page.evaluate(() => {
    const txt  = document.body?.innerText || '';
    const hasJ = /[\u3040-\u30ff\u4e00-\u9faf]/.test(txt);

    const htmlLang  = (document.documentElement.lang || '').toLowerCase();
    const langIsJa  = htmlLang.startsWith('ja');

    const metaLangs = Array.from(
      document.querySelectorAll('meta[http-equiv="Content-Language"], meta[name="language"]')
    ).map(m => (m.content || '').toLowerCase())
     .filter(c => c.includes('ja'));

    return { hasJapaneseText: hasJ, isHtmlLangJapanese: langIsJa, metaLangs };
  });
}

// ── Helper: Detect TCP RST and connection failures ──────────────────────────
function isConnectionReset(errorMessage) {
  const resetPatterns = [
    /connection reset/i,
    /tcp_reset/i,
    /econnreset/i,
    /net::err_connection_reset/i,
    /net::err_connection_refused/i,
    /net::err_connection_aborted/i,
    /net::err_connection_closed/i,
    /net::err_connection_failed/i,
    /net::err_proxy_connection_failed/i,
    /net::err_tunnel_connection_failed/i
  ];
  return resetPatterns.some(pattern => pattern.test(errorMessage));
}

// ── Helper: Detect CDN from domain name ─────────────────────────────────────
function detectCDN(domain) {
  const cdnPatterns = {
    'Cloudflare': [
      /cloudflare\.com$/i,
      /cf-ipv6\.com$/i,
      /cloudflaressl\.com$/i
    ],
    'Amazon CloudFront': [
      /cloudfront\.net$/i,
      /amazonaws\.com$/i
    ],
    'Fastly': [
      /fastly\.com$/i,
      /fastlylb\.net$/i
    ],
    'Google Cloud CDN': [
      /googleapis\.com$/i,
      /gstatic\.com$/i,
      /googleusercontent\.com$/i
    ],
    'Microsoft Azure CDN': [
      /azureedge\.net$/i,
      /azurefd\.net$/i,
      /trafficmanager\.net$/i
    ],
    'KeyCDN': [
      /kxcdn\.com$/i
    ],
    'MaxCDN/StackPath': [
      /netdna-ssl\.com$/i,
      /netdna-cdn\.com$/i,
      /stackpathdns\.com$/i
    ],
    'Akamai': [
      /akamai\.net$/i,
      /akamaized\.net$/i,
      /akamaistream\.net$/i,
      /akamaihd\.net$/i
    ],
    'Incapsula': [
      /incapdns\.net$/i
    ],
    'jsDelivr': [
      /jsdelivr\.net$/i
    ],
    'cdnjs': [
      /cdnjs\.cloudflare\.com$/i
    ]
  };

  for (const [cdnName, patterns] of Object.entries(cdnPatterns)) {
    for (const pattern of patterns) {
      if (pattern.test(domain)) {
        return cdnName;
      }
    }
  }
  return 'None';
}

// ── Helper: Extract domain from URL ──────────────────────────────────────────
function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {

  const launchOpts = {
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
      '--enable-logging',
      '--log-level=0',
      '--enable-network-service-logging',
      '--disable-features=VizDisplayCompositor'
    ],
  };

  if (useProxy) {
    launchOpts.args.push(`--proxy-server=${proxyHost}`);
    console.log(`Proxy enabled: ${proxyHost}`);
  } else {
    console.log('Proxy disabled');
  }

  const browser = await puppeteer.launch(launchOpts);
  const page    = await browser.newPage();

  // ── Listeners ──────────────────────────────────────────────────────────────
  page.on('request', req => {
    const url = req.url();
    const domain = extractDomain(url);
    const cdn = detectCDN(domain);
    
    // Record full resource information
    const resourceInfo = {
      url: url,
      domain: domain,
      cdn: cdn,
      resourceType: req.resourceType(),
      method: req.method()
    };
    requestedResources.push(resourceInfo);
    
    // Track pending request
    pendingResources.set(url, {
      domain: domain,
      cdn: cdn,
      resourceType: req.resourceType(),
      method: req.method(),
      startTime: Date.now()
    });
    
    // Extract resource name (path + query) and truncate if longer than 20 characters
    let resourceName;
    try {
      const urlObj = new URL(url);
      resourceName = urlObj.pathname + urlObj.search;
      if (resourceName.length > 50) {
        resourceName = resourceName.slice(0, 50) + '...';
      }
    } catch {
      resourceName = url.length > 50 ? url.slice(0, 50) + '...' : url;
    }
    
    console.log(`[${req.resourceType().toUpperCase()}] ${req.method()} ${domain}${resourceName}`);
  });

  page.on('requestfailed', req => {
    const url = req.url();
    const domain = extractDomain(url);
    const failure = req.failure();
    const resourceType = req.resourceType();
    const cdn = detectCDN(domain);
    
    // Remove from pending requests
    pendingResources.delete(url);
    
    if (failure && isConnectionReset(failure.errorText)) {
      const failedResource = {
        domain: domain,
        cdn: cdn,
        resourceType: resourceType,
        errorText: failure.errorText,
        method: req.method()
      };
      failedResources.push(failedResource);
      console.log(`[FAILED-RST] ${resourceType.toUpperCase()} ${domain} - ${failure.errorText}`);
    } else if (failure) {
      const failedResource = {
        domain: domain,
        cdn: cdn,
        resourceType: resourceType,
        errorText: failure.errorText,
        method: req.method()
      };
      failedResources.push(failedResource);
      console.log(`[FAILED] ${resourceType.toUpperCase()} ${domain} - ${failure.errorText}`);
    }
  });

  page.on('response', async res => {
    const req = res.request();
    const url = req.url();
    const domain = extractDomain(url);
    const cdn = detectCDN(domain);
    
    // Remove from pending requests
    pendingResources.delete(url);
    
    succeededResources.add(domain);

    if (req.frame() === page.mainFrame() && req.resourceType() === 'document') {
      mainStatus  = res.status();
      mainHeaders = res.headers();
    }

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
    console.log('Starting page load …');
    const t0        = Date.now();
    const response  = await page.goto(`https://${targetUrl}`, { 
      waitUntil:'load',
      timeout: 30000  // 30 second timeout
    });

    if (mainStatus === null) {                    // fallback
      mainStatus  = response.status();
      mainHeaders = response.headers();
    }

    const loadTime   = ((Date.now() - t0) / 1000).toFixed(2);
    const country    = await getCountryFromDNS(targetUrl);

    console.log(`${mainStatus} ${response.url()}, ${country.country}`);
    console.log(`Load time: ${loadTime}s | Bytes: ${(totalBytes/1024).toFixed(2)} KB`);

    const jp = await detectJapaneseContent(page);

    // ── Analysis of failed resources ────────────────────────────────────────
    const totalRequested = requestedResources.length;
    const uniqueDomainsRequested = new Set(requestedResources.map(r => r.domain)).size;
    const totalSucceeded = succeededResources.size;
    const totalFailed = failedResources.length;
    const resetFailures = failedResources.filter(f => isConnectionReset(f.errorText));
    
    // Get failed domains and their resource counts with error details
    const failedDomains = new Map();
    failedResources.forEach(f => {
      if (!failedDomains.has(f.domain)) {
        failedDomains.set(f.domain, {
          count: 0,
          cdn: f.cdn,
          errors: new Set()
        });
      }
      const domainInfo = failedDomains.get(f.domain);
      domainInfo.count += 1;
      domainInfo.errors.add(f.errorText);
    });
    
    console.log(`Resources: ${totalRequested} total, ${uniqueDomainsRequested} unique domains`);
    console.log(`Domains: ${totalSucceeded}/${uniqueDomainsRequested} succeeded, ${failedDomains.size} failed`);
    
    if (failedDomains.size > 0) {
      console.log(`Failed domains:`);
      failedDomains.forEach((info, domain) => {
        const errorList = Array.from(info.errors).join(', ');
        console.log(`  - ${domain} : ${info.count} resource${info.count > 1 ? 's' : ''} failed - ${errorList}`);
      });
    }
    
    if (resetFailures.length > 0) {
      console.log(`TCP RST failures: ${resetFailures.length}`);
      resetFailures.forEach(f => {
        console.log(`  - ${f.resourceType}: ${f.domain}`);
      });
    }

    // ── CSV output ──────────────────────────────────────────────────────────
    const csvPath   = path.resolve(csvFile);
    const header    = 'host,server_ip,load_time_s,page_size_kb,total_domains,failed_domains,resources_requested,resources_failed,tcp_rst_domains,tcp_rst_urls,other_failed_urls\n';
    
    // Get TCP RST domain names
    const tcpRstDomains = [...new Set(resetFailures.map(f => f.domain))];
    const tcpRstDomainsStr = tcpRstDomains.join(',');
    
    // Get other failed URLs with error messages
    const otherFailures = failedResources.filter(f => !isConnectionReset(f.errorText));
    const otherFailedUrls = otherFailures.map(f => `${f.domain}(${f.errorText})`).join(',');
    
    const row = `"${targetUrl}","${country.ip || ''}","${loadTime}","${(totalBytes/1024).toFixed(2)}","${uniqueDomainsRequested}","${failedDomains.size}","${totalRequested}","${totalFailed}","${tcpRstDomains.length}","${tcpRstDomainsStr}","${otherFailedUrls}"\n`;

    if (!fs.existsSync(csvPath)) fs.writeFileSync(csvPath, header);
    fs.appendFileSync(csvPath, row);

  } catch (err) {
    console.error('Failed:', err.message);
    
    // If it's a navigation timeout, show pending resources
    if (err.message.includes('Navigation timeout') || err.message.includes('timeout')) {
      console.log('\n=== PENDING RESOURCES (likely causing timeout) ===');
      if (pendingResources.size > 0) {
        console.log(`${pendingResources.size} resources still pending:`);
        pendingResources.forEach((info, url) => {
          const waitTime = ((Date.now() - info.startTime) / 1000).toFixed(1);
          // Extract resource name for display
          let resourceName;
          try {
            const urlObj = new URL(url);
            resourceName = urlObj.pathname + urlObj.search;
            if (resourceName.length > 30) {
              resourceName = resourceName.slice(0, 30) + '...';
            }
          } catch {
            resourceName = url.length > 30 ? url.slice(0, 30) + '...' : url;
          }
          console.log(`  - [${info.resourceType.toUpperCase()}] ${info.domain}${resourceName} (${info.cdn}) - waiting ${waitTime}s`);
        });
      } else {
        console.log('No pending resources found (timeout may be due to other factors)');
      }
      console.log('===================================================\n');
    }
  } finally {
    await browser.close();
  }
})();
