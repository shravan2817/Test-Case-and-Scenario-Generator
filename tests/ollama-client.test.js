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
  scenarios: [{ cat: 'Functional', pri: 'High', desc: 'End-to-end: submit a valid request', evidence: 'see a confirmation' }],
  testCases: [{
    type: 'Functional', pri: 'High', scenario: 'End-to-end: submit valid request',
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
const chatFetch = handler => (url, options) => url.endsWith('/api/show')
  ? response({ capabilities: ['completion'] }) : handler(url, options);

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
  assert.match(request.messages[0].content, /main business-functional workflows and end-to-end/);
  assert.match(request.messages[0].content, /Do not generate standalone basic checks/);
  assert.match(request.messages[0].content, /do not omit a rule to shorten output/);
  assert.match(request.messages[0].content, /concise numbered action steps/);
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
      chatFetch(async () => response({ message: { content } }))), /empty|malformed|invalid/i);
  }
  const invalid = rawSuite();
  invalid.testCases[0].type = 'Unknown';
  await assert.rejects(OllamaLocal.generateSuite('http://localhost:11434', 'llama3.2', requestInput,
    chatFetch(async () => response({ message: { content: JSON.stringify(invalid) } }))), /invalid test case/i);
});

test('new Ollama output must contain functional and explicitly named end-to-end workflows', async () => {
  for (const alter of [
    suite => { suite.testCases[0].type = 'Negative'; },
    suite => { suite.testCases[0].scenario = 'Open the page'; },
    suite => { suite.scenarios[0].desc = 'Check a button'; }
  ]) {
    const suite = rawSuite();
    alter(suite);
    await assert.rejects(OllamaLocal.generateSuite('http://localhost:11434', 'llama3.2', requestInput,
      chatFetch(async () => response({ message: { content: JSON.stringify(suite) } }))), /main functional workflows.*end-to-end/i);
  }
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
    chatFetch(async () => new Response(JSON.stringify({ error: 'context length exceeded' }), { status: 400 }))), /context\/size limit/);
  await assert.rejects(OllamaLocal.listModels('http://localhost:11434', async () => { throw new TypeError('Failed to fetch'); }),
    /OLLAMA_ORIGINS/);
});

test('surfaces missing-model and timeout failures without a success-shaped response', async () => {
  await assert.rejects(OllamaLocal.generateSuite('http://localhost:11434', 'llama3.2', requestInput,
    chatFetch(async () => new Response(JSON.stringify({ error: 'model not found' }), { status: 404 }))), /could not find model/);
  const delayedFetch = (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })), { once: true });
  });
  await assert.rejects(OllamaLocal.listModels('http://localhost:11434', delayedFetch, 5), /too long to respond/);
});

test('cancellation and a stalled response body release the request without replacing drafts', async () => {
  const controller = new AbortController();
  const stalledBody = chatFetch(async () => ({ ok: true, text: () => new Promise(() => {}) }));
  const request = OllamaLocal.generateSuite('http://localhost:11434', 'llama3.2', requestInput, stalledBody, 1000, controller.signal);
  controller.abort();
  await assert.rejects(request, /cancelled.*existing cases were not changed/i);
  await assert.rejects(OllamaLocal.generateSuite('http://localhost:11434', 'llama3.2', requestInput, stalledBody, 5), /too long to respond/);
  let called = false;
  await assert.rejects(OllamaLocal.generateSuite('http://localhost:11434', 'llama3.2', requestInput, async () => { called = true; }, 1000, controller.signal), /cancelled/i);
  assert.equal(called, false);
});

