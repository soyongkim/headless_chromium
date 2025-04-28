const net = require('net');
const tls = require('tls');
const http2 = require('http2');

const proxyHost = 'localhost';
const proxyPort = 4433;
const targetHost = 'www.google.com';
const targetPort = 443;

(async () => {
  console.log(`[INFO] Connecting to proxy ${proxyHost}:${proxyPort}...`);

  const socket = net.connect(proxyPort, proxyHost, () => {
    console.log('[INFO] Connected. Sending CONNECT...');
    socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`);
  });

  socket.once('data', (chunk) => {
    const response = chunk.toString();
    console.log('[INFO] CONNECT response:\n' + response);

    if (!response.includes('200')) {
      console.error('[ERROR] CONNECT failed');
      socket.end();
      return;
    }

    console.log('[INFO] Upgrading to TLS...');
    const tlsSocket = tls.connect({
      socket,
      servername: targetHost,
      ALPNProtocols: ['h2'],
      rejectUnauthorized: false, // For testing only; do not use in production
    }, () => {
      const negotiated = tlsSocket.alpnProtocol;
      console.log(`[INFO] TLS connected. Negotiated ALPN: ${negotiated}`);

      if (negotiated !== 'h2') {
        console.error('[ERROR] HTTP/2 not negotiated');
        tlsSocket.end();
        return;
      }

      const client = http2.connect(`https://${targetHost}`, {
        createConnection: () => tlsSocket,
      });

      client.on('error', (err) => console.error('[ERROR]', err));

      const req = client.request({
        ':method': 'GET',
        ':path': '/',
        ':authority': targetHost,
        ':scheme': 'https',
        'user-agent': 'h2-debug-client',
      });

      req.setEncoding('utf8');

      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });

      req.on('end', () => {
        console.log('[INFO] Response received:\n' + data.slice(0, 500) + '...');
        client.close();
      });

      req.end();
    });

    tlsSocket.on('error', (err) => {
      console.error('[TLS ERROR]', err);
    });
  });

  socket.on('error', (err) => {
    console.error('[SOCKET ERROR]', err);
  });
})();
