// Example proxy: keep the Gemini key on this server, never in the browser.
const http = require('node:http');
const OllamaLocal = require('../ollama-client.js');

const MAX_BODY_BYTES = 200 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const WINDOW_MS = 60 * 1000;
const REQUESTS_PER_WINDOW = 10;

function checkedOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Set ALLOWED_ORIGIN to the exact app origin.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local)) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('ALLOWED_ORIGIN must be an HTTPS origin, or an HTTP localhost origin for testing.');
  }
  return url.origin;
}

async function readRequest(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readProviderJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty provider response');
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Provider response too large');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}

function createProxy({ apiKey, allowedOrigin, model = 'gemini-3.8-flash', fetchImpl = globalThis.fetch }) {
  if (!apiKey || typeof apiKey !== 'string') throw new Error('Set GEMINI_API_KEY on the server.');
  const origin = checkedOrigin(allowedOrigin);
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new Error('GEMINI_MODEL contains invalid characters.');
  const requests = new Map();
  const send = (res, status, message) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(message));
  };
  const server = http.createServer(async (req, res) => {
    if (req.headers.origin !== origin) return send(res, 403, { error: 'Origin not allowed.' });
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    if (req.url !== '/generate') return send(res, 404, { error: 'Not found.' });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
      return res.end();
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Use JSON.' });
    if (Number(req.headers['content-length'] || 0) > MAX_BODY_BYTES) return send(res, 413, { error: 'Request too large.' });

    // Socket IP is used deliberately; untrusted forwarded headers can be forged.
    const now = Date.now(), client = req.socket.remoteAddress || 'unknown';
    for (const [ip, entry] of requests) if (now >= entry.until) requests.delete(ip);
    let entry = requests.get(client);
    if (!entry) {
      if (requests.size >= 10000) return send(res, 429, { error: 'Rate limit reached.' });
      entry = { count: 0, until: now + WINDOW_MS };
      requests.set(client, entry);
    }
    if (++entry.count > REQUESTS_PER_WINDOW) return send(res, 429, { error: 'Rate limit reached.' });

    let input;
    try { input = OllamaLocal.requestInput(await readRequest(req)); }
    catch { return send(res, 400, { error: 'Invalid or oversized testing details.' }); }
    const prompt = OllamaLocal.buildChatRequest('gemini', input);
    try {
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: prompt.messages[0].content }] },
          contents: [{ role: 'user', parts: [{ text: prompt.messages[1].content }] }],
          generationConfig: {
            temperature: 0, maxOutputTokens: 8192,
            responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: OllamaLocal.suiteSchema } }
          }
        }),
        signal: AbortSignal.timeout(120000), redirect: 'error'
      });
      if (response.status === 429) return send(res, 429, { error: 'Provider rate limit reached.' });
      if (!response.ok) return send(res, 502, { error: 'Provider request failed.' });
      const payload = await readProviderJson(response);
      const candidate = payload?.candidates?.[0];
      if (candidate?.finishReason !== 'STOP') throw new Error('Incomplete provider response');
      const text = candidate.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('');
      const suite = JSON.parse(text);
      OllamaLocal.validateSuite(suite, input.requirement);
      return send(res, 200, suite);
    } catch {
      return send(res, 502, { error: 'Provider response was unavailable or invalid.' });
    }
  });
  server.requestTimeout = 15000;
  return server;
}

if (require.main === module) {
  try {
    const server = createProxy({
      apiKey: process.env.GEMINI_API_KEY,
      allowedOrigin: process.env.ALLOWED_ORIGIN,
      model: process.env.GEMINI_MODEL || 'gemini-3.8-flash'
    });
    const port = Number(process.env.PORT || 8788);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
    server.listen(port, '127.0.0.1', () => console.log(`Cloud proxy listening on 127.0.0.1:${port}; use an HTTPS reverse proxy for deployment.`));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { createProxy };
