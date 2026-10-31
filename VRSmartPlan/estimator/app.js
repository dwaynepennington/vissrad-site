/* ==========================================================================
   VREST — Estimating (browser module)

   A browser build of an AACE Class 1-5 EPC estimating workbench, modelled on
   Master-EPC-Estimate-Tool.xlsx (see /home/user/workspace/handoff/
   est-workbook-map.md for the full read-out of that workbook). Every
   discipline independently picks Parametric, Known Quantity or Detailed
   Takeoff; whichever method is active for a discipline is the one whose
   result flows into the direct-cost rollup, the indirects build-up and the
   dashboard. Engineering can run as detailed FEED + Detail phases or as a
   factored % of direct cost under EPCM — never both, guarded explicitly.

   The man-hour library values are demo values generated for this build, not
   copied from a proprietary man-hour manual — the source workbook's own
   published donor man-hour tables are copyrighted and were flagged
   incomplete in its own QA sheet. Every screen that surfaces a library value
   carries a "demo values" flag so nobody mistakes it for sourced data.
   ========================================================================== */
'use strict';

/* VREstimator: VREST engine + PlanSwift-style Takeoff Board and assemblies
   (board.js) + InEight-style cost breakdown, resources and what-if (cbs.js) +
   VREST workbook import/export (xio.js). */
const MODULE_ID = 'estimating';
const LS_KEY = window.VR_STANDALONE ? 'vrestimator.estimate.v1' : 'vissrad.estimating.v1';
const STORE = makeStore(LS_KEY);
const USER = SUITE_USER;
const TODAY = '2026-08-26';

let D = null;
let TABS = null;
let SEQ = { line: 0 };

const UI = {
  discipline: 'All',
  takeoffDisc: null,
  takeoffSearch: '',
  librarySearch: '',
  libraryDisc: 'All',
  selLine: null,
  benchDisc: 'All',
};

/* ==========================================================================
   money + small helpers
   ========================================================================== */
const sum = (arr, k) => arr.reduce((a, x) => a + num(k ? x[k] : x), 0);
const M = (v) => `${(num(v) / 1e6).toFixed(2)}M`;
const K = (v) => int(Math.round(num(v) / 1000));
const USD = (v) => int(Math.round(num(v)));
const MH = (v) => int(Math.round(num(v)));
const signed = (v) => (num(v) < 0 ? `(${USD(Math.abs(v))})` : USD(v));
const varColour = (v) => (num(v) < -0.5 ? 'accent' : num(v) > 0.5 ? 'green' : 'grey');

const METHOD_LABEL = {
  parametric: 'Parametric',
  known_qty: 'Known Quantity',
  detailed_takeoff: 'Detailed Takeoff',
};
const METHOD_COLOUR = { parametric: 'blue', known_qty: 'violet', detailed_takeoff: 'green' };

function demoFlag(text) {
  return el('span', { class: 'demo-flag', title: 'Generated for this demo — not sourced from a proprietary man-hour manual' },
    '\u26A0 ', text || 'Demo values');
}

/* ==========================================================================
   persistence — overlay of user edits replayed over the seed
   ========================================================================== */
/* Several estimates. The register lists them; the open one is `current`.
   The seeded estimate ('base') keeps the original storage key so edits made
   before estimates could be added still load; every other estimate is held
   under its own key with its own header. Issued estimates are listed as
   historical. */
const EST_REG_KEY = window.VR_STANDALONE ? 'vrestimator.register' : 'vissrad.estimating.register';
function estRegister() {
  let r = null;
  try { r = JSON.parse(STORE.get(EST_REG_KEY) || 'null'); } catch (e) { r = null; }
  if (!r || !Array.isArray(r.list)) r = { current: 'base', list: [] };
  return r;
}
function estSaveRegister(r) { STORE.set(EST_REG_KEY, JSON.stringify(r)); }
/* ?est=<id> pins a window to one estimate, so a second window (New window)
   keeps showing its estimate when another window switches. */
const EST_URL = new URLSearchParams(location.search).get('est');
const EST_ID = (() => { const r = estRegister(); const want = EST_URL || r.current; return want !== 'base' && r.list.some((x) => x.id === want) ? want : 'base'; })();
const EST_KEY = EST_ID === 'base' ? LS_KEY : `${LS_KEY}@${EST_ID}`;
window.EST_ID = EST_ID;

function loadOverlay() {
  if (!STORE.persistent) return null;
  const raw = STORE.get(EST_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
function saveOverlay() {
  const overlay = {
    disciplines: D.disciplines,
    takeoff_lines: D.takeoff_lines,
    engineering: D.engineering,
    indirects: D.indirects,
    benchmark: D.benchmark,
    board: D.board, assemblies: D.assemblies, scenarios: D.scenarios, crews: D.crews, cad: D.cad, sched: D.sched,
    mh_library: D.mh_library, material_prices: D.material_prices, crafts: D.crafts, weld_factors: D.weld_factors, areas: D.areas,
    estimate_status: D.project.estimate_status,
    estimate_class: D.project.estimate_class,
    audit: D.audit,
    seq: SEQ,
  };
  if (EST_ID !== 'base') overlay.project = D.project;
  STORE.set(EST_KEY, JSON.stringify(overlay));
  estNoteInRegister();
}
/* Keep the register's label and status in step with the open estimate. */
function estNoteInRegister() {
  const r = estRegister();
  const row = { id: EST_ID, no: D.project.project_no, name: D.project.project_name, client: D.project.client, cls: D.project.estimate_class, status: D.project.estimate_status, updated: TODAY };
  const i = r.list.findIndex((x) => x.id === EST_ID);
  if (i >= 0) { const o = r.list[i]; if (o.no === row.no && o.name === row.name && o.status === row.status && o.cls === row.cls && o.client === row.client) return; r.list[i] = Object.assign(o, row); }
  else if (EST_ID === 'base') r.list.unshift(Object.assign(row, { created: D.project.estimate_date || TODAY }));
  else return;
  estSaveRegister(r);
}
function applyOverlay() {
  const ov = loadOverlay();
  if (!ov) return;
  if (ov.project) Object.assign(D.project, ov.project);
  if (ov.disciplines) D.disciplines = ov.disciplines;
  ['board', 'assemblies', 'scenarios', 'crews', 'cad', 'sched', 'mh_library', 'material_prices', 'crafts', 'weld_factors', 'areas'].forEach((k) => { if (ov[k]) D[k] = ov[k]; });
  if (ov.takeoff_lines) {
    /* Lines saved before drawing references existed keep the seeded references. */
    const seedRefs = new Map(D.takeoff_lines.map((l) => [l.line_no, l.drawing_refs]));
    D.takeoff_lines = ov.takeoff_lines;
    D.takeoff_lines.forEach((l) => { if (!Array.isArray(l.drawing_refs)) l.drawing_refs = seedRefs.get(l.line_no) || []; });
  }
  if (ov.engineering) D.engineering = ov.engineering;
  if (ov.indirects) D.indirects = ov.indirects;
  if (ov.benchmark) D.benchmark = ov.benchmark;
  if (ov.estimate_status) D.project.estimate_status = ov.estimate_status;
  if (ov.estimate_class) D.project.estimate_class = ov.estimate_class;
  if (ov.audit) D.audit = ov.audit;
  if (ov.seq) SEQ = ov.seq;
}

function audit(entity, ref, action, oldV, newV) {
  D.audit.push(auditRecord(entity, ref, action, oldV, newV, USER, TODAY));
}

/* ==========================================================================
   indexes + derived calculation — pure functions of D, recomputed on every
   view build so a method switch or a takeoff-line edit visibly moves every
   dependent tab.
   ========================================================================== */
let IDX = null;

function buildIndexes() {
  IDX = {
    discByName: byKey(D.disciplines, 'discipline'),
    mhByKey: byKey(D.mh_library, 'key'),
    matByKey: byKey(D.material_prices, 'key'),
    craftByName: byKey(D.crafts, 'craft'),
    weldByKey: byKey(D.weld_factors, 'key'),
    linesByDisc: groupBy(D.takeoff_lines, (r) => r.discipline),
  };
  /* Crew mixes (crews.js): blended $/MH and equipment $/MH per crew. */
  IDX.crewById = typeof crewIndex === 'function' ? crewIndex() : new Map();
}

/** Compute MH/cost for one takeoff line from qty, library MH, factors, craft rate. */
function computeLine(line) {
  const mhRow = IDX.mhByKey.get(line.master_key);
  const matRow = IDX.matByKey.get(line.master_key);
  const unitMh = line.unit_mh_override !== null && line.unit_mh_override !== undefined
    ? num(line.unit_mh_override) : num(mhRow ? mhRow.unit_mh : 0);
  const weldFactor = line.weld_key && IDX.weldByKey.get(line.weld_key)
    ? num(IDX.weldByKey.get(line.weld_key).factor) : 1;
  const totalFactor = num(line.discipline_factor, 1) * num(line.global_factor, 1)
    * num(line.item_factor, 1) * weldFactor;
  const totalMh = num(line.quantity) * unitMh * totalFactor;
  /* A crew on the line sets the labor rate (crew blended $/MH) and adds the
     crew's equipment at $/MH; without a crew the line's craft rate applies. */
  const crew = line.crew && IDX.crewById ? IDX.crewById.get(line.crew) : null;
  const rate = crew ? crew.perMh : line.craft && IDX.craftByName.get(line.craft)
    ? IDX.craftByName.get(line.craft).all_in_rate : 0;
  const laborCost = totalMh * rate;
  const crewEquip = crew ? totalMh * crew.equipPerMh : 0;
  const unitMatl = matRow ? num(matRow.unit_material_cost) : 0;
  const materialCost = num(line.quantity) * unitMatl;
  /* InEight-style cost types: optional equipment and subcontract $ per unit. */
  const equipCost = num(line.quantity) * num(line.equip_unit_cost) + crewEquip;
  const subCost = num(line.quantity) * num(line.sub_unit_cost);
  return {
    mhRow, matRow, unitMh, weldFactor, totalFactor, totalMh, rate, laborCost, crew, crewEquip,
    unitMatl, materialCost, equipCost, subCost, totalCost: laborCost + materialCost + equipCost + subCost,
  };
}

/** Roll up a discipline's active ("USED") direct $, MH, labor $, material $
    according to its chosen method — the centrepiece switch. */
function disciplineUsed(disc) {
  const lines = IDX.linesByDisc.get(disc.discipline) || [];
  let takeoffCost = 0, takeoffMh = 0, takeoffLabor = 0, takeoffMatl = 0, takeoffEquip = 0, takeoffSub = 0;
  for (const ln of lines) {
    const c = computeLine(ln);
    takeoffCost += c.totalCost; takeoffMh += c.totalMh;
    takeoffLabor += c.laborCost; takeoffMatl += c.materialCost;
    takeoffEquip += c.equipCost; takeoffSub += c.subCost;
  }
  let usedEquip = 0, usedSub = 0;
  const knownCost = num(disc.known_qty) * num(disc.known_unit_rate);
  let usedDirect, usedMh, usedLabor, usedMatl, sourceLabel;
  if (disc.method === 'detailed_takeoff') {
    usedDirect = takeoffCost; usedMh = takeoffMh; usedLabor = takeoffLabor; usedMatl = takeoffMatl;
    usedEquip = takeoffEquip; usedSub = takeoffSub;
    sourceLabel = 'Takeoff lines';
  } else if (disc.method === 'known_qty') {
    usedDirect = knownCost;
    usedLabor = knownCost * num(disc.labor_pct);
    usedMatl = knownCost - usedLabor;
    const blended = blendedRateForDisc(disc.discipline);
    usedMh = blended ? usedLabor / blended : 0;
    sourceLabel = 'Known quantity \u00d7 rate';
  } else {
    usedDirect = num(disc.parametric_cost);
    usedLabor = usedDirect * num(disc.labor_pct);
    usedMatl = usedDirect - usedLabor;
    const blended = blendedRateForDisc(disc.discipline);
    usedMh = blended ? usedLabor / blended : 0;
    sourceLabel = 'Parametric CER';
  }
  return {
    disc, lines, takeoffCost, takeoffMh, knownCost, usedDirect, usedMh,
    usedLabor, usedMatl, usedEquip, usedSub, sourceLabel, hasLines: lines.length > 0,
  };
}

/** "Scan drawings (PDF)" lives in pdfscan.js, loaded on first use. */
let SCAN_JS = null;
/** Open the drawing scan; `files` ([{name, bytes}]) are read straight away. */
function openScanLazy(files) {
  if (!SCAN_JS) SCAN_JS = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'pdfscan.js'; s.onload = res; s.onerror = () => { SCAN_JS = null; rej(new Error('pdfscan.js not found')); }; document.head.appendChild(s); });
  SCAN_JS.then(() => openPdfScan(() => refreshAll(), Array.isArray(files) ? files : null)).catch((e) => toast(`Could not open the drawing scan: ${e.message}`, true));
}

