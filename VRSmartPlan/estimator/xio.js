/* ==========================================================================
   VREstimator — Import / Export in the VREST workbook formats.

   Reads, with a preview of what is added, changed and left alone:
     * VREST import workbook  — one sheet per table, headings are the
       field keys (takeoff_lines, mh_library, material_prices, crafts,
       weld_factors, areas, benchmark).
     * Estimate takeoff workbook  — the estimator's sheets: Takeoff, MH
       library, Material prices, Craft rates, Weld factors.
     * Any CSV / sheet with a recognisable takeoff header (a digital takeoff
       export: Description, Quantity, Unit, plus Library key or Line ID).
   Writes the same two workbooks, so a file round-trips between VREstimator,
   VREST and the suite's Link source / Pull.
   ========================================================================== */
'use strict';

/* table: { key field, fields (VREST keys), human sheet name + headings } */
const XIO_TABLES = {
  takeoff_lines: { key: 'line_id', label: 'Takeoff lines', human: 'Takeoff',
    fields: ['id', 'discipline', 'area', 'line_id', 'description', 'master_key', 'unit', 'quantity', 'unit_mh_override', 'discipline_factor', 'global_factor', 'item_factor', 'craft', 'crew', 'weld_key', 'equip_unit_cost', 'sub_unit_cost'],
    humanCols: { 'Line ID': 'line_id', Discipline: 'discipline', Area: 'area', Description: 'description', 'Library key': 'master_key', Unit: 'unit', Quantity: 'quantity', Craft: 'craft', Crew: 'crew', 'Item factor': 'item_factor', 'Weld factor key': 'weld_key', 'Unit MH override': 'unit_mh_override', 'Equipment $/unit': 'equip_unit_cost', 'Subcontract $/unit': 'sub_unit_cost' } },
  mh_library: { key: 'key', label: 'Man-hour library', human: 'MH library', fields: ['key', 'discipline', 'work_item', 'unit', 'unit_mh', 'source'],
    humanCols: { Key: 'key', Discipline: 'discipline', 'Work item': 'work_item', Unit: 'unit', 'Unit MH': 'unit_mh', Source: 'source' } },
  material_prices: { key: 'key', label: 'Material prices', human: 'Material prices', fields: ['key', 'discipline', 'unit', 'unit_material_cost', 'source'],
    humanCols: { Key: 'key', Discipline: 'discipline', Unit: 'unit', 'Unit material cost USD': 'unit_material_cost', Source: 'source' } },
  crafts: { key: 'craft', label: 'Craft rates', human: 'Craft rates', fields: ['craft', 'base_rate', 'burden_pct', 'all_in_rate'],
    humanCols: { Craft: 'craft', 'Base rate USD/hr': 'base_rate', 'Burden %': 'burden_pct', 'All-in rate USD/hr': 'all_in_rate' } },
  weld_factors: { key: 'key', label: 'Weld factors', human: 'Weld factors', fields: ['key', 'material', 'factor', 'notes'],
    humanCols: { Key: 'key', Material: 'material', Factor: 'factor', Notes: 'notes' } },
  crews: { key: 'crew_id', label: 'Crews', human: 'Crews', fields: ['crew_id', 'name', 'discipline', 'shift_hours'],
    humanCols: { 'Crew ID': 'crew_id', Crew: 'name', Discipline: 'discipline', 'Shift hours': 'shift_hours' } },
  crew_members: { key: 'member', label: 'Crew members', human: 'Crew members', fields: ['crew_id', 'kind', 'resource', 'qty', 'rate_hr'],
    humanCols: { 'Crew ID': 'crew_id', Kind: 'kind', 'Craft or equipment': 'resource', Quantity: 'qty', 'Equipment $/hr': 'rate_hr' } },
  areas: { key: 'code', label: 'Areas', human: 'Areas', fields: ['code', 'name'], humanCols: { Code: 'code', Area: 'name', Name: 'name' } },
};
const XIO_NUM = new Set(['quantity', 'unit_mh_override', 'discipline_factor', 'global_factor', 'item_factor', 'unit_mh', 'unit_material_cost', 'base_rate', 'burden_pct', 'all_in_rate', 'factor', 'equip_unit_cost', 'sub_unit_cost', 'shift_hours', 'qty', 'rate_hr']);
const XIO_GENERIC = { description: ['description', 'item', 'name', 'takeoff item', 'condition'], quantity: ['quantity', 'qty', 'quantity 1', 'total qty'], unit: ['unit', 'uom', 'units', 'unit of measure'],
  master_key: ['library key', 'master_key', 'key', 'cost code', 'assembly code', 'item code'], line_id: ['line id', 'line_id', 'id', 'item #', 'item no'], discipline: ['discipline', 'trade'], area: ['area', 'location', 'zone'] };

