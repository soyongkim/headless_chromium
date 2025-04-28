// netlog_analyzer.js
import fs from 'fs';

// Load netlog
const netlog = JSON.parse(fs.readFileSync('netlog.json', 'utf8'));
const events = netlog.events || [];

// Map of request ID -> { request: {}, response: {} }
const requestMap = new Map();

for (const event of events) {
  if (event.type !== 'URL_REQUEST') continue;

  const id = event.source?.id;
  const params = event.params;

  if (id === undefined || params === undefined) continue;

  if (!requestMap.has(id)) {
    requestMap.set(id, { request: null, response: null });
  }

  const entry = requestMap.get(id);

  if (params.url && params.method) {
    // This is a request
    entry.request = {
      url: params.url,
      method: params.method,
      priority: params.priority,
    };
  } else if (params.status_code !== undefined || params.response_headers) {
    // This is a response
    entry.response = {
      statusCode: params.status_code,
      headers: params.response_headers,
    };
  }
}

// Pretty print results
for (const [id, { request, response }] of requestMap.entries()) {
  if (request && response) {
    console.log('---');
    console.log(`Request [${request.method}] ${request.url}`);
    console.log(`Response Status: ${response.statusCode}`);
    console.log('Response Headers:', response.headers);
  }
}
