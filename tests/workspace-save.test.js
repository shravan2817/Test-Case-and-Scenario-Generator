const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const LocalWorkspace = require('../local-workspace.js');

function ui() {
  const nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', dataset: {}, style: {}, textContent: '', classList: { add() {} }, addEventListener() {} });
    return nodes.get(id);
  };
  const context = vm.createContext({
    $, LocalWorkspace, currentUser: { username: 'QA', email: 'qa@example.com' },
    document: { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } }, window: { addEventListener() {} }, navigator: {},
    console: { error() {} }, clearTimeout, setTimeout, autoSaveTimer: null,
    isDirty: true, prodImages: [], execImages: [], studioImages: [],
    collectData: () => ({ project: 'Project', module: 'Login', desc: 'Retain this edit' }),
    populateProjectDropdown() {}, populateModuleDropdown() {}, markUnsaved() { context.isDirty = true; },
    setBadgeState(state) { context.badge = state; }, showToast() {}
  });
  vm.runInContext(readFileSync(join(__dirname, '..', 'workspace-ui.js'), 'utf8'), context);
  vm.runInContext(`
    localState = LocalWorkspace.empty(currentUser);
    localState.projects = ['Project']; localState.modulesMap = { Project: ['Login'] };
    activeContext = { project: 'Project', module: 'Login' };
  `, context);
  return { context, $, run: code => vm.runInContext(code, context) };
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
  assert.equal($('storageMessage').textContent, 'Not saved. Folder changed during saving. Edits kept. Back up, then reconnect.');
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