function blendedRateForDisc(discName) {
  const dd = IDX.discByName.get(discName);
  const dc = dd && dd.crew && IDX.crewById ? IDX.crewById.get(dd.crew) : null;
  if (dc && dc.perMh > 0) return dc.perMh;
  const crafts = DISC_CRAFTS_FALLBACK[discName] || [];
  const rows = crafts.map((c) => IDX.craftByName.get(c)).filter(Boolean);
  if (!rows.length) return num([...IDX.craftByName.values()][0]?.all_in_rate, 45);
  return sum(rows, 'all_in_rate') / rows.length;
}
const DISC_CRAFTS_FALLBACK = {
  Civil: ['Operator', 'Carpenter', 'Laborer'],
  Structural: ['Ironworker', 'Millwright/Rigger', 'Welder'],
  Mechanical: ['Millwright/Rigger', 'Boilermaker', 'Welder'],
  Piping: ['Pipefitter', 'Welder', 'Boilermaker'],
  Electrical: ['Electrician', 'Laborer'],
  Instrumentation: ['Instrument Tech', 'Electrician'],
  Insulation: ['Insulator', 'Laborer'],
  Painting: ['Painter', 'Laborer'],
};

/** Full estimate rollup: direct construction -> procurement -> indirects ->
    EPCM -> owner -> escalation -> contingency -> TIC. Recomputed live. */
function rollup() {
  const usedByDisc = D.disciplines.map(disciplineUsed);
  const totalDirect = sum(usedByDisc, 'usedDirect');
  const totalMh = sum(usedByDisc, 'usedMh');
  const totalLabor = sum(usedByDisc, 'usedLabor');
  const totalMatl = sum(usedByDisc, 'usedMatl');

  const eng = engineeringCost(totalDirect);
  const ind = D.indirects;

  const fieldIndirectPct = sum(Object.values(ind.field_indirects), null);
  const fieldIndirects = totalDirect * fieldIndirectPct;

  const epcmBasis = totalDirect;
  const epcmTotalPct = num(ind.epcm_pct_of_direct);
  let epcmTotal = epcmBasis * epcmTotalPct;
  let engineeringCostUsed = eng.totalCost;
  let epcmEngineeringSlice = 0;
  if (eng.source === 'factored') {
    // Factored route: engineering is a % slice OF the EPCM total, and the
    // FEED/Detail phase man-hour cost must be zero to avoid double counting.
    epcmEngineeringSlice = epcmTotal * num(ind.epcm_split.engineering_design_pct);
    engineeringCostUsed = 0;
  } else {
    // Detailed route: FEED+Detail phase cost stands alone; the EPCM
    // engineering slice is explicitly zeroed so it is never added twice.
    epcmEngineeringSlice = 0;
  }
  const epcmOther = epcmTotal - (eng.source === 'factored' ? epcmEngineeringSlice : 0);

  const procurementPct = num(ind.epcm_split.procurement_services_pct);
  const procurementCost = epcmBasis * procurementPct;

  const ownerCost = totalDirect * num(ind.owner_cost_pct);
  const subtotalBeforeEsc = totalDirect + engineeringCostUsed + epcmOther
    + (eng.source === 'factored' ? epcmEngineeringSlice : 0) + fieldIndirects + ownerCost;
  const escalation = subtotalBeforeEsc * num(ind.escalation_pct);
  const subtotalBeforeCont = subtotalBeforeEsc + escalation;
  const contingency = subtotalBeforeCont * num(ind.contingency_pct);
  const tic = subtotalBeforeCont + contingency;

  const accLow = tic * (1 + num(D.project.accuracy_low_pct) / 100);
  const accHigh = tic * (1 + num(D.project.accuracy_high_pct) / 100);

  return {
    usedByDisc, totalDirect, totalMh, totalLabor, totalMatl,
    eng, engineeringCostUsed, epcmTotal, epcmEngineeringSlice, epcmOther,
    procurementCost, fieldIndirects, fieldIndirectPct, ownerCost, escalation,
    contingency, tic, accLow, accHigh,
  };
}

function engineeringCost(totalDirect) {
  const e = D.engineering;
  const rate = num(e.eng_rate);
  const feedMh = phaseMh(e.feed);
  const detailMh = phaseMh(e.detail);
  const detailedTotalMh = feedMh + detailMh;
  const detailedCost = detailedTotalMh * rate;
  const factoredCost = totalDirect * num(e.factored_epcm_engineering_pct);
  return {
    source: e.source_active || e.engineering_source,
    feedMh, detailMh, detailedTotalMh, detailedCost, factoredCost,
    totalCost: (e.engineering_source === 'factored') ? factoredCost : detailedCost,
  };
}
function phaseMh(phase) {
  const base = num(phase.base_design_mh);
  const sup = base * num(phase.supervision_pct);
  const pm = base * num(phase.pm_pct);
  const di = base * num(phase.discipline_integration_pct);
  const rw = base * num(phase.rework_pct);
  return base + sup + pm + di + rw;
}

/* ==========================================================================
   QA checks — dashboard + audit tab draw from this
   ========================================================================== */
function evaluateQaChecks(R) {
  const checks = [];
  const noLineDetailed = D.disciplines.filter((d) => d.method === 'detailed_takeoff'
    && (IDX.linesByDisc.get(d.discipline) || []).length === 0);
  checks.push({
    check: 'Detailed Takeoff selected with zero takeoff lines', count: noLineDetailed.length,
    status: noLineDetailed.length ? 'REVIEW' : 'OK',
    detail: noLineDetailed.length
      ? `${noLineDetailed.map((d) => d.discipline).join(', ')} — add takeoff lines or choose another method.`
      : 'Every discipline on Detailed Takeoff has at least one line.',
  });
  const missingCraft = D.takeoff_lines.filter((l) => !l.craft || !IDX.craftByName.get(l.craft));
  checks.push({
    check: 'Takeoff lines missing a valid craft assignment', count: missingCraft.length,
    status: missingCraft.length ? 'REVIEW' : 'OK',
    detail: missingCraft.length ? `${missingCraft.length} line(s) need a craft.` : 'All lines carry a craft.',
  });
  const needsDwg = D.takeoff_lines.filter((l) => ['Piping', 'Instrumentation'].includes(l.discipline) && !(l.drawing_refs || []).length);
  checks.push({
    check: 'Piping and instrument lines with no drawing reference', count: needsDwg.length,
    status: needsDwg.length ? 'REVIEW' : 'OK',
    detail: needsDwg.length
      ? `${needsDwg.map((l) => l.line_no).join(', ')} \u2014 add the P&ID or isometric the quantity was taken from.`
      : 'Every piping and instrument line names its P&ID, isometric or loop drawing.',
  });
  const staleDwg = D.takeoff_lines.filter((l) => (l.drawing_refs || []).some((r) => drefStatus(r) === 'superseded'));
  checks.push({
    check: 'Takeoff lines priced on a superseded drawing revision', count: staleDwg.length,
    status: staleDwg.length ? 'REVIEW' : 'OK',
    detail: staleDwg.length
      ? `${staleDwg.map((l) => `${l.line_no} (${l.drawing_refs.filter((r) => drefStatus(r) === 'superseded').map((r) => `${drefShort(r.doc_no)} r${r.rev} \u2192 r${drawRegisterGet(r.doc_no).rev}`).join(', ')})`).join('; ')} \u2014 check the quantities against the current revision.`
      : (drawRegister().length ? 'Every referenced drawing is at its current register revision.' : 'No DEng register loaded, so revisions cannot be checked.'),
  });
  const badQty = D.takeoff_lines.filter((l) => !(num(l.quantity) > 0));
  checks.push({
    check: 'Takeoff lines with zero or missing quantity', count: badQty.length,
    status: badQty.length ? 'REVIEW' : 'OK',
    detail: badQty.length ? `${badQty.length} line(s) have no quantity.` : 'All lines carry a positive quantity.',
  });
  const guardOk = (D.engineering.engineering_source === 'factored' && R.engineeringCostUsed === 0)
    || (D.engineering.engineering_source === 'detailed' && R.epcmEngineeringSlice === 0);
  checks.push({
    check: 'Engineering double-count guard (FEED+Detail vs factored EPCM)', count: guardOk ? 0 : 1,
    status: guardOk ? 'OK' : 'REVIEW',
    detail: guardOk ? 'Only one engineering cost source is active.' : 'Both engineering sources appear active — check the Engineering tab.',
  });
  const benchRows = benchmarkRows(R);
  const badBench = benchRows.filter((b) => Math.abs(b.variancePct) > 20);
  checks.push({
    check: 'Benchmark variance beyond \u00b120% of built-up MH', count: badBench.length,
    status: badBench.length ? 'REVIEW' : 'OK',
    detail: badBench.length
      ? `${badBench.map((b) => b.discipline).join(', ')} outside tolerance — review method or benchmark basis.`
      : 'All disciplines with a benchmark are within tolerance.',
  });
  const contPct = num(D.indirects.contingency_pct) * 100;
  const roadmapRow = D.class_roadmap.find((c) => c.aace_class === D.project.estimate_class);
  const contOk = !roadmapRow || (contPct >= roadmapRow.typical_contingency_pct * 100 - 5
    && contPct <= roadmapRow.typical_contingency_pct * 100 + 10);
  checks.push({
    check: `Contingency within ${D.project.estimate_class} typical range`, count: contOk ? 0 : 1,
    status: contOk ? 'OK' : 'REVIEW',
    detail: roadmapRow ? `${contPct.toFixed(0)}% vs typical ${(roadmapRow.typical_contingency_pct * 100).toFixed(0)}% for ${D.project.estimate_class}.` : 'No roadmap row found.',
  });
  return checks;
}

