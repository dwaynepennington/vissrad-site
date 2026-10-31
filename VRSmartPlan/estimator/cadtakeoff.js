/* ==========================================================================
   VREstimator — CAD Takeoff (automated takeoff from DXF drawings).

   A DXF is read in the browser (dxf.js). Quantities come straight from the
   drawing geometry, so they are exact rather than traced:
     layers  -> length (LF) of every line, polyline, arc, circle, spline
                and area (SF) / perimeter of closed shapes
     blocks  -> counts of symbol inserts (arrays included; nested blocks
                counted separately and only included on request)
   Each layer or block can be priced as an assembly or a library item. A
   priced row becomes a CAD takeoff item that writes ordinary takeoff lines
   through the Takeoff Board engine (boardSync), so crews, methods,
   indirects, What-if and the proposal all use it unchanged.

   Automation: "Auto-build takeoff" prices every row it recognises, first
   from mapping rules learned in this estimate (each choice you make is
   remembered by layer or block name), then from name patterns (pipe size
   from the layer name, FDN/SLAB/TRAY layers, PUMP/VALVE/TRANSMITTER
   blocks). Loading a revision re-measures every item and shows the change.

   Data: D.cad = { drawings, items, rules, seq }. Drawing files stay in this
   browser (IndexedDB); the measured summary travels with the estimate.
   ========================================================================== */
'use strict';

const CAD_SAMPLE = { id: 'DX-SAMPLE', name: 'VR-DEMO-001-PIP-PLN-0201_0.dxf', src: 'sample', url: 'samples/cad/VR-DEMO-001-PIP-PLN-0201_0.dxf' };
const CAD_UNIT_OPTS = [['1', 'Inches'], ['2', 'Feet'], ['4', 'Millimeters'], ['5', 'Centimeters'], ['6', 'Meters'], ['custom', 'Custom (ft per unit)']];

function cadEnsure(d) {
  if (d.cad && Array.isArray(d.cad.items)) return;
  d.cad = { drawings: [], items: [], rules: {}, seq: 0 };
  const demo = (typeof EST_ID === 'undefined' || EST_ID === 'base') && !(window.VRUSER && window.VRUSER.user);
  if (demo && window.CAD_DEMO_SUMMARY) {
    const dr = cadAddDrawing(d, CAD_SAMPLE.name, window.CAD_DEMO_SUMMARY, { src: 'sample', url: CAD_SAMPLE.url, id: CAD_SAMPLE.id, area: 'A20' });
    cadAutoBuild(d, dr, true);
  }
}
function cadDrawing(id, d) { return ((d || D).cad.drawings || []).find((x) => x.id === id) || null; }
function cadDocNo(name) { return String(name || '').replace(/\.dxf$/i, '').replace(/_\w{1,3}$/, ''); }
function cadAddDrawing(d, name, summary, o) {
  o = o || {};
  const units = DXF_UNITS[summary.insunits];
  const dr = { id: o.id || `DX-${String(++d.cad.seq).padStart(3, '0')}`, name, src: o.src || 'local', url: o.url || '', rev: 1, insunits: summary.insunits,
    units: units && units[1] ? String(summary.insunits) : '2', unit_ft: units && units[1] ? units[1] : 1, unit_guess: !(units && units[1]),
    area: o.area || (d.areas[0] && (d.areas[0].area_code || d.areas[0].code)) || '', loaded: typeof TODAY !== 'undefined' ? TODAY : '', summary, prev: null };
  d.cad.drawings.push(dr);
  return dr;
}

