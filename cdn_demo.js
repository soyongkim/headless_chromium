// Demo showing CDN detection output
console.log('=== CDN Detection Demo ===');
console.log('');

console.log('Example output when loading a website with various CDNs:');
console.log('');
console.log('Proxy disabled');
console.log('Starting page load …');
console.log('[DOCUMENT] GET example.com (None)');
console.log('[STYLESHEET] GET fonts.googleapis.com (Google Cloud CDN)');
console.log('[SCRIPT] GET cdnjs.cloudflare.com (cdnjs)');
console.log('[FONT] GET fonts.gstatic.com (Google Cloud CDN)');
console.log('[IMAGE] GET images.example.com (None)');
console.log('[SCRIPT] GET cdn.jsdelivr.net (jsDelivr)');
console.log('200 https://example.com/, US');
console.log('Load time: 2.34s | Bytes: 1234.56 KB');
console.log('Domains: 5/5 succeeded, 0 failed');
console.log('');

console.log('When proxy blocks certain CDNs:');
console.log('');
console.log('Proxy enabled: http://localhost:4433');
console.log('[DOCUMENT] GET example.com (None)');
console.log('[STYLESHEET] GET fonts.googleapis.com (Google Cloud CDN)');
console.log('[FAILED-RST] SCRIPT cdnjs.cloudflare.com (cdnjs) - net::ERR_CONNECTION_RESET');
console.log('[FONT] GET fonts.gstatic.com (Google Cloud CDN)');
console.log('[FAILED-RST] SCRIPT cdn.jsdelivr.net (jsDelivr) - net::ERR_CONNECTION_RESET');
console.log('200 https://example.com/, US');
console.log('Load time: 5.67s | Bytes: 234.56 KB');
console.log('Domains: 3/5 succeeded, 2 failed');
console.log('TCP RST failures: 2');
console.log('  - script: cdnjs.cloudflare.com (cdnjs)');
console.log('  - script: cdn.jsdelivr.net (jsDelivr)');
console.log('');
console.log('This shows which CDN providers are being blocked by the proxy!');