function benchmarkRows(R) {
  return D.benchmark.map((b) => {
    const used = R.usedByDisc.find((u) => u.disc.discipline === b.discipline);
    const disc = used ? used.disc : null;
    // Method-2 cross-check: benchmark MH per USD 1,000 of the discipline's
    // *active* direct cost (whatever method built that cost), adjusted by an
    // editable field factor. This needs no quantity lookup, so it compares
    // cleanly no matter which method (Parametric / Known Quantity / Detailed
    // Takeoff) is currently driving the discipline.
    const adjRate = num(b.benchmark_mh_per_1000usd) * num(b.field_factor);
    const costBasis = used ? used.usedDirect : 0;
    const benchmarkMh = adjRate * (costBasis / 1000);
    const builtUpMh = used ? used.usedMh : 0;
    const deltaMh = builtUpMh - benchmarkMh;
    const variancePct = benchmarkMh ? (deltaMh / benchmarkMh) * 100 : 0;
    return { ...b, adjRate, costBasis, benchmarkMh, builtUpMh, deltaMh, variancePct, disc };
  });
}

/* ==========================================================================
   validation + mutation helpers
   ========================================================================== */
function nextLineId() {
  SEQ.line = num(SEQ.line, 0) + 1;
  return `TKL-${String(SEQ.line + 1000).padStart(4, '0')}`;
}

function refreshAll() {
  buildIndexes();
  saveOverlay();
  if (TABS) TABS.refresh();
  refreshStatus();
}

function refreshStatus() {
  const R = rollup();
  suiteStatus([
    ['Estimate class', D.project.estimate_class],
    ['Status', D.project.estimate_status],
    ['TIC', `USD ${M(R.tic)}`],
    ['Direct cost', `USD ${M(R.totalDirect)}`],
    ['Edits', STORE.persistent ? 'held in browser storage' : 'in memory for this session'],
  ]);
}

/* ==========================================================================
   normalize — seed.py's raw field names (work_item, uom-as-unit, area
   code/name, nested proposal.fee_rows, etc.) are adapted here once, to the
   names the views use, so every downstream view/read stays simple.
   ========================================================================== */
function normalizeData(d) {
  d.areas.forEach((a) => { a.area_code = a.code; a.area_name = a.name; });
  d.mh_library.forEach((m) => { m.description = m.work_item; m.uom = m.unit; });
  d.material_prices.forEach((m) => {
    const lib = d.mh_library.find((x) => x.key === m.key);
    m.description = lib ? lib.description : m.key;
    m.uom = m.unit;
  });
  d.weld_factors.forEach((w) => { w.description = w.material; });
  d.benchmark.forEach((b) => { b.description = b.work_item; });
  d.takeoff_lines.forEach((l) => {
    l.line_no = l.id;
    l.uom = l.unit;
    if (!Array.isArray(l.drawing_refs)) l.drawing_refs = [];
  });
  const feeRows = (d.proposal.fee_rows || []).map((f) => ({ ...f, rate: f.bill_rate, fee_usd: f.fee }));
  d.proposal_meta = {
    proposal_date: d.proposal.proposal_date,
    validity_days: d.proposal.validity_days,
    estimate_class_proposed: d.proposal.estimate_class_proposed,
    target_accuracy: d.proposal.target_accuracy,
    pricing_basis_date: d.proposal.pricing_basis_date,
  };
  d.proposal = feeRows;
  // estimate_status seed default is "Working" — treat as the "Draft" stage
  // in the 3-stage Draft/In Review/Issued status ladder used by the UI.
  if (d.project.estimate_status === 'Working') d.project.estimate_status = 'Draft';
}

/* ==========================================================================
   boot
   ========================================================================== */
suiteBoot('data.json', (data) => {
  D = data;
  normalizeData(D);
  applyOverlay();
  if (typeof crewEnsure === 'function') crewEnsure(D);
  if (typeof boardEnsure === 'function') boardEnsure(D);
  if (typeof cadEnsure === 'function') cadEnsure(D);
  if (typeof schedEnsure === 'function') schedEnsure(D);
  buildIndexes();

  suiteChrome({
    moduleId: MODULE_ID,
    title: window.VR_STANDALONE ? 'VREstimator' : 'Estimating',
    file: { store: STORE, keys: [EST_REG_KEY, LS_KEY, ...estRegister().list.filter((x) => x.id !== 'base').map((x) => `${LS_KEY}@${x.id}`)], name: EST_BRAND, label: `${EST_BRAND}-${D.project.project_no || 'estimate'}` },
    subtitle: [D.project.project_name, D.project.project_no, D.project.client, `${D.project.estimate_class} estimate`].filter(Boolean).join(' \u00b7 '),
    onReset: () => suiteResetDialog(estResetStore(), LS_KEY),
  });

  { const tb = document.getElementById('tabs'); if (tb) tb.parentNode.insertBefore(estBar(), tb); }
  TABS = suiteTabs({ tabs: [
    { id: 'dashboard', label: 'Dashboard', build: viewDashboard },
    { id: 'methods', label: 'Methods', build: viewMethods },
    { id: 'biddesk', label: 'Bid Desk', build: viewBidDesk },
    { id: 'board', label: 'Takeoff Board', build: (r) => viewBoard(r) },
    { id: 'cad', label: 'CAD Takeoff', build: (r) => viewCad(r) },
    { id: 'takeoff', label: 'Takeoff Lines', build: viewTakeoff },
    { id: 'cbs', label: 'Cost Breakdown', build: (r) => viewCbs(r) },
    { id: 'resources', label: 'Resources', build: (r) => viewResources(r) },
    { id: 'crews', label: 'Crews', build: (r) => viewCrews(r) },
    { id: 'schedule', label: 'Schedule', build: (r) => viewSchedule(r) },
    { id: 'assemblies', label: 'Assemblies', build: (r) => viewAssemblies(r) },
    { id: 'library', label: 'Library', build: viewLibrary },
    { id: 'indirects', label: 'Indirects', build: viewIndirects },
    { id: 'engineering', label: 'Engineering', build: viewEngineering },
    { id: 'benchmark', label: 'Benchmark', build: viewBenchmark },
    { id: 'whatif', label: 'What-if', build: (r) => viewWhatIf(r) },
    { id: 'data', label: 'Import / Export', build: (r) => viewData(r) },
    { id: 'proposal', label: 'Proposal', build: viewProposal },
    { id: 'audit', label: 'Audit', build: viewAudit },
  ]});

  estWindowsInit();
  refreshStatus();
  /* Drawing numbers for P&ID / isometric references come from the DEng register. */
  drawRegisterLoad().then(() => { if (['takeoff', 'dashboard'].includes(TABS.current)) TABS.refresh(); });
  estOpenFromLink();
  if (typeof vrestWelcome === 'function') vrestWelcome();
});

/* ---------- several windows (one per screen) ----------
   New window (or Ctrl/Cmd/Shift/middle-click on a tab) opens that tab in its
   own window on the same estimate. Every window saves to the same browser
   storage; when another window saves, this one reloads to show the change
   (straight away if it is not being typed in, otherwise from a banner). */
function estPopOut(tab) {
  const u = new URL(location.href);
  u.searchParams.set('est', EST_ID); u.hash = tab || (TABS ? TABS.current : '');
  const w = window.open(u.href, '_blank', 'popup=yes,width=1440,height=900');
  if (!w) toast('The browser blocked the new window; allow pop-ups for this site', true);
}
function estWindowsInit() {
  const tb = document.getElementById('tabs');
  if (tb) {
    tb.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b && (e.ctrlKey || e.metaKey || e.shiftKey)) { e.preventDefault(); e.stopPropagation(); estPopOut(b.dataset.tab); } }, true);
    tb.addEventListener('auxclick', (e) => { const b = e.target.closest('button[data-tab]'); if (b && e.button === 1) { e.preventDefault(); estPopOut(b.dataset.tab); } });
    tb.title = 'Ctrl-click (Cmd-click on Mac) or middle-click a tab to open it in a new window';
  }
  const bar = document.getElementById('est-bar');
  if (bar) bar.appendChild(el('button', { class: 'ghost est-newwin', title: 'Open this tab in a new window you can move to another screen. Windows on the same estimate stay in step.', onclick: () => estPopOut() }, '\u29c9 New window'));
  /* restore the scroll position after a sync reload */
  /* (kept in history state, which survives the reload of this window only) */
  { const st = history.state; if (st && st.vrestSyncY !== undefined) { history.replaceState(null, '', location.href); setTimeout(() => window.scrollTo(0, num(st.vrestSyncY)), 60); } }
  if (!STORE.persistent || (window.VRUSER && window.VRUSER.server)) return;
  let t = 0;
  const reload = () => { history.replaceState({ vrestSyncY: window.scrollY }, '', location.href); location.reload(); };
  window.addEventListener('storage', (e) => {
    if (e.key !== EST_KEY) return;
    clearTimeout(t);
    t = setTimeout(() => {
      const a = document.activeElement;
      const typing = document.hasFocus() && a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !$('.modal');
      if (!typing && !$('.modal')) { reload(); return; }
      if ($('#est-sync')) return;
      document.body.appendChild(el('div', { id: 'est-sync', class: 'est-sync' }, 'This estimate was changed in another window. ',
        el('button', { class: 'primary', onclick: reload }, 'Show the changes')));
    }, 500);
  });
}

/* Deep links:  ?line=<TKL-no>  open a takeoff line
                ?new_takeoff=1&mk=&mq=  post measurements sent from VRMarkup */
function estOpenFromLink() {
  const q = suiteTakeParams(['line', 'new_takeoff', 'mk', 'mq']);
  if (q.line) {
    const l = D.takeoff_lines.find((x) => x.line_no === q.line || x.id === q.line);
    if (!l) { toast(`${q.line} is not in this estimate`, true); return; }
    UI.takeoffDisc = l.discipline; UI.takeoffSearch = l.line_no; TABS.go('takeoff');
    setTimeout(() => { const box = document.querySelector('input.search'); if (box) box.value = l.line_no; const row = [...document.querySelectorAll('tr')].find((tr) => tr.textContent.includes(l.line_no)); if (row) row.click(); }, 50);
    return;
  }
  if (q.new_takeoff) {
    let mq = null; try { mq = JSON.parse(q.mq || 'null'); } catch (e) { mq = null; }
    TABS.go('takeoff');
    if (typeof openMarkupTakeoff === 'function') openMarkupTakeoff(mq, q.mk, () => refreshAll());
  }
}

/* ==========================================================================
   VIEW — dashboard
   ========================================================================== */