/* ------------------------------------------------------------ measure + items */
/** Board-compatible measurement of a CAD item, in feet: { Q, P, N, scaled }. */
function cadMeasure(it, d, summary) {
  const dr = cadDrawing(it.cad.drawing, d); if (!dr) return { Q: 0, P: 0, N: 0, scaled: false };
  const s = summary || dr.summary; const f = num(dr.unit_ft);
  if (it.cad.source === 'block') { const b = s.blocks[it.cad.key]; const N = b ? b.direct + (it.cad.nested ? b.nested : 0) : 0; return { Q: N, P: 0, N, scaled: true }; }
  const l = s.layers[it.cad.key]; if (!l || !f) return { Q: 0, P: 0, N: 0, scaled: !!f };
  if (it.kind === 'area') return { Q: l.area * f * f, P: l.perim * f, N: l.closed, scaled: true };
  return { Q: l.len * f, P: l.len * f, N: l.ents, scaled: true };
}
function cadItemFor(dr, source, key, d) { return (d || D).cad.items.find((x) => x.cad.drawing === dr.id && x.cad.source === source && x.cad.key === key) || null; }
function cadKindOf(measure) { return measure === 'count' ? 'count' : measure === 'area' ? 'area' : 'linear'; }
/** Create or update the item for a row from a pricing choice { measure, asm | lib, depth_ft, height_ft, nested }. */
function cadPrice(d, dr, source, key, ch, quiet) {
  let it = cadItemFor(dr, source, key, d);
  if (!ch || !(ch.asm || ch.lib)) { if (it) cadRemoveItem(d, it, quiet); return null; }
  if (!it) {
    const n = (d.cad.items.reduce((m, x) => Math.max(m, Number(String(x.id).replace(/\D/g, '')) || 0), 0) || 0) + 1;
    it = { id: `CX-${String(n).padStart(3, '0')}`, name: `${key} \u00b7 ${cadDocNo(dr.name).split('-').slice(-2).join('-')}`, kind: 'linear', color: '', sheet: '', page: 1,
      area: dr.area, depth_ft: 0, height_ft: 0, assembly: '', master_key: '', craft: '', lines: {}, cad: { drawing: dr.id, source, key, nested: false } };
    d.cad.items.push(it);
    if (!quiet && typeof audit === 'function') audit('cad_item', it.id, 'create', null, `${dr.name} ${source} ${key}`);
  }
  it.kind = cadKindOf(source === 'block' ? 'count' : ch.measure || 'length');
  it.assembly = ch.asm || ''; it.master_key = ch.asm ? '' : ch.lib || '';
  if (ch.depth_ft !== undefined) it.depth_ft = num(ch.depth_ft);
  if (ch.height_ft !== undefined) it.height_ft = num(ch.height_ft);
  if (ch.nested !== undefined) it.cad.nested = !!ch.nested;
  if (!it.craft && it.master_key) { const lib = bdLib(it.master_key, d); it.craft = lib ? bdDefaultCraft(lib.discipline) : ''; }
  boardSync(it, d, quiet);
  return it;
}
function cadRemoveItem(d, it, quiet) {
  for (let i = d.takeoff_lines.length - 1; i >= 0; i--) if (d.takeoff_lines[i].board_item === it.id) d.takeoff_lines.splice(i, 1);
  d.cad.items.splice(d.cad.items.indexOf(it), 1);
  if (!quiet && typeof audit === 'function') audit('cad_item', it.id, 'delete', it.name, null);
}
function cadChoiceOf(it) { return { measure: it.cad.source === 'block' ? 'count' : it.kind === 'area' ? 'area' : 'length', asm: it.assembly || '', lib: it.master_key || '', depth_ft: it.depth_ft, height_ft: it.height_ft, nested: it.cad.nested }; }
function cadLearn(d, it) { d.cad.rules[`${it.cad.source}:${it.cad.key}`] = cadChoiceOf(it); }
/** Rows of a drawing that can be taken off: [{ source, key, qty info }]. */
function cadRows(dr) {
  const s = dr.summary; const rows = [];
  Object.entries(s.layers).forEach(([k, l]) => { if (l.ents) rows.push({ source: 'layer', key: k, l }); });
  Object.entries(s.blocks).forEach(([k, b]) => { if (b.direct) rows.push({ source: 'block', key: k, b }); });
  return rows;
}
function cadSuggestFor(d, source, key) {
  const learned = d.cad.rules[`${source}:${key}`];
  if (learned) return Object.assign({ why: 'your earlier choice for this name' }, learned);
  const s = typeof dxfSuggest === 'function' ? dxfSuggest(source, key) : null;
  if (!s) return null;
  if (s.asm && !d.assemblies.some((a) => a.id === s.asm)) return null;
  if (s.lib && !bdLib(s.lib, d)) return null;
  return s;
}
/** Price every unpriced row that has a suggestion. Returns { made, left }. */
function cadAutoBuild(d, dr, quiet) {
  let made = 0, left = 0;
  cadRows(dr).forEach((r) => {
    if (cadItemFor(dr, r.source, r.key, d)) return;
    const s = cadSuggestFor(d, r.source, r.key);
    if (!s) { left += 1; return; }
    if (r.source === 'layer' && s.measure === 'area' && !r.l.closed) { left += 1; return; }
    const it = cadPrice(d, dr, r.source, r.key, s, quiet); if (it) made += 1;
  });
  return { made, left };
}
function cadSyncDrawing(d, dr, quiet) { d.cad.items.filter((x) => x.cad.drawing === dr.id).forEach((it) => boardSync(it, d, quiet)); }

