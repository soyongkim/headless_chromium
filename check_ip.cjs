// check_ip.cjs
const CDP = require('chrome-remote-interface');

(async () => {
  try {
    const client = await CDP();
    const { Network, Page, Runtime } = client;

    await Network.enable();
    await Page.enable();

    // Navigate to IP check page
    await Page.navigate({ url: 'https://ifconfig.me/all.json' });
    await Page.loadEventFired();

    // Extract content using JS evaluation
    const result = await Runtime.evaluate({
      expression: `document.body.innerText`
    });

    console.log('[Extracted IP Info]');
    console.log(JSON.parse(result.result.value));

    await client.close();
  } catch (err) {
    console.error('[ERROR]', err.message);
  }
})();