/* Current records of a table, normalised to the VREST field keys. */
function xioCurrent(t) {
  if (t === 'takeoff_lines') return D.takeoff_lines.map((l) => ({ id: l.id, discipline: l.discipline, area: l.area, line_id: l.line_id || l.line_no, description: l.description, master_key: l.master_key, unit: l.unit || l.uom, quantity: l.quantity,
    unit_mh_override: l.unit_mh_override ?? '', discipline_factor: l.discipline_factor, global_factor: l.global_factor, item_factor: l.item_factor, craft: l.craft, crew: l.crew || '', weld_key: l.weld_key || '', equip_unit_cost: l.equip_unit_cost || '', sub_unit_cost: l.sub_unit_cost || '' }));
  if (t === 'crews') return (D.crews || []).map((c) => ({ crew_id: c.id, name: c.name, discipline: c.discipline, shift_hours: c.shift_hours }));
  if (t === 'crew_members') { const out = []; (D.crews || []).forEach((c) => { (c.labor || []).forEach((m) => out.push({ crew_id: c.id, kind: 'Labor', resource: m.craft, qty: m.qty, rate_hr: '', member: `${c.id}|Labor|${m.craft}` })); (c.equipment || []).forEach((e) => out.push({ crew_id: c.id, kind: 'Equipment', resource: e.desc, qty: e.qty, rate_hr: e.rate_hr, member: `${c.id}|Equipment|${e.desc}` })); }); return out; }
  if (t === 'areas') return D.areas.map((a) => ({ code: a.code || a.area_code, name: a.name || a.area_name }));
  return D[t];
}
function xioParse(grids) {
  const found = {};
  const norm = (s) => String(s == null ? '' : s).trim();
  for (const g of grids) {
    const name = norm(g.name);
    const grid = g.grid.filter((r) => r.some((c) => norm(c) !== ''));
    if (grid.length < 1) continue;
    const head = grid[0].map(norm);
    let table = null, map = null;
    if (XIO_TABLES[name]) { table = name; map = Object.fromEntries(head.map((h) => [h, h])); }
    else {
      const t = Object.entries(XIO_TABLES).find(([, d]) => d.human.toLowerCase() === name.toLowerCase());
      if (t) { table = t[0]; map = Object.fromEntries(head.map((h) => [h, t[1].humanCols[h] || null])); }
    }
    if (!table) {
      const low = head.map((h) => h.toLowerCase());
      const col = (k) => low.findIndex((h) => XIO_GENERIC[k].includes(h));
      if (col('description') >= 0 && col('quantity') >= 0 && col('unit') >= 0) {
        table = 'takeoff_lines'; map = {};
        Object.keys(XIO_GENERIC).forEach((k) => { const i = col(k); if (i >= 0) map[head[i]] = k; });
      }
    }
    if (!table) continue;
    const rows = grid.slice(1).map((r) => {
      const o = {};
      head.forEach((h, i) => { const k = map[h]; if (!k) return; let v = r[i]; if (XIO_NUM.has(k)) v = v === '' || v === null || v === undefined ? null : Number(String(v).replace(/[$,\s]/g, '')); else v = norm(v); o[k] = v; });
      return o;
    }).filter((o) => Object.values(o).some((v) => v !== '' && v !== null));
    if (table === 'crew_members') rows.forEach((o) => { o.kind = /^e/i.test(o.kind || '') ? 'Equipment' : 'Labor'; o.member = `${o.crew_id}|${o.kind}|${o.resource}`; });
    (found[table] = found[table] || { sheet: name, rows: [] }).rows.push(...rows);
  }
  return found;
}
function xioDiff(t, rows) {
  const k = XIO_TABLES[t].key;
  const cur = new Map(xioCurrent(t).map((r) => [String(r[k] ?? ''), r]));
  let add = 0, chg = 0, same = 0, bad = 0;
  rows.forEach((r) => {
    const id = String(r[k] ?? '');
    if (!id && t !== 'takeoff_lines') { bad += 1; return; }
    const c = cur.get(id);
    if (!c || !id) { add += 1; return; }
    const differs = Object.keys(r).some((f) => String(r[f] ?? '') !== String(c[f] ?? ''));
    if (differs) chg += 1; else same += 1;
  });
  return { add, chg, same, bad, remove: Math.max(0, cur.size - (rows.length - add - bad)) };
}
function xioApply(t, rows, mode) {
  const k = XIO_TABLES[t].key;
  if (t === 'crews') {
    if (mode === 'replace') D.crews = [];
    rows.forEach((r) => { if (!r.crew_id) return; let c = D.crews.find((x) => x.id === r.crew_id); if (!c) { c = { id: r.crew_id, labor: [], equipment: [] }; D.crews.push(c); } c.name = r.name || c.name || r.crew_id; c.discipline = r.discipline || c.discipline || ''; c.shift_hours = num(r.shift_hours, 10) || 10; });
    return;
  }
  if (t === 'crew_members') {
    const by = groupBy(rows.filter((r) => r.crew_id && r.resource), (r) => r.crew_id);
    for (const [id, list] of by) {
      let c = D.crews.find((x) => x.id === id); if (!c) { c = { id, name: id, discipline: '', shift_hours: 10, labor: [], equipment: [] }; D.crews.push(c); }
      c.labor = list.filter((r) => /^Labou?r$/.test(r.kind)).map((r) => ({ craft: r.resource, qty: num(r.qty) }));
      c.equipment = list.filter((r) => r.kind === 'Equipment').map((r) => ({ desc: r.resource, rate_hr: num(r.rate_hr), qty: num(r.qty) }));
    }
    return;
  }
  if (t === 'takeoff_lines') {
    const byNo = new Map(D.takeoff_lines.map((l) => [l.line_id || l.line_no, l]));
    if (mode === 'replace') D.takeoff_lines = D.takeoff_lines.filter((l) => l.board_item);
    rows.forEach((r) => {
      const lib = D.mh_library.find((m) => m.key === r.master_key);
      let l = mode === 'replace' ? null : byNo.get(r.line_id);
      if (!l) {
        const no = nextNo(D.takeoff_lines, 'line_no', 'TKL-', 4, SEQ);
        l = { id: no, line_no: no, line_id: r.line_id || no, discipline_factor: 1, global_factor: 1, item_factor: 1, weld_key: '', drawing_refs: [] };
        D.takeoff_lines.push(l);
      }
      Object.entries(r).forEach(([f, v]) => { if (f === 'id') return; if (v === null && XIO_NUM.has(f) && f !== 'unit_mh_override') return; l[f] = v; });
      if (lib) { l.discipline = l.discipline || lib.discipline; l.unit = l.unit || lib.unit; l.description = l.description || lib.work_item; }
      l.uom = l.unit; l.discipline_factor = num(l.discipline_factor, 1); l.global_factor = num(l.global_factor, 1); l.item_factor = num(l.item_factor, 1);
      if (!l.craft) l.craft = bdDefaultCraft(l.discipline);
      if (!l.area) l.area = (D.areas[0] && (D.areas[0].area_code || D.areas[0].code)) || '';
      l.source = l.source || `Imported (${XIO_TABLES[t].label})`;
    });
    return;
  }
  const list = mode === 'replace' ? [] : D[t].slice();
  const idx = new Map(list.map((r, i) => [String(r[k]), i]));
  rows.forEach((r) => {
    if (!r[k]) return;
    const o = Object.assign({}, idx.has(String(r[k])) ? list[idx.get(String(r[k]))] : {}, Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)));
    if (t === 'crafts' && !(num(o.all_in_rate) > 0)) o.all_in_rate = round2(num(o.base_rate) * (1 + num(o.burden_pct)));
    if (t === 'mh_library') { o.description = o.work_item; o.uom = o.unit; }
    if (t === 'material_prices') { const lib = D.mh_library.find((m) => m.key === o.key); o.description = lib ? lib.work_item : o.key; o.uom = o.unit; }
    if (t === 'weld_factors') o.description = o.material;
    if (t === 'areas') { o.area_code = o.code; o.area_name = o.name; }
    if (idx.has(String(r[k]))) list[idx.get(String(r[k]))] = o; else { idx.set(String(r[k]), list.length); list.push(o); }
  });
  D[t] = list;
}

