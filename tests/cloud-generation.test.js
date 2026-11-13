const { test } = require('node:test');
const assert = require('node:assert/strict');
const Cloud = require('../cloud-client.js');
const { createProxy } = require('../tools/cloud-proxy.js');

const input = { scopeType: 'New Feature', requirement: 'A user can submit a request.', uiElements: 'Submit', impactedAreas: '' };
const suite = () => ({
  scenarios: [{ cat: 'Functional', pri: 'High', desc: 'Submit a request', evidence: 'submit a request' }],
  testCases: [{ type: 'Functional', pri: 'High', scenario: 'Submit a request', steps: 'Submit', expected: 'Request is submitted.', evidence: 'submit a request' }],
  checklists: { reqMatch: [{ text: 'Review requirement.' }], exploratory: [], regression: [] }
});
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const geminiResponse = value => json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
async function withProxy(fetchImpl, run) {
  const server = createProxy({ apiKey: 'synthetic-server-key', allowedOrigin: 'http://127.0.0.1:8765', fetchImpl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}/generate`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const request = body => ({
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:8765' },
  body: JSON.stringify(body)
});

test('cloud endpoint must be configured securely without secrets in the URL', () => {
  assert.throws(() => Cloud.normalizeUrl(''), /not set up/);
  for (const url of ['http://example.test/generate', 'https://user:pass@example.test/generate', 'https://example.test/generate?key=secret']) {
    assert.throws(() => Cloud.normalizeUrl(url), /HTTPS|credentials|query/);
  }
  assert.equal(Cloud.normalizeUrl('https://example.test/generate'), 'https://example.test/generate');
  assert.equal(Cloud.normalizeUrl('http://127.0.0.1:8788/generate'), 'http://127.0.0.1:8788/generate');
});

test('client sends only testing details and validates cloud responses before returning cases', async () => {
  const result = await Cloud.generateSuite('https://example.test/generate', input, async (url, options) => {
    assert.equal(url, 'https://example.test/generate');
    assert.deepEqual(JSON.parse(options.body), input);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    return json(suite());
  });
  assert.equal(result.testCases[0].status, 'Not Run');
  assert.equal(result.scenarios[0].evidence, 'submit a request');
  await assert.rejects(Cloud.generateSuite('https://example.test/generate', { ...input, password: 'no' }, async () => { throw Error('Must not call'); }), /Only the testing scope/);
  const invalid = suite(); invalid.testCases[0].evidence = 'invented text';
  await assert.rejects(Cloud.generateSuite('https://example.test/generate', input, async () => json(invalid)), /does not exactly match/);
  await assert.rejects(Cloud.generateSuite('https://example.test/generate', input, async () => json({}, 429)), /rate-limited/);
  await assert.rejects(Cloud.generateSuite('https://example.test/generate', input, async () => new Response('broken')), /invalid JSON/);
});

test('client reports cloud timeout and network failures without falling back', async () => {
  const delayed = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  await assert.rejects(Cloud.generateSuite('https://example.test/generate', input, delayed, 5), /timed out/);
  await assert.rejects(Cloud.generateSuite('https://example.test/generate', input, async () => { throw new TypeError('network'); }), /Could not reach/);
});

test('proxy keeps provider key server-side and returns only a validated suite', async () => {
  await withProxy(async (url, options) => {
    assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\//);
    assert.equal(options.headers['x-goog-api-key'], 'synthetic-server-key');
    const body = JSON.parse(options.body);
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), input);
    assert.equal(body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
    assert.equal(body.generationConfig.responseFormat.text.schema.type, 'object');
    return geminiResponse(suite());
  }, async endpoint => {
    const response = await fetch(endpoint, request(input));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://127.0.0.1:8765');
    const payload = await response.text();
    assert.equal(payload.includes('synthetic-server-key'), false);
    assert.equal(JSON.parse(payload).testCases[0].scenario, 'Submit a request');
  });
});

test('proxy rejects other origins, invalid inputs, oversized requests and applies rate limits', async () => {
  let calls = 0;
  await withProxy(async () => { calls++; return geminiResponse(suite()); }, async endpoint => {
    assert.equal((await fetch(endpoint, { ...request(input), headers: { ...request(input).headers, Origin: 'https://other.example' } })).status, 403);
    assert.equal((await fetch(endpoint, request({ ...input, secret: 'never send' }))).status, 400);
    assert.equal((await fetch(endpoint, request({ ...input, requirement: 'x'.repeat(210000) }))).status, 413);
    for (let i = 0; i < 9; i++) assert.equal((await fetch(endpoint, request(input))).status, 200);
    assert.equal((await fetch(endpoint, request(input))).status, 429);
    assert.equal(calls, 9);
  });
});

test('proxy rejects malformed model output and provider errors without leaking details', async () => {
  const invalid = suite(); invalid.testCases[0].evidence = 'invented text';
  await withProxy(async () => geminiResponse(invalid), async endpoint => {
    const response = await fetch(endpoint, request(input));
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /synthetic-server-key|invented text/);
  });
  await withProxy(async () => json({ error: 'sensitive provider detail' }, 401), async endpoint => {
    const response = await fetch(endpoint, request(input));
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /sensitive provider detail|synthetic-server-key/);
  });
});