function viewDashboard(root) {
  const R = rollup();
  const checks = evaluateQaChecks(R);
  const failing = checks.filter((c) => c.status === 'REVIEW');

  root.appendChild(el('div', { class: 'grid', style: 'grid-template-columns:repeat(4,minmax(0,1fr))' },
    kpiCard('Total installed cost', `USD ${M(R.tic)}`,
      `${D.project.estimate_class} \u00b7 accuracy ${D.project.accuracy_low_pct}% / +${D.project.accuracy_high_pct}%`,
      'blue', null),
    kpiCard('Accuracy range', `USD ${M(R.accLow)} \u2013 ${M(R.accHigh)}`,
      'low bound to high bound at the current class', 'cyan', null),
    kpiCard('Direct construction cost', `USD ${M(R.totalDirect)}`,
      `${pct1((R.totalDirect / R.tic) * 100)} of TIC`, 'green', (R.totalDirect / R.tic) * 100),
    kpiCard('Total man-hours', MH(R.totalMh),
      'summed across all disciplines at their active method', 'violet', null),
    kpiCard('Engineering basis', R.eng.source === 'factored' ? 'Factored EPCM' : 'Detailed FEED+Detail',
      R.eng.source === 'factored' ? `${pct1(D.engineering.factored_epcm_engineering_pct * 100)} of direct`
        : `${MH(R.eng.detailedTotalMh)} MH \u00d7 USD ${D.engineering.eng_rate}/hr`, 'amber', null),
    kpiCard('Contingency', `USD ${M(R.contingency)}`,
      `${pct1(D.indirects.contingency_pct * 100)} of subtotal before contingency`, 'blue', null),
    kpiCard('Estimate quality', failing.length ? `${failing.length} check(s) need review` : 'All checks pass',
      failing.length ? 'see the flagged items below' : 'clear to progress toward Issued',
      failing.length ? 'accent' : 'green', null),
    kpiCard('Estimate status', D.project.estimate_status,
      `data date ${D.project.data_date}`, D.project.estimate_status === 'Issued' ? 'green' : 'grey', null)));

  /* ---- cost + MH per discipline, cross-filters into takeoff ---- */
  const discRows = R.usedByDisc.map((u) => ({
    label: u.disc.discipline, value: u.usedDirect, pct: (u.usedDirect / R.totalDirect) * 100,
    colour: METHOD_COLOUR[u.disc.method], disc: u.disc.discipline,
  })).sort((a, b) => b.value - a.value);

  const costCard = card('Direct cost by discipline — click a bar to open its takeoff lines', [
    el('div', { class: 'cbars' }, discRows.map((r) => el('div', {
      class: 'cbar', title: `${r.label}: USD ${USD(r.value)} (${METHOD_LABEL[IDX.discByName.get(r.disc).method]}) — click to open in Takeoff`,
      onclick: () => {
        UI.discipline = r.disc; UI.takeoffDisc = r.disc;
        toast(`Takeoff filtered to ${r.disc}`);
        TABS.go('takeoff');
      },
    },
    el('span', { class: 'lb', text: r.label }),
    el('span', { class: 'tr' },
      el('i', { style: `width:${Math.max(1, r.pct)}%;background:var(--${r.colour})` })),
    el('span', { class: 'vl', text: `USD ${K(r.value)}k` })))),
    legendRow([
      { label: 'Parametric', colour: 'blue' },
      { label: 'Known Quantity', colour: 'violet' },
      { label: 'Detailed Takeoff', colour: 'green' },
    ]),
  ]).card;

  const mhRows = R.usedByDisc.map((u) => ({
    label: u.disc.discipline, pct: R.totalMh ? (u.usedMh / R.totalMh) * 100 : 0,
    value: MH(u.usedMh), colour: METHOD_COLOUR[u.disc.method],
  })).sort((a, b) => b.pct - a.pct);
  const mhCard = card('Man-hours by discipline', hBarChart(mhRows, { labelW: 130 })).card;

  root.appendChild(el('div', { class: 'split split-3-2', style: 'margin-top:10px' }, costCard, mhCard));

  /* ---- estimate-quality summary from QA checks ---- */
  const qaTbl = dataTable([
    { key: 'check', label: 'Check' },
    { key: 'status', label: 'Status', width: 90, render: (r) => pill(r.status, r.status === 'OK' ? 'green' : 'amber') },
    { key: 'detail', label: 'Detail' },
  ], checks, { empty: 'No QA checks configured.' });

  const classRow = D.class_roadmap.find((c) => c.aace_class === D.project.estimate_class);
  const infoCard = card('Estimate basis', [
    detailList([
      ['Estimate class', D.project.estimate_class],
      ['Methodology (class typical)', classRow ? classRow.methodology : '\u2014'],
      ['Published accuracy (class typical)', classRow ? classRow.published_accuracy : '\u2014'],
      ['Markup model', D.project.markup_model],
      ['Estimator', D.project.estimator],
      ['Estimate date', D.project.estimate_date],
      ['Data date', D.project.data_date],
    ]),
  ]).card;

  root.appendChild(el('div', { class: 'split split-3-2', style: 'margin-top:10px' },
    card('Estimate-quality summary — drawn from QA & Checks', qaTbl.wrap, { flush: true }).card,
    infoCard));
}

/* ==========================================================================
   VIEW — methods (the centrepiece: per-discipline method selector)
   ========================================================================== */
function viewMethods(root) {
  const R = rollup();

  root.appendChild(el('div', { class: 'banner', style: 'margin-bottom:10px' },
    el('b', { text: 'Discipline Method Selector. ' }),
    'Only the method chosen for a discipline feeds its "used" direct cost, '
    + 'man-hours, labor $ and material $ below — and everything downstream '
    + '(Indirects, Dashboard, Benchmark) reads only that active figure.'));

  const right = el('div');
  const cols = [
    { key: 'discipline', label: 'Discipline', width: 130, sortVal: (r) => r.disc.discipline, render: (r) => r.disc.discipline },
    { key: 'method', label: 'Method', width: 130, sortVal: (r) => r.disc.method, render: (r) => pill(METHOD_LABEL[r.disc.method], METHOD_COLOUR[r.disc.method]) },
    { key: 'usedDirect', label: 'Direct $ USED', num: true, mono: true, render: (r) => USD(r.usedDirect) },
    { key: 'usedMh', label: 'MH USED', num: true, mono: true, render: (r) => MH(r.usedMh) },
    { key: 'usedLabor', label: 'Labor $ USED', num: true, mono: true, render: (r) => USD(r.usedLabor) },
    { key: 'usedMatl', label: 'Material $ USED', num: true, mono: true, render: (r) => USD(r.usedMatl) },
    { key: 'lines', label: 'Takeoff lines', num: true, mono: true, render: (r) => r.lines.length },
  ];
  const rows = R.usedByDisc;
  const tbl = dataTable(cols, rows, {
    sort: 'usedDirect', dir: -1,
    onSelect: (r) => renderDetail(r),
    empty: 'No disciplines configured.',
  });

  function renderDetail(u) {
    right.textContent = '';
    const disc = u.disc;
    right.appendChild(card(`${disc.discipline} — method detail`, [
      el('div', { class: 'method-grid' },
        methodCard('parametric', disc, u),
        methodCard('known_qty', disc, u),
        methodCard('detailed_takeoff', disc, u)),
      el('div', { style: 'margin-top:12px' },
        detailList([
          ['Active method', METHOD_LABEL[disc.method]],
          ['Source', u.sourceLabel],
          ['Direct $ USED', USD(u.usedDirect)],
          ['Labor MH USED', MH(u.usedMh)],
          ['Labor $ USED', USD(u.usedLabor)],
          ['Material $ USED', USD(u.usedMatl)],
          ['Takeoff lines on file', u.lines.length],
        ])),
    ]).card);
  }

  function methodCard(method, disc, u) {
    const active = disc.method === method;
    const body = [el('div', { style: 'font-weight:600;margin-bottom:6px' }, METHOD_LABEL[method])];
    if (method === 'parametric') {
      body.push(detailList([
        ['Alloc % of direct', pct1(disc.alloc_pct * 100)],
        ['Parametric $', USD(disc.parametric_cost)],
      ]));
    } else if (method === 'known_qty') {
      body.push(detailList([
        ['Known qty', int(disc.known_qty)],
        ['Unit', disc.known_unit],
        ['Unit rate ($)', int(disc.known_unit_rate)],
        ['Known cost', USD(disc.known_qty * disc.known_unit_rate)],
      ]));
    } else {
      body.push(detailList([
        ['Takeoff lines', u.lines.length],
        ['Takeoff MH', MH(u.takeoffMh)],
        ['Takeoff $', USD(u.takeoffCost)],
      ]));
      if (!u.lines.length) {
        body.push(el('div', { class: 'field-err', style: 'margin-top:6px' },
          'No takeoff lines on file yet — selecting this method will be refused.'));
      }
    }
    body.push(el('button', {
      class: active ? 'primary' : 'ghost', style: 'margin-top:8px;width:100%',
      disabled: active,
      onclick: () => trySetMethod(disc, method),
    }, active ? 'Active method' : `Switch to ${METHOD_LABEL[method]}`));
    return el('div', { class: `method-card${active ? ' active' : ''}` }, body);
  }

  function trySetMethod(disc, method) {
    if (method === 'detailed_takeoff') {
      const lines = IDX.linesByDisc.get(disc.discipline) || [];
      if (!lines.length) {
        modal({
          title: 'Cannot switch to Detailed Takeoff', width: 480,
          sub: `${disc.discipline} has no takeoff lines on file`,
          body: el('div', { class: 'banner bad' },
            'Detailed Takeoff needs at least one takeoff line to compute a '
            + 'cost. Add lines on the Takeoff tab first, or keep this '
            + 'discipline on Parametric or Known Quantity.'),
          buttons: [
            { label: 'Go to Takeoff', primary: true, onClick: () => { closeModal(); UI.takeoffDisc = disc.discipline; TABS.go('takeoff'); } },
            { label: 'Cancel', onClick: closeModal },
          ],
        });
        return;
      }
    }
    const old = disc.method;
    disc.method = method;
    audit('discipline_method', disc.discipline, 'set_method', METHOD_LABEL[old], METHOD_LABEL[method]);
    toast(`${disc.discipline} switched to ${METHOD_LABEL[method]}`);
    refreshAll();
  }

  root.appendChild(el('div', { class: 'split split-3-2' }, card('Disciplines', tbl.wrap, { flush: true }).card, right));
  tbl.select(() => true);
}

/* ==========================================================================
   VIEW — takeoff (master/detail: discipline -> takeoff lines; modal create/edit)
   ========================================================================== */
/* ==========================================================================
   estimate picker — working and historical estimates, and new estimates
   ========================================================================== */