function viewData(root) {
  const prev = el('div');
  const fileIn = el('input', { type: 'file', accept: '.xlsx,.xlsm,.csv,.tsv,.txt', style: 'display:none', onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) readFile(f); } });
  root.appendChild(el('div', { class: 'split split-1-1' },
    card('Import', [
      el('p', { class: 'hint', text: 'Bring in a VREST import workbook (sheet per table), the Estimate takeoff workbook, or a takeoff export from another tool (CSV or XLSX with Description, Quantity and Unit). You see what is added and changed before anything is written.' }),
      toolbar(el('button', { class: 'primary', onclick: () => fileIn.click() }, 'Choose workbook or CSV\u2026'), fileIn),
      prev]).card,
    card('Export', [
      el('p', { class: 'hint', text: 'Both workbooks open in Excel and load back into VREstimator or VREST (Data \u203a Link source \u203a Pull).' }),
      el('div', { class: 'xio-ex' },
        xBtn('VREST import workbook', 'One sheet per table; headings are field keys.', exportTables),
        xBtn('Estimate takeoff workbook', 'Takeoff, MH library, Material prices, Craft rates, Crews, Weld factors.', exportHuman),
        xBtn('Estimate summary', 'Code-of-accounts build-up to TIC, by discipline and method.', exportSummary),
        xBtn('Takeoff Board measurements', 'Every item with its sheet, marks, quantities and assembly.', exportBoard),
        xBtn('Primavera P6 schedule (.xer)', 'Areas, discipline packages and activities with durations, logic and labor/equipment resources. Settings on the Schedule tab.', () => schedExport()))]).card));

  function xBtn(t, s, fn) { return el('button', { class: 'xio-btn', onclick: fn }, el('b', { text: t }), el('span', { text: s })); }
  async function readFile(f) {
    prev.textContent = '';
    try {
      const grids = await window.VRSheetIO.readGrids(f);
      const found = xioParse(grids);
      const keys = Object.keys(found);
      if (!keys.length) { prev.appendChild(el('div', { class: 'banner bad', text: `${f.name}: no sheet matched a VREST table or a takeoff layout (Description, Quantity, Unit).` })); return; }
      const mode = el('select', {}, el('option', { value: 'merge' }, 'Merge: add new, update matching'), el('option', { value: 'replace' }, 'Replace the table'));
      const picks = {};
      prev.append(el('div', { class: 'hint', style: 'margin:8px 0 4px', text: `${f.name}: ${keys.length} table(s) recognized` }),
        el('div', { class: 'tbl-wrap' }, el('table', { class: 'data' },
          el('thead', {}, el('tr', {}, ['', 'Table', 'Sheet', 'Rows', 'Add', 'Change', 'Same', 'Skipped'].map((h, i) => el('th', { class: i > 2 ? 'num' : null, text: h })))),
          el('tbody', {}, keys.map((t) => { const d = xioDiff(t, found[t].rows); picks[t] = el('input', { type: 'checkbox', checked: true, 'aria-label': `Import ${t}` });
            return el('tr', {}, el('td', {}, picks[t]), el('td', { text: XIO_TABLES[t].label }), el('td', { class: 'mono', text: found[t].sheet }), el('td', { class: 'num mono', text: found[t].rows.length }),
              el('td', { class: 'num mono', text: d.add }), el('td', { class: 'num mono', text: d.chg }), el('td', { class: 'num mono', text: d.same }), el('td', { class: 'num mono', text: d.bad })); })))),
        toolbar(el('label', { text: 'Mode' }), mode, el('button', { class: 'primary', onclick: () => {
          const done = [];
          // libraries first so takeoff lines resolve their keys
          ['areas', 'crafts', 'crews', 'crew_members', 'weld_factors', 'mh_library', 'material_prices', 'takeoff_lines'].forEach((t) => { if (found[t] && picks[t].checked) { xioApply(t, found[t].rows, mode.value); done.push(`${XIO_TABLES[t].label} ${found[t].rows.length}`); } });
          if (!done.length) { toast('Nothing ticked to import', true); return; }
          audit('import', f.name, mode.value, null, done.join(', '));
          refreshAll(); toast(`Imported from ${f.name}: ${done.join(', ')}`);
        } }, 'Import ticked tables')));
    } catch (e) { prev.appendChild(el('div', { class: 'banner bad', text: `Could not read ${f.name}: ${e.message}` })); }
  }
  const about = (title, extra) => ({ name: 'About this file', header: [title, ''], rows: [['Project', `${D.project.project_no} ${D.project.project_name}`], ['Written by', `${EST_BRAND} (VissRad)`], ['Written', new Date().toISOString().slice(0, 16).replace('T', ' ')], ...extra] });
  function exportTables() {
    const sheets = [about('VREST import workbook', [['Sheet names', 'Exactly the table name. Headings are exactly the field keys.'], ['How to load', 'VREstimator: Import / Export > Choose workbook. VREST: Data > Link source > Pull.']])];
    Object.entries(XIO_TABLES).forEach(([t, d]) => sheets.push({ name: t, header: d.fields, rows: xioCurrent(t).map((r) => d.fields.map((f) => (r[f] === null || r[f] === undefined ? '' : r[f]))) }));
    vrestDownloadXlsx(`VREST-import-workbook-${D.project.project_no}.xlsx`, sheets);
  }
  function exportHuman() {
    const sheets = [about('Estimate takeoff workbook', [['Feeds', 'VREST / VREstimator - Takeoff, MH library, Material prices, Crafts, Crews, Crew members and Weld factors.']])];
    ['takeoff_lines', 'mh_library', 'material_prices', 'crafts', 'crews', 'crew_members', 'weld_factors'].forEach((t) => {
      const d = XIO_TABLES[t]; const cols = Object.entries(d.humanCols).filter(([h], i, a) => a.findIndex((x) => x[1] === d.humanCols[h]) === i);
      sheets.push({ name: d.human, header: cols.map((c) => c[0]), rows: xioCurrent(t).map((r) => cols.map(([, f]) => (r[f] === null || r[f] === undefined ? '' : r[f]))) });
    });
    vrestDownloadXlsx(`Estimate-takeoff-workbook-${D.project.project_no}.xlsx`, sheets);
  }
  function exportSummary() {
    const R = rollup();
    const rows = [['Direct construction', round2(R.totalDirect)], ['Engineering (FEED + Detail)', round2(R.engineeringCostUsed)], ['EPCM services', round2(R.epcmOther + (R.eng.source === 'factored' ? R.epcmEngineeringSlice : 0))],
      ['Field indirects', round2(R.fieldIndirects)], ['Owner costs', round2(R.ownerCost)], ['Escalation', round2(R.escalation)], ['Contingency', round2(R.contingency)], ['Total installed cost', round2(R.tic)],
      ['Accuracy low', round2(R.accLow)], ['Accuracy high', round2(R.accHigh)]];
    const disc = R.usedByDisc.map((u) => [u.disc.discipline, METHOD_LABEL[u.disc.method], round2(u.usedMh), round2(u.usedLabor), round2(u.usedMatl), round2(u.usedEquip), round2(u.usedSub), round2(u.usedDirect)]);
    vrestDownloadXlsx(`${EST_BRAND}-summary-${D.project.project_no}.xlsx`, [
      { name: 'Build-up', header: ['Account', 'USD'], rows }, { name: 'By discipline', header: ['Discipline', 'Method', 'MH', 'Labor USD', 'Material USD', 'Equipment USD', 'Subcontract USD', 'Direct USD'], rows: disc }]);
  }
  function exportBoard() {
    const rows = D.board.items.map((it) => { const m = boardMeasure(it); const sh = bdSheet(it.sheet); const a = D.assemblies.find((x) => x.id === it.assembly);
      return [it.id, it.name, KIND_LABEL[it.kind], sh ? sh.name : '', it.page, it.area, it.marks.length, round2(m.Q), KIND_UNIT[it.kind], round2(m.P), num(it.depth_ft), num(it.height_ft), a ? a.name : it.master_key || '', boardLines(it).map((l) => l.line_no).join(' ')]; });
    const asm = []; D.assemblies.forEach((a) => a.rows.forEach((r, i) => asm.push([a.id, a.name, KIND_LABEL[a.kind], i + 1, r.master_key, r.formula, r.craft, r.weld_key || '', num(r.item_factor, 1)])));
    vrestDownloadXlsx(`${EST_BRAND}-board-${D.project.project_no}.xlsx`, [
      { name: 'Takeoff items', header: ['Item', 'Name', 'Kind', 'Sheet', 'Page', 'Area', 'Marks', 'Q', 'Unit', 'P (LF)', 'D ft', 'H ft', 'Priced with', 'Takeoff lines'], rows },
      { name: 'Assemblies', header: ['Assembly', 'Name', 'Kind', 'Row', 'Library key', 'Formula', 'Craft', 'Weld factor', 'Item factor'], rows: asm }]);
  }
}
