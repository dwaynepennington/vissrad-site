/* ==========================================================================
   VREstimator — Cost Breakdown, Resources and What-if (InEight-style layer).

   Cost Breakdown  the estimate as a cost breakdown structure: area >
                   discipline > cost item (or discipline > area), with man-
                   hours and labor, material, equipment and subcontract
                   dollars per item. Disciplines priced Parametric or Known
                   Quantity on Methods appear as one priced row each, so the
                   CBS always ties to the direct cost.
   Resources       craft man-hours and dollars across the estimate, editable
                   craft rates (base x burden = all-in), top material items.
   What-if         productivity, wage, material, escalation and contingency
                   cases priced side by side against the estimate of record,
                   saved as named scenarios or frozen snapshots, and applied
                   to the estimate only on request.
   ========================================================================== */
'use strict';

const CBS_UI = { group: 'area', q: '', open: new Set(), allOpen: true };
const usd0 = (v) => Math.round(num(v)).toLocaleString('en-US');
const f2 = (v) => num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function cbsRows() {
  const R = rollup();
  const methodOf = new Map(D.disciplines.map((d) => [d.discipline, d.method]));
  const areaName = new Map(D.areas.map((a) => [a.area_code || a.code, a.area_name || a.name]));
  const items = [];
  D.takeoff_lines.forEach((l) => {
    const c = computeLine(l);
    items.push({ l, c, area: l.area || '\u2014', disc: l.discipline, flows: methodOf.get(l.discipline) === 'detailed_takeoff' });
  });
  const priced = R.usedByDisc.filter((u) => u.disc.method !== 'detailed_takeoff').map((u) => ({
    disc: u.disc.discipline, method: u.disc.method, mh: u.usedMh, labor: u.usedLabor, matl: u.usedMatl, equip: 0, sub: 0, total: u.usedDirect, label: u.sourceLabel }));
  return { R, items, priced, areaName };
}