/* ------------------------------------------------------------ files */
const CAD_TEXT = new Map();
const CAD_DOCS = new Map();
async function cadText(dr) {
  if (CAD_TEXT.has(dr.id)) return CAD_TEXT.get(dr.id);
  let t = null;
  if (dr.src === 'sample') t = await (await fetch(dr.url)).text();
  else { const b = await bdGet(`cad:${dr.id}`).catch(() => null); if (b) t = typeof b === 'string' ? b : new TextDecoder().decode(b); }
  if (t) CAD_TEXT.set(dr.id, t);
  return t;
}
async function cadPaths(dr) {
  const k = `${dr.id}@${dr.rev}`;
  if (CAD_DOCS.has(k)) return CAD_DOCS.get(k);
  const t = await cadText(dr); if (!t) return null;
  const doc = dxfParse(t); const res = { paths: dxfPaths(doc), layers: doc.layers };
  CAD_DOCS.set(k, res); return res;
}
function cadPickFile(onText) {
  const inp = el('input', { type: 'file', accept: '.dxf,.DXF,.dwg,.DWG', style: 'display:none', onchange: async () => {
    const f = inp.files && inp.files[0]; inp.remove(); if (!f) return;
    if (/\.dwg$/i.test(f.name)) { toast('DWG files are not read yet. In your CAD program use Save As > DXF (ASCII), then open the DXF here.', true); return; }
    try { onText(f.name, await f.text()); } catch (e) { toast(`Could not read ${f.name}: ${e.message}`, true); }
  } });
  document.body.appendChild(inp); inp.click();
}

/* ==========================================================================
   VIEW — CAD Takeoff
   ========================================================================== */