test('long requirements are sent in complete batches and merged with unique IDs', async () => {
  const requirement = Array.from({ length: 950 }, (_, i) => `Rule ${i + 1}: submit a request and see a confirmation.`).join('\n');
  const sent = [], progress = [];
  const input = { ...requestInput, requirement };
  let metadataCalls = 0;
  const suite = await OllamaLocal.generateSuite('http://localhost:11434', 'llama3.2', input, async (url, options) => {
    if (url.endsWith('/api/show')) {
      metadataCalls++;
      assert.deepEqual(JSON.parse(options.body), { model: 'llama3.2' });
      assert.equal(options.credentials, 'omit');
      return response({ capabilities: ['completion', 'thinking'], thinking: { values: [false, true], default: true } });
    }
    assert.equal(JSON.parse(options.body).think, false);
    const batch = JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.ok(batch.requirement.length <= 20000);
    assert.equal(batch.uiElements, input.uiElements);
    sent.push(batch.requirement);
    const output = rawSuite();
    output.scenarios[0].evidence = '';
    output.testCases[0].evidence = '';
    return response({ message: { content: JSON.stringify(output) } });
  }, undefined, undefined, (current, total) => progress.push([current, total]));
  assert.ok(sent.length > 1);
  assert.equal(metadataCalls, 1);
  assert.equal(sent.join('\n').replace(/\s+/g, ' '), requirement.replace(/\s+/g, ' '));
  assert.equal(input.requirement, requirement);
  assert.equal(suite.testCases.length, sent.length);
  assert.deepEqual(suite.testCases.map(item => item.id), sent.map((_, i) => `TC_${String(i + 1).padStart(3, '0')}`));
  assert.equal(new Set(suite.scenarios.map(item => item.id)).size, sent.length);
  assert.deepEqual(progress, sent.map((_, i) => [i + 1, sent.length]));
  assert.equal(suite.checklists.reqMatch.length, 1);
});

test('a later batch failure or cancellation never returns a partial suite', async () => {
  const input = { ...requestInput, requirement: 'submit a request and see a confirmation.\n'.repeat(700) };
  let calls = 0;
  await assert.rejects(OllamaLocal.generateSuite('http://localhost:11434', 'llama3.2', input, chatFetch(async () => {
    if (++calls === 2) throw new Error('Second batch unavailable');
    return response({ message: { content: JSON.stringify(rawSuite()) } });
  })), /batch 2 of 2 failed.*existing cases were not changed/i);
  const controller = new AbortController();
  calls = 0;
  await assert.rejects(OllamaLocal.generateSuite('http://localhost:11434', 'llama3.2', input, chatFetch(async () => {
    calls++;
    controller.abort();
    return response({ message: { content: JSON.stringify(rawSuite()) } });
  }), undefined, controller.signal), /cancelled/i);
  assert.equal(calls, 1);
});

test('only sends thinking controls explicitly supported by the selected model', async () => {
  for (const [metadata, expected] of [
    [{ capabilities: ['completion', 'thinking'], thinking: { values: [false, true], default: true } }, false],
    [{ capabilities: ['completion', 'thinking'], thinking: { values: ['low', 'medium', 'high'], default: 'medium' } }, 'low'],
    [{ capabilities: ['completion', 'thinking'], thinking: { values: [true], default: true } }, undefined],
    [{ capabilities: ['completion'] }, undefined],
    [{ details: { family: 'older-model' } }, undefined]
  ]) {
    let chatCalls = 0;
    const suite = await OllamaLocal.generateSuite('http://localhost:11434', 'local-model', requestInput, async (url, options) => {
      if (url.endsWith('/api/show')) return response(metadata);
      chatCalls++;
      const body = JSON.parse(options.body);
      assert.equal(body.think, expected);
      assert.equal(Object.hasOwn(body, 'think'), expected !== undefined);
      assert.deepEqual(JSON.parse(body.messages[1].content), requestInput);
      return response({ message: { content: JSON.stringify(rawSuite()) } });
    });
    assert.equal(chatCalls, 1);
    assert.equal(suite.testCases[0].status, 'Not Run');
  }
});

test('failed, invalid or cancelled metadata lookup cannot start generation', async () => {
  for (const result of [
    () => new Response(JSON.stringify({ error: 'model not found' }), { status: 404 }),
    () => response({}),
    () => response(null),
    () => response([])
  ]) {
    let calls = 0;
    await assert.rejects(OllamaLocal.generateSuite('http://localhost:11434', 'local-model', requestInput, async url => {
      assert.match(url, /\/api\/show$/);
      calls++;
      return result();
    }), /could not find model|invalid model details/);
    assert.equal(calls, 1);
  }
  const controller = new AbortController();
  await assert.rejects(OllamaLocal.generateSuite('http://localhost:11434', 'local-model', requestInput, async url => {
    assert.match(url, /\/api\/show$/);
    controller.abort();
    return response({ capabilities: ['completion'] });
  }, undefined, controller.signal), /cancelled.*existing cases were not changed/i);
});