/* ------------------------------------------------------------ Cost Breakdown */
function viewCbs(root) {
  const { R, items, priced, areaName } = cbsRows();
  const flowing = items.filter((i) => i.flows);
  const tot = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
  const T = {
    mh: tot(flowing, (i) => i.c.totalMh) + tot(priced, (p) => p.mh), labor: tot(flowing, (i) => i.c.laborCost) + tot(priced, (p) => p.labor),
    matl: tot(flowing, (i) => i.c.materialCost) + tot(priced, (p) => p.matl), equip: tot(flowing, (i) => i.c.equipCost), sub: tot(flowing, (i) => i.c.subCost),
  };
  T.total = T.labor + T.matl + T.equip + T.sub;
  const held = items.filter((i) => !i.flows);

  root.appendChild(el('div', { class: 'kpi-row' },
    kpiCard('Direct cost', `USD ${M(R.totalDirect)}`, 'ties to Methods and Indirects', 'text', null),
    kpiCard('Direct man-hours', MH(T.mh), `${D.takeoff_lines.length} cost items`, 'blue', null),
    kpiCard('Labor', `USD ${M(T.labor)}`, `${R.totalDirect ? pct0((T.labor / R.totalDirect) * 100) : '0%'} of direct`, 'amber', R.totalDirect ? (T.labor / R.totalDirect) * 100 : 0),
    kpiCard('Material', `USD ${M(T.matl)}`, `${R.totalDirect ? pct0((T.matl / R.totalDirect) * 100) : '0%'} of direct`, 'cyan', R.totalDirect ? (T.matl / R.totalDirect) * 100 : 0),
    kpiCard('Equipment + subcontract', `USD ${M(T.equip + T.sub)}`, 'on detailed cost items', 'violet', null),
    kpiCard('Held lines', String(held.length), held.length ? 'discipline not on Detailed Takeoff' : 'every line flows', held.length ? 'amber' : 'green', null)));

  const tblHost = el('div');
  const groupSel = el('div', { class: 'seg' },
    [['area', 'Area \u203a Discipline'], ['disc', 'Discipline \u203a Area']].map(([k, lb]) => el('button', { class: CBS_UI.group === k ? 'on' : 'ghost', onclick: () => { CBS_UI.group = k; TABS.refresh(); } }, lb)));
  root.appendChild(card('Cost breakdown structure', [
    toolbar(groupSel, searchBox('Filter by key, description, line or area\u2026', (v) => { CBS_UI.q = v; draw(); }),
      el('button', { class: 'ghost', onclick: () => { CBS_UI.allOpen = true; CBS_UI.open.clear(); draw(); } }, 'Expand all'),
      el('button', { class: 'ghost', onclick: () => { CBS_UI.allOpen = false; CBS_UI.open.clear(); draw(); } }, 'Collapse all'),
      el('span', { style: 'flex:1' }),
      el('span', { class: 'hint', text: 'Equipment and subcontract are $ per unit on each cost item.' }),
      el('button', { class: 'ghost', onclick: exportCbs }, 'Export CBS (.xlsx)')),
    tblHost], { flush: false }).card);
  draw();

  function isOpen(k) { return CBS_UI.allOpen ? !CBS_UI.open.has(k) : CBS_UI.open.has(k); }
  function toggle(k) { if (CBS_UI.open.has(k)) CBS_UI.open.delete(k); else CBS_UI.open.add(k); draw(); }
  function draw() {
    tblHost.textContent = '';
    const q = CBS_UI.q.trim().toLowerCase();
    const list = items.filter((i) => !q || `${i.l.line_no} ${i.l.master_key} ${i.l.description} ${i.area} ${i.disc}`.toLowerCase().includes(q));
    const k1 = CBS_UI.group === 'area' ? (i) => i.area : (i) => i.disc;
    const k2 = CBS_UI.group === 'area' ? (i) => i.disc : (i) => i.area;
    const lab1 = (k) => (CBS_UI.group === 'area' ? `${k} \u2014 ${areaName.get(k) || 'Area'}` : k);
    const lab2 = (k) => (CBS_UI.group === 'area' ? k : `${k} \u2014 ${areaName.get(k) || 'Area'}`);
    const head = ['Code', 'Description', 'Qty', 'UOM', 'Crew', 'MH/unit', 'MH', 'Labor $', 'Material $', 'Equip $', 'Equip $/u', 'Sub $/u', 'Total $', '$/unit', 'Basis'];
    const tb = el('tbody');
    const sumRow = (arr) => ({ mh: tot(arr.filter((i) => i.flows), (i) => i.c.totalMh), labor: tot(arr.filter((i) => i.flows), (i) => i.c.laborCost), matl: tot(arr.filter((i) => i.flows), (i) => i.c.materialCost), equip: tot(arr.filter((i) => i.flows), (i) => i.c.equipCost), total: tot(arr.filter((i) => i.flows), (i) => i.c.totalCost), held: arr.filter((i) => !i.flows).length });
    const grpRow = (lvl, key, label, s) => el('tr', { class: `cbs-g${lvl}`, onclick: () => toggle(key) },
      el('td', { colspan: 6 }, el('span', { class: 'cbs-tw', text: isOpen(key) ? '\u25be' : '\u25b8' }), label, s.held ? el('span', { class: 'cbs-held', text: `${s.held} held` }) : null),
      el('td', { class: 'num mono', text: usd0(s.mh) }), el('td', { class: 'num mono', text: usd0(s.labor) }), el('td', { class: 'num mono', text: usd0(s.matl) }),
      el('td', { class: 'num mono', text: usd0(s.equip) }), el('td'), el('td'), el('td', { class: 'num mono', text: usd0(s.total) }), el('td'), el('td'));
    const g1 = groupBy(list.slice().sort((a, b) => String(k1(a)).localeCompare(String(k1(b))) || String(k2(a)).localeCompare(String(k2(b))) || String(a.l.line_no).localeCompare(String(b.l.line_no))), k1);
    for (const [a, arr] of g1) {
      const key1 = `1:${a}`;
      tb.appendChild(grpRow(1, key1, lab1(a), sumRow(arr)));
      if (!isOpen(key1)) continue;
      for (const [b, arr2] of groupBy(arr, k2)) {
        const key2 = `2:${a}:${b}`;
        tb.appendChild(grpRow(2, key2, lab2(b), sumRow(arr2)));
        if (!isOpen(key2)) continue;
        arr2.forEach((i) => tb.appendChild(itemRow(i)));
      }
    }
    if (priced.length && !q) {
      tb.appendChild(el('tr', { class: 'cbs-g1' }, el('td', { colspan: 6, text: 'Priced by discipline method (no area split)' }),
        el('td', { class: 'num mono', text: usd0(tot(priced, (p) => p.mh)) }), el('td', { class: 'num mono', text: usd0(tot(priced, (p) => p.labor)) }), el('td', { class: 'num mono', text: usd0(tot(priced, (p) => p.matl)) }),
        el('td'), el('td'), el('td'), el('td', { class: 'num mono', text: usd0(tot(priced, (p) => p.total)) }), el('td'), el('td')));
      priced.forEach((p) => { const dc = (D.disciplines.find((x) => x.discipline === p.disc) || {}).crew; tb.appendChild(el('tr', { class: 'cbs-item' },
        el('td', { class: 'mono', text: p.disc.slice(0, 3).toUpperCase() }), el('td', { text: `${p.disc} \u2014 ${METHOD_LABEL[p.method]}` }), el('td'), el('td'), el('td', { class: 'mono cbs-basis', text: dc || '' }), el('td'),
        el('td', { class: 'num mono', text: usd0(p.mh) }), el('td', { class: 'num mono', text: usd0(p.labor) }), el('td', { class: 'num mono', text: usd0(p.matl) }), el('td'), el('td'), el('td'),
        el('td', { class: 'num mono', text: usd0(p.total) }), el('td'), el('td', {}, el('span', { class: 'cbs-basis', text: p.label })))); });
    }
    tb.appendChild(el('tr', { class: 'cbs-tot' }, el('td', { colspan: 6, text: 'Total direct' }),
      el('td', { class: 'num mono', text: usd0(T.mh) }), el('td', { class: 'num mono', text: usd0(T.labor) }), el('td', { class: 'num mono', text: usd0(T.matl) }),
      el('td', { class: 'num mono', text: usd0(T.equip) }), el('td'), el('td', { class: 'num mono', text: usd0(T.sub) }), el('td', { class: 'num mono', text: usd0(T.total) }), el('td'), el('td')));
    tblHost.appendChild(el('div', { class: 'tbl-wrap cbs-wrap' }, el('table', { class: 'data cbs' },
      el('thead', {}, el('tr', {}, head.map((h, i) => el('th', { class: i >= 2 && i !== 3 && i !== 4 && i !== 14 ? 'num' : null, text: h })))), tb)));
  }
  function itemRow(i) {
    const { l, c } = i;
    const inp = (field) => el('input', { type: 'number', min: 0, step: 'any', class: 'cbs-in', value: l[field] || '', placeholder: '0', 'aria-label': field,
      onchange: (e) => { const old = l[field]; l[field] = num(e.target.value) || 0; audit('takeoff_line', l.line_no, `set_${field}`, old ?? null, l[field]); refreshAll(); } });
    return el('tr', { class: `cbs-item${i.flows ? '' : ' held'}`, title: i.flows ? l.source || '' : `${l.discipline} is not on Detailed Takeoff \u2014 held, not in the direct cost` },
      el('td', { class: 'mono', text: l.master_key }),
      el('td', { class: 'clip' }, el('span', { class: 'mono cbs-ln', text: l.line_no }), l.description),
      el('td', { class: 'num mono', text: f2(l.quantity) }), el('td', { text: l.uom }),
      el('td', {}, el('select', { class: 'cbs-crew', 'aria-label': `${l.line_no} crew`, title: c.crew ? `${c.crew.crew.name}: $${f2(c.crew.perMh)}/MH labor + $${f2(c.crew.equipPerMh)}/MH equipment` : `Craft rate ${l.craft}`,
        onchange: (e) => { const o = l.crew; l.crew = e.target.value; audit('takeoff_line', l.line_no, 'set_crew', o || null, l.crew || null); refreshAll(); } },
        el('option', { value: '', selected: !l.crew || null }, '\u2014'), (D.crews || []).map((cr) => el('option', { value: cr.id, selected: l.crew === cr.id || null }, cr.id)))),
      el('td', { class: 'num mono', text: (c.unitMh * c.totalFactor).toFixed(3) }),
      el('td', { class: 'num mono', text: usd0(c.totalMh) }), el('td', { class: 'num mono', text: usd0(c.laborCost) }), el('td', { class: 'num mono', text: usd0(c.materialCost) }),
      el('td', { class: 'num mono', text: usd0(c.equipCost) }),
      el('td', { class: 'num' }, inp('equip_unit_cost')), el('td', { class: 'num' }, inp('sub_unit_cost')),
      el('td', { class: 'num mono', text: usd0(c.totalCost) }), el('td', { class: 'num mono', text: num(l.quantity) ? f2(c.totalCost / num(l.quantity)) : '\u2014' }),
      el('td', {}, el('span', { class: 'cbs-basis', text: l.board_item ? (/^CX-/.test(l.board_item) ? `CAD ${l.board_item}` : `Board ${l.board_item}`) : /PDF takeoff/.test(l.source || '') ? 'PDF takeoff' : /scan/i.test(l.source || '') ? 'Drawing scan' : 'Manual' })));
  }
  async function exportCbs() {
    const head = ['Area', 'Discipline', 'Line', 'Library key', 'Description', 'Qty', 'UOM', 'Craft', 'Crew', 'MH', 'Labor USD', 'Material USD', 'Equipment USD', 'Subcontract USD', 'Total USD', 'In direct cost', 'Basis'];
    const rows = items.map((i) => [i.area, i.disc, i.l.line_no, i.l.master_key, i.l.description, num(i.l.quantity), i.l.uom, i.l.craft, i.l.crew || '', round2(i.c.totalMh), round2(i.c.laborCost), round2(i.c.materialCost), round2(i.c.equipCost), round2(i.c.subCost), round2(i.c.totalCost), i.flows ? 'Yes' : 'Held', i.l.source || '']);
    priced.forEach((p) => rows.push(['', p.disc, '', '', `${METHOD_LABEL[p.method]} (${p.label})`, '', '', '', (D.disciplines.find((x) => x.discipline === p.disc) || {}).crew || '', round2(p.mh), round2(p.labor), round2(p.matl), 0, 0, round2(p.total), 'Yes', p.label]));
    await vrestDownloadXlsx(`${EST_BRAND}-CBS-${D.project.project_no}.xlsx`, [{ name: 'Cost breakdown', header: head, rows }]);
  }
}
const round2 = (v) => Math.round(num(v) * 100) / 100;
async function vrestDownloadXlsx(name, sheets) {
  try {
    const blob = await window.VRSheetIO.xlsxBlob(sheets);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast(`Saved: ${name}`);
  } catch (e) { toast(`Could not write the workbook: ${e.message}`, true); }
}

