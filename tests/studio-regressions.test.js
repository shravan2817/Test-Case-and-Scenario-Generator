const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
function part(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}

test('Studio rendering preserves legacy custom priority and status options', () => {
  const nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, {
      style: {}, dataset: {}, value: '', textContent: '', innerHTML: '', children: [],
      classList: { toggle() {} }, querySelector: () => ({ dataset: {} }),
      appendChild(child) { this.children.push(child); }
    });
    return nodes.get(id);
  };
  const context = vm.createContext({
    $, document: { createElement: () => ({ innerHTML: '' }) },
    studioTestCases: [{ id: 'old', type: 'Regression', pri: 'Urgent', status: 'Investigating', scenario: 'Old' }],
    studioScenarios: [], guardChecklists: {},
    CATEGORIES: ['Functional', 'Regression'], PRIORITIES: ['High', 'Medium'], STATUSES: ['Not Run', 'Pass'],
    esc: value => String(value ?? ''), opts: (values, selected) => values.map(v => `<option ${v === selected ? 'selected' : ''}>${v}</option>`).join(''),
    renderStudioGenerationAttribution() {}, renderChecklistGroup() {}, renderTcStats() {}, applyTcFilter() {}, applyAria() {}
  });
  vm.runInContext(part('function renderStudioOutputs()', 'function renderTcStats()'), context);
  context.renderStudioOutputs();
  const row = $('studioTestCaseBody').children[0].innerHTML;
  assert.match(row, /<option selected>Urgent<\/option>/);
  assert.match(row, /<option selected>Investigating<\/option>/);
});

test('syncing edited cases retains unrecognized legacy fields', () => {
  const values = {
    '.st-id': { textContent: 'old' }, '.st-type': { value: 'Regression' },
    '.st-pri': { value: 'Urgent' }, '.st-scen': { innerText: 'Old' },
    '.st-steps': { innerText: 'Open' }, '.st-exp': { innerText: 'Done' },
    '.st-status': { value: 'Investigating' }
  };
  const context = vm.createContext({
    studioTestCases: [{ id: 'old', legacyNote: 'Keep this', evidence: 'Original' }], studioScenarios: [],
    document: { querySelectorAll: selector => selector === '#studioTestCaseBody tr' ? [{ querySelector: key => values[key] }] : [] }
  });
  vm.runInContext(part('function syncStudioTableEditsFromDOM()', 'function deleteTestCase'), context);
  context.syncStudioTableEditsFromDOM();
  assert.equal(context.studioTestCases[0].legacyNote, 'Keep this');
  assert.equal(context.studioTestCases[0].status, 'Investigating');
});

test('missing generation assets report a recovery action instead of silently failing', () => {
  const notices = [];
  const context = vm.createContext({
    console: { error() {} },
    setStudioGenerationStatus: (message, error) => notices.push({ message, error }),
    showToast: (message, type) => notices.push({ message, type })
  });
  vm.runInContext(part('function studioRequirementsReady()', 'async function readStudioDocument'), context);
  assert.equal(context.studioRequirementsReady(), false);
  assert.match(notices[0].message, /hard reload/i);
  assert.equal(notices[0].error, true);
  assert.equal(notices[1].type, 'error');
  context.Requirements = { extractDocument() {}, splitRequirements() {}, buildSuite() {} };
  assert.equal(context.studioRequirementsReady(), true);
});

test('cloud generation and the legacy key menu stay hidden and cloud requests are blocked', async () => {
  assert.match(source, /<option value="cloud" hidden disabled>/);
  assert.match(source, /<button[^>]*onclick="openApiModal\(\)" hidden>/);
  const notices = [];
  const context = vm.createContext({
    workspaceBusy: false, activeContext: { project: 'Existing' },
    $: id => id === 'studioGenerationMode' ? { value: 'cloud' } : null,
    showToast: (message, type) => notices.push({ message, type }),
    syncStudioTableEditsFromDOM() { throw new Error('Cloud must stop before touching drafts'); },
    CloudGeneration: { generateSuite() { throw new Error('Cloud must not send requests'); } }
  });
  vm.runInContext(part('async function runFunctionalAgents()', 'function completeStudioGeneration()'), context);
  await context.runFunctionalAgents();
  assert.match(notices[0].message, /Cloud generation is disabled/);
  assert.equal(notices[0].type, 'error');
});

test('moving an offline suite to the report prefers the functional case', () => {
  const fields = { studioChangeSummary: { value: '' }, featureDesc: { value: '' }, execSteps: { value: '' } };
  const context = vm.createContext({
    $: id => fields[id], syncStudioTableEditsFromDOM() {}, showToast() {}, switchWorkspaceMode() {}, performSaveNow() {},
    studioTestCases: [
      { type: 'Functional', scenario: 'Data: Perform the change', steps: 'Positive steps' },
      { type: 'Negative', scenario: 'Data: Test rejection', steps: 'Negative steps' }
    ],
    studioImages: []
  });
  vm.runInContext(part('function pushStudioToExecutionReport()', '/* ====================== DEFECTS'), context);
  context.pushStudioToExecutionReport();
  assert.equal(fields.execSteps.value, 'Positive steps');
});

