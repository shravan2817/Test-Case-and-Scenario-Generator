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

test('preview, Word and print share plain path text and compact reference page formatting', () => {
  assert.equal((indexHtml.match(/formatExecutionEvidencePath\(row\.path\)/g) || []).length, 2);
  assert.match(indexHtml, /<div class="doc-evidence-path">\$\{formatExecutionEvidencePath\(row\.path\)\}<\/div>/);
  assert.match(indexHtml, /<p class="doc-evidence-path">\$\{formatExecutionEvidencePath\(row\.path\)\}<\/p>/);
  assert.match(indexHtml, /getActiveDocHtml\(\).*buildReportDocHtml/s);
  assert.match(indexHtml, /\.doc-page\[data-doc-kind="report"\] \.doc-evidence-path \{[^}]*font-weight: 400/);
  assert.match(indexHtml, /\.doc-page\[data-doc-kind="report"\] \.doc-main-title \{[^}]*font-size: 14pt[^}]*color: #538135/);
  assert.match(indexHtml, /\.doc-page\[data-doc-kind="report"\] \.doc-text \{[^}]*line-height: 1\.15/);
  assert.match(indexHtml, /@page \{ size: 8\.5in 11in; margin: 0\.197in 0\.231in 1in 0\.394in; \}/);
  assert.match(indexHtml, /resizeImageForWord\(image, 750, 336\)/);
  assert.match(indexHtml, /max-height: 3\.5in/);
  assert.match(indexHtml, /doc-evidence-images.*doc-img-item/s);
  assert.match(indexHtml, /\.doc-page\[data-doc-kind="report"\] \.doc-evidence-images \{ display: grid; justify-items: start/);
  assert.match(indexHtml, /break-inside: auto; page-break-inside: auto/);
  assert.match(indexHtml, /doc-page" data-doc-kind="report"/);
  assert.match(indexHtml, /currentMode === 'report'\s*\? '@page \{ size: 8\.5in 11in/);
  assert.match(indexHtml, /Detailed Description about Features\/Services Tested:<\/strong><br>/);
  assert.match(indexHtml, /Actual Result: -<\/strong><br>/);
  assert.match(indexHtml, /Execution Steps: -<\/strong><br>/);
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
