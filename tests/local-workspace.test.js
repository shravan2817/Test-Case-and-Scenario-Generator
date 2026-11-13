const { test } = require('node:test');
const assert = require('node:assert/strict');
const { empty, validate, segment, recordKey, executionEvidenceRows, FolderStore } = require('../local-workspace.js');

class Directory {
  constructor(name = 'QA', root = null) {
    this.name = name; this.root = root || this; this.directories = new Map(); this.files = new Map();
    this.permission = 'granted';
  }
  async queryPermission() { return this.root.permission; }
  async *entries() {
    if (this.root.unavailable) throw new DOMException('Selected folder moved', 'NotFoundError');
    yield* this.directories;
    yield* this.files;
  }
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
      getFile: async () => {
        const content = this.files.get(name);
        return { text: async () => {
          await this.root.fileOperation?.({ phase: 'read', name, directory: this });
          if (content !== this.files.get(name)) throw new DOMException('File changed since it was read from disk', 'InvalidStateError');
          return content;
        } };
      },
      createWritable: async () => {
        await this.root.fileOperation?.({ phase: 'create', name, directory: this });
        let content;
        return {
          write: async value => {
            if (this.root.failOn && (name.endsWith(this.root.failOn) || this.name === this.root.failOn)) throw new DOMException('Disk full', 'QuotaExceededError');
            await this.root.fileOperation?.({ phase: 'write', name, directory: this });
            content = value;
          },
          close: async () => {
            await this.root.fileOperation?.({ phase: 'close', name, directory: this });
            this.files.set(name, content);
            await this.root.fileOperation?.({ phase: 'committed', name, directory: this });
          },
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
test('revoked folder permission is reported as a reconnect-required error', async () => {
  const root = new Directory(), store = new FolderStore(root, owner);
  await store.load();
  root.permission = 'denied';
  await assert.rejects(store.save(sample()), error => error.name === 'NotAllowedError' && /permission/i.test(error.message));
});
test('missing referenced folders, records and evidence are distinguished from a missing root', async () => {
  for (const missing of ['folder', 'record', 'evidence', 'root']) {
    const root = new Directory(), store = new FolderStore(root, owner);
    await store.load();
    await store.save(sample());
    const userDir = await store.userDirectory();
    const committed = userDir.files.get('workspace.json');
    const manifest = JSON.parse(committed);
    const parts = Object.values(manifest.files)[0];
    let dir = userDir;
    for (const part of parts.slice(0, -1)) dir = dir.directories.get(part);
    if (missing === 'folder' || missing === 'root') userDir.directories.delete('projects');
    else if (missing === 'record') dir.files.delete(parts[4]);
    else dir.directories.delete('evidence');
    if (missing === 'root') root.unavailable = true;
    await assert.rejects(new FolderStore(root, owner).load(), error =>
      missing === 'root' ? error.name === 'NotFoundError' :
        error.name === 'WorkspaceIncompleteError' && error.cause.name === 'NotFoundError' &&
        /workspace is incomplete.*missing.*complete JSON backup/i.test(error.message));
    assert.equal(userDir.files.get('workspace.json'), committed);
  }
  const root = new Directory();
  root.getDirectoryHandle = async () => { throw new DOMException('Selected folder moved', 'NotFoundError'); };
  await assert.rejects(new FolderStore(root, owner).load(), error =>
    error.name === 'NotFoundError' && /workspace profile folder/.test(error.workspaceStep));
});
test('round trip preserves generated source and validated requirement evidence as editable test data', async () => {
  const root = new Directory(), store = new FolderStore(root, owner), data = sample();
  const form = data.records[recordKey('Project / One', 'Login')].form;
  form.studioGenerationSource = 'AI with Ollama (llama3.2:latest)';
  form.studioTestCases[0].evidence = 'A user can submit a request';
  form.studioScenarios = [{ id: 'TS_01', cat: 'Functional', pri: 'High', desc: 'Submit a request', evidence: 'submit a request' }];
  validate(data);
  await store.load(); await store.save(data);
  const restored = await new FolderStore(root, owner).load();
  assert.equal(restored.records[recordKey('Project / One', 'Login')].form.studioGenerationSource, form.studioGenerationSource);
  assert.equal(restored.records[recordKey('Project / One', 'Login')].form.studioTestCases[0].evidence, form.studioTestCases[0].evidence);
  assert.equal(restored.records[recordKey('Project / One', 'Login')].form.studioScenarios[0].evidence, 'submit a request');
});
test('module folders expose real screenshots and readable reports/test cases without changing restore data', async () => {
  const root=new Directory(),store=new FolderStore(root,owner),data=sample();
  const key=recordKey(data.projects[0],'Login');
  data.records[key].form.defects=[{id:'BUG-1',desc:'<script>alert(1)</script>'}];
  await store.load();await store.save(data);
  let dir=await store.userDirectory();
  const manifest=JSON.parse(dir.files.get('workspace.json')),parts=manifest.files[key];
  const projectDir=dir.directories.get('projects').directories.get(parts[1]);
  assert.equal(JSON.parse(projectDir.files.get('project.json')).project,data.projects[0]);
  assert.ok(projectDir.directories.has('QA metrics'));
  for(const part of parts.slice(0,-1))dir=dir.directories.get(part);
  const record=JSON.parse(dir.files.get(parts[4]));
  const revision=parts[4].replace('.json','');
  assert.equal(record.organizedFiles.screenshots,`screenshots/${revision}`);
  const shots=dir.directories.get('screenshots').directories.get(revision);
  assert.deepEqual(shots.files.get('prod-1.png'),Uint8Array.from(Buffer.from('hello')));
  assert.match(shots.files.get('screenshots.html'),/prod-1.png/);
  const report=dir.directories.get('mantisreport').directories.get(revision);
  assert.match(report.files.get('report.html'),/&lt;script&gt;/);
  assert.doesNotMatch(report.files.get('report.html'),/<script>/);
  const tests=dir.directories.get('test-cases').directories.get(revision);
  assert.match(tests.files.get('test-cases.html'),/TC_1/);
  assert.deepEqual(await new FolderStore(root,owner).load(),data);
});
test('execution screenshot paths stay paired and legacy uncaptioned images survive round trips', async () => {
  const root = new Directory(), store = new FolderStore(root, owner), data = sample();
  const groupedKey = recordKey(data.projects[0], 'Login');
  const legacyKey = recordKey(data.projects[0], 'Reports');
  data.records[groupedKey].form.execEvidenceRows = [
    { id: 'step-1', path: 'AE010101 --> Beneficiary Registrations' },
    { id: 'step-2', path: 'AE010101 --> Beneficiary Registrations --> Aadhaar <Verification & Update>' }
  ];
  data.records[groupedKey].images.execEvidence = {
    'step-1': [image, image],
    'step-2': [image]
  };
  data.records[legacyKey].images.exec = [image];
  assert.deepEqual(executionEvidenceRows(data.records[groupedKey].form, data.records[groupedKey].images), [
    { id: 'step-1', path: 'AE010101 --> Beneficiary Registrations', images: [image, image] },
    { id: 'step-2', path: 'AE010101 --> Beneficiary Registrations --> Aadhaar <Verification & Update>', images: [image] }
  ]);
  assert.deepEqual(executionEvidenceRows(data.records[legacyKey].form, data.records[legacyKey].images), []);
  const orphanedImages = structuredClone(data);
  delete orphanedImages.records[groupedKey].form.execEvidenceRows;
  assert.throws(() => validate(orphanedImages), /Invalid module record or evidence/);
  await store.load();
  await store.save(data);
  assert.deepEqual(await new FolderStore(root, owner).load(), data);

  const userDir = await store.userDirectory();
  const manifest = JSON.parse(userDir.files.get('workspace.json'));
  const parts = manifest.files[groupedKey];
  let moduleDir = userDir;
  for (const part of parts.slice(0, -1)) moduleDir = moduleDir.directories.get(part);
  const screenshots = moduleDir.directories.get('screenshots').directories.get(parts[4].replace('.json', ''));
  const gallery = screenshots.files.get('screenshots.html');
  assert.ok(gallery.indexOf('<p class="evidence-path">AE010101 → Beneficiary Registrations</p>') < gallery.indexOf('step-1.png'));
  assert.match(gallery, /AE010101 → Beneficiary Registrations → Aadhaar &lt;Verification &amp; Update&gt;/);
  assert.doesNotMatch(gallery, /Navigation path:/);
  assert.doesNotMatch(gallery, /<p class="evidence-path"><strong>/);
  assert.ok(gallery.indexOf('Aadhaar Verification') < gallery.indexOf('step-3.png'));

  const legacyParts = manifest.files[legacyKey];
  let legacyDir = userDir;
  for (const part of legacyParts.slice(0, -1)) legacyDir = legacyDir.directories.get(part);
  const legacyGallery = legacyDir.directories.get('screenshots').directories.get(legacyParts[4].replace('.json', ''));
  assert.ok(legacyGallery.files.has('exec-1.png'));
});
test('organized export write failure keeps previous committed module and all user edits remain available',async()=>{
  const root=new Directory(),store=new FolderStore(root,owner),data=sample();
  await store.load();await store.save(data);
  const changed=structuredClone(data);changed.records[recordKey(data.projects[0],'Login')].form.desc='Retained edit';
  root.failOn='report.html';
  await assert.rejects(store.save(changed),/Disk full/);
  assert.deepEqual(await new FolderStore(root,owner).load(),data);
  assert.equal(changed.records[recordKey(data.projects[0],'Login')].form.desc,'Retained edit');
});
test('project metrics exports preserve previous exports and fail explicitly on denial/quota/conflict',async()=>{
  const root=new Directory(),store=new FolderStore(root,owner),data=sample();
  await store.load();await store.save(data);
  const filename='Project_2026-01_qualitymetrics.xlsx',bytes=new Uint8Array([80,75,1,2]),draft={project:data.projects[0],month:'2026-01'};
  const first=await store.saveMetrics(data.projects[0],filename,bytes,draft);
  const second=await store.saveMetrics(data.projects[0],filename,bytes,draft);
  assert.notEqual(first,second);
  let metrics=await store.userDirectory();
  metrics=metrics.directories.get('projects').directories.get(await segment(data.projects[0])).directories.get('QA metrics');
  assert.equal(metrics.directories.size,2);
  for(const folder of metrics.directories.values()){
    assert.deepEqual(folder.files.get(filename),bytes);
    assert.deepEqual(JSON.parse(folder.files.get('metrics.json')).draft,draft);
    assert.equal(JSON.parse(folder.files.get('complete.json')).filename,filename);
  }
  root.permission='denied';await assert.rejects(store.saveMetrics(data.projects[0],filename,bytes,draft),/Reconnect/);
  root.permission='granted';root.failOn='metrics.json';
  await assert.rejects(store.saveMetrics(data.projects[0],filename,bytes,draft),/Disk full/);
  assert.equal([...metrics.directories.values()].filter(folder=>folder.files.has('complete.json')).length,2);
  root.failOn=null;
  const other=new FolderStore(root,owner);await other.load();data.history=[{action:'Concurrent edit',time:'now'}];await other.save(data);
  await assert.rejects(store.saveMetrics(data.projects[0],filename,bytes,draft),/changed in another/);
});
test('old records get organized copies on save even when unchanged, without deleting their old files',async()=>{
  const root=new Directory(),store=new FolderStore(root,owner),data=sample();
  await store.load();await store.save(data);
  const user=await store.userDirectory(),manifest=JSON.parse(user.files.get('workspace.json'));
  const key=recordKey(data.projects[0],'Login'),parts=manifest.files[key];
  let dir=user;for(const part of parts.slice(0,-1))dir=dir.directories.get(part);
  const old=JSON.parse(dir.files.get(parts[4]));delete old.organizedFiles;dir.files.set(parts[4],JSON.stringify(old));
  const reopened=new FolderStore(root,owner),loaded=await reopened.load();
  await reopened.save(loaded);
  const updated=JSON.parse(user.files.get('workspace.json'));
  assert.notEqual(updated.files[key][4],parts[4]);
  assert.ok(dir.files.has(parts[4]));
  assert.deepEqual(await new FolderStore(root,owner).load(),data);
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
  for (const failOn of ['evidence', 'workspace.json']) {
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
test('new folder paths stay compact and existing long-name profiles remain readable', async () => {
  assert.ok((await segment('A very long project name '.repeat(20))).length <= 25);
  const root = new Directory(), data = sample();
  const users = await (await root.getDirectoryHandle('qa-workspace', { create: true })).getDirectoryHandle('users', { create: true });
  const legacyDir = await users.getDirectoryHandle(await segment(owner.email, true), { create: true });
  const store = new FolderStore(root, owner);
  assert.equal(await store.userDirectory(), legacyDir);
  await store.load(); await store.save(data);
  assert.deepEqual(await new FolderStore(root, owner).load(), data);
  const manifest = JSON.parse(legacyDir.files.get('workspace.json'));
  const parts = Object.values(manifest.files)[0];
  let moduleDir = legacyDir;
  for (const part of parts.slice(0, -1)) moduleDir = await moduleDir.getDirectoryHandle(part);
  const record = JSON.parse(moduleDir.files.get(parts[4]));
  const evidence = moduleDir.directories.get('evidence');
  const content = evidence.files.get(record.evidenceFile);
  evidence.files.delete(record.evidenceFile);
  delete record.evidenceFile;
  evidence.files.set(parts[4].replace('.json', '-evidence.json'), content);
  moduleDir.files.set(parts[4], JSON.stringify(record));
  assert.deepEqual(await new FolderStore(root, owner).load(), data);
});
test('stale tab cannot overwrite a newer committed revision', async () => {
  const root = new Directory(), first = new FolderStore(root, owner), second = new FolderStore(root, owner);
  await first.load(); await first.save(sample()); await second.load();
  const updated = sample(); updated.history = [{ time: 'now', action: 'Update' }];
  await first.save(updated);
  await assert.rejects(second.save(sample()), /changed in another tab/);
  assert.deepEqual(await new FolderStore(root, owner).load(), updated);
});
test('a stale File snapshot is reacquired before parsing the manifest', async () => {
  const root = new Directory(), store = new FolderStore(root, owner);
  await store.load(); await store.save(sample());
  let changed = false;
  root.fileOperation = ({ phase, name, directory }) => {
    if (!changed && phase === 'read' && name === 'workspace.json') {
      changed = true;
      directory.files.set(name, directory.files.get(name) + '\n');
    }
  };
  assert.deepEqual(await new FolderStore(root, owner).load(), sample());
  assert.equal(changed, true);
});
test('adding a project to a reopened workspace does not mutate the disk-conflict baseline', async () => {
  const root = new Directory(), first = new FolderStore(root, owner);
  await first.load(); await first.save(sample());
  const store = new FolderStore(root, owner), data = await store.load();
  data.projects.push('New project');
  data.modulesMap['New project'] = ['New module'];
  data.history.unshift({ time: 'now', action: 'Added project' });
  await store.save(data);
  data.projects.push('Another project');
  data.modulesMap['Another project'] = [];
  await store.save(data);
  assert.deepEqual(await new FolderStore(root, owner).load(), data);
});
test('transient cached-state errors at each write stage recover without losing evidence', async () => {
  for (const phase of ['create', 'write', 'close', 'committed']) {
    for (const location of ['evidence', 'module', 'manifest']) {
      const root = new Directory(), store = new FolderStore(root, owner);
      await store.load(); await store.save(sample());
      const changed = sample();
      changed.records[Object.keys(changed.records)[0]].form.desc = 'New unsaved edit';
      let failed = false, manifestCommits = 0;
      root.fileOperation = event => {
        if (event.phase === 'committed' && event.name === 'workspace.json') manifestCommits++;
        const matches = location === 'manifest' ? event.name === 'workspace.json' :
          location === 'evidence' ? event.directory.name === 'evidence' :
            event.name !== 'workspace.json' && event.directory.name !== 'evidence';
        if (!failed && event.phase === phase && matches) {
          failed = true;
          throw new DOMException('Cached interface state changed on disk', 'InvalidStateError');
        }
      };
      await store.save(changed);
      assert.equal(failed, true, `${phase} / ${location}`);
      assert.equal(manifestCommits, 1, `${phase} / ${location}`);
      assert.deepEqual(await new FolderStore(root, owner).load(), changed);
    }
  }
});
test('cached-state recovery refuses a concurrent disk edit even with an unchanged revision', async () => {
  const root = new Directory(), store = new FolderStore(root, owner);
  await store.load(); await store.save(sample());
  const userDir = await store.userDirectory(), disk = JSON.parse(userDir.files.get('workspace.json'));
  disk.history = [{ time: 'now', action: 'External edit' }];
  const changed = sample(); changed.history = [{ time: 'now', action: 'Memory edit' }];
  root.fileOperation = ({ phase, name }) => {
    if (phase === 'create' && name === 'workspace.json') {
      userDir.files.set('workspace.json', JSON.stringify(disk));
      throw new DOMException('Cached interface state changed on disk', 'InvalidStateError');
    }
  };
  await assert.rejects(store.save(changed), error => error.name === 'WorkspaceConflictError' && /changed in another tab/.test(error.message));
  assert.deepEqual(JSON.parse(userDir.files.get('workspace.json')), disk);
  assert.equal(changed.history[0].action, 'Memory edit');
});
test('persistent cached-state errors stop after a bounded retry and keep the committed workspace', async () => {
  const root = new Directory(), store = new FolderStore(root, owner), baseline = sample();
  await store.load(); await store.save(baseline);
  let attempts = 0;
  root.fileOperation = ({ phase, name }) => {
    if (phase === 'create' && name === 'workspace.json') {
      attempts++;
      throw new DOMException('Cached interface state changed on disk', 'InvalidStateError');
    }
  };
  const changed = sample(); changed.history = [{ time: 'now', action: 'Retained edit' }];
  await assert.rejects(store.save(changed), { name: 'InvalidStateError' });
  assert.equal(attempts, 2);
  root.fileOperation = null;
  assert.deepEqual(await new FolderStore(root, owner).load(), baseline);
});
test('a stale first-manifest creation retries an empty uncommitted file safely', async () => {
  const root = new Directory(), store = new FolderStore(root, owner);
  await store.load();
  let failed = false;
  root.fileOperation = ({ phase, name }) => {
    if (!failed && phase === 'create' && name === 'workspace.json') {
      failed = true;
      throw new DOMException('Cached interface state changed on disk', 'InvalidStateError');
    }
  };
  await store.save(sample());
  assert.equal(failed, true);
  assert.deepEqual(await new FolderStore(root, owner).load(), sample());
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
  await assert.rejects(new FolderStore(root, owner).load(), error =>
    error.name === 'WorkspaceIncompleteError' && /saved screenshots or evidence is missing/.test(error.message));
  manifest.files[Object.keys(manifest.files)[0]] = ['..', 'outside.json'];
  userDir.files.set('workspace.json', JSON.stringify(manifest));
  await assert.rejects(new FolderStore(root, owner).load(), /Invalid module file path/);
});