const CV = { drawing: null, sel: null, z: 1, ox: 0, oy: 0, fit: '', meas: {} };
function viewCad(root) {
  const C = D.cad;
  if (!CV.drawing || !cadDrawing(CV.drawing)) CV.drawing = C.drawings[0] ? C.drawings[0].id : null;
  const dr = cadDrawing(CV.drawing);
  const areaOpts = D.areas.map((a) => [a.area_code || a.code, `${a.area_code || a.code} \u2014 ${a.area_name || a.name}`]);

  const open = () => cadPickFile((name, text) => {
    let s; try { s = dxfSummarize(dxfParse(text)); } catch (e) { toast(e.message, true); return; }
    const nd = cadAddDrawing(D, name, s, {});
    CAD_TEXT.set(nd.id, text); bdPut(`cad:${nd.id}`, text).catch(() => {});
    CV.drawing = nd.id; CV.sel = null; CV.fit = '';
    const r = cadAutoBuild(D, nd, false);
    audit('cad_drawing', nd.id, 'create', null, `${name}: ${Object.keys(s.layers).length} layers, ${Object.keys(s.blocks).length} blocks; auto-built ${r.made} item(s)`);
    refreshAll(); toast(`${name}: ${r.made} item(s) priced automatically, ${r.left} layer(s)/block(s) left for you to map`);
  });
  const revise = () => cadPickFile((name, text) => {
    let s; try { s = dxfSummarize(dxfParse(text)); } catch (e) { toast(e.message, true); return; }
    dr.prev = { summary: dr.summary, rev: dr.rev, name: dr.name, loaded: dr.loaded };
    dr.summary = s; dr.rev += 1; dr.name = name; dr.loaded = TODAY; dr.src = 'local';
    CAD_TEXT.set(dr.id, text); bdPut(`cad:${dr.id}`, text).catch(() => {}); CV.fit = '';
    cadSyncDrawing(D, dr, false);
    const r = cadAutoBuild(D, dr, false);
    audit('cad_drawing', dr.id, 'revise', `rev ${dr.prev.rev}`, `rev ${dr.rev} ${name}; ${r.made} new item(s)`);
    refreshAll(); toast(`Revision loaded: every item re-measured${r.made ? `, ${r.made} new item(s) priced` : ''}. See the Change column.`);
  });

  root.appendChild(el('div', { class: 'banner info', style: 'margin-bottom:10px' },
    el('b', { text: 'Automated takeoff from CAD. ' }),
    'Open a DXF: lengths and areas come from each layer and symbols are counted by block, straight from the drawing geometry. Price a layer or block once and the choice is remembered for every drawing in this estimate. DWG: save as DXF from your CAD program for now.'));

  root.appendChild(toolbar(
    C.drawings.length ? sel('Drawing', C.drawings.map((x) => [x.id, `${x.name} (rev ${x.rev})`]), CV.drawing, (v) => { CV.drawing = v; CV.sel = null; CV.fit = ''; TABS.refresh(); }, 300) : null,
    el('button', { class: 'primary', onclick: open }, 'Open DXF\u2026'),
    dr ? el('button', { class: 'ghost', onclick: revise, title: 'Load a newer issue of this drawing; items keep their pricing and are re-measured' }, 'Load revision\u2026') : null,
    dr ? el('button', { class: 'ghost', onclick: () => { const r = cadAutoBuild(D, dr, false); refreshAll(); toast(r.made ? `${r.made} item(s) priced automatically; ${r.left} left unmapped` : 'Nothing new to map automatically'); } }, 'Auto-build takeoff') : null,
    dr ? el('button', { class: 'ghost', onclick: () => cadExport(dr) }, 'Export (.xlsx)') : null,
    el('span', { style: 'flex:1' }),
    dr ? el('button', { class: 'ghost danger', onclick: () => {
      const its = C.items.filter((x) => x.cad.drawing === dr.id);
      modal({ title: 'Remove drawing', sub: `${dr.name}: ${its.length} CAD item(s) and their takeoff lines are removed.`, width: 420, body: el('div'),
        buttons: [{ label: 'Cancel', onClick: closeModal }, { label: 'Remove', primary: true, onClick: () => { its.forEach((it) => cadRemoveItem(D, it, false)); C.drawings.splice(C.drawings.indexOf(dr), 1); audit('cad_drawing', dr.id, 'delete', dr.name, null); CV.drawing = null; closeModal(); refreshAll(); } }] });
    } }, 'Remove drawing') : null));

  if (!dr) {
    root.appendChild(el('div', { class: 'empty-state', style: 'padding:40px;text-align:center' },
      el('div', { style: 'font-size:15px;margin-bottom:6px', text: 'No CAD drawings yet' }),
      el('div', { class: 'hint', text: 'Open a DXF plan, isometric or layout. Layers named like P-PIPE-CS-10, S-FDN or E-TRAY and blocks named like PUMP, VALVE or TRANSMITTER are priced automatically.' })));
    return;
  }

  /* drawing settings + KPIs */
  const items = C.items.filter((x) => x.cad.drawing === dr.id);
  const lines = D.takeoff_lines.filter((l) => items.some((it) => it.id === l.board_item));
  const flows = (l) => { const dd = D.disciplines.find((x) => x.discipline === l.discipline); return dd && dd.method === 'detailed_takeoff'; };
  const cost = lines.filter(flows).reduce((a, l) => a + computeLine(l).totalCost, 0);
  const held = lines.filter((l) => !flows(l)).length;
  const rows = cadRows(dr);
  const unpriced = rows.filter((r) => !cadItemFor(dr, r.source, r.key)).length;
  const changed = dr.prev ? items.filter((it) => Math.abs(cadMeasure(it, D).Q - cadMeasure(it, D, dr.prev.summary).Q) > 1e-6).length : 0;
  root.appendChild(el('div', { class: 'kpi-row' },
    kpiCard('Layers / blocks', `${Object.values(dr.summary.layers).filter((l) => l.ents).length} / ${Object.keys(dr.summary.blocks).length}`, `${dr.summary.entities} entities read`, 'text', null),
    kpiCard('Priced items', String(items.length), `${unpriced} layer(s)/block(s) not taken off`, 'blue', null),
    kpiCard('Takeoff lines', String(lines.length), held ? `${held} held (discipline not on Detailed Takeoff)` : 'all flowing to the estimate', held ? 'amber' : 'green', null),
    kpiCard('Direct cost from drawing', `USD ${M(cost)}`, 'labor, material, crew equipment', 'violet', null),
    kpiCard('Revision', `Rev ${dr.rev}`, dr.prev ? `${changed} item(s) changed since rev ${dr.prev.rev}` : `loaded ${dr.loaded || ''}`, changed ? 'amber' : 'text', null)));

  const unitSel = sel('', CAD_UNIT_OPTS, dr.units, (v) => {
    const o = dr.unit_ft; dr.units = v;
    if (v !== 'custom') dr.unit_ft = DXF_UNITS[v][1];
    dr.unit_guess = false; cadSyncDrawing(D, dr, false); audit('cad_drawing', dr.id, 'set_units', o, dr.unit_ft); refreshAll();
  }, 150);
  const customFt = el('input', { type: 'number', min: 0, step: 'any', class: 'cbs-in', style: 'width:90px', value: dr.unit_ft, 'aria-label': 'Feet per drawing unit', disabled: dr.units !== 'custom' || null,
    onchange: (e) => { dr.unit_ft = num(e.target.value) || dr.unit_ft; cadSyncDrawing(D, dr, false); audit('cad_drawing', dr.id, 'set_units', null, dr.unit_ft); refreshAll(); } });
  root.appendChild(el('div', { class: 'cad-settings' },
    el('label', { text: 'Drawing units' }), unitSel, el('span', { class: 'hint', text: '1 unit =' }), customFt, el('span', { class: 'hint', text: 'ft' }),
    dr.unit_guess ? pill('Units not set in the file: check', 'amber') : el('span', { class: 'hint', text: `from file: ${(DXF_UNITS[dr.insunits] || ['Unitless'])[0]}` }),
    el('span', { class: 'cad-sep' }),
    el('label', { text: 'Area for new items' }), sel('', areaOpts, dr.area, (v) => { dr.area = v; refreshAll(); }, 170),
    dr.summary.warnings.length ? el('span', { class: 'hint', style: 'color:var(--amber)', text: dr.summary.warnings.join('; ') }) : null));

  /* preview */
  const canvas = el('canvas', { class: 'cad-cv' });
  const info = el('div', { class: 'cad-info', text: 'Click a layer or block below to highlight it. Scroll to zoom, drag to pan.' });
  const stage = el('div', { class: 'cad-stage' }, canvas, info,
    el('div', { class: 'cad-zoom' }, el('button', { class: 'ghost', onclick: () => { CV.fit = ''; draw(); } }, 'Fit')));
  root.appendChild(card(`Preview \u2014 ${dr.name}`, stage, { flush: true }).card);
  let P = null;
  cadPaths(dr).then((p) => { P = p; if (!p) info.textContent = 'The drawing file is not stored in this browser (the takeoff is kept). Load it again with Load revision to see the preview.'; draw(); }).catch((e) => { info.textContent = `Preview unavailable: ${e.message}`; });
  function fit() {
    const ex = dr.summary.extents; const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!ex || !W) return;
    const w = Math.max(1e-9, ex.x1 - ex.x0), h = Math.max(1e-9, ex.y1 - ex.y0);
    CV.z = Math.min(W / w, H / h) * 0.92; CV.ox = W / 2 - ((ex.x0 + ex.x1) / 2) * CV.z; CV.oy = H / 2 + ((ex.y0 + ex.y1) / 2) * CV.z; CV.fit = `${dr.id}@${dr.rev}`;
  }
  function draw() {
    if (!canvas.isConnected) return;
    const dpr = window.devicePixelRatio || 1; const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = W * dpr; canvas.height = H * dpr;
    if (CV.fit !== `${dr.id}@${dr.rev}`) fit();
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (!P) return;
    const S = CV.sel; const hit = (p) => !!S && (S.source === 'layer' ? p.layer === S.key : p.block === S.key);
    const pass = (hi) => {
      P.paths.forEach((p) => {
        const h = hit(p); if (hi !== h) return;
        const lay = P.layers[p.layer];
        g.strokeStyle = h ? '#ffb020' : dxfColor(lay ? lay.color : 7); g.globalAlpha = S && !h ? 0.28 : 0.9; g.lineWidth = h ? 2.4 : 1;
        g.beginPath(); p.pts.forEach((q, k) => { const x = CV.ox + q.x * CV.z, y = CV.oy - q.y * CV.z; if (k) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke();
      });
    };
    pass(false); pass(true); g.globalAlpha = 1;
  }
  let drag = null;
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const r = canvas.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const k = e.deltaY < 0 ? 1.2 : 1 / 1.2; CV.ox = mx - (mx - CV.ox) * k; CV.oy = my - (my - CV.oy) * k; CV.z *= k; draw(); }, { passive: false });
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, ox: CV.ox, oy: CV.oy }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (!drag) return; CV.ox = drag.ox + e.clientX - drag.x; CV.oy = drag.oy + e.clientY - drag.y; draw(); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  requestAnimationFrame(draw);
  const select = (source, key, text) => { CV.sel = CV.sel && CV.sel.source === source && CV.sel.key === key ? null : { source, key }; info.textContent = CV.sel ? text : 'Click a layer or block below to highlight it.'; draw();
    root.querySelectorAll('tr.cad-row').forEach((tr) => tr.classList.toggle('on', !!CV.sel && tr.dataset.k === `${source}:${key}`)); };

  /* pricing options */
  const libOpts = (kind) => D.mh_library.filter((m) => { const u = String(m.unit).toUpperCase(); return kind === 'count' ? u === 'EA' : kind === 'area' ? ['SF', 'SY', 'M2', 'CY'].includes(u) : ['LF', 'M', 'YD', 'FT'].includes(u); });
  const priceOpts = (kind) => [['', '\u2014 not taken off \u2014'],
    ...D.assemblies.filter((a) => a.kind === kind).map((a) => [`asm:${a.id}`, `${a.id} ${a.name} (assembly)`]),
    ...libOpts(kind).map((m) => [`lib:${m.key}`, `${m.key} ${m.work_item} (${m.unit})`])];
  const choiceVal = (it) => (it ? (it.assembly ? `asm:${it.assembly}` : it.master_key ? `lib:${it.master_key}` : '') : '');
  const fromVal = (v) => (v.startsWith('asm:') ? { asm: v.slice(4) } : v.startsWith('lib:') ? { lib: v.slice(4) } : {});
  const itemCost = (it) => D.takeoff_lines.filter((l) => l.board_item === it.id).reduce((a, l) => { const c = computeLine(l); const f2w = flows(l); return { mh: a.mh + c.totalMh, cost: a.cost + (f2w ? c.totalCost : 0), n: a.n + 1, held: a.held + (f2w ? 0 : 1) }; }, { mh: 0, cost: 0, n: 0, held: 0 });
  const costCell = (c) => el('td', { class: 'num mono' }, !c ? '' : c.held === c.n ? pill('held', 'amber') : [usd0(c.cost), c.held ? el('span', { class: 'cad-held', title: 'Lines in disciplines not on Detailed Takeoff are held', text: ` +${c.held} held` }) : null]);
  const fmtQ = (v, d0) => num(v).toLocaleString('en-US', { minimumFractionDigits: d0, maximumFractionDigits: d0 });
  const delta = (it) => {
    if (!dr.prev || !it) return el('td');
    const a = cadMeasure(it, D, dr.prev.summary).Q, b = cadMeasure(it, D).Q; const dq = b - a;
    if (Math.abs(dq) < 1e-6) return el('td', { class: 'num mono hint', text: 'no change' });
    return el('td', { class: 'num mono', style: `color:var(--${dq > 0 ? 'amber' : 'blue'})`, text: `${dq > 0 ? '+' : ''}${fmtQ(dq, it.kind === 'count' ? 0 : 1)}` });
  };
  const suggestChip = (source, key, it) => {
    if (it) return null; const s = cadSuggestFor(D, source, key); if (!s) return null;
    return el('button', { class: 'ghost cad-sug', title: `Suggested because the ${s.why}`, onclick: (e) => { e.stopPropagation(); const n = cadPrice(D, dr, source, key, s, false); if (n) cadLearn(D, n); refreshAll(); } }, `Use ${s.asm || s.lib}`);
  };
  const apply = (source, key, patch, measure) => {
    const it = cadItemFor(dr, source, key);
    const base = it ? cadChoiceOf(it) : { measure: measure || (source === 'block' ? 'count' : 'length') };
    const ch = Object.assign(base, patch);
    if (patch.asm !== undefined || patch.lib !== undefined) { if (!patch.asm) delete ch.asm; if (!patch.lib) delete ch.lib; if (patch.asm) ch.lib = ''; if (patch.lib) ch.asm = ''; }
    const n = cadPrice(D, dr, source, key, ch, false);
    if (n) cadLearn(D, n); else delete D.cad.rules[`${source}:${key}`];
    refreshAll();
  };

  /* layers table */
  const layRows = rows.filter((r) => r.source === 'layer').map((r) => {
    const it = cadItemFor(dr, 'layer', r.key); const l = r.l; const f = num(dr.unit_ft);
    const measure = it ? (it.kind === 'area' ? 'area' : 'length') : CV.meas[`${dr.id}:${r.key}`] || (l.closed && /FDN|FOUND|SLAB|PLATFORM|PAV|AREA/i.test(r.key) ? 'area' : 'length');
    const kind = measure === 'area' ? 'area' : 'linear';
    const c = it ? itemCost(it) : null;
    const lay = dr.summary.layers[r.key];
    return el('tr', { class: 'cad-row', 'data-k': `layer:${r.key}`, onclick: () => select('layer', r.key, `Layer ${r.key}: ${fmtQ(l.len * f, 2)} LF${l.closed ? `, ${l.closed} closed shape(s) ${fmtQ(l.area * f * f, 2)} SF` : ''}`) },
      el('td', {}, el('span', { class: 'cad-sw', style: `background:${dxfColor(lay.color)}` }), el('span', { class: 'mono', text: r.key })),
      el('td', { class: 'num mono', text: String(l.ents) }),
      el('td', { class: 'num mono', text: fmtQ(l.len * f, 1) }),
      el('td', { class: 'num mono', text: l.closed ? String(l.closed) : '' }),
      el('td', { class: 'num mono', text: l.closed ? fmtQ(l.area * f * f, 1) : '' }),
      el('td', { onclick: (e) => e.stopPropagation() }, l.closed ? sel('', [['length', 'Length'], ['area', 'Area']], measure, (v) => { CV.meas[`${dr.id}:${r.key}`] = v; if (it) apply('layer', r.key, { measure: v, asm: '', lib: '' }); else TABS.refresh(); }, 80) : el('span', { class: 'hint', text: 'Length' })),
      el('td', { onclick: (e) => e.stopPropagation() }, sel('', priceOpts(kind), choiceVal(it), (v) => apply('layer', r.key, Object.assign({ asm: '', lib: '' }, fromVal(v)), measure), 250), suggestChip('layer', r.key, it)),
      el('td', { onclick: (e) => e.stopPropagation() }, it ? sel('', areaOpts.map((a) => [a[0], a[0]]), it.area, (v) => { it.area = v; boardSync(it, D); refreshAll(); }, 64) : null),
      el('td', { onclick: (e) => e.stopPropagation() }, it ? el('input', { type: 'number', step: 'any', min: 0, class: 'cbs-in', style: 'width:52px', value: it.depth_ft, title: 'D: depth or thickness, ft', 'aria-label': 'Depth ft', onchange: (e) => apply('layer', r.key, { depth_ft: num(e.target.value) }) }) : null),
      el('td', { onclick: (e) => e.stopPropagation() }, it ? el('input', { type: 'number', step: 'any', min: 0, class: 'cbs-in', style: 'width:52px', value: it.height_ft, title: 'H: height or insulated OD, ft', 'aria-label': 'Height ft', onchange: (e) => apply('layer', r.key, { height_ft: num(e.target.value) }) }) : null),
      el('td', { class: 'num mono', text: c ? String(c.n) : '' }),
      costCell(c),
      delta(it));
  });
  root.appendChild(card('Layers \u2014 length and area', el('div', { class: 'tbl-wrap' }, el('table', { class: 'data cad-tbl' },
    el('thead', {}, el('tr', {}, ['Layer', 'Entities', 'Length LF', 'Closed', 'Area SF', 'Measure', 'Price as', 'Area', 'D ft', 'H ft', 'Lines', 'Direct $', dr.prev ? `Change vs rev ${dr.prev.rev}` : ''].map((h, i) => el('th', { class: [1, 2, 3, 4, 10, 11, 12].includes(i) ? 'num' : null, text: h })))),
    el('tbody', {}, layRows))), { style: 'margin-top:10px' }).card);

  /* blocks table */
  const blkRows = rows.filter((r) => r.source === 'block').map((r) => {
    const it = cadItemFor(dr, 'block', r.key); const b = r.b; const c = it ? itemCost(it) : null;
    return el('tr', { class: 'cad-row', 'data-k': `block:${r.key}`, onclick: () => select('block', r.key, `Block ${r.key}: ${b.direct} placed${b.nested ? `, ${b.nested} more inside other blocks` : ''}`) },
      el('td', {}, el('span', { class: 'mono', text: r.key })),
      el('td', { class: 'num mono', text: String(b.direct) }),
      el('td', { class: 'num mono', text: b.nested ? String(b.nested) : '' }),
      el('td', { class: 'hint', text: Object.entries(b.layers).map(([k, n]) => `${k} (${n})`).join(', ') }),
      el('td', { onclick: (e) => e.stopPropagation() }, b.nested && it ? el('label', { class: 'cad-chk' }, el('input', { type: 'checkbox', checked: it.cad.nested || null, onchange: (e) => apply('block', r.key, { nested: e.target.checked }) }), ' include') : null),
      el('td', { onclick: (e) => e.stopPropagation() }, sel('', priceOpts('count'), choiceVal(it), (v) => apply('block', r.key, Object.assign({ asm: '', lib: '' }, fromVal(v)), 'count'), 250), suggestChip('block', r.key, it)),
      el('td', { onclick: (e) => e.stopPropagation() }, it ? sel('', areaOpts.map((a) => [a[0], a[0]]), it.area, (v) => { it.area = v; boardSync(it, D); refreshAll(); }, 64) : null),
      el('td', { class: 'num mono', text: it ? fmtQ(cadMeasure(it, D).Q, 0) : '' }),
      el('td', { class: 'num mono', text: c ? String(c.n) : '' }),
      costCell(c),
      delta(it));
  });
  root.appendChild(card('Blocks \u2014 symbol counts', [
    el('div', { class: 'hint', style: 'margin-bottom:6px', text: 'Nested counts are symbols drawn inside other blocks (for example valves inside a pump block). They are left out unless you tick include, because assemblies such as "Pump set, complete" already carry them.' }),
    el('div', { class: 'tbl-wrap' }, el('table', { class: 'data cad-tbl' },
      el('thead', {}, el('tr', {}, ['Block', 'Placed', 'Nested', 'On layers', 'Include', 'Price as', 'Area', 'Qty EA', 'Lines', 'Direct $', dr.prev ? `Change vs rev ${dr.prev.rev}` : ''].map((h, i) => el('th', { class: [1, 2, 7, 8, 9, 10].includes(i) ? 'num' : null, text: h })))),
      el('tbody', {}, blkRows)))], { style: 'margin-top:10px' }).card);
  if (CV.sel) requestAnimationFrame(() => root.querySelectorAll('tr.cad-row').forEach((tr) => tr.classList.toggle('on', tr.dataset.k === `${CV.sel.source}:${CV.sel.key}`)));
}