/* ------------------------------------------------------------ Resources */
function viewResources(root) {
  const R = rollup();
  const byCraft = new Map(D.crafts.map((c) => [c.craft, { craft: c.craft, mh: 0, cost: 0, lines: 0, rate: num(c.all_in_rate) }]));
  D.takeoff_lines.forEach((l) => {
    const d = D.disciplines.find((x) => x.discipline === l.discipline);
    if (!d || d.method !== 'detailed_takeoff') return;
    const c = computeLine(l);
    if (c.crew && c.crew.mix.length) { c.crew.mix.forEach((m) => { const r = byCraft.get(m.craft); if (r) { r.mh += c.totalMh * m.share; r.cost += c.totalMh * m.share * r.rate; r.lines += 1; } }); return; }
    const r = byCraft.get(l.craft); if (!r) return;
    r.mh += c.totalMh; r.cost += c.laborCost; r.lines += 1;
  });
  /* Disciplines priced by method: their man-hours are spread evenly over the
     discipline's typical crafts (the same crafts that set the blended rate). */
  R.usedByDisc.filter((u) => u.disc.method !== 'detailed_takeoff').forEach((u) => {
    const cw = u.disc.crew ? IDX.crewById.get(u.disc.crew) : null;
    if (cw && cw.mix.length) { cw.mix.forEach((m) => { const r = byCraft.get(m.craft); if (r) { r.mh += u.usedMh * m.share; r.cost += u.usedLabor * m.share; } }); return; }
    const crafts = (DISC_CRAFTS_FALLBACK[u.disc.discipline] || []).filter((c) => byCraft.has(c));
    crafts.forEach((c) => { const r = byCraft.get(c); r.mh += u.usedMh / crafts.length; r.cost += u.usedLabor / crafts.length; });
  });
  const rows = [...byCraft.values()].filter((r) => r.mh > 0).sort((a, b) => b.mh - a.mh);
  const maxMh = rows.reduce((a, r) => Math.max(a, r.mh), 0) || 1;
  const totMh = rows.reduce((a, r) => a + r.mh, 0);

  const matl = new Map();
  D.takeoff_lines.forEach((l) => { const c = computeLine(l); if (!c.materialCost) return; const m = matl.get(l.master_key) || { key: l.master_key, desc: (c.mhRow && (c.mhRow.work_item || c.mhRow.description)) || l.description, uom: l.uom, qty: 0, cost: 0, unit: c.unitMatl }; m.qty += num(l.quantity); m.cost += c.materialCost; matl.set(l.master_key, m); });
  const mrows = [...matl.values()].sort((a, b) => b.cost - a.cost).slice(0, 15);

  root.appendChild(el('div', { class: 'kpi-row' },
    kpiCard('Direct man-hours', MH(totMh), `${rows.length} crafts`, 'blue', null),
    kpiCard('Labor cost', `USD ${M(R.totalLabor)}`, 'all-in craft rates', 'amber', null),
    kpiCard('Average all-in rate', totMh ? `USD ${f2(R.totalLabor / totMh)}/hr` : '\u2014', 'labor $ / man-hours', 'text', null),
    kpiCard('Peak craft', rows[0] ? rows[0].craft : '\u2014', rows[0] ? `${MH(rows[0].mh)} MH, ${pct0((rows[0].mh / totMh) * 100)}` : '', 'violet', null)));

  const rateRows = D.crafts.map((c) => el('tr', {},
    el('td', { text: c.craft }),
    el('td', { class: 'num' }, el('input', { type: 'number', step: '0.25', min: 0, class: 'cbs-in', value: c.base_rate, 'aria-label': `${c.craft} base rate`, onchange: (e) => setRate(c, 'base_rate', e.target.value) })),
    el('td', { class: 'num' }, el('input', { type: 'number', step: '0.1', min: 0, class: 'cbs-in', value: (num(c.burden_pct) * 100).toFixed(1), 'aria-label': `${c.craft} burden %`, onchange: (e) => setRate(c, 'burden_pct', num(e.target.value) / 100) })),
    el('td', { class: 'num mono', text: f2(c.all_in_rate) }),
    el('td', { class: 'num mono', text: usd0((byCraft.get(c.craft) || {}).mh) })));
  function setRate(c, k, v) { const old = c.all_in_rate; c[k] = num(v); c.all_in_rate = round2(num(c.base_rate) * (1 + num(c.burden_pct))); audit('craft', c.craft, 'set_rate', old, c.all_in_rate); refreshAll(); }

  root.appendChild(el('div', { class: 'split split-3-2', style: 'margin-top:10px' },
    card('Man-hours by craft', [
      el('div', { class: 'res-bars' }, rows.map((r) => el('div', { class: 'res-bar' },
        el('span', { class: 'lb', text: r.craft }), el('span', { class: 'tr' }, el('i', { style: `width:${(r.mh / maxMh) * 100}%` })),
        el('span', { class: 'vl mono', text: `${MH(r.mh)} MH` }), el('span', { class: 'vl mono', text: `USD ${K(r.cost)}k` })))),
      el('div', { class: 'hint', style: 'margin-top:8px', text: 'Lines with a crew spread their man-hours over the crew mix; lines without one use their own craft. Parametric and known-quantity disciplines spread over their default crew (or the discipline crafts when none is set).' })]).card,
    card('Craft rates (resource library)', el('div', { class: 'tbl-wrap' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, ['Craft', 'Base $/hr', 'Burden %', 'All-in $/hr', 'MH'].map((h, i) => el('th', { class: i ? 'num' : null, text: h })))), el('tbody', {}, rateRows))), { flush: true }).card));

  root.appendChild(el('div', { style: 'margin-top:10px' }, card('Top material items', dataTable([
    { key: 'key', label: 'Key', mono: true, width: 90 }, { key: 'desc', label: 'Item' }, { key: 'uom', label: 'UOM', width: 60 },
    { key: 'qty', label: 'Quantity', num: true, mono: true, render: (r) => f2(r.qty) }, { key: 'unit', label: 'Unit $', num: true, mono: true, render: (r) => f2(r.unit) },
    { key: 'cost', label: 'Material $', num: true, mono: true, render: (r) => usd0(r.cost) },
  ], mrows, { sort: 'cost', dir: -1, empty: 'No material priced yet.' }).wrap, { flush: true }).card));
}

