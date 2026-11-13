const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const LocalWorkspace = require('../local-workspace.js');

function ui() {
  const nodes = new Map();
  const downloads = [];
  let downloadedBlob = null;
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', dataset: {}, style: {}, textContent: '', classList: { add() {}, remove() {} }, addEventListener() {} });
    return nodes.get(id);
  };
  const context = vm.createContext({
    $, LocalWorkspace, currentUser: { username: 'QA', email: 'qa@example.com' },
    document: {
      addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, body: { append() {} },
      createElement() { return { click() { downloads.push('download'); }, remove() {} }; }
    },
    window: { isSecureContext: true, showDirectoryPicker() {}, addEventListener() {} }, navigator: {},
    console: { error() {} }, clearTimeout, setTimeout: () => 1, autoSaveTimer: null, Blob, AbortController,
    URL: { createObjectURL(blob) { downloadedBlob = blob; return 'blob:backup'; }, revokeObjectURL() {} },
    downloads, confirm: () => true, recordUserHistory() {}, closeHistoryModal() {},
    isDirty: true, prodImages: [], execImages: [], studioImages: [], execEvidenceRows: [], execEvidenceImages: {}, activeEvidenceRowId: null,
    renderExecutionEvidenceRows() {},
    collectData: () => ({ project: 'Project', module: 'Login', desc: 'Retain this edit' }),
    populateProjectDropdown() {}, populateModuleDropdown() {},
    setBadgeState(state) { context.badge = state; }, showToast() {}
  });
  vm.runInContext(readFileSync(join(__dirname, '..', 'workspace-ui.js'), 'utf8'), context);
  context.applyWorkspaceState = () => {};
  vm.runInContext(`
    localState = LocalWorkspace.empty(currentUser);
    localState.projects = ['Project']; localState.modulesMap = { Project: ['Login'] };
    activeContext = { project: 'Project', module: 'Login' };
  `, context);
  return {
    context, $, downloads,
    readBackup: async () => JSON.parse(await downloadedBlob.text()),
    run: code => vm.runInContext(code, context)
  };
}
test('real login and remembered-profile startup call the shared folder restore without reference errors', async () => {
  const { context, $, run } = ui();
  const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf('async function handleUserLogin()');
  const end = html.indexOf('async function logoutUser()', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(html.slice(start, end), context);
  const requested = html.indexOf('function openRequestedWorkspace()');
  const next = html.indexOf('let metricsReturnFocus', requested);
  assert.ok(requested >= 0 && next > requested);
  vm.runInContext(html.slice(requested, next), context);
  const stored = new Map(), notices = [];
  context.localStorage = { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value) };
  context.WorkspaceEmail = { validEmail: () => true };
  context.ACTIVE_USER_KEY = 'test-profile';
  context.applyTheme = () => {};
  context.applyAria = () => {};
  context.updateSectionNavigation = () => {};
  context.document.documentElement = { getAttribute: () => 'dark' };
  context.window.dispatchEvent = () => {};
  context.Event = class { constructor(type) { this.type = type; } };
  context.URLSearchParams = URLSearchParams;
  context.location = { search: '' };
  context.showToast = message => notices.push(message);
  $('authUsername').value = 'QA';
  $('authEmail').value = 'qa@example.com';
  run('currentUser = null; handleCache = async () => null;');
  await run('handleUserLogin()');
  assert.equal(run('workspaceBusy'), false);
  assert.match($('welcomeUserTitle').textContent, /Welcome, QA/);
  run('currentUser = null;');
  await context.window.onload();
  assert.equal(context.window.qaUiInitialized, true);
  assert.equal(run('workspaceBusy'), false);
  assert.match($('welcomeUserTitle').textContent, /Welcome back, QA/);
  assert.equal(notices.some(message => /Could not restore|not defined/i.test(message)), false);
});
test('exhausted disk-state failure keeps unsaved edits and offers reconnect with a short message', async () => {
  const { context, $, run } = ui();
  context.failure = new DOMException('An operation that depends on state cached in an interface object failed', 'InvalidStateError');
  run('folderStore = { save: async () => { throw failure; } };');
  assert.equal(await run('performSaveNow()'), false);
  assert.equal(context.isDirty, true);
  assert.equal(context.badge, 'error');
  assert.equal(run('folderNeedsReconnect'), true);
  assert.equal($('connectFolderButton').textContent, 'Reconnect folder');
  assert.equal($('storageMessage').textContent, 'Not saved. The folder changed or its saved handle expired. Reconnect the folder; your edits are still in this tab.');
  assert.equal(run('Object.values(localState.records)[0].form.desc'), 'Retain this edit');
});
test('a concurrent workspace conflict enables recovery without clearing the memory draft', async () => {
  const { context, run } = ui();
  context.failure = Object.assign(new Error('Folder changed in another tab or app. Back up your edits, then reconnect.'), { name: 'WorkspaceConflictError' });
  run('folderStore = { save: async () => { throw failure; } };');
  assert.equal(await run('performSaveNow()'), false);
  assert.equal(context.isDirty, true);
  assert.equal(run('folderNeedsReconnect'), true);
});
test('a missing folder allows navigation with an explicit unsaved warning and preserves edits in memory', async () => {
  const { context, $, run } = ui();
  run(`localState.modulesMap.Project.push('Other');
    folderStore = { save: async () => { throw new DOMException('Moved folder', 'NotFoundError'); } };
    loadActiveModule = (project, module) => { activeContext = { project, module }; };`);
  context.DOMException = DOMException;
  $('projectSelect').value = 'Project';
  $('moduleSelect').value = 'Other';
  await run('changeModule(false)');
  assert.equal(run('activeContext.module'), 'Other');
  assert.equal(run('workspaceBusy'), false);
  assert.equal(run('folderNeedsReconnect'), true);
  assert.equal(context.isDirty, true);
  assert.equal(context.badge, 'error');
  assert.equal(run("localState.records[LocalWorkspace.recordKey('Project','Login')].form.desc"), 'Retain this edit');
  assert.match($('storageMessage').textContent, /only in memory.*Reconnect.*backup/i);
  assert.equal($('storageSettingsButton').textContent, 'Reconnect folder');
  run('markUnsaved()');
  assert.equal(context.badge, 'error');
  assert.match($('storageMessage').textContent, /only in memory/);
  assert.equal(run('backupWorkspace()'), true);
  assert.equal(context.badge, 'error');
  assert.match($('storageMessage').textContent, /Backup downloaded.*reconnect/i);
  run('handleCache = async () => {};');
  await run('disconnectLocalFolder()');
  assert.equal(run('folderNeedsReconnect'), false);
  assert.match($('storageMessage').textContent, /only in memory/);
});
test('a recovered save reports success only after the save promise completes', async () => {
  const { context, run } = ui();
  run('folderStore = { save: () => new Promise(resolve => { window.completeSave = resolve; }) };');
  const saving = run('performSaveNow()');
  await Promise.resolve();
  assert.equal(context.isDirty, true);
  assert.equal(context.badge, 'saving');
  context.window.completeSave();
  assert.equal(await saving, true);
  assert.equal(context.isDirty, false);
  assert.equal(context.badge, 'saved');
});
test('edits made during an in-flight save remain pending instead of reporting saved', async () => {
  const { context, run } = ui();
  run('editRevision = 1; folderStore = { save: () => new Promise(resolve => { window.completeSave = resolve; }) };');
  const saving = run('performSaveNow()');
  await Promise.resolve();
  assert.equal(context.badge, 'saving');
  run('editRevision++;');
  context.window.completeSave();
  assert.equal(await saving, true);
  assert.equal(context.isDirty, true);
  assert.equal(context.badge, 'pending');
});
test('a stalled save times out without a late success clearing retained edits', async () => {
  const { context, $, run } = ui();
  context.setTimeout = setTimeout;
  run('folderStore = { save: () => new Promise(resolve => { window.completeSave = resolve; }) };');
  assert.equal(await run('performSaveNow(false, 5)'), false);
  assert.equal(run('folderNeedsReconnect'), true);
  assert.equal(context.isDirty, true);
  assert.match($('storageMessage').textContent, /taking too long.*backup/i);
  context.window.completeSave();
  await run('saveQueue');
  assert.equal(context.isDirty, true);
  assert.equal(context.badge, 'error');
  assert.equal(run('backupWorkspace()'), true);
});
test('a save that times out in the queue cannot write an obsolete snapshot later', async () => {
  const { context, run } = ui();
  context.setTimeout = setTimeout;
  let writes = 0;
  context.write = async () => { writes++; };
  run('saveQueue = new Promise(resolve => { window.releaseQueue = resolve; }); folderStore = { save: write };');
  assert.equal(await run('performSaveNow(false, 5)'), false);
  context.window.releaseQueue();
  await run('saveQueue');
  assert.equal(writes, 0);
  assert.equal(context.isDirty, true);
});
test('disconnect cannot leave editing blocked behind a stalled save or handle deletion', async () => {
  for (const stalled of ['save', 'cache']) {
    const { context, $, run } = ui();
    context.setTimeout = setTimeout;
    run('folderStore = { handle: { name: "Connected folder" } };');
    if (stalled === 'save') run('saveQueue = new Promise(() => {});');
    else run('handleCache = () => new Promise(() => {});');
    await run('disconnectLocalFolder(5)');
    assert.equal(run('workspaceBusy'), false);
    assert.equal($('mainAppShell').inert, false);
    assert.equal(context.isDirty, true);
    assert.equal(run('backupWorkspace()'), true);
  }
});
test('selected-module copy is globally callable and leaves the selection unchanged', async () => {
  const { context, $, run } = ui();
  $('moduleSelect').value = 'Saved module';
  let copied;
  context.navigator.clipboard = { writeText: async value => { copied = value; } };
  await run('copyCurrentModule()');
  assert.equal(copied, 'Saved module');
  assert.equal($('moduleSelect').value, 'Saved module');
});
test('dashboard groups actual report and studio data by project without inventing reports', () => {
  const { context, run } = ui();
  context.input = LocalWorkspace.empty(context.currentUser);
  context.input.projects = ['Project', 'Empty'];
  context.input.modulesMap = { Project: ['Login', 'Blank'], Empty: [] };
  context.input.records[LocalWorkspace.recordKey('Project', 'Login')] = {
    form: { desc: 'Report details', studioChangeSummary: 'Change details',
      studioScenarios: [{ desc: 'Scenario' }], studioTestCases: [{ id: 'TC_1' }, { id: 'TC_2' }] },
    images: { prod: [], exec: [], studio: [] }
  };
  const before = JSON.stringify(context.input);
  const projects = JSON.parse(run('JSON.stringify(dashboardProjectData(input))'));
  assert.equal(JSON.stringify(context.input), before);
  assert.deepEqual([projects[0].reports, projects[0].scenarios, projects[0].cases], [1, 1, 2]);
  assert.equal(projects[0].modules[0].reportDescription, 'Report details');
  assert.equal(projects[0].modules[0].studioDescription, 'Change details');
  assert.equal(projects[0].modules[1].report, false);
  assert.deepEqual(projects[1].modules, []);
});
test('dashboard renders closed projects with separate folders and real-content empty states', () => {
  const { context, $, run } = ui();
  function element(tag) {
    return {
      tag, children: [], dataset: {}, attributes: {}, textContent: '',
      append(...children) { this.children.push(...children); },
      replaceChildren() { this.children = []; },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener() {}
    };
  }
  const container = element('div');
  context.document.createElement = element;
  context.document.createTextNode = text => ({ textContent: text });
  context.$ = id => id === 'dashboardProjects' ? container : $(id);
  run(`localState.records[LocalWorkspace.recordKey('Project','Login')] = {
    form: { desc:'Actual report', studioScenarios:[{desc:'One scenario'}] }, images:{prod:[],exec:[],studio:[]}
  }; renderDashboardProjects();`);
  const project = container.children[0];
  assert.equal(project.tag, 'details');
  assert.notEqual(project.open, true);
  const folders = project.children[1].children;
  assert.deepEqual(folders.map(folder => folder.children[0].children[0].children[1].textContent), ['Reports', 'Test Scenarios', 'Test Cases']);
  assert.equal(folders[0].children[1].children.length, 1);
  assert.equal(folders[1].children[1].children.length, 1);
  assert.equal(folders[2].children[1].children[0].textContent, 'No test cases yet.');
});
test('dashboard direct open keeps edits when saving fails and opens the requested module otherwise', async () => {
  const { context, run } = ui();
  let opened = null;
  context.selectWorkspaceMode = mode => { opened = mode; };
  context.loadActiveModule = (project, module) => { context.selected = { project, module }; };
  run(`folderStore = { save: async () => { throw new Error('Save failed'); } };`);
  await run("openDashboardProjectItem('Project', 'Login', 'studio')");
  assert.equal(opened, null);
  assert.equal(context.isDirty, true);
  assert.equal(run("localState.records[LocalWorkspace.recordKey('Project','Login')].form.desc"), 'Retain this edit');
  run('folderStore = null;');
  await run("openDashboardProjectItem('Project', 'Login', 'studio')");
  assert.equal(opened, 'studio');
  assert.deepEqual(context.selected, { project: 'Project', module: 'Login' });
});
test('dashboard scenario and case folders open the matching Studio tab', async () => {
  const { context, $, run } = ui();
  const opened = [];
  context.selectWorkspaceMode = (mode, origin) => opened.push({ mode, origin });
  context.loadActiveModule = () => {};
  context.switchStudioTab = (tab, button) => opened.push({ tab, button });
  context.navigateWorkspaceSection = section => opened.push({ section });
  run('folderStore = null;');
  await run("openDashboardProjectItem('Project', 'Login', 'studio', { x: 620, y: 120 }, 'scenarios')");
  assert.equal(opened[0].mode, 'studio');
  assert.equal(opened[0].origin.x, 620);
  assert.equal(opened[1].tab, 'tabScenarios');
  assert.equal(opened[1].button, $('studioScenariosTab'));
  assert.equal(opened[2].section, 'secStudioOutput');
  opened.length = 0;
  await run("openDashboardProjectItem('Project', 'Login', 'studio', undefined, 'cases')");
  assert.equal(opened[1].tab, 'tabFunctionalCases');
  assert.equal(opened[1].button, $('studioCasesTab'));
});
test('activity timeline sorts a copy and preserves stored entries', () => {
  const { context, $, run } = ui();
  const container = { children: [], replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } };
  context.$ = id => id === 'historyLogsContainer' ? container : $(id);
  context.document.createElement = tag => ({
    tag, children: [], append(...children) { this.children.push(...children); }
  });
  run(`localState.history = [
    {time:'2025-01-01T10:00:00Z', action:'Earlier', project:'Project', module:'Login'},
    {time:'2026-01-01T10:00:00Z', action:'Later', project:'Project', module:'Login'}
  ]; renderHistoryTimeline();`);
  assert.equal(container.children[0].children[1].textContent, 'Later');
  assert.equal(container.children[1].children[1].textContent, 'Earlier');
  assert.equal(run('localState.history[0].action'), 'Earlier');
});
test('image preview waits two seconds and cancels when hover ends', () => {
  const { context, $, run } = ui();
  const timers = new Map(), classes = new Set();
  let nextTimer = 0;
  context.innerWidth = 1000; context.innerHeight = 800;
  context.setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; };
  context.clearTimeout = id => timers.delete(id);
  $('imageHoverPreview').classList = { add: name => classes.add(name), remove: name => classes.delete(name) };
  context.image = { isConnected:true, currentSrc:'data:image/png;base64,abc', getBoundingClientRect: () => ({left:100,right:230,top:50}) };
  run('showImageHoverPreview(image)');
  assert.equal(timers.get(1).delay, 2000);
  assert.equal(classes.has('active'), false);
  run('hideImageHoverPreview()');
  assert.equal(timers.has(1), false);
  run('showImageHoverPreview(image)');
  timers.get(2).callback();
  assert.equal(classes.has('active'), true);
  assert.equal($('imageHoverPreviewImage').src, 'data:image/png;base64,abc');
  run('hideImageHoverPreview()');
  assert.equal(classes.has('active'), false);
});
test('select menus meet the control edge and match its width without a reserved gap', () => {
  const { context, run } = ui();
  const properties = {};
  const select = {
    getBoundingClientRect: () => ({ left: 42, bottom: 240, width: 378 }),
    style: { setProperty: (name, value) => { properties[name] = value; } }
  };
  context.innerHeight = 800;
  context.event = { target: { closest: () => select } };
  run('sizeSelectPicker(event)');
  assert.equal(properties['--select-top'], '239px');
  assert.equal(properties['--select-left'], '42px');
  assert.equal(properties['--select-width'], '378px');
  assert.equal(properties['--select-space'], '540px');
});
test('real workspace operations show and clear busy and indeterminate save indicators',()=>{
  const {context,$,run}=ui();
  context.window.isSecureContext=true;context.window.showDirectoryPicker=()=>{};
  run("setWorkspaceBusy(true);setStorageStatus('saving','Saving...');");
  assert.equal($('workspaceBusyIndicator').hidden,false);
  assert.equal($('mainAppShell').inert,true);
  assert.equal($('saveProgress').hidden,false);
  assert.equal($('storageIcon').dataset.loading,'true');
  run("setWorkspaceBusy(false);setStorageStatus('error','Not saved. Edits kept.');");
  assert.equal($('workspaceBusyIndicator').hidden,true);
  assert.equal($('mainAppShell').inert,false);
  assert.equal($('saveProgress').hidden,true);
  assert.equal($('storageIcon').dataset.loading,'false');
  assert.equal($('storageMessage').textContent,'Not saved. Edits kept.');
});
test('metrics save requires a connected folder and never silently falls back',async()=>{
  const {run}=ui();
  await assert.rejects(run("saveProjectMetrics('Project','Project_2026-01_qualitymetrics.xlsx',new Uint8Array([80,75]),{})"),/Choose or reconnect/);
});
test('unsupported and insecure contexts explain folder limits while keeping backup actions available', async () => {
  const { context, $, run } = ui();
  context.window.isSecureContext = true;
  context.window.showDirectoryPicker = undefined;
  assert.equal(run('folderAccessAvailability().reason'), 'unsupported-api');
  await run('findRememberedFolder()');
  assert.equal($('connectFolderButton').disabled, true);
  assert.match($('storageMessage').textContent, /HTTPS alone cannot add this feature/);
  assert.equal(typeof run('backupWorkspace'), 'function');
  assert.equal(typeof run('mergeImportedWorkspace'), 'function');
  context.window.isSecureContext = false;
  context.window.showDirectoryPicker = () => {};
  assert.equal(run('folderAccessAvailability().reason'), 'insecure-context');
});
test('memory-only edits do not schedule fake autosaves and Ctrl+S action downloads a backup', async () => {
  const { context, $, downloads, readBackup, run } = ui();
  context.prodImages = ['data:image/png;base64,aGVsbG8='];
  run('folderStore = null; markUnsaved();');
  assert.equal(context.isDirty, true);
  assert.equal(context.autoSaveTimer, null);
  assert.match($('storageMessage').textContent, /only in memory/);
  assert.equal(await run('saveWorkspaceNow()'), true);
  assert.deepEqual(downloads, ['download']);
  assert.equal(context.isDirty, true);
  assert.match($('storageMessage').textContent, /backup was downloaded.*remain in memory/i);
  const backup = await readBackup();
  const record = backup.records[LocalWorkspace.recordKey('Project', 'Login')];
  assert.equal(backup.owner.email, 'qa@example.com');
  assert.equal(record.owner.email, 'qa@example.com');
  assert.deepEqual(Array.from(record.images.prod), ['data:image/png;base64,aGVsbG8=']);
  context.backupForImport = backup;
  await run('mergeImportedWorkspace(backupForImport)');
  assert.equal(run("localState.records[LocalWorkspace.recordKey('Project','Login')].owner.email"), 'qa@example.com');
  assert.equal(run("localState.records[LocalWorkspace.recordKey('Project','Login')].images.prod[0]"), 'data:image/png;base64,aGVsbG8=');
});
test('folder picker cancellation and permission denial are distinct and retain the draft', async () => {
  const { context, $, run } = ui();
  context.window.showDirectoryPicker = async () => { throw new DOMException('Cancelled', 'AbortError'); };
  await run('connectLocalFolder()');
  assert.match($('storageMessage').textContent, /selection was cancelled/);
  assert.equal(context.isDirty, true);
  context.window.showDirectoryPicker = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  await run('connectLocalFolder()');
  assert.match($('storageMessage').textContent, /access was denied/);
  assert.equal(context.isDirty, true);
});
test('a stale saved handle can be forgotten and the next attempt opens the picker', async () => {
  const { context, $, run } = ui();
  let pickerCalls = 0, deletes = 0;
  context.DOMException = DOMException;
  context.AbortController = AbortController;
  context.LocalWorkspace = { ...LocalWorkspace, FolderStore: class {
    async load() { throw new DOMException('Moved folder', 'NotFoundError'); }
  } };
  context.window.showDirectoryPicker = async () => { pickerCalls++; throw new DOMException('Cancelled', 'AbortError'); };
  context.forget = async mode => { if (mode === 'delete') deletes++; };
  run(`handleCache = forget;
    rememberedHandle = { name: 'Old folder', requestPermission: async () => 'granted' };
    folderStore = null;`);
  await run('connectLocalFolder()');
  assert.equal($('forgetFolderButton').hidden, false);
  assert.equal(run('workspaceBusy'), false);
  assert.equal(run('rememberedHandle'), null);
  await run('connectLocalFolder()');
  assert.equal(pickerCalls, 1);
  await run('forgetSavedFolder()');
  assert.equal(deletes, 1);
  assert.equal(run('rememberedHandle'), null);
  assert.equal($('connectFolderButton').textContent, 'Choose folder');
  assert.equal(run("localState.records[LocalWorkspace.recordKey('Project','Login')].form.desc"), 'Retain this edit');
  await run('connectLocalFolder()');
  assert.equal(pickerCalls, 2);
});
test('manual folder opening times out, unlocks editing and ignores late loaded data', async () => {
  const { context, $, run } = ui();
  context.setTimeout = setTimeout;
  let finishLoad;
  context.LocalWorkspace = { ...LocalWorkspace, FolderStore: class {
    load() { return new Promise(resolve => { finishLoad = resolve; }); }
    save() { throw new Error('A timed-out connection must not save'); }
  } };
  context.window.showDirectoryPicker = async () => ({ name: 'Slow folder' });
  await run('connectLocalFolder(5)');
  assert.equal(run('workspaceBusy'), false);
  assert.equal($('mainAppShell').inert, false);
  assert.match($('storageMessage').textContent, /Opening the folder.*taking too long/);
  finishLoad(LocalWorkspace.empty(context.currentUser));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(run('folderStore'), null);
  assert.equal(run('localState.projects[0]'), 'Project');
  assert.equal(context.isDirty, true);
});
test('an incomplete remembered workspace reports missing data and allows choosing another folder', async () => {
  const { context, $, run } = ui();
  context.LocalWorkspace = { ...LocalWorkspace, FolderStore: class {
    async load() {
      throw Object.assign(new Error('This workspace is incomplete: a saved module record is missing.'), { name: 'WorkspaceIncompleteError' });
    }
  } };
  run(`handleCache = async () => ({ name: 'Incomplete folder', queryPermission: async () => 'granted' });`);
  await run('restoreRememberedFolder()');
  assert.equal(run('rememberedHandle'), null);
  assert.equal($('forgetFolderButton').hidden, false);
  assert.match($('storageMessage').textContent, /workspace is incomplete/);
  assert.doesNotMatch($('storageMessage').textContent, /folder could not be found/);
  let pickerCalls = 0;
  context.window.showDirectoryPicker = async () => { pickerCalls++; throw new DOMException('Cancelled', 'AbortError'); };
  await run('connectLocalFolder()');
  assert.equal(pickerCalls, 1);
  assert.equal(run('workspaceBusy'), false);
});
test('failure to remember a saved folder cannot leave the app globally busy', async () => {
  const { context, $, run } = ui();
  context.setTimeout = setTimeout;
  let saved = false, aborted = false;
  context.LocalWorkspace = { ...LocalWorkspace, FolderStore: class {
    constructor(handle) { this.handle = handle; }
    async load() { return LocalWorkspace.empty(context.currentUser); }
    async save() { saved = true; }
  } };
  context.window.showDirectoryPicker = async () => ({ name: 'Selected folder' });
  context.pendingCache = (mode, value, signal) => new Promise((resolve, reject) => {
    assert.equal(mode, 'put');
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('Cancelled')); }, { once: true });
  });
  run('handleCache = pendingCache;');
  await run('connectLocalFolder(5)');
  assert.equal(saved, true);
  assert.equal(aborted, true);
  assert.equal(run('workspaceBusy'), false);
  assert.equal(run('folderStore.handle.name'), 'Selected folder');
  assert.equal(context.isDirty, false);
  assert.match($('storageMessage').textContent, /Folder connected and saved.*could not remember/);
});
test('a failed replacement folder leaves the healthy current folder connected', async () => {
  const { context, $, run } = ui();
  context.isDirty = false;
  const selected = { name: 'Incomplete workspace' };
  context.window.showDirectoryPicker = async () => selected;
  context.LocalWorkspace = { ...LocalWorkspace, FolderStore: class {
    async load() { throw Object.assign(new Error('This workspace is incomplete: saved screenshots or evidence is missing.'), { name: 'WorkspaceIncompleteError' }); }
  } };
  run('folderStore = { handle: { name: "Working folder" } }; rememberedHandle = folderStore.handle;');
  await run('connectLocalFolder()');
  assert.equal(run('folderStore.handle.name'), 'Working folder');
  assert.equal(run('rememberedHandle.name'), 'Working folder');
  assert.equal(run('folderNeedsReconnect'), false);
  assert.equal(context.isDirty, false);
  assert.match($('storageMessage').textContent, /Current folder unchanged.*incomplete/);
  assert.equal(run('workspaceBusy'), false);
});
test('slow remembered-folder restore unlocks and ignores a late folder load', async () => {
  const { context, $, run } = ui();
  context.setTimeout = setTimeout;
  let finishLoad;
  context.LocalWorkspace = { ...LocalWorkspace, FolderStore: class {
    load() { return new Promise(resolve => { finishLoad = resolve; }); }
  } };
  run(`handleCache = async () => ({ name: 'Slow folder', queryPermission: async () => 'granted' });`);
  await run('restoreRememberedFolder(5)');
  assert.match($('storageMessage').textContent, /taking too long/i);
  assert.equal($('forgetFolderButton').hidden, false);
  finishLoad(LocalWorkspace.empty({ username: 'QA', email: 'qa@example.com' }));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(run("localState.projects[0]"), 'Project');
  assert.equal(run('folderStore'), null);
});
test('failed or timed-out handle deletion keeps recovery visible without discarding edits', async () => {
  const { context, $, run } = ui();
  context.setTimeout = setTimeout;
  context.AbortController = AbortController;
  let aborted = false;
  context.pendingDelete = (mode, value, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('Cancelled')); }, { once: true });
  });
  run('folderRecoveryNeeded = true; handleCache = pendingDelete;');
  await run('forgetSavedFolder(5)');
  assert.equal(aborted, true);
  assert.equal($('forgetFolderButton').hidden, false);
  assert.match($('storageMessage').textContent, /Could not forget/);
  assert.equal(run("localState.records[LocalWorkspace.recordKey('Project','Login')].form.desc"), 'Retain this edit');
});
test('a timed-out database open cannot later delete a newly remembered folder', async () => {
  const { context, run } = ui();
  context.setTimeout = setTimeout;
  context.AbortController = AbortController;
  context.DOMException = DOMException;
  let delayedOpen, savedHandle = { name: 'Old folder' };
  const db = {
    close() {},
    transaction() {
      const tx = {
        objectStore() {
          return {
            put(value) {
              const request = {};
              setTimeout(() => { savedHandle = value; tx.oncomplete(); }, 0);
              return request;
            },
            delete() {
              const request = {};
              setTimeout(() => { savedHandle = null; tx.oncomplete(); }, 0);
              return request;
            }
          };
        }
      };
      return tx;
    }
  };
  let opens = 0;
  context.indexedDB = { open() {
    const request = { result: db };
    if (++opens === 1) delayedOpen = () => request.onsuccess();
    else setTimeout(() => request.onsuccess(), 0);
    return request;
  } };
  run('folderRecoveryNeeded = true;');
  await run('forgetSavedFolder(5)');
  context.newHandle = { name: 'New folder' };
  await run("handleCache('put', newHandle)");
  delayedOpen();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(savedHandle.name, 'New folder');
  assert.equal(run('workspaceBusy'), false);
});
test('a folderless save attempt retains state as dirty instead of silently clearing it', async () => {
  const { context, $, run } = ui();
  context.isDirty = false;
  assert.equal(await run('performSaveNow()'), false);
  assert.equal(context.isDirty, true);
  assert.match($('storageMessage').textContent, /only in memory/);
});
test('importing a workspace in memory marks it unsaved and retains screenshots and attribution', async () => {
  const { context, run } = ui();
  context.imported = LocalWorkspace.empty({ username: 'Original', email: 'original@example.com' });
  context.imported.projects = ['Imported']; context.imported.modulesMap = { Imported: ['Checkout'] };
  context.imported.active = { project: 'Imported', module: 'Checkout' };
  context.imported.records[LocalWorkspace.recordKey('Imported', 'Checkout')] = {
    form: { project: 'Imported', module: 'Checkout', studioTestCases: [{ id: 'TC_1', type: 'Functional', status: 'Not Run' }] },
    images: { prod: ['data:image/png;base64,aGVsbG8='], exec: [], studio: [] },
    owner: { username: 'Original', email: 'original@example.com' }, updatedAt: '2026-01-01T00:00:00.000Z'
  };
  await run('mergeImportedWorkspace(imported)');
  assert.equal(context.isDirty, true);
  assert.equal(run("localState.records[LocalWorkspace.recordKey('Imported','Checkout')].owner.email"), 'original@example.com');
  assert.equal(run("localState.records[LocalWorkspace.recordKey('Imported','Checkout')].images.prod[0]"), 'data:image/png;base64,aGVsbG8=');
});
test('metrics saves are queued after workspace save and create a new project without clearing module edits',async()=>{
  const {context,run}=ui();context.calls=[];
  run(`folderStore={
    save: async data => calls.push(['workspace',data.projects]),
    saveMetrics: async (project,filename,bytes,draft) => {
      if(!(bytes instanceof Uint8Array))throw Error('Incorrect bytes');
      calls.push(['metrics',project,filename,draft.month]);return 'saved/path';
    }
  };`);
  assert.equal(await run("saveProjectMetrics('New Project','New_Project_2026-01_qualitymetrics.xlsx',new Uint8Array([80,75]),{month:'2026-01'})"),'saved/path');
  assert.deepEqual(Array.from(context.calls,call=>call[0]),['workspace','metrics']);
  assert.equal(run("localState.projects.includes('New Project')"),true);
  assert.equal(run("Object.values(localState.records)[0].form.desc"),'Retain this edit');
  assert.equal(run('workspaceBusy'),false);
});
test('failed metrics write releases busy state without claiming success',async()=>{
  const {run}=ui();
  run("folderStore={save:async()=>{},saveMetrics:async()=>{throw new Error('Metrics disk full');}};");
  await assert.rejects(run("saveProjectMetrics('Project','Project_2026-01_qualitymetrics.xlsx',new Uint8Array([80,75]),{})"),/Metrics disk full/);
  assert.equal(run('workspaceBusy'),false);
  assert.equal(run("Object.values(localState.records)[0].form.desc"),'Retain this edit');
});
test('workspace search matches real projects modules test IDs status and scenario text without mutating data',()=>{
  const {run}=ui();
  run(`localState.records[LocalWorkspace.recordKey('Project','Login')]={
    form:{project:'Project',module:'Login',
      studioTestCases:[{id:'TC_7',scenario:'Submit request',steps:'Open form',expected:'Confirmation shown',status:'Fail',type:'Regression'}],
      studioScenarios:[{id:'SC_1',desc:'Recover interrupted submission',cat:'Functional',pri:'High'}]
    }
  };`);
  const baseline=run('JSON.stringify(localState)');
  const find=query=>JSON.parse(run(`JSON.stringify(workspaceSearchResults(localState,${JSON.stringify(query)}))`));
  assert.equal(find('project')[0].type,'Project');
  assert.equal(find('login')[0].type,'Module');
  assert.equal(find('tc_7 confirmation fail')[0].type,'Test case');
  assert.equal(find('recover high')[0].type,'Scenario');
  assert.equal(find('Login regression')[0].title,'TC_7 · Submit request');
  assert.deepEqual(find('no-such-value'),[]);
  assert.deepEqual(find('  '),[]);
  assert.equal(run('JSON.stringify(localState)'),baseline);
});
test('search overlays unsaved active module values and includes project-overview records',()=>{
  const {run}=ui();
  run(`localState.records[LocalWorkspace.recordKey('Project','')]={
    form:{project:'Project',module:'',studioScenarios:[{id:'SC_Overview',desc:'Project overview flow'}]}
  };
  localState.records[LocalWorkspace.recordKey('Project','Login')]={
    form:{project:'Project',module:'Login',studioTestCases:[{id:'old',scenario:'Stale saved text'}]}
  };`);
  const active=`{project:'Project',module:'Login',studioTestCases:[{id:'new',scenario:'Unsaved live text'}]}`;
  assert.equal(run(`workspaceSearchResults(localState,'unsaved',${active})[0].title`),'new · Unsaved live text');
  assert.equal(run(`workspaceSearchResults(localState,'stale',${active}).length`),0);
  assert.equal(run("workspaceSearchResults(localState,'overview')[0].module"),'');
});
test('search rejects stale results and failed save-before-switch retains current context and edits',async()=>{
  const {run}=ui();
  await assert.rejects(run("openWorkspaceSearchResult({project:'Removed',module:'',type:'Project'})"),/no longer/);
  run("folderStore={save:async()=>{throw new Error('Disk full');}};");
  await assert.rejects(run("openWorkspaceSearchResult({project:'Project',module:'Login',type:'Module'})"),/Not saved/);
  assert.equal(run('activeContext.module'),'Login');
  assert.equal(run('workspaceBusy'),false);
  assert.equal(run("Object.values(localState.records)[0].form.desc"),'Retain this edit');
});