function cadExport(dr) {
  const f = num(dr.unit_ft); const s = dr.summary;
  const lay = Object.entries(s.layers).filter(([, l]) => l.ents).map(([k, l]) => { const it = cadItemFor(dr, 'layer', k); return [k, l.ents, round2(l.len * f), l.closed, round2(l.area * f * f), round2(l.perim * f), it ? it.id : '', it ? it.assembly || it.master_key : '', it ? KIND_LABEL[it.kind] : '', it ? it.area : '']; });
  const blk = Object.entries(s.blocks).map(([k, b]) => { const it = cadItemFor(dr, 'block', k); return [k, b.direct, b.nested, Object.entries(b.layers).map(([a, n]) => `${a} (${n})`).join(', '), it ? it.id : '', it ? it.assembly || it.master_key : '', it ? (it.cad.nested ? 'Yes' : 'No') : '', it ? it.area : '']; });
  const lines = D.takeoff_lines.filter((l) => D.cad.items.some((it) => it.cad.drawing === dr.id && it.id === l.board_item)).map((l) => { const c = computeLine(l); return [l.board_item, l.line_no, l.area, l.discipline, l.master_key, l.description, round2(l.quantity), l.unit, l.crew || '', round2(c.totalMh), round2(c.totalCost)]; });
  vrestDownloadXlsx(`${EST_BRAND}-CAD-takeoff-${cadDocNo(dr.name)}.xlsx`, [
    { name: 'Drawing', header: ['Field', 'Value'], rows: [['File', dr.name], ['Revision', dr.rev], ['Units', `1 drawing unit = ${dr.unit_ft} ft`], ['Entities', s.entities], ['Project', `${D.project.project_no} ${D.project.project_name}`]] },
    { name: 'Layers', header: ['Layer', 'Entities', 'Length LF', 'Closed shapes', 'Area SF', 'Perimeter LF', 'Item', 'Priced as', 'Measure', 'Area'], rows: lay },
    { name: 'Blocks', header: ['Block', 'Placed', 'Nested', 'On layers', 'Item', 'Priced as', 'Include nested', 'Area'], rows: blk },
    { name: 'Takeoff lines', header: ['Item', 'Line', 'Area', 'Discipline', 'Library key', 'Description', 'Quantity', 'Unit', 'Crew', 'MH', 'Direct $'], rows: lines },
  ]);
}
