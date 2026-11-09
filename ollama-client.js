(function (root) {
  'use strict';

  const DEFAULT_URL = 'http://localhost:11434';
  const CATEGORIES = ['Functional', 'Retesting', 'Negative', 'Boundary', 'Security', 'UI', 'Exploratory', 'Regression'];
  const PRIORITIES = ['High', 'Medium', 'Low'];
  const LIMITS = { requirement: 20000, uiElements: 3000, impactedAreas: 3000, scopeType: 200 };
  const OPTIONAL_INPUTS = new Set(['uiElements', 'impactedAreas']);
  const scenarioSchema = {
    type: 'object',
    properties: {
      cat: { type: 'string', enum: CATEGORIES },
      pri: { type: 'string', enum: PRIORITIES },
      desc: { type: 'string' },
      evidence: { type: 'string' }
    },
    required: ['cat', 'pri', 'desc', 'evidence'],
    additionalProperties: false
  };
  const testCaseSchema = {
    type: 'object',
    properties: {
      type: { type: 'string', enum: CATEGORIES },
      pri: { type: 'string', enum: PRIORITIES },
      scenario: { type: 'string' },
      steps: { type: 'string' },
      expected: { type: 'string' },
      evidence: { type: 'string' }
    },
    required: ['type', 'pri', 'scenario', 'steps', 'expected', 'evidence'],
    additionalProperties: false
  };
  const checklistSchema = {
    type: 'array',
    items: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false
    }
  };
  const suiteSchema = {
    type: 'object',
    properties: {
      scenarios: { type: 'array', items: scenarioSchema },
      testCases: { type: 'array', items: testCaseSchema },
      checklists: {
        type: 'object',
        properties: {
          reqMatch: checklistSchema,
          exploratory: checklistSchema,
          regression: checklistSchema
        },
        required: ['reqMatch', 'exploratory', 'regression'],
        additionalProperties: false
      }
    },
    required: ['scenarios', 'testCases', 'checklists'],
    additionalProperties: false
  };

  function normalizeBaseUrl(value) {
    let url;
    try { url = new URL(String(value || '').trim()); }
    catch { throw new Error('Enter a valid local Ollama URL, such as http://localhost:11434.'); }
    if (!['http:', 'https:'].includes(url.protocol) ||
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase()) ||
        url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('Ollama URL must use localhost, 127.0.0.1 or [::1], with no path, credentials or query. Remote servers are not allowed.');
    }
    return url.origin;
  }

  function localModelNames(payload) {
    if (!payload || !Array.isArray(payload.models)) throw new Error('Ollama returned an invalid model list.');
    return [...new Set(payload.models
      .map(item => item && typeof item.name === 'string' ? item.name.trim() : '')
      .filter(name => name && name.length <= 200 && !/cloud/i.test(name)))];
  }

  function normalizeWhitespace(value) {
    return value.replace(/\s+/g, ' ').trim();
  }

  function responseTextError(status, body, model) {
    let detail = '';
    try {
      const parsed = JSON.parse(body);
      detail = typeof parsed.error === 'string' ? parsed.error : '';
    } catch { detail = body; }
    detail = detail.trim().slice(0, 500);
    if (/context|token.{0,20}(limit|length|size)|input too (long|large)/i.test(detail)) {
      return new Error('Ollama reached the model context/size limit. Shorten the requirement or choose a model with a larger context window.');
    }
    if (status === 404 && model) {
      return new Error(`Ollama could not find model "${model}". Choose an installed local model from Settings; install one yourself with Ollama if needed.`);
    }
    return new Error(`Ollama request failed (HTTP ${status})${detail ? `: ${detail}` : '.'}`);
  }

  async function readJsonResponse(response, model) {
    const body = await response.text();
    if (!response.ok) throw responseTextError(response.status, body, model);
    try { return JSON.parse(body); }
    catch { throw new Error('Ollama returned malformed JSON. Check the local server version and try again.'); }
  }

  function networkError(error, timedOut) {
    if (timedOut || error?.name === 'AbortError') {
      return new Error('Ollama took too long to respond. Check that the selected local model is running and try again.');
    }
    if (error instanceof TypeError) {
      return new Error('Could not reach Ollama. Start Ollama and check browser CORS: set OLLAMA_ORIGINS to this app’s exact origin, then restart Ollama. Keep Ollama bound to localhost; do not expose it to your network.');
    }
    return error;
  }

  async function withTimeout(fetchImpl, url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, {
        ...options,
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      });
    } catch (error) {
      throw networkError(error, controller.signal.aborted);
    } finally { clearTimeout(timer); }
  }

  async function listModels(baseUrl, fetchImpl = root.fetch, timeoutMs = 10000) {
    const base = normalizeBaseUrl(baseUrl);
    const response = await withTimeout(fetchImpl, `${base}/api/tags`, { method: 'GET' }, timeoutMs);
    const payload = await readJsonResponse(response);
    return localModelNames(payload);
  }

  function requestInput(input) {
    const result = {};
    for (const [field, max] of Object.entries(LIMITS)) {
      const value = input && typeof input[field] === 'string' ? input[field].trim() : '';
      if ((!value && !OPTIONAL_INPUTS.has(field)) || value.length > max) {
        throw new Error(`${field === 'requirement' ? 'Requirement' : field === 'uiElements' ? 'UI screens/fields' : field === 'impactedAreas' ? 'Connected modules' : 'Testing scope'} is empty or too long. Review the input and try again.`);
      }
      result[field] = value;
    }
    if (Object.keys(input || {}).some(field => !Object.hasOwn(LIMITS, field))) {
      throw new Error('Only the testing scope, requirement, UI fields and impacted modules can be sent to Ollama.');
    }
    return result;
  }

  function buildChatRequest(model, input) {
    const modelName = String(model || '').trim();
    if (!modelName || modelName.length > 200 || /cloud/i.test(modelName)) {
      throw new Error('Choose an installed local Ollama model. Cloud models are not supported.');
    }
    const safeInput = requestInput(input);
    const instructions = [
      'Create draft QA scenarios, test cases, and checklists from only the supplied testing details.',
      'Do not claim tests were executed or invent application behavior as a fact.',
      'Use evidence only for an exact, short quotation copied from the supplied requirement; otherwise use an empty string.',
      'Return every required schema field. Keep the result concise and return valid JSON.'
    ].join(' ');
    return {
      model: modelName,
      messages: [
        { role: 'system', content: `${instructions} Aim for 4-6 scenarios, 6-8 test cases, and 2-4 concise checklist items per group.` },
        { role: 'user', content: JSON.stringify(safeInput) }
      ],
      stream: false,
      format: suiteSchema,
      options: { temperature: 0, num_predict: 1800 }
    };
  }

  function exactKeys(value, keys) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
      Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  }

  function text(value, label, max) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) {
      throw new Error(`Ollama returned an invalid ${label}. Generate again with a shorter response.`);
    }
    return value.trim();
  }

  function evidence(value, requirement) {
    if (typeof value !== 'string' || value.length > 500) throw new Error('Ollama returned invalid requirement evidence.');
    const quote = value.trim();
    if (quote && !normalizeWhitespace(requirement).includes(normalizeWhitespace(quote))) {
      throw new Error('Ollama returned requirement evidence that does not exactly match the supplied requirement. No cases were changed.');
    }
    return quote;
  }

  function validateSuite(value, requirement) {
    if (!exactKeys(value, ['scenarios', 'testCases', 'checklists']) ||
        !Array.isArray(value.scenarios) || !value.scenarios.length || value.scenarios.length > 30 ||
        !Array.isArray(value.testCases) || !value.testCases.length || value.testCases.length > 100 ||
        !exactKeys(value.checklists, ['reqMatch', 'exploratory', 'regression'])) {
      throw new Error('Ollama returned an empty or invalid test suite. No cases were changed; try again.');
    }
    const scenarios = value.scenarios.map((item, index) => {
      if (!exactKeys(item, ['cat', 'pri', 'desc', 'evidence']) ||
          !CATEGORIES.includes(item.cat) || !PRIORITIES.includes(item.pri)) {
        throw new Error(`Ollama returned an invalid scenario at position ${index + 1}. No cases were changed.`);
      }
      return { id: `TS_${String(index + 1).padStart(2, '0')}`, cat: item.cat, pri: item.pri,
        desc: text(item.desc, 'scenario description', 1000), evidence: evidence(item.evidence, requirement) };
    });
    const testCases = value.testCases.map((item, index) => {
      if (!exactKeys(item, ['type', 'pri', 'scenario', 'steps', 'expected', 'evidence']) ||
          !CATEGORIES.includes(item.type) || !PRIORITIES.includes(item.pri)) {
        throw new Error(`Ollama returned an invalid test case at position ${index + 1}. No cases were changed.`);
      }
      return {
        id: `TC_${String(index + 1).padStart(3, '0')}`,
        type: item.type,
        pri: item.pri,
        scenario: text(item.scenario, 'test case objective', 1000),
        steps: text(item.steps, 'test steps', 5000),
        expected: text(item.expected, 'expected result', 2000),
        status: 'Not Run',
        evidence: evidence(item.evidence, requirement)
      };
    });
    const checklists = {};
    for (const group of ['reqMatch', 'exploratory', 'regression']) {
      const items = value.checklists[group];
      if (!Array.isArray(items) || items.length > 50) throw new Error(`Ollama returned an invalid ${group} checklist. No cases were changed.`);
      checklists[group] = items.map((item, index) => {
        if (!exactKeys(item, ['text'])) throw new Error(`Ollama returned an invalid checklist item. No cases were changed.`);
        return { text: text(item.text, `${group} checklist item ${index + 1}`, 500), done: false };
      });
    }
    return { scenarios, testCases, checklists };
  }

  async function generateSuite(baseUrl, model, input, fetchImpl = root.fetch, timeoutMs = 300000) {
    const base = normalizeBaseUrl(baseUrl);
    const body = buildChatRequest(model, input);
    const response = await withTimeout(fetchImpl, `${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, timeoutMs);
    const payload = await readJsonResponse(response, body.model);
    if (typeof payload?.error === 'string' && payload.error) throw new Error(`Ollama error: ${payload.error.slice(0, 500)}`);
    const content = payload?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error('Ollama returned an empty response. Check the model and try again; no cases were changed.');
    }
    let parsed;
    try { parsed = JSON.parse(content); }
    catch { throw new Error('Ollama returned malformed test-suite JSON. No cases were changed; try again.'); }
    const requirement = requestInput(input).requirement;
    return validateSuite(parsed, requirement);
  }

  const api = { DEFAULT_URL, suiteSchema, normalizeBaseUrl, localModelNames, listModels, buildChatRequest, validateSuite, generateSuite };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OllamaLocal = api;
})(globalThis);
