'use strict';
let localState = null, folderStore = null, rememberedHandle = null, activeContext = null;
let workspaceBusy = false, editRevision = 0, saveQueue = Promise.resolve(), folderNeedsReconnect = false;
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
  $('storageIcon').dataset.loading = String(state === 'saving');
  $('saveProgress').hidden = state !== 'saving';
}
function storageFailure(error) {
  console.error('Local workspace operation failed', error);
  setBadgeState('error');
  const message = error.name === 'NotFoundError'
    ? 'Folder unavailable. Reconnect it or choose a short path, like C:\\QA. Edits are kept.'
    : error.name === 'InvalidStateError'
    ? 'Folder changed during saving. Edits kept. Back up, then reconnect.'
    : error.message || 'Local folder operation failed.';
  if (['NotFoundError', 'InvalidStateError', 'WorkspaceConflictError'].includes(error.name)) {
    folderNeedsReconnect = true;
    $('connectFolderButton').textContent = 'Reconnect folder';
  }
  setStorageStatus('error', `Not saved. ${message}`);
  showToast(message, 'error');
}
function setWorkspaceBusy(busy) {
  workspaceBusy = busy;
  $('workspaceBusyIndicator').hidden = !busy;
  $('mainAppShell').setAttribute?.('aria-busy', String(busy));
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
  renderModulePicker();
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
  folderNeedsReconnect = false;
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
    if (folderStore && isDirty && !folderNeedsReconnect && !await performSaveNow()) return;
    if (folderNeedsReconnect) folderStore = null;
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

const sectionNavigation = document.querySelector('.sub-nav-bar');
if (sectionNavigation) {
  const indicator=document.createElement('span');indicator.className='dock-indicator';indicator.hidden=true;indicator.setAttribute('aria-hidden','true');
  sectionNavigation.prepend(indicator);
  sectionNavigation.setAttribute('aria-label', 'Workspace sections');
  sectionNavigation.setAttribute('role', 'navigation');
  $('workspaceScroll').prepend(sectionNavigation);
  sectionNavigation.querySelectorAll('.jump-pill').forEach(button => {
    const id = button.getAttribute('onclick').match(/'([^']+)'/)[1];
    button.dataset.section = id; button.setAttribute('aria-controls', id);
  });
}
function updateSectionNavigation() {
  if (!sectionNavigation) return;
  const scroll = $('workspaceScroll'), rootRect = scroll.getBoundingClientRect();
  const buttons = Array.from(sectionNavigation.querySelectorAll(`.${currentMode === 'studio' ? 'studio-only' : 'report-only'} .jump-pill`));
  const threshold = rootRect.top + sectionNavigation.offsetHeight + 32;
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
  const scroll = $('workspaceScroll');
  const top = section.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop - sectionNavigation.offsetHeight - 16;
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
      try { await findRememberedFolder(); } finally { setWorkspaceBusy(false); }
      openRequestedWorkspace();
    }
  } catch (error) { showToast(`Could not restore the browser profile: ${error.message}`, 'error'); }
  if (!window.isSecureContext || !window.showDirectoryPicker) $('connectFolderButton').disabled = true;
  applyAria();
  updateSectionNavigation();
  window.qaUiInitialized=true;
  window.dispatchEvent(new Event('qa-ui-initialized'));
};
document.addEventListener('DOMContentLoaded',window.onload,{once:true});

document.querySelectorAll('.header-top > .btn-group > button, .header-top > .btn-group > .menu-wrap > button').forEach(button => {
  const icon = button.querySelector('.material-symbols-rounded');
  if (!icon) return;
  const existing = button.querySelector('.btn-label');
  const label = existing?.textContent || (button.id === 'themeToggle' ? 'Theme' : 'More');
  button.classList.add('action-pill');
  button.setAttribute('aria-label', label);
  button.dataset.label = label;
  // Theme changes replace innerHTML, so the expandable label is CSS-generated.
  existing?.remove();
  if (icon.textContent === 'pageview') icon.textContent = 'visibility';
});
$('saveStatus').classList.add('action-pill');
$('saveStatus').dataset.label = 'Save';

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
    const top=row.getBoundingClientRect().top-scroll.getBoundingClientRect().top+scroll.scrollTop-(sectionNavigation?.offsetHeight || 0)-24;
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
      const buttons=this.buttons();
      let nearest=0,gap=Infinity;
      buttons.forEach((button,index)=>{const rect=button.getBoundingClientRect(),distance=Math.abs(event.clientX-rect.left-rect.width/2);if(distance<gap){gap=distance;nearest=index;}});
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
