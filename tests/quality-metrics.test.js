const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../quality-metrics');
const template = require('../quality-metrics-template');

function draft() {
  const data = model.newDraft();
  data.month = '2026-01';data.project = 'Project';
  return data;
}
test('arbitrary insertions preserve neighbouring entries, week membership, merges and export formulas',()=>{
  for(const kind of ['engineering','operations']) {
    const data=draft();data[kind]={E3:'First',D3:'2026-01-01',E4:'Second',E42:'Next week'};
    assert.equal(model.insertRow(data,kind,4,'before'),4);
    data[kind].E4='Between';data[kind].F4='2';
    assert.equal(data[kind].E5,'Second');
    assert.equal(data[kind].E43,'Next week');
    assert.equal(model.insertRow(data,kind,4,'after'),5);
    assert.equal(data[kind].E6,'Second');
    assert.equal(model.insertRow(data,kind,3,'before'),3);
    assert.equal(data[kind].E4,'First');
    assert.equal(model.rowLayout(data,kind).rows[0].week,0);
    const parts=model.workbookParts(template,data),xml=parts[template.sheets[kind==='engineering'?0:1].path];
    assert.match(cell(xml,'E5'),/Between/);
    assert.match(cell(xml,kind==='engineering'?'N5':'O5'),/<f>/);
    assert.ok(model.mergeRanges(template,data,kind).includes('A3:A79'));
    const clone=structuredClone(data);
    assert.deepEqual(model.rowLayout(clone,kind).rows,model.rowLayout(data,kind).rows);
  }
});
test('metrics filename follows project_month_qualitymetrics.xlsx with safe names',()=>{
  assert.equal(model.exportFilename('My Project','2026-01'),'My_Project_2026-01_qualitymetrics.xlsx');
  assert.equal(model.exportFilename('  Project/One:*  ','2026-11'),'Project_One_2026-11_qualitymetrics.xlsx');
  assert.equal(model.exportFilename('..','2026-01'),'project_2026-01_qualitymetrics.xlsx');
});
function cell(xml, ref) {
  return xml.match(new RegExp(`<c\\b[^>]*\\br="${ref}"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`))?.[0];
}
function unzip(bytes) {
  const entries = {}, decoder = new TextDecoder();
  let offset = 0;
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  while (view.getUint32(offset,true) === 0x04034b50) {
    assert.equal(view.getUint16(offset+8,true),0);
    const length = view.getUint32(offset+18,true), nameLength = view.getUint16(offset+26,true), extra = view.getUint16(offset+28,true);
    const name = decoder.decode(bytes.slice(offset+30,offset+30+nameLength)), start = offset+30+nameLength+extra;
    const content = bytes.slice(start,start+length);
    assert.equal(model.crc32(content),view.getUint32(offset+14,true),name);
    entries[name] = decoder.decode(content);
    offset=start+length;
  }
  assert.equal(view.getUint32(offset,true),0x02014b50);
  assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);
  assert.equal(view.getUint16(bytes.length-12,true),Object.keys(entries).length);
  return entries;
}
test('template contains only layout, generic labels and formulas, never source business data or author metadata', () => {
  const text = JSON.stringify(template);
  assert.doesNotMatch(text,/JNB|Nivas|Purchases|APRS|APBRAGCET|OPS000|1491|Downloads|Incident 1|customXml|docProps|sharedStrings|calcChain/i);
  for (const sheet of template.sheets.slice(0,2)) {
    const xml = template.parts[sheet.path];
    for (const ref of ['A3','B3','D3','E3','F3','G3','E76','F76']) assert.doesNotMatch(cell(xml,ref),/<[vf]>|<is>/);
  }
  assert.equal(template.sheets[0].merges.length,36);
  assert.equal(template.sheets[1].merges.length,38);
  assert.deepEqual(template.sheets[2].merges,['A3:S36']);
});
test('export preserves all merge ranges, row heights, widths, style assignments and style/theme parts', () => {
  const data = draft();
  data.engineering = {D3:'2026-01-02',E3:'Feature',F3:'2.5',G3:'2',H3:'5',I3:'4'};
  data.operations = {D3:'2026-01-02',E3:'Feature',F3:'10',G3:'20',H3:'30',I3:'40',J3:'10',K3:'2',L3:'2',M3:'6'};
  const parts = model.workbookParts(template,data);
  for (const path of ['xl/styles.xml','xl/theme/theme1.xml']) assert.equal(parts[path],template.parts[path]);
  for (const sheet of template.sheets) {
    const before = template.parts[sheet.path], after = parts[sheet.path];
    for (const tag of ['mergeCells','cols','pageMargins','sheetFormatPr']) {
      const regex = new RegExp(`<${tag}\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/${tag}>)`);
      assert.equal(after.match(regex)?.[0],before.match(regex)?.[0],`${sheet.name} ${tag}`);
    }
    const rows = xml => [...xml.matchAll(/<row\b[^>]*>/g)].map(m=>m[0]);
    assert.deepEqual(rows(after),rows(before));
    const styles = xml => [...xml.matchAll(/<c\b[^>]*r="([^"]+)"[^>]*s="([^"]+)"[^>]*>/g)].map(m=>[m[1],m[2]]);
    for (const [ref,style] of styles(before)) assert.match(cell(after,ref),new RegExp(`s="${style}"`));
  }
  const eng = parts[template.sheets[0].path], ops = parts[template.sheets[1].path];
  assert.match(cell(eng,'D3'),/02\/01\/2026/);
  assert.match(cell(eng,'N3'),/<v>0.8<\/v>/);
  assert.match(cell(eng,'O3'),/<v>80<\/v>/);
  assert.match(cell(ops,'O3'),/<v>100<\/v>/);
  assert.match(cell(ops,'P3'),/<v>20<\/v>/);
  assert.match(cell(ops,'Q3'),/<v>3<\/v>/);
  for (const ref of ['O76','P76','Q76']) assert.match(cell(ops,ref),/<f>/);
});
test('download is a real self-contained XLSX ZIP with valid CRCs and literal text, not CSV or executable cell formulas', () => {
  const data = draft();
  data.project = '=HYPERLINK("https://example.invalid") & <name>';
  data.engineering.E3 = '=1+2 & <feature>';
  const parts = model.workbookParts(template,data), entries = unzip(model.zip(parts));
  assert.deepEqual(entries,parts);
  assert.match(entries['[Content_Types].xml'],/spreadsheetml.sheet.main\+xml/);
  const xml = entries['xl/worksheets/sheet1.xml'];
  assert.match(cell(xml,'E3'),/t="inlineStr"/);
  assert.match(cell(xml,'E3'),/=1\+2 &amp; &lt;feature&gt;/);
  assert.doesNotMatch(cell(xml,'E3'),/<f>/);
  assert.match(entries['xl/workbook.xml'],/fullCalcOnLoad="1"/);
});
test('empty denominators do not create NaN, infinity, divide errors or false metric values', () => {
  const data = draft();
  data.engineering={E3:'Feature',F3:'0',G3:'2',H3:'0',I3:'0'};
  data.operations={E3:'Feature',J3:'0',K3:'0',L3:'0',M3:'3'};
  const parts = model.workbookParts(template,data);
  for (const [index,refs] of [[0,['N3','O3']],[1,['P3','Q3']]]) for(const ref of refs) {
    const value = cell(parts[template.sheets[index].path],ref);
    assert.match(value,/IFERROR/);assert.match(value,/t="str"/);assert.match(value,/<v><\/v>/);
    assert.doesNotMatch(value,/NaN|Infinity|#DIV/);
  }
});
test('invalid inputs fail explicitly and leave the in-memory draft intact', () => {
  const cases = [
    data => {data.month='';},
    data => {data.project='';},
    data => {data.engineering={E3:'Feature',F3:'-1'};},
    data => {data.engineering={E3:'Feature',G3:'1.2'};},
    data => {data.engineering={E3:'Feature',H3:'2',I3:'3'};},
    data => {data.operations={E3:'Feature',J3:'2',K3:'3'};},
    data => {data.engineering={D3:'2026-02-01'};},
    data => {data.engineering={D3:'2026-01-32'};},
    data => {data.engineering={D4:'2026-01-01'};},
    data => {data.operations={F3:'4'};},
    data => {data.project='Bad\u0001text';}
  ];
  for (const mutate of cases) {
    const data = draft();mutate(data);const original = structuredClone(data);
    assert.throws(()=>model.workbookParts(template,data));assert.deepEqual(data,original);
  }
  assert.equal(model.dateSerial('2026-01-01'),46023);
});
test('each export is isolated and does not mutate or retain user values in the template', () => {
  const baseline = JSON.stringify(template), data = draft();
  data.engineering.E3='Private feature';
  model.workbookParts(template,data);
  assert.equal(JSON.stringify(template),baseline);
  assert.doesNotMatch(JSON.stringify(model.workbookParts(template,draft())),/Private feature/);
  assert.deepEqual(model.newDraft(),{month:'',project:'',engineering:{},operations:{},extraRows:{engineering:[0,0,0,0],operations:[0,0,0,0]},insertedRows:{engineering:[],operations:[]}});
});
test('rows can be inserted into every week without moving or losing another feature or date', () => {
  const data = draft();
  data.engineering={D42:'2026-01-12',E42:'Week 2 original',F42:'5',G42:'1',E76:'Last original'};
  assert.equal(model.addRow(data,'engineering',0),42);
  assert.equal(data.engineering.D43,'2026-01-12');
  assert.equal(data.engineering.E43,'Week 2 original');
  data.engineering.E42='Week 1 extra';data.engineering.D42='2026-01-09';
  assert.equal(model.addRow(data,'engineering',0),43);
  assert.equal(data.engineering.E42,'Week 1 extra');
  assert.equal(data.engineering.E44,'Week 2 original');
  assert.equal(model.addRow(data,'engineering',1),51);
  assert.equal(model.addRow(data,'engineering',2),63);
  assert.equal(model.addRow(data,'engineering',3),81);
  const layout=model.rowLayout(data,'engineering');
  assert.equal(layout.lastRow,81);
  assert.equal(data.engineering.E80,'Last original');
  assert.equal(model.rowLayout(data,'operations').lastRow,76);
  const ranges=model.mergeRanges(template,data,'engineering');
  for(const merge of ['A3:A81','B3:B81','C3:C43','C44:C51','C52:C63','C64:C81','D44:D47'])assert.ok(ranges.includes(merge),merge);
  const parts=model.workbookParts(template,data), xml=parts['xl/worksheets/sheet1.xml'];
  assert.match(cell(xml,'E42'),/Week 1 extra/);
  assert.match(cell(xml,'E44'),/Week 2 original/);
  assert.match(cell(xml,'D44'),/12\/01\/2026/);
  assert.match(cell(xml,'N44'),/G44\/F44/);
  assert.match(cell(xml,'N44'),/<v>0.2<\/v>/);
  for(const ref of ['N42','N43','N51','N63','N81','O81'])assert.match(cell(xml,ref),/<f>/);
  assert.match(xml,/<dimension ref="A1:P83"/);
  assert.equal(parts['xl/worksheets/sheet2.xml'],model.workbookParts(template,draft())['xl/worksheets/sheet2.xml']);
});
test('extra operations rows have original styles, unique ordered cells, calculations and valid dates', () => {
  const data=draft();
  model.addRow(data,'operations',0);model.addRow(data,'operations',3);
  data.operations={D42:'2026-01-09',E42:'Extra cost',F42:'1',G42:'2',H42:'3',I42:'4',J42:'4',K42:'1',L42:'2',M42:'8',E78:'Final extra',J78:'5',K78:'2'};
  const xml=model.workbookParts(template,data)['xl/worksheets/sheet2.xml'];
  assert.match(cell(xml,'O42'),/<v>10<\/v>/);
  assert.match(cell(xml,'P42'),/<v>25<\/v>/);
  assert.match(cell(xml,'Q42'),/<v>4<\/v>/);
  assert.match(cell(xml,'P78'),/<v>40<\/v>/);
  const original=template.parts['xl/worksheets/sheet2.xml'];
  for(const col of model.columns(17)) {
    const style=cell(original,col+'41').match(/\bs="(\d+)"/)[1];
    assert.match(cell(xml,col+'42'),new RegExp(`s="${style}"`),col);
  }
  const refs=[...xml.matchAll(/<c\b[^>]*\br="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(refs).size,refs.length);
  for(const match of xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)){
    const cells=[...match[2].matchAll(/<c\b[^>]*\br="([A-Z]+)(\d+)"/g)];
    for(const c of cells)assert.equal(c[2],match[1]);
    assert.deepEqual(cells.map(c=>c[1]),cells.map(c=>c[1]).sort());
  }
  assert.match(xml,/<mergeCell ref="A3:A78"/);
});
test('row limits and out-of-range new cells fail without clearing user data', () => {
  const data=draft();data.engineering.E3='Retain';
  data.extraRows.engineering=[926,0,0,0];
  assert.equal(model.rowLayout(data,'engineering').rows.length,1000);
  const original=structuredClone(data);
  assert.throws(()=>model.addRow(data,'engineering',0),/1000/);
  assert.deepEqual(data,original);
  assert.throws(()=>model.addRow(data,'engineering',4),/week/);
  const fresh=draft();fresh.engineering.E77='No added row';
  assert.throws(()=>model.workbookParts(template,fresh),/Invalid worksheet cell/);
});