function localAIControls(models, savedModel = '') {
  const nodes = new Map(), storage = new Map(), calls = [];
  storage.set('ollama', JSON.stringify({ baseUrl: 'http://localhost:11434', model: savedModel }));
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', dataset: {}, textContent: '', hidden: false, disabled: false, children: [],
      addEventListener() {}, replaceChildren(...children) { this.children = children; },
      add(child) { this.children.push(child); }
    });
    return nodes.get(id);
  };
  $('studioGenerationMode').value = 'templates';
  const context = vm.createContext({
    $, OLLAMA_SETTINGS_KEY: 'ollama', ollamaModels: [], ollamaConnectionReady: false,
    ollamaConnectionBusy: false, workspaceBusy: false, studioGenerationSource: '',
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    OllamaLocal: {
      DEFAULT_URL: 'http://localhost:11434', normalizeBaseUrl: value => value,
      async listModels(url) { calls.push(url); if (models instanceof Error) throw models; return models; }
    },
    setWorkspaceBusy(value) { context.workspaceBusy = value; },
    showToast() {}
  });
  vm.runInContext(part('function setStudioGenerationStatus(', 'async function runFunctionalAgents()'), context);
  context.updateStudioGenerationMode();
  return { context, $, calls, storage };
}

test('one local-AI choice connects and selects the saved or first installed model automatically', async () => {
  for (const [saved, expected] of [['', 'first-local'], ['second-local', 'second-local'], ['removed-model', 'first-local']]) {
    const { context, $, calls, storage } = localAIControls(['first-local', 'second-local'], saved);
    assert.equal(calls.length, 0, 'offline default must not contact a local server');
    assert.equal($('ollamaSettingsShortcut').hidden, true);
    await context.toggleStudioLocalAI(true);
    assert.equal(calls.length, 1);
    assert.equal($('ollamaModelSelect').value, expected);
    assert.equal($('studioGenerationMode').value, 'ollama');
    assert.equal($('studioUseOllama').checked, true);
    assert.equal(JSON.parse(storage.get('ollama')).model, expected);
    await context.toggleStudioLocalAI(false);
    await context.toggleStudioLocalAI(true);
    assert.equal(calls.length, 1, 'a ready connection should be reused in this tab');
  }
});

test('failed or empty local-AI discovery stays explicit and never silently falls back', async () => {
  for (const models of [new Error('Local server unavailable'), []]) {
    const { context, $, calls } = localAIControls(models);
    await context.toggleStudioLocalAI(true);
    assert.equal(calls.length, 1);
    assert.equal($('studioGenerationMode').value, 'ollama');
    assert.equal($('studioUseOllama').checked, true);
    assert.equal($('retryOllamaConnection').hidden, false);
    assert.equal($('studioGenerationStatus').dataset.state, 'error');
    assert.equal(context.workspaceBusy, false);
    await context.toggleStudioLocalAI(false);
    assert.equal($('studioGenerationMode').value, 'templates');
    assert.equal($('retryOllamaConnection').hidden, true);
    assert.match($('studioGenerationStatus').textContent, /No setup needed/);
  }
});

test('adding a case to a very large suite does not overflow function arguments or reuse an ID', () => {
  const cases = Array.from({ length: 200000 }, (_, i) => ({ id: `TC_${i + 1}` }));
  cases[10].id = 'TC_900001';
  const context = vm.createContext({
    studioTestCases: cases, syncStudioTableEditsFromDOM() {}, renderStudioOutputs() {}, markUnsaved() {},
    document: { querySelector: () => null }
  });
  vm.runInContext(part('function addCustomStudioTestCase()', 'function switchStudioTab('), context);
  context.addCustomStudioTestCase();
  assert.equal(cases.at(-1).id, 'TC_900002');
  assert.equal(cases.length, 200001);
});

test('validation captures the first missing field without depending on later CSS-class queries', () => {
  let focused = 0, scrolled = 0;
  const field = {
    value: '', classList: { toggle() {}, contains: () => false },
    focus() { focused++; }, scrollIntoView() { scrolled++; }
  };
  const context = vm.createContext({ $: id => id === 'missing' ? field : null, showToast() {} });
  vm.runInContext(part('function validateRequired(', 'function validateForExport('), context);
  assert.equal(context.validateRequired([['missing', 'Required field']]), false);
  assert.equal(focused, 1);
  assert.equal(scrolled, 1);
});
