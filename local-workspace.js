(function (root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const recordKey = (project, module) => JSON.stringify([project, module]);
  function empty(owner) {
    return { version: 3, owner: clone(owner), projects: [], modulesMap: {}, records: {}, active: null, history: [] };
  }
  async function segment(name) {
    const bytes = new TextEncoder().encode(name);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const slug = name.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
    return `${slug}-${hash}`;
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
      if (!object(record) || !object(record.form) || !object(record.images) ||
          !data.projects.includes(record.form.project) ||
          (record.form.module !== '' && !data.modulesMap[record.form.project].includes(record.form.module)) ||
          key !== recordKey(record.form.project, record.form.module) ||
          !object(record.owner) || typeof record.owner.email !== 'string' ||
          !['prod', 'exec', 'studio'].every(type => Array.isArray(record.images[type]) &&
            record.images[type].every(src => typeof src === 'string' && /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/i.test(src))) ||
          !['studioScenarios', 'studioTestCases', 'defects'].every(field => record.form[field] === undefined || Array.isArray(record.form[field])) ||
          (record.form.guardChecklists !== undefined && (!object(record.form.guardChecklists) ||
            !['reqMatch', 'exploratory', 'regression'].every(field => Array.isArray(record.form.guardChecklists[field]))))) {
        throw new Error('Invalid module record or evidence.');
      }
      const form = record.form;
      const strings = ['project', 'module', 'mantisId', 'build', 'url', 'login', 'desc', 'correction', 'steps', 'res',
        'studioScopeType', 'studioUiElements', 'studioImpactedAreas', 'studioChangeSummary'];
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
    try { return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text()); }
    catch (error) { if (optional && error.name === 'NotFoundError') return null; throw error; }
  }
  async function writeJson(dir, name, value) {
    const stream = await (await dir.getFileHandle(name, { create: true })).createWritable();
    try { await stream.write(JSON.stringify(value, null, 2)); await stream.close(); }
    catch (error) { try { await stream.abort(); } catch (abortError) { console.error('Could not abort file write', abortError); } throw error; }
  }
  async function directory(rootDir, parts) {
    let dir = rootDir;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
    return dir;
  }
  class FolderStore {
    constructor(handle, owner) {
      this.handle = handle; this.owner = clone(owner); this.revision = null; this.manifest = null; this.previous = null;
    }
    async userDirectory() {
      return directory(this.handle, ['qa-workspace', 'users', await segment(this.owner.email.toLowerCase())]);
    }
    async load() {
      const dir = await this.userDirectory();
      const manifest = await readJson(dir, 'workspace.json', true);
      if (!manifest) return empty(this.owner);
      if (manifest.version !== 3 || manifest.owner?.email !== this.owner.email ||
          !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files) ||
          typeof manifest.revision !== 'string') throw new Error('This folder contains an invalid or different identity workspace.');
      const data = { ...manifest, records: {} };
      for (const [key, parts] of Object.entries(manifest.files)) {
        if (!Array.isArray(parts) || parts.length !== 5 ||
            !parts.every(part => typeof part === 'string' && /^[a-zA-Z0-9._-]+$/.test(part) && part !== '.' && part !== '..') ||
            parts[0] !== 'projects' || parts[2] !== 'modules' || !parts[4].endsWith('.json')) throw new Error('Invalid module file path.');
        let recordDir = dir;
        for (const part of parts.slice(0, -1)) recordDir = await recordDir.getDirectoryHandle(part);
        const record = await readJson(recordDir, parts[4]);
        const evidenceName = parts[4].replace('.json', '-evidence.json');
        record.images = await readJson(await recordDir.getDirectoryHandle('evidence'), evidenceName);
        data.records[key] = record;
      }
      delete data.files; delete data.revision;
      validate(data);
      this.revision = manifest.revision; this.manifest = manifest; this.previous = clone(data);
      return data;
    }
    async save(data) {
      validate(data);
      if (data.owner.email !== this.owner.email) throw new Error('Workspace identity does not match the selected profile.');
      if (await this.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Folder permission is required. Reconnect the folder to save.');
      const dir = await this.userDirectory();
      const live = await readJson(dir, 'workspace.json', true);
      if ((live?.revision || null) !== this.revision) throw new Error('The folder changed in another tab or app. Download a backup of your edits, then reopen the folder.');
      const revision = crypto.randomUUID();
      const files = {};
      for (const project of data.projects) {
        const projectPart = await segment(project);
        await directory(dir, ['projects', projectPart, 'modules']);
        for (const module of data.modulesMap[project]) await directory(dir, ['projects', projectPart, 'modules', await segment(module)]);
      }
      for (const [key, record] of Object.entries(data.records)) {
        if (this.previous && JSON.stringify(this.previous.records[key]) === JSON.stringify(record) && this.manifest?.files[key]) {
          files[key] = this.manifest.files[key]; continue;
        }
        const parts = ['projects', await segment(record.form.project), 'modules', await segment(record.form.module || 'project-overview')];
        const moduleDir = await directory(dir, parts);
        const evidenceDir = await directory(moduleDir, ['evidence']);
        const { images, ...formRecord } = record;
        await writeJson(evidenceDir, `${revision}-evidence.json`, images);
        await writeJson(moduleDir, `${revision}.json`, formRecord);
        files[key] = [...parts, `${revision}.json`];
      }
      const { records, ...metadata } = data;
      const manifest = { ...metadata, revision, files };
      // Commit the manifest last: an interrupted save leaves the previous complete revision readable.
      const latest = await readJson(dir, 'workspace.json', true);
      if ((latest?.revision || null) !== this.revision) throw new Error('Concurrent folder change detected. Your edits have not been committed.');
      await writeJson(dir, 'workspace.json', manifest);
      this.revision = revision; this.manifest = manifest; this.previous = clone(data);
    }
  }
  const api = { empty, validate, segment, recordKey, FolderStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LocalWorkspace = api;
})(globalThis);