const EST_CLASS_ACC = { 'Class 5': [-30, 50], 'Class 4': [-20, 30], 'Class 3': [-15, 20], 'Class 2': [-10, 15], 'Class 1': [-5, 10] };
/* Reset discards every estimate added here as well as the seeded one. */
function estResetStore() {
  return {
    persistent: STORE.persistent, get: STORE.get, set: STORE.set,
    del: (k) => {
      STORE.del(k);
      estRegister().list.forEach((x) => { if (x.id !== 'base') { STORE.del(`${LS_KEY}@${x.id}`); STORE.del(`vissrad.estimating.biddesk.v1@${x.id}`); } });
      STORE.del(EST_REG_KEY);
    },
  };
}
function estSwitch(id) {
  const r = estRegister();
  if (!r.list.some((x) => x.id === id)) return;
  r.current = id; estSaveRegister(r);
  if (EST_URL) { const u = new URL(location.href); u.searchParams.set('est', id); location.replace(u.href); } else location.reload();
}
function estBar() {
  estNoteInRegister();
  const r = estRegister();
  const label = (x) => { const tag = [x.cls, x.status].filter(Boolean).join(', '); return `${x.no} \u00b7 ${x.name}${x.client ? ` \u00b7 ${x.client}` : ''}${tag ? ` (${tag})` : ''}`; };
  const working = r.list.filter((x) => x.status !== 'Issued');
  const hist = r.list.filter((x) => x.status === 'Issued');
  const pick = el('select', { id: 'est-pick', 'aria-label': 'Estimate', style: 'min-width:320px;max-width:520px', onchange: (e) => estSwitch(e.target.value) },
    working.length ? el('optgroup', { label: 'Working estimates' }, working.map((x) => el('option', { value: x.id, selected: x.id === EST_ID || null }, label(x)))) : null,
    hist.length ? el('optgroup', { label: 'Historical (issued)' }, hist.map((x) => el('option', { value: x.id, selected: x.id === EST_ID || null }, label(x)))) : null);
  return el('div', { id: 'est-bar', class: 'toolbar est-bar', style: 'padding:8px 16px;border-bottom:1px solid var(--border);margin:0' },
    el('label', { for: 'est-pick', text: 'Estimate' }), pick,
    el('button', { class: 'primary', id: 'est-new', onclick: estNewDialog }, '+ New estimate'),
    el('span', { class: 'hint', text: `${working.length} working, ${hist.length} historical. An estimate marked Issued on the Proposal tab moves to historical.` }));
}
function estNewDialog() {
  const r = estRegister();
  const yr = TODAY.slice(0, 4);
  let n = r.list.length + 1, no;
  do { no = `EST-${yr}-${String(n).padStart(3, '0')}`; n += 1; } while (r.list.some((x) => x.no === no));
  const f = {
    no: el('input', { type: 'text', value: no, id: 'est-no' }),
    name: el('input', { type: 'text', placeholder: 'e.g. Tank farm expansion', id: 'est-name' }),
    client: el('input', { type: 'text', placeholder: 'Client or owner' }),
    location: el('input', { type: 'text', placeholder: 'Site location' }),
    cls: el('select', {}, Object.keys(EST_CLASS_ACC).map((c) => el('option', { value: c, selected: c === 'Class 4' || null }, c))),
    basis: el('select', { id: 'est-basis' }, el('option', { value: 'blank' }, 'Blank: library, crafts and rates only, no quantities'), el('option', { value: 'copy' }, `Copy of the open estimate (${D.project.project_no})`)),
  };
  const err = el('div', { class: 'field-err' });
  modal({
    title: 'New estimate', sub: 'Starts as Draft. The man-hour library, craft rates, material prices and indirect percentages carry over.', width: 620,
    body: el('div', {}, el('div', { class: 'form-grid' },
      el('label', { text: 'Estimate number' }), f.no, el('label', { text: 'Estimate name' }), f.name, el('label', { text: 'Client' }), f.client,
      el('label', { text: 'Location' }), f.location, el('label', { text: 'Estimate class' }), f.cls, el('label', { text: 'Start from' }), f.basis), err),
    buttons: [{ label: 'Cancel', onClick: closeModal }, { label: 'Create and open', primary: true, onClick: () => {
      const v = { no: f.no.value.trim(), name: f.name.value.trim(), client: f.client.value.trim(), location: f.location.value.trim(), cls: f.cls.value };
      const issues = [];
      if (!v.no) issues.push('Enter an estimate number.');
      if (r.list.some((x) => String(x.no).toLowerCase() === v.no.toLowerCase())) issues.push(`${v.no} is already in use.`);
      if (!v.name) issues.push('Enter an estimate name.');
      if (issues.length) { err.textContent = issues.join(' '); return; }
      const id = `e${Date.now().toString(36)}`;
      const copy = f.basis.value === 'copy';
      const deep = (x) => JSON.parse(JSON.stringify(x));
      const acc = EST_CLASS_ACC[v.cls];
      const project = Object.assign(deep(D.project), {
        project_no: v.no, project_name: v.name, client: v.client, location: v.location || D.project.location,
        estimate_class: v.cls, accuracy_low_pct: acc[0], accuracy_high_pct: acc[1], estimate_status: 'Draft',
        estimate_date: TODAY, data_date: TODAY, target_tic: copy ? D.project.target_tic : 0,
      });
      const eng = deep(D.engineering);
      if (!copy) { eng.feed.base_design_mh = 0; eng.detail.base_design_mh = 0; }
      const ov = {
        project,
        disciplines: copy ? deep(D.disciplines) : D.disciplines.map((d) => Object.assign(deep(d), { method: 'parametric', known_qty: 0, parametric_cost: 0, takeoff_cost: 0, takeoff_mh: 0, crew: undefined })),
        crews: copy ? deep(D.crews) : undefined,
        cad: copy ? deep(D.cad) : undefined,
        sched: copy ? Object.assign(deep(D.sched), { start: TODAY }) : undefined,
        takeoff_lines: copy ? deep(D.takeoff_lines) : [], engineering: eng, indirects: deep(D.indirects), benchmark: deep(D.benchmark),
        estimate_status: 'Draft', estimate_class: v.cls,
        audit: [auditRecord('estimate', v.no, 'create', null, copy ? `Copied from ${D.project.project_no} ${D.project.project_name}` : 'Blank estimate', USER, TODAY)],
        seq: copy ? deep(SEQ) : { line: 0 },
      };
      STORE.set(`${LS_KEY}@${id}`, JSON.stringify(ov));
      r.list.push({ id, no: v.no, name: v.name, client: v.client, cls: v.cls, status: 'Draft', created: TODAY, updated: TODAY, from: copy ? D.project.project_no : '' });
      r.current = id; estSaveRegister(r);
      closeModal(); location.reload();
    } }],
  });
}

