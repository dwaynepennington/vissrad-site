/* ==========================================================================
   VREstimator — Takeoff Board and Assemblies (PlanSwift-style layer).

   The board keeps every measurement on the drawing. A takeoff item is a
   named, coloured set of marks (areas, runs or counts) on a sheet. Each item
   either prices one VREST library key, or carries an assembly: a list of
   library keys with quantity formulas driven by the measured quantity. The
   item writes and keeps up to date ordinary VREST takeoff lines
   (board_item = item id), so the Methods switch, indirects, benchmark,
   proposal and QA gate all work on board quantities without change.

   Formula variables: Q measured quantity (SF for areas, LF for runs, EA for
   counts), P perimeter LF (areas) or length (runs), D depth ft, H height ft,
   N number of marks. Functions: sqrt, ceil, round, max, min, PI.

   Drawings stay in this browser (IndexedDB). Rule-based geometry only.
   ========================================================================== */
'use strict';

const BOARD_SAMPLE = { id: 'SH-SAMPLE', name: 'VR-DEMO-001-CSA-LAY-0002_0.pdf', src: 'sample', url: 'samples/drawings/VR-DEMO-001-CSA-LAY-0002_0.pdf', pages: 2 };
const BOARD_COLOURS = ['#E8A33D', '#3D7BD6', '#48C08A', '#E23A34', '#806CE9', '#38A9C4', '#D9D24A', '#E46FB0'];
const KIND_LABEL = { area: 'Area', linear: 'Linear', count: 'Count' };
const KIND_UNIT = { area: 'SF', linear: 'LF', count: 'EA' };

/* ------------------------------------------------------------ seed data */
function boardSeedAssemblies() {
  const r = (master_key, formula, craft, extra) => Object.assign({ master_key, formula, craft, weld_key: '', item_factor: 1 }, extra || {});
  return [
    { id: 'ASM-001', name: 'Spread footing foundation', kind: 'area', discipline: 'Civil', note: 'Excavate 2 ft over-dig, form and pour, rebar at 120 lb/CY, backfill.', rows: [
      r('CIV-001', 'Q*(D+2)/27*1.3', 'Operator'), r('CIV-007', 'Q*D/27', 'Carpenter'), r('CIV-005', 'Q*D/27*0.06', 'Ironworker'), r('CIV-002', 'Q*2/27', 'Laborer')] },
    { id: 'ASM-002', name: 'Concrete slab on grade', kind: 'area', discipline: 'Civil', note: 'D = slab thickness in ft. 6 in base, 100 lb/CY rebar.', rows: [
      r('CIV-001', 'Q*(D+0.5)/27', 'Operator'), r('CIV-004', 'Q*D/27*1.05', 'Carpenter'), r('CIV-005', 'Q*D/27*0.05', 'Ironworker')] },
    { id: 'ASM-003', name: 'Platform, grating and handrail', kind: 'area', discipline: 'Structural', note: 'Handrail on the full perimeter.', rows: [
      r('STR-010', 'Q', 'Ironworker'), r('STR-011', 'P', 'Ironworker'), r('PAI-055', 'Q*0.2', 'Painter')] },
    { id: 'ASM-004', name: 'CS pipe run, 8-16 in', kind: 'linear', discipline: 'Piping', note: 'Butt weld every 40 ft, support every 20 ft, flange pair every 200 ft, 2.8 SF paint per LF.', rows: [
      r('PIP-023', 'Q', 'Pipefitter'), r('PIP-026', 'ceil(Q/40)', 'Welder', { weld_key: 'WF-01' }), r('PIP-031', 'ceil(Q/20)', 'Pipefitter'), r('PIP-028', 'ceil(Q/200)*2', 'Pipefitter'), r('PAI-053', 'Q*2.8', 'Painter')] },
    { id: 'ASM-005', name: 'CS pipe run, 2-6 in', kind: 'linear', discipline: 'Piping', note: 'Butt weld every 21 ft, support every 12 ft.', rows: [
      r('PIP-022', 'Q', 'Pipefitter'), r('PIP-025', 'ceil(Q/21)', 'Welder', { weld_key: 'WF-01' }), r('PIP-031', 'ceil(Q/12)', 'Pipefitter')] },
    { id: 'ASM-006', name: 'Hot-service pipe insulation', kind: 'linear', discipline: 'Insulation', note: 'H = insulated outside diameter in ft.', rows: [
      r('INS-048', 'Q*PI*H', 'Insulator'), r('INS-051', 'Q*PI*H', 'Insulator')] },
    { id: 'ASM-007', name: 'Pipe rack steel', kind: 'linear', discipline: 'Structural', note: '240 lb per LF of rack.', rows: [
      r('STR-009', 'Q*0.12', 'Ironworker'), r('PAI-056', 'Q*4', 'Painter')] },
    { id: 'ASM-008', name: 'Cable tray with power cable', kind: 'linear', discipline: 'Electrical', note: 'Six cables per tray, terminations every 150 ft run.', rows: [
      r('ELE-032', 'Q', 'Electrician'), r('ELE-034', 'Q*6', 'Electrician'), r('ELE-035', 'ceil(Q/150)*12', 'Electrician')] },
    { id: 'ASM-009', name: 'Pump set, complete', kind: 'count', discipline: 'Mechanical', note: 'Per pump: set and align, two block valves, two instruments, 150 ft power cable.', rows: [
      r('MEC-015', 'Q', 'Millwright/Rigger'), r('PIP-029', 'Q*2', 'Pipefitter'), r('INS-040', 'Q*2', 'Instrument Tech'), r('ELE-034', 'Q*150', 'Electrician'), r('ELE-035', 'Q*6', 'Electrician')] },
    { id: 'ASM-010', name: 'Field instrument with loop check', kind: 'count', discipline: 'Instrumentation', note: '40 ft of tubing per instrument.', rows: [
      r('INS-041', 'Q', 'Instrument Tech'), r('INS-043', 'Q*40', 'Instrument Tech'), r('INS-046', 'Q', 'Instrument Tech')] },
    { id: 'ASM-011', name: 'Lighting fixture with cable', kind: 'count', discipline: 'Electrical', rows: [
      r('ELE-038', 'Q', 'Electrician'), r('ELE-034', 'Q*60', 'Electrician')] },
  ];
}
function boardSeedDemo() {
  const rect = (x0, y0, x1, y1) => ({ pts: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] });
  const run = (...xy) => { const pts = []; for (let i = 0; i < xy.length; i += 2) pts.push({ x: xy[i], y: xy[i + 1] }); return { pts }; };
  const pt = (x, y) => ({ pts: [{ x, y }] });
  return {
    sheets: [Object.assign({}, BOARD_SAMPLE)],
    scales: { 'SH-SAMPLE:1': 0.25 },
    seq: 3,
    items: [
      { id: 'BI-001', name: 'Flare area foundations', kind: 'area', color: BOARD_COLOURS[0], sheet: 'SH-SAMPLE', page: 1, area: 'A40', depth_ft: 3, height_ft: 0, assembly: 'ASM-001', master_key: '', craft: '', lines: {},
        marks: [rect(192, 64, 297.5, 150.3), rect(364.4, 556.6, 425.8, 616.7), rect(619.8, 164.4, 689.8, 250.8), rect(622.7, 571.2, 684.2, 648.6), rect(733.3, 76.1, 815.7, 128.6), rect(799.2, 492.3, 906.7, 535.3)] },
      { id: 'BI-002', name: 'Flare header, 12 in CS', kind: 'linear', color: BOARD_COLOURS[1], sheet: 'SH-SAMPLE', page: 1, area: 'A40', depth_ft: 0, height_ft: 0, assembly: 'ASM-004', master_key: '', craft: '', lines: {},
        marks: [run(297.5, 107.2, 331, 107.2, 331, 586.6, 364.4, 586.6), run(425.8, 586.6, 522.8, 586.6, 522.8, 207.6, 619.8, 207.6), run(689.8, 207.6, 656.3, 207.6, 656.3, 609.9, 622.7, 609.9),
          run(684.2, 609.9, 708.8, 609.9, 708.8, 102.3, 733.3, 102.3), run(815.7, 102.3, 807.4, 102.3, 807.4, 513.8, 799.2, 513.8)] },
      { id: 'BI-003', name: 'Knockout drum pumps', kind: 'count', color: BOARD_COLOURS[2], sheet: 'SH-SAMPLE', page: 1, area: 'A40', depth_ft: 0, height_ft: 0, assembly: 'ASM-009', master_key: '', craft: '', lines: {},
        marks: [pt(244.7, 107.2), pt(654.8, 207.6), pt(774.5, 102.3)] },
    ],
  };
}

