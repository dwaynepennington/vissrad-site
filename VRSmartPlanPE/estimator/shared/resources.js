/* ==========================================================================
   VissRad Suite — resources and rates (window.VissRadResources)

   One resource library with hourly (or per-unit) rates, shared by every
   module of the suite in the same browser and project: the Schedule Editor
   assigns resources to activities and costs them from it, Cost prices time
   and materials tickets from its labor rates, and Estimating can send its
   craft rates to it. VRScheduler (the standalone schedule tool) keeps the
   same library on its own.

   Stored under the key vissrad.resources.v1. In the suite's user mode that
   key is kept per project by the mode layer (shared/usermode.js), like every
   other VissRad key, so each project carries its own contract rates; the
   demo has its own, seeded with synthetic rates.

   A resource: { code, name, type: Labor | Equipment | Material | Subcontract,
     uom (hr, day, mo, ea ...), rates: [{ from: 'YYYY-MM-DD' | '', base, burden }],
     ot (overtime factor), max (units a day, optional), disc, notes }
   The all-in rate is base x (1 + burden %). The rate used on a date is the
   latest one whose 'from' is on or before it (the first one before them all).
   P6 types: Labor -> RT_Labor, Equipment -> RT_Equip, Material and
   Subcontract -> RT_Mat.

   Changes are announced with the 'vissrad:resources' document event, in this
   tab and (through the storage event) in every other tab of the suite.
   Nothing leaves the browser.
   ========================================================================== */
