/* This module intentionally has no workspace, localStorage or IndexedDB writes. */
(function() {
  'use strict';
  const model = QualityMetrics, template = QualityMetricsTemplate;
  const draft = model.newDraft(), $ = id => document.getElementById(id);
  let sheet = 'engineering', pending = false, editVersion = 0;
  const embedded = new URLSearchParams(location.search).has('embedded');
  window.qualityMetricsHasPendingChanges = () => pending;
  if (embedded) {
    $('backLink').hidden = true;
    document.querySelector('.workspace-nav').hidden = true;
    document.querySelectorAll('[data-workspace]').forEach(link => link.addEventListener('click', event => {
      event.preventDefault();parent.openWorkspaceFromMetrics(link.dataset.workspace);
    }));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {event.preventDefault();parent.closeQualityMetrics();}
    });
    $('downloadButton').textContent = 'Save & download .xlsx';
    $('draftStatus').textContent = 'Save to project folder when downloading.';
    for (const project of parent.getMetricsProjects()) {
      const option = document.createElement('option');option.value=project;$('metricsProjects').append(option);
    }
  }
  const parser = new DOMParser();
  const sheets = template.sheets.map(item => parser.parseFromString(template.parts[item.path], 'application/xml'));
  function showError(error) {
    console.error('Quality metrics:', error);
    $('metricsError').textContent = error.message;
    $('metricsError').hidden = false;
  }
  function changed() {
    editVersion++;
    pending = true;
    $('metricsError').hidden = true;
    $('draftStatus').textContent = embedded ? 'Unsaved metrics' : 'Not stored. Download before closing.';
    $('metricsSavedPath').hidden = true;
  }
  function mergeMap(index) {
    const map = new Map(), covered = new Set();
    for (const range of model.mergeRanges(template,draft,index===0?'engineering':'operations')) {
      const [start,end] = range.split(':');
      const [sc,sr] = [start.charCodeAt(0), Number(start.slice(1))];
      const [ec,er] = [end.charCodeAt(0), Number(end.slice(1))];
      map.set(start, {rows:er-sr+1,cols:ec-sc+1});
      for (let r=sr;r<=er;r++) for(let c=sc;c<=ec;c++) {
        const ref = String.fromCharCode(c)+r;
        if (ref !== start) covered.add(ref);
      }
    }
    return {map,covered};
  }
  function updateOutputs(row) {
    try {
      for (const [col,result] of Object.entries(model.calculated(sheet,row,draft[sheet]))) {
        const output = document.querySelector(`[data-output="${col+row}"]`);
        if (output) output.value = result === null ? '' : String(Number(result.toFixed(6)));
      }
    } catch (error) {
      document.querySelectorAll(`output[data-row="${row}"]`).forEach(output => {output.value = '';});
      showError(error);
    }
  }
  function render() {
    const formulaSheet = sheet === 'formulas';
    $('sheetScroll').hidden = formulaSheet;
    $('formulasPanel').hidden = !formulaSheet;
    $('weekJumps').hidden = formulaSheet;
    $('sheetNote').hidden = formulaSheet;
    $('rowToolbar').hidden = formulaSheet;
    $('sheetPanel').setAttribute('aria-labelledby', sheet + 'Tab');
    if (formulaSheet) {
      $('formulasPanel').textContent = sheets[2].querySelector('c[r="A3"] t').textContent;
      return;
    }
    const index = sheet === 'engineering' ? 0 : 1, source = sheets[index];
    const layout = model.rowLayout(draft,sheet), sourceRow = new Map(layout.rows.map(row=>[row.row,row.source]));
    $('rowCount').textContent = `${layout.rows.length} rows`;
    document.querySelectorAll('#weekJumps [data-row]').forEach((button,index)=>{button.dataset.row=layout.originals.get([3,42,49,60][index]);});
    const cols = model.columns(model.headers[sheet].length), {map,covered} = mergeMap(index);
    $('tableCaption').textContent = template.sheets[index].name;
    $('metricsColumns').replaceChildren();
    const actionColumn=document.createElement('col');actionColumn.style.width='64px';$('metricsColumns').append(actionColumn);
    for (const col of cols) {
      const element = document.createElement('col');
      element.style.width = (col === 'E' ? 360 : col === 'B' ? 180 : col === 'D' ? 145 : col === 'A' ? 125 : col === 'C' ? 90 : 120) + 'px';
      $('metricsColumns').append(element);
    }
    $('metricsTable').style.width = (cols.length * 120 + 344) + 'px';
    $('metricsHead').replaceChildren();
    $('metricsBody').replaceChildren();
    for (let row=1; row<=layout.lastRow; row++) {
      const tr = document.createElement('tr');
      tr.id = 'metricsRow' + row;
      if(row===1) {
        const heading=document.createElement('th');heading.rowSpan=2;heading.scope='col';heading.className='row-actions';heading.textContent='Row';tr.append(heading);
      } else if(row>=3) {
        const action=document.createElement('td');action.className='row-actions';
        const details=document.createElement('details'),summary=document.createElement('summary');
        summary.textContent=`${row-2} +`;summary.setAttribute('aria-label',`Insert at row ${row-2}`);
        details.append(summary);
        const menu=document.createElement('div');menu.className='row-insert-menu';
        for(const [side,label] of [['before','Insert above'],['after','Insert below']]) {
          const button=document.createElement('button');button.type='button';button.textContent=label;
          button.disabled=layout.rows.length>=model.maxFeatureRows;
          button.onclick=()=>insertAt(row,side);menu.append(button);
        }
        details.addEventListener('toggle',()=>{
          if(!details.open)return;
          document.querySelectorAll('.row-actions details[open]').forEach(other=>{if(other!==details)other.open=false;});
          menu.style.top='0';menu.style.bottom='auto';
          if(menu.getBoundingClientRect().bottom>$('sheetScroll').getBoundingClientRect().bottom) {
            menu.style.top='auto';menu.style.bottom='0';
          }
        });
        details.addEventListener('keydown',event=>{if(event.key==='Escape'){details.open=false;summary.focus();}});
        details.append(menu);action.append(details);tr.append(action);
      }
      if ([3,42,49,60].some(source=>layout.originals.get(source)===row)) tr.className = 'week-start';
      for (const col of cols) {
        const ref = col + row;
        if (covered.has(ref)) continue;
        const cell = document.createElement(row <= 2 ? 'th' : 'td');
        const merge = map.get(ref);
        if (merge) {cell.rowSpan = merge.rows;cell.colSpan = merge.cols;}
        if (row <= 2) {
          cell.textContent = source.querySelector(`c[r="${ref}"] t`)?.textContent || '';
          cell.scope = merge?.cols > 1 ? 'colgroup' : 'col';
        } else if (col <= 'C') {
          cell.className = 'merged';
          const label = document.createElement('span');
          label.textContent = col === 'A' ? draft.month : col === 'B' ? draft.project : source.querySelector(`c[r="${col+sourceRow.get(row)}"] t`)?.textContent || '';
          if (col <= 'B') label.dataset.context = col;
          cell.append(label);
        } else if ((sheet === 'engineering' && col >= 'N') || (sheet === 'operations' && col >= 'O')) {
          const output = document.createElement('output');
          output.dataset.output = ref;output.dataset.row = row;
          output.setAttribute('aria-label', `${model.headers[sheet][col.charCodeAt(0)-65]}, row ${row-2}`);
          cell.append(output);
        } else {
          const input = document.createElement('input');
          input.type = col === 'D' ? 'date' : col === 'E' ? 'text' : 'number';
          input.value = draft[sheet][ref] || '';
          input.dataset.cell = ref;
          input.setAttribute('aria-label', `${model.headers[sheet][col.charCodeAt(0)-65]}, row ${row-2}`);
          if (col === 'D') {cell.className = 'date-cell';input.min='1900-03-01';input.max='9999-12-31';}
          else if (col === 'E') input.maxLength = 32767;
          else {
            input.min = '0';
            const integer = sheet === 'engineering' ? col !== 'F' : ['J','K','L','N'].includes(col);
            input.step = integer ? '1' : 'any';
          }
          input.addEventListener('input', () => {
            draft[sheet][ref] = input.value;
            input.setCustomValidity(input.validity.badInput ? 'Enter a number.' : '');
            changed();
            if (col >= 'F') updateOutputs(row);
          });
          cell.append(input);
        }
        tr.append(cell);
      }
      (row <= 2 ? $('metricsHead') : $('metricsBody')).append(tr);
      if (row >= 3) updateOutputs(row);
    }
    $('sheetScroll').scrollTop = 0;
  }
  const tabs = [...document.querySelectorAll('[data-sheet]')];
  function insertAt(target,side) {
    try {
      const scroll=$('sheetScroll'),left=scroll.scrollLeft;
      const row = model.insertRow(draft,sheet,target,side);
      changed();render();
      scroll.scrollLeft=left;
      const input = document.querySelector(`[data-cell="E${row}"]`);
      input.scrollIntoView({block:'center',inline:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
      input.focus({preventScroll:true});
    } catch(error) {showError(error);}
  }
  function selectTab(tab) {
    sheet = tab.dataset.sheet;
    tabs.forEach(button => {button.setAttribute('aria-selected',String(button===tab));button.tabIndex=button===tab?0:-1;});
    render();
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      selectTab(target);target.focus();
    });
  }
  $('metricsMonth').addEventListener('input', event => {
    draft.month = event.target.value;changed();
    document.querySelector('[data-context="A"]')?.replaceChildren(document.createTextNode(draft.month));
  });
  $('metricsProject').addEventListener('input', event => {
    draft.project = event.target.value;changed();
    document.querySelector('[data-context="B"]')?.replaceChildren(document.createTextNode(draft.project));
  });
  $('weekJumps').addEventListener('click', event => {
    const button = event.target.closest('[data-row]');
    if (!button) return;
    const container = $('sheetScroll'), row = $('metricsRow' + button.dataset.row);
    container.scrollTo({top: row.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - $('metricsHead').getBoundingClientRect().height, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    row.querySelector('input')?.focus({preventScroll:true});
  });
  $('downloadButton').addEventListener('click', async () => {
    const button = $('downloadButton');
    let downloadVersion;
    button.disabled = true;button.textContent = 'Preparing...';$('metricsError').hidden = true;
    button.setAttribute('aria-busy','true');
    try {
      await new Promise(resolve => requestAnimationFrame(resolve));
      for (const input of document.querySelectorAll('input')) if (!input.reportValidity()) throw new Error('Check the highlighted field.');
      const bytes = model.zip(model.workbookParts(template,draft));
      downloadVersion = editVersion;
      const filename = model.exportFilename(draft.project,draft.month);
      let savedPath = '';
      if (embedded) savedPath = await parent.saveProjectMetrics(draft.project.trim(),filename,bytes,structuredClone(draft));
      const blob = new Blob([bytes], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href=url;anchor.download=filename;
      document.body.append(anchor);anchor.click();anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url),60000);
      pending = downloadVersion !== editVersion;
      $('draftStatus').textContent = pending ? 'New edits not saved.' : embedded ? 'Saved to project folder. Download requested.' : 'Download requested. Keep the Excel file.';
      if (savedPath) {$('metricsSavedPath').textContent=savedPath;$('metricsSavedPath').hidden=false;}
    } catch (error) {showError(error);}
    finally {button.disabled=false;button.removeAttribute('aria-busy');button.textContent=embedded?'Save & download .xlsx':'Download .xlsx';}
  });
  $('clearButton').addEventListener('click', () => {
    if (pending && !confirm('Clear these metrics? Download first if needed.')) return;
    Object.assign(draft,model.newDraft());$('metricsMonth').value='';$('metricsProject').value='';
    editVersion++;pending=false;$('metricsError').hidden=true;$('metricsSavedPath').hidden=true;$('draftStatus').textContent=embedded?'Save to project folder when downloading.':'Not stored. Download before closing.';render();
  });
  $('themeButton').addEventListener('click', () => {document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';});
  window.addEventListener('beforeunload', event => {if(pending){event.preventDefault();event.returnValue='';}});
  render();
  window.qaUiInitialized=true;
  window.dispatchEvent(new Event('qa-ui-initialized'));
})();