/* Called once on boot (before indexes). Assemblies are reference data and
   always present; the demo estimate gets the sample board, every other
   estimate starts with an empty board. */
function boardEnsure(d) {
  if (!Array.isArray(d.assemblies)) d.assemblies = boardSeedAssemblies();
  /* assembly rows without a crew field take their discipline's default crew (shown in the Crew column) */
  if (Array.isArray(d.crews)) d.assemblies.forEach((x) => x.rows.forEach((r) => { if (r.crew === undefined) { const m = bdLib(r.master_key, d); const dd = m ? d.disciplines.find((y) => y.discipline === m.discipline) : null; r.crew = dd && dd.crew ? dd.crew : ''; } }));
  if (!Array.isArray(d.scenarios)) d.scenarios = [];
  if (!d.board || !Array.isArray(d.board.items)) {
    d.board = (typeof EST_ID === 'undefined' || EST_ID === 'base') && !(window.VRUSER && window.VRUSER.user)
      ? boardSeedDemo() : { sheets: [], scales: {}, seq: 0, items: [] };
    d.board.items.forEach((it) => boardSync(it, d, true));
  }
}

/* ------------------------------------------------------------ geometry */
function bdLen(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return s; }
function bdArea(pts) { if (pts.length < 3) return 0; let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a) / 2; }
function bdScale(it, d) { const b = (d || D).board; return num(b.scales[`${it.sheet}:${it.page}`], 0) || null; }
/** Measured quantities of an item in feet units: { Q, P, N, scaled }. */
function boardMeasure(it, d) {
  if (it.cad && typeof cadMeasure === 'function') return cadMeasure(it, d); // CAD takeoff item (cadtakeoff.js)
  const f = bdScale(it, d);
  const N = it.marks.length;
  if (it.kind === 'count') return { Q: N, P: 0, N, scaled: true };
  if (!f) return { Q: 0, P: 0, N, scaled: false };
  if (it.kind === 'area') {
    const Q = it.marks.reduce((a, m) => a + bdArea(m.pts), 0) * f * f;
    const P = it.marks.reduce((a, m) => a + bdLen(m.pts.concat(m.pts.length > 2 ? [m.pts[0]] : [])), 0) * f;
    return { Q, P, N, scaled: true };
  }
  const Q = it.marks.reduce((a, m) => a + bdLen(m.pts), 0) * f;
  return { Q, P: Q, N, scaled: true };
}

/* ------------------------------------------------------------ formulas */
const BD_FN = { sqrt: Math.sqrt, ceil: Math.ceil, round: Math.round, max: Math.max, min: Math.min, PI: Math.PI };
function boardFormulaCheck(f) {
  const s = String(f || '').trim();
  if (!s) return 'Enter a formula, e.g. Q or Q*D/27';
  const rest = s.replace(/\b(sqrt|ceil|round|max|min|PI|Q|P|D|H|N)\b/g, '').replace(/[0-9.+\-*/(),\s]/g, '');
  if (rest) return `Not allowed: ${rest.slice(0, 12)}`;
  try { boardEval(s, { Q: 1, P: 1, D: 1, H: 1, N: 1 }); } catch (e) { return 'Formula does not parse'; }
  return null;
}
function boardEval(f, v) {
  // eslint-disable-next-line no-new-func
  const fn = new Function('Q', 'P', 'D', 'H', 'N', 'sqrt', 'ceil', 'round', 'max', 'min', 'PI', `return (${f});`);
  const r = fn(v.Q, v.P, v.D, v.H, v.N, BD_FN.sqrt, BD_FN.ceil, BD_FN.round, BD_FN.max, BD_FN.min, BD_FN.PI);
  return Number.isFinite(r) ? r : 0;
}

/* ------------------------------------------------------------ line sync */
function bdSheet(id, d) { return ((d || D).board.sheets || []).find((s) => s.id === id) || null; }
function bdLib(key, d) { return (d || D).mh_library.find((m) => m.key === key) || null; }
function bdDefaultCraft(disc) { return (typeof DISC_CRAFTS_FALLBACK !== 'undefined' && DISC_CRAFTS_FALLBACK[disc] ? DISC_CRAFTS_FALLBACK[disc][0] : '') || (D && D.crafts[0] ? D.crafts[0].craft : ''); }
/** The rows an item prices: [{ key, master_key, qty, craft, weld_key, item_factor, formula }]. */
function boardRows(it, d) {
  d = d || D;
  const m = boardMeasure(it, d);
  const v = { Q: m.Q, P: m.P, D: num(it.depth_ft), H: num(it.height_ft), N: m.N };
  const asm = it.assembly ? d.assemblies.find((a) => a.id === it.assembly) : null;
  const dcrew = (key) => { const l = bdLib(key, d); const dd = l ? d.disciplines.find((x) => x.discipline === l.discipline) : null; return dd && dd.crew ? dd.crew : ''; };
  if (asm) return asm.rows.map((r, i) => ({ key: String(i), master_key: r.master_key, qty: boardFormulaCheck(r.formula) ? 0 : boardEval(r.formula, v), craft: r.craft, crew: r.crew !== undefined ? r.crew : dcrew(r.master_key), weld_key: r.weld_key || '', item_factor: num(r.item_factor, 1), formula: r.formula, asm }));
  if (it.master_key) {
    const lib = bdLib(it.master_key, d);
    const mode = it.kind === 'linear' ? 'length' : it.kind;
    const qty = lib && typeof tkToUnit === 'function' ? tkToUnit(mode, m.Q, lib.unit, num(it.depth_ft)) : m.Q;
    return [{ key: 'single', master_key: it.master_key, qty, craft: it.craft, crew: dcrew(it.master_key), weld_key: '', item_factor: 1, formula: `Q in ${lib ? lib.unit : ''}` }];
  }
  return [];
}
/** Write the item's takeoff lines into d.takeoff_lines (create, update, remove). */
function boardSync(it, d, quiet) {
  d = d || D;
  it.lines = it.lines || {};
  const rows = boardRows(it, d);
  const sh = it.cad ? cadDrawing(it.cad.drawing, d) : bdSheet(it.sheet, d);
  const refs = typeof pdfTkDrawingRef === 'function' && sh ? pdfTkDrawingRef(String(sh.name).replace(/\.dxf$/i, ''), it.page) : [];
  const keep = new Set();
  rows.forEach((r, i) => {
    const lib = bdLib(r.master_key, d);
    const qty = Math.round(num(r.qty) * 100) / 100;
    let line = d.takeoff_lines.find((l) => l.line_no === it.lines[r.key] && l.board_item === it.id);
    if (!lib || !(qty > 0)) return;
    if (!line) {
      const no = nextNo(d.takeoff_lines, 'line_no', 'TKL-', 4, typeof SEQ !== 'undefined' ? SEQ : {});
      line = { id: no, line_no: no, discipline_factor: 1, global_factor: 1, item_factor: r.item_factor, weld_key: r.weld_key, board_item: it.id, drawing_refs: [] };
      d.takeoff_lines.push(line);
      it.lines[r.key] = no;
      if (!quiet && typeof audit === 'function') audit('takeoff_line', no, 'create', null, `Takeoff Board ${it.id} ${it.name}: ${r.master_key} ${qty} ${lib.unit}`);
    }
    Object.assign(line, {
      discipline: lib.discipline, area: it.area || (d.areas[0] && (d.areas[0].area_code || d.areas[0].code)) || '', master_key: lib.key,
      description: `${lib.work_item || lib.description} \u2014 ${it.name}`, quantity: qty, unit: lib.unit, uom: lib.unit,
      craft: r.craft || line.craft || bdDefaultCraft(lib.discipline),
      source: (it.cad ? `CAD takeoff: ${it.cad.source} ${it.cad.key} (${sh ? `${sh.name} rev ${sh.rev}` : 'no drawing'})` : `Takeoff Board: ${it.name} (${sh ? sh.name : 'no sheet'} p${it.page})`) + (r.asm ? `, ${r.asm.name} row ${i + 1}: ${r.formula}` : ''),
    });
    /* the assembly row's crew applies when it changes; a crew picked on the line itself is kept otherwise */
    if ((r.crew || '') !== (line.asm_crew ?? null)) { line.crew = r.crew || ''; line.asm_crew = r.crew || ''; }
    if (refs.length && !(line.drawing_refs || []).length) line.drawing_refs = refs.map((x) => Object.assign({}, x));
    keep.add(line.line_no);
  });
  for (let i = d.takeoff_lines.length - 1; i >= 0; i--) {
    const l = d.takeoff_lines[i];
    if (l.board_item === it.id && !keep.has(l.line_no)) {
      d.takeoff_lines.splice(i, 1);
      if (!quiet && typeof audit === 'function') audit('takeoff_line', l.line_no, 'delete', `${l.master_key} ${l.quantity}`, `Removed by Takeoff Board ${it.id}`);
    }
  }
  Object.keys(it.lines).forEach((k) => { if (!keep.has(it.lines[k])) delete it.lines[k]; });
}
function boardLines(it) { return D.takeoff_lines.filter((l) => l.board_item === it.id); }

