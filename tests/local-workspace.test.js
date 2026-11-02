const { test } = require('node:test');
const assert = require('node:assert/strict');
const { empty, validate, segment, recordKey, FolderStore } = require('../local-workspace.js');

class Directory {
  constructor(name = 'QA', root = null) {
    this.name = name; this.root = root || this; this.directories = new Map(); this.files = new Map();
    this.permission = 'granted';
  }
  async queryPermission() { return this.root.permission; }
  async getDirectoryHandle(name, options = {}) {
    if (!this.directories.has(name)) {
      if (!options.create) throw new DOMException('Missing directory', 'NotFoundError');
      this.directories.set(name, new Directory(name, this.root));
    }
    return this.directories.get(name);
  }
  async getFileHandle(name, options = {}) {
    if (!this.files.has(name)) {
      if (!options.create) throw new DOMException('Missing file', 'NotFoundError');
      this.files.set(name, '');
    }
    return {
      getFile: async () => ({ text: async () => this.files.get(name) }),
      createWritable: async () => {
        let content;
        return {
          write: async value => {
            if (this.root.failOn && name.endsWith(this.root.failOn)) throw new DOMException('Disk full', 'QuotaExceededError');
            content = value;
          },
          close: async () => this.files.set(name, content),
          abort: async () => {}
        };
      }
    };
  }
}
const owner = { email: 'qa@example.com', username: 'QA Engineer' };
const image = 'data:image/png;base64,aGVsbG8=';
function sample() {
  const data = empty(owner);
  data.projects = ['Project / One', 'Project : One'];
  data.modulesMap = { 'Project / One': ['Login', 'Reports'], 'Project : One': ['Login'] };
  data.active = { project: data.projects[0], module: 'Login' };
  for (const project of data.projects) for (const module of data.modulesMap[project]) {
    data.records[recordKey(project, module)] = {
      owner, updatedAt: '2026-11-02T10:00:00Z',
      form: { project, module, desc: `${project} - ${module}`, studioTestCases: [{ id: 'TC_1', type: 'Functional', status: 'Pass' }] },
      images: { prod: [image], exec: [], studio: [] }
    };
  }
  return data;
}
test('round trip preserves every project, module, test result and screenshot', async () => {
  const root = new Directory(), store = new FolderStore(root, owner), data = sample();
  assert.deepEqual(await store.load(), empty(owner));
  await store.save(data);
  assert.deepEqual(await new FolderStore(root, owner).load(), data);
  const userDir = await store.userDirectory();
  const manifest = JSON.parse(userDir.files.get('workspace.json'));
  assert.equal(Object.keys(manifest.files).length, 3);
  assert.ok(Object.values(manifest.files).every(parts => parts[0] === 'projects' && parts[2] === 'modules'));
  assert.notEqual(await segment('Project / One'), await segment('Project : One'));
  assert.match(await segment('../CON<>'), /^[a-zA-Z0-9-]+$/);
});
test('profiles use distinct directories and cannot overwrite a different identity', async () => {
  const root = new Directory(), first = new FolderStore(root, owner);
  await first.load(); await first.save(sample());
  const other = { email: 'other@example.com', username: 'Other' }, second = new FolderStore(root, other);
  assert.deepEqual(await second.load(), empty(other));
  await assert.rejects(second.save(sample()), /identity does not match/);
  assert.deepEqual(await new FolderStore(root, owner).load(), sample());
});
test('permission denial and partial evidence/manifest failures never commit or fall back', async () => {
  for (const failOn of ['-evidence.json', 'workspace.json']) {
    const root = new Directory(), store = new FolderStore(root, owner), baseline = sample();
    await store.load(); await store.save(baseline);
    const changed = structuredClone(baseline);
    changed.records[recordKey(changed.projects[0], 'Login')].form.desc = 'Unsaved change';
    root.failOn = failOn;
    await assert.rejects(store.save(changed), /Disk full/);
    assert.deepEqual(await new FolderStore(root, owner).load(), baseline);
    root.failOn = null; root.permission = 'denied';
    await assert.rejects(store.save(changed), /permission is required/);
    root.permission = 'granted';
    await store.save(changed);
    assert.deepEqual(await new FolderStore(root, owner).load(), changed);
  }
});
test('stale tab cannot overwrite a newer committed revision', async () => {
  const root = new Directory(), first = new FolderStore(root, owner), second = new FolderStore(root, owner);
  await first.load(); await first.save(sample()); await second.load();
  const updated = sample(); updated.history = [{ time: 'now', action: 'Update' }];
  await first.save(updated);
  await assert.rejects(second.save(sample()), /changed in another tab/);
  assert.deepEqual(await new FolderStore(root, owner).load(), updated);
});
test('invalid backups, malformed rows, missing evidence and unsafe file paths fail explicitly', async () => {
  const data = sample();
  assert.throws(() => validate({ ...data, projects: ['missing modules'] }), /Invalid/);
  const invalid = structuredClone(data);
  invalid.records[Object.keys(invalid.records)[0]].form.studioTestCases = [null];
  assert.throws(() => validate(invalid), /Invalid/);
  const root = new Directory(), store = new FolderStore(root, owner);
  await store.load(); await store.save(data);
  const userDir = await store.userDirectory(), manifest = JSON.parse(userDir.files.get('workspace.json'));
  const parts = Object.values(manifest.files)[0];
  let moduleDir = userDir;
  for (const part of parts.slice(0, -1)) moduleDir = await moduleDir.getDirectoryHandle(part);
  moduleDir.directories.get('evidence').files.clear();
  await assert.rejects(new FolderStore(root, owner).load(), /Missing file/);
  manifest.files[Object.keys(manifest.files)[0]] = ['..', 'outside.json'];
  userDir.files.set('workspace.json', JSON.stringify(manifest));
  await assert.rejects(new FolderStore(root, owner).load(), /Invalid module file path/);
});
