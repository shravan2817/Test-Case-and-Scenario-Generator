const { test } = require('node:test');
const assert = require('node:assert/strict');
const Requirements = require('../requirements.js');

test('requirement lines select different templates and generate editable drafts', () => {
  const lines = Requirements.splitRequirements('1. Admin role can open reports.\n2. Email field is required.\n3. Save the draft.\n4. Display the dashboard.\n5. Calculate totals.');
  assert.deepEqual(lines.map(line => Requirements.templateFor(line)[0]), ['Access', 'Input', 'Data', 'UI', 'General']);
  const suite = Requirements.buildSuite(lines, { url: 'https://test.example', module: 'Reports', uiElements: 'Email', impactedAreas: 'Billing' });
  assert.equal(suite.scenarios.length, 6);
  assert.equal(suite.testCases.length, 6);
  assert.ok(suite.testCases.every(item => item.status === 'Not Run' && item.type === 'Functional'));
  assert.match(suite.testCases[0].scenario, /Admin role/);
  assert.match(suite.testCases[1].scenario, /Email field/);
  assert.notEqual(suite.testCases[0].expected, suite.testCases[2].expected);
  assert.notEqual(suite.testCases[2].expected, suite.testCases[3].expected);
  assert.match(suite.checklists.regression[0].text, /Billing/);
  assert.match(suite.testCases[5].scenario, /End-to-end/);
  for (const requirement of lines) assert.ok(suite.testCases[5].steps.includes(requirement));
  assert.match(suite.testCases[5].steps, /Billing/);
  assert.match(suite.testCases[5].expected, /Confirm unspecified order/);
  assert.doesNotMatch(suite.testCases.map(item => item.scenario).join('\n'), /Try missing|Check an exception|Try the action with a user or role without/);
});

test('large requirement sets retain every line and generate all cases without a line cap', () => {
  const lines = Array.from({ length: 1200 }, (_, index) => `Requirement ${index + 1}: save item ${index + 1}`);
  const requirements = Requirements.splitRequirements(lines.join('\n'));
  assert.deepEqual(requirements, lines);
  const suite = Requirements.buildSuite(requirements, { url: 'https://test.example', module: 'Large document' });
  assert.equal(suite.scenarios.length, 1201);
  assert.equal(suite.testCases.length, 1201);
  assert.equal(suite.scenarios[1199].desc, lines[1199]);
  assert.match(suite.testCases[1199].scenario, /Requirement 1200/);
  assert.match(suite.testCases[1200].steps, /Requirement 1200/);
  assert.equal(new Set(suite.testCases.map(item => item.id)).size, 1201);
});

test('TXT extraction reads real UTF-8 data and rejects invalid, empty, unsupported and large files', async () => {
  assert.equal(await Requirements.extractDocument(new File(['A valid requirement'], 'sample.txt')), 'A valid requirement');
  await assert.rejects(Requirements.extractDocument(new File([new Uint8Array([0xff])], 'invalid.txt')), /encoding/);
  await assert.rejects(Requirements.extractDocument(new File([''], 'empty.txt')), /No readable text/);
  await assert.rejects(Requirements.extractDocument(new File(['x'], 'wrong.doc')), /PDF, DOCX or TXT/);
  await assert.rejects(Requirements.extractDocument({ name: 'large.txt', size: 10 * 1024 * 1024 + 1 }), /10 MB/);
});
