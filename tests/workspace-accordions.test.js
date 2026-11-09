const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const indexHtml = readFileSync(join(__dirname, '..', 'index.html'), 'utf8').replace(/\r/g, '');
const workspaceUi = readFileSync(join(__dirname, '..', 'workspace-ui.js'), 'utf8').replace(/\r/g, '');

class Element {
  constructor(id = '', classes = []) {
    this.id = id;
    this.children = [];
    this.attributes = new Map();
    this.listeners = {};
    this.classNames = new Set(classes);
    this.classList = {
      contains: name => this.classNames.has(name),
      toggle: (name, force) => {
        const enabled = force ?? !this.classNames.has(name);
        if (enabled) this.classNames.add(name);
        else this.classNames.delete(name);
        return enabled;
      }
    };
  }
  append(child) {
    child.parentNode?.children.splice(child.parentNode.children.indexOf(child), 1);
    child.parentNode = this;
    this.children.push(child);
  }
  prepend(child) {
    child.parentNode?.children.splice(child.parentNode.children.indexOf(child), 1);
    child.parentNode = this;
    this.children.unshift(child);
  }
  querySelector(selector) {
    return this.children.find(child => selector === '.heading-label' && child.classList.contains('heading-label')) || null;
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  toggleAttribute(name, force) {
    if (force) this.attributes.set(name, '');
    else this.attributes.delete(name);
  }
  contains() { return false; }
  focus() {}
  addEventListener(name, listener) { this.listeners[name] = listener; }
  click() { this.listeners.click?.(); }
}

function accordionCards() {
  const cards = ['secContext', 'secDescProd', 'secStepsExec', 'secDefects', 'secStudioInput', 'secStudioOutput'].map(id => {
    const card = new Element(id, ['card']);
    const header = new Element('', ['card-title']);
    header.append(new Element('', ['heading-label']));
    header.append(new Element('', ['card-action']));
    card.append(header);
    const input = new Element('', ['input']);
    card.append(input);
    return { card, header, input };
  });
  const document = {
    querySelectorAll: () => cards.map(({ card }) => card),
    createElement: () => new Element()
  };
  const codeStart = workspaceUi.indexOf('function initializeCardAccordions()');
  const codeEnd = workspaceUi.indexOf('initializeCardAccordions();', codeStart) + 'initializeCardAccordions();'.length;
  assert.ok(codeStart >= 0 && codeEnd > codeStart, 'Accordion initializer should be present');
  const context = vm.createContext({ document });
  vm.runInContext(`${workspaceUi.slice(codeStart, codeEnd)}\ninitializeCardAccordions();`, context);
  return cards;
}

test('all main cards start open and their accessible toggles preserve form nodes', () => {
  const cards = accordionCards();
  assert.equal(cards.length, 6);
  for (const { card, header, input } of cards) {
    const toggle = header.children[0];
    const content = card.children[1];
    assert.equal(toggle.type, 'button');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(toggle.getAttribute('aria-controls'), content.id);
    assert.equal(content.getAttribute('aria-hidden'), 'false');
    assert.equal(content.children[0].children[0], input);

    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(content.getAttribute('aria-hidden'), 'true');
    assert.equal(content.attributes.has('inert'), true);
    assert.equal(card.classList.contains('is-collapsed'), true);
    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(content.getAttribute('aria-hidden'), 'false');
    assert.equal(content.attributes.has('inert'), false);
    assert.equal(content.children[0].children[0], input);
  }
});

test('section navigation remains horizontal and responsive without a sidebar menu', () => {
  assert.match(indexHtml, /<nav class="section-jump-nav" aria-label="Workspace sections">/);
  assert.match(indexHtml, /Execution Report<\/button>[\s\S]*Test Studio<\/button>[\s\S]*Quality Metrics<\/button>/);
  assert.doesNotMatch(indexHtml, /workspace-sidebar|mobileNavBackdrop|mobileNavToggle/);
  assert.match(workspaceUi, /document\.querySelector\('\.section-jump-nav'\)/);
});

test('save indicator distinguishes pending folder writes, in-memory drafts, backups and failures', () => {
  const match = indexHtml.match(/function setBadgeState\(state\) \{[\s\S]*?\n    \}/);
  assert.ok(match, 'Save state renderer should be present');
  const source = match[0];
  const node = { setAttribute(name, value) { this[name] = value; } };
  const context = vm.createContext({ $: () => node, folderStore: {} });
  vm.runInContext(source, context);

  context.setBadgeState('pending');
  assert.match(node.innerHTML, /Auto save pending/);
  assert.match(node.innerHTML, /save-status-dots/);
  context.setBadgeState('saving');
  assert.match(node.innerHTML, /Saving to folder/);
  context.setBadgeState('saved');
  assert.match(node.innerHTML, /Saved to folder/);
  context.setBadgeState('backup');
  assert.match(node.innerHTML, /edits remain in memory/);
  context.setBadgeState('error');
  assert.match(node.innerHTML, /Save failed/);
  context.folderStore = null;
  context.setBadgeState('pending');
  assert.match(node.innerHTML, /In memory only/);
  assert.match(indexHtml, /@keyframes saveDotPulse/);
  assert.match(indexHtml, /prefers-reduced-motion: reduce/);
});