/* Bid Desk lives in biddesk.js and is loaded the first time the tab opens. */
function viewBidDesk(root) {
  if (window.BidDesk) { window.BidDesk.view(root); return; }
  root.appendChild(el('div', { class: 'hint', text: 'Loading the Bid Desk…' }));
  const s = document.createElement('script');
  s.src = 'biddesk.js';
  s.onload = () => { if (root.isConnected) { root.textContent = ''; window.BidDesk.view(root); } };
  s.onerror = () => { root.textContent = 'The Bid Desk could not be loaded.'; };
  document.head.appendChild(s);
}
function viewTakeoff(root) {
  const R = rollup();
  const discOptions = ['All', ...D.disciplines.map((d) => d.discipline)];
  const activeDisc = UI.takeoffDisc && discOptions.includes(UI.takeoffDisc) ? UI.takeoffDisc : 'All';
  UI.takeoffDisc = activeDisc;

  const detail = el('div');
  const tblWrap = el('div');

  const toolbarRow = toolbar(
    sel('Discipline', discOptions.map((d) => [d, d]), activeDisc, (v) => { UI.takeoffDisc = v; redrawTable(); }, 190),
    searchBox('Search description, key or drawing number\u2026', (v) => { UI.takeoffSearch = v; redrawTable(); }),
    el('span', { style: 'flex:1' }),
    typeof openPdfTakeoff === 'function' ? el('button', { class: 'ghost', onclick: () => openPdfTakeoff(() => refreshAll()) }, 'Drawing takeoff (PDF)') : '',
    el('button', { class: 'ghost', onclick: openScanLazy, title: 'Read bills of material, title blocks and tags from PDF drawings (text layer or OCR) and propose takeoff lines' }, 'Scan drawings (PDF)'),
    el('button', { class: 'primary', onclick: () => openLineModal(null) }, '+ New takeoff line'));

  root.appendChild(el('div', { class: 'split split-3-2' },
    card('Takeoff lines', [toolbarRow, tblWrap], { flush: false }).card,
    detail));

  let tbl = null;
  redrawTable();

  function currentLines() {
    let lines = D.takeoff_lines.slice();
    if (activeDiscState() !== 'All') lines = lines.filter((l) => l.discipline === activeDiscState());
    const q = (UI.takeoffSearch || '').trim().toLowerCase();
    if (q) lines = lines.filter((l) => `${l.line_no} ${l.description} ${l.master_key} ${l.area} ${drefText(l.drawing_refs, true)}`.toLowerCase().includes(q));
    return lines;
  }
  function activeDiscState() { return UI.takeoffDisc; }

  function redrawTable() {
    tblWrap.textContent = '';
    const cols = [
      { key: 'line_no', label: 'Line', width: 78 },
      { key: 'discipline', label: 'Discipline', width: 110 },
      { key: 'area', label: 'Area', width: 60 },
      { key: 'master_key', label: 'Library key', width: 90, mono: true },
      { key: 'description', label: 'Description' },
      { key: 'drawings', label: 'Drawings', width: 112, mono: true,
        render: (r) => { const rs = r.drawing_refs || []; const t = rs.length ? `${drefShort(rs[0].doc_no)}${rs.length > 1 ? ` +${rs.length - 1}` : ''}` : ''; const st = (r.drawing_refs || []).some((x) => ['superseded', 'unregistered'].includes(drefStatus(x)));
          return t ? el('span', { title: drefText(r.drawing_refs, true), style: st ? 'color:var(--amber)' : null }, t) : el('span', { style: 'color:var(--text-faint)' }, '\u2014'); },
        sortVal: (r) => drefText(r.drawing_refs) },
      { key: 'quantity', label: 'Qty', num: true, mono: true, width: 80, render: (r) => int(r.quantity) },
      { key: 'uom', label: 'UOM', width: 56 },
      { key: 'mh', label: 'MH', num: true, mono: true, width: 90, render: (r) => MH(computeLine(r).totalMh) },
      { key: 'cost', label: 'Cost $', num: true, mono: true, width: 110, render: (r) => USD(computeLine(r).totalCost) },
    ];
    const lines = currentLines();
    tbl = dataTable(cols, lines, {
      sort: 'line_no', dir: 1, maxHeight: 480,
      onSelect: (r) => renderDetail(r),
      onOpen: (r) => openLineModal(r),
      empty: activeDiscState() === 'All'
        ? 'No takeoff lines on file.'
        : `No takeoff lines for ${activeDiscState()} — use "New takeoff line" to add one.`,
      autoSelect: true,
    });
    tblWrap.appendChild(tbl.wrap);
    if (!lines.length) detail.textContent = '';
  }

  function renderDetail(line) {
    const c = computeLine(line);
    detail.textContent = '';
    detail.appendChild(card(`${line.line_no} \u2014 detail`, [
      demoFlag('Library MH/rates are demo values'),
      el('div', { style: 'margin-top:8px' }, detailList([
        ['Discipline', line.discipline],
        ['Area', line.area],
        ['Drawings', drawRefChips(line.drawing_refs, { emptyText: 'None \u2014 Edit line to add the P&ID or isometric' })],
        ['Takeoff files', window.vrDocsButton ? vrDocsButton('estimating', `line:${line.id}`, { label: `Line ${line.line_no || line.id}`, className: 'ghost', text: 'Files', sub: 'Marked-up takeoff drawings, vendor quotations and backup for this line.' }) : '\u2014'],
        ['Library key', line.master_key],
        ['Description', line.description],
        ['Quantity', `${int(line.quantity)} ${line.uom}`],
        ['Unit MH (library)', c.mhRow ? c.mhRow.unit_mh : '\u2014'],
        ['Discipline factor', line.discipline_factor],
        ['Global factor', line.global_factor],
        ['Item factor', line.item_factor],
        ['Weld factor', line.weld_key ? `${line.weld_key} (\u00d7${c.weldFactor})` : '\u2014 (\u00d71)'],
        ['Craft', line.craft],
        ['Source', line.source || 'entered'],
        ['Craft all-in rate', c.rate ? `USD ${c.rate}/hr` : '\u2014'],
        ['Total MH', MH(c.totalMh)],
        ['Labor $', USD(c.laborCost)],
        ['Material $ (unit \u00d7 qty)', USD(c.materialCost)],
        ['Total line cost', USD(c.totalCost)],
      ])),
      el('div', { class: 'toolbar', style: 'margin-top:10px' },
        el('button', { class: 'ghost', onclick: () => openLineModal(line) }, 'Edit line'),
        el('button', { class: 'ghost', onclick: () => deleteLine(line) }, 'Delete line')),
    ]).card);
  }

  function deleteLine(line) {
    modal({
      title: 'Delete takeoff line?', width: 440, sub: line.line_no,
      body: el('div', {}, `This removes ${line.line_no} (${line.description}) from `
        + `${line.discipline}'s takeoff. The discipline rollup will recompute immediately.`),
      buttons: [
        { label: 'Delete', primary: true, onClick: () => {
          const idx = D.takeoff_lines.findIndex((l) => l.line_no === line.line_no);
          if (idx >= 0) D.takeoff_lines.splice(idx, 1);
          audit('takeoff_line', line.line_no, 'delete', line.description, null);
          closeModal();
          toast(`${line.line_no} deleted`);
          refreshAll();
        } },
        { label: 'Cancel', onClick: closeModal },
      ],
    });
  }

  function openLineModal(line) {
    const isNew = !line;
    const discForNew = activeDiscState() !== 'All' ? activeDiscState() : D.disciplines[0].discipline;
    const draft = isNew ? {
      line_no: '', discipline: discForNew, area: D.areas[0].area_code, master_key: '',
      description: '', quantity: '', uom: '', discipline_factor: 1, global_factor: 1,
      item_factor: 1, weld_key: '', craft: '', drawing_refs: [],
    } : { ...line, drawing_refs: (line.drawing_refs || []).map((r) => ({ ...r })) };

    const mhKeysForDisc = () => D.mh_library.filter((m) => m.discipline === draft.discipline);

    // The library-key <select> auto-selects its first option in the browser
    // even when no option's value matches draft.master_key, so keep the
    // draft's state in sync with that default instead of leaving it blank.
    function defaultKeyIfNeeded() {
      if (draft.master_key) return;
      const first = mhKeysForDisc()[0];
      if (first) { draft.master_key = first.key; draft.description = first.description; draft.uom = first.uom; }
    }
    defaultKeyIfNeeded();

    const discSel = sel('', D.disciplines.map((d) => [d.discipline, d.discipline]), draft.discipline,
      (v) => { draft.discipline = v; draft.master_key = ''; defaultKeyIfNeeded(); keySelWrap.replaceWith(buildKeySel()); descInput.value = draft.description; uomInput.value = draft.uom; }, 180);
    let keySelEl;
    function buildKeySel() {
      const opts = mhKeysForDisc().map((m) => [m.key, `${m.key} \u2014 ${m.description}`]);
      keySelEl = sel('', opts, draft.master_key, (v) => {
        draft.master_key = v;
        const row = IDX.mhByKey.get(v);
        if (row) { draft.description = row.description; draft.uom = row.uom; descInput.value = row.description; uomInput.value = row.uom; }
      }, 320);
      return keySelEl;
    }
    const keySelWrap = buildKeySel();

    const qtyInput = el('input', { type: 'number', value: draft.quantity, min: 0, step: 'any' });
    const uomInput = el('input', { type: 'text', value: draft.uom, readonly: true });
    const descInput = el('input', { type: 'text', value: draft.description, readonly: true });
    const areaSel = sel('', D.areas.map((a) => [a.area_code, `${a.area_code} \u2014 ${a.area_name}`]), draft.area, (v) => { draft.area = v; }, 220);
    const craftSel = sel('', D.crafts.map((c) => [c.craft, c.craft]), draft.craft || D.crafts[0].craft, (v) => { draft.craft = v; }, 220);
    const crewSel = sel('', [['', '\u2014 Craft rate only \u2014'], ...(D.crews || []).map((c) => [c.id, `${c.id} \u2014 ${c.name}`])], draft.crew || '', (v) => { draft.crew = v; }, 320);
    const weldSel = sel('', [['', 'None (\u00d71)'], ...D.weld_factors.map((w) => [w.key, `${w.key} \u2014 ${w.description} (\u00d7${w.factor})`])],
      draft.weld_key || '', (v) => { draft.weld_key = v; }, 320);
    const rateInput = el('input', { type: 'number', value: draft.item_factor, min: 0.1, step: '0.05' });

    const dwgEd = drawRefsEditor(draft.drawing_refs, {
      types: draft.discipline === 'Instrumentation' ? ['PID', 'LOD'] : ['PID', 'ISO'],
      project: D.project.project_no, area: draft.area,
    });
    const errBox = el('div', { class: 'field-err' });

    const body = el('div', {}, el('div', { class: 'form-grid' },
      el('label', { text: 'Discipline' }), discSel,
      el('label', { text: 'Library key' }), keySelWrap,
      el('label', { text: 'Description' }), descInput,
      el('label', { text: 'Area' }), areaSel,
      el('label', { text: 'Quantity' }), qtyInput,
      el('label', { text: 'UOM' }), uomInput,
      el('label', { text: 'Craft' }), craftSel,
      el('label', { text: 'Crew' }), crewSel,
      el('label', { text: 'Weld factor' }), weldSel,
      el('label', { text: 'Item factor' }), rateInput,
      el('label', { text: 'Drawings' }), dwgEd.el,
    ), errBox);

    if (!draft.craft) draft.craft = D.crafts[0].craft;

    const m = modal({
      title: isNew ? 'New takeoff line' : `Edit ${draft.line_no}`,
      sub: 'Quantity and item factor are validated before the rollup recalculates.',
      width: 780, body,
      buttons: [
        { label: isNew ? 'Create line' : 'Save changes', primary: true, onClick: () => {
          const qty = Number(qtyInput.value);
          const rateF = Number(rateInput.value);
          const errs = [];
          if (!draft.master_key) errs.push('Choose a library key.');
          if (!(qty > 0)) errs.push('Quantity must be a positive number.');
          if (!(rateF > 0)) errs.push('Item factor must be a positive number.');
          if (!draft.craft) errs.push('Choose a craft.');
          if (errs.length) { errBox.textContent = errs.join(' '); return; }
          draft.quantity = qty;
          draft.item_factor = rateF;
          const beforeRefs = isNew ? '' : drefText(line.drawing_refs, true);
          draft.drawing_refs = dwgEd.value();
          if (isNew) {
            draft.line_no = nextNo(D.takeoff_lines, 'line_no', 'TKL-', 4, SEQ);
            D.takeoff_lines.push(draft);
            audit('takeoff_line', draft.line_no, 'create', null, `${draft.discipline} ${draft.master_key} qty ${qty}`);
          } else {
            Object.assign(line, draft);
            audit('takeoff_line', line.line_no, 'edit', null, `qty ${qty}, item factor ${rateF}`);
            const afterRefs = drefText(draft.drawing_refs, true);
            if (afterRefs !== beforeRefs) audit('takeoff_line', line.line_no, 'drawings', beforeRefs || null, afterRefs || null);
          }
          closeModal();
          toast(`${draft.line_no} saved`);
          refreshAll();
        } },
        { label: 'Cancel', onClick: closeModal },
      ],
    });
  }
}

/* ==========================================================================
   VIEW — library (MH libraries + weld factors, craft rates, material prices)
   ========================================================================== */
function viewLibrary(root) {
  root.appendChild(el('div', { class: 'banner warn' },
    demoFlag('All man-hour and weld-factor values below'), ' ',
    'were generated for this build using engineering judgement to fill a gap '
    + 'flagged in the source workbook\u2019s own QA sheet (its donor man-hour '
    + 'tables were copyrighted and incomplete). They are not sourced from any '
    + 'proprietary manual and should not be used for real bids.'));

  const discOptions = ['All', ...D.disciplines.map((d) => d.discipline)];
  const mhWrap = el('div');
  const toolbarRow = toolbar(
    sel('Discipline', discOptions.map((d) => [d, d]), UI.libraryDisc, (v) => { UI.libraryDisc = v; drawMh(); }, 180),
    searchBox('Search key or description\u2026', (v) => { UI.librarySearch = v; drawMh(); }));

  function drawMh() {
    mhWrap.textContent = '';
    let rows = D.mh_library.slice();
    if (UI.libraryDisc !== 'All') rows = rows.filter((r) => r.discipline === UI.libraryDisc);
    const q = (UI.librarySearch || '').trim().toLowerCase();
    if (q) rows = rows.filter((r) => `${r.key} ${r.description}`.toLowerCase().includes(q));
    const cols = [
      { key: 'key', label: 'Key', width: 90, mono: true },
      { key: 'discipline', label: 'Discipline', width: 110 },
      { key: 'description', label: 'Description' },
      { key: 'uom', label: 'UOM', width: 60 },
      { key: 'unit_mh', label: 'Unit MH', num: true, mono: true, width: 90 },
      { key: 'source', label: 'Source', width: 220 },
    ];
    const tbl = dataTable(cols, rows, { sort: 'key', dir: 1, maxHeight: 420, empty: 'No library rows match.' });
    mhWrap.appendChild(tbl.wrap);
  }
  drawMh();

  root.appendChild(el('div', { style: 'margin-top:10px' },
    card('Man-hour library', [toolbarRow, mhWrap], { flush: false }).card));

  const weldCols = [
    { key: 'key', label: 'Key', width: 90, mono: true },
    { key: 'description', label: 'Description' },
    { key: 'factor', label: 'Factor', num: true, mono: true, width: 90 },
  ];
  const weldTbl = dataTable(weldCols, D.weld_factors, { sort: 'key', dir: 1, maxHeight: 260 });

  const craftCols = [
    { key: 'craft', label: 'Craft' },
    { key: 'base_rate', label: 'Base $/hr', num: true, mono: true, width: 100 },
    { key: 'burden_pct', label: 'Burden %', num: true, mono: true, width: 90, render: (r) => pct1(r.burden_pct * 100) },
    { key: 'all_in_rate', label: 'All-in $/hr', num: true, mono: true, width: 100 },
  ];
  const craftTbl = dataTable(craftCols, D.crafts, { sort: 'craft', dir: 1, maxHeight: 320 });

  const matCols = [
    { key: 'key', label: 'Key', width: 90, mono: true },
    { key: 'discipline', label: 'Discipline', width: 110 },
    { key: 'description', label: 'Description' },
    { key: 'uom', label: 'UOM', width: 60 },
    { key: 'unit_material_cost', label: 'Unit $', num: true, mono: true, width: 90 },
  ];
  const matTbl = dataTable(matCols, D.material_prices, { sort: 'key', dir: 1, maxHeight: 320 });

  root.appendChild(el('div', { class: 'split split-3-2', style: 'margin-top:10px' },
    card('Weld factors', weldTbl.wrap, { flush: true }).card,
    card('Craft rates', [craftTbl.wrap, el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;padding:8px 10px;border-top:1px solid var(--border)' },
      el('button', { class: 'ghost', title: 'Add or update these crafts as labor resources in the shared VissRad resource library (codes EST-<craft>)', onclick: () => estResources(sendCraftsToLibrary) }, 'Send craft rates to the resource library'),
      el('button', { class: 'ghost', title: 'The resource library shared by Schedule, Cost and Estimating', onclick: () => estResources(() => window.VissRadResources.manage({})) }, 'Open resource library\u2026'))], { flush: true }).card));

  root.appendChild(el('div', { style: 'margin-top:10px' },
    card('Material prices', matTbl.wrap, { flush: true }).card));
}