/* ------------------------------------------------------------ drawing files */
const BD_DB = 'vrestimator';
function bdIdb() {
  return new Promise((res, rej) => {
    let idb = null; try { idb = window[['indexed', 'DB'].join('')]; } catch (e) { idb = null; }
    if (!idb) { rej(new Error('Browser drawing storage unavailable')); return; }
    const r = idb.open(BD_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('sheets');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function bdPut(id, bytes) { const db = await bdIdb(); return new Promise((res, rej) => { const t = db.transaction('sheets', 'readwrite'); t.objectStore('sheets').put(bytes, id); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function bdGet(id) { const db = await bdIdb(); return new Promise((res, rej) => { const q = db.transaction('sheets').objectStore('sheets').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); }); }
const BD_DOCS = new Map();
async function bdDoc(sheet) {
  if (BD_DOCS.has(sheet.id)) return BD_DOCS.get(sheet.id);
  let bytes = null;
  if (sheet.src === 'sample') bytes = new Uint8Array(await (await fetch(sheet.url)).arrayBuffer());
  else { const b = await bdGet(sheet.id).catch(() => null); if (b) bytes = new Uint8Array(b); }
  if (!bytes) return null;
  const lib = await estPdfjs();
  const doc = await lib.getDocument({ data: bytes, isEvalSupported: false }).promise;
  BD_DOCS.set(sheet.id, doc);
  return doc;
}

/* ==========================================================================
   VIEW — Takeoff Board
   ========================================================================== */
const BV = { sheet: null, page: 1, item: null, tool: 'select', z: 1, ox: 0, oy: 0, img: null, W: 0, H: 0, cur: [], cal: [], selMark: null, box: null, hover: null, fitted: '', busy: false };

function viewBoard(root) {
  const B = D.board;
  if (!BV.sheet || !bdSheet(BV.sheet)) { BV.sheet = B.sheets[0] ? B.sheets[0].id : null; BV.page = 1; }
  if (BV.item && !B.items.some((i) => i.id === BV.item)) BV.item = null;
  if (!BV.item && B.items[0]) BV.item = B.items.find((i) => i.sheet === BV.sheet)?.id || null;

  const fileIn = el('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, style: 'display:none', onchange: (e) => addPdfs([...e.target.files]) });
  const sideList = el('div', { class: 'bd-list' });
  const props = el('div', { class: 'bd-props' });
  const canvas = el('canvas', { class: 'bd-cv' });
  const hint = el('div', { class: 'bd-hint' });
  const empty = el('div', { class: 'bd-empty' });
  const stage = el('div', { class: 'bd-stage' }, canvas, hint, empty);
  const sheetSel = el('select', { 'aria-label': 'Sheet', onchange: (e) => { const [s, p] = e.target.value.split('|'); BV.sheet = s; BV.page = Number(p); BV.fitted = ''; BV.cur = []; loadPage(); drawSide(); } });
  const scaleChip = el('span', { class: 'bd-chip' });
  const zoomLbl = el('span', { class: 'mono bd-zoom' });
  const toolBtns = {};
  const tools = [['select', 'Select / pan', 'V'], ['draw', 'Measure', 'M'], ['scale', 'Set scale', 'K'], ['auto', 'Auto count', 'A']];
  const toolSeg = el('div', { class: 'bd-seg', role: 'group', 'aria-label': 'Tool' }, tools.map(([id, lb, k]) => (toolBtns[id] = el('button', { onclick: () => setTool(id), title: `${lb} (${k})` }, lb))));

  root.appendChild(el('div', { class: 'bd-wrap' },
    el('aside', { class: 'bd-side' },
      el('div', { class: 'bd-side-head' },
        el('div', { class: 'bd-side-title' }, el('b', { text: 'Takeoff items' }), el('span', { class: 'hint', text: 'Measured on the drawing; each one writes takeoff lines.' })),
        el('div', { class: 'bd-new' }, ['area', 'linear', 'count'].map((k) => el('button', { class: 'ghost', onclick: () => newItem(k), title: `New ${KIND_LABEL[k].toLowerCase()} item on this sheet` }, `+ ${KIND_LABEL[k]}`)))),
      sideList, props),
    el('div', { class: 'bd-main' },
      el('div', { class: 'toolbar bd-tools' },
        toolSeg, sheetSel,
        el('button', { class: 'ghost', onclick: () => fileIn.click(), title: 'Add PDF drawings to this estimate (kept in this browser)' }, 'Add PDF\u2026'), fileIn,
        scaleChip,
        el('span', { style: 'flex:1' }),
        el('button', { class: 'ghost', onclick: () => zoomBy(1 / 1.25), title: 'Zoom out', 'aria-label': 'Zoom out' }, '\u2212'), zoomLbl,
        el('button', { class: 'ghost', onclick: () => zoomBy(1.25), title: 'Zoom in', 'aria-label': 'Zoom in' }, '+'),
        el('button', { class: 'ghost', onclick: () => { fit(); paint(); } }, 'Fit')),
      stage)));

  const ctx = canvas.getContext('2d');
  if (BV.ro) BV.ro.disconnect();
  BV.ro = new ResizeObserver(() => { sizeCanvas(); if (BV.fitted !== `${BV.sheet}:${BV.page}`) fit(); paint(); });
  BV.ro.observe(stage);

  drawSheetSel(); drawSide(); setTool(BV.tool); loadPage();

  /* ------------------------------------------------ side panel */
  function drawSheetSel() {
    sheetSel.textContent = '';
    if (!B.sheets.length) sheetSel.appendChild(el('option', { value: '' }, 'No drawings yet'));
    B.sheets.forEach((s) => { for (let p = 1; p <= (s.pages || 1); p++) sheetSel.appendChild(el('option', { value: `${s.id}|${p}`, selected: s.id === BV.sheet && p === BV.page || null }, `${s.name.replace(/\.pdf$/i, '')}  p${p}`)); });
  }
  function drawSide() {
    sideList.textContent = '';
    if (!B.items.length) sideList.appendChild(el('div', { class: 'bd-none' }, B.sheets.length ? 'No takeoff items. Start an Area, Linear or Count item, then measure on the drawing.' : 'Add a PDF drawing first, set its scale, then start an item.'));
    const bySheet = groupBy(B.items, (i) => `${i.sheet}|${i.page}`);
    for (const [k, list] of bySheet) {
      const [sid, pg] = k.split('|'); const sh = bdSheet(sid);
      sideList.appendChild(el('div', { class: 'bd-grp', text: `${sh ? sh.name.replace(/\.pdf$/i, '') : 'Missing sheet'} \u00b7 p${pg}` }));
      list.forEach((it) => {
        const m = boardMeasure(it);
        const n = boardLines(it).length;
        sideList.appendChild(el('div', { class: `bd-item${it.id === BV.item ? ' active' : ''}`, tabindex: 0, onclick: () => activate(it), onkeydown: (e) => { if (e.key === 'Enter') activate(it); } },
          el('span', { class: 'bd-sw', style: `background:${it.color}` }),
          el('div', { class: 'bd-nm' }, el('div', { text: it.name }), el('small', { text: `${KIND_LABEL[it.kind]} \u00b7 ${it.assembly ? (D.assemblies.find((a) => a.id === it.assembly) || {}).name || 'assembly' : it.master_key || 'not priced'} \u00b7 ${n} line${n === 1 ? '' : 's'}` })),
          el('div', { class: 'bd-q mono', text: m.scaled ? `${tkFmt(m.Q, it.kind === 'count' ? 0 : 1)} ${KIND_UNIT[it.kind]}` : 'no scale' })));
      });
    }
    drawProps();
  }
  function activate(it) {
    BV.item = it.id; BV.cur = [];
    if (it.sheet !== BV.sheet || it.page !== BV.page) { BV.sheet = it.sheet; BV.page = it.page; BV.fitted = ''; drawSheetSel(); loadPage(); }
    if (BV.tool === 'select') setTool('draw');
    drawSide(); paint();
  }
  function cur() { return B.items.find((i) => i.id === BV.item) || null; }
  function changed(it, quiet) { if (it) boardSync(it, D, quiet); buildIndexes(); saveOverlay(); refreshStatus(); drawSide(); paint(); }

  function drawProps() {
    props.textContent = '';
    const it = cur(); if (!it) return;
    const m = boardMeasure(it);
    const asms = D.assemblies.filter((a) => a.kind === it.kind);
    const name = el('input', { type: 'text', value: it.name, onchange: (e) => { it.name = e.target.value.trim() || it.name; changed(it); } });
    const colour = el('input', { type: 'color', value: it.color, onchange: (e) => { it.color = e.target.value; changed(null); } });
    const area = sel('', D.areas.map((a) => [a.area_code || a.code, `${a.area_code || a.code} \u2014 ${a.area_name || a.name}`]), it.area, (v) => { it.area = v; changed(it); });
    const priced = sel('', [['', '\u2014 Not priced \u2014'], ...asms.map((a) => [`A:${a.id}`, `Assembly: ${a.name}`]), ...D.mh_library.map((l) => [`K:${l.key}`, `Item: ${l.key} ${l.work_item || l.description} (${l.unit})`])],
      it.assembly ? `A:${it.assembly}` : it.master_key ? `K:${it.master_key}` : '', (v) => { it.assembly = v.startsWith('A:') ? v.slice(2) : ''; it.master_key = v.startsWith('K:') ? v.slice(2) : ''; if (it.master_key) it.craft = bdDefaultCraft((bdLib(it.master_key) || {}).discipline); changed(it); });
    const depth = el('input', { type: 'number', step: '0.25', min: 0, value: it.depth_ft, onchange: (e) => { it.depth_ft = num(e.target.value); changed(it); } });
    const height = el('input', { type: 'number', step: '0.25', min: 0, value: it.height_ft, onchange: (e) => { it.height_ft = num(e.target.value); changed(it); } });
    const lines = boardLines(it);
    const nonDetailed = [...new Set(lines.map((l) => l.discipline))].filter((dn) => { const dd = D.disciplines.find((x) => x.discipline === dn); return dd && dd.method !== 'detailed_takeoff'; });
    let mh = 0, cost = 0;
    lines.forEach((l) => { const c = computeLine(l); mh += c.totalMh; cost += c.totalCost; });
    props.append(
      el('div', { class: 'bd-props-head' }, el('b', { text: it.id }), el('span', { class: 'hint', text: `${KIND_LABEL[it.kind]} \u00b7 ${it.marks.length} mark${it.marks.length === 1 ? '' : 's'}` })),
      el('div', { class: 'form-grid bd-form' },
        el('label', { text: 'Name' }), name, el('label', { text: 'Color' }), colour, el('label', { text: 'Area' }), area,
        el('label', { text: 'Priced with' }), priced,
        el('label', { text: 'Depth D (ft)' }), depth, el('label', { text: 'Height H (ft)' }), height),
      el('div', { class: 'bd-meas' },
        el('span', {}, 'Q ', el('b', { class: 'mono', text: m.scaled ? `${tkFmt(m.Q, 1)} ${KIND_UNIT[it.kind]}` : 'set scale' })),
        it.kind !== 'count' ? el('span', {}, 'P ', el('b', { class: 'mono', text: m.scaled ? `${tkFmt(m.P, 1)} LF` : '\u2014' })) : null,
        el('span', {}, 'MH ', el('b', { class: 'mono', text: tkFmt(mh, 0) })), el('span', {}, '$ ', el('b', { class: 'mono', text: USD(cost) }))),
      nonDetailed.length ? el('div', { class: 'banner warn bd-banner' },
        `${nonDetailed.join(', ')} ${nonDetailed.length > 1 ? 'are' : 'is'} priced by another method on Methods; these lines are held but do not flow into the direct cost.`,
        el('button', { class: 'ghost', onclick: () => { nonDetailed.forEach((dn) => { const dd = D.disciplines.find((x) => x.discipline === dn); const o = dd.method; dd.method = 'detailed_takeoff'; audit('discipline', dn, 'set_method', o, 'detailed_takeoff'); }); changed(null); toast(`${nonDetailed.join(', ')} switched to Detailed Takeoff`); } }, 'Use Detailed Takeoff')) : null,
      lines.length ? el('table', { class: 'data bd-lines' }, el('thead', {}, el('tr', {}, ['Line', 'Key', 'Qty', 'UOM', 'MH'].map((h, i) => el('th', { class: i > 1 && i !== 3 ? 'num' : null, text: h })))),
        el('tbody', {}, lines.map((l) => { const c = computeLine(l); return el('tr', { title: l.description }, el('td', { class: 'mono', text: l.line_no }), el('td', { class: 'mono', text: l.master_key }), el('td', { class: 'num mono', text: tkFmt(l.quantity, 2) }), el('td', { text: l.uom }), el('td', { class: 'num mono', text: tkFmt(c.totalMh, 1) })); }))) : el('div', { class: 'hint', text: it.assembly || it.master_key ? 'Measure on the drawing to write takeoff lines.' : 'Choose an assembly or a library item to price this item.' }),
      el('div', { class: 'toolbar bd-acts' },
        el('button', { class: 'ghost', onclick: () => { if (!it.marks.length) return; it.marks.pop(); changed(it); } }, 'Undo mark'),
        el('button', { class: 'ghost', onclick: () => { it.marks = []; changed(it); } }, 'Clear marks'),
        el('button', { class: 'ghost', onclick: () => dupItem(it) }, 'Duplicate'),
        el('button', { class: 'ghost danger', onclick: () => delItem(it) }, 'Delete')));
  }
  function newItem(kind) {
    if (!BV.sheet) { toast('Add a PDF drawing first', true); fileIn.click(); return; }
    B.seq = num(B.seq) + 1;
    const id = `BI-${String(B.seq).padStart(3, '0')}`;
    const asm = D.assemblies.find((a) => a.kind === kind);
    const it = { id, name: `${KIND_LABEL[kind]} item ${B.seq}`, kind, color: BOARD_COLOURS[(B.seq - 1) % BOARD_COLOURS.length], sheet: BV.sheet, page: BV.page,
      area: (D.areas[0] && (D.areas[0].area_code || D.areas[0].code)) || '', depth_ft: kind === 'area' ? 1 : 0, height_ft: 0, assembly: asm ? asm.id : '', master_key: '', craft: '', lines: {}, marks: [] };
    B.items.push(it); BV.item = id; BV.cur = [];
    audit('board_item', id, 'create', null, `${KIND_LABEL[kind]} item on ${bdSheet(BV.sheet).name} p${BV.page}`);
    setTool('draw'); changed(it);
  }
  function dupItem(it) {
    B.seq = num(B.seq) + 1;
    const id = `BI-${String(B.seq).padStart(3, '0')}`;
    const c = JSON.parse(JSON.stringify(it)); Object.assign(c, { id, name: `${it.name} (copy)`, lines: {}, marks: [], color: BOARD_COLOURS[(B.seq - 1) % BOARD_COLOURS.length] });
    B.items.push(c); BV.item = id; changed(c);
  }
  function delItem(it) {
    modal({ title: `Delete ${it.name}?`, sub: `${boardLines(it).length} takeoff line(s) written by this item are removed too`, width: 480,
      body: el('div', { class: 'banner warn' }, 'The marks on the drawing and the takeoff lines this item wrote are deleted. Lines you added by hand are not touched.'),
      buttons: [{ label: 'Keep', onClick: closeModal }, { label: 'Delete item', primary: true, onClick: () => {
        it.marks = []; it.assembly = ''; it.master_key = ''; boardSync(it);
        B.items.splice(B.items.indexOf(it), 1); audit('board_item', it.id, 'delete', it.name, null);
        BV.item = null; closeModal(); changed(null);
      } }] });
  }

  /* ------------------------------------------------ drawings */
  async function addPdfs(files) {
    for (const f of files) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const lib = await estPdfjs();
        const doc = await lib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
        const id = `SH-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
        await bdPut(id, bytes).catch(() => toast('Browser storage is unavailable; the drawing is open for this session only', true));
        BD_DOCS.set(id, doc);
        B.sheets.push({ id, name: f.name, src: 'idb', pages: doc.numPages });
        BV.sheet = id; BV.page = 1; BV.fitted = '';
        audit('board_sheet', id, 'add', null, `${f.name}, ${doc.numPages} page(s)`);
      } catch (e) { toast(`Could not read ${f.name}: ${e.message}`, true); }
    }
    fileIn.value = ''; saveOverlay(); drawSheetSel(); drawSide(); loadPage();
    setTool('scale');
  }
  async function loadPage() {
    BV.img = null; paint();
    const sh = bdSheet(BV.sheet);
    if (!sh) { showEmpty(true); return; }
    showEmpty(false);
    try {
      const doc = await bdDoc(sh);
      if (!doc) { showEmpty(true, `${sh.name} is not in this browser any more. Add the PDF again.`); return; }
      const page = await doc.getPage(BV.page);
      const vp1 = page.getViewport({ scale: 1 });
      const rs = Math.min(3, Math.sqrt(14e6 / (vp1.width * vp1.height)));
      const vp = page.getViewport({ scale: rs });
      const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: x, viewport: vp }).promise;
      BV.img = c; BV.W = vp1.width; BV.H = vp1.height; BV.page_obj = page;
      if (BV.fitted !== `${BV.sheet}:${BV.page}`) fit();
      paint();
    } catch (e) { showEmpty(true, `Could not open the drawing: ${e.message}`); }
  }
  function showEmpty(on, msg) {
    empty.hidden = !on; empty.textContent = '';
    if (on) empty.append(el('b', { text: msg ? 'Drawing unavailable' : 'No drawing on the board' }),
      el('p', { text: msg || 'Add PDF drawings, set the scale from a known dimension, then measure areas, runs and counts. Each takeoff item prices itself through an assembly of library items.' }),
      el('button', { class: 'primary', onclick: () => fileIn.click() }, 'Add PDF drawings'));
  }

  /* ------------------------------------------------ view transform */
  function sizeCanvas() { const r = stage.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1; canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr)); canvas.style.width = `${r.width}px`; canvas.style.height = `${r.height}px`; }
  function fit() {
    if (!BV.W) return; const r = stage.getBoundingClientRect(); if (!r.width) return;
    BV.z = Math.min((r.width - 24) / BV.W, (r.height - 24) / BV.H); BV.ox = (r.width - BV.W * BV.z) / 2; BV.oy = (r.height - BV.H * BV.z) / 2; BV.fitted = `${BV.sheet}:${BV.page}`;
  }
  function zoomBy(f, cx, cy) { const r = stage.getBoundingClientRect(); cx = cx ?? r.width / 2; cy = cy ?? r.height / 2; const nz = Math.max(0.1, Math.min(20, BV.z * f)); BV.ox = cx - (cx - BV.ox) * (nz / BV.z); BV.oy = cy - (cy - BV.oy) * (nz / BV.z); BV.z = nz; paint(); }
  function toPt(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - BV.ox) / BV.z, y: (e.clientY - r.top - BV.oy) / BV.z }; }
  function ortho(p, prev, e) { if (!e.shiftKey || !prev) return p; return Math.abs(p.x - prev.x) > Math.abs(p.y - prev.y) ? { x: p.x, y: prev.y } : { x: prev.x, y: p.y }; }

  /* ------------------------------------------------ paint */
  function paint() {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    const f = BV.sheet ? num(B.scales[`${BV.sheet}:${BV.page}`], 0) : 0;
    scaleChip.textContent = f ? `Scale 1 ft = ${(1 / f).toFixed(2)} pt` : 'Scale not set';
    scaleChip.classList.toggle('unset', !f);
    zoomLbl.textContent = `${Math.round(BV.z * 100)}%`;
    if (!BV.img) return;
    ctx.setTransform(dpr * BV.z, 0, 0, dpr * BV.z, dpr * BV.ox, dpr * BV.oy);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(BV.img, 0, 0, BV.W, BV.H);
    const lw = 1 / BV.z;
    for (const it of B.items) {
      if (it.sheet !== BV.sheet || it.page !== BV.page) continue;
      const act = it.id === BV.item;
      ctx.strokeStyle = it.color; ctx.fillStyle = `${it.color}${act ? '55' : '33'}`; ctx.lineWidth = (act ? 3 : 2) * lw;
      it.marks.forEach((m, mi) => {
        const selM = BV.selMark && BV.selMark.item === it.id && BV.selMark.i === mi;
        if (it.kind === 'count') {
          const p = m.pts[0]; const r = 6 * lw;
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = it.color; ctx.fill();
          ctx.lineWidth = 1.5 * lw; ctx.strokeStyle = selM ? '#fff' : '#111'; ctx.stroke();
          ctx.fillStyle = '#111'; ctx.font = `600 ${8 * lw}px Inter,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(mi + 1), p.x, p.y + 0.3 * lw);
          ctx.strokeStyle = it.color; ctx.lineWidth = (act ? 3 : 2) * lw; ctx.fillStyle = `${it.color}${act ? '55' : '33'}`;
          return;
        }
        ctx.beginPath(); m.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        if (it.kind === 'area') { ctx.closePath(); ctx.fill(); }
        if (selM) { ctx.save(); ctx.setLineDash([6 * lw, 4 * lw]); ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.restore(); } else ctx.stroke();
      });
    }
    // current run, calibration, auto-count box
    const it = cur();
    if (BV.cur.length && it) {
      ctx.strokeStyle = it.color; ctx.lineWidth = 2 * lw; ctx.setLineDash([5 * lw, 3 * lw]);
      ctx.beginPath(); const pts = BV.hover ? BV.cur.concat([BV.hover]) : BV.cur; pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (it.kind === 'area' && pts.length > 2) ctx.closePath();
      ctx.stroke(); ctx.setLineDash([]);
      BV.cur.forEach((p) => { ctx.fillStyle = it.color; ctx.fillRect(p.x - 3 * lw, p.y - 3 * lw, 6 * lw, 6 * lw); });
    }
    if (BV.cal.length) {
      ctx.strokeStyle = '#E23A34'; ctx.lineWidth = 2 * lw; ctx.beginPath(); const pts = BV.hover && BV.cal.length === 1 ? BV.cal.concat([BV.hover]) : BV.cal;
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    }
    if (BV.box) { ctx.strokeStyle = '#38A9C4'; ctx.lineWidth = 1.5 * lw; ctx.setLineDash([4 * lw, 3 * lw]); ctx.strokeRect(BV.box.x, BV.box.y, BV.box.w, BV.box.h); ctx.setLineDash([]); }
    hintText();
  }
  function hintText() {
    const it = cur(); const f = BV.sheet ? B.scales[`${BV.sheet}:${BV.page}`] : null;
    let t = '';
    if (!BV.sheet) t = '';
    else if (BV.busy) t = 'Searching the sheet for matching symbols\u2026';
    else if (BV.tool === 'scale') t = BV.cal.length ? 'Click the second end of a known dimension.' : 'Set scale: click both ends of a dimension whose real length you know.';
    else if (BV.tool === 'auto') t = it && it.kind === 'count' ? 'Auto count: drag a box round one symbol. Every match on this page is added to the item.' : 'Auto count works on a Count item. Pick or start one.';
    else if (BV.tool === 'draw') {
      if (!it) t = 'Pick a takeoff item on the left, or start a new one.';
      else if (it.sheet !== BV.sheet || it.page !== BV.page) t = `${it.name} is on another sheet. Pick it to jump there.`;
      else if (it.kind !== 'count' && !f) t = 'Set the scale on this sheet before measuring lengths and areas.';
      else if (it.kind === 'count') t = `Click each ${it.name} item. Backspace removes the last mark.`;
      else t = BV.cur.length ? `Click the next point. Double-click or Enter to finish${it.kind === 'area' ? ' (closes the shape)' : ''}. Shift keeps it square, Esc cancels.` : `Click to start a ${it.kind === 'area' ? 'shape' : 'run'} for ${it.name}.`;
    } else t = BV.selMark ? 'Mark selected. Delete removes it.' : 'Drag to pan, scroll to zoom, click a mark to select it.';
    hint.textContent = t;
  }

  /* ------------------------------------------------ interaction */
  function setTool(t) { BV.tool = t; BV.cur = []; BV.cal = []; BV.box = null; Object.entries(toolBtns).forEach(([k, b]) => b.classList.toggle('on', k === t)); canvas.style.cursor = t === 'select' ? 'grab' : 'crosshair'; paint(); }
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!BV.img) return;
    canvas.setPointerCapture(e.pointerId);
    const p = toPt(e);
    if (e.button === 1 || e.button === 2 || BV.tool === 'select' || e.altKey) {
      if (BV.tool === 'select' && e.button === 0) { const h = hit(p); BV.selMark = h; if (h) { BV.item = h.item; drawSide(); } }
      drag = { kind: 'pan', x: e.clientX, y: e.clientY, ox: BV.ox, oy: BV.oy, moved: false }; canvas.style.cursor = 'grabbing'; paint(); return;
    }
    if (BV.tool === 'auto') { drag = { kind: 'box', p0: p }; BV.box = { x: p.x, y: p.y, w: 0, h: 0 }; return; }
    if (BV.tool === 'scale') { BV.cal.push(p); if (BV.cal.length === 2) askScale(); paint(); return; }
    if (BV.tool === 'draw') clickDraw(ortho(p, BV.cur[BV.cur.length - 1], e), e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (drag && drag.kind === 'pan') { BV.ox = drag.ox + e.clientX - drag.x; BV.oy = drag.oy + e.clientY - drag.y; paint(); return; }
    const p = toPt(e);
    if (drag && drag.kind === 'box') { BV.box = { x: Math.min(p.x, drag.p0.x), y: Math.min(p.y, drag.p0.y), w: Math.abs(p.x - drag.p0.x), h: Math.abs(p.y - drag.p0.y) }; paint(); return; }
    if (BV.cur.length || BV.cal.length === 1) { BV.hover = ortho(p, (BV.cur.length ? BV.cur : BV.cal)[(BV.cur.length ? BV.cur : BV.cal).length - 1], e); paint(); }
  });
  canvas.addEventListener('pointerup', () => {
    if (drag && drag.kind === 'box') { const b = BV.box; drag = null; if (b && b.w > 3 && b.h > 3) runAuto(b); else { BV.box = null; paint(); } return; }
    drag = null; canvas.style.cursor = BV.tool === 'select' ? 'grab' : 'crosshair';
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('dblclick', () => finishRun());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const r = canvas.getBoundingClientRect(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  const onKey = (e) => {
    if (!document.body.contains(root) || !root.classList.contains('active')) { document.removeEventListener('keydown', onKey); return; }
    if (/INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || '')) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { BV.cur = []; BV.cal = []; BV.box = null; BV.selMark = null; paint(); }
    else if (k === 'enter') finishRun();
    else if (k === 'backspace') { e.preventDefault(); if (BV.cur.length) { BV.cur.pop(); paint(); } else { const it = cur(); if (it && it.marks.length && BV.tool === 'draw') { it.marks.pop(); changed(it); } } }
    else if (k === 'delete' && BV.selMark) { const it = B.items.find((i) => i.id === BV.selMark.item); if (it) { it.marks.splice(BV.selMark.i, 1); BV.selMark = null; changed(it); } }
    else if (k === 'v') setTool('select'); else if (k === 'm') setTool('draw'); else if (k === 'k') setTool('scale'); else if (k === 'a') setTool('auto');
  };
  if (BV.onKey) document.removeEventListener('keydown', BV.onKey);
  BV.onKey = onKey;
  document.addEventListener('keydown', onKey);

  function clickDraw(p) {
    const it = cur();
    if (!it) { toast('Pick a takeoff item, or start a new one', true); return; }
    if (it.sheet !== BV.sheet || it.page !== BV.page) { toast(`${it.name} belongs to another sheet`, true); return; }
    if (it.kind === 'count') { it.marks.push({ pts: [p] }); changed(it); return; }
    if (!B.scales[`${BV.sheet}:${BV.page}`]) { toast('Set the scale on this sheet first', true); setTool('scale'); return; }
    BV.cur.push(p); paint();
  }
  function finishRun() {
    const it = cur(); if (!it || !BV.cur.length) return;
    // a double-click adds the same point twice; drop near-duplicates
    const pts = BV.cur.filter((p, i, a) => !i || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 0.5);
    if ((it.kind === 'area' && pts.length < 3) || (it.kind === 'linear' && pts.length < 2)) { toast(it.kind === 'area' ? 'An area needs at least three points' : 'A run needs at least two points', true); return; }
    it.marks.push({ pts }); BV.cur = []; BV.hover = null; changed(it);
  }
  function hit(p) {
    const tol = 6 / BV.z;
    for (const it of B.items.slice().reverse()) {
      if (it.sheet !== BV.sheet || it.page !== BV.page) continue;
      for (let i = it.marks.length - 1; i >= 0; i--) {
        const pts = it.marks[i].pts;
        if (it.kind === 'count') { if (Math.hypot(pts[0].x - p.x, pts[0].y - p.y) < tol * 1.5) return { item: it.id, i }; continue; }
        if (it.kind === 'area' && inPoly(p, pts)) return { item: it.id, i };
        for (let j = 1; j < pts.length + (it.kind === 'area' ? 1 : 0); j++) { const a = pts[j - 1], b = pts[j % pts.length]; if (segDist(p, a, b) < tol) return { item: it.id, i }; }
      }
    }
    return null;
  }
  function inPoly(p, pts) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; }
  function segDist(p, a, b) { const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy; const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0; return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)); }

  function askScale() {
    const ptLen = bdLen(BV.cal);
    const real = el('input', { type: 'number', step: 'any', min: 0, id: 'bd-real', placeholder: 'e.g. 20' });
    const unit = el('select', { id: 'bd-unit' }, el('option', { value: 'ft' }, 'feet'), el('option', { value: 'in' }, 'inches'), el('option', { value: 'm' }, 'meters'));
    const err = el('div', { class: 'field-err' });
    modal({ title: 'Set the drawing scale', sub: `Measured ${ptLen.toFixed(1)} pt on ${bdSheet(BV.sheet).name} p${BV.page}`, width: 460,
      body: el('div', {}, el('div', { class: 'form-grid' }, el('label', { text: 'Real length' }), real, el('label', { text: 'Unit' }), unit), err),
      buttons: [{ label: 'Cancel', onClick: () => { BV.cal = []; closeModal(); paint(); } }, { label: 'Set scale', primary: true, onClick: () => {
        const v = Number(real.value); if (!(v > 0) || !(ptLen > 0)) { err.textContent = 'Enter the real length of the dimension you clicked.'; return; }
        const ft = unit.value === 'm' ? v / 0.3048 : unit.value === 'in' ? v / 12 : v;
        const key = `${BV.sheet}:${BV.page}`; const old = B.scales[key];
        B.scales[key] = ft / ptLen; audit('board_scale', key, 'set', old ? (1 / old).toFixed(3) : null, `${(ptLen / ft).toFixed(3)} pt/ft`);
        BV.cal = []; closeModal();
        B.items.filter((i) => i.sheet === BV.sheet && i.page === BV.page).forEach((i) => boardSync(i));
        setTool(cur() ? 'draw' : 'select'); changed(null);
        toast(`Scale set: 1 ft = ${(ptLen / ft).toFixed(2)} pt`);
      } }] });
    setTimeout(() => real.focus(), 30);
  }
  async function runAuto(b) {
    const it = cur();
    if (!it || it.kind !== 'count') { toast('Pick or start a Count item for auto count', true); BV.box = null; paint(); return; }
    if (BV.busy || !BV.page_obj) return;
    BV.busy = true; paint();
    try {
      const k = Math.min(150 / 72, Math.sqrt(12e6 / (BV.W * BV.H)), Math.max(10 / Math.min(b.w, b.h), 1));
      const img = await tkGreyPage(BV.page_obj, k);
      const tpl = tkCrop(img, Math.round(b.x * k), Math.round(b.y * k), Math.round(b.w * k), Math.round(b.h * k));
      const hits = await tkFindSymbol(img, tpl, { minScore: 0.8 });
      if (!hits) toast('The box is blank: drag it round the symbol lines', true);
      else {
        const tol = Math.max(b.w, b.h) * 0.5;
        let added = 0;
        hits.forEach((h) => { const c = { x: (h.x + h.w / 2) / k, y: (h.y + h.h / 2) / k }; if (!it.marks.some((m) => Math.hypot(m.pts[0].x - c.x, m.pts[0].y - c.y) < tol)) { it.marks.push({ pts: [c], auto: Math.round(h.score * 100) / 100 }); added += 1; } });
        audit('board_item', it.id, 'auto_count', null, `${added} match(es) added at 0.80`);
        toast(`${added} match${added === 1 ? '' : 'es'} added to ${it.name}. Check them on the drawing; select and Delete any wrong one.`);
      }
    } catch (e) { toast(`Auto count failed: ${e.message}`, true); }
    BV.busy = false; BV.box = null; changed(it);
  }
}

