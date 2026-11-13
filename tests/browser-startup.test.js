const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const LocalWorkspace = require('../local-workspace.js');

const browser = [
  process.env.QA_TEST_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'
].find(candidate => candidate && fs.existsSync(candidate));
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('real app scripts initialize fresh and remembered profiles without ReferenceErrors', {
  skip: !browser || typeof WebSocket === 'undefined' ? 'Chromium and Node WebSocket are required' : false,
  timeout: 30000
}, async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-startup-test-'));
  const downloads = path.join(profile, 'downloads');
  fs.mkdirSync(downloads);
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    fs.readFile(file, (error, data) => {
      if (error) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      response.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore' });
  let socket;
  try {
    let port;
    for (let i = 0; i < 150 && !port; i++) {
      try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; }
      catch (error) { if (!['ENOENT', 'EBUSY'].includes(error.code)) throw error; }
      if (!port) await delay(100);
    }
    assert.ok(port, 'browser DevTools did not start');
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const pending = new Map(), exceptions = [];
    let id = 0;
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') {
        exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      }
      if (!pending.has(message.id)) return;
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const wait = async expression => {
      for (let i = 0; i < 150; i++) {
        try { if (await evaluate(expression)) return; } catch (error) {
          if (!/context was destroyed|Cannot find context/i.test(error.message)) throw error;
        }
        await delay(100);
      }
      throw new Error(`Timed out waiting for ${expression}`);
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] });
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    await wait('window.qaUiInitialized === true');
    assert.equal(await evaluate("typeof restoreRememberedFolder"), 'function');
    await evaluate(`localStorage.setItem('qa_active_user_session_v1', JSON.stringify({ username: 'Synthetic', email: 'synthetic@example.test' }))`);
    await send('Page.reload', { ignoreCache: true });
    await delay(300);
    await wait("window.qaUiInitialized === true && document.querySelector('#welcomeUserTitle').textContent.includes('Welcome back')");
    const state = await evaluate(`({
      busy: workspaceBusy,
      inert: document.querySelector('#mainAppShell').inert,
      toast: document.querySelector('#copyToast').textContent
    })`);
    assert.equal(state.busy, false);
    assert.equal(state.inert, false);
    assert.doesNotMatch(state.toast, /Could not restore|not defined/i);
    await evaluate("document.querySelector('.workspace-choice.studio-dash').click()");
    await wait("currentMode === 'studio' && !workspaceBusy");
    const key = async (value, code) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, code: value, windowsVirtualKeyCode: code });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, code: value, windowsVirtualKeyCode: code });
    };
    await evaluate("document.querySelector('#btnModeStudio').focus()");
    await key('ArrowLeft', 37);
    assert.equal(await evaluate("currentMode"), 'report');
    assert.equal(await evaluate("document.querySelector('#btnModeReport').getAttribute('aria-selected')"), 'true');
    assert.equal(await evaluate("document.querySelector('#btnModeStudio').tabIndex"), -1);
    await key('ArrowRight', 39);
    assert.equal(await evaluate("currentMode"), 'studio');
    await wait("document.documentElement.dataset.icons === 'fallback'");
    const fallbackColors = await evaluate(`(() => {
      const theme = document.documentElement.getAttribute('data-theme');
      const results = ['dark', 'light'].map(value => {
        document.documentElement.setAttribute('data-theme', value);
        const icon = document.querySelector('#btnModeReport .material-symbols-rounded');
        const style = getComputedStyle(icon, '::before');
        return { theme: value, foreground: getComputedStyle(icon).color, ink: style.backgroundColor, mask: style.maskImage };
      });
      document.documentElement.setAttribute('data-theme', theme);
      return results;
    })()`);
    for (const result of fallbackColors) {
      assert.equal(result.ink, result.foreground);
      assert.notEqual(result.mask, 'none');
      assert.notEqual(result.ink, 'rgba(0, 0, 0, 0)');
    }
    const minimal = await evaluate(`(async () => {
      document.querySelector('#newProjectInput').value = 'Synthetic project';
      await saveNewProject();
      document.querySelector('#newModuleInput').value = 'Invoices';
      await saveNewModule();
      document.querySelector('#testUrl').value = 'https://test.example';
      document.querySelector('#buildVersion').value = 'build-1';
      document.querySelector('#studioChangeSummary').value = 'Submit an invoice and save its approval.';
      await runFunctionalAgents();
      return {
        cases: studioTestCases.length,
        endToEnd: studioTestCases.at(-1)?.scenario,
        optionsClosed: !document.querySelector('.studio-options').open,
        modelHidden: document.querySelector('#studioGenerationMode').hidden,
        scope: document.querySelector('#studioScopeType').value
      };
    })()`);
    assert.equal(minimal.cases, 2);
    assert.match(minimal.endToEnd, /End-to-end/);
    assert.equal(minimal.optionsClosed, true);
    assert.equal(minimal.modelHidden, true);
    assert.equal(minimal.scope, 'General workflow');
    await evaluate("document.querySelector('#studioCasesTab').focus()");
    await key('End', 35);
    assert.equal(await evaluate("document.activeElement.id"), 'studioChecklistTab');
    assert.equal(await evaluate("document.querySelector('#studioChecklistTab').getAttribute('aria-selected')"), 'true');
    assert.equal(await evaluate("document.querySelector('#tabGuardChecklist').classList.contains('active')"), true);
    await key('Home', 36);
    assert.equal(await evaluate("document.activeElement.id"), 'studioCasesTab');
    const localAI = await evaluate(`(async () => {
      const original = OllamaLocal.listModels;
      const before = JSON.stringify(studioTestCases);
      try {
        OllamaLocal.listModels = async () => ['synthetic-local'];
        await toggleStudioLocalAI(true);
        const selected = document.querySelector('#ollamaModelSelect').value;
        const ready = document.querySelector('#studioUseOllama').checked && !document.querySelector('#ollamaSettingsShortcut').hidden;
        await toggleStudioLocalAI(false);
        ollamaConnectionReady = false;
        OllamaLocal.listModels = async () => { throw new Error('Synthetic local connection failure'); };
        await toggleStudioLocalAI(true);
        return { selected, ready, unchanged: JSON.stringify(studioTestCases) === before,
          failedMode: document.querySelector('#studioGenerationMode').value,
          error: document.querySelector('#studioGenerationStatus').dataset.state,
          retry: !document.querySelector('#retryOllamaConnection').hidden, busy: workspaceBusy };
      } finally { OllamaLocal.listModels = original; await toggleStudioLocalAI(false); }
    })()`);
    assert.equal(localAI.selected, 'synthetic-local');
    assert.equal(localAI.ready, true);
    assert.equal(localAI.unchanged, true);
    assert.equal(localAI.failedMode, 'ollama');
    assert.equal(localAI.error, 'error');
    assert.equal(localAI.retry, true);
    assert.equal(localAI.busy, false);
    const tunedAI = await evaluate(`(async () => {
      const originalFetch = window.fetch;
      const originalConfirm = window.confirm;
      const calls = [];
      let metadataFailure = false, stallChat = false, chatStarted = false, pickerCalls = 0;
      const originalPicker = window.showDirectoryPicker;
      const originalStore = folderStore, originalRemembered = rememberedHandle;
      const originalNeedsReconnect = folderNeedsReconnect, originalRecoveryNeeded = folderRecoveryNeeded;
      try {
        window.confirm = () => true;
        window.showDirectoryPicker = async () => { pickerCalls++; throw new Error('Generation must not open the folder picker'); };
        window.fetch = async (url, options) => {
          const endpoint = new URL(url).pathname;
          calls.push(endpoint);
          const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
          if (endpoint === '/api/tags') return json({ models: [{ name: 'synthetic-local' }] });
          if (endpoint === '/api/show') {
            if (metadataFailure) return new Response(JSON.stringify({ error: 'Synthetic metadata failure' }), { status: 503 });
            return json({ capabilities: ['completion', 'thinking'], thinking: { values: [true, false], default: true } });
          }
          if (endpoint !== '/api/chat') throw new Error('Unexpected mocked endpoint: ' + endpoint);
          const body = JSON.parse(options.body);
          if (body.think !== false) throw new Error('Supported thinking control not applied');
          if (stallChat) {
            chatStarted = true;
            return new Promise((resolve, reject) => {
              options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
            });
          }
          return json({ message: { content: JSON.stringify({
            scenarios: [{ cat: 'Functional', pri: 'High', desc: 'End-to-end: save an invoice', evidence: '' }],
            testCases: [{ type: 'Functional', pri: 'High', scenario: 'End-to-end: save an invoice',
              steps: '1. Submit an invoice\\n2. Check saved approval', expected: 'The invoice approval is saved.', evidence: '' }],
            checklists: { reqMatch: [], exploratory: [], regression: [] }
          }) } });
        };
        await toggleStudioLocalAI(true);
        await runFunctionalAgents();
        const successful = studioTestCases.length === 1 && studioTestCases[0].scenario === 'End-to-end: save an invoice';
        const beforeFailure = JSON.stringify(studioTestCases);
        const successfulCalls = calls.slice();
        stallChat = true;
        const pending = runFunctionalAgents();
        for (let i = 0; i < 30 && !chatStarted; i++) await new Promise(resolve => setTimeout(resolve, 0));
        if (!chatStarted) throw new Error('Stalled chat was not reached');
        folderStore = { save: async () => { throw new DOMException('Folder unavailable during generation', 'NotFoundError'); } };
        folderNeedsReconnect = false;
        await performSaveNow();
        const cancel = document.querySelector('#cancelStudioGeneration');
        const rect = cancel.getBoundingClientRect();
        const cancelReachable = !cancel.hidden && !cancel.closest('[inert]') &&
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === cancel;
        cancel.click();
        await pending;
        const cancelled = !workspaceBusy && !document.querySelector('#mainAppShell').inert &&
          JSON.stringify(studioTestCases) === beforeFailure &&
          /cancelled/i.test(document.querySelector('#studioGenerationStatus').textContent) &&
          /only in memory|still in this tab/i.test(document.querySelector('#storageMessage').textContent);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 2;
        canvas.getContext('2d').fillRect(0, 0, 2, 2);
        studioImages = [canvas.toDataURL('image/png')];
        renderImages('studio');
        markUnsaved();
        const backupSnapshot = snapshotWorkspace();
        const backupStarted = backupWorkspace();
        const backupKeptUnsaved = isDirty && folderNeedsReconnect &&
          /Backup downloaded.*reconnect/i.test(document.querySelector('#storageMessage').textContent);
        const originalGenerate = OllamaLocal.generateSuite;
        let timedOut = false;
        chatStarted = false;
        try {
          OllamaLocal.generateSuite = (base, model, input, fetchImpl, timeout, signal, progress) =>
            originalGenerate(base, model, input, fetchImpl, 100, signal, progress);
          await runFunctionalAgents();
          timedOut = chatStarted && !workspaceBusy && !document.querySelector('#mainAppShell').inert &&
            JSON.stringify(studioTestCases) === beforeFailure &&
            /too long to respond/i.test(document.querySelector('#studioGenerationStatus').textContent);
        } finally { OllamaLocal.generateSuite = originalGenerate; }
        stallChat = false;
        await runFunctionalAgents();
        const completedWithMissingFolder = !workspaceBusy && studioTestCases.length === 1 && isDirty &&
          document.querySelector('#studioTestCaseBody tr')?.innerText.includes('End-to-end: save an invoice');
        metadataFailure = true;
        await runFunctionalAgents();
        return { calls: successfulCalls, successful, cancelReachable, cancelled, completedWithMissingFolder, pickerCalls,
          backupSnapshot, backupStarted, backupKeptUnsaved, timedOut,
          preserved: JSON.stringify(studioTestCases) === beforeFailure,
          busy: workspaceBusy, inert: document.querySelector('#mainAppShell').inert,
          error: document.querySelector('#studioGenerationStatus').textContent };
      } finally {
        window.fetch = originalFetch;
        window.confirm = originalConfirm;
        window.showDirectoryPicker = originalPicker;
        folderStore = originalStore; rememberedHandle = originalRemembered;
        folderNeedsReconnect = originalNeedsReconnect; folderRecoveryNeeded = originalRecoveryNeeded;
        await toggleStudioLocalAI(false);
      }
    })()`);
    assert.equal(tunedAI.successful, true);
    assert.deepEqual(tunedAI.calls, ['/api/tags', '/api/show', '/api/chat']);
    assert.equal(tunedAI.cancelReachable, true);
    assert.equal(tunedAI.cancelled, true);
    assert.equal(tunedAI.completedWithMissingFolder, true);
    assert.equal(tunedAI.pickerCalls, 0);
    assert.equal(tunedAI.backupStarted, true);
    assert.equal(tunedAI.backupKeptUnsaved, true);
    assert.equal(tunedAI.timedOut, true);
    assert.equal(tunedAI.preserved, true);
    assert.equal(tunedAI.busy, false);
    assert.equal(tunedAI.inert, false);
    assert.match(tunedAI.error, /Synthetic metadata failure/);
    let backupFile;
    for (let i = 0; i < 50 && !backupFile; i++) {
      backupFile = fs.readdirSync(downloads).find(name => name.endsWith('.json'));
      if (!backupFile) await delay(50);
    }
    assert.ok(backupFile, 'JSON backup did not download');
    const { exportedAt, ...backup } = JSON.parse(fs.readFileSync(path.join(downloads, backupFile), 'utf8'));
    assert.ok(exportedAt);
    LocalWorkspace.validate(backup);
    assert.deepEqual(backup, tunedAI.backupSnapshot);
    await evaluate(`(() => {
      studioTestCases = []; studioScenarios = []; studioImages = [];
      guardChecklists = { reqMatch: [], exploratory: [], regression: [] };
      renderStudioOutputs(); renderImages('studio');
      window.__qaRestoreConfirm = window.confirm;
      window.confirm = () => true;
    })()`);
    try {
      const { root: documentRoot } = await send('DOM.getDocument');
      const { nodeId } = await send('DOM.querySelector', { nodeId: documentRoot.nodeId, selector: '#restoreInput' });
      await send('DOM.setFileInputFiles', { nodeId, files: [path.join(downloads, backupFile)] });
      await wait("!workspaceBusy && studioTestCases.length === 1");
      const restored = await evaluate(`({
        testCases: studioTestCases,
        images: studioImages,
        dirty: isDirty,
        folderConnected: !!folderStore,
        status: document.querySelector('#storageMessage').textContent
      })`);
      const record = backup.records[LocalWorkspace.recordKey(backup.active.project, backup.active.module)];
      assert.deepEqual(restored.testCases, record.form.studioTestCases);
      assert.deepEqual(restored.images, record.images.studio);
      assert.equal(restored.dirty, true);
      assert.equal(restored.folderConnected, false);
      assert.match(restored.status, /Backup imported.*only in memory/);
    } finally {
      await evaluate("window.confirm = window.__qaRestoreConfirm; delete window.__qaRestoreConfirm;");
    }
    const largeDocument = await evaluate(`(async () => {
      const originalConfirm = window.confirm;
      try {
        window.confirm = () => true;
        document.querySelector('#studioChangeSummary').value = Array.from({ length: 150 },
          (_, index) => 'Requirement ' + (index + 1) + ': submit invoice ' + (index + 1) + ' and save its confirmation.').join('\\n');
        await runFunctionalAgents();
        return { count: studioTestCases.length, lastRequirement: studioTestCases[149]?.scenario,
          endToEnd: studioTestCases.at(-1)?.steps, busy: workspaceBusy,
          localAI: document.querySelector('#studioUseOllama').checked };
      } finally { window.confirm = originalConfirm; }
    })()`);
    assert.equal(largeDocument.count, 151);
    assert.match(largeDocument.lastRequirement, /invoice 150/);
    assert.match(largeDocument.endToEnd, /invoice 150/);
    assert.equal(largeDocument.busy, false);
    assert.equal(largeDocument.localAI, false);
    assert.deepEqual(exceptions.filter(error => /ReferenceError/.test(error)), []);
  } finally {
    if (socket) socket.close();
    child.kill();
    await new Promise(resolve => server.close(resolve));
    try { await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch (error) { console.error(`Could not remove temporary browser profile: ${error.message}`); }
  }
});
