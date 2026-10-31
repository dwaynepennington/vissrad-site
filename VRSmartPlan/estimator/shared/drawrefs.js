/* ==========================================================================
   VissRad Suite — document references (P&IDs, isometrics and other drawings,
   specifications, datasheets, procedures, manuals, vendor documents).

   A record that is priced, planned, built or tested from a drawing keeps a
   list of the drawings it came from:

     drawing_refs: [{ type: 'PID' | 'ISO' | ..., doc_no, sheet, rev }]

   The drawing numbers come from the VRDEng register as DEng last
   published it (vissrad.deng.link.v1). In the demonstration the seeded DEng
   register stands in when DEng has not been opened yet. A number that is not
   on the register can still be typed in (a client drawing, a vendor drawing,
   a sketch), and is shown as "not on register".

   The revision is the one the record was based on. When the register holds a
   later revision the reference is flagged, so an estimate priced on rev 0 of
   an isometric shows that rev 1 has since been issued.

   The same register carries the VRDEng document repository (repository
   documents, specification sections and which revisions have a file), so a
   chip shows when the file is on hand and opens the document in DEng's
   Documents tab (?doc=<number>&rev=<rev>). docChip() makes a chip for a plain
   document number held on any record (a tag's P&ID, a check sheet's form, an
   RFI's spec section); docsForTag() lists the documents tagged to equipment.
   ========================================================================== */
'use strict';

const DREF_TYPES = [
  ['PID', 'P&ID'],
  ['ISO', 'Isometric'],
  ['PFD', 'PFD'],
  ['PLN', 'Piping plan'],
  ['GAD', 'General arrangement'],
  ['SUP', 'Pipe support'],
  ['LOD', 'Loop drawing'],
  ['SLD', 'Single line'],
  ['SPC', 'Specification'],
  ['SPS', 'Spec section'],
  ['DSH', 'Datasheet'],
  ['CAL', 'Calculation'],
  ['LST', 'List / schedule'],
  ['RPT', 'Report / study'],
  ['PRC', 'Procedure / form'],
  ['MAN', 'Manual'],
  ['VND', 'Vendor document'],
  ['CRT', 'Certificate'],
  ['STD', 'Standard'],
  ['OTH', 'Other'],
];
/* register document types that are not offered in the type list but keep their own label */
const DREF_LABEL = Object.assign(Object.fromEntries(DREF_TYPES), {
  FDN: 'Foundation', STL: 'Steel', LAY: 'Layout', HAC: 'Hazardous area', CSD: 'Control system', DWG: 'Drawing',
  MTO: 'Take-off', TIE: 'Tie-in list', IIL: 'Instrument index', CSH: 'Cable schedule', DBS: 'Design basis', HMB: 'Heat & mass balance',
  HAZ: 'Safety study', STR: 'Stress calc', '3DM': 'Model review', VDR: 'Vendor data review',
});
const DREF_DOC_TYPES = new Set(['SPC', 'SPS', 'DSH', 'CAL', 'LST', 'RPT', 'PRC', 'MAN', 'VND', 'CRT', 'STD', 'MTO', 'TIE', 'IIL', 'CSH', 'DBS', 'HMB', 'HAZ', 'STR', 'VDR']);
let DREF_FILES = {};          // doc_no -> ['0', '1*'] revisions with a file (* = not a PDF)

let DREF_REG = null;          // [{doc_no, doc_type, rev, state, title, area_code, project_no, sheets}]
let DREF_FROM = '';           // 'deng' | 'demo' | ''
let DREF_WAIT = null;