/* ==========================================================================
   VIEW — Assemblies
   ========================================================================== */
function viewAssemblies(root) {
  const used = (a) => D.board.items.filter((i) => i.assembly === a.id).length;
  const libOpts = D.mh_library.map((l) => [l.key, `${l.key} \u2014 ${l.work_item || l.description} (${l.unit})`]);
  const sample = { area: { Q: 1000, P: 130, N: 1 }, linear: { Q: 100, P: 100, N: 1 }, count: { Q: 1, P: 0, N: 1 } };
  root.appendChild(el('div', { class: 'banner info', style: 'margin-bottom:10px' },
    'An assembly turns one measurement into many library items. Formulas use Q (measured SF, LF or EA), P (perimeter or length, LF), D (depth ft), H (height ft), N (marks), with sqrt, ceil, round, max, min and PI. Every row prices through the VREST man-hour library, material prices, crafts and weld factors. ',
    demoFlag('Demo factors')));
  root.appendChild(toolbar(el('button', { class: 'primary', onclick: () => newAsm() }, '+ New assembly'), el('span', { class: 'hint', text: `${D.assemblies.length} assemblies` })));
  const host = el('div', { class: 'asm-grid' });
  root.appendChild(host);
  D.assemblies.forEach((a) => host.appendChild(asmCard(a)));

  function save(a) { D.board.items.filter((i) => i.assembly === a.id).forEach((i) => boardSync(i)); refreshAll(); }
  function asmCard(a) {
    const s = Object.assign({ D: a.kind === 'area' ? 1 : 0, H: 1 }, sample[a.kind]);
    let mhPer = 0, costPer = 0;
    const rows = a.rows.map((r, i) => {
      const bad = boardFormulaCheck(r.formula);
      const q = bad ? 0 : boardEval(r.formula, s);
      const lib = bdLib(r.master_key);
      if (lib) { const c = computeLine({ master_key: r.master_key, quantity: q, craft: r.craft, crew: r.crew, weld_key: r.weld_key, item_factor: r.item_factor, discipline_factor: 1, global_factor: 1 }); mhPer += c.totalMh; costPer += c.totalCost; }
      return el('tr', {},
        el('td', {}, sel('', libOpts, r.master_key, (v) => { r.master_key = v; const l = bdLib(v); if (l) r.craft = bdDefaultCraft(l.discipline); save(a); }, 260)),
        el('td', {}, el('input', { type: 'text', class: `mono${bad ? ' bad' : ''}`, value: r.formula, title: bad || 'Quantity formula', style: 'width:150px', onchange: (e) => { const v = e.target.value.trim(); const err = boardFormulaCheck(v); if (err) { toast(err, true); e.target.classList.add('bad'); return; } r.formula = v; save(a); } })),
        el('td', { class: 'num mono', text: `${tkFmt(q, 2)} ${lib ? lib.unit : ''}` }),
        el('td', {}, sel('', D.crafts.map((c) => [c.craft, c.craft]), r.craft, (v) => { r.craft = v; save(a); }, 140)),
        el('td', {}, sel('', [['', '\u2014 craft rate \u2014'], ...(D.crews || []).map((c) => [c.id, `${c.id} ${c.name}`])], r.crew || '', (v) => { r.crew = v; save(a); }, 150)),
        el('td', {}, sel('', [['', '\u2014'], ...D.weld_factors.map((w) => [w.key, `${w.key} \u00d7${w.factor}`])], r.weld_key || '', (v) => { r.weld_key = v; save(a); }, 100)),
        el('td', {}, el('input', { type: 'number', step: '0.05', min: 0.1, value: r.item_factor, style: 'width:64px', onchange: (e) => { r.item_factor = num(e.target.value, 1); save(a); } })),
        el('td', {}, el('button', { class: 'ghost x', title: 'Remove row', 'aria-label': 'Remove row', onclick: () => { a.rows.splice(i, 1); save(a); } }, '\u00d7')));
    });
    const unit = KIND_UNIT[a.kind];
    return card(null, [
      el('div', { class: 'asm-head' },
        el('input', { type: 'text', class: 'asm-name', value: a.name, onchange: (e) => { a.name = e.target.value.trim() || a.name; save(a); } }),
        pill(KIND_LABEL[a.kind], a.kind === 'area' ? 'amber' : a.kind === 'linear' ? 'blue' : 'green'),
        el('span', { class: 'hint', text: `${a.id} \u00b7 ${a.discipline || ''} \u00b7 used by ${used(a)} item(s)` }),
        el('span', { style: 'flex:1' }),
        el('button', { class: 'ghost', onclick: () => { const c = JSON.parse(JSON.stringify(a)); c.id = nextAsmId(); c.name = `${a.name} (copy)`; D.assemblies.push(c); refreshAll(); } }, 'Duplicate'),
        el('button', { class: 'ghost danger', disabled: used(a) > 0 || null, title: used(a) ? 'In use on the Takeoff Board' : 'Delete assembly', onclick: () => { D.assemblies.splice(D.assemblies.indexOf(a), 1); refreshAll(); } }, 'Delete')),
      a.note ? el('div', { class: 'hint', style: 'margin:2px 0 6px', text: a.note }) : null,
      el('div', { class: 'tbl-wrap' }, el('table', { class: 'data asm-tbl' },
        el('thead', {}, el('tr', {}, ['Library item', 'Formula', `Qty per ${tkFmt(s.Q, 0)} ${unit}`, 'Craft', 'Crew', 'Weld', 'Factor', ''].map((h, i) => el('th', { class: i === 2 ? 'num' : null, text: h })))),
        el('tbody', {}, rows))),
      el('div', { class: 'asm-foot' },
        el('button', { class: 'ghost', onclick: () => { const k = D.mh_library.find((l) => l.discipline === a.discipline) || D.mh_library[0]; a.rows.push({ master_key: k.key, formula: 'Q', craft: bdDefaultCraft(k.discipline), crew: crewForDisc(k.discipline), weld_key: '', item_factor: 1 }); save(a); } }, '+ Row'),
        el('span', { class: 'hint', text: `Sample ${tkFmt(s.Q, 0)} ${unit}${a.kind === 'area' ? `, P ${s.P} LF, D ${s.D} ft` : ''}:` }),
        el('b', { class: 'mono', text: `${tkFmt(mhPer, 1)} MH` }), el('b', { class: 'mono', text: `USD ${USD(costPer)}` }),
        el('span', { class: 'hint', text: `= ${tkFmt(mhPer / s.Q, 3)} MH/${unit}, USD ${tkFmt(costPer / s.Q, 2)}/${unit}` })),
    ], { class: 'asm-card' }).card;
  }
  function nextAsmId() { let n = D.assemblies.length + 1, id; do { id = `ASM-${String(n).padStart(3, '0')}`; n++; } while (D.assemblies.some((a) => a.id === id)); return id; }
  function newAsm() {
    const name = el('input', { type: 'text', placeholder: 'e.g. Duct bank, 4-way' });
    const kind = el('select', {}, ['area', 'linear', 'count'].map((k) => el('option', { value: k }, KIND_LABEL[k])));
    const disc = el('select', {}, D.disciplines.map((d) => el('option', { value: d.discipline }, d.discipline)));
    modal({ title: 'New assembly', sub: 'Rows can be added after it is created', width: 460,
      body: el('div', { class: 'form-grid' }, el('label', { text: 'Name' }), name, el('label', { text: 'Measured as' }), kind, el('label', { text: 'Discipline' }), disc),
      buttons: [{ label: 'Cancel', onClick: closeModal }, { label: 'Create', primary: true, onClick: () => {
        const k = D.mh_library.find((l) => l.discipline === disc.value) || D.mh_library[0];
        D.assemblies.push({ id: nextAsmId(), name: name.value.trim() || 'New assembly', kind: kind.value, discipline: disc.value, rows: [{ master_key: k.key, formula: 'Q', craft: bdDefaultCraft(disc.value), crew: crewForDisc(disc.value), weld_key: '', item_factor: 1 }] });
        closeModal(); refreshAll();
      } }] });
  }
}

/* First visit: start blank (user mode) or explore the synthetic demo. */
function vrestWelcome() {
  const K = window.VR_STANDALONE ? 'vrestimator.welcome.v1' : 'vissrad.estimating.welcome.v1';
  if (STORE.get(K)) return;
  STORE.set(K, '1');
  const choice = (title, text, fn) => el('button', { class: 'welcome-opt', onclick: fn }, el('b', { text: title }), el('span', { text: text }));
  modal({ title: `Welcome to ${EST_BRAND}`, sub: 'Drawing takeoff, assemblies and AACE Class 1\u20135 estimating in one tool', width: 560,
    body: el('div', { class: 'welcome' },
      choice('Start a blank estimate', 'Your own estimate with the man-hour library, crafts, material prices and assemblies; no quantities or drawings.', () => { closeModal(); estNewDialog(); }),
      choice('Explore the demo estimate', 'VR-DEMO-001, a synthetic Gulf Coast project with a measured flare-area layout, Bid Desk set and takeoff lines.', () => { closeModal(); TABS.go('board'); })),
    buttons: [{ label: 'Close', onClick: closeModal }] });
}