/* The shared VissRad resource library (shared/resources.js), loaded when first used. */
function estResources(fn) {
  if (window.VissRadResources) { fn(); return; }
  const sc = document.createElement('script'); sc.src = `${EST_ROOT}shared/resources.js`;
  sc.onload = fn; sc.onerror = () => toast('The resource library could not be loaded.', true);
  document.head.appendChild(sc);
}
function sendCraftsToLibrary() {
  const slug = (s) => 'EST-' + String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const items = (D.crafts || []).filter((c) => c.craft).map((c) => ({ code: slug(c.craft), name: c.craft, type: 'Labor', uom: 'hr', disc: 'Estimating craft',
    rates: [{ from: '', base: +c.base_rate || 0, burden: Math.round((+c.burden_pct || 0) * 100000) / 1000 }], notes: 'From the Estimating craft rates' }));
  if (!items.length) { toast('There are no craft rates to send.', true); return; }
  const r = window.VissRadResources.upsert(items, 'update');
  toast(`${r.added} craft${r.added === 1 ? '' : 's'} added and ${r.updated} updated in the resource library (${items.length} crafts, codes EST-…).`);
}

/* ==========================================================================
   VIEW — indirects (code-of-accounts build-up: direct -> ... -> TIC)
   ========================================================================== */
function viewIndirects(root) {
  const R = rollup();
  const ind = D.indirects;

  const rows = [
    { label: 'Direct construction cost', value: R.totalDirect, colour: 'blue' },
    { label: `Engineering (${R.eng.source === 'factored' ? 'factored EPCM slice' : 'FEED + Detail, detailed'})`, value: R.engineeringCostUsed, colour: 'violet' },
    { label: `EPCM \u2014 other (${pct1((ind.epcm_pct_of_direct) * 100)} of direct less eng.)`, value: R.epcmOther, colour: 'violet' },
    { label: `EPCM \u2014 engineering slice (factored route only)`, value: R.epcmEngineeringSlice, colour: 'violet' },
    { label: `Field indirects (${pct1(R.fieldIndirectPct * 100)} of direct)`, value: R.fieldIndirects, colour: 'amber' },
    { label: `Owner cost (${pct1(ind.owner_cost_pct * 100)} of direct)`, value: R.ownerCost, colour: 'cyan' },
    { label: `Escalation (${pct1(ind.escalation_pct * 100)} of subtotal)`, value: R.escalation, colour: 'grey' },
    { label: `Contingency (${pct1(ind.contingency_pct * 100)} of subtotal)`, value: R.contingency, colour: 'accent' },
  ];
  let running = 0;
  const wfRows = rows.map((r) => { const from = running; running += r.value; return { label: r.label, from, to: running, value: `USD ${USD(r.value)}`, colour: r.colour }; });
  wfRows.push({ label: 'Total installed cost', from: 0, to: running, value: `USD ${USD(running)}`, colour: 'green', rule: true });

  root.appendChild(el('div', { class: 'grid', style: 'grid-template-columns:repeat(4,minmax(0,1fr))' },
    kpiCard('Direct cost', `USD ${M(R.totalDirect)}`, 'sum of each discipline\u2019s active method', 'blue', null),
    kpiCard('EPCM total', `USD ${M(R.epcmTotal)}`, `${pct1(ind.epcm_pct_of_direct * 100)} of direct construction`, 'violet', null),
    kpiCard('Owner + escalation + contingency', `USD ${M(R.ownerCost + R.escalation + R.contingency)}`, 'add-ons above the EPC subtotal', 'amber', null),
    kpiCard('Total installed cost', `USD ${M(R.tic)}`, `vs. target order of magnitude USD ${M(D.project.target_tic)}`, 'green', null)));

  root.appendChild(el('div', { style: 'margin-top:10px' },
    card('Code-of-accounts build-up \u2014 direct cost to total installed cost', el('div', { class: 'wf' },
      waterfall(wfRows))).card));

  const breakdownCols = [
    { key: 'k', label: 'Field indirect', width: 260 },
    { key: 'v', label: '% of direct', num: true, mono: true, width: 100 },
    { key: 'usd', label: 'USD', num: true, mono: true, width: 130 },
  ];
  const fiRows = Object.entries(ind.field_indirects).map(([k, v]) => ({
    k: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), v: pct1(v * 100), usd: USD(R.totalDirect * v),
  }));
  const fiTbl = dataTable(breakdownCols, fiRows, { empty: 'No field indirect lines configured.' });

  const epcmCols = [
    { key: 'k', label: 'EPCM split', width: 260 },
    { key: 'v', label: '% of EPCM basis', num: true, mono: true, width: 120 },
    { key: 'usd', label: 'USD', num: true, mono: true, width: 130 },
  ];
  const epcmRows = Object.entries(ind.epcm_split).map(([k, v]) => ({
    k: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), v: pct1(v * 100), usd: USD(R.totalDirect * v),
  }));
  const epcmTbl = dataTable(epcmCols, epcmRows, { empty: 'No EPCM split lines configured.' });

  root.appendChild(el('div', { class: 'split split-3-2', style: 'margin-top:10px' },
    card('Field indirects breakdown', fiTbl.wrap, { flush: true }).card,
    card('EPCM split (informational)', epcmTbl.wrap, { flush: true }).card));

  root.appendChild(el('div', { style: 'margin-top:10px' },
    card('Assumptions', detailList([
      ['EPCM % of direct', pct1(ind.epcm_pct_of_direct * 100)],
      ['Owner cost %', pct1(ind.owner_cost_pct * 100)],
      ['Escalation %', pct1(ind.escalation_pct * 100)],
      ['Contingency %', pct1(ind.contingency_pct * 100)],
      ['Engineering source', R.eng.source === 'factored' ? 'Factored (EPCM slice)' : 'Detailed (FEED + Detail phases)'],
    ])).card));
}

/** Local waterfall bar chart — direct-cost-to-TIC build-up. Mirrors the
    Controls module's waterfall() but kept local since it depends on the
    .wf CSS defined in estimating.css. */
function waterfall(rows) {
  const mx = Math.max(1, ...rows.map((r) => Math.abs(r.from)), ...rows.map((r) => Math.abs(r.to)));
  return rows.map((r) => {
    const lo = Math.min(r.from, r.to);
    const hi = Math.max(r.from, r.to);
    return el('div', { class: `r${r.rule ? ' rule' : ''}` },
      el('span', { class: 'lb', text: r.label }),
      el('span', { class: 'bar' },
        el('i', {
          style: (() => {
            const left = Math.min(99.6, Math.max(0, (lo / mx) * 100));
            const w = Math.min(100 - left, Math.max(0.4, ((hi - lo) / mx) * 100));
            return `left:${left.toFixed(2)}%;width:${w.toFixed(2)}%;background:var(--${r.colour})`;
          })(),
        })),
      el('span', { class: 'vl', text: r.value }));
  });
}

/* ==========================================================================
   VIEW — engineering (FEED / Detail / factored-EPCM switch + guard)
   ========================================================================== */
function viewEngineering(root) {
  const R = rollup();
  const e = D.engineering;
  const isDetailed = e.engineering_source === 'detailed';

  root.appendChild(el('div', { class: `banner ${isDetailed ? 'ok' : 'warn'}`, style: 'display:flex;gap:8px' },
    el('b', { text: isDetailed ? 'Detailed engineering is active. ' : 'Factored EPCM engineering is active. ' }),
    isDetailed
      ? 'FEED + Detail phase man-hours drive engineering cost; the EPCM engineering slice below is held at zero so it is never added twice.'
      : `Engineering cost is ${pct1(e.factored_epcm_engineering_pct * 100)} of direct construction cost, carried inside EPCM; the FEED/Detail phase build-up below is suppressed to prevent double counting.`));

  root.appendChild(el('div', { class: 'grid', style: 'grid-template-columns:repeat(4,minmax(0,1fr));margin-top:10px' },
    kpiCard('Engineering cost (used)', `USD ${M(R.engineeringCostUsed || R.epcmEngineeringSlice)}`, isDetailed ? 'FEED + Detail, detailed' : 'factored EPCM slice', 'violet', null),
    kpiCard('FEED MH', MH(R.eng.feedMh), 'base + supervision + PM + integration + rework', 'blue', null),
    kpiCard('Detail MH', MH(R.eng.detailMh), 'base + supervision + PM + integration + rework', 'blue', null),
    kpiCard('Guard status', isDetailed
      ? (R.epcmEngineeringSlice === 0 ? 'OK \u2014 EPCM slice suppressed' : 'REVIEW')
      : (R.engineeringCostUsed === 0 ? 'OK \u2014 detailed phases suppressed' : 'REVIEW'),
      'only one engineering source may be active at a time', 'green', null)));

  const switchCard = card('Engineering basis switch', [
    el('div', { class: 'toolbar' },
      el('button', { class: isDetailed ? 'primary' : 'ghost', onclick: () => setSource('detailed') }, 'Detailed \u2014 FEED + Detail phases'),
      el('button', { class: !isDetailed ? 'primary' : 'ghost', onclick: () => setSource('factored') }, 'Factored \u2014 % of direct under EPCM')),
    el('div', { style: 'margin-top:10px' }, detailList([
      ['Factored %', `${pct1(e.factored_epcm_engineering_pct * 100)} of direct construction`],
      ['Detailed rate', `USD ${e.eng_rate}/hr`],
      ['Detailed total MH', MH(R.eng.detailedTotalMh)],
      ['Detailed total $', USD(R.eng.detailedCost)],
      ['Factored total $', USD(R.eng.factoredCost)],
    ])),
  ]).card;

  function setSource(src) {
    if (src === e.engineering_source) return;
    const old = e.engineering_source;
    e.engineering_source = src;
    audit('engineering', 'engineering_source', 'set_source', old, src);
    toast(`Engineering basis switched to ${src === 'factored' ? 'Factored EPCM' : 'Detailed FEED+Detail'}`);
    refreshAll();
  }

  const phaseCols = [
    { key: 'phase', label: 'Phase', width: 90 },
    { key: 'base_design_mh', label: 'Base design MH', num: true, mono: true, width: 120 },
    { key: 'supervision_pct', label: 'Supv %', num: true, mono: true, width: 80, render: (r) => pct1(r.supervision_pct * 100) },
    { key: 'pm_pct', label: 'PM %', num: true, mono: true, width: 80, render: (r) => pct1(r.pm_pct * 100) },
    { key: 'discipline_integration_pct', label: 'Integ %', num: true, mono: true, width: 80, render: (r) => pct1(r.discipline_integration_pct * 100) },
    { key: 'rework_pct', label: 'Rework %', num: true, mono: true, width: 80, render: (r) => pct1(r.rework_pct * 100) },
    { key: 'total_mh', label: 'Total MH', num: true, mono: true, width: 100, render: (r) => MH(phaseMh(r)) },
  ];
  const phaseRows = [{ phase: 'FEED', ...e.feed }, { phase: 'Detail', ...e.detail }];
  const phaseTbl = dataTable(phaseCols, phaseRows, { empty: 'No engineering phases configured.' });

  root.appendChild(el('div', { class: 'split split-3-2', style: 'margin-top:10px' },
    card('FEED / Detail phase build-up (used when Detailed is active)', phaseTbl.wrap, { flush: true }).card,
    switchCard));
}

