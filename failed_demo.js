// Demo of enhanced failed domain analysis output
console.log('=== Enhanced Failed Domain Analysis Demo ===');
console.log('');

console.log('Example output when multiple domains fail:');
console.log('');
console.log('Resources: 122 total, 9 unique domains');
console.log('Domains: 6/9 succeeded, 3 failed');
console.log('Failed domains:');
console.log('  - www.google-analytics.com (None): 5 resources failed');
console.log('  - fonts.googleapis.com (Google Cloud CDN): 3 resources failed');
console.log('  - cdn.jsdelivr.net (jsDelivr): 12 resources failed');
console.log('TCP RST failures: 8');
console.log('  - script: www.google-analytics.com (None)');
console.log('  - script: cdn.jsdelivr.net (jsDelivr)');
console.log('  - font: fonts.googleapis.com (Google Cloud CDN)');
console.log('');
console.log('This shows:');
console.log('- Which specific domains failed');
console.log('- How many resources failed per domain');
console.log('- Which CDN each failed domain uses');
console.log('- Total count of failed domains vs succeeded domains');