/** Load the drawing register once. Resolves to the register (possibly empty). */
function drawRegisterLoad() {
  if (DREF_WAIT) return DREF_WAIT;
  /* A standalone build (VRPlanner, VRTAR) has no VRDEng: numbers are kept as typed. */
  if (window.VR_STANDALONE) { DREF_REG = []; DREF_WAIT = Promise.resolve(DREF_REG); return DREF_WAIT; }
  let L = null;
  if (typeof suiteLinkRead === 'function') L = suiteLinkRead('deng');
  else { try { L = JSON.parse(window[['local', 'Storage'].join('')].getItem('vissrad.deng.link.v1')) || null; } catch (e) { L = null; } }
  if (L && ((Array.isArray(L.deliverables) && L.deliverables.length) || (Array.isArray(L.documents) && L.documents.length))) {
    DREF_FILES = L.files || {};
    DREF_REG = (L.deliverables || []).concat(L.documents || []).map(drefNorm);
    DREF_FROM = 'deng';
    DREF_WAIT = Promise.resolve(DREF_REG);
    return DREF_WAIT;
  }
  const demo = !(window.VRUSER && window.VRUSER.user);
  if (!demo) { DREF_REG = []; DREF_WAIT = Promise.resolve(DREF_REG); return DREF_WAIT; }
  DREF_WAIT = fetch('../deng/data.json').then((r) => (r.ok ? r.json() : null)).then((d) => {
    DREF_FILES = {};
    for (const f of (d && d.drawing_files) || []) {
      const pdf = f.mime ? /pdf/i.test(f.mime) : true;
      (DREF_FILES[f.doc_no] = DREF_FILES[f.doc_no] || []).push(pdf ? f.rev : `${f.rev}*`);
    }
    const specs = ((d && d.spec_sections) || []).map((x) => ({ doc_no: x.spec_id, project_no: x.project_no, title: `Section ${x.section} — ${x.title}`, doc_type: 'SPS', rev: '0', section: x.section }));
    DREF_REG = ((d && d.deliverables) || []).concat((d && d.documents) || [], specs).map(drefNorm);
    DREF_FROM = DREF_REG.length ? 'demo' : '';
    return DREF_REG;
  }).catch(() => { DREF_REG = []; return DREF_REG; });
  return DREF_WAIT;
}
function drefNorm(d) {
  return {
    doc_no: d.doc_no, doc_type: d.doc_type, rev: d.rev == null ? '' : String(d.rev), state: d.state || '',
    title: d.title || '', area_code: d.area_code || drefAreaFromTitle(d.title), project_no: d.project_no || '',
    sheets: d.sheets || null, discipline: d.discipline || '', category: d.category || '', tags: d.tags || [], section: d.section || '',
  };
}
function drefAreaFromTitle(t) { const m = /\b(A\d{2})\b/.exec(String(t || '')); return m ? m[1] : ''; }
function drawRegister() { return DREF_REG || []; }
function drawRegisterSource() { return DREF_FROM; }

