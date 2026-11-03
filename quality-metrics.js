(function(root) {
  'use strict';
  const headers = {
    engineering: ['Month&Year', 'Project Name', 'Week', 'Date', 'Name of the Feature', 'Total Lines of Code (KLOC)', 'Defects Found', 'Test Cases Executed', 'Test Cases Passed', 'Requirements Gap', 'Design Flaw', 'Coding Error', 'Environment Issue', 'Defect Density', 'Test Coverage (%)'],
    operations: ['Month&Year', 'Project Name', 'Week', 'Date', 'Name of the Feature', 'Prevention Cost', 'Appraisal Cost', 'Internal Failure Cost', 'External Failure Cost', 'Total Defects', 'Production Defects', 'Total Incidents', 'Total Resolution Time (hrs)', 'Customer-Reported Defects', 'Cost of Quality', 'Defect Leakage (%)', 'MTTR (hrs)']
  };
  const columns = count => Array.from({length: count}, (_, i) => String.fromCharCode(65 + i));
  function exportFilename(project, month) {
    const name = project.trim().replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,60) || 'project';
    return `${name}_${month}_qualitymetrics.xlsx`;
  }
  const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'}[c]));
  function validateText(value) {
    if (typeof value !== 'string' || value.length > 32767 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(value)) throw new Error('Text contains unsupported characters or is too long.');
    return value;
  }
  const weekEnds = [41,48,59,76], maxFeatureRows = 1000;
  function newDraft() { return {month: '', project: '', engineering: {}, operations: {}, extraRows: {engineering:[0,0,0,0],operations:[0,0,0,0]}, insertedRows:{engineering:[],operations:[]}}; }
  function rowLayout(draft, kind) {
    const extras = draft.extraRows?.[kind] ?? [0,0,0,0];
    if (!Array.isArray(extras) || extras.length !== 4 || extras.some(count => !Number.isInteger(count) || count < 0) || extras.reduce((sum,count)=>sum+count,74) > maxFeatureRows) throw new Error(`Use up to ${maxFeatureRows} feature rows per sheet.`);
    const rows = [], originals = new Map(), added = [];
    let current = 3, start = 3;
    for (let week=0;week<4;week++) {
      for (let source=start;source<=weekEnds[week];source++) {
        rows.push({row:current,source,week,key:`original-${source}`});
        originals.set(source,current++);
      }
      for(let index=0;index<extras[week];index++) {
        added.push(current);
        rows.push({row:current++,source:weekEnds[week],week,key:`extra-${week}-${index}`,added:true});
      }
      start=weekEnds[week]+1;
    }
    const insertions = draft.insertedRows?.[kind] ?? [];
    if (!Array.isArray(insertions) || rows.length + insertions.length > maxFeatureRows) throw new Error(`Use up to ${maxFeatureRows} feature rows per sheet.`);
    for (const [index,insertion] of insertions.entries()) {
      const position = rows.findIndex(row=>row.key===insertion.anchor);
      if (position < 0 || !['before','after'].includes(insertion.side)) throw new Error('Invalid row insertion.');
      const anchor = rows[position];
      rows.splice(position+(insertion.side==='after'?1:0),0,{source:anchor.source,week:anchor.week,key:`inserted-${index}`,added:true});
    }
    originals.clear();added.length=0;
    rows.forEach((row,index)=>{
      row.row=index+3;
      if(row.added)added.push(row.row);else originals.set(row.source,row.row);
    });
    return {rows, originals, added, lastRow:rows.length+2, extras};
  }
  function mergeRanges(template, draft, kind) {
    const layout = rowLayout(draft,kind), index = kind === 'engineering' ? 0 : 1;
    return template.sheets[index].merges.map(range => {
      const [start,end] = range.split(':'), col = start[0], from = Number(start.slice(1)), to = Number(end.slice(1));
      const mappedStart = layout.originals.get(from) ?? from;
      let mappedEnd = layout.originals.get(to) ?? to;
      if (['A','B','C'].includes(col) && to >= 3) {
        const members=layout.rows.filter(row=>col==='C'?row.week===weekEnds.indexOf(to):true);
        return `${col}${members[0].row}:${end[0]}${members.at(-1).row}`;
      }
      return `${col}${mappedStart}:${end[0]}${mappedEnd}`;
    });
  }
  function addRow(draft, kind, week) {
    if (!Object.hasOwn(headers,kind) || !Number.isInteger(week) || week<0 || week>3) throw new Error('Choose a worksheet and week.');
    const before = rowLayout(draft,kind);
    if (before.rows.length >= maxFeatureRows) throw new Error(`Use up to ${maxFeatureRows} feature rows per sheet.`);
    const extras = [...before.extras];extras[week]++;
    const next = {...draft,extraRows:{...draft.extraRows,[kind]:extras}};
    const after = rowLayout(next,kind), positions = new Map(after.rows.map(row=>[row.key,row.row]));
    const keys = new Map(before.rows.map(row=>[row.row,row.key])), values = {};
    for (const [ref,value] of Object.entries(draft[kind])) {
      const row = positions.get(keys.get(Number(ref.slice(1))));
      if (!row) throw new Error('Cannot move an invalid worksheet cell.');
      values[ref[0]+row]=value;
    }
    draft.extraRows = next.extraRows;draft[kind]=values;
    return after.rows.find(row=>row.key===`extra-${week}-${extras[week]-1}`).row;
  }
  function insertRow(draft,kind,row,side) {
      if (!Object.hasOwn(headers,kind) || !['before','after'].includes(side)) throw new Error('Choose a row and insertion position.');
      const before=rowLayout(draft,kind), anchor=before.rows.find(item=>item.row===row);
      if(!anchor)throw new Error('Choose a feature row.');
      if(before.rows.length>=maxFeatureRows)throw new Error(`Use up to ${maxFeatureRows} feature rows per sheet.`);
      const list=[...(draft.insertedRows?.[kind]??[]),{anchor:anchor.key,side}];
      const next={...draft,insertedRows:{...draft.insertedRows,[kind]:list}};
      const after=rowLayout(next,kind), positions=new Map(after.rows.map(item=>[item.key,item.row]));
      const keys=new Map(before.rows.map(item=>[item.row,item.key])),values={};
      for(const [ref,value] of Object.entries(draft[kind])) {
        const target=positions.get(keys.get(Number(ref.slice(1))));
        if(!target)throw new Error('Cannot move an invalid worksheet cell.');
        values[ref[0]+target]=value;
      }
      draft.insertedRows=next.insertedRows;draft[kind]=values;
      return positions.get(`inserted-${list.length-1}`);
    }
  function numeric(value) {
    if (value === '' || value === undefined) return null;
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(value)) || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > Number.MAX_SAFE_INTEGER) throw new Error('Enter a non-negative number within the supported range.');
    return Number(value);
  }
  function dateSerial(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Enter a valid date.');
    const time = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value || value < '1900-03-01' || value > '9999-12-31') throw new Error('Enter a valid date from March 1900 onward.');
    return (time - Date.UTC(1899, 11, 30)) / 86400000;
  }
  function calculated(kind, row, values) {
    const n = col => numeric(values[col + row]);
    if (kind === 'engineering') return {N: n('F') ? (n('G') ?? 0) / n('F') : null, O: n('H') ? (n('I') ?? 0) / n('H') * 100 : null};
    const costs = ['F','G','H','I'].map(n);
    return {O: costs.every(v => v === null) ? null : costs.reduce((sum, v) => sum + (v ?? 0), 0), P: n('J') ? (n('K') ?? 0) / n('J') * 100 : null, Q: n('L') ? (n('M') ?? 0) / n('L') : null};
  }
  function validateDraft(draft) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(draft.month) || draft.month < '1900-03' || draft.month > '9999-12') throw new Error('Choose a month and year.');
    if (!validateText(draft.project).trim()) throw new Error('Enter a project name.');
    for (const kind of Object.keys(headers)) {
      const values = draft[kind];
      const layout = rowLayout(draft,kind);
      for (const [ref, value] of Object.entries(values)) {
        const validColumn = kind === 'engineering' ? /^[D-M][1-9]\d*$/ : /^[D-N][1-9]\d*$/;
        if (!validColumn.test(ref) || Number(ref.slice(1)) < 3 || Number(ref.slice(1)) > layout.lastRow) throw new Error('Invalid worksheet cell.');
        if (value === '') continue;
        if (ref[0] === 'D') {
          dateSerial(value);
          if (!value.startsWith(draft.month + '-')) throw new Error(`Date ${value} does not match the selected month.`);
        } else if (ref[0] === 'E') validateText(value);
        else {
          const number = numeric(value);
          const integer = kind === 'engineering' ? ref[0] !== 'F' : ['J','K','L','N'].includes(ref[0]);
          if (integer && !Number.isInteger(number)) throw new Error(`${headers[kind][ref.charCodeAt(0) - 65]} must be a whole number.`);
        }
      }
      for (let row = 3; row <= layout.lastRow; row++) {
        const n = col => numeric(values[col + row]);
        const pair = kind === 'engineering' ? ['I','H','Passed cases cannot exceed executed cases.'] : ['K','J','Production defects cannot exceed total defects.'];
        if (n(pair[0]) !== null && (n(pair[1]) === null || n(pair[0]) > n(pair[1]))) throw new Error(`${kind === 'engineering' ? 'Engineering' : 'Operations'} row ${row - 2}: ${pair[2]}`);
        const populated = Object.entries(values).some(([ref, value]) => ref.slice(1) === String(row) && ref[0] >= 'F' && value !== '');
        if (populated && !values['E' + row]?.trim()) throw new Error(`${kind === 'engineering' ? 'Engineering' : 'Operations'} row ${row - 2}: enter a feature name.`);
      }
    }
  }
  function setCell(xml, ref, value, formula) {
    const expression = new RegExp(`<c\\b([^>]*\\br="${ref}"[^>]*?)(?:\\/>|>[\\s\\S]*?<\\/c>)`);
    const match = xml.match(expression);
    const attributes = match ? match[1].replace(/\s+t="[^"]*"/g, '') : ` r="${ref}" s="10"`;
    let content = '';
    let type = '';
    if (formula !== undefined) {
      content = `<f>${escapeXml(formula)}</f>`;
      if (value !== null) content += `<v>${value}</v>`;
      else { type = ' t="str"'; content += '<v></v>'; }
    } else if (typeof value === 'number') content = `<v>${value}</v>`;
    else if (value !== undefined && value !== '') {
      validateText(value); type = ' t="inlineStr"';
      content = `<is><t xml:space="preserve">${escapeXml(value)}</t></is>`;
    }
    const cell = `<c${attributes}${type}>${content}</c>`;
    if (match) return xml.replace(expression, () => cell);
    const row = ref.replace(/[A-Z]/g, '');
    return xml.replace(new RegExp(`(<row\\b[^>]*\\br="${row}"[^>]*>)([\\s\\S]*?)(<\\/row>)`), (_, start, cells, end) => start + cells + cell + end);
  }
  function extendWorksheet(xml, template, draft, kind) {
    const layout = rowLayout(draft,kind);
    if (layout.lastRow === 76) return xml;
    const sourceRows = new Map([...xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g)].map(match=>[Number(match[1]),match[0]]));
    const moveRow = (source,target,blank=false) => {
      let row = sourceRows.get(source);
      if (blank) row = row.replace(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g, (_,attrs)=>`<c${attrs.replace(/\s+t="[^"]*"/g,'')}/>`);
      return row.replace(/\br="([A-Z]*)(\d+)"/g, (_,col)=>`r="${col}${target}"`);
    };
    const rows = [sourceRows.get(1),sourceRows.get(2),...layout.rows.map(row=>moveRow(row.source,row.row,row.added))];
    for (const source of sourceRows.keys()) if(source>76)rows.push(moveRow(source,source+layout.lastRow-76));
    xml = xml.replace(/(<sheetData\b[^>]*>)[\s\S]*?(<\/sheetData>)/,(_,start,end)=>start+rows.join('')+end);
    const merges = mergeRanges(template,draft,kind);
    xml = xml.replace(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/,()=>`<mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`);
    xml = xml.replace(/(<dimension\b[^>]*ref="[A-Z]+\d+:[A-Z]+)(\d+)(")/,(_,start,row,end)=>start+(Number(row)+layout.lastRow-76)+end);
    return xml;
  }
  function workbookParts(template, draft) {
    validateDraft(draft);
    const parts = {...template.parts};
    for (const [index, kind] of ['engineering','operations'].entries()) {
      const values = draft[kind], path = template.sheets[index].path;
      const layout = rowLayout(draft,kind);
      let xml = extendWorksheet(parts[path],template,draft,kind);
      const date = new Date(draft.month + '-01T00:00:00Z');
      xml = setCell(xml, 'A3', date.toLocaleDateString('en-US', {month:'long', year:'numeric', timeZone:'UTC'}));
      xml = setCell(xml, 'B3', draft.project.trim());
      const dateRanges=mergeRanges(template,draft,kind).filter(ref=>/^D\d+:D\d+$/.test(ref)).map(ref=>ref.split(':').map(cell=>Number(cell.slice(1))));
      const allowedDates = new Set([...dateRanges.map(([start])=>'D'+start),...layout.added.filter(row=>!dateRanges.some(([start,end])=>row>=start&&row<=end)).map(row=>'D'+row)]);
      for (const [ref, value] of Object.entries(values)) {
        if (ref[0] === 'D' && !allowedDates.has(ref)) throw new Error('Date is outside a merged date field.');
        xml = setCell(xml, ref, ref[0] === 'D' ? (value ? value.split('-').reverse().join('/') : '') : ref[0] === 'E' ? value : numeric(value) ?? '');
      }
      for (let row = 3; row <= layout.lastRow; row++) {
        const formulas = kind === 'engineering'
          ? {N:`IFERROR(IF(F${row}="","",G${row}/F${row}),"")`, O:`IFERROR(IF(H${row}="","",I${row}/H${row}*100),"")`}
          : {O:`IF(COUNT(F${row}:I${row})=0,"",SUM(F${row}:I${row}))`, P:`IFERROR(IF(J${row}="","",K${row}/J${row}*100),"")`, Q:`IFERROR(IF(L${row}="","",M${row}/L${row}),"")`};
        const results = calculated(kind, row, values);
        for (const col of Object.keys(formulas)) xml = setCell(xml, col + row, results[col], formulas[col]);
      }
      parts[path] = xml;
    }
    return parts;
  }
  const crcTable = Uint32Array.from({length:256}, (_, n) => {
    for (let i=0; i<8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  // Store ZIP entries without compression: preserves every XML byte, with no runtime dependency.
  function zip(parts) {
    const encoder = new TextEncoder(), chunks = [], directory = [];
    let offset = 0, centralSize = 0;
    for (const [path, content] of Object.entries(parts)) {
      const name = encoder.encode(path), bytes = encoder.encode(content), crc = crc32(bytes);
      const local = new Uint8Array(30 + name.length), view = new DataView(local.buffer);
      view.setUint32(0,0x04034b50,true); view.setUint16(4,20,true); view.setUint16(6,0x800,true); view.setUint16(12,33,true);
      view.setUint32(14,crc,true); view.setUint32(18,bytes.length,true); view.setUint32(22,bytes.length,true); view.setUint16(26,name.length,true); local.set(name,30);
      chunks.push(local,bytes);
      const central = new Uint8Array(46 + name.length), cv = new DataView(central.buffer);
      cv.setUint32(0,0x02014b50,true); cv.setUint16(4,20,true); cv.setUint16(6,20,true); cv.setUint16(8,0x800,true); cv.setUint16(14,33,true);
      cv.setUint32(16,crc,true); cv.setUint32(20,bytes.length,true); cv.setUint32(24,bytes.length,true); cv.setUint16(28,name.length,true); cv.setUint32(42,offset,true); central.set(name,46);
      directory.push(central); centralSize += central.length; offset += local.length + bytes.length;
    }
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0,0x06054b50,true); ev.setUint16(8,directory.length,true); ev.setUint16(10,directory.length,true); ev.setUint32(12,centralSize,true); ev.setUint32(16,offset,true);
    const result = new Uint8Array(offset + centralSize + 22);
    let cursor = 0;
    for (const chunk of [...chunks,...directory,end]) {result.set(chunk,cursor);cursor+=chunk.length;}
    return result;
  }
  const api = {headers,columns,exportFilename,newDraft,rowLayout,mergeRanges,addRow,insertRow,maxFeatureRows,numeric,dateSerial,calculated,validateDraft,workbookParts,zip,crc32};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QualityMetrics = api;
})(globalThis);
