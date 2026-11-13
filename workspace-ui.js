'use strict';
let localState = null, folderStore = null, rememberedHandle = null, activeContext = null;
let workspaceBusy = false, editRevision = 0, saveQueue = Promise.resolve(), folderNeedsReconnect = false;
let folderRecoveryNeeded = false, forgetFolderBusy = false;
const formFields = {
  mantisId: 'mantisId', buildVersion: 'build', testUrl: 'url', loginRef: 'login',
  featureDesc: 'desc', correctionNotes: 'correction', execSteps: 'steps', actualResult: 'res',
  studioScopeType: 'studioScopeType', studioUiElements: 'studioUiElements',
  studioImpactedAreas: 'studioImpactedAreas', studioChangeSummary: 'studioChangeSummary'
};
const initialFields = Object.fromEntries(Object.keys(formFields).map(id => [id, $(id).value]));
const copy = value => JSON.parse(JSON.stringify(value));

let imageHoverTimer = null;
// Wait for a deliberate hover, then show the whole image without covering pointer events.
function showImageHoverPreview(image) {
  hideImageHoverPreview();
  imageHoverTimer = setTimeout(() => {
    if (!image.isConnected) return;
    const preview = $('imageHoverPreview');
    $('imageHoverPreviewImage').src = image.currentSrc || image.src;
    const rect = image.getBoundingClientRect();
    const width = Math.min(420, innerWidth - 24), height = Math.min(320, innerHeight - 24);
    const left = rect.right + width + 12 <= innerWidth ? rect.right + 12 : rect.left - width - 12;
    preview.style.left = `${Math.max(12, Math.min(innerWidth - width - 12, left))}px`;
    preview.style.top = `${Math.max(12, Math.min(innerHeight - height - 12, rect.top))}px`;
    preview.classList.add('active');
    imageHoverTimer = null;
  }, 2000);
}
function hideImageHoverPreview() {
  clearTimeout(imageHoverTimer);
  imageHoverTimer = null;
  $('imageHoverPreview').classList.remove('active');
}
function makeImageZoomAccessible(image) {
  image.tabIndex = 0;
  image.setAttribute('role', 'button');
  image.setAttribute('aria-label', `Open ${image.alt || 'screenshot'}`);
  image.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); image.click(); }
  });
}
function isHoverPreviewImage(element) {
  return element?.matches?.('img:not(.doc-watermark):not(#zoomOverlayImg):not(#imageHoverPreviewImage)');
}
document.addEventListener('pointerover', event => {
  if (event.pointerType !== 'touch' && isHoverPreviewImage(event.target)) showImageHoverPreview(event.target);
});
document.addEventListener('pointerout', event => {
  if (isHoverPreviewImage(event.target)) hideImageHoverPreview();
});
document.addEventListener('focusin', event => {
  if (isHoverPreviewImage(event.target)) showImageHoverPreview(event.target);
});
document.addEventListener('focusout', event => {
  if (isHoverPreviewImage(event.target)) hideImageHoverPreview();
});
document.addEventListener('scroll', hideImageHoverPreview, true);
window.addEventListener('resize', hideImageHoverPreview);

function folderAccessAvailability() {
  if (!window.isSecureContext) {
    return {
      available: false,
      reason: 'insecure-context',
      message: 'Folder saving needs a secure page. Open this app on localhost or HTTPS. You can still edit, import a backup and download a backup here.'
    };
  }
  if (typeof window.showDirectoryPicker !== 'function') {
    return {
      available: false,
      reason: 'unsupported-api',
      message: 'This browser does not support choosing a workspace folder. HTTPS alone cannot add this feature. You can still edit, import a backup and download a backup here.'
    };
  }
  return { available: true, reason: 'supported', message: 'Choose a folder for autosave, or use JSON backups.' };
}
function updateFolderAccessButton() {
  const support = folderAccessAvailability();
  const button = $('connectFolderButton');
  button.disabled = workspaceBusy || forgetFolderBusy || !support.available;
  $('forgetFolderButton').hidden = !folderRecoveryNeeded && !folderNeedsReconnect;
  $('forgetFolderButton').disabled = workspaceBusy || forgetFolderBusy;
  button.title = support.available ? 'Choose a folder for workspace autosave' : support.message;
  if (!support.available) button.textContent = 'Folder saving unavailable';
  else if (folderNeedsReconnect || rememberedHandle && !folderStore) button.textContent = 'Reconnect folder';
  else if (folderStore) button.textContent = 'Change folder';
  else if (rememberedHandle) button.textContent = 'Reconnect folder';
  else button.textContent = 'Choose folder';
  return support;
}
function setStorageStatus(state, message) {
  $('storageBanner').dataset.state = state;
  $('folderPanel').dataset.state = state;
  $('storageMessage').textContent = message;
  $('folderDescription').textContent = message;
  $('storageSettingsButton').textContent = folderNeedsReconnect ? 'Reconnect folder' : 'Folder settings';
  $('storageIcon').textContent = { saving: 'sync', saved: 'task_alt', error: 'error', pending: 'edit_note' }[state] || 'folder_open';
  $('storageIcon').dataset.loading = String(state === 'saving');
  $('saveProgress').hidden = state !== 'saving';
}
function folderTimeoutError(action) {
  const error = new Error(`${action} is taking too long. Your edits are still in this tab. Download a JSON backup before reloading, then choose the folder again.`);
  error.name = 'FolderAccessTimeoutError';
  return error;
}
async function waitForFolderOperation(operation, timeoutMs, action, onTimeout = () => {}) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => { reject(folderTimeoutError(action)); onTimeout(); }, timeoutMs);
      })
    ]);
  } finally { clearTimeout(timer); }
}
function storageFailure(error, affectsConnectedFolder = true) {
  console.error('Local workspace operation failed', error);
  setBadgeState(affectsConnectedFolder ? 'error' : isDirty ? 'pending' : 'saved');
  const message = error.name === 'NotFoundError'
    ? 'The selected folder could not be found. Reconnect it or choose the folder again. Your edits are still in this tab.'
    : error.name === 'InvalidStateError'
    ? 'The folder changed or its saved handle expired. Reconnect the folder; your edits are still in this tab.'
    : error.name === 'NotAllowedError'
    ? 'Folder permission was denied. Allow access in the browser prompt and reconnect, or download a backup.'
    : error.name === 'SecurityError'
    ? 'This page cannot open the folder picker. Use localhost or HTTPS in a browser that supports folder access, or download a backup.'
    : error.message || 'Local folder operation failed.';
  if (affectsConnectedFolder && ['NotFoundError', 'InvalidStateError', 'WorkspaceConflictError', 'NotAllowedError', 'FolderAccessTimeoutError'].includes(error.name)) {
    folderNeedsReconnect = true;
    folderRecoveryNeeded = true;
  }
  updateFolderAccessButton();
  const detail = error.workspaceStep ? ` Failed while: ${error.workspaceStep}.` : '';
  setStorageStatus('error', `${affectsConnectedFolder ? 'Not saved. ' : 'Folder not opened. Current folder unchanged. '}${message}${detail}`);
  showToast(message, 'error');
}
// Block editing and show progress only while a guarded operation is running.
function setWorkspaceBusy(busy) {
  workspaceBusy = busy;
  $('workspaceBusyIndicator').hidden = !busy;
  $('mainAppShell').setAttribute?.('aria-busy', String(busy));
  $('mainAppShell').inert = busy;
  $('dashboardSelectOverlay').inert = busy;
  document.querySelectorAll('#projectModal, #moduleModal, #ollamaSettingsModal, #historyModal').forEach(el => { el.inert = busy; });
  updateFolderAccessButton();
  $('disconnectFolderButton').disabled = busy || (!folderStore && !rememberedHandle);
}
async function handleCache(mode, value, signal) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('qa_local_folder_handles', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    if (signal?.aborted) throw new DOMException('Folder recovery timed out.', 'AbortError');
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', mode === 'get' ? 'readonly' : 'readwrite');
      const abort = () => { try { tx.abort(); } catch (error) { if (error.name !== 'InvalidStateError') throw error; } };
      signal?.addEventListener('abort', abort, { once: true });
      const request = mode === 'get' ? tx.objectStore('handles').get(currentUser.email) :
        mode === 'delete' ? tx.objectStore('handles').delete(currentUser.email) : tx.objectStore('handles').put(value, currentUser.email);
      tx.oncomplete = () => { signal?.removeEventListener('abort', abort); resolve(request.result); };
      tx.onerror = () => { signal?.removeEventListener('abort', abort); reject(tx.error); };
      tx.onabort = () => { signal?.removeEventListener('abort', abort); reject(tx.error || new Error('Folder-handle transaction aborted.')); };
    });
  } finally { db.close(); }
}
function captureModule() {
  if (!localState || !activeContext?.project) return;
  const form = collectData();
  form.project = activeContext.project; form.module = activeContext.module;
  const key = LocalWorkspace.recordKey(form.project, form.module);
  const images = {
    prod: [...prodImages], exec: [...execImages], studio: [...studioImages],
    execEvidence: copy(execEvidenceImages)
  };
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
  clearStudioDocument();
  activeContext = project ? { project, module } : null;
  localState.active = activeContext;
  const record = !cleared && activeContext ? localState.records[LocalWorkspace.recordKey(project, module)] : null;
  const form = record?.form || {};
  Object.entries(formFields).forEach(([id, field]) => { $(id).value = form[field] ?? initialFields[id]; });
  studioGenerationSource = typeof form.studioGenerationSource === 'string' ? form.studioGenerationSource : '';
  $('defectTableBody').innerHTML = '';
  (form.defects || []).forEach(defect => addDefectRow(defect, true));
  studioScenarios = copy(form.studioScenarios || []);
  studioTestCases = copy(form.studioTestCases || []);
  guardChecklists = copy(form.guardChecklists || { reqMatch: [], exploratory: [], regression: [] });
  prodImages = [...(record?.images.prod || [])]; execImages = [...(record?.images.exec || [])]; studioImages = [...(record?.images.studio || [])];
  execEvidenceRows = Array.isArray(form.execEvidenceRows)
    ? form.execEvidenceRows.map(row => ({ id: row.id, path: row.path }))
    : [];
  execEvidenceImages = copy(record?.images.execEvidence || {});
  activeEvidenceRowId = null;
  ['prod', 'exec', 'studio'].forEach(renderImages);
  renderExecutionEvidenceRows();
  renderStudioOutputs(); checkDefectCount(true); applyAria();
  $('viewReport').inert = !activeContext;
  $('viewStudio').inert = !activeContext;
  $('loginRef').disabled = !activeContext;
  $('projectEmptyHint').hidden = !!activeContext;
  renderModulePicker();
}
function applyWorkspaceState() {
  const context = localState.active;
  populateProjectDropdown(context?.project);
  populateModuleDropdown(context?.module);
  loadActiveModule($('projectSelect').value, $('moduleSelect').value);
  $('profileChip').textContent = currentUser.username;
  renderDashboardProjects();
}

