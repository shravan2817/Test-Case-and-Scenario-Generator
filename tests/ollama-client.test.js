const { test } = require('node:test');
const assert = require('node:assert/strict');
const OllamaLocal = require('../ollama-client.js');

const requestInput = {
  scopeType: 'New Feature / Fresh Development',
  requirement: 'A user can submit a request and see a confirmation.',
  uiElements: 'Request form, Submit button',
  impactedAreas: 'Request history'
};
const rawSuite = () => ({
  scenarios: [{ cat: 'Functional', pri: 'High', desc: 'Submit a valid request', evidence: 'see a confirmation' }],
  testCases: [{
    type: 'Functional', pri: 'High', scenario: 'Submit valid request',
    steps: '1. Enter a valid request\n2. Submit', expected: 'A confirmation is shown.',
    evidence: 'submit a request'
  }],
  checklists: {
    reqMatch: [{ text: 'Confirm the request is visible.' }],
    exploratory: [{ text: 'Try a blank request.' }],
    regression: [{ text: 'Confirm request history still loads.' }]
  }
});
const response = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('only accepts plain localhost, loopback and IPv6 loopback API URLs', () => {
  for (const value of ['http://localhost:11434', 'http://127.0.0.1:11434/', 'http://[::1]:11434']) {
    assert.match(OllamaLocal.normalizeBaseUrl(value), /^http:/);
  }
  for (const value of [
    'https://example.com', 'http://localhost.evil.test:11434',
    'http://user:pass@localhost:11434', 'http://localhost:11434/api',
    'http://localhost:11434/?next=example.com', 'file:///tmp/ollama'
  ]) assert.throws(() => OllamaLocal.normalizeBaseUrl(value), /localhost|loopback|Remote/);
});

test('request assembly sends only the four permitted testing fields and requests schema JSON', () => {
  const request = OllamaLocal.buildChatRequest('llama3.2:latest', requestInput);
  assert.deepEqual(JSON.parse(request.messages[1].content), requestInput);
  assert.equal(request.stream, false);
  assert.equal(request.options.temperature, 0);
  assert.equal(request.options.num_predict, 1800);
  assert.equal(request.format.type, 'object');
  assert.ok(request.messages[0].content.includes('exact, short quotation'));
  const noOptionalDetails = OllamaLocal.buildChatRequest('llama3.2:latest', {
    scopeType: requestInput.scopeType, requirement: requestInput.requirement, uiElements: '', impactedAreas: ''
  });
  assert.deepEqual(JSON.parse(noOptionalDetails.messages[1].content), {
    scopeType: requestInput.scopeType, requirement: requestInput.requirement, uiElements: '', impactedAreas: ''
  });
  assert.throws(() => OllamaLocal.buildChatRequest('llama3.2:latest', {
    ...requestInput, project: 'Private project', module: 'Login', login: 'secret', screenshot: 'data:image/png;base64,abc'
  }), /Only the testing scope/);
  assert.throws(() => OllamaLocal.buildChatRequest('remote-cloud-model', requestInput), /Cloud/);
});

test('model listing only returns named local models and excludes cloud models', async () => {
  const models = await OllamaLocal.listModels('http://localhost:11434', async (url, options) => {
    assert.equal(url, 'http://localhost:11434/api/tags');
    assert.equal(options.credentials, 'omit');
    return response({ models: [{ name: 'llama3.2:latest' }, { name: 'remote-cloud:cloud' }, { model: 'unnamed' }] });
  });
  assert.deepEqual(models, ['llama3.2:latest']);
});

test('validates suite shape, assigns ordered IDs/statuses and keeps only exact requirement evidence', () => {
  const suite = OllamaLocal.validateSuite(rawSuite(), requestInput.requirement);
  assert.equal(suite.testCases[0].id, 'TC_001');
  assert.equal(suite.testCases[0].status, 'Not Run');
  assert.equal(suite.scenarios[0].id, 'TS_01');
  assert.equal(suite.testCases[0].evidence, 'submit a request');
  const invalid = rawSuite();
  invalid.testCases[0].evidence = 'made-up requirement';
  assert.throws(() => OllamaLocal.validateSuite(invalid, requestInput.requirement), /does not exactly match/);
});

test('rejects empty or malformed output before returning a suite', async () => {
  for (const content of ['', 'not json', JSON.stringify({ scenarios: [], testCases: [], checklists: {} })]) {
    await assert.rejects(OllamaLocal.generateSuite('http://localhost:11434', 'llama3.2', requestInput,
      async () => response({ message: { content } })), /empty|malformed|invalid/i);
  }
  const invalid = rawSuite();
  invalid.testCases[0].type = 'Unknown';
  await assert.rejects(OllamaLocal.generateSuite('http://localhost:11434', 'llama3.2', requestInput,
    async () => response({ message: { content: JSON.stringify(invalid) } })), /invalid test case/i);
});

test('rejects remote targets and unsupported input fields before making any request', async () => {
  let calls = 0;
  const fetchMock = async () => { calls++; return response({}); };
  await assert.rejects(OllamaLocal.generateSuite('https://example.com', 'llama3.2', requestInput, fetchMock), /Remote servers/);
  await assert.rejects(OllamaLocal.generateSuite('http://localhost:11434', 'llama3.2',
    { ...requestInput, password: 'secret' }, fetchMock), /Only the testing scope/);
  assert.equal(calls, 0);
});

test('surfaces context limits and browser connection/CORS guidance', async () => {
  await assert.rejects(OllamaLocal.generateSuite('http://localhost:11434', 'llama3.2', requestInput,
    async () => new Response(JSON.stringify({ error: 'context length exceeded' }), { status: 400 })), /context\/size limit/);
  await assert.rejects(OllamaLocal.listModels('http://localhost:11434', async () => { throw new TypeError('Failed to fetch'); }),
    /OLLAMA_ORIGINS/);
});

test('surfaces missing-model and timeout failures without a success-shaped response', async () => {
  await assert.rejects(OllamaLocal.generateSuite('http://localhost:11434', 'llama3.2', requestInput,
    async () => new Response(JSON.stringify({ error: 'model not found' }), { status: 404 })), /could not find model/);
  const delayedFetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
  });
  await assert.rejects(OllamaLocal.listModels('http://localhost:11434', delayedFetch, 5), /too long to respond/);
});
