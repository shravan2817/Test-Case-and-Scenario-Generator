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
    if (!nodes.has(id)) nodes.set(id, { value: '', dataset: {}, style: {}, textContent: '', classList: { add() {} }, addEventListener() {} });
    return nodes.get(id);
  };
  const context = vm.createContext({
    $, LocalWorkspace, currentUser: { username: 'QA', email: 'qa@example.com' },
    document: {
      addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, body: { append() {} },
      createElement() { return { click() { downloads.push('download'); }, remove() {} }; }
    },
    window: { isSecureContext: true, showDirectoryPicker() {}, addEventListener() {} }, navigator: {},
    console: { error() {} }, clearTimeout, setTimeout: () => 1, autoSaveTimer: null, Blob,
    URL: { createObjectURL(blob) { downloadedBlob = blob; return 'blob:backup'; }, revokeObjectURL() {} },
    downloads, confirm: () => true, recordUserHistory() {},
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
test('selected-module copy is globally callable and leaves the selection unchanged', async () => {
  const { context, $, run } = ui();
  $('moduleSelect').value = 'Saved module';
  let copied;
  context.navigator.clipboard = { writeText: async value => { copied = value; } };
  await run('copyCurrentModule()');
  assert.equal(copied, 'Saved module');
  assert.equal($('moduleSelect').value, 'Saved module');
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