/** Register rows of the given types, for one project when given; same-area rows first. */
function drawRegisterFor(opts = {}) {
  const types = opts.types ? new Set(opts.types) : null;
  let rows = drawRegister().filter((d) => (!types || types.has(d.doc_type)));
  if (opts.project) {
    const own = rows.filter((d) => d.project_no === opts.project);
    if (own.length) rows = own;
  }
  const area = opts.area || '';
  return rows.slice().sort((a, b) => (b.area_code === area) - (a.area_code === area)
    || String(a.doc_no).localeCompare(String(b.doc_no)));
}
function drawRegisterGet(docNo) {
  const k = String(docNo || '').trim().toUpperCase();
  return drawRegister().find((d) => String(d.doc_no).toUpperCase() === k) || null;
}
/** Guess the drawing type from its number (…-PID-0001, …-ISO-0003). */
function drefGuessType(docNo) {
  const r = drawRegisterGet(docNo);
  if (r && DREF_LABEL[r.doc_type]) return r.doc_type;
  const n = String(docNo || '').toUpperCase();
  if (/^PID-/.test(n)) return 'PID';
  if (/^ITR-FORM-/.test(n)) return 'PRC';
  if (/^OM-/.test(n)) return 'MAN';
  if (/-STD-/.test(n)) return 'STD';
  const m = /-(PID|ISO|PFD|PLN|GAD|SUP|LOD|SLD|SPC|DSH|CAL|PRC|MAN|STD|CSH|IIL|MTO|DBS|HMB|HAZ)-/.exec(n);
  if (m) return m[1];
  const v = /^PO-.*-(GA|DS|ITP|WPS|CAL|IOM|SPL|MDR|MTR|COC|PL)-\d+$/.exec(n);
  if (v) return v[1] === 'COC' || v[1] === 'MTR' ? 'CRT' : 'VND';
  return 'OTH';
}
/** 'pdf' when the revision (or, without one, any revision) has a PDF on file in DEng, 'file' for another file type, '' for none. */
function drefOnFile(docNo, rev) {
  const k = String(docNo || '').trim().toUpperCase();
  const key = Object.prototype.hasOwnProperty.call(DREF_FILES, docNo) ? docNo : Object.keys(DREF_FILES).find((x) => x.toUpperCase() === k);
  const revs = key ? DREF_FILES[key] : null;
  if (!revs || !revs.length) return '';
  const want = rev === undefined || rev === null || rev === '' ? null : String(rev);
  const hit = want === null ? revs : revs.filter((x) => x.replace('*', '') === want);
  if (!hit.length) return '';
  return hit.some((x) => !x.endsWith('*')) ? 'pdf' : 'file';
}
/** Documents tagged to a piece of equipment (O&M manuals, datasheets). */
function docsForTag(tag) {
  const t = String(tag || '').trim().toUpperCase();
  if (!t) return [];
  return drawRegister().filter((d) => (d.tags || []).some((x) => String(x).toUpperCase() === t));
}
/** Register documents for a project, of the given types, optionally one discipline. */
function docsFor(opts = {}) {
  const types = opts.types ? new Set(opts.types) : null;
  return drawRegister().filter((d) => (!opts.project || d.project_no === opts.project) && (!types || types.has(d.doc_type)) && (!opts.discipline || d.discipline === opts.discipline));
}

/** 'current' | 'superseded' | 'unregistered' | 'unknown' (no register loaded). */
function drefStatus(ref) {
  if (!drawRegister().length) return 'unknown';
  const r = drawRegisterGet(ref.doc_no);
  if (!r) return 'unregistered';
  if (ref.rev && r.rev && String(ref.rev) !== String(r.rev)) return 'superseded';
  return 'current';
}

