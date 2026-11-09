(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const recordKey = (project, module) => JSON.stringify([project, module]);
  const htmlText = value => String(value ?? '').replace(/-->/g, '\u2192').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function executionEvidenceRows(form, images) {
    const groups = images.execEvidence || {};
    return (form.execEvidenceRows || []).map(row => ({
      id: row.id, path: row.path, images: [...(groups[row.id] || [])]
    }));
  }
  function documentHtml(title, content) {
    return `<!DOCTYPE html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlText(title)}</title><style>body{font:15px system-ui,sans-serif;margin:32px;color:#172033}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #abb5c4;padding:8px;text-align:left;white-space:pre-wrap}th{background:#edf1f8}p{white-space:pre-wrap;margin:0 0 6px}.evidence-path{font-weight:400;margin:4px 0 2px;break-after:avoid;page-break-after:avoid}img{max-width:100%;height:auto;break-inside:avoid;page-break-inside:avoid}</style><h1>${htmlText(title)}</h1>${content}</html>`;
  }
  function htmlTable(items) {
    const fields = [...new Set(items.flatMap(item=>Object.keys(item)))];
    return fields.length ? `<table><thead><tr>${fields.map(field=>`<th>${htmlText(field)}</th>`).join('')}</tr></thead><tbody>${items.map(item=>`<tr>${fields.map(field=>`<td>${htmlText(item[field])}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p>No entries.</p>';
  }
  function workspaceConflict() {
    const error = new Error('Folder changed in another tab or app. Back up your edits, then reconnect.');
    error.name = 'WorkspaceConflictError';
    return error;
  }
  function empty(owner) {
    return { version: 3, owner: clone(owner), projects: [], modulesMap: {}, records: {}, active: null, history: [] };
  }
  async function segment(name, legacy = false) {
    const bytes = new TextEncoder().encode(name);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const slug = name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, legacy ? 40 : 8) || 'item';
    return `${slug}-${legacy ? hash : hash.slice(0, 16)}`;
  }
  function validate(data) {
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    if (!object(data) || data.version !== 3 || !object(data.owner) ||
        typeof data.owner.email !== 'string' || typeof data.owner.username !== 'string' ||
        !Array.isArray(data.projects) || !data.projects.every(p => typeof p === 'string' && p.length && p.length <= 500) ||
        new Set(data.projects).size !== data.projects.length || !object(data.modulesMap) ||
        !object(data.records) || !Array.isArray(data.history)) throw new Error('Invalid workspace structure.');
    for (const project of data.projects) {
      if (!Object.hasOwn(data.modulesMap, project) || !Array.isArray(data.modulesMap[project]) ||
          !data.modulesMap[project].every(m => typeof m === 'string' && m.length && m.length <= 500) ||
          new Set(data.modulesMap[project]).size !== data.modulesMap[project].length) throw new Error('Invalid project modules.');
    }
    if (data.active !== null && (!object(data.active) || !data.projects.includes(data.active.project) ||
        (data.active.module !== '' && !data.modulesMap[data.active.project].includes(data.active.module)))) throw new Error('Invalid active module.');
    for (const [key, record] of Object.entries(data.records)) {
      const evidenceRows = record?.form?.execEvidenceRows;
      const evidenceImages = record?.images?.execEvidence;
      const validEvidenceImages = evidenceImages === undefined || (object(evidenceImages) &&
        Object.values(evidenceImages).every(images => Array.isArray(images) &&
          images.every(src => typeof src === 'string' && /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/i.test(src))));
      const validEvidenceRows = evidenceRows === undefined
        ? evidenceImages === undefined || (object(evidenceImages) && Object.keys(evidenceImages).length === 0)
        : (Array.isArray(evidenceRows) &&
        evidenceRows.every(row => object(row) && typeof row.id === 'string' && !!row.id && typeof row.path === 'string') &&
        new Set(evidenceRows.map(row => row.id)).size === evidenceRows.length &&
        (evidenceImages === undefined || (object(evidenceImages) &&
          Object.keys(evidenceImages).every(id => evidenceRows.some(row => row.id === id)))));
      if (!object(record) || !object(record.form) || !object(record.images) ||
          !data.projects.includes(record.form.project) ||
          (record.form.module !== '' && !data.modulesMap[record.form.project].includes(record.form.module)) ||
          key !== recordKey(record.form.project, record.form.module) ||
          !object(record.owner) || typeof record.owner.email !== 'string' ||
          !['prod', 'exec', 'studio'].every(type => Array.isArray(record.images[type]) &&
            record.images[type].every(src => typeof src === 'string' && /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/i.test(src))) ||
          !validEvidenceImages || !validEvidenceRows ||
          !['studioScenarios', 'studioTestCases', 'defects'].every(field => record.form[field] === undefined || Array.isArray(record.form[field])) ||
          (record.form.guardChecklists !== undefined && (!object(record.form.guardChecklists) ||
            !['reqMatch', 'exploratory', 'regression'].every(field => Array.isArray(record.form.guardChecklists[field]))))) {
        throw new Error('Invalid module record or evidence.');
      }
      const form = record.form;
      const strings = ['project', 'module', 'mantisId', 'build', 'url', 'login', 'desc', 'correction', 'steps', 'res',
        'studioScopeType', 'studioUiElements', 'studioImpactedAreas', 'studioChangeSummary', 'studioGenerationSource'];
      if (!strings.every(field => form[field] === undefined || typeof form[field] === 'string') ||
          !['studioScenarios', 'studioTestCases', 'defects'].every(field => (form[field] || []).every(item =>
            object(item) && Object.values(item).every(value => typeof value === 'string'))) ||
          (form.guardChecklists && !Object.values(form.guardChecklists).every(items => Array.isArray(items) &&
            items.every(item => object(item) && typeof item.text === 'string' && typeof item.done === 'boolean')))) {
        throw new Error('Invalid form, test case or checklist data.');
      }
    }
    if (!data.history.every(item => object(item) && typeof item.action === 'string' && typeof item.time === 'string')) throw new Error('Invalid activity history.');
    return data;
  }
  async function readJson(dir, name, optional = false) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const file = await (await dir.getFileHandle(name)).getFile();
        const text = await file.text();
        // Creating a manifest handle can leave an empty file before its first commit.
        if (optional && !text.trim()) return null;
        return JSON.parse(text);
      } catch (error) {
        if (optional && error.name === 'NotFoundError') return null;
        if (error.name !== 'InvalidStateError' || attempt === 1) throw error;
      }
    }
  }
  async function writeJson(dir, name, value) {
    return writeFile(dir, name, JSON.stringify(value, null, 2));
  }
  async function writeFile(dir, name, value) {
    const stream = await (await dir.getFileHandle(name, { create: true })).createWritable();
    try { await stream.write(value); await stream.close(); }
    catch (error) { try { await stream.abort(); } catch (abortError) { console.error('Could not abort file write', abortError); } throw error; }
  }
  async function directory(rootDir, parts) {
    let dir = rootDir;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
    return dir;
  }
  class FolderStore {
    constructor(handle, owner) {
      this.handle = handle; this.owner = clone(owner); this.revision = null; this.manifest = null; this.previous = null; this.userDir = null;
      this.organizedRecords = new Set();
    }
    async userDirectory() {
      if (this.userDir) return this.userDir;
      const users = await directory(this.handle, ['qa-workspace', 'users']);
      // Reuse existing profiles without renaming or moving any saved files.
      try { this.userDir = await users.getDirectoryHandle(await segment(this.owner.email.toLowerCase(), true)); }
      catch (error) {
        if (error.name !== 'NotFoundError') throw error;
        this.userDir = await users.getDirectoryHandle(await segment(this.owner.email.toLowerCase()), { create: true });
      }
      return this.userDir;
    }
    async load() {
      this.organizedRecords.clear();
      const dir = await this.userDirectory();
      const manifest = await readJson(dir, 'workspace.json', true);
      if (!manifest) return empty(this.owner);
      if (manifest.version !== 3 || manifest.owner?.email !== this.owner.email ||
          !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files) ||
          typeof manifest.revision !== 'string') throw new Error('This folder contains an invalid or different identity workspace.');
      const data = { ...clone(manifest), records: {} };
      for (const [key, parts] of Object.entries(manifest.files)) {
        if (!Array.isArray(parts) || parts.length !== 5 ||
            !parts.every(part => typeof part === 'string' && /^[a-zA-Z0-9._-]+$/.test(part) && part !== '.' && part !== '..') ||
            parts[0] !== 'projects' || parts[2] !== 'modules' || !parts[4].endsWith('.json')) throw new Error('Invalid module file path.');
        let recordDir = dir;
        for (const part of parts.slice(0, -1)) recordDir = await recordDir.getDirectoryHandle(part);
        const record = await readJson(recordDir, parts[4]);
        const evidenceName = record.evidenceFile || parts[4].replace('.json', '-evidence.json');
        if (!/^[a-zA-Z0-9_-]+\.json$/.test(evidenceName)) throw new Error('Invalid evidence file path.');
        record.images = await readJson(await recordDir.getDirectoryHandle('evidence'), evidenceName);
        if (record.organizedFiles) this.organizedRecords.add(key);
        delete record.evidenceFile;
        delete record.organizedFiles;
        data.records[key] = record;
      }
      delete data.files; delete data.revision;
      validate(data);
      this.revision = manifest.revision; this.manifest = manifest; this.previous = clone(data);
      return data;
    }
    async save(data) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const transaction = { manifest: null };
        try { await this.saveAttempt(data, transaction); return; }
        catch (error) {
          if (error.name !== 'InvalidStateError') throw error;
          // A failed close can have committed. Verify disk before retrying any write.
          this.userDir = null;
          const live = await readJson(await this.userDirectory(), 'workspace.json', true);
          if (transaction.manifest && JSON.stringify(live) === JSON.stringify(transaction.manifest)) {
            this.manifest = clone(transaction.manifest); this.revision = live.revision; this.previous = clone(data);
            this.organizedRecords = new Set(Object.keys(data.records));
            return;
          }
          if (JSON.stringify(live) !== JSON.stringify(this.manifest)) {
            throw workspaceConflict();
          }
          if (attempt === 1) throw error;
        }
      }
    }
    async saveAttempt(data, transaction) {
      validate(data);
      if (data.owner.email !== this.owner.email) throw new Error('Workspace identity does not match the selected profile.');
      if (await this.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Folder permission is required. Reconnect the folder to save.');
      const dir = await this.userDirectory();
      const live = await readJson(dir, 'workspace.json', true);
      if (JSON.stringify(live) !== JSON.stringify(this.manifest)) throw workspaceConflict();
      const revision = crypto.randomUUID();
      const files = {};
      for (const project of data.projects) {
        const projectPart = await segment(project);
        const projectDir = await directory(dir, ['projects', projectPart]);
        await writeJson(projectDir, 'project.json', { project, owner: this.owner, modules: data.modulesMap[project] });
        await directory(projectDir, ['QA metrics']);
        await directory(projectDir, ['modules']);
        for (const module of data.modulesMap[project]) {
          const moduleDir = await directory(dir, ['projects', projectPart, 'modules', await segment(module)]);
          await writeJson(moduleDir, 'module.json', { project, module, owner: this.owner });
          for (const name of ['screenshots','mantisreport','test-cases']) await directory(moduleDir, [name]);
        }
      }
      for (const [key, record] of Object.entries(data.records)) {
        if (this.organizedRecords.has(key) && this.previous && JSON.stringify(this.previous.records[key]) === JSON.stringify(record) && this.manifest?.files[key]) {
          files[key] = this.manifest.files[key]; continue;
        }
        const parts = ['projects', await segment(record.form.project), 'modules', await segment(record.form.module || 'project-overview')];
        const moduleDir = await directory(dir, parts);
        const evidenceDir = await directory(moduleDir, ['evidence']);
        const { images, ...formRecord } = record;
        const organizedFiles = { screenshots: `screenshots/${revision}`, mantisreport: `mantisreport/${revision}`, testCases: `test-cases/${revision}` };
        const screenshotDir = await directory(moduleDir, ['screenshots', revision]);
        const screenshotLinks = [];
        const addScreenshot = async (type, index, src, alt = `${type} screenshot ${index + 1}`) => {
          const [, format, encoded] = src.match(/^data:image\/(png|jpeg|gif|webp|bmp);base64,(.*)$/is);
          const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
          const filename = `${type}-${index + 1}.${format === 'jpeg' ? 'jpg' : format}`;
          await writeFile(screenshotDir, filename, bytes);
          screenshotLinks.push(`<p><a href="${filename}">${filename}</a></p><img src="${filename}" alt="${htmlText(alt)}">`);
        };
        for (const [index, src] of images.prod.entries()) await addScreenshot('prod', index, src);
        let stepImageIndex = 0;
        for (const row of executionEvidenceRows(record.form, images)) {
          if (row.path.trim()) screenshotLinks.push(`<p class="evidence-path">${htmlText(row.path)}</p>`);
          for (const src of row.images) await addScreenshot('step', stepImageIndex++, src, `Execution screenshot for ${row.path || 'unlabeled step'}`);
        }
        for (const [index, src] of images.exec.entries()) await addScreenshot('exec', index, src);
        for (const [index, src] of images.studio.entries()) await addScreenshot('studio', index, src);
        await writeFile(screenshotDir, 'screenshots.html', documentHtml(`${record.form.project} / ${record.form.module} - Screenshots`, screenshotLinks.join('') || '<p>No screenshots.</p>'));
        const mantisDir = await directory(moduleDir, ['mantisreport', revision]);
        await writeJson(mantisDir, 'report.json', {
          project: record.form.project, module: record.form.module, owner: record.owner,
          ticket: record.form.mantisId || '', defects: record.form.defects || [],
          description: record.form.desc || '', steps: record.form.steps || '', result: record.form.res || '', correction: record.form.correction || ''
        });
        const title = `${record.form.project} / ${record.form.module}`;
        await writeFile(mantisDir, 'report.html', documentHtml(`${title} - Mantis report`, `<p>Ticket: ${htmlText(record.form.mantisId)}</p><p>${htmlText(record.form.desc)}</p><h2>Steps</h2><p>${htmlText(record.form.steps)}</p><h2>Result</h2><p>${htmlText(record.form.res)}</p><h2>Defects</h2>${htmlTable(record.form.defects || [])}`));
        const testDir = await directory(moduleDir, ['test-cases', revision]);
        await writeJson(testDir, 'test-cases.json', {
          project: record.form.project, module: record.form.module, owner: record.owner,
          generationSource: record.form.studioGenerationSource || '',
          scenarios: record.form.studioScenarios || [], testCases: record.form.studioTestCases || [], checklists: record.form.guardChecklists || {}
        });
        await writeFile(testDir, 'test-cases.html', documentHtml(`${title} - Test cases`,
          `<p>Generation source: ${htmlText(record.form.studioGenerationSource || 'Not recorded')}</p><h2>Scenarios</h2>${htmlTable(record.form.studioScenarios || [])}<h2>Test cases</h2>${htmlTable(record.form.studioTestCases || [])}`));
        await writeJson(evidenceDir, `${revision}.json`, images);
        await writeJson(moduleDir, `${revision}.json`, { ...formRecord, evidenceFile: `${revision}.json`, organizedFiles });
        files[key] = [...parts, `${revision}.json`];
      }
      const { records, ...metadata } = data;
      const manifest = { ...metadata, revision, files };
      // Commit the manifest last: an interrupted save leaves the previous complete revision readable.
      const latest = await readJson(dir, 'workspace.json', true);
      if (JSON.stringify(latest) !== JSON.stringify(live)) throw workspaceConflict();
      transaction.manifest = manifest;
      await writeJson(dir, 'workspace.json', manifest);
      this.revision = revision; this.manifest = clone(manifest); this.previous = clone(data);
      this.organizedRecords = new Set(Object.keys(data.records));
    }
    async saveMetrics(project, filename, bytes, draft) {
      if (!this.previous?.projects.includes(project)) throw new Error('Save this project to the workspace first.');
      if (!/^[a-zA-Z0-9._-]+\.xlsx$/.test(filename) || !(bytes instanceof Uint8Array)) throw new Error('Invalid metrics file.');
      if (await this.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Reconnect the folder to save metrics.');
      const dir = await this.userDirectory();
      const live = await readJson(dir, 'workspace.json', true);
      if (JSON.stringify(live) !== JSON.stringify(this.manifest)) throw workspaceConflict();
      const projectPart = await segment(project), revision = crypto.randomUUID();
      const metricsDir = await directory(dir, ['projects', projectPart, 'QA metrics', revision]);
      await writeFile(metricsDir, filename, bytes);
      await writeJson(metricsDir, 'metrics.json', { project, owner: this.owner, createdAt: new Date().toISOString(), draft });
      await writeJson(metricsDir, 'complete.json', { filename, project, owner: this.owner });
      return `qa-workspace/users/${dir.name}/projects/${projectPart}/QA metrics/${revision}/${filename}`;
    }
  }
  const api = { empty, validate, segment, recordKey, executionEvidenceRows, FolderStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LocalWorkspace = api;
})(globalThis);
