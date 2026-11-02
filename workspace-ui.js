'use strict';
let localState = null, folderStore = null, rememberedHandle = null, activeContext = null;
let workspaceBusy = false, editRevision = 0, saveQueue = Promise.resolve();
const formFields = {
  mantisId: 'mantisId', buildVersion: 'build', testUrl: 'url', loginRef: 'login',
  featureDesc: 'desc', correctionNotes: 'correction', execSteps: 'steps', actualResult: 'res',
  studioScopeType: 'studioScopeType', studioUiElements: 'studioUiElements',
  studioImpactedAreas: 'studioImpactedAreas', studioChangeSummary: 'studioChangeSummary'
};
const initialFields = Object.fromEntries(Object.keys(formFields).map(id => [id, $(id).value]));
const copy = value => JSON.parse(JSON.stringify(value));

function setStorageStatus(state, message) {
  $('storageBanner').dataset.state = state;
  $('folderPanel').dataset.state = state;
  $('storageMessage').textContent = message;
  $('folderDescription').textContent = message;
  $('storageIcon').textContent = { saving: 'sync', saved: 'task_alt', error: 'error', pending: 'edit_note' }[state] || 'folder_open';
}
function storageFailure(error) {
  console.error('Local workspace operation failed', error);
  setBadgeState('error');
  setStorageStatus('error', `Not saved. ${error.message || error.name} Retry or back up.`);
  showToast(error.message || 'Local folder operation failed.', 'error');
}
function setWorkspaceBusy(busy) {
  workspaceBusy = busy;
  $('mainAppShell').inert = busy;
  $('dashboardSelectOverlay').inert = busy;
  document.querySelectorAll('#projectModal, #moduleModal').forEach(el => { el.inert = busy; });
  $('connectFolderButton').disabled = busy || !window.isSecureContext || !window.showDirectoryPicker;
  $('disconnectFolderButton').disabled = busy || (!folderStore && !rememberedHandle);
}
async function handleCache(mode, value) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('qa_local_folder_handles', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', mode === 'get' ? 'readonly' : 'readwrite');
      const request = mode === 'get' ? tx.objectStore('handles').get(currentUser.email) :
        mode === 'delete' ? tx.objectStore('handles').delete(currentUser.email) : tx.objectStore('handles').put(value, currentUser.email);
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Folder-handle transaction aborted.'));
    });
  } finally { db.close(); }
}
function captureModule() {
  if (!localState || !activeContext?.project) return;
  const form = collectData();
  form.project = activeContext.project; form.module = activeContext.module;
  const key = LocalWorkspace.recordKey(form.project, form.module);
  const images = { prod: [...prodImages], exec: [...execImages], studio: [...studioImages] };
  const previous = localState.records[key];
  if (previous && JSON.stringify(previous.form) === JSON.stringify(form) && JSON.stringify(previous.images) === JSON.stringify(images)) return;
  localState.records[key] = { form: copy(form), images, owner: copy(currentUser), updatedAt: new Date().toISOString() };
}
function snapshotWorkspace() {
  if (!localState) throw new Error('Choose a local profile first.');
  captureModule();
  return copy(localState);
}
function loadActiveModule(project, module, cleared = false) {
  activeContext = project ? { project, module } : null;
  localState.active = activeContext;
  const record = !cleared && activeContext ? localState.records[LocalWorkspace.recordKey(project, module)] : null;
  const form = record?.form || {};
  Object.entries(formFields).forEach(([id, field]) => { $(id).value = form[field] ?? initialFields[id]; });
  $('defectTableBody').innerHTML = '';
  (form.defects || []).forEach(defect => addDefectRow(defect, true));
  studioScenarios = copy(form.studioScenarios || []);
  studioTestCases = copy(form.studioTestCases || []);
  guardChecklists = copy(form.guardChecklists || { reqMatch: [], exploratory: [], regression: [] });
  prodImages = [...(record?.images.prod || [])]; execImages = [...(record?.images.exec || [])]; studioImages = [...(record?.images.studio || [])];
  ['prod', 'exec', 'studio'].forEach(renderImages);
  renderStudioOutputs(); checkDefectCount(true); applyAria();
  $('viewReport').inert = !activeContext;
  $('viewStudio').inert = !activeContext;
  $('loginRef').disabled = !activeContext;
  $('projectEmptyHint').hidden = !!activeContext;
}
function applyWorkspaceState() {
  const context = localState.active;
  populateProjectDropdown(context?.project);
  populateModuleDropdown(context?.module);
  loadActiveModule($('projectSelect').value, $('moduleSelect').value);
  $('profileChip').textContent = currentUser.username;
}
async function performSaveNow(manual = false) {
  clearTimeout(autoSaveTimer); autoSaveTimer = null;
  if (!folderStore) {
    setBadgeState('error');
    setStorageStatus('error', 'Not saved. Choose a folder or back up.');
    if (manual) showToast('Connect a local folder before saving.', 'error');
    return false;
  }
  let snapshot;
  try { snapshot = snapshotWorkspace(); }
  catch (error) { storageFailure(error); return false; }
  const version = editRevision, target = folderStore;
  setBadgeState('saving'); setStorageStatus('saving', 'Saving...');
  const operation = async () => {
    const write = () => target.save(snapshot);
    if (navigator.locks) await navigator.locks.request(`qa-local-${currentUser.email}`, write);
    else await write();
  };
  const pending = saveQueue.then(operation);
  saveQueue = pending.catch(() => {});
  try {
    await pending;
    if (version === editRevision) {
      isDirty = false; setBadgeState('saved');
      setStorageStatus('saved', 'Saved');
    } else {
      setBadgeState('pending');
      setStorageStatus('pending', 'Unsaved changes');
    }
    if (manual) showToast('Saved to local folder');
    return true;
  } catch (error) { isDirty = true; storageFailure(error); return false; }
}
async function flushBeforeSwitch() {
  if (!isDirty) return true;
  if (!folderStore) { captureModule(); return true; }
  return performSaveNow();
}
async function changeModule(projectChanged) {
  const requested = { project: $('projectSelect').value, module: $('moduleSelect').value };
  if (workspaceBusy) return;
  setWorkspaceBusy(true);
  try {
    if (!await flushBeforeSwitch()) {
      populateProjectDropdown(activeContext?.project); populateModuleDropdown(activeContext?.module); return;
    }
    if (projectChanged) { populateModuleDropdown(); requested.module = $('moduleSelect').value; }
    loadActiveModule(requested.project, requested.module);
  } finally { setWorkspaceBusy(false); }
  recordUserHistory('Opened project / module');
}
async function openFolderHandle(handle) {
  const candidate = new LocalWorkspace.FolderStore(handle, currentUser);
  const loaded = await candidate.load();
  const draft = isDirty ? snapshotWorkspace() : null;
  if (draft && !folderStore && !loaded.projects.length) {
    if (navigator.locks) await navigator.locks.request(`qa-local-${currentUser.email}`, () => candidate.save(draft));
    else await candidate.save(draft);
    localState = draft;
  } else {
    if (draft && !confirm('This folder already has workspace data. Opening it replaces the in-memory view. Cancel and download a backup first if you need your current edits.')) return false;
    localState = loaded;
  }
  folderStore = candidate; rememberedHandle = handle;
  $('disconnectFolderButton').disabled = false;
  applyWorkspaceState(); isDirty = false; setBadgeState('saved');
  $('connectFolderButton').textContent = 'Change folder';
  $('connectedFolderName').textContent = `Folder: ${handle.name}`;
  setStorageStatus('saved', 'Folder connected');
  return true;
}
async function findRememberedFolder() {
  if (!window.isSecureContext || !window.showDirectoryPicker) {
    $('connectFolderButton').disabled = true;
    setStorageStatus('error', 'Folder access unavailable. Use Chrome / Edge on localhost or HTTPS, or use backups.');
    return;
  }
  try {
    rememberedHandle = await handleCache('get');
    if (!rememberedHandle) {
      setStorageStatus('pending', 'Choose a folder to save.');
      return;
    }
    if (await rememberedHandle.queryPermission({ mode: 'readwrite' }) === 'granted') await openFolderHandle(rememberedHandle);
    else {
      $('connectFolderButton').textContent = 'Reconnect folder';
      $('connectedFolderName').textContent = `Folder: ${rememberedHandle.name}`;
      setStorageStatus('pending', 'Permission needed. Reconnect folder.');
    }
  } catch (error) {
    rememberedHandle = null;
    $('connectFolderButton').textContent = 'Choose folder';
    setStorageStatus('error', 'Could not reopen folder. Choose it again.');
  }
}
async function connectLocalFolder() {
  if (!currentUser || workspaceBusy) return;
  setWorkspaceBusy(true);
  try {
    // Permission requests and pickers run directly in the user gesture, before any save awaits.
    let handle;
    if (rememberedHandle && !folderStore) {
      handle = rememberedHandle;
      if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
        rememberedHandle = null; $('connectFolderButton').textContent = 'Choose folder';
        throw new Error('Permission denied. Choose folder again.');
      }
    } else handle = await window.showDirectoryPicker({ id: 'qa-workspace-root', mode: 'readwrite' });
    if (folderStore && isDirty && !await performSaveNow()) return;
    if (!await openFolderHandle(handle)) return;
    try { await handleCache('put', handle); }
    catch (error) { console.error('Could not remember folder', error); setStorageStatus('pending', 'Connected. Choose this folder again next time.'); }
  } catch (error) {
    if (error.name === 'AbortError') setStorageStatus('pending', 'Folder selection cancelled.');
    else {
      if (!folderStore) { rememberedHandle = null; $('connectFolderButton').textContent = 'Choose folder'; }
      storageFailure(error);
    }
  } finally { setWorkspaceBusy(false); }
}
async function disconnectLocalFolder() {
  if (workspaceBusy || (!folderStore && !rememberedHandle)) return;
  setWorkspaceBusy(true);
  try {
    clearTimeout(autoSaveTimer); autoSaveTimer = null;
    await saveQueue;
    captureModule();
    folderStore = null; rememberedHandle = null;
    isDirty = true; editRevision++; setBadgeState('pending');
    $('connectFolderButton').textContent = 'Choose folder';
    $('connectedFolderName').textContent = 'No folder selected.';
    setStorageStatus('pending', 'Disconnected. Edits kept in memory. Choose a folder or back up.');
    try { await handleCache('delete'); }
    catch (error) { console.error('Could not forget folder', error); setStorageStatus('error', 'Edits kept. Folder may reconnect on refresh; back up before closing.'); }
  } finally { setWorkspaceBusy(false); }
}
function backupWorkspace() {
  try {
    const data = snapshotWorkspace();
    const blob = new Blob([JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `qa-workspace-${currentUser.email.replace(/[^a-z0-9]/gi, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    showToast('Backup download started');
  } catch (error) { storageFailure(error); }
}
function convertLegacy(data) {
  if (!data || !data.form || !Array.isArray(data.projects)) throw new Error('Not a supported workspace backup.');
  const result = LocalWorkspace.empty(currentUser);
  result.projects = [...data.projects];
  const project = data.form.project || result.projects[0];
  if (!project) throw new Error('The old workspace has no project.');
  if (!result.projects.includes(project)) result.projects.push(project);
  result.modulesMap = Object.fromEntries(result.projects.map(p => [p, [...(data.modulesMap?.[p] || [])]]));
  const module = data.form.module || '';
  if (module && !result.modulesMap[project].includes(module)) result.modulesMap[project].push(module);
  result.active = { project, module };
  result.records[LocalWorkspace.recordKey(project, module)] = {
    form: { ...data.form, project, module }, images: data.images || { prod: [], exec: [], studio: [] },
    owner: copy(currentUser), updatedAt: new Date().toISOString()
  };
  return LocalWorkspace.validate(result);
}
async function mergeImportedWorkspace(imported) {
  LocalWorkspace.validate(imported);
  if (!confirm(`Import ${imported.projects.length} project(s) into ${currentUser.email}? Matching project/module records will be replaced; other records are kept. Imported records retain their original attribution. Download a backup first if needed.`)) return;
  captureModule();
  const next = copy(localState);
  for (const project of imported.projects) {
    if (!next.projects.includes(project)) next.projects.push(project);
    const modules = Object.hasOwn(next.modulesMap, project) ? next.modulesMap[project] : [];
    Object.defineProperty(next.modulesMap, project, { value: [...new Set([...modules, ...imported.modulesMap[project]])], writable: true, enumerable: true, configurable: true });
  }
  Object.assign(next.records, imported.records);
  next.history = [...imported.history, ...next.history].slice(0, 100);
  next.active = imported.active || next.active;
  LocalWorkspace.validate(next);
  localState = next; applyWorkspaceState();
  recordUserHistory(`Imported workspace attributed to ${imported.owner.email}`);
  if (folderStore) await performSaveNow(true);
  else setStorageStatus('pending', 'Imported. Choose a folder or back up to keep it.');
}
async function importBrowserWorkspace() {
  if (!currentUser || workspaceBusy) return;
  setWorkspaceBusy(true);
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) throw new Error('No old browser workspace was found on this origin. Import a JSON backup if it came from another browser or URL.');
    const form = JSON.parse(saved);
    const images = { prod: await idbGet('prod') || [], exec: await idbGet('exec') || [], studio: await idbGet('studio') || [] };
    const data = convertLegacy({
      form, projects: JSON.parse(localStorage.getItem(PROJECTS_KEY) || 'null') || [...defaultProjects],
      modulesMap: JSON.parse(localStorage.getItem(MODULES_MAP_KEY) || 'null') || defaultModulesMap, images
    });
    data.history = JSON.parse(localStorage.getItem(`qa_history_${currentUser.email}`) || '[]');
    await mergeImportedWorkspace(data);
  } catch (error) { storageFailure(error); }
  finally { setWorkspaceBusy(false); }
}
$('restoreInput').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = '';
  if (!file || workspaceBusy) return;
  setWorkspaceBusy(true);
  try {
    const data = JSON.parse(await file.text());
    await mergeImportedWorkspace(data.version === 3 ? data : convertLegacy(data));
  } catch (error) { storageFailure(new Error(`Import failed: ${error.message}. Source data was not modified.`)); }
  finally { setWorkspaceBusy(false); }
});
window.onload = async function () {
  applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');
  document.querySelectorAll(Object.keys(formFields).map(id => `#${id}`).join(',')).forEach(el => {
    if (el.id !== 'studioScopeType') el.addEventListener('input', markUnsaved);
  });
  try {
    const saved = localStorage.getItem(ACTIVE_USER_KEY);
    if (saved) {
      const profile = JSON.parse(saved);
      if (typeof profile.username !== 'string' || typeof profile.email !== 'string' || !/^\S+@\S+\.\S+$/.test(profile.email)) throw new Error('Invalid remembered profile.');
      currentUser = { username: profile.username, email: profile.email.toLowerCase() };
      localState = LocalWorkspace.empty(currentUser);
      applyWorkspaceState();
      $('authOverlay').style.display = 'none';
      $('welcomeUserTitle').textContent = `Welcome back, ${currentUser.username}!`;
      $('dashboardSelectOverlay').classList.add('active');
      setWorkspaceBusy(true);
      try { await findRememberedFolder(); } finally { setWorkspaceBusy(false); }
    }
  } catch (error) { showToast(`Could not restore the browser profile: ${error.message}`, 'error'); }
  if (!window.isSecureContext || !window.showDirectoryPicker) $('connectFolderButton').disabled = true;
  applyAria();
};