/* ==========================================================================
   VIEW — benchmark (Method-2 parametric cross-check vs built-up estimate)
   ========================================================================== */
function viewBenchmark(root) {
  const R = rollup();
  const benchRows = benchmarkRows(R);

  root.appendChild(el('div', { class: 'banner', style: 'margin-bottom:10px' },
    el('b', { text: 'Method-2 benchmark cross-check. ' }),
    'Each discipline\u2019s built-up MH (from its active method) is compared '
    + 'against an independent benchmark MH \u2014 an editable MH-per-USD-1,000-of-'
    + 'direct-cost labor intensity \u00d7 the discipline\u2019s active direct cost. '
    + 'Variance beyond \u00b120% is flagged on the Dashboard\u2019s estimate-quality summary.'));

  const discOptions = ['All', ...D.benchmark.map((b) => b.discipline)];
  const wrap = el('div');

  function draw() {
    wrap.textContent = '';
    let rows = benchRows.slice();
    if (UI.benchDisc !== 'All') rows = rows.filter((r) => r.discipline === UI.benchDisc);
    const cols = [
      { key: 'discipline', label: 'Discipline', width: 120 },
      { key: 'benchmark_mh_per_1000usd', label: 'Benchmark MH / $1,000', num: true, mono: true, width: 150 },
      { key: 'field_factor', label: 'Field factor', num: true, mono: true, width: 100,
        render: (r) => editableFactor(r) },
      { key: 'costBasis', label: 'Direct cost basis', num: true, mono: true, width: 130, render: (r) => USD(r.costBasis) },
      { key: 'benchmarkMh', label: 'Benchmark MH', num: true, mono: true, width: 110, render: (r) => MH(r.benchmarkMh) },
      { key: 'builtUpMh', label: 'Built-up MH', num: true, mono: true, width: 110, render: (r) => MH(r.builtUpMh) },
      { key: 'variancePct', label: 'Variance %', num: true, mono: true, width: 100,
        render: (r) => el('span', { style: `color:var(--${Math.abs(r.variancePct) > 20 ? 'accent' : 'green'})`, text: pct1(r.variancePct) }) },
    ];
    const tbl = dataTable(cols, rows, { sort: 'discipline', dir: 1, empty: 'No benchmark rows configured.' });
    wrap.appendChild(tbl.wrap);
  }

  function editableFactor(r) {
    const input = el('input', {
      type: 'number', value: r.field_factor, step: '0.01', min: '0.1', style: 'width:70px',
      onchange: (ev) => {
        const v = Number(ev.target.value);
        if (!(v > 0)) { toast('Field factor must be positive', true); ev.target.value = r.field_factor; return; }
        const row = D.benchmark.find((b) => b.discipline === r.discipline);
        const old = row.field_factor;
        row.field_factor = v;
        audit('benchmark', r.discipline, 'edit_field_factor', old, v);
        toast(`${r.discipline} benchmark field factor set to ${v}`);
        refreshAll();
      },
    });
    return input;
  }

  root.appendChild(el('div', { style: 'margin-bottom:8px' },
    sel('Discipline', discOptions.map((d) => [d, d]), UI.benchDisc, (v) => { UI.benchDisc = v; draw(); }, 180)));
  draw();
  root.appendChild(card('Benchmark vs. built-up man-hours', wrap, { flush: true }).card);

  const chartRows = benchRows.map((r) => ({
    label: r.discipline, value: `${pct1(r.variancePct)}`,
    pct: Math.min(100, Math.abs(r.variancePct)),
    colour: Math.abs(r.variancePct) > 20 ? 'accent' : 'green',
  }));
  root.appendChild(el('div', { style: 'margin-top:10px' },
    card('Variance magnitude by discipline (\u00b120% tolerance band)', hBarChart(chartRows, { labelW: 130 })).card));
}

/* ==========================================================================
   VIEW — proposal (cover + fee to produce the estimate)
   ========================================================================== */
function viewProposal(root) {
  const R = rollup();
  const checks = evaluateQaChecks(R);
  const failing = checks.filter((c) => c.status === 'REVIEW');
  const totalFee = sum(D.proposal, 'fee_usd');
  const totalHours = sum(D.proposal, 'hours');

  root.appendChild(el('div', { class: 'grid', style: 'grid-template-columns:repeat(4,minmax(0,1fr))' },
    kpiCard('Estimate class proposed', D.project.estimate_class, `accuracy ${D.project.accuracy_low_pct}% / +${D.project.accuracy_high_pct}%`, 'blue', null),
    kpiCard('Fee to produce estimate', `USD ${K(totalFee)}k`, `${int(totalHours)} labor hours across the estimating team`, 'violet', null),
    kpiCard('Current status', D.project.estimate_status, `data date ${D.project.data_date}`, D.project.estimate_status === 'Issued' ? 'green' : 'grey', null),
    kpiCard('QA gate', failing.length ? `${failing.length} open item(s)` : 'Clear', 'checked before Issued is allowed', failing.length ? 'accent' : 'green', null)));

  root.appendChild(el('div', { class: 'split split-3-2', style: 'margin-top:10px' },
    card('Proposal cover', detailList([
      ['Project', `${D.project.project_name} (${D.project.project_no})`],
      ['Client', D.project.client],
      ['Contractor', D.project.contractor],
      ['Location', D.project.location],
      ['Currency', D.project.currency],
      ['Data date', D.project.data_date],
      ['RFSU', D.project.rfsu],
      ['Estimate class', D.project.estimate_class],
      ['Markup model', D.project.markup_model],
      ['Estimator of record', D.project.estimator],
    ])).card,
    statusCard()));

  const feeCols = [
    { key: 'role', label: 'Role' },
    { key: 'hours', label: 'Hours', num: true, mono: true, width: 90 },
    { key: 'rate', label: 'Rate $/hr', num: true, mono: true, width: 90 },
    { key: 'fee_usd', label: 'Fee $', num: true, mono: true, width: 110, render: (r) => USD(r.fee_usd) },
  ];
  const feeTbl = dataTable(feeCols, D.proposal, { sort: 'fee_usd', dir: -1, empty: 'No proposal fee rows configured.' });
  root.appendChild(el('div', { style: 'margin-top:10px' },
    card(`Fee to produce the estimate \u2014 total USD ${USD(totalFee)}`, feeTbl.wrap, { flush: true }).card));
  if (window.vrDocs) root.appendChild(el('div', { style: 'margin-top:10px' }, card('Estimate documents', vrDocs('estimating', `estimate:${D.project.project_no || 'project'}`, {
    label: `Estimate ${D.project.project_no || ''}`.trim(), empty: 'No files attached. Upload the basis of estimate, the issued proposal, scope drawings, vendor quotations or the client RFP.' })).card));

  function statusCard() {
    const body = [
      el('div', { class: 'toolbar' },
        ...['Draft', 'In Review', 'Issued'].map((s) => el('button', {
          class: D.project.estimate_status === s ? 'primary' : 'ghost',
          onclick: () => tryStatusChange(s),
        }, s))),
    ];
    if (failing.length) {
      body.push(el('div', { class: 'banner warn', style: 'margin-top:10px' },
        `${failing.length} QA check(s) are flagged \u2014 review the Dashboard before marking Issued.`));
    }
    return card('Estimate status', body).card;
  }

  function tryStatusChange(target) {
    if (target === D.project.estimate_status) return;
    if (target === 'Issued' && failing.length) {
      modal({
        title: 'Cannot mark estimate Issued', width: 520,
        sub: `${failing.length} QA check(s) are still flagged`,
        body: el('div', {},
          el('div', { class: 'banner bad', style: 'margin-bottom:8px' },
            'An estimate cannot be Issued while QA & Checks show open items. Resolve the items below or revise the estimate, then try again.'),
          el('ul', {}, failing.map((f) => el('li', { text: `${f.check}: ${f.detail}` })))),
        buttons: [
          { label: 'Go to Dashboard', primary: true, onClick: () => { closeModal(); TABS.go('dashboard'); } },
          { label: 'Close', onClick: closeModal },
        ],
      });
      return;
    }
    const old = D.project.estimate_status;
    D.project.estimate_status = target;
    audit('estimate', D.project.project_no, 'set_status', old, target);
    toast(`Estimate status set to ${target}`);
    refreshAll();
  }
}

/* ==========================================================================
   VIEW — audit (audit trail)
   ========================================================================== */
function viewAudit(root) {
  const rows = D.audit.slice().sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const cols = [
    { key: 'ts', label: 'Timestamp', width: 150, mono: true },
    { key: 'entity', label: 'Entity', width: 130 },
    { key: 'entity_ref', label: 'Ref', width: 140, mono: true },
    { key: 'action', label: 'Action', width: 130 },
    { key: 'old_value', label: 'Old value' },
    { key: 'new_value', label: 'New value' },
    { key: 'user_name', label: 'User', width: 130 },
  ];
  const tbl = dataTable(cols, rows, { sort: 'ts', dir: -1, maxHeight: 560, empty: 'No audit entries yet.' });
  root.appendChild(card(`Audit trail \u2014 ${rows.length} entries`, tbl.wrap, { flush: true }).card);
}