function dashboardProjectData(data) {
  if (!data) return [];
  return data.projects.map(project => {
    const names = data.modulesMap[project] || [];
    const overview = data.records[LocalWorkspace.recordKey(project, '')];
    const modules = [...(overview ? [''] : []), ...names].map(module => {
      const record = data.records[LocalWorkspace.recordKey(project, module)];
      const form = record?.form || {}, images = record?.images || {};
      const report = ['desc', 'correction', 'steps', 'res'].some(key => String(form[key] || '').trim()) ||
        (form.defects || []).some(defect => String(defect.id || '').trim() || String(defect.desc || '').trim()) ||
        (form.execEvidenceRows || []).some(row => String(row.path || '').trim()) ||
        ['prod', 'exec'].some(key => (images[key] || []).length) ||
        Object.values(images.execEvidence || {}).some(items => items.length);
      return {
        project, module, report: !!report,
        reportDescription: String(form.desc || '').trim(),
        studioDescription: String(form.studioChangeSummary || '').trim(),
        scenarios: (form.studioScenarios || []).length,
        cases: (form.studioTestCases || []).length
      };
    });
    return {
      project, modules,
      reports: modules.filter(item => item.report).length,
      scenarios: modules.reduce((count, item) => count + item.scenarios, 0),
      cases: modules.reduce((count, item) => count + item.cases, 0)
    };
  });
}

function dashboardElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function dashboardCounts(project) {
  return `${project.reports} ${project.reports === 1 ? 'report' : 'reports'} · ${project.scenarios} ${project.scenarios === 1 ? 'scenario' : 'scenarios'} · ${project.cases} ${project.cases === 1 ? 'test case' : 'test cases'}`;
}
function renderHistoryTimeline() {
  const container = $('historyLogsContainer');
  container.replaceChildren();
  const entries = [...(localState?.history || [])];
  // Imported activity can arrive out of order; keep the saved history unchanged.
  entries.sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));
  if (!entries.length) {
    container.append(dashboardElement('p', 'dashboard-empty', 'No activity recorded yet.'));
    return;
  }
  for (const item of entries) {
    const row = dashboardElement('article', 'history-event');
    const time = dashboardElement('time', 'history-time');
    const date = new Date(item.time);
    if (!Number.isNaN(date.getTime())) {
      time.dateTime = item.time;
      time.textContent = date.toLocaleString();
    } else time.textContent = item.time;
    row.append(time, dashboardElement('strong', 'history-action', item.action));
    const location = [item.project, item.module].filter(Boolean).join(' — ');
    if (location) row.append(dashboardElement('span', 'history-location', location));
    container.append(row);
  }
}
function dashboardModule(item, folder) {
  const row = dashboardElement('article', 'dashboard-module');
  row.append(dashboardElement('h4', 'dashboard-module-title', `${item.project} — ${item.module || 'Project overview'}`));
  const line = dashboardElement('div', 'dashboard-entry');
  const content = dashboardElement('div', 'dashboard-entry-content');
  const count = folder.key === 'report' ? '1 report' :
    `${item[folder.key]} ${folder.key === 'scenarios' ? (item.scenarios === 1 ? 'scenario' : 'scenarios') : (item.cases === 1 ? 'test case' : 'test cases')}`;
  content.append(dashboardElement('span', 'dashboard-entry-count', count));
  content.append(dashboardElement('p', '', (folder.key === 'report' ? item.reportDescription : item.studioDescription) || 'No description yet.'));
  const button = dashboardElement('button', 'dashboard-open', `Open ${folder.action}`);
  button.type = 'button';
  button.setAttribute('aria-label', `${button.textContent}: ${item.project} — ${item.module || 'Project overview'}`);
  button.addEventListener('click', event => openDashboardProjectItem(item.project, item.module, folder.key === 'report' ? 'report' : 'studio', portalOrigin(event), folder.key));
  line.append(content, button);
  row.append(line);
  return row;
}
function renderDashboardProjects() {
  const container = $('dashboardProjects');
  const projects = dashboardProjectData(localState);
  container.replaceChildren();
  if (!projects.length) {
    container.append(dashboardElement('p', 'dashboard-empty', 'No projects yet. Open a workspace to add a project.'));
    return;
  }
  for (const project of projects) {
    const card = dashboardElement('details', 'dashboard-project-card');
    const summary = dashboardElement('summary', 'dashboard-project-summary');
    summary.append(dashboardElement('strong', '', project.project), dashboardElement('span', 'dashboard-project-count', dashboardCounts(project)));
    card.append(summary);
    const body = dashboardElement('div', 'dashboard-project-body');
    // Each folder lists only modules that contain that kind of saved content.
    const folders = [
      { key: 'report', title: 'Reports', action: 'report', count: project.reports },
      { key: 'scenarios', title: 'Test Scenarios', action: 'scenarios', count: project.scenarios },
      { key: 'cases', title: 'Test Cases', action: 'test cases', count: project.cases }
    ];
    for (const folder of folders) {
      const section = dashboardElement('details', 'dashboard-folder');
      const heading = dashboardElement('summary', 'dashboard-folder-summary');
      const label = dashboardElement('span', 'dashboard-folder-label');
      const icon = dashboardElement('span', 'material-symbols-rounded', 'folder');
      icon.setAttribute('aria-hidden', 'true');
      label.append(icon, document.createTextNode(folder.title));
      heading.append(label, dashboardElement('span', 'dashboard-project-count', String(folder.count)));
      section.append(heading);
      const content = dashboardElement('div', 'dashboard-folder-content');
      const items = project.modules.filter(item => item[folder.key]);
      if (!items.length) content.append(dashboardElement('p', 'dashboard-empty', `No ${folder.title.toLowerCase()} yet.`));
      items.forEach(item => content.append(dashboardModule(item, folder)));
      section.append(content);
      body.append(section);
    }
    card.append(body);
    container.append(card);
  }
}
async function openDashboardProjectItem(project, module, mode, origin, folder) {
  if (workspaceBusy) return;
  if (!localState?.projects.includes(project) || (module && !localState.modulesMap[project]?.includes(module))) {
    showToast('This project or module is no longer available.', 'error');
    return;
  }
  setWorkspaceBusy(true);
  try {
    if (!await flushBeforeSwitch()) return;
    captureModule();
    populateProjectDropdown(project);
    populateModuleDropdown(module);
    loadActiveModule(project, module);
  } finally { setWorkspaceBusy(false); }
  closeHistoryModal(false);
  selectWorkspaceMode(mode, origin);
  if (mode === 'studio' && (folder === 'scenarios' || folder === 'cases')) {
    const scenarios = folder === 'scenarios';
    switchStudioTab(scenarios ? 'tabScenarios' : 'tabFunctionalCases', $(scenarios ? 'studioScenariosTab' : 'studioCasesTab'));
    navigateWorkspaceSection('secStudioOutput');
  }
  $(mode === 'studio' ? 'btnModeStudio' : 'btnModeReport').focus?.({ preventScroll: true });
}
async function performSaveNow(manual = false, timeoutMs = 60000) {
  clearTimeout(autoSaveTimer); autoSaveTimer = null;
  if (folderNeedsReconnect) {
    isDirty = true;
    setBadgeState('error');
    setStorageStatus('error', 'Folder unavailable or changed. Edits are only in memory. Reconnect or download a JSON backup.');
    if (manual) showToast('Reconnect the folder or download a JSON backup. Your edits are only in memory.', 'error');
    return false;
  }
  if (!folderStore) {
    isDirty = true;
    setBadgeState('pending');
    setStorageStatus('pending', 'Changes are only in memory. Download a JSON backup before leaving.');
    if (manual) showToast('No folder is connected. Download a JSON backup to keep these edits.', 'error');
    return false;
  }
  let snapshot;
  try { snapshot = snapshotWorkspace(); }
  catch (error) { storageFailure(error); return false; }
  const version = editRevision, target = folderStore;
  const controller = new AbortController();
  setBadgeState('saving'); setStorageStatus('saving', 'Saving...');
  const operation = async () => {
    if (controller.signal.aborted) throw folderTimeoutError('Folder save');
    const write = () => target.save(snapshot);
    if (navigator.locks) await navigator.locks.request(`qa-local-${currentUser.email}`, { signal: controller.signal }, write);
    else await write();
  };
  const pending = saveQueue.then(operation);
  saveQueue = pending.catch(() => {});
  try {
    await waitForFolderOperation(pending, timeoutMs, 'Folder save', () => controller.abort());
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
  if (!folderNeedsReconnect && await performSaveNow()) return true;
  if (!folderNeedsReconnect) return false;
  captureModule();
  setBadgeState('error');
  setStorageStatus('error', 'Folder unavailable or changed. Edits are only in memory. Reconnect or download a JSON backup.');
  showToast('Folder unavailable. Edits are only in memory; reconnect or download a JSON backup.', 'error');
  return true;
}
function saveWorkspaceNow() {
  if (folderStore) return performSaveNow(true);
  return backupWorkspace();
}
function markUnsaved() {
  isDirty = true; setBadgeState('pending');
  editRevision++;
  clearTimeout(autoSaveTimer);
  if (folderStore && !folderNeedsReconnect) {
    setStorageStatus('pending', 'Unsaved changes. Folder autosave starts in 3 seconds.');
    autoSaveTimer = setTimeout(() => performSaveNow(false), 3000);
  } else if (folderNeedsReconnect) {
    setBadgeState('error');
    setStorageStatus('error', 'Folder unavailable or changed. Edits are only in memory. Reconnect or download a JSON backup.');
  } else {
    setStorageStatus('pending', 'Changes are only in memory. Download a JSON backup before leaving.');
  }
}
async function saveProjectMetrics(project, filename, bytes, draft) {
  if (!folderStore || folderNeedsReconnect) throw new Error('Choose or reconnect your workspace folder before saving metrics.');
  if (workspaceBusy) throw new Error('Workspace is busy. Try again when saving finishes.');
  setWorkspaceBusy(true);
  try {
    captureModule();
    if (!localState.projects.includes(project)) {
      localState.projects.push(project);
      Object.defineProperty(localState.modulesMap, project, { value: [], writable: true, enumerable: true, configurable: true });
      markUnsaved();
    }
    if (!await performSaveNow()) throw new Error('Project not saved. Your metrics draft is kept.');
    const target = folderStore;
    const operation = async () => {
      const write = () => target.saveMetrics(project, filename, Uint8Array.from(bytes), draft);
      if (navigator.locks) return navigator.locks.request(`qa-local-${currentUser.email}`, write);
      return write();
    };
    const pending = saveQueue.then(operation);
    saveQueue = pending.catch(() => {});
    return await pending;
  } finally {
    populateProjectDropdown(activeContext?.project);
    populateModuleDropdown(activeContext?.module);
    setWorkspaceBusy(false);
  }
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
async function openFolderHandle(handle, isCurrent = () => true) {
  const candidate = new LocalWorkspace.FolderStore(handle, currentUser);
  const loaded = await candidate.load();
  if (!isCurrent()) return false;
  const draft = isDirty ? snapshotWorkspace() : null;
  if (draft && (!folderStore || folderNeedsReconnect) && !loaded.projects.length) {
    if (navigator.locks) await navigator.locks.request(`qa-local-${currentUser.email}`, () => candidate.save(draft));
    else await candidate.save(draft);
    if (!isCurrent()) return false;
    localState = draft;
  } else {
    if (draft && !confirm('This folder already has workspace data. Opening it replaces the in-memory view. Cancel and download a backup first if you need your current edits.')) {
      setStorageStatus('pending', 'Folder connection cancelled. Current edits remain in this tab; download a JSON backup before leaving.');
      return false;
    }
    localState = loaded;
  }
  folderStore = candidate; rememberedHandle = handle;
  folderNeedsReconnect = false; folderRecoveryNeeded = false;
  $('disconnectFolderButton').disabled = false;
  applyWorkspaceState(); isDirty = false; setBadgeState('saved');
  $('connectedFolderName').textContent = `Folder: ${handle.name}`;
  updateFolderAccessButton();
  setStorageStatus('saved', `Folder connected. Workspace saved to ${handle.name}.`);
  return true;
}
async function findRememberedFolder(isCurrent = () => true) {
  const support = folderAccessAvailability();
  if (!support.available) {
    updateFolderAccessButton();
    $('connectedFolderName').textContent = 'Folder autosave is unavailable in this browser context.';
    setStorageStatus('pending', `${support.message} Changes stay in this tab until you download a backup.`);
    return;
  }
  try {
    const handle = await handleCache('get');
    if (!isCurrent()) return;
    rememberedHandle = handle;
    if (!rememberedHandle) {
      updateFolderAccessButton();
      setStorageStatus('pending', 'No folder is connected. Choose a folder for autosave, or download a JSON backup.');
      return;
    }
    const permission = await rememberedHandle.queryPermission({ mode: 'readwrite' });
    if (!isCurrent()) return;
    if (permission === 'granted') await openFolderHandle(rememberedHandle, isCurrent);
    else {
      folderRecoveryNeeded = true;
      updateFolderAccessButton();
      $('connectedFolderName').textContent = `Folder: ${rememberedHandle.name}`;
      setStorageStatus('pending', 'Folder permission is needed. Reconnect it and allow access, or import a JSON backup.');
    }
  } catch (error) {
    if (!isCurrent()) return;
    if (error.name === 'NotAllowedError') {
      folderRecoveryNeeded = true;
      updateFolderAccessButton();
      setStorageStatus('pending', 'Folder permission was denied. Reconnect it and allow access, or import a JSON backup.');
      return;
    }
    if (['NotFoundError', 'InvalidStateError', 'WorkspaceIncompleteError'].includes(error.name)) {
      rememberedHandle = null;
      folderRecoveryNeeded = true;
      updateFolderAccessButton();
      if (error.name === 'WorkspaceIncompleteError') {
        storageFailure(error);
        return;
      }
      setStorageStatus('error', 'The saved folder is unavailable. Use Forget saved folder, then choose a folder again.');
      return;
    }
    storageFailure(error);
  }
}
async function restoreRememberedFolder(timeoutMs = 4000) {
  let current = true, timer;
  const completed = await Promise.race([
    findRememberedFolder(() => current).then(() => true),
    new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })
  ]);
  current = false; clearTimeout(timer);
  if (!completed) {
    rememberedHandle = null; folderRecoveryNeeded = true;
    updateFolderAccessButton();
    setStorageStatus('error', 'Folder restore is taking too long. Use Forget saved folder, then choose a folder again. Edits stay in this tab.');
    showToast('Folder restore timed out. Use Forget saved folder to recover.', 'error');
  }
}
async function connectLocalFolder(timeoutMs = 30000) {
  if (!currentUser || workspaceBusy || forgetFolderBusy) return;
  const support = folderAccessAvailability();
  if (!support.available) {
    updateFolderAccessButton();
    setStorageStatus('pending', `${support.message} Changes stay in this tab until you download a backup.`);
    return;
  }
  setWorkspaceBusy(true);
  let handle;
  try {
    // Permission requests and pickers run directly in the user gesture, before any save awaits.
    if (rememberedHandle && !folderStore) {
      handle = rememberedHandle;
      if (await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
        updateFolderAccessButton();
        setStorageStatus('pending', 'Folder permission was denied. Allow access to reconnect, or download a JSON backup.');
        showToast('Folder permission was denied. Your edits are still in this tab.', 'error');
        return;
      }
    } else handle = await window.showDirectoryPicker({ id: 'qa-workspace-root', mode: 'readwrite' });
    if (folderStore && isDirty && !folderNeedsReconnect && !await performSaveNow()) return;
    let current = true, opened;
    try {
      opened = await waitForFolderOperation(openFolderHandle(handle, () => current), timeoutMs, 'Opening the folder');
    } finally { current = false; }
    if (!opened) return;
    const controller = new AbortController();
    try {
      await waitForFolderOperation(handleCache('put', handle, controller.signal), timeoutMs, 'Remembering the folder', () => controller.abort());
    }
    catch (error) {
      console.error('Could not remember folder', error);
      setStorageStatus('pending', `Folder connected and saved. This browser could not remember it; choose the folder again next time. ${error.message}`);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      updateFolderAccessButton();
      setStorageStatus('pending', 'Folder selection was cancelled. Your current workspace was not changed.');
    }
    else if (error.name === 'NotAllowedError') {
      updateFolderAccessButton();
      const message = 'Folder access was denied. Allow permission in the browser and choose again. Your current edits remain in this tab.';
      setStorageStatus('error', message);
      showToast(message, 'error');
    }
    else {
      const affectsConnectedFolder = !folderStore || handle === folderStore.handle;
      if (['NotFoundError', 'InvalidStateError', 'WorkspaceIncompleteError', 'FolderAccessTimeoutError'].includes(error.name) && handle === rememberedHandle && !folderStore) rememberedHandle = null;
      if (affectsConnectedFolder && ['NotFoundError', 'InvalidStateError'].includes(error.name)) folderRecoveryNeeded = true;
      updateFolderAccessButton();
      storageFailure(error, affectsConnectedFolder);
    }
  } finally { setWorkspaceBusy(false); }
}
async function disconnectLocalFolder(timeoutMs = 4000) {
  if (workspaceBusy || forgetFolderBusy || (!folderStore && !rememberedHandle)) return;
  setWorkspaceBusy(true);
  try {
    clearTimeout(autoSaveTimer); autoSaveTimer = null;
    await waitForFolderOperation(saveQueue, timeoutMs, 'Waiting for the previous folder save');
    captureModule();
    folderStore = null; rememberedHandle = null; folderNeedsReconnect = false; folderRecoveryNeeded = false;
    isDirty = true; editRevision++; setBadgeState('pending');
    updateFolderAccessButton();
    $('connectedFolderName').textContent = 'No folder selected.';
    setStorageStatus('pending', 'Folder disconnected. Changes are only in memory; download a JSON backup before leaving.');
    const controller = new AbortController();
    try { await waitForFolderOperation(handleCache('delete', undefined, controller.signal), timeoutMs, 'Forgetting the saved folder', () => controller.abort()); }
    catch (error) { console.error('Could not forget folder', error); folderRecoveryNeeded = true; updateFolderAccessButton(); setStorageStatus('error', 'Edits kept. Folder may reconnect on refresh; back up before closing.'); }
  } catch (error) { storageFailure(error); }
  finally { setWorkspaceBusy(false); }
}
async function forgetSavedFolder(timeoutMs = 4000) {
  if (!currentUser || workspaceBusy || forgetFolderBusy) return;
  forgetFolderBusy = true; updateFolderAccessButton();
  setStorageStatus('pending', 'Forgetting the saved folder. Your edits stay in this tab.');
  try {
    let waitTimer;
    try {
      await Promise.race([
        saveQueue,
        new Promise((resolve, reject) => { waitTimer = setTimeout(() => reject(new Error('Previous save is still running.')), timeoutMs); })
      ]);
    } finally { clearTimeout(waitTimer); }
    captureModule();
    if (folderStore || isDirty) { isDirty = true; editRevision++; }
    folderStore = null; rememberedHandle = null; folderNeedsReconnect = false;
    const controller = new AbortController();
    let timer;
    try {
      await Promise.race([
        handleCache('delete', undefined, controller.signal),
        new Promise((resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Folder recovery timed out.')); }, timeoutMs); })
      ]);
    } finally { clearTimeout(timer); }
    folderRecoveryNeeded = false;
    $('connectedFolderName').textContent = 'No folder selected.';
    setBadgeState('pending');
    setStorageStatus('pending', 'Saved folder forgotten. Choose a folder again; download a JSON backup before leaving if you have edits.');
    showToast('Saved folder forgotten. Choose a folder again.');
  } catch (error) {
    console.error('Could not forget folder', error);
    folderRecoveryNeeded = true;
    setStorageStatus('error', 'Could not forget the saved folder. Retry; your edits stay in this tab. The folder may reconnect on refresh.');
    showToast('Could not forget the saved folder. Try again.', 'error');
  } finally { forgetFolderBusy = false; updateFolderAccessButton(); }
}
function backupWorkspace() {
  try {
    const data = snapshotWorkspace();
    const blob = new Blob([JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.hidden = true;
    a.download = `qa-workspace-${currentUser.email.replace(/[^a-z0-9]/gi, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    if (folderNeedsReconnect) {
      setBadgeState('error');
      setStorageStatus('error', 'Backup downloaded. Folder unavailable or changed; reconnect to save future edits.');
    } else if (!folderStore) {
      setBadgeState('backup');
      setStorageStatus('pending', 'A JSON backup was downloaded. Current edits remain in memory; download a new backup after more edits.');
    } else {
      setBadgeState(isDirty ? 'pending' : 'saved');
      setStorageStatus(isDirty ? 'pending' : 'saved', isDirty
        ? 'Backup downloaded. Current folder edits are still waiting to save.'
        : 'Backup downloaded. Workspace remains saved in the selected folder.');
    }
    showToast('Backup download started');
    return true;
  } catch (error) { storageFailure(error); return false; }
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
  isDirty = true; editRevision++; setBadgeState('pending');
  recordUserHistory(`Imported workspace attributed to ${imported.owner.email}`);
  if (folderStore) await performSaveNow(true);
  else setStorageStatus('pending', 'Backup imported. Changes are only in memory; download a new JSON backup before leaving.');
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

function renderModulePicker() {
  const select = $('moduleSelect'), picker = $('modulePicker'), trigger = $('modulePickerButton');
  $('modulePickerValue').textContent = $('projectSelect').value ? select.selectedOptions[0]?.textContent || 'Choose module' : 'Choose module';
  trigger.disabled = !$('projectSelect').value;
  $('selectedModuleCopy').hidden = !select.value;
  picker.replaceChildren();
  Array.from(select.options).forEach(option => {
    const row = document.createElement('div'); row.className = 'module-option-row';
    const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'module-choice';
    choose.textContent = option.textContent;
    choose.setAttribute('aria-pressed', String(option.selected));
    choose.onclick = () => {
      select.value = option.value;
      closeModulePicker(true);
      onModuleChange();
    };
    row.append(choose);
    if (option.value) {
      const copyButton = document.createElement('button'); copyButton.type = 'button'; copyButton.className = 'module-copy';
      copyButton.setAttribute('aria-label', `Copy ${option.textContent}`);
      copyButton.innerHTML = '<span class="material-symbols-rounded" aria-hidden="true">content_copy</span>';
      copyButton.onclick = async () => {
        try { await navigator.clipboard.writeText(option.textContent); showToast('Module name copied'); }
        catch (error) { console.error('Module copy failed', error); showToast('Copy failed. Check clipboard permission.', 'error'); }
      };
      row.append(copyButton);
    }
    picker.append(row);
  });
}
async function copyCurrentModule() {
  const value = $('moduleSelect').value;
  if (!value) return;
  try { await navigator.clipboard.writeText(value.replace(/-->/g, '\u2192')); showToast('Module name copied'); }
  catch (error) { console.error('Module copy failed', error); showToast('Copy failed. Check clipboard permission.', 'error'); }
}
function closeModulePicker(restoreFocus = false) {
  const picker = $('modulePicker');
  if (picker.hidden) return;
  if (picker.hidePopover) picker.hidePopover();
  picker.hidden = true;
  $('modulePickerButton').setAttribute('aria-expanded', 'false');
  document.body.classList.remove('module-picker-open');
  if (restoreFocus) $('modulePickerButton').focus();
}
function toggleModulePicker() {
  const picker = $('modulePicker'), trigger = $('modulePickerButton');
  if (!picker.hidden) { closeModulePicker(); return; }
  renderModulePicker();
  const rect = trigger.getBoundingClientRect();
  picker.style.left = `${rect.left}px`;
  picker.style.top = `${rect.bottom - 1}px`;
  picker.style.width = `${Math.min(rect.width, innerWidth - rect.left - 12)}px`;
  picker.style.maxHeight = `${Math.max(0, Math.min(280, innerHeight - rect.bottom - 18))}px`;
  picker.hidden = false;
  if (picker.showPopover) picker.showPopover();
  document.body.classList.add('module-picker-open');
  trigger.setAttribute('aria-expanded', 'true');
  picker.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
}
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('#modulePicker, #modulePickerButton')) closeModulePicker();
});
$('modulePickerButton').addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); toggleModulePicker(); }
});
$('modulePicker').addEventListener('keydown', event => {
  const buttons = Array.from($('modulePicker').querySelectorAll('button'));
  const current = buttons.indexOf(document.activeElement);
  if (event.key === 'Escape') { event.preventDefault(); closeModulePicker(true); return; }
  if (event.key === 'Tab') {
    if (event.shiftKey && current === 0 || !event.shiftKey && current === buttons.length - 1) {
      event.preventDefault(); closeModulePicker(true);
    }
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const choices = Array.from($('modulePicker').querySelectorAll('.module-choice'));
  const index = choices.indexOf(document.activeElement.closest('.module-option-row')?.querySelector('.module-choice'));
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 :
    (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
  choices[next]?.focus();
});
window.addEventListener('resize', () => closeModulePicker());
document.addEventListener('scroll', event => {
  if (!event.target.closest?.('#modulePicker')) closeModulePicker();
}, true);

function initializeCardAccordions() {
  const cards = document.querySelectorAll('#secContext, #viewReport > .card, #viewStudio > .card');
  cards.forEach(card => {
    const header = [...card.children].find(child => child.classList.contains('card-title'));
    const label = header?.querySelector('.heading-label');
    if (!header || !label) return;

    const content = document.createElement('div');
    content.className = 'card-content';
    content.id = `${card.id}Content`;
    content.setAttribute('aria-hidden', 'false');
    const inner = document.createElement('div');
    inner.className = 'card-content-inner';
    [...card.children].filter(child => child !== header).forEach(child => inner.append(child));
    content.append(inner);
    card.append(content);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'card-accordion-toggle';
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-controls', content.id);
    toggle.append(label);
    const chevron = document.createElement('span');
    chevron.className = 'material-symbols-rounded';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = 'expand_less';
    toggle.append(chevron);
    header.prepend(toggle);
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') !== 'true';
      if (!expanded && content.contains(document.activeElement)) toggle.focus({ preventScroll: true });
      toggle.setAttribute('aria-expanded', String(expanded));
      content.setAttribute('aria-hidden', String(!expanded));
      content.toggleAttribute('inert', !expanded);
      card.classList.toggle('is-collapsed', !expanded);
    });
  });
}
initializeCardAccordions();

const sectionNavigation = document.querySelector('.section-jump-nav');
if (sectionNavigation) {
  const indicator=document.createElement('span');indicator.className='dock-indicator';indicator.hidden=true;indicator.setAttribute('aria-hidden','true');
  sectionNavigation.prepend(indicator);
  sectionNavigation.setAttribute('aria-label', 'Workspace sections');
  sectionNavigation.setAttribute('role', 'navigation');
  sectionNavigation.querySelectorAll('.jump-pill').forEach(button => {
    const id = button.getAttribute('onclick').match(/'([^']+)'/)[1];
    button.dataset.section = id; button.setAttribute('aria-controls', id);
  });
}
function updateSectionNavigation() {
  if (!sectionNavigation) return;
  const scroll = $('workspaceScroll'), rootRect = scroll.getBoundingClientRect();
  const buttons = Array.from(sectionNavigation.querySelectorAll(`.${currentMode === 'studio' ? 'studio-only' : 'report-only'} .jump-pill`));
  const threshold = rootRect.top + 32;
  let active = buttons[0];
  for (const button of buttons) {
    if ($(button.dataset.section).getBoundingClientRect().top <= threshold) active = button;
  }
  if (scroll.scrollTop > 0 && Math.ceil(scroll.scrollTop + scroll.clientHeight) >= scroll.scrollHeight - 2) active = buttons.at(-1);
  sectionNavigation.querySelectorAll('.jump-pill').forEach(button => {
    const selected = button === active;
    button.classList.toggle('is-active', selected);
    if (selected) button.setAttribute('aria-current', 'location');
    else button.removeAttribute('aria-current');
  });
  if(active) {
    const indicator=sectionNavigation.querySelector('.dock-indicator');
    if (!active.getClientRects().length) { indicator.hidden = true; return; }
    const rect=active.getBoundingClientRect(),bar=sectionNavigation.getBoundingClientRect();
    indicator.style.width=`${rect.width}px`;indicator.style.height=`${rect.height}px`;
    indicator.style.transform=`translate(${rect.left-bar.left+sectionNavigation.scrollLeft}px,${rect.top-bar.top+sectionNavigation.scrollTop}px)`;
    indicator.hidden=false;
  }
}
function navigateWorkspaceSection(id) {
  const section = $(id);
  if (!section || !sectionNavigation) return;
  closeModulePicker();
  const toggle = section.querySelector('.card-accordion-toggle');
  if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click();
  const scroll = $('workspaceScroll');
  const top = section.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - 16;
  scroll.scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}
let navigationFrame = null;
$('workspaceScroll').addEventListener('scroll', () => {
  if (navigationFrame !== null) return;
  navigationFrame = requestAnimationFrame(() => { navigationFrame = null; updateSectionNavigation(); });
}, { passive: true });
window.addEventListener('resize', updateSectionNavigation);

function sizeSelectPicker(event) {
  const select = event.target.closest('select');
  if (!select) return;
  const rect = select.getBoundingClientRect();
  const available = Math.max(0, innerHeight - rect.bottom - 20);
  select.style.setProperty('--select-top', `${rect.bottom - 1}px`);
  select.style.setProperty('--select-left', `${rect.left}px`);
  select.style.setProperty('--select-width', `${rect.width}px`);
  select.style.setProperty('--select-space', `${available}px`);
}
document.addEventListener('pointerdown', sizeSelectPicker, true);
document.addEventListener('focusin', sizeSelectPicker);
document.addEventListener('keydown', sizeSelectPicker, true);

const tooltip = $('workspaceTooltip');
let tooltipTarget = null, tooltipTimer = null;
function hideWorkspaceTooltip() {
  clearTimeout(tooltipTimer);
  if (tooltipTarget) {
    const ids = (tooltipTarget.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== tooltip.id);
    if (ids.length) tooltipTarget.setAttribute('aria-describedby', ids.join(' '));
    else tooltipTarget.removeAttribute('aria-describedby');
  }
  tooltipTarget = null;
  if (tooltip.hidePopover) tooltip.hidePopover();
  tooltip.hidden = true;
}
function scheduleWorkspaceTooltip(target) {
  hideWorkspaceTooltip();
  if (!target || target.disabled || target.closest('[inert]')) return;
  tooltipTarget = target;
  tooltipTimer = setTimeout(() => {
    if (!target.isConnected || !target.getClientRects().length) { hideWorkspaceTooltip(); return; }
    tooltip.textContent = target.dataset.tooltip;
    tooltip.hidden = false;
    if (tooltip.showPopover) tooltip.showPopover();
    const rect = target.getBoundingClientRect();
    const width = tooltip.offsetWidth, height = tooltip.offsetHeight, gap = 10, edge = 12;
    const below = target.classList.contains('tooltip-bottom') || rect.top < height + gap + edge;
    const top = below ? rect.bottom + gap : rect.top - height - gap;
    tooltip.style.left = `${Math.max(edge, Math.min(rect.left + (rect.width - width) / 2, innerWidth - width - edge))}px`;
    tooltip.style.top = `${Math.max(edge, Math.min(top, innerHeight - height - edge))}px`;
    const ids = new Set((target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    ids.add(tooltip.id);
    target.setAttribute('aria-describedby', [...ids].join(' '));
  }, 400);
}
document.addEventListener('pointerover', event => {
  if (event.pointerType === 'touch') return;
  const target = event.target.closest('[data-tooltip]');
  if (target && !target.contains(event.relatedTarget)) scheduleWorkspaceTooltip(target);
});
document.addEventListener('pointerout', event => {
  if (tooltipTarget?.contains(event.target) && !tooltipTarget.contains(event.relatedTarget)) hideWorkspaceTooltip();
});
document.addEventListener('focusin', event => scheduleWorkspaceTooltip(event.target.closest('[data-tooltip]')));
document.addEventListener('focusout', hideWorkspaceTooltip);
document.addEventListener('pointerdown', hideWorkspaceTooltip);
document.addEventListener('keydown', event => { if (event.key === 'Escape') hideWorkspaceTooltip(); });
document.addEventListener('scroll', hideWorkspaceTooltip, true);
window.addEventListener('resize', hideWorkspaceTooltip);
let initializationStarted=false;
window.onload = async function initializeWorkspace() {
  if(initializationStarted)return;
  initializationStarted=true;
  applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');
  document.querySelectorAll(Object.keys(formFields).map(id => `#${id}`).join(',')).forEach(el => {
    if (el.id !== 'studioScopeType') el.addEventListener('input', markUnsaved);
  });
  try {
    const saved = localStorage.getItem(ACTIVE_USER_KEY);
    if (saved) {
      const profile = JSON.parse(saved);
      if (typeof profile.username !== 'string' || !WorkspaceEmail.validEmail(profile.email)) throw new Error('Invalid remembered profile. Enter your complete email.');
      currentUser = { username: profile.username, email: profile.email.toLowerCase() };
      localState = LocalWorkspace.empty(currentUser);
      applyWorkspaceState();
      $('authOverlay').style.display = 'none';
      $('welcomeUserTitle').textContent = `Welcome back, ${currentUser.username}!`;
      $('dashboardSelectOverlay').classList.add('active');
      setWorkspaceBusy(true);
      try { await restoreRememberedFolder(); } finally { setWorkspaceBusy(false); }
      openRequestedWorkspace();
    }
  } catch (error) { showToast(`Could not restore the browser profile: ${error.message}`, 'error'); }
  updateFolderAccessButton();
  applyAria();
  updateSectionNavigation();
  window.qaUiInitialized=true;
  window.dispatchEvent(new Event('qa-ui-initialized'));
};
document.addEventListener('DOMContentLoaded',window.onload,{once:true});

function workspaceSearchResults(data, query, activeForm = null) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!data || !words.length) return [];
  const results = [];
  const add = (type, project, module, title, detail = '', index = -1) => {
    const text = `${project} ${module} ${title} ${detail}`.toLowerCase();
    if (words.every(word => text.includes(word))) results.push({ type, project, module, title, index });
  };
  for (const project of data.projects) {
    add('Project', project, '', project);
    for (const module of data.modulesMap[project] || []) add('Module', project, module, module);
    for (const module of ['', ...(data.modulesMap[project] || [])]) {
      const form = activeForm?.project === project && activeForm.module === module ? activeForm :
        data.records[LocalWorkspace.recordKey(project, module)]?.form;
      if (!form) continue;
      (form.studioTestCases || []).forEach((item, index) => add('Test case', project, module,
        `${item.id || 'Test case'} · ${item.scenario || item.steps || 'Untitled'}`, `${item.steps || ''} ${item.expected || ''} ${item.type || ''} ${item.status || ''}`, index));
      (form.studioScenarios || []).forEach((item, index) => add('Scenario', project, module,
        `${item.id || 'Scenario'} · ${item.desc || 'Untitled'}`, `${item.cat || ''} ${item.pri || ''}`, index));
    }
  }
  return results;
}

async function openWorkspaceSearchResult(result) {
  if (!localState?.projects.includes(result.project) || (result.module && !localState.modulesMap[result.project]?.includes(result.module))) throw new Error('This search result is no longer available.');
  if (workspaceBusy) throw new Error('Workspace is busy. Wait for saving to finish.');
  setWorkspaceBusy(true);
  try {
    if (!await flushBeforeSwitch()) throw new Error('Not saved. Your edits are kept; reconnect or back up before switching.');
    captureModule();
    populateProjectDropdown(result.project);
    populateModuleDropdown(result.module);
    loadActiveModule(result.project, result.module);
  } finally { setWorkspaceBusy(false); }
  if (!['Test case','Scenario'].includes(result.type)) {
    recordUserHistory('Opened search result');
    navigateWorkspaceSection('secContext');
    $('modulePickerButton').focus({ preventScroll: true });
    return;
  }
  switchWorkspaceMode('studio');
  const scenario = result.type === 'Scenario', tabId = scenario ? 'tabScenarios' : 'tabFunctionalCases';
  const tab = document.querySelector(`[onclick*="switchStudioTab('${tabId}'"]`);
  switchStudioTab(tabId, tab);
  if (!scenario) {
    $('tcSearch').value = ''; $('tcFilterCat').value = ''; $('tcFilterStatus').value = ''; applyTcFilter();
  }
  navigateWorkspaceSection('secStudioOutput');
  const row = document.querySelectorAll(scenario ? '#studioScenarioBody tr' : '#studioTestCaseBody tr')[result.index];
  if (row) {
    const scroll=$('workspaceScroll');
    const top=row.getBoundingClientRect().top-scroll.getBoundingClientRect().top+scroll.scrollTop-24;
    scroll.scrollTo({top:Math.max(0,top),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    row.tabIndex = -1; row.focus({ preventScroll: true });
    row.classList.add('search-result-target');
    setTimeout(() => row.classList.remove('search-result-target'), 1800);
  }
}

// Adapted from Bencho Search (MIT, https://bencho.dev/licence).
class Search {
  constructor() {
    this.root = $('workspaceSearch'); this.input = $('workspaceSearchInput'); this.panel = $('workspaceSearchPanel');
    this.toggle = $('workspaceSearchToggle'); this.closeButton = $('workspaceSearchClose');
    this.results = []; this.active = -1; this.busy = false;
    this.toggle.addEventListener('click', () => this.open());
    this.closeButton.addEventListener('click', () => this.close(true));
    this.input.addEventListener('input', () => this.render());
    this.input.addEventListener('keydown', event => {
      if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();this.close(true);}
      if (['ArrowDown','ArrowUp'].includes(event.key) && this.results.length) {
        event.preventDefault();
        const index=this.active<0 ? (event.key==='ArrowDown'?0:this.results.length-1) :
          (this.active+(event.key==='ArrowDown'?1:-1)+this.results.length)%this.results.length;
        this.select(index);
      }
      if (event.key === 'Enter' && this.active >= 0) {event.preventDefault();void this.activate(this.active);}
    });
    this.panel.addEventListener('pointerdown', event => {if(event.target.closest('[data-search-index]'))event.preventDefault();});
    this.panel.addEventListener('click', event => {
      const button = event.target.closest('[data-search-index]');
      if (button) void this.activate(Number(button.dataset.searchIndex));
    });
    document.addEventListener('pointerdown', event => {
      if (!this.root.contains(event.target) && !this.panel.contains(event.target)) this.close();
    });
    document.addEventListener('focusin', event => {
      if (!this.root.contains(event.target) && !this.panel.contains(event.target)) this.close();
    });
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && currentUser &&
          $('qualityMetricsModule').hidden && !document.querySelector('.modal-overlay.active') &&
          !$('mainAppShell').inert && $('mainAppShell').style.display !== 'none') {
        event.preventDefault(); this.open();
      }
    });
    window.addEventListener('resize', () => this.position());
    $('workspaceScroll').addEventListener('scroll', () => this.position(), { passive: true });
    this.root.addEventListener('transitionend', () => this.position());
  }
  open() {
    if (this.busy) return;
    this.root.classList.add('is-open'); this.input.disabled = false; this.closeButton.hidden = false;
    this.toggle.setAttribute('aria-expanded','true'); this.input.setAttribute('aria-expanded','true');
    this.panel.hidden = false;
    if (this.panel.showPopover && !this.panel.matches(':popover-open')) this.panel.showPopover();
    this.render(); this.input.focus();
  }
  close(focus = false) {
    if (this.busy) return;
    if (this.panel.hidePopover && this.panel.matches(':popover-open')) this.panel.hidePopover();
    this.panel.hidden = true;this.root.classList.remove('is-open');this.input.disabled = true;this.closeButton.hidden = true;
    this.toggle.setAttribute('aria-expanded','false');this.input.setAttribute('aria-expanded','false');this.input.removeAttribute('aria-activedescendant');
    if (focus) this.toggle.focus();
  }
  position() {
    if (this.panel.hidden) return;
    const rect = this.root.getBoundingClientRect(), width = Math.min(440, innerWidth - 24);
    this.panel.style.width = `${width}px`;
    this.panel.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    this.panel.style.top = `${rect.bottom + 8}px`;
    this.panel.style.maxHeight = `${Math.max(80, innerHeight - rect.bottom - 20)}px`;
  }
  render() {
    if (this.busy) return;
    const activeForm = activeContext ? { ...collectData(), ...activeContext } : null;
    const matches = workspaceSearchResults(localState, this.input.value, activeForm);
    this.results = matches.slice(0,30); this.active = -1;
    $('workspaceSearchResults').replaceChildren();this.input.removeAttribute('aria-activedescendant');
    $('workspaceSearchStatus').textContent = !this.input.value.trim() ? 'Search projects, modules, test cases and scenarios.' :
      matches.length ? `${matches.length} results${matches.length > 30 ? ' · Showing first 30. Refine your search.' : ''}` : 'No matches in this workspace.';
    this.results.forEach((result,index) => {
      const button = document.createElement('button');button.type='button';button.className='workspace-search-result';
      button.id=`workspaceSearchResult${index}`;button.dataset.searchIndex=index;button.tabIndex=-1;
      button.setAttribute('role','option');button.setAttribute('aria-selected','false');
      const title=document.createElement('strong');title.textContent=result.title;
      const detail=document.createElement('span');detail.textContent=`${result.type} · ${result.project}${result.module ? ' / '+result.module : ''}`;
      button.append(title,detail);$('workspaceSearchResults').append(button);
    });
    this.position();
  }
  select(index) {
    this.active = index;
    this.panel.querySelectorAll('[role="option"]').forEach((option,i) => option.setAttribute('aria-selected',String(index===i)));
    const option=$(`workspaceSearchResult${index}`);this.input.setAttribute('aria-activedescendant',option.id);
    option.scrollIntoView({block:'nearest'});
  }
  async activate(index) {
    if (this.busy || !this.results[index]) return;
    this.busy = true;this.input.readOnly=true;this.panel.setAttribute('aria-busy','true');
    $('workspaceSearchStatus').textContent='Opening...';
    try {await openWorkspaceSearchResult(this.results[index]);this.busy=false;this.close();}
    catch(error) {console.error('Workspace search navigation failed',error);$('workspaceSearchStatus').textContent=error.message;this.input.focus({preventScroll:true});}
    finally {this.busy=false;this.input.readOnly=false;this.panel.removeAttribute('aria-busy');}
  }
}