(function (global) {
  'use strict';
  if (global.VissRadResources) return;

  const KEY = 'vissrad.resources.v1';
  const TYPES = ['Labor', 'Equipment', 'Material', 'Subcontract'];
  const P6TYPE = { Labor: 'RT_Labor', Equipment: 'RT_Equip', Material: 'RT_Mat', Subcontract: 'RT_Mat' };
  const FROM_P6 = { RT_Labor: 'Labor', RT_Equip: 'Equipment', RT_Mat: 'Material' };
  const UOMS = ['hr', 'day', 'wk', 'mo', 'ea', 'm', 'm2', 'm3', 't', 'lot'];
  const DIR = ((document.currentScript && document.currentScript.src) || '').replace(/[^/]*$/, '');

  /* Synthetic demonstration rates, the same as the Cost demo's resources. Not market data. */
  const EXAMPLE = [
    ['PIPE-FT', 'Pipefitter', 'Labor', 'hr', 78.5], ['WELD-CS', 'Welder, carbon steel', 'Labor', 'hr', 84], ['WELD-AL', 'Welder, alloy', 'Labor', 'hr', 96],
    ['ELEC-JW', 'Electrician, journeyman', 'Labor', 'hr', 81], ['INST-TC', 'Instrument technician', 'Labor', 'hr', 88], ['IRON-ST', 'Ironworker, structural', 'Labor', 'hr', 79],
    ['CIVL-CR', 'Civil crew', 'Labor', 'hr', 68], ['MILL-RT', 'Millwright, rotating', 'Labor', 'hr', 92], ['SUPV-GF', 'General foreman', 'Labor', 'hr', 105],
    ['ENGR-PR', 'Process engineer', 'Labor', 'hr', 148], ['ENGR-PI', 'Piping designer', 'Labor', 'hr', 126], ['PM-STF', 'Project management staff', 'Labor', 'hr', 162],
    ['CRN-250', 'Crawler crane 250 t', 'Equipment', 'mo', 41500], ['CRN-090', 'Hydraulic crane 90 t', 'Equipment', 'mo', 17800], ['SCF-ERC', 'Scaffold, erect and dismantle', 'Subcontract', 'lot', 0],
  ].map(([code, name, type, uom, rate]) => ({ code, name, type, uom, rates: [{ from: '', base: rate, burden: 0 }], ot: /^Labou?r$/.test(type) ? 1.5 : 1, max: '', disc: '', notes: 'Synthetic example rate' }));

  /* ------------------------------------------------------------ storage */
  const store = (() => {
    try { const w = global[['local', 'Storage'].join('')]; w.setItem(KEY + '.probe', '1'); w.removeItem(KEY + '.probe'); return { get: () => w.getItem(KEY), set: (v) => { w.setItem(KEY, v); return true; } }; }
    catch (e) { let m = null; return { get: () => m, set: (v) => { m = v; return true; } }; }
  })();
  const isDemo = () => !global.VR_STANDALONE && !!global.VRUSER && global.VRUSER.mode !== 'user';
  const num = (v, d) => { const n = typeof v === 'number' ? v : parseFloat(String(v === undefined || v === null ? '' : v).replace(/[$,\s]/g, '')); return isFinite(n) ? n : (d === undefined ? 0 : d); };
  const round = (v, p) => { const f = Math.pow(10, p === undefined ? 2 : p); return Math.round((+v || 0) * f) / f; };
  const isoOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

  function norm(r) {
    r = r || {};
    const type = TYPES.find((t) => t.toLowerCase() === String(r.type || '').trim().toLowerCase().replace(/labour$/, 'labor')) || FROM_P6[r.type] || 'Labor';
    let rates = Array.isArray(r.rates) && r.rates.length ? r.rates : [{ from: '', base: r.rate !== undefined ? r.rate : r.base, burden: r.burden }];
    rates = rates.map((x) => ({ from: isoOk(x.from) ? x.from : '', base: round(num(x.base), 4), burden: round(num(x.burden), 3) }))
      .sort((a, b) => (a.from || '').localeCompare(b.from || ''));
    const seen = new Set(); rates = rates.filter((x) => { if (seen.has(x.from)) return false; seen.add(x.from); return true; });
    return {
      code: String(r.code || '').trim().slice(0, 40), name: String(r.name || '').replace(/\s+/g, ' ').trim().slice(0, 120), type,
      uom: String(r.uom || (/^Labou?r$/.test(type) ? 'hr' : 'ea')).trim().slice(0, 12) || 'hr', rates,
      ot: r.ot === '' || r.ot === undefined || r.ot === null ? (/^Labou?r$/.test(type) ? 1.5 : 1) : round(num(r.ot, 1), 3),
      max: r.max === '' || r.max === undefined || r.max === null ? '' : round(num(r.max), 3),
      disc: String(r.disc || '').trim().slice(0, 60), notes: String(r.notes || '').trim().slice(0, 300),
    };
  }
  function read() {
    let v = null; try { v = JSON.parse(store.get() || 'null'); } catch (e) { v = null; }
    if (!v || !Array.isArray(v.list)) {
      v = { v: 1, list: isDemo() ? EXAMPLE.map(norm) : [], updated: '' };
      if (isDemo()) store.set(JSON.stringify(v));
    }
    // libraries saved before the Labor spelling
    v.list = v.list.map((r) => (r && /^labour$/i.test(r.type) ? Object.assign({}, r, { type: 'Labor' }) : r));
    return v;
  }
  let CACHE = null;
  function lib() { if (!CACHE) CACHE = read(); return CACHE; }
  function list() { return lib().list; }
  function find(code) { const c = String(code || '').trim().toLowerCase(); return c ? list().find((r) => r.code.toLowerCase() === c) || null : null; }
  const UNDO = [];
  function save(next, why) {
    const cur = lib();
    UNDO.push(JSON.stringify(cur.list)); if (UNDO.length > 40) UNDO.shift();
    const v = { v: 1, list: next.map(norm).filter((r) => r.code), updated: new Date().toISOString() };
    try { store.set(JSON.stringify(v)); } catch (e) { return false; }
    CACHE = v; announce(why || 'save'); return true;
  }
  function undo() { if (!UNDO.length) return false; const prev = JSON.parse(UNDO.pop()); const v = { v: 1, list: prev, updated: new Date().toISOString() }; store.set(JSON.stringify(v)); CACHE = v; announce('undo'); return true; }
  function announce(why) { try { document.dispatchEvent(new CustomEvent('vissrad:resources', { detail: { why } })); } catch (e) { /* old browser */ } }
  global.addEventListener('storage', (e) => { if (!e.key || e.key === KEY || e.key.slice(-KEY.length) === KEY) { CACHE = null; announce('other-tab'); } });

  /* ------------------------------------------------------------ rates */
  const allIn = (x) => (x ? round(num(x.base) * (1 + num(x.burden) / 100), 4) : 0);
  function rateEntry(r, iso) {
    if (!r || !r.rates || !r.rates.length) return null;
    const on = iso || todayIso(); let pick = r.rates[0];
    r.rates.forEach((x) => { if (!x.from || x.from <= on) pick = x; }); // sorted by date, the opening rate first
    return pick;
  }
  function rateOn(r, iso) { return allIn(rateEntry(r, iso)); }
  function todayIso() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  const isTimeUnit = (u) => /^(h|hr|hrs|hour|hours|mh)$/i.test(String(u || ''));

  /* Add or update resources by code. mode 'add' leaves existing ones as they are. */
  function upsert(items, mode) {
    const cur = list().map((r) => Object.assign({}, r)); const at = new Map(cur.map((r, i) => [r.code.toLowerCase(), i]));
    let added = 0, updated = 0;
    items.map(norm).filter((r) => r.code).forEach((r) => {
      const i = at.get(r.code.toLowerCase());
      if (i === undefined) { at.set(r.code.toLowerCase(), cur.length); cur.push(r); added++; }
      else if (mode !== 'add') {
        // rates merge by effective date: the incoming ones win, other dated rates are kept
        const by = new Map(cur[i].rates.map((x) => [x.from, x])); r.rates.forEach((x) => by.set(x.from, x));
        const m = norm(Object.assign({}, r, { rates: [...by.values()] }));
        if (JSON.stringify(cur[i]) !== JSON.stringify(m)) { cur[i] = m; updated++; }
      }
    });
    if (added || updated) save(cur, 'upsert');
    return { added, updated };
  }

  /* ------------------------------------------------------------ assignments text: "PIPE-FT 120, WELD-CS 40 @90" */
  function parseAssign(text) {
    const out = [], bad = [];
    String(text || '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).forEach((part) => {
      const m = /^(\S+?)(?:\s*[:=x×]?\s*([\d.,]+)\s*(?:h|hr|hrs|u)?)?(?:\s*@\s*\$?([\d.,]+))?$/i.exec(part);
      if (!m) { bad.push(part); return; }
      const a = { r: m[1], qty: m[2] === undefined ? 0 : num(m[2]) };
      if (m[3] !== undefined) a.rate = num(m[3]);
      out.push(a);
    });
    return { list: out, bad };
  }
  const fmtNum = (v) => { const n = round(v, 2); return Number.isInteger(n) ? String(n) : String(n); };
  function fmtAssign(asg) { return (asg || []).map((a) => `${a.r} ${fmtNum(a.qty)}${a.rate !== undefined && a.rate !== null && a.rate !== '' ? ' @' + fmtNum(a.rate) : ''}`).join(', '); }

  /* ------------------------------------------------------------ CSV / Excel */
  const HEAD = ['Resource ID', 'Name', 'Type', 'Unit', 'Base rate', 'Burden %', 'All-in rate', 'Effective from', 'OT factor', 'Max units a day', 'Discipline / craft', 'Notes'];
  function toCsv(items) {
    const q = (v) => { const s = String(v === undefined || v === null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = [HEAD];
    (items || list()).forEach((r) => r.rates.forEach((x) => rows.push([r.code, r.name, r.type, r.uom, x.base, x.burden, allIn(x), x.from, r.ot, r.max, r.disc, r.notes])));
    return '\ufeff' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
  }
  /* Headings are matched by name (rule-based). One row a rate: several rows with
     the same Resource ID and different Effective from dates make its rate history. */
  const MATCH = [
    ['code', /^(resource\s*(id|code)|code|id|rsrc\s*id|resource)$/i], ['name', /^(name|resource\s*name|description|craft|trade)$/i],
    ['type', /^(type|resource\s*type|category|class)$/i], ['uom', /^(unit|uom|unit of measure|units)$/i],
    ['base', /^(base(\s*rate)?|rate|price|price\s*\/?\s*unit|\$\s*\/\s*h(ou)?r|hourly\s*rate|cost\s*per\s*(unit|hour)|wage|base\s*\$\s*\/\s*hr)$/i],
    ['burden', /^(burden|burden\s*%|burden\s*pct|markup|markup\s*%|fringe\s*%)$/i], ['allin', /^(all[\s-]*in(\s*rate)?|all[\s-]*in\s*\$\s*\/\s*hr|loaded\s*rate|billing\s*rate)$/i],
    ['from', /^(effective(\s*from)?|from|start|effective\s*date|rate\s*from)$/i], ['ot', /^(ot|ot\s*factor|overtime(\s*factor)?)$/i],
    ['max', /^(max(\s*units)?(\s*(a|per)\s*day)?|max\s*\/\s*day|availability)$/i], ['disc', /^(discipline|discipline\s*\/\s*craft|craft\s*group|trade\s*group)$/i], ['notes', /^(notes?|comments?|remarks?)$/i],
  ];
  function fromGrid(grid) {
    const rows = (grid || []).filter((r) => r && r.some((c) => String(c === undefined || c === null ? '' : c).trim() !== ''));
    if (!rows.length) return { items: [], bad: ['The file is empty.'] };
    const hi = rows.findIndex((r) => r.some((c) => MATCH[0][1].test(String(c || '').trim())));
    if (hi < 0) return { items: [], bad: ['No "Resource ID" (or "Code") column was found in the first rows.'] };
    const head = rows[hi].map((c) => String(c || '').trim());
    const col = {}; MATCH.forEach(([k, re]) => { const i = head.findIndex((h) => re.test(h)); if (i >= 0 && col[k] === undefined) col[k] = i; });
    if (col.name === undefined && col.code !== undefined) col.name = col.code;
    const by = new Map(), bad = [];
    const toIso = (v) => { if (v === undefined || v === null || v === '') return ''; if (/^\d{5}(\.\d+)?$/.test(String(v).trim()) && +v > 20000 && +v < 80000) { const d = new Date(Math.round((+v - 25569) * 86400000)); return d.toISOString().slice(0, 10); } const s = String(v).trim(); if (isoOk(s.slice(0, 10))) return s.slice(0, 10); const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : ''; };
    rows.slice(hi + 1).forEach((r, i) => {
      const g = (k) => (col[k] === undefined ? '' : r[col[k]]);
      const code = String(g('code') || '').trim(); if (!code) return;
      let base = num(g('base'), NaN), burden = num(g('burden'), 0);
      if (burden > 0 && burden < 1 && String(g('burden')).indexOf('%') < 0) burden = burden * 100; // 0.27 meant 27 %
      if (!isFinite(base)) { const ai = num(g('allin'), NaN); if (isFinite(ai)) { base = ai / (1 + burden / 100); } else { bad.push(`Row ${hi + i + 2}: ${code} has no rate.`); base = 0; } }
      const x = { from: toIso(g('from')), base, burden };
      const cur = by.get(code.toLowerCase());
      if (cur) cur.rates.push(x);
      else by.set(code.toLowerCase(), { code, name: g('name') || code, type: g('type'), uom: g('uom'), rates: [x], ot: g('ot') === '' ? undefined : g('ot'), max: g('max'), disc: g('disc'), notes: g('notes') });
    });
    return { items: [...by.values()].map(norm), bad };
  }
  function loadSheetIO() {
    if (global.VRSheetIO) return Promise.resolve(global.VRSheetIO);
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = DIR + 'sheetio.js'; s.onload = () => ok(global.VRSheetIO); s.onerror = () => no(new Error('The Excel reader could not be loaded.')); document.head.appendChild(s); });
  }
  /* P6 / Microsoft Project resources in table form (RSRC and RSRCRATE, as
     xerParser.parseXER and xmlimport.parseScheduleXML return them) -> library
     resources: every resource in the file, its rates by effective date (the
     earliest opens the history), the overtime factor, the limit (units an hour x
     hours a day) and the title / group as the discipline. */
  function fromTables(tables, hpd, label) {
    const rows = (n) => ((tables && tables[n] && tables[n].rows) || []);
    hpd = +hpd || 8;
    const iso = (v) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : ''; };
    const rates = new Map();
    rows('RSRCRATE').forEach((x) => { const k = String(x.rsrc_id); if (!rates.has(k)) rates.set(k, []); rates.get(k).push(x); });
    const seen = new Set(), out = [];
    const note = label ? `From ${label}` : '';
    rows('RSRC').forEach((src) => {
      const code = String(src.rsrc_short_name || src.rsrc_id || '').trim().replace(/[\s,;@]+/g, '-');
      if (!code || seen.has(code.toLowerCase())) return;
      seen.add(code.toLowerCase());
      const type = FROM_P6[src.rsrc_type] || 'Labor';
      const by = new Map();
      (rates.get(String(src.rsrc_id)) || []).map((x) => ({ from: iso(x.start_date), base: num(x.cost_per_qty), max: x.max_qty_per_hr }))
        .sort((a, b) => a.from.localeCompare(b.from)).forEach((x) => by.set(x.from, x));
      const list = [...by.values()];
      if (list.length) list[0] = Object.assign({}, list[0], { from: '' });
      const last = list[list.length - 1];
      const max = last && last.max !== '' && last.max !== undefined && isFinite(+last.max) ? round(+last.max * hpd, 2) : '';
      out.push(norm({ code, name: src.rsrc_name || code, type, uom: type === 'Material' ? (String(src.unit_abbrev || '').trim() || 'ea') : 'hr',
        rates: list.length ? list.map((x) => ({ from: x.from, base: x.base, burden: 0 })) : [{ from: '', base: 0, burden: 0 }],
        ot: num(src.ot_factor) || (/^Labou?r$/.test(type) ? 1.5 : 1), max, disc: src.rsrc_title_name || '', notes: note }));
    });
    return out;
  }
  /* Read a schedule file (.xer, P6 XML or Microsoft Project XML) for its resources.
     The parsers are the Schedule module's; opts.loadXml() loads the XML one when needed. */
  async function readScheduleFile(file, opts) {
    const NS = global.VissRadXER || {};
    const text = await file.text();
    let tables;
    if (/\.xer$/i.test(file.name)) {
      if (!NS.parseXER) throw new Error('XER files can be read in the Schedule module.');
      tables = NS.parseXER(text).tables;
    } else {
      if (!NS.parseScheduleXML && opts && opts.loadXml) await opts.loadXml();
      if (!(global.VissRadXER || {}).parseScheduleXML) throw new Error('XML schedules can be read in the Schedule module.');
      tables = global.VissRadXER.parseScheduleXML(text).tables;
    }
    const cal = (tables.CALENDAR && tables.CALENDAR.rows) || [];
    const hpd = num((cal.find((c) => c.default_flag === 'Y') || cal[0] || {}).day_hr_cnt, 8) || 8;
    const items = fromTables(tables, hpd, file.name);
    return { items, bad: items.length ? [] : [`${file.name} carries no resources.`] };
  }

  async function readFile(file) {
    const io = await loadSheetIO();
    const sheets = await io.readGrids(file);
    for (const s of sheets) { const r = fromGrid(s.grid); if (r.items.length) return r; }
    return fromGrid((sheets[0] || {}).grid);
  }
  function download(name, text, mime) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/csv' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ------------------------------------------------------------ the library table */
  /* opts: { E, modal, closeModal, toast, canEdit(), usage() -> Map(code -> {n, qty, cost}),
            ownBar (draw its own toolbar), onUse(code) } */
  function create(pane, opts) {
    const E = opts.E || (typeof el !== "undefined" ? el : null);
    const toast = opts.toast || global.toast || ((m) => console.log(m));
    const canEdit = opts.canEdit || (() => true);
    let Q = '', TY = '', NEXT = null;
    const money = (v) => (v || v === 0 ? '$' + (+v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
    function guard() { if (!canEdit()) { toast('Read-only access: you cannot change the resource library.', true); return false; } return true; }
    function edit(fn) { if (!guard()) return; const cur = list().map((r) => JSON.parse(JSON.stringify(r))); if (fn(cur) === false) return; save(cur, 'edit'); }
    function nextCode(cur) { let n = cur.length + 1; while (cur.some((r) => r.code.toLowerCase() === ('RES-' + String(n).padStart(3, '0')).toLowerCase())) n++; return 'RES-' + String(n).padStart(3, '0'); }
    function add() { let code = ''; edit((cur) => { code = nextCode(cur); cur.push(norm({ code, name: 'New resource', type: 'Labor', uom: 'hr', rates: [{ from: '', base: 0, burden: 0 }] })); }); NEXT = { code, f: 'name' }; Q = ''; render(); }
    function dup(r) { let code = ''; edit((cur) => { code = r.code + '-2'; let n = 2; while (cur.some((x) => x.code.toLowerCase() === code.toLowerCase())) code = r.code + '-' + (++n); cur.push(Object.assign(JSON.parse(JSON.stringify(r)), { code })); }); NEXT = { code, f: 'name' }; render(); }
    function del(r) {
      const u = opts.usage && opts.usage().get(r.code);
      const go = () => { edit((cur) => { const i = cur.findIndex((x) => x.code === r.code); if (i >= 0) cur.splice(i, 1); }); toast(`${r.code} deleted from the resource library.${u && u.n ? ' Schedules that use it keep their copy of its rates.' : ''} Undo restores it.`); render(); };
      if (u && u.n && opts.modal) opts.modal({ title: 'Delete resource', sub: `${r.code} ${r.name} is assigned to ${u.n} activit${u.n === 1 ? 'y' : 'ies'} in this schedule.`, body: E('div', { text: 'The schedule keeps its own copy of the rates, so its costs do not change. It will no longer follow rate changes made here.' }), buttons: [{ label: 'Cancel', onClick: opts.closeModal }, { label: 'Delete', primary: true, onClick: () => { opts.closeModal(); go(); } }] });
      else go();
    }
    function setField(r, f, v) {
      if (f === 'code') {
        v = String(v || '').trim();
        if (!v) { toast('A resource ID cannot be blank.', true); render(); return; }
        if (/[\s,;@]/.test(v)) { toast('A resource ID cannot hold spaces, commas, semicolons or @.', true); render(); return; }
        if (list().some((x) => x !== r && x.code.toLowerCase() === v.toLowerCase())) { toast(`${v} is already in the library.`, true); render(); return; }
        if (opts.usage && (opts.usage().get(r.code) || {}).n) toast(`${r.code} is renamed ${v} here; the schedule keeps ${r.code} until its assignments are changed.`);
      }
      edit((cur) => {
        const x = cur.find((y) => y.code === r.code); if (!x) return false;
        const cr = x.rates[x.rates.length - 1];
        if (f === 'base' || f === 'burden') cr[f] = num(v); else if (f === 'from') cr.from = isoOk(v) ? v : ''; else if (f === 'ot' || f === 'max') x[f] = v === '' ? '' : num(v); else x[f] = v;
      });
    }
    function ratesDialog(r) {
      if (!opts.modal) return;
      const body = E('div', { class: 'vrr-rates' });
      const rows = r.rates.map((x) => ({ from: x.from, base: x.base, burden: x.burden }));
      const draw = () => {
        body.textContent = '';
        body.append(E('div', { class: 'hint', style: 'margin-bottom:8px', text: 'The rate used for an activity is the one in force on its start date: the latest whose Effective from is on or before it. Leave Effective from blank for the opening rate.' }));
        const t = E('table', { class: 'vrr-table' }, E('thead', {}, E('tr', {}, ...['Effective from', 'Base rate', 'Burden %', 'All-in rate', ''].map((h) => E('th', { text: h })))));
        const tb = E('tbody');
        rows.forEach((x, i) => {
          const d = E('input', { type: 'date', value: x.from || '' }); d.addEventListener('change', () => { x.from = d.value; draw(); });
          const b = E('input', { type: 'number', step: 'any', value: x.base, style: 'width:100px' }); b.addEventListener('change', () => { x.base = num(b.value); draw(); });
          const u = E('input', { type: 'number', step: 'any', value: x.burden, style: 'width:80px' }); u.addEventListener('change', () => { x.burden = num(u.value); draw(); });
          tb.append(E('tr', {}, E('td', {}, d), E('td', {}, b), E('td', {}, u), E('td', { class: 'c', text: money(allIn(x)) + ' / ' + r.uom }),
            E('td', {}, rows.length > 1 ? E('button', { class: 'ghost', onclick: () => { rows.splice(i, 1); draw(); } }, 'Remove') : null)));
        });
        t.append(tb); body.append(t, E('button', { class: 'ghost', style: 'margin-top:8px', onclick: () => { const last = rows[rows.length - 1] || { base: 0, burden: 0 }; rows.push({ from: todayIso(), base: last.base, burden: last.burden }); draw(); } }, '+ Rate from a date'));
      };
      draw();
      opts.modal({ title: `Rates: ${r.code} ${r.name}`, sub: `Rates per ${r.uom}. Each change of rate gets its own row.`, width: 640, body,
        buttons: [{ label: 'Cancel', onClick: opts.closeModal }, { label: 'Apply', primary: true, onClick: () => { const froms = rows.map((x) => x.from || ''); if (new Set(froms).size !== froms.length) { toast('Two rates have the same Effective from date.', true); return; } edit((cur) => { const x = cur.find((y) => y.code === r.code); if (x) x.rates = rows.map((y) => ({ from: y.from || '', base: y.base, burden: y.burden })); }); opts.closeModal(); render(); } }] });
    }
    function importDialog() {
      if (!guard()) return;
      const sched = !!(global.VissRadXER && global.VissRadXER.parseXER);
      const inp = E('input', { type: 'file', accept: '.xlsx,.xlsm,.csv,.tsv,.txt' + (sched ? ',.xer,.xml' : ''), style: 'display:none' });
      inp.addEventListener('change', async () => {
        const f = inp.files && inp.files[0]; if (!f) return;
        let r; try { r = /\.(xer|xml)$/i.test(f.name) ? await readScheduleFile(f, opts) : await readFile(f); } catch (e) { toast(e.message || `Could not read ${f.name}.`, true); return; }
        if (!r.items.length) { toast(r.bad[0] || 'No resources were found in the file.', true); return; }
        const ex = r.items.filter((x) => find(x.code)).length;
        const mode = E('select', {}, E('option', { value: 'update' }, 'Update them from the file'), E('option', { value: 'add' }, 'Keep the library\u2019s'));
        opts.modal({ title: 'Import resources and rates', sub: `${f.name}: ${r.items.length} resource${r.items.length === 1 ? '' : 's'}${ex ? `, ${ex} already in the library` : ''}.`, width: 640,
          body: E('div', { class: 'sed-form' },
            E('div', { class: 'hint', text: /\.(xer|xml)$/i.test(f.name)
              ? 'Every resource in the schedule file with its rates by effective date, overtime factor and limit (P6 RSRC and RSRCRATE; Microsoft Project cost rate table A). Rates from other dates already in the library are kept.'
              : 'Columns are matched by their headings (rule-based, not AI): Resource ID, Name, Type, Unit, Base rate (or All-in rate), Burden %, Effective from, OT factor, Max units a day, Discipline / craft, Notes. Several rows with the same Resource ID and different Effective from dates make its rate history; rates from other dates already in the library are kept.' }),
            ex ? E('label', { class: 'sed-field' }, E('span', { text: 'Resources already in the library' }), mode) : null,
            r.bad.length ? E('div', { class: 'hint', style: 'color:var(--accent)', text: r.bad.slice(0, 5).join(' ') + (r.bad.length > 5 ? ` and ${r.bad.length - 5} more.` : '') }) : null,
            E('div', { class: 'hint', text: r.items.slice(0, 8).map((x) => `${x.code} ${money(rateOn(x))}/${x.uom}`).join(' \u00b7 ') + (r.items.length > 8 ? ' \u2026' : '') })),
          buttons: [{ label: 'Cancel', onClick: opts.closeModal }, { label: 'Import', primary: true, onClick: () => { const res = upsert(r.items, ex ? mode.value : 'update'); opts.closeModal(); toast(`${res.added} resource${res.added === 1 ? '' : 's'} added, ${res.updated} updated. Undo takes it back.`); render(); } }] });
      });
      document.body.appendChild(inp); inp.click(); setTimeout(() => inp.remove(), 60000);
    }
    function exportCsv() { download('resources-and-rates.csv', toCsv(), 'text/csv'); }
    function example() { if (!guard()) return; const r = upsert(EXAMPLE, 'add'); toast(r.added ? `${r.added} synthetic example resources added. Replace their rates with your own.` : 'The example resources are already in the library.'); render(); }
    function doUndo() { if (!guard()) return; if (undo()) { toast('Last resource library change undone.'); render(); } else toast('Nothing to undo in the resource library.'); }

    function toolbar(B) {
      const sep = () => E('span', { class: 'sed-sep' });
      return [
        B('+ Resource', add, 'primary', 'Add a resource to the library'),
        B(['Import\u2026', 'Import\u2026'], importDialog, null, global.VissRadXER && global.VissRadXER.parseXER ? 'Add or update resources and rates from an Excel or CSV list, a P6 XER, or a P6 or Microsoft Project XML file' : 'Add or update resources and rates from an Excel or CSV list'),
        B(['Export CSV', 'CSV'], exportCsv, null, 'Download the library as CSV (one row a rate)'),
        B(['Add example rates', 'Examples'], example, null, 'Add the synthetic example resources (clearly labelled; replace their rates with your own)'),
        B('\u21b6', doUndo, 'ghost sed-ico', 'Undo the last resource library change'),
        sep(),
      ];
    }
    function render() {
      const u = opts.usage ? opts.usage() : new Map();
      const top = pane.scrollTop; pane.textContent = '';
      const all = list();
      const q = Q.trim().toLowerCase();
      const shown = all.filter((r) => (!TY || r.type === TY) && (!q || (r.code + ' ' + r.name + ' ' + r.disc).toLowerCase().indexOf(q) >= 0));
      const edit = canEdit();
      if (opts.ownBar) {
        const B = (label, fn, cls, title) => E('button', { class: cls || 'ghost', onclick: fn, title: title || (Array.isArray(label) ? label[0] : null) }, Array.isArray(label) ? label[0] : label);
        pane.append(E('div', { class: 'toolbar vrr-bar' }, ...toolbar(B)));
      }
      const search = E('input', { type: 'search', class: 'vrr-q', placeholder: 'Find a resource: ID, name or discipline', value: Q, 'aria-label': 'Find a resource' });
      search.addEventListener('input', () => { Q = search.value; render(); const s = pane.querySelector('.vrr-q'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } });
      const ty = E('select', { 'aria-label': 'Resource type' }, E('option', { value: '' }, 'All types'), ...TYPES.map((t) => E('option', { value: t, selected: t === TY ? true : null }, t)));
      ty.addEventListener('change', () => { TY = ty.value; render(); });
      const usedN = all.filter((r) => (u.get(r.code) || {}).n).length;
      pane.append(E('div', { class: 'vrr-hint hint' },
        E('span', { text: `${all.length} resource${all.length === 1 ? '' : 's'} in the ${global.VR_STANDALONE ? 'VRScheduler' : 'VissRad'} resource library${opts.usage ? ` \u00b7 ${usedN} used in this schedule` : ''}. ${global.VR_STANDALONE ? 'Kept in this browser.' : 'Shared by every VissRad module in this ' + (global.VRUSER && global.VRUSER.mode === 'user' ? 'project' : 'demo') + '.'} All-in rate = base \u00d7 (1 + burden %). A rate change applies to activities that start on or after its date.${all.some((r) => r.notes === 'Synthetic example rate') ? ' Rates noted as synthetic examples are not market data.' : ''}` }),
        E('span', { class: 'vrr-find' }, search, ty)));
      if (!all.length) {
        pane.append(E('div', { class: 'vrr-empty' }, E('p', { text: 'No resources yet. Add them one by one, import an Excel or CSV list, or start from the synthetic example rates.' }),
          E('div', { style: 'display:flex;gap:8px;justify-content:center' }, E('button', { class: 'primary', onclick: add }, '+ Resource'), E('button', { class: 'ghost', onclick: importDialog }, 'Import\u2026'), E('button', { class: 'ghost', onclick: example }, 'Add example rates'))));
        return;
      }
      const cols = ['Resource ID', 'Name', 'Type', 'Unit', 'Base rate', 'Burden %', 'All-in rate', 'Effective from', 'OT factor', 'Max / day', 'Discipline'].concat(opts.usage ? ['Used in schedule'] : []).concat(['']);
      const t = E('table', { class: 'sed-table vrr-table' }, E('thead', {}, E('tr', {}, ...cols.map((h) => E('th', { text: h })))));
      const tb = E('tbody');
      shown.forEach((r) => {
        const cr = r.rates[r.rates.length - 1];
        const inp = (f, v, attrs) => { const x = E('input', Object.assign({ value: v === undefined || v === null ? '' : v, 'data-f': f, disabled: edit ? null : true }, attrs || {})); x.addEventListener('change', () => setField(r, f, x.type === 'number' ? x.value : x.value.trim())); x.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); x.blur(); } }); return x; };
        const sel = (f, v, options) => { const s = E('select', { 'data-f': f, disabled: edit ? null : true }, ...options.map((o) => E('option', { value: o, selected: o === v ? true : null }, o))); s.addEventListener('change', () => setField(r, f, s.value)); return s; };
        const uomIn = inp('uom', r.uom, { type: 'text', list: 'vrr-uoms', style: 'width:52px' });
        const us = u.get(r.code);
        tb.append(E('tr', { 'data-code': r.code },
          E('td', {}, inp('code', r.code, { type: 'text', style: 'width:84px', class: 'vrr-code' })),
          E('td', {}, inp('name', r.name, { type: 'text', style: 'width:170px' })),
          E('td', {}, sel('type', r.type, TYPES)),
          E('td', {}, uomIn),
          E('td', {}, inp('base', cr.base, { type: 'number', step: 'any', style: 'width:76px' })),
          E('td', {}, inp('burden', cr.burden, { type: 'number', step: 'any', style: 'width:64px' })),
          E('td', { class: 'c', 'data-k': 'allin', text: money(allIn(cr)) }),
          E('td', { class: 'c' }, E('button', { class: 'ghost vrr-hist', title: 'Rate history: add a rate from a date', disabled: edit ? null : true, onclick: () => ratesDialog(r) }, `${cr.from || 'Opening'}${r.rates.length > 1 ? ` (+${r.rates.length - 1})` : ''}`)),
          E('td', {}, inp('ot', r.ot, { type: 'number', step: 'any', style: 'width:56px' })),
          E('td', {}, inp('max', r.max, { type: 'number', step: 'any', style: 'width:60px', placeholder: '\u2014' })),
          E('td', {}, inp('disc', r.disc, { type: 'text', style: 'width:96px' })),
          opts.usage ? E('td', { class: 'c vrr-used', 'data-k': 'used', text: us && us.n ? `${us.n} act. \u00b7 ${fmtNum(us.qty)} ${r.uom} \u00b7 ${money(us.cost)}` : '', title: us && us.n ? `${us.n} activities, ${fmtNum(us.qty)} ${r.uom}, ${money(us.cost)}` : null }) : null,
          E('td', { class: 'vrr-acts' },
            E('button', { class: 'ghost', title: 'Duplicate', 'aria-label': 'Duplicate ' + r.code, onclick: () => dup(r), disabled: edit ? null : true }, '\u2398'),
            E('button', { class: 'ghost', title: 'Delete', 'aria-label': 'Delete ' + r.code, onclick: () => del(r), disabled: edit ? null : true }, '\u00d7'))));
      });
      t.append(tb);
      pane.append(t, E('datalist', { id: 'vrr-uoms' }, ...UOMS.map((x) => E('option', { value: x }))));
      if (!shown.length) pane.append(E('div', { class: 'vrr-empty', text: 'No resource matches the search.' }));
      pane.scrollTop = top;
      if (NEXT) { const n = NEXT; NEXT = null; const x = pane.querySelector(`tr[data-code="${CSS.escape(n.code)}"] [data-f="${n.f}"]`); if (x) { x.focus(); x.select && x.select(); x.scrollIntoView && x.scrollIntoView({ block: 'nearest' }); } }
    }
    return { render, toolbar, add, importDialog, exportCsv, example, undo: doUndo };
  }

  /* The library in a dialog, for modules without a place of their own for it. */
  function manage(opts) {
    opts = opts || {};
    const E = opts.E || (typeof el !== "undefined" ? el : null), modal = opts.modal || global.modal, closeModal = opts.closeModal || global.closeModal;
    const pane = E('div', { class: 'vrr-pane vrr-modal' });
    const ctl = create(pane, Object.assign({ E, modal: (m) => { closeModal(); modal(m); }, closeModal: () => { closeModal(); reopen(); }, ownBar: true }, opts));
    const reopen = () => { modal({ title: 'Resources and rates', sub: opts.sub || (global.VR_STANDALONE ? 'The VRScheduler resource library, kept in this browser.' : 'The VissRad resource library, shared by every module.'), width: 1180, body: pane, buttons: [{ label: 'Close', primary: true, onClick: () => { closeModal(); if (opts.onClose) opts.onClose(); } }] }); ctl.render(); };
    reopen();
    const on = () => { if (pane.isConnected) ctl.render(); else document.removeEventListener('vissrad:resources', on); };
    document.addEventListener('vissrad:resources', on);
    return ctl;
  }

  /* Assign resources to one activity: [{ r, qty, rate? }] in, the edited list to done(). */
  function assignDialog(o) {
    const E = o.E || (typeof el !== "undefined" ? el : null), modal = o.modal || global.modal, closeModal = o.closeModal || global.closeModal, toast = o.toast || global.toast;
    const rows = (o.current || []).map((a) => Object.assign({}, a));
    const known = (code) => find(code) || (o.snapshot && o.snapshot(code)) || null;
    const body = E('div', { class: 'vrr-assign' });
    const money = (v) => '$' + (+v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const draw = () => {
      body.textContent = '';
      const t = E('table', { class: 'vrr-table' }, E('thead', {}, E('tr', {}, ...['Resource', 'Budgeted units', 'Rate', 'Cost', ''].map((h) => E('th', { text: h })))));
      const tb = E('tbody'); let tot = 0, hrs = 0;
      rows.forEach((a, i) => {
        const r = known(a.r);
        const s = E('select', { style: 'max-width:280px' }, ...(r ? [] : [E('option', { value: a.r, selected: true }, a.r + ' (not in the library)')]), ...list().map((x) => E('option', { value: x.code, selected: x.code === (r && r.code) ? true : null }, `${x.code} \u2014 ${x.name} (${money(rateOn(x, o.date))}/${x.uom})`)));
        s.addEventListener('change', () => { a.r = s.value; draw(); });
        const q = E('input', { type: 'number', step: 'any', min: 0, value: a.qty, style: 'width:90px' }); q.addEventListener('change', () => { a.qty = num(q.value); draw(); });
        const lr = r ? rateOn(r, o.date) : 0;
        const rt = E('input', { type: 'number', step: 'any', value: a.rate === undefined || a.rate === null ? '' : a.rate, placeholder: String(lr), style: 'width:90px', title: 'Blank: the library rate in force on the activity start. Type a rate to override it for this activity.' });
        rt.addEventListener('change', () => { if (rt.value === '') delete a.rate; else a.rate = num(rt.value); draw(); });
        const rate = a.rate === undefined || a.rate === null ? lr : a.rate, cost = (+a.qty || 0) * rate; tot += cost; if (r && /^Labou?r$/.test(r.type) && isTimeUnit(r.uom)) hrs += +a.qty || 0;
        const fill = o.hours ? E('button', { class: 'ghost', title: `Units = duration \u00d7 hours a day (${o.hours} h)`, onclick: () => { a.qty = o.hours; draw(); } }, '= duration') : null;
        tb.append(E('tr', {}, E('td', {}, s), E('td', {}, q, ' ', r ? r.uom : ''), E('td', {}, rt), E('td', { class: 'c', text: money(cost) }), E('td', {}, fill, E('button', { class: 'ghost', onclick: () => { rows.splice(i, 1); draw(); } }, 'Remove'))));
      });
      t.append(tb);
      body.append(t,
        E('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:8px' },
          E('button', { class: 'ghost', disabled: list().length ? null : true, onclick: () => { const used = new Set(rows.map((x) => x.r)); const r = list().find((x) => !used.has(x.code)) || list()[0]; if (r) { rows.push({ r: r.code, qty: o.hours && /^Labou?r$/.test(r.type) ? o.hours : 0 }); draw(); } } }, '+ Resource'),
          E('span', { class: 'hint', text: `Total ${money(tot)}${hrs ? ` \u00b7 ${fmtNum(hrs)} labor hours` : ''}. Rates are in force on ${o.date || 'today'}.` })),
        ...(list().length ? [] : [E('div', { class: 'hint', style: 'margin-top:6px', text: 'The resource library is empty: add resources on the Resources tab first.' })]));
    };
    draw();
    modal({ title: o.title || 'Assign resources', sub: o.sub || '', width: 860, body,
      buttons: [{ label: 'Cancel', onClick: closeModal }, { label: 'Apply', primary: true, onClick: () => { const bad = rows.filter((a) => !known(a.r)); if (bad.length) { toast(`${bad[0].r} is not in the resource library.`, true); return; } closeModal(); o.done(rows.filter((a) => a.r).map((a) => { const x = { r: known(a.r).code, qty: round(a.qty, 3) }; if (a.rate !== undefined && a.rate !== null && a.rate !== '') x.rate = round(a.rate, 4); return x; })); } }] });
  }

  global.VissRadResources = { KEY, TYPES, P6TYPE, FROM_P6, UOMS, EXAMPLE, norm, list, find, save, upsert, undo, rateOn, rateEntry, allIn, isTimeUnit, parseAssign, fmtAssign, toCsv, fromGrid, readFile, fromTables, readScheduleFile, create, manage, assignDialog, reload: () => { CACHE = null; } };
})(window);