/** Clean a list: trims, upper-cases numbers, drops blanks and duplicates. */
function drefClean(refs) {
  const seen = new Set();
  const out = [];
  for (const x of refs || []) {
    const doc = String((x && x.doc_no) || '').trim().toUpperCase();
    if (!doc) continue;
    const sheet = String(x.sheet == null ? '' : x.sheet).trim();
    const key = `${doc}|${sheet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const reg = drawRegisterGet(doc);
    out.push({
      type: x.type && DREF_LABEL[x.type] ? x.type : drefGuessType(doc),
      doc_no: doc, sheet, rev: String(x.rev == null || x.rev === '' ? (reg ? reg.rev : '') : x.rev),
    });
  }
  return out;
}

/** Short form for tables, CSV and search: "PID-0001 sh 2 r0; ISO-0003 r0". */
function drefShort(docNo) {
  const m = /-([A-Z]{3}-\d{3,})$/.exec(String(docNo || ''));
  return m ? m[1] : String(docNo || '');
}
function drefText(refs, full) {
  return (refs || []).map((r) => `${full ? r.doc_no : drefShort(r.doc_no)}${r.sheet ? ` sh ${r.sheet}` : ''}${r.rev !== '' && r.rev != null ? ` r${r.rev}` : ''}`).join('; ');
}
function drefHas(refs, types) {
  return (refs || []).some((r) => !types || types.includes(r.type));
}

/** Open a document in VRDEng (the file when one is attached, otherwise its row in Documents). */
function drefOpen(ref) {
  const p = { doc: ref.doc_no };
  if (ref.rev !== undefined && ref.rev !== null && ref.rev !== '') p.rev = ref.rev;
  if (ref.pin) p.pin = ref.pin;
  if (typeof suiteHref === 'function') { location.href = suiteHref('deng', 'documents', p); return; }
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(p)) q.set(k, v);
  location.href = `../deng/index.html?${q}#documents`;
}

/** Chips for a detail panel. Each chip opens the drawing in DEng. */
function drawRefChips(refs, opts = {}) {
  const list = refs || [];
  if (!list.length) return el('span', { class: 'dref-none', text: opts.emptyText || 'None' });
  return el('div', { class: 'dref-chips' }, list.map((r) => {
    let st = drefStatus(r);
    if (opts.check === false && st === 'unregistered') st = 'external';
    const reg = drawRegisterGet(r.doc_no);
    const warn = st === 'superseded' ? ` \u2014 based on rev ${r.rev}, register is at rev ${reg.rev}`
      : st === 'unregistered' ? ' \u2014 not in the DEng document register' : '';
    const onFile = reg ? drefOnFile(r.doc_no, r.rev || reg.rev) : '';
    return el('button', {
      type: 'button', class: `dref-chip dref-${st}`,
      title: `${DREF_LABEL[r.type] || r.type} ${r.doc_no}${r.sheet ? ` sheet ${r.sheet}` : ''}${r.rev ? ` rev ${r.rev}` : ''}${reg ? ` \u2014 ${reg.title}` : ''}${warn}${onFile ? ' \u2014 file on hand' : ''}${reg ? '. Open in VRDEng.' : ''}`,
      onclick: (e) => { e.stopPropagation(); if (reg) drefOpen({ ...r, pin: opts.pin }); },
    },
    el('span', { class: 'dref-type', text: r.type === 'PID' ? 'P&ID' : r.type }),
    el('span', { class: 'dref-no', text: opts.full ? r.doc_no : drefShort(r.doc_no) }),
    r.sheet ? el('span', { class: 'dref-meta', text: `sh ${r.sheet}` }) : null,
    r.rev !== '' ? el('span', { class: 'dref-meta', text: `r${r.rev}` }) : null,
    st === 'superseded' ? el('span', { class: 'dref-flag', text: `now r${reg.rev}` }) : null,
    st === 'unregistered' ? el('span', { class: 'dref-flag', text: 'not on register' }) : null,
    onFile ? el('span', { class: 'dref-file', text: onFile === 'pdf' ? 'PDF' : 'file' }) : null);
  }));
}

/**
 * One chip for a plain document number held on a record. Falls back to the
 * number as text when it is blank. opts: { rev, full, pin, check }.
 */
function docChip(docNo, opts = {}) {
  const no = String(docNo || '').trim();
  if (!no) return el('span', { text: '—' });
  const reg = drawRegisterGet(no);
  const ref = { type: drefGuessType(no), doc_no: reg ? reg.doc_no : no, sheet: '', rev: opts.rev === undefined || opts.rev === null ? '' : String(opts.rev) };
  const w = drawRefChips([ref], { full: opts.full !== false, pin: opts.pin, check: opts.check });
  w.classList.add('dref-inline');
  return w;
}

/**
 * Editor for a list of drawing references, for use inside a form.
 * opts: { types: ['PID','ISO'] (the quick-add buttons), project, area,
 *         check: false (numbers are not expected on the DEng register, e.g. an operating plant) }
 * Returns { el, value() } — value() gives the cleaned list.
 */
function drawRefsEditor(refs, opts = {}) {
  const quick = opts.types || ['PID', 'ISO'];
  const rows = (refs || []).map((r) => ({ ...r }));
  const wrap = el('div', { class: 'dref-edit' });
  const listId = `dref-dl-${Math.random().toString(36).slice(2, 8)}`;
  const lists = {};

  const useReg = !(opts.check === false && DREF_FROM !== 'deng');
  function datalistFor(type) {
    if (!useReg) return null;
    if (lists[type]) return lists[type].id;
    const id = `${listId}-${type}`;
    const reg = drawRegisterFor({ types: type === 'OTH' ? null : [type], project: opts.project, area: opts.area });
    lists[type] = el('datalist', { id }, reg.slice(0, 400).map((d) => el('option', { value: d.doc_no }, `${d.title}${d.rev !== '' ? ` \u00b7 rev ${d.rev}` : ''}${d.state ? ` \u00b7 ${d.state}` : ''}`)));
    wrap.appendChild(lists[type]);
    return id;
  }

  const body = el('div', { class: 'dref-rows' });
  function draw() {
    body.textContent = '';
    if (!rows.length) body.appendChild(el('div', { class: 'dref-none', text: 'No documents referenced yet.' }));
    rows.forEach((r, i) => {
      const opts2 = DREF_TYPES.some(([v]) => v === r.type) || !r.type ? DREF_TYPES : DREF_TYPES.concat([[r.type, DREF_LABEL[r.type] || r.type]]);
      const typeSel = el('select', { class: 'dref-t', onchange: (e) => { r.type = e.target.value; draw(); } },
        opts2.map(([v, t]) => el('option', { value: v, selected: v === r.type }, t)));
      const reg = drawRegisterGet(r.doc_no);
      const hint = el('div', { class: 'dref-hint' });
      const noIn = el('input', {
        type: 'text', class: 'dref-n', value: r.doc_no || '', list: datalistFor(r.type || 'OTH'),
        placeholder: r.type === 'ISO' ? 'Isometric number' : r.type === 'PID' ? 'P&ID number' : DREF_DOC_TYPES.has(r.type) ? 'Document number' : 'Drawing or document number', spellcheck: 'false',
        oninput: (e) => { r.doc_no = e.target.value; const g = drawRegisterGet(r.doc_no); if (g) { r.rev = g.rev; revIn.value = g.rev; } setHint(); },
        onchange: (e) => { const t = drefGuessType(e.target.value); if (t !== 'OTH' && t !== r.type) { r.type = t; draw(); } },
      });
      const sheetIn = el('input', { type: 'text', class: 'dref-s', value: r.sheet || '', placeholder: 'Sheet', oninput: (e) => { r.sheet = e.target.value; } });
      const revIn = el('input', { type: 'text', class: 'dref-r', value: r.rev || '', placeholder: 'Rev', oninput: (e) => { r.rev = e.target.value; setHint(); } });
      const del = el('button', { type: 'button', class: 'ghost dref-x', title: 'Remove this reference', onclick: () => { rows.splice(i, 1); draw(); } }, '\u00d7');
      const openB = el('button', {
        type: 'button', class: 'ghost dref-o', title: 'Open in VRDEng. Save first: changes in this dialog are not kept.',
        onclick: () => { const g = drawRegisterGet(r.doc_no); if (!g) return; if (typeof closeModal === 'function') closeModal(); drefOpen({ ...r, doc_no: g.doc_no }); },
      }, 'Open');
      function setHint() {
        const g = drawRegisterGet(r.doc_no);
        openB.style.visibility = useReg && g ? 'visible' : 'hidden';
        if (!String(r.doc_no || '').trim()) { hint.textContent = ''; return; }
        if (!useReg || !drawRegister().length) { if (!useReg) { hint.textContent = ''; return; } hint.textContent = 'No DEng register loaded; the number is kept as typed.'; return; }
        if (!g) { hint.textContent = opts.check === false ? '' : 'Not on the DEng register; kept as typed.'; hint.className = 'dref-hint warn'; return; }
        hint.className = 'dref-hint' + (r.rev && g.rev && String(r.rev) !== String(g.rev) ? ' warn' : '');
        hint.textContent = `${g.title} \u00b7 register rev ${g.rev}${g.state ? ` (${g.state})` : ''}${g.sheets ? ` \u00b7 ${g.sheets} sheet${g.sheets > 1 ? 's' : ''}` : ''}`
          + (r.rev && g.rev && String(r.rev) !== String(g.rev) ? ` \u2014 this line is on rev ${r.rev}` : '');
      }
      setHint();
      void reg;
      body.appendChild(el('div', { class: 'dref-row' }, typeSel, noIn, sheetIn, revIn, openB, del));
      body.appendChild(hint);
    });
  }
  draw();
  const add = el('div', { class: 'dref-add' },
    quick.map((t) => el('button', { type: 'button', class: 'ghost', onclick: () => { rows.push({ type: t, doc_no: '', sheet: '', rev: '' }); draw(); const ins = body.querySelectorAll('.dref-n'); if (ins.length) ins[ins.length - 1].focus(); } }, `+ ${DREF_LABEL[t] || t}`)),
    el('button', { type: 'button', class: 'ghost', onclick: () => { rows.push({ type: 'OTH', doc_no: '', sheet: '', rev: '' }); draw(); } }, '+ Other document'),
    el('span', { class: 'dref-src', text: opts.check === false ? (useReg ? 'Plant drawing numbers: type them, or pick from the DEng register' : 'Plant drawing numbers: type them as shown on the drawing') : DREF_FROM === 'deng' ? 'Numbers from the VRDEng register and document repository' : DREF_FROM === 'demo' ? 'Numbers from the demonstration DEng register and repository' : 'No DEng register found: type the numbers' }));
  wrap.appendChild(body);
  wrap.appendChild(add);
  return { el: wrap, value: () => drefClean(rows) };
}

/**
 * Modal to edit the drawings on one record.
 * onSave(list) receives the cleaned list; opts as drawRefsEditor plus title/sub.
 */
function drawRefsDialog(refs, opts, onSave) {
  const ed = drawRefsEditor(refs, opts);
  modal({
    title: opts.title || 'Reference documents', sub: opts.sub || 'Drawings and documents this record is based on.',
    width: 720, body: ed.el,
    buttons: [
      { label: opts.saveLabel || 'Save', primary: true, onClick: () => { const v = ed.value(); closeModal(); onSave(v); } },
      { label: 'Cancel', onClick: closeModal },
    ],
  });
}

/* Styles live here so every module that loads this file gets them. */
(function drefStyles() {
  if (document.getElementById('dref-css')) return;
  const css = `
.dref-chips{display:flex;flex-wrap:wrap;gap:4px}
.dref-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 7px;border:1px solid var(--border-hi);border-radius:4px;background:var(--panel-alt);color:var(--text);font:12px var(--ui);cursor:pointer;line-height:18px}
.dref-chip:hover{border-color:var(--blue)}
.dref-chip.dref-unregistered,.dref-chip.dref-external{cursor:default}
.dref-type{font-weight:600;color:var(--text-dim);font-size:11px}
.dref-no{font-family:var(--mono);font-size:11.5px}
.dref-meta{color:var(--text-dim);font-size:11px}
.dref-flag{color:var(--amber);font-size:11px;font-weight:600}
.dref-file{color:var(--green,#6daa45);font-size:10.5px;font-weight:600;border:1px solid currentColor;border-radius:3px;padding:0 3px;line-height:14px}
.dref-chips.dref-inline{display:inline-flex;vertical-align:middle}
.dref-superseded,.dref-unregistered{border-color:color-mix(in srgb,var(--amber) 60%,transparent)}
.dref-none{color:var(--text-faint);font-size:12px}
.dref-edit{display:flex;flex-direction:column;gap:6px;min-width:0}
.dref-row{display:grid;grid-template-columns:118px minmax(200px,1fr) 58px 48px 52px 28px;gap:6px;align-items:center}
.dref-row input,.dref-row select{min-width:0;width:100%}
.dref-n{font-family:var(--mono)}
.dref-x{padding:2px 0}
.dref-o{padding:2px 4px;font-size:12px}
.dref-hint{font-size:11px;color:var(--text-dim);margin:-2px 0 2px 124px}
.dref-hint.warn{color:var(--amber)}
.dref-add{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.dref-src{font-size:11px;color:var(--text-faint);margin-left:4px}
.form-grid .dref-edit{grid-column:span 1}`;
  const s = document.createElement('style');
  s.id = 'dref-css';
  s.textContent = css;
  (document.head || document.documentElement).appendChild(s);
}());

if (typeof module !== 'undefined') module.exports = { drefClean, drefText, drefShort, drefStatus, drefGuessType, drefOnFile };