/* ------------------------------------------------------------ What-if */
const WI_DEF = { pf: 1, wage: 0, matl: 0, esc: null, cont: null };
const WI = Object.assign({}, WI_DEF);
/** Price the estimate under a case without touching the estimate of record. */
function wiPrice(c) {
  const base = D;
  const x = JSON.parse(JSON.stringify(D));
  x.takeoff_lines.forEach((l) => { l.global_factor = num(l.global_factor, 1) * num(c.pf, 1); });
  x.disciplines.forEach((d) => { const lp = num(d.labor_pct); const w = 1 + num(c.wage) / 100; const m = 1 + num(c.matl) / 100; const pf = num(c.pf, 1);
    d.parametric_cost = num(d.parametric_cost) * (lp * w * pf + (1 - lp) * m); d.known_unit_rate = num(d.known_unit_rate) * (lp * w * pf + (1 - lp) * m); });
  x.crafts.forEach((r) => { r.all_in_rate = num(r.all_in_rate) * (1 + num(c.wage) / 100); });
  x.material_prices.forEach((m) => { m.unit_material_cost = num(m.unit_material_cost) * (1 + num(c.matl) / 100); });
  if (c.esc !== null && c.esc !== '' && c.esc !== undefined) x.indirects.escalation_pct = num(c.esc) / 100;
  if (c.cont !== null && c.cont !== '' && c.cont !== undefined) x.indirects.contingency_pct = num(c.cont) / 100;
  let R;
  try { D = x; buildIndexes(); R = rollup(); } finally { D = base; buildIndexes(); }
  return wiSnap(R);
}
function wiSnap(R) {
  return { tic: R.tic, direct: R.totalDirect, mh: R.totalMh, labor: R.totalLabor, matl: R.totalMatl, escalation: R.escalation, contingency: R.contingency,
    byDisc: Object.fromEntries(R.usedByDisc.map((u) => [u.disc.discipline, { direct: u.usedDirect, mh: u.usedMh }])) };
}
function viewWhatIf(root) {
  const base = wiSnap(rollup());
  const out = el('div');
  const inp = (k, label, step, unit, ph) => el('div', { class: 'wi-f' }, el('label', { text: label }),
    el('div', { class: 'wi-in' }, el('input', { type: 'number', step, value: WI[k] ?? '', placeholder: ph || '', 'aria-label': label, oninput: (e) => { WI[k] = e.target.value === '' ? (k === 'pf' ? 1 : (k === 'esc' || k === 'cont') ? null : 0) : Number(e.target.value); draw(); } }), el('span', { class: 'hint', text: unit })));
  root.appendChild(card('Case', [
    el('div', { class: 'wi-grid' },
      inp('pf', 'Productivity factor', '0.01', '\u00d7 man-hours', '1.00'),
      inp('wage', 'Craft wage change', '0.5', '%', '0'),
      inp('matl', 'Material price change', '0.5', '%', '0'),
      inp('esc', 'Escalation', '0.1', `% (now ${(num(D.indirects.escalation_pct) * 100).toFixed(1)})`, (num(D.indirects.escalation_pct) * 100).toFixed(1)),
      inp('cont', 'Contingency', '0.5', `% (now ${(num(D.indirects.contingency_pct) * 100).toFixed(1)})`, (num(D.indirects.contingency_pct) * 100).toFixed(1))),
    toolbar(
      el('button', { class: 'primary', onclick: saveCase }, 'Save as scenario'),
      el('button', { class: 'ghost', onclick: snapshot, title: 'Freeze the estimate as it is now, to compare later revisions with it' }, 'Snapshot estimate of record'),
      el('button', { class: 'ghost', onclick: () => { Object.assign(WI, WI_DEF); TABS.refresh(); } }, 'Reset case'),
      el('span', { style: 'flex:1' }),
      el('button', { class: 'ghost', onclick: applyCase, title: 'Write this case into the estimate of record' }, 'Apply case to estimate\u2026'))]).card);
  root.appendChild(out);
  draw();

  function draw() {
    out.textContent = '';
    const now = wiPrice(WI);
    const cols = [{ name: 'Estimate of record', s: base, kind: 'base' }, { name: 'This case', s: now, kind: 'case' }]
      .concat(D.scenarios.map((sc) => ({ name: sc.name, s: sc.kind === 'snapshot' ? sc.result : wiPrice(sc.params), kind: sc.kind, sc })));
    const dv = (v, b) => { const d = v - b; if (Math.abs(d) < 0.5) return el('span', { class: 'hint', text: '\u2014' }); return el('span', { style: `color:var(--${d > 0 ? 'accent' : 'green'})`, text: `${d > 0 ? '+' : '\u2212'}${M(Math.abs(d))}` }); };
    const row = (label, get, fmtv, cls) => el('tr', { class: cls || null }, el('td', { text: label }), cols.map((c, i) => el('td', { class: 'num mono' }, el('div', { text: fmtv(get(c.s)) }), i ? el('div', { class: 'wi-d' }, dv(get(c.s), get(base))) : null)));
    const discs = D.disciplines.map((d) => d.discipline);
    out.appendChild(el('div', { style: 'margin-top:10px' }, card(`Scenario comparison \u2014 ${D.scenarios.length} saved`, el('div', { class: 'tbl-wrap' }, el('table', { class: 'data wi-tbl' },
      el('thead', {}, el('tr', {}, el('th', { text: 'USD' }), cols.map((c) => el('th', { class: 'num' }, el('div', { text: c.name }),
        el('div', { class: 'hint wi-sub', text: c.kind === 'snapshot' ? `snapshot ${c.sc.created}` : c.kind === 'scenario' ? wiDesc(c.sc.params) : c.kind === 'case' ? wiDesc(WI) : D.project.estimate_status }),
        c.sc ? el('button', { class: 'ghost x', title: 'Delete', 'aria-label': `Delete ${c.name}`, onclick: () => { D.scenarios.splice(D.scenarios.indexOf(c.sc), 1); refreshAll(); } }, '\u00d7') : null)))),
      el('tbody', {},
        row('Total installed cost (TIC)', (s) => s.tic, (v) => M(v), 'wi-tic'),
        row('Direct cost', (s) => s.direct, (v) => M(v)),
        row('Labor', (s) => s.labor, (v) => M(v)),
        row('Material', (s) => s.matl, (v) => M(v)),
        row('Escalation', (s) => s.escalation, (v) => M(v)),
        row('Contingency', (s) => s.contingency, (v) => M(v)),
        el('tr', {}, el('td', { text: 'Direct man-hours' }), cols.map((c) => el('td', { class: 'num mono', text: MH(c.s.mh) }))),
        el('tr', { class: 'wi-sep' }, el('td', { colspan: cols.length + 1, text: 'Direct cost by discipline' })),
        discs.map((dn) => row(dn, (s) => (s.byDisc[dn] || {}).direct || 0, (v) => M(v)))))), { flush: true }).card));
  }
  function wiDesc(p) { const t = []; if (num(p.pf, 1) !== 1) t.push(`PF ${num(p.pf).toFixed(2)}`); if (num(p.wage)) t.push(`wage ${p.wage > 0 ? '+' : ''}${p.wage}%`); if (num(p.matl)) t.push(`matl ${p.matl > 0 ? '+' : ''}${p.matl}%`); if (p.esc !== null && p.esc !== undefined && p.esc !== '') t.push(`esc ${p.esc}%`); if (p.cont !== null && p.cont !== undefined && p.cont !== '') t.push(`cont ${p.cont}%`); return t.join(', ') || 'no change'; }
  function saveCase() {
    const name = el('input', { type: 'text', value: `Scenario ${D.scenarios.filter((s) => s.kind === 'scenario').length + 1}` });
    modal({ title: 'Save scenario', sub: wiDesc(WI), width: 440, body: el('div', { class: 'form-grid' }, el('label', { text: 'Name' }), name),
      buttons: [{ label: 'Cancel', onClick: closeModal }, { label: 'Save', primary: true, onClick: () => { D.scenarios.push({ id: `SC-${Date.now().toString(36)}`, kind: 'scenario', name: name.value.trim() || 'Scenario', created: TODAY, params: Object.assign({}, WI) }); audit('scenario', name.value, 'create', null, wiDesc(WI)); closeModal(); refreshAll(); } }] });
  }
  function snapshot() {
    const n = D.scenarios.filter((s) => s.kind === 'snapshot').length + 1;
    D.scenarios.push({ id: `SN-${Date.now().toString(36)}`, kind: 'snapshot', name: `Snapshot ${n} (${D.project.estimate_status})`, created: new Date().toISOString().slice(0, 16).replace('T', ' '), result: base });
    audit('scenario', `Snapshot ${n}`, 'snapshot', null, `TIC ${M(base.tic)}`); refreshAll(); toast('Estimate of record frozen as a snapshot');
  }
  function applyCase() {
    modal({ title: 'Apply case to the estimate?', sub: wiDesc(WI), width: 520,
      body: el('div', { class: 'banner warn' }, 'Craft rates, material prices, parametric and known-quantity rates, the global factor on every takeoff line, escalation and contingency are changed in the estimate of record. Take a snapshot first to keep the current figures for comparison. Each change is written to the audit trail.'),
      buttons: [{ label: 'Cancel', onClick: closeModal }, { label: 'Apply', primary: true, onClick: () => {
        const c = WI;
        D.takeoff_lines.forEach((l) => { l.global_factor = round2(num(l.global_factor, 1) * num(c.pf, 1) * 1000) / 1000 || 1; });
        D.disciplines.forEach((d) => { const lp = num(d.labor_pct); const k = lp * (1 + num(c.wage) / 100) * num(c.pf, 1) + (1 - lp) * (1 + num(c.matl) / 100); d.parametric_cost = Math.round(num(d.parametric_cost) * k); d.known_unit_rate = round2(num(d.known_unit_rate) * k); });
        D.crafts.forEach((r) => { r.base_rate = round2(num(r.base_rate) * (1 + num(c.wage) / 100)); r.all_in_rate = round2(num(r.all_in_rate) * (1 + num(c.wage) / 100)); });
        D.material_prices.forEach((m) => { m.unit_material_cost = round2(num(m.unit_material_cost) * (1 + num(c.matl) / 100)); });
        if (c.esc !== null && c.esc !== '') D.indirects.escalation_pct = num(c.esc) / 100;
        if (c.cont !== null && c.cont !== '') D.indirects.contingency_pct = num(c.cont) / 100;
        audit('estimate', D.project.project_no, 'apply_whatif', null, wiDesc(c));
        Object.assign(WI, WI_DEF); closeModal(); refreshAll(); toast('Case applied to the estimate of record');
      } }] });
  }
}