// Adapted from Bencho MagnifyingDock (MIT, https://bencho.dev/licence).
class MagnifyingDock {
  constructor(bar) {
    this.bar=bar;bar.classList.add('magnifying-dock');
    this.motion=matchMedia('(prefers-reduced-motion: reduce)');
    bar.querySelectorAll('.jump-pill').forEach(button => {
      const label=document.createElement('span');label.className='dock-label';
      [...button.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).forEach(node=>label.append(node));
      button.setAttribute('aria-label',label.textContent.trim());
      button.dataset.tooltip=label.textContent.trim();
      button.append(label);
    });
    /* The bar reads the pointer, not individual items. Measured centres keep
       the effect correct when labels wrap or the viewport changes. */
    bar.addEventListener('pointermove',event => {
      if (event.pointerType!=='mouse' || this.motion.matches) return;
      const buttons=this.buttons(), vertical=false;
      const coordinate=vertical?event.clientY:event.clientX;
      let nearest=0,gap=Infinity;
      buttons.forEach((button,index)=>{const rect=button.getBoundingClientRect(),distance=Math.abs(coordinate-(vertical?rect.top+rect.height/2:rect.left+rect.width/2));if(distance<gap){gap=distance;nearest=index;}});
      this.magnify(nearest);
    });
    bar.addEventListener('pointerleave',()=>this.reset());
    bar.addEventListener('focusin',event=>this.magnify(this.buttons().indexOf(event.target.closest('.jump-pill'))));
    bar.addEventListener('focusout',()=>this.reset());
    bar.addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse')this.reset();});
    this.motion.addEventListener('change',()=>this.reset());
  }
  buttons() {return [...this.bar.querySelectorAll('.jump-pill')].filter(button=>button.getClientRects().length);}
  magnify(nearest) {
    this.buttons().forEach((button,index)=>{
      const distance=nearest<0?99:Math.abs(index-nearest);
      /* A raised cosine over the reach, rather than hand-picked steps:
         neighbours ease together instead of unrelated buttons growing. */
      const falloff=this.motion.matches||distance>2?0:(1+Math.cos(Math.PI*distance/3))/2;
      // The glyph magnifies, not the button; its label and hit target stay put.
      button.querySelector('.material-symbols-rounded')?.style.setProperty('transform',`translateY(${-3*falloff}px) scale(${1+.24*falloff})`);
    });
  }
  reset() {this.bar.querySelectorAll('.jump-pill .material-symbols-rounded').forEach(icon=>icon.style.removeProperty('transform'));}
}
if (document.querySelector('#workspaceSearch')) new Search();
if (sectionNavigation) new MagnifyingDock(sectionNavigation);
