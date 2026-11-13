const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

const indexHtml = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

function matched(pattern, label) {
  const result = indexHtml.match(pattern);
  assert.ok(result, `Could not find ${label} in index.html`);
  return result[0];
}

test('execution evidence paths convert arrows, preserve literal arrows and escape HTML', () => {
  const context = vm.createContext({});
  const helpers = [
    matched(/const esc = s => .*;/, 'HTML escaper'),
    matched(/const fx = t => .*;/, 'export text formatter'),
    matched(/function formatTextForExport\(text\) \{[^\n]+\}/, 'arrow formatter'),
    matched(/function formatExecutionEvidencePath\(path\) \{[^\n]+\}/, 'evidence path formatter')
  ].join('\n');
  vm.runInContext(helpers, context);

  const formatPath = path => vm.runInContext(
    `formatExecutionEvidencePath(${JSON.stringify(path)})`, context
  );
  assert.equal(formatPath('AE010101 --> Registrations'), 'AE010101 → Registrations');
  assert.equal(formatPath('Existing → path'), 'Existing → path');
  assert.equal(formatPath('A --> <script>&"\'</script>'), 'A → &lt;script&gt;&amp;&quot;&#39;&lt;/script&gt;');
});

test('studio document renders editable case fields as readable sections instead of narrow columns', () => {
  const context = vm.createContext({
    studioTestCases: [{ id: 'TC_1', type: 'Functional', pri: 'High', status: 'Pass', scenario: 'Login <test>', steps: 'First step\nSecond step', expected: 'Visible result', evidence: 'Requirement quote' }],
    studioImages: [],
    studioGenerationSource: 'Basic templates',
    syncStudioTableEditsFromDOM() {},
    statusSummaryText: () => 'Pass: 1',
    $: () => ({ value: 'Example' })
  });
  vm.runInContext([
    matched(/const esc = s => .*;/, 'HTML escaper'),
    matched(/const fx = t => .*;/, 'export text formatter'),
    matched(/function formatTextForExport\(text\) \{[^\n]+\}/, 'arrow formatter'),
    matched(/function buildStudioDocHtml\(\) \{[\s\S]*?\n    \}/, 'studio document builder')
  ].join('\n'), context);
  const html = context.buildStudioDocHtml();
  assert.match(html, /data-doc-kind="studio"/);
  assert.match(html, /Login &lt;test&gt;/);
  assert.match(html, /First step\nSecond step/);
  assert.match(html, /Visible result/);
  assert.match(html, /Requirement quote/);
  assert.doesNotMatch(html, /<table/);
});

test('preview, Word and print share plain path text and compact reference page formatting', () => {
  assert.equal((indexHtml.match(/formatExecutionEvidencePath\(row\.path\)/g) || []).length, 2);
  assert.match(indexHtml, /<div class="doc-evidence-path">\$\{formatExecutionEvidencePath\(row\.path\)\}<\/div>/);
  assert.match(indexHtml, /<p class="doc-evidence-path">\$\{formatExecutionEvidencePath\(row\.path\)\}<\/p>/);
  assert.match(indexHtml, /getActiveDocHtml\(\).*buildReportDocHtml/s);
  assert.match(indexHtml, /\.doc-page\[data-doc-kind="report"\] \.doc-evidence-path \{[^}]*font-weight: 400/);
  assert.match(indexHtml, /\.doc-page\[data-doc-kind="report"\] \.doc-main-title \{[^}]*font-size: 14pt[^}]*color: #538135/);
  assert.match(indexHtml, /\.doc-page\[data-doc-kind="report"\] \.doc-text \{[^}]*line-height: 1\.15/);
  assert.match(indexHtml, /@page \{ size: 8\.5in 11in; margin: 0\.197in 0\.231in 1in 0\.394in; \}/);
  assert.match(indexHtml, /resizeImageForWord\(image, 750, 816\)/);
  assert.match(indexHtml, /max-height: 8\.5in/);
  assert.match(indexHtml, /doc-evidence-images.*doc-img-item/s);
  assert.match(indexHtml, /\.doc-page\[data-doc-kind="report"\] \.doc-evidence-images \{ display: grid; justify-items: start/);
  assert.match(indexHtml, /break-inside: auto; page-break-inside: auto/);
  assert.match(indexHtml, /doc-page" data-doc-kind="report"/);
  assert.match(indexHtml, /currentMode === 'report'\s*\? '@page \{ size: 8\.5in 11in/);
  assert.match(indexHtml, /Detailed Description about Features\/Services Tested:<\/strong><br>/);
  assert.match(indexHtml, /Actual Result: -<\/strong><br>/);
  assert.match(indexHtml, /Execution Steps: -<\/strong><br>/);
});

test('Word screenshot layout preserves original pixels and uses readable page bounds without upscaling', async () => {
  const dimensions = { portrait: [1080, 1920], landscape: [1920, 1080], small: [160, 90] };
  const context = vm.createContext({ Image: class {
    set src(value) {
      if (!dimensions[value]) { this.onerror(); return; }
      [this.naturalWidth, this.naturalHeight] = dimensions[value];
      this.onload();
    }
  } });
  vm.runInContext(matched(/function resizeImageForWord\([^]*?\n    \}/, 'Word image layout'), context);
  const portrait = await context.resizeImageForWord('portrait', 750, 816);
  assert.equal(portrait.src, 'portrait');
  assert.equal(portrait.height, 816);
  assert.equal(portrait.width, 459);
  const landscape = await context.resizeImageForWord('landscape', 750, 816);
  assert.equal(landscape.src, 'landscape');
  assert.equal(landscape.width, 750);
  assert.ok(Math.abs(landscape.height / landscape.width - 1080 / 1920) < 0.002);
  const small = await context.resizeImageForWord('small');
  assert.equal(small.width, 160);
  assert.equal(small.height, 90);
  await assert.rejects(context.resizeImageForWord('damaged'), /Replace the damaged image/);
});

test('watermark uses a transparent local asset behind content on app and report screens', () => {
  const logo = readFileSync(join(__dirname, '..', 'assets', 'apcfss-logo.png'));
  const watermark = readFileSync(join(__dirname, '..', 'assets', 'apcfss-watermark.png'));
  assert.ok(logo.length > 10000);
  assert.ok(watermark.length > 10000);
  assert.match(indexHtml, /assets\/apcfss-watermark\.png/);
  assert.match(indexHtml, /doc-page \.doc-watermark \{ position: absolute; z-index: 0/);
  assert.match(indexHtml, /\.doc-page\[data-doc-kind="report"\] \.doc-watermark \{ position: fixed; top: 50%; left: 50%;[^}]*width: min\(58%, 4\.58in\)/);
  const appCss = readFileSync(join(__dirname, '..', 'workspace.css'), 'utf8');
  const metricsCss = readFileSync(join(__dirname, '..', 'quality-metrics.css'), 'utf8');
  assert.match(appCss, /\.app-shell::before[^}]*pointer-events:none[^}]*assets\/apcfss-watermark\.png/);
  assert.match(metricsCss, /body::before[^}]*pointer-events:none[^}]*assets\/apcfss-watermark\.png/);
  assert.match(indexHtml, /fetch\(new URL\('assets\/apcfss-watermark\.png', document\.baseURI\)\)/);
});
