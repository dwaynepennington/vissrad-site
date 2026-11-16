/* ==========================================================================
   VREST — Bid Desk (window.BidDesk). Loaded when the tab first opens.

   Rule-based bid preparation, all in the browser:
     Bid set      drawing sets and spec books (PDF) read with pdf.js; sheet
                  numbers and titles from the title block, spec sections by
                  MasterFormat number.
     Go / no-go   a weighted bid decision score with the scope notes found.
     Quantities   counts from the drawing text (tags, member sizes; steel
                  tonnage from W-shape weight per foot) and symbol counts by
                  matching a symbol picked on the sheet. Every hit can be
                  reviewed on the sheet and rejected before it is posted as a
                  takeoff line that records the sheets and pages.
     Scope sheets spec sections, drawing sheets and drawing callouts for each
                  trade, exported to Excel for bidders.
     Checks       references to sheets not in the set, spec sections cited on
                  drawings but not in the book, disciplines with drawings and
                  no specification (and the reverse), duplicate sheet numbers,
                  and scope notes (exclusions, allowances, alternates, permit
                  triggers, commercial terms). A finding raises a prefilled
                  RFI in VRRFI.
   Files are kept in this browser (IndexedDB) so the set reopens; nothing is
   uploaded. No AI is used: every result comes from rules that can be read
   in this file.
   ========================================================================== */
'use strict';
(function () {
  const BD_KEY = `vissrad.estimating.biddesk.v1${window.EST_ID && window.EST_ID !== 'base' ? `@${window.EST_ID}` : ''}`;
  const BDS = makeStore(BD_KEY);
  const DEMO_SET = ['biddesk-demo/VR-DEMO-BID-001_drawings.pdf', 'biddesk-demo/VR-DEMO-BID-001_specs.pdf'];
  const blank = () => ({ docs: [], gng: { scores: {}, note: '' }, groups: [], dismissed: [], seq: 0 });
  let BD = (() => { try { return Object.assign(blank(), JSON.parse(BDS.get(BD_KEY)) || {}); } catch (e) { return blank(); } })();
  const save = () => { try { BDS.set(BD_KEY, JSON.stringify(BD)); } catch (e) { toast('Browser storage is full; the Bid Desk index could not be saved.', true); } };
  let SUB = 'set';
  let ROOT = null;
  const PAGES = new Map();   // doc id -> pages [[str, x, y, w, h], ...] (top-down PDF points)
  const r1 = (v) => Math.round(v * 10) / 10;
  const isUser = () => !!(window.VRUSER && VRUSER.user);

  /* ------------------------------------------------------------ storage (IndexedDB) */
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = window[['indexed', 'DB'].join('')].open('vissrad-biddesk', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('docs', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error || new Error('This browser cannot keep files')); };
    });
    return dbp;
  }
  function idb(mode, fn) {
    return db().then((d) => new Promise((res, rej) => {
      const t = d.transaction('docs', mode); const q = fn(t.objectStore('docs'));
      t.oncomplete = () => res(q && 'result' in q ? q.result : undefined);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Storage refused the file (quota)'));
    }));
  }
  async function pagesOf(id) {
    if (PAGES.has(id)) return PAGES.get(id);
    const r = await idb('readonly', (s) => s.get(id));
    if (!r) throw new Error('The file is no longer kept in this browser. Remove it and add it again.');
    PAGES.set(id, r.pages);
    return r.pages;
  }
  async function bytesOf(id) {
    const r = await idb('readonly', (s) => s.get(id));
    if (!r) throw new Error('The file is no longer kept in this browser.');
    return r.bytes;
  }

  /* ------------------------------------------------------------ reading PDFs */
  function lines(items) {
    const s = items.slice().sort((a, b) => a[2] - b[2] || a[1] - b[1]);
    const out = [];
    for (const it of s) {
      const L = out[out.length - 1];
      if (L && Math.abs(L.y - it[2]) <= Math.max(2, it[4] * 0.45)) { L.parts.push(it); } else out.push({ y: it[2], parts: [it] });
    }
    return out.map((L) => { L.parts.sort((a, b) => a[1] - b[1]); return { y: L.y, x: L.parts[0][1], text: L.parts.map((p) => p[0]).join(' ').replace(/\s+/g, ' ').trim() }; });
  }
  const SHEET_RE = /^([A-Z]{1,3}-?\d{1,3}(?:\.\d{1,3})?[A-Z]?)$/;
  const DENG_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+)*-[A-Z]{2,4}-[A-Z]{2,4}-\d{3,5}$/;
  const DISC = { G: 'General', C: 'Civil', L: 'Landscape', S: 'Structural', A: 'Architectural', I: 'Interiors', Q: 'Equipment', F: 'Fire protection', P: 'Plumbing', D: 'Process', M: 'Mechanical', E: 'Electrical', T: 'Telecom', Y: 'Instrumentation', J: 'Instrumentation',
    CSA: 'Structural', CIV: 'Civil', STR: 'Structural', PIP: 'Piping', PRO: 'Process', ICS: 'Instrumentation', INS: 'Instrumentation', ELE: 'Electrical', MEC: 'Mechanical', ARC: 'Architectural', HVA: 'Mechanical', FPR: 'Fire protection' };
  function discOf(no) {
    if (DENG_RE.test(no)) { const p = no.split('-'); return DISC[p[p.length - 3]] || 'Other'; }
    const m = /^([A-Z]{1,3})/.exec(no); if (!m) return 'Other';
    return DISC[m[1]] || DISC[m[1][0]] || 'Other';
  }
  const normSheet = (s) => String(s || '').toUpperCase().replace(/[\s.\-]/g, '');
  function sheetOf(items, w, h, page) {
    let best = null;
    for (const it of items) {
      const t = it[0].trim();
      if (!(SHEET_RE.test(t) || DENG_RE.test(t))) continue;
      if (/^\d/.test(t)) continue;
      const sc = it[4] * 2 + (it[1] / w + it[2] / h) * 20;
      if (!best || sc > best.sc) best = { sc, it };
    }
    const no = best ? best.it[0].trim() : `p${page}`;
    const skip = /SYNTHETIC|NOT FOR CONSTRUCTION|^REV\b|ISSUED|PROJECT|^SHEET|^DATE|^SCALE|DRAWN|CHECKED|APPROVED|^NO\.?$/i;
    let title = '', th = 0;
    for (const it of items) {
      if (it[1] < w * 0.55 || it[2] < h * 0.7) continue;
      const t = it[0].trim();
      if (t === no || skip.test(t) || !/[A-Z]{3}/i.test(t) || t.length < 4) continue;
      if (it[4] > th + 0.5 || (Math.abs(it[4] - th) <= 0.5 && t.length > title.length)) { title = t; th = it[4]; }
    }
    return { page, no, title, disc: best ? discOf(no) : 'Other' };
  }
  const SEC_RE = /^SECTION\s+(\d{2})\s?(\d{2})\s?(\d{2})(?:\.\d{1,2})?\s*[-–—:]?\s*(.*)$/i;
  function sectionsOf(pages) {
    const out = [];
    pages.forEach((items, i) => {
      const L = lines(items);
      L.forEach((ln, j) => {
        const m = SEC_RE.exec(ln.text);
        if (!m) return;
        const no = `${m[1]} ${m[2]} ${m[3]}`;
        if (out.some((s) => s.no === no)) return;
        const title = (m[4] || (L[j + 1] ? L[j + 1].text : '')).replace(/\s+\d+$/, '').trim();
        out.push({ no, div: m[1], title, page: i + 1, end: i + 1 });
      });
    });
    out.sort((a, b) => a.page - b.page);
    out.forEach((s, k) => { s.end = k + 1 < out.length ? Math.max(s.page, out[k + 1].page - 1) : pages.length; });
    return out;
  }
  async function ingest(name, bytes, kindWanted) {
    const lib = await estPdfjs();
    const doc = await lib.getDocument({ data: bytes.slice() }).promise;
    const pages = [];
    let maxW = 0, portrait = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const pg = await doc.getPage(p);
      const vp = pg.getViewport({ scale: 1 });
      maxW = Math.max(maxW, vp.width); if (vp.height > vp.width) portrait++;
      const tc = await pg.getTextContent();
      pages.push(tc.items.filter((it) => it.str && it.str.trim()).map((it) => {
        const t = lib.Util.transform(vp.transform, it.transform);
        const hgt = Math.hypot(it.transform[2], it.transform[3]) || Math.hypot(it.transform[0], it.transform[1]) || 8;
        return [it.str, r1(t[4]), r1(t[5] - hgt * 0.8), r1(it.width || it.str.length * hgt * 0.5), r1(hgt)];
      }));
      pages[pages.length - 1].dims = [r1(vp.width), r1(vp.height)];
    }
    const dims = pages.map((p) => p.dims);
    const secs = sectionsOf(pages);
    const kind = kindWanted || (secs.length && (portrait / doc.numPages > 0.6 || secs.length >= doc.numPages / 4) ? 'specs' : 'drawings');
    const id = `BD${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const meta = { id, name, kind, pages: doc.numPages, size: bytes.length, added: new Date().toISOString().slice(0, 16).replace('T', ' '), dims };
    if (kind === 'specs') meta.sections = secs;
    else meta.sheets = pages.map((items, i) => sheetOf(items, dims[i][0], dims[i][1], i + 1));
    const plain = pages.map((p) => p.map((x) => x.slice(0, 5)));
    await idb('readwrite', (s) => s.put({ id, bytes, pages: plain }));
    PAGES.set(id, plain);
    BD.docs.push(meta);
    save();
    return meta;
  }

  /* ------------------------------------------------------------ derived indexes */
  const drawingDocs = () => BD.docs.filter((d) => d.kind === 'drawings');
  const specDocs = () => BD.docs.filter((d) => d.kind === 'specs');
  function allSheets() { const o = []; drawingDocs().forEach((d) => (d.sheets || []).forEach((s) => o.push(Object.assign({ doc: d.id, docName: d.name }, s)))); return o; }
  function allSections() { const o = []; specDocs().forEach((d) => (d.sections || []).forEach((s) => o.push(Object.assign({ doc: d.id, docName: d.name }, s)))); return o; }
  const TRADES = [
    ['01', 'General requirements', ['General']], ['02', 'Existing conditions', ['Civil']], ['03', 'Concrete', ['Structural', 'Civil']],
    ['04', 'Masonry', ['Architectural']], ['05', 'Metals', ['Structural']], ['06', 'Wood, plastics and composites', ['Architectural']],
    ['07', 'Thermal and moisture protection', ['Architectural']], ['08', 'Openings', ['Architectural']], ['09', 'Finishes', ['Architectural', 'Interiors']],
    ['10', 'Specialties', ['Architectural']], ['11', 'Equipment', ['Equipment', 'Mechanical', 'Process']], ['12', 'Furnishings', ['Interiors']],
    ['13', 'Special construction', ['Structural']], ['14', 'Conveying equipment', ['Mechanical']], ['21', 'Fire suppression', ['Fire protection']],
    ['22', 'Plumbing', ['Plumbing']], ['23', 'HVAC', ['Mechanical']], ['25', 'Integrated automation', ['Instrumentation', 'Electrical']],
    ['26', 'Electrical', ['Electrical']], ['27', 'Communications', ['Telecom', 'Electrical']], ['28', 'Electronic safety and security', ['Electrical', 'Fire protection']],
    ['31', 'Earthwork', ['Civil']], ['32', 'Exterior improvements', ['Civil', 'Landscape']], ['33', 'Utilities', ['Civil']],
    ['40', 'Process interconnections', ['Piping', 'Process']], ['41', 'Material processing and handling equipment', ['Mechanical', 'Process']],
    ['42', 'Process heating, cooling and drying equipment', ['Mechanical', 'Process']], ['43', 'Process gas and liquid handling equipment', ['Mechanical', 'Process', 'Piping']],
    ['44', 'Pollution and waste control equipment', ['Mechanical', 'Process']], ['46', 'Water and wastewater equipment', ['Mechanical', 'Process']],
    ['48', 'Electrical power generation', ['Electrical']],
  ];
  const TRADE = new Map(TRADES.map((t) => [t[0], { div: t[0], name: t[1], discs: t[2] }]));
  const SPEC_REF = [/(?:SPEC(?:IFICATION)?S?|SECTION)\s*(?:NO\.?\s*)?(\d{2})\s?(\d{2})\s?(\d{2})\b/gi, /(?<![\d.])(\d{2}) (\d{2}) (\d{2})(?![\d.])/g];
  const SHEET_REF = [/(?<![\w/])\d{1,2}\s*\/\s*([A-Z]{1,3}-?\d{1,3}(?:\.\d{1,3})?)\b/g, /SEE\s+(?:DWG\.?|DRAWING|SHEET)\s+([A-Z]{1,3}-?\d{1,3}(?:\.\d{1,3})?)\b/gi];
  const NOTE_KINDS = [
    ['Exclusion', /\bBY OTHERS\b|\bNOT IN CONTRACT\b|\bN\.I\.C\.?|\bBY OWNER\b|\bOWNER[- ]FURNISHED\b|\bFURNISHED BY OWNER\b|\bOFCI\b|\bUNDER SEPARATE CONTRACT\b/i],
    ['Allowance', /\bALLOWANCE\b/i], ['Alternate', /\bALTERNATE\b/i], ['Unit price', /\bUNIT PRICE\b/i],
    ['Permit trigger', /\bPERMITS?\b|\bSWPPP\b/i],
    ['Commercial', /\bLIQUIDATED DAMAGES\b|\bPREVAILING WAGE\b|\bDAVIS[- ]BACON\b|\bPERFORMANCE BOND\b|\bPAYMENT BOND\b|\bRETAINAGE\b|\bRETENTION\b/i],
    ['Testing', /\bTESTING BY\b|\bTEST AND BALANCE\b|\bTESTING AGENCY\b/i],
  ];
  let XREF = null;
  async function xref() {
    if (XREF) return XREF;
    const sheets = allSheets();
    const specRefs = [], sheetRefs = [], notes = [];
    for (const d of BD.docs) {
      const pages = await pagesOf(d.id);
      pages.forEach((items, i) => {
        const sh = d.kind === 'drawings' ? (d.sheets || [])[i] : null;
        const where = d.kind === 'drawings' ? (sh ? sh.no : `p${i + 1}`) : (() => { const s = (d.sections || []).find((x) => i + 1 >= x.page && i + 1 <= x.end); return s ? `Spec ${s.no}` : `p${i + 1}`; })();
        lines(items).forEach((ln) => {
          if (d.kind === 'drawings') {
            const seen = new Set();
            SPEC_REF.forEach((re) => { re.lastIndex = 0; let m; while ((m = re.exec(ln.text))) { const no = `${m[1]} ${m[2]} ${m[3]}`; if (seen.has(no) || !TRADE.has(m[1])) continue; seen.add(no); specRefs.push({ no, doc: d.id, page: i + 1, sheet: where, text: ln.text }); } });
            const seenS = new Set();
            SHEET_REF.forEach((re) => { re.lastIndex = 0; let m; while ((m = re.exec(ln.text))) { const t = m[1].toUpperCase(); if (seenS.has(t)) continue; seenS.add(t); sheetRefs.push({ target: t, doc: d.id, page: i + 1, sheet: where, text: ln.text }); } });
          }
          for (const [k, re] of NOTE_KINDS) if (re.test(ln.text)) { notes.push({ kind: k, doc: d.id, docName: d.name, page: i + 1, where, text: ln.text }); break; }
        });
      });
    }
    XREF = { sheets, specRefs, sheetRefs, notes };
    return XREF;
  }
  const invalidate = () => { XREF = null; };

  /* ------------------------------------------------------------ checks */
  async function findings() {
    const X = await xref();
    const secs = allSections();
    const have = new Set(X.sheets.map((s) => normSheet(s.no)));
    const out = [];
    const add = (f) => { f.id = `${f.type}|${f.key}`; if (!BD.dismissed.includes(f.id)) out.push(f); };
    const byT = new Map();
    X.sheetRefs.forEach((r) => { if (!have.has(normSheet(r.target))) { if (!byT.has(r.target)) byT.set(r.target, []); byT.get(r.target).push(r); } });
    byT.forEach((rs, t) => add({ type: 'Sheet not in set', sev: 'High', key: t, where: [...new Set(rs.map((r) => r.sheet))].join(', '), page: rs[0].page, doc: rs[0].doc,
      detail: `${t} is referenced (${rs.map((r) => `"${r.text}"`).slice(0, 2).join('; ')}) but no sheet ${t} is in the bid set.`,
      subject: `Missing drawing ${t}`, question: `Drawing${rs.length > 1 ? 's' : ''} ${[...new Set(rs.map((r) => r.sheet))].join(', ')} reference${rs.length > 1 ? '' : 's'} ${t}, which is not included in the bid documents. Please issue ${t} or confirm the reference.` }));
    if (specDocs().length) {
      const inBook = new Set(secs.map((s) => s.no));
      const byS = new Map();
      X.specRefs.forEach((r) => { if (!inBook.has(r.no)) { if (!byS.has(r.no)) byS.set(r.no, []); byS.get(r.no).push(r); } });
      byS.forEach((rs, no) => add({ type: 'Spec section not in book', sev: 'High', key: no, where: [...new Set(rs.map((r) => r.sheet))].join(', '), page: rs[0].page, doc: rs[0].doc,
        detail: `Section ${no} is cited on the drawings ("${rs[0].text}") but the specification has no section ${no}.`,
        subject: `Specification section ${no} not issued`, question: `Drawing${rs.length > 1 ? 's' : ''} ${[...new Set(rs.map((r) => r.sheet))].join(', ')} cite${rs.length > 1 ? '' : 's'} specification section ${no}, which is not in the project manual. Please issue section ${no} or advise the governing section.` }));
    } else if (drawingDocs().length) {
      add({ type: 'No specification', sev: 'Medium', key: 'none', where: '—', detail: 'No spec book is in the bid set, so spec references on the drawings cannot be checked.', subject: 'Project manual not received', question: 'The bid documents received contain drawings only. Please issue the project manual / specifications.' });
    }
    const discSheets = new Map();
    X.sheets.forEach((s) => { if (!discSheets.has(s.disc)) discSheets.set(s.disc, []); discSheets.get(s.disc).push(s.no); });
    if (specDocs().length) {
      const divs = new Set(secs.map((s) => s.div));
      discSheets.forEach((nos, disc) => {
        if (['General', 'Other'].includes(disc)) return;
        const tr = TRADES.filter((t) => t[2].includes(disc)).map((t) => t[0]);
        if (tr.length && !tr.some((d) => divs.has(d))) add({ type: 'Drawings without specification', sev: 'Medium', key: disc, where: nos.join(', '),
          detail: `${disc} sheets (${nos.join(', ')}) are in the set but no specification division covers them (expected one of Division ${tr.join(', ')}).`,
          subject: `${disc} specifications missing`, question: `The bid set includes ${disc.toLowerCase()} drawings ${nos.join(', ')} but no specification sections in Division ${tr.join(' / ')}. Please issue the governing specifications or confirm the drawings govern.` });
      });
      const discs = new Set(X.sheets.map((s) => s.disc));
      [...divs].forEach((div) => {
        const t = TRADE.get(div); if (!t || div === '01') return;
        if (drawingDocs().length && !t.discs.some((d) => discs.has(d))) add({ type: 'Specification without drawings', sev: 'Info', key: div, where: secs.filter((s) => s.div === div).map((s) => s.no).join(', '),
          detail: `Division ${div} (${t.name}) is specified but no ${t.discs.join(' / ').toLowerCase()} sheets are in the set. Scope may be specification-only or drawings may be missing.`,
          subject: `Division ${div} scope without drawings`, question: `Division ${div} (${t.name}) sections are included in the project manual but no corresponding drawings were issued. Please confirm the scope or issue the drawings.` });
      });
    }
    const dup = new Map(); X.sheets.forEach((s) => { const k = normSheet(s.no); if (!/^P\d+$/.test(k)) dup.set(k, (dup.get(k) || []).concat([s])); });
    dup.forEach((ss) => { if (ss.length > 1) add({ type: 'Duplicate sheet number', sev: 'Medium', key: ss[0].no, where: ss.map((s) => `${s.docName} p${s.page}`).join(', '),
      detail: `Sheet ${ss[0].no} appears ${ss.length} times. Check which revision governs.`, subject: `Duplicate sheet ${ss[0].no}`, question: `Sheet ${ss[0].no} appears more than once in the bid set (${ss.map((s) => `page ${s.page}`).join(', ')}). Please confirm which governs.` }); });
    const sevRank = { High: 0, Medium: 1, Info: 2 };
    return out.sort((a, b) => sevRank[a.sev] - sevRank[b.sev] || a.type.localeCompare(b.type));
  }
  function raiseRfi(f) {
    const q = { new_rfi: 1, subject: f.subject, question: f.question, source: 'VREST Bid Desk', location: f.where && f.where !== '—' ? f.where : '' };
    location.href = suiteHref('rfi', 'rfis', q);
  }

  /* ------------------------------------------------------------ quantities: text counts */
  const STEEL_RE = /\b(W|HP|MC|C|S|M)\s?(\d{1,2})\s?[X×x]\s?(\d{1,3}(?:\.\d+)?)\b/g;
  function patternFor(mode, text) {
    if (mode === 'steel') return STEEL_RE;
    const t = String(text || '').trim();
    if (!t) return null;
    if (mode === 'regex') { try { return new RegExp(t, 'gi'); } catch (e) { throw new Error(`Pattern not valid: ${e.message}`); } }
    const e = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return mode === 'starts' ? new RegExp(`\\b${e}[A-Z0-9\\-./]*`, 'gi') : new RegExp(`(?<![A-Z0-9])${e}(?![A-Z0-9])`, 'gi');
  }
  async function textCount(mode, text, scope) {
    const re = patternFor(mode, text);
    if (!re) throw new Error('Enter the text to count.');
    const groups = new Map();
    for (const d of drawingDocs()) {
      if (scope && scope !== d.id) continue;
      const pages = await pagesOf(d.id);
      pages.forEach((items, i) => {
        for (const it of items) {
          re.lastIndex = 0; let m;
          while ((m = re.exec(it[0]))) {
            const key = mode === 'steel' ? `${m[1].toUpperCase()}${m[2]}X${m[3]}` : m[0].toUpperCase();
            const cw = it[3] / Math.max(1, it[0].length);
            const hit = { doc: d.id, page: i + 1, x: r1(it[1] + m.index * cw), y: it[2], w: r1(Math.max(6, m[0].length * cw)), h: it[4] };
            if (!groups.has(key)) groups.set(key, { key, hits: [], plf: mode === 'steel' ? Number(m[3]) : null });
            groups.get(key).hits.push(hit);
            if (!re.global) break;
          }
        }
      });
    }
    return [...groups.values()].sort((a, b) => b.hits.length - a.hits.length || a.key.localeCompare(b.key));
  }
  function sheetLabel(h) { const d = BD.docs.find((x) => x.id === h.doc); const s = d && d.sheets ? d.sheets[h.page - 1] : null; return s ? s.no : `p${h.page}`; }
  const live = (g) => g.hits.filter((h, i) => !(g.excluded || []).includes(i));
  function groupSheets(g) { return [...new Set(live(g).map(sheetLabel))]; }
  function tons(g) { return g.plf && g.len ? live(g).length * g.len * g.plf / 2000 : null; }
  function addGroups(found, kind, label) {
    found.forEach((f) => {
      const same = BD.groups.find((g) => g.kind === kind && g.key === f.key && !g.posted && kind !== 'symbol');
      if (same) { same.hits = f.hits; same.excluded = []; return; }
      BD.seq += 1;
      BD.groups.push({ id: `Q${BD.seq}`, kind, label: kind === 'symbol' ? label : f.key, key: f.key, hits: f.hits, excluded: [], plf: f.plf || null, len: null, posted: null, made: new Date().toISOString().slice(0, 10) });
    });
    save();
  }

  /* ------------------------------------------------------------ quantities: symbol match */
  const SC = 1400;   // render width in pixels for matching
  async function pageRaster(id, page, scale) {
    const lib = await estPdfjs();
    const doc = await lib.getDocument({ data: (await bytesOf(id)).slice() }).promise;
    const pg = await doc.getPage(page);
    const vp0 = pg.getViewport({ scale: 1 });
    const s = scale || SC / vp0.width;
    const vp = pg.getViewport({ scale: s });
    const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const g = cv.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: g, viewport: vp }).promise;
    const px = g.getImageData(0, 0, cv.width, cv.height).data;
    const gray = new Float32Array(cv.width * cv.height);
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = 1 - (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
    return { gray, w: cv.width, h: cv.height, s };
  }
  function shrink(img, w, h, f) {
    if (f === 1) return { a: img, w, h };
    const W = Math.floor(w / f), H = Math.floor(h / f), a = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += img[(y * f + j) * w + x * f + i]; a[y * W + x] = s / (f * f); }
    return { a, w: W, h: H };
  }
  /* Two passes of a 3 x 3 box blur: thin CAD lines then still overlap when a
     copy sits a pixel or so off the template's alignment. */
  function blur(m) {
    let a = m.a;
    for (let pass = 0; pass < 2; pass++) {
      const b = new Float32Array(a.length);
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        let sum = 0, n = 0;
        for (let j = -1; j <= 1; j++) { const yy = y + j; if (yy < 0 || yy >= m.h) continue; for (let i = -1; i <= 1; i++) { const xx = x + i; if (xx < 0 || xx >= m.w) continue; sum += a[yy * m.w + xx]; n++; } }
        b[y * m.w + x] = sum / n;
      }
      a = b;
    }
    return { a, w: m.w, h: m.h };
  }
  /* Normalised cross-correlation of a template over a page, with integral
     images for the window statistics; blank windows are skipped. */
  function matchNCC(R, tpl, thr) {
    const f = Math.max(1, Math.ceil(Math.max(tpl.w, tpl.h) / 32));
    const I = blur(shrink(R.gray, R.w, R.h, f)), T = blur(shrink(tpl.a, tpl.w, tpl.h, f));
    const n = T.w * T.h; let tm = 0; for (let i = 0; i < n; i++) tm += T.a[i]; tm /= n;
    const Tz = new Float32Array(n); let tv = 0; for (let i = 0; i < n; i++) { Tz[i] = T.a[i] - tm; tv += Tz[i] * Tz[i]; }
    if (tv < 1e-6) return [];
    const W = I.w + 1, S = new Float64Array(W * (I.h + 1)), Q = new Float64Array(W * (I.h + 1));
    for (let y = 0; y < I.h; y++) { let rs = 0, rq = 0; for (let x = 0; x < I.w; x++) { const v = I.a[y * I.w + x]; rs += v; rq += v * v; S[(y + 1) * W + x + 1] = S[y * W + x + 1] + rs; Q[(y + 1) * W + x + 1] = Q[y * W + x + 1] + rq; } }
    const cand = [];
    for (let y = 0; y + T.h <= I.h; y++) {
      for (let x = 0; x + T.w <= I.w; x++) {
        const a = y * W + x, b = a + T.w, c = (y + T.h) * W + x, d = c + T.w;
        const sum = S[d] - S[b] - S[c] + S[a]; const sq = Q[d] - Q[b] - Q[c] + Q[a];
        const v = sq - sum * sum / n;
        if (v < tv * 0.3) continue;
        let num = 0;
        for (let j = 0; j < T.h; j++) { const row = (y + j) * I.w + x, tr = j * T.w; for (let i = 0; i < T.w; i++) num += Tz[tr + i] * I.a[row + i]; }
        const sc = num / Math.sqrt(v * tv);
        if (sc >= thr) cand.push([sc, x, y]);
      }
    }
    cand.sort((p, q) => q[0] - p[0]);
    const keep = [], rr = Math.max(T.w, T.h) * 0.6;
    for (const c of cand) if (!keep.some((k) => Math.abs(k[1] - c[1]) < rr && Math.abs(k[2] - c[2]) < rr)) keep.push(c);
    return keep.map(([sc, x, y]) => ({ sc, x: x * f, y: y * f, w: T.w * f, h: T.h * f }));
  }
  async function symbolCount(tplInfo, pagesWanted, thr, onProgress) {
    const hits = [];
    let k = 0;
    for (const { doc, page } of pagesWanted) {
      const R = await pageRaster(doc, page, tplInfo.s);
      matchNCC(R, tplInfo, thr).forEach((m) => hits.push({ doc, page, x: r1(m.x / R.s), y: r1(m.y / R.s), w: r1(m.w / R.s), h: r1(m.h / R.s), sc: Math.round(m.sc * 100) / 100 }));
      k += 1; if (onProgress) onProgress(k, pagesWanted.length);
      await new Promise((r) => setTimeout(r, 0));
    }
    return hits;
  }

  /* ------------------------------------------------------------ sheet viewer */
  async function viewer(opts) {
    const docId = opts.doc;
    const d = BD.docs.find((x) => x.id === docId);
    if (!d) return;
    const g = opts.group || null;
    let page = opts.page || (g ? g.hits[0].page : 1);
    const lib = await estPdfjs();
    const pdf = await lib.getDocument({ data: (await bytesOf(docId)).slice() }).promise;
    const cv = el('canvas', { style: 'display:block;max-width:100%' });
    const ov = el('canvas', { style: 'position:absolute;left:0;top:0;cursor:crosshair' });
    const stage = el('div', { style: 'position:relative;display:inline-block;border:1px solid var(--border)' }, cv, ov);
    const info = el('div', { class: 'hint', style: 'margin:6px 0' });
    const thr = el('input', { type: 'range', min: '0.6', max: '0.97', step: '0.01', value: '0.8', style: 'width:140px', 'aria-label': 'Match threshold' });
    const thrLab = el('span', { class: 'mono', text: '0.80' });
    thr.oninput = () => { thrLab.textContent = Number(thr.value).toFixed(2); };
    let vs = 1, sel = null, drag = null, tpl = null;
    const pagesWithHits = g ? [...new Set(g.hits.filter((h) => h.doc === docId).map((h) => h.page))].sort((a, b) => a - b) : null;
    async function render() {
      const pg = await pdf.getPage(page);
      const vp0 = pg.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      vs = Math.min(1100, window.innerWidth * 0.9) / vp0.width;
      const vp = pg.getViewport({ scale: vs * dpr });
      cv.width = vp.width; cv.height = vp.height; cv.style.width = `${vp.width / dpr}px`; cv.style.height = `${vp.height / dpr}px`;
      ov.width = vp.width; ov.height = vp.height; ov.style.width = cv.style.width; ov.style.height = cv.style.height;
      const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height);
      await pg.render({ canvasContext: c, viewport: vp }).promise;
      paint();
    }
    function paint() {
      const dpr = window.devicePixelRatio || 1, k = vs * dpr;
      const c = ov.getContext('2d'); c.clearRect(0, 0, ov.width, ov.height);
      let on = 0, off = 0;
      if (g) g.hits.forEach((h, i) => {
        if (h.doc !== docId || h.page !== page) return;
        const ex = (g.excluded || []).includes(i);
        if (ex) off++; else on++;
        c.lineWidth = 2 * dpr; c.strokeStyle = ex ? '#dd6974' : '#4f98a3'; c.fillStyle = ex ? 'rgba(221,105,116,.18)' : 'rgba(79,152,163,.22)';
        c.fillRect((h.x - 2) * k, (h.y - 2) * k, (h.w + 4) * k, (h.h + 4) * k); c.strokeRect((h.x - 2) * k, (h.y - 2) * k, (h.w + 4) * k, (h.h + 4) * k);
        if (ex) { c.beginPath(); c.moveTo(h.x * k, h.y * k); c.lineTo((h.x + h.w) * k, (h.y + h.h) * k); c.stroke(); }
      });
      if (sel) { c.lineWidth = 2 * dpr; c.strokeStyle = '#e8af34'; c.setLineDash([6 * dpr, 4 * dpr]); c.strokeRect(sel.x * k, sel.y * k, sel.w * k, sel.h * k); c.setLineDash([]); }
      const sh = d.sheets ? d.sheets[page - 1] : null;
      info.textContent = `${d.name} · page ${page} of ${d.pages}${sh ? ` · ${sh.no}${sh.title ? ` ${sh.title}` : ''}` : ''}${g ? ` · ${g.label}: ${on} counted on this page${off ? `, ${off} rejected` : ''} (click a mark to reject or restore it)` : ''}${tpl ? ' · symbol picked' : g ? '' : ' · drag a box round one symbol to pick it'}`;
    }
    const pos = (e) => { const r = ov.getBoundingClientRect(); return { x: (e.clientX - r.left) / vs, y: (e.clientY - r.top) / vs }; };
    ov.addEventListener('mousedown', (e) => { if (g) return; drag = pos(e); sel = null; });
    ov.addEventListener('mousemove', (e) => { if (!drag) return; const p = pos(e); sel = { x: Math.min(drag.x, p.x), y: Math.min(drag.y, p.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) }; paint(); });
    ov.addEventListener('mouseup', async () => {
      if (!drag) return; drag = null;
      if (!sel || sel.w < 4 || sel.h < 4) { sel = null; paint(); return; }
      const R = await pageRaster(docId, page);
      const x0 = Math.round(sel.x * R.s), y0 = Math.round(sel.y * R.s), w = Math.round(sel.w * R.s), h = Math.round(sel.h * R.s);
      const a = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = R.gray[(y0 + y) * R.w + x0 + x] || 0;
      tpl = { a, w, h, s: R.s, page, doc: docId };
      paint();
    });
    ov.addEventListener('click', (e) => {
      if (!g) return;
      const p = pos(e);
      const i = g.hits.findIndex((h) => h.doc === docId && h.page === page && p.x >= h.x - 4 && p.x <= h.x + h.w + 4 && p.y >= h.y - 4 && p.y <= h.y + h.h + 4);
      if (i < 0) return;
      const ex = new Set(g.excluded || []); if (ex.has(i)) ex.delete(i); else ex.add(i);
      g.excluded = [...ex].sort((a, b) => a - b); save(); paint();
    });
    const turn = (dir) => {
      if (pagesWithHits && pagesWithHits.length) { const k = pagesWithHits.indexOf(page); page = pagesWithHits[Math.max(0, Math.min(pagesWithHits.length - 1, (k < 0 ? 0 : k) + dir))]; }
      else page = Math.max(1, Math.min(d.pages, page + dir));
      sel = null; render();
    };
    async function find(all) {
      if (!tpl) { toast('Drag a box round one symbol first.', true); return; }
      const want = all ? drawingDocs().flatMap((x) => Array.from({ length: x.pages }, (_, i) => ({ doc: x.id, page: i + 1 }))) : [{ doc: docId, page }];
      info.textContent = 'Matching…';
      await new Promise((r) => setTimeout(r, 30));
      const hits = await symbolCount(tpl, want, Number(thr.value), (k2, n) => { info.textContent = `Matching… page ${k2} of ${n}`; });
      if (!hits.length) { toast('No matches above the threshold. Lower it or pick the symbol more tightly.', true); paint(); return; }
      const sh = d.sheets ? d.sheets[tpl.page - 1] : null;
      const name = await new Promise((res) => {
        const inp = el('input', { type: 'text', value: `Symbol from ${sh ? sh.no : `p${tpl.page}`}`, style: 'width:100%' });
        modal({ title: 'Name this count', sub: `${hits.length} matches on ${new Set(hits.map((h) => `${h.doc}|${h.page}`)).size} page(s) at threshold ${Number(thr.value).toFixed(2)}`, width: 460,
          body: el('div', {}, el('label', { text: 'What is counted (e.g. light fixture LF-A)' }), inp), buttons: [{ label: 'Cancel', onClick: () => { closeModal(); res(null); } }, { label: 'Keep count', primary: true, onClick: () => { const v = inp.value.trim() || 'Symbol'; closeModal(); res(v); } }] });
      });
      if (!name) return;
      addGroups([{ key: name, hits }], 'symbol', name);
      toast(`${name}: ${hits.length} counted. Review each mark before posting.`);
      const grp = BD.groups[BD.groups.length - 1];
      viewer({ doc: hits[0].doc, page: hits[0].page, group: grp, after: opts.after });
    }
    const body = el('div', {},
      el('div', { class: 'toolbar' },
        el('button', { class: 'ghost', onclick: () => turn(-1) }, '‹ Prev'), el('button', { class: 'ghost', onclick: () => turn(1) }, 'Next ›'),
        g ? null : el('span', { style: 'display:inline-flex;gap:6px;align-items:center' }, 'Match threshold', thr, thrLab),
        g ? null : el('button', { class: 'ghost', id: 'bd-find-page', onclick: () => find(false) }, 'Find on this page'),
        g ? null : el('button', { class: 'primary', id: 'bd-find-all', onclick: () => find(true) }, 'Find on all drawing pages'),
        g ? el('button', { class: 'ghost', onclick: () => { g.excluded = []; save(); paint(); } }, 'Restore all marks') : null),
      info, el('div', { style: 'max-height:70vh;overflow:auto' }, stage),
      el('div', { class: 'hint', style: 'margin-top:6px', text: g ? 'Blue marks are counted; red marks are rejected and left out of the quantity.' : 'Symbol matching finds the same symbol at the same size and rotation; rotated or scaled copies need their own pick. Symbols drawn alike are counted together whatever their tag, so reject the ones that belong to another count.' }));
    modal({ title: g ? `Review: ${g.label}` : 'Symbol count', sub: g ? `${live(g).length} counted on ${groupSheets(g).join(', ')}` : 'Pick one symbol on the sheet, then find the others', width: 1180, body,
      buttons: [{ label: 'Close', primary: true, onClick: () => { closeModal(); if (opts.after) opts.after(); } }] });
    await render();
  }

  /* ------------------------------------------------------------ post to takeoff */
  function postDialog(g) {
    const n = live(g).length;
    const tn = tons(g);
    const disc = el('select', {}, ...D.disciplines.map((x) => el('option', { value: x.discipline }, x.discipline)));
    const key = el('select', {});
    const area = el('select', {}, ...D.areas.map((a) => el('option', { value: a.area_code }, `${a.area_code} — ${a.area_name}`)));
    const craft = el('select', {}, ...D.crafts.map((c) => el('option', { value: c.craft }, c.craft)));
    const qty = el('input', { type: 'number', step: 'any', min: '0', style: 'width:140px' });
    const note = el('div', { class: 'hint' });
    const guess = g.plf ? 'Structural' : /LF-|FIXT|LIGHT/i.test(g.label) ? 'Electrical' : null;
    if (guess && D.disciplines.some((x) => x.discipline === guess)) disc.value = guess;
    function fill() {
      key.textContent = '';
      D.mh_library.filter((m) => m.discipline === disc.value).forEach((m) => key.appendChild(el('option', { value: m.key }, `${m.key} — ${m.description} (${m.uom})`)));
      const rows = D.mh_library.filter((m) => m.discipline === disc.value);
      if (g.plf) { const s = rows.find((m) => /TON/i.test(m.uom)); if (s) key.value = s.key; }
      else {
        /* A count posts against a per-each item; prefer one whose wording matches what was counted. */
        const stems = new Set(`${g.label} ${/^LF-/i.test(g.label) ? 'lighting fixture' : ''}`.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3).map((w) => w.slice(0, 5)));
        const each = rows.filter((m) => /^(EA|NO|SET)$/i.test(m.uom));
        let best = each[0], top = 0;
        each.forEach((m) => { const sc = String(m.description).toLowerCase().split(/[^a-z]+/).filter((w) => stems.has(w.slice(0, 5))).length; if (sc > top) { top = sc; best = m; } });
        if (best) key.value = best.key;
      }
      calc();
    }
    function calc() {
      const lib = IDX.mhByKey.get(key.value); const u = lib ? String(lib.uom).toUpperCase() : '';
      let v = n, why = `${n} counted`;
      if (/TON|TN/.test(u)) { v = tn == null ? '' : Math.round(tn * 100) / 100; why = tn == null ? 'set the length of each member on the group to get tons' : `${n} × ${g.len} ft × ${g.plf} lb/ft ÷ 2000`; }
      else if (/^LB/.test(u) && g.plf && g.len) { v = Math.round(n * g.len * g.plf); why = `${n} × ${g.len} ft × ${g.plf} lb/ft`; }
      else if (/^(LF|FT)$/.test(u) && g.len) { v = Math.round(n * g.len * 10) / 10; why = `${n} × ${g.len} ft`; }
      else if (!/^(EA|NO|SET)$/.test(u)) { v = ''; why = `${n} counted; a quantity in ${u || 'this unit'} has to be entered`; }
      qty.value = v; note.textContent = why;
    }
    const CRAFT_FOR = { Civil: /operator|labou?rer|carpenter/i, Structural: /ironworker/i, Mechanical: /millwright|pipefitter/i, Piping: /pipefitter/i, Electrical: /electrician/i, Instrumentation: /instrument|electrician/i, Insulation: /insulator/i, Painting: /painter/i };
    const pickCraft = () => { const re = CRAFT_FOR[disc.value]; const c = re && D.crafts.find((x) => re.test(x.craft)); if (c) craft.value = c.craft; };
    disc.onchange = () => { fill(); pickCraft(); }; key.onchange = calc; fill(); pickCraft();
    modal({
      title: `Post ${g.label} to takeoff`, sub: `${n} counted on ${groupSheets(g).join(', ')}`, width: 640,
      body: el('div', { class: 'form-grid' }, el('label', { text: 'Discipline' }), disc, el('label', { text: 'Library key' }), key, el('label', { text: 'Area' }), area,
        el('label', { text: 'Craft' }), craft, el('label', { text: 'Quantity' }), el('div', {}, qty, note)),
      buttons: [{ label: 'Cancel', onClick: closeModal }, { label: 'Post line', primary: true, onClick: () => {
        const lib = IDX.mhByKey.get(key.value); const q = Number(qty.value);
        if (!lib) { toast('Choose a library key', true); return; }
        if (!(q > 0)) { toast('Enter a quantity above zero', true); return; }
        const lineNo = nextNo(D.takeoff_lines, 'line_no', 'TKL-', 4, SEQ);
        const sheets = groupSheets(g);
        const line = { id: lineNo, line_no: lineNo, discipline: disc.value, area: area.value, master_key: lib.key, description: lib.description, quantity: Math.round(q * 100) / 100, uom: lib.uom, unit: lib.uom,
          discipline_factor: 1, global_factor: 1, item_factor: 1, weld_key: '', craft: craft.value,
          drawing_refs: sheets.filter((s) => !/^p\d+$/.test(s)).map((s) => ({ type: typeof drefGuessType === 'function' ? drefGuessType(s) : 'OTH', doc_no: s, sheet: '', rev: '' })),
          source: `Bid Desk ${g.kind === 'symbol' ? 'symbol' : 'text'} count: ${g.label}, ${n} on ${sheets.join(', ')}${g.plf && g.len ? `, ${g.len} ft each at ${g.plf} lb/ft` : ''}` };
        D.takeoff_lines.push(line);
        audit('takeoff_line', lineNo, 'create', null, `${line.discipline} ${line.master_key} qty ${line.quantity} ${line.uom} — ${line.source}`);
        g.posted = lineNo; save();
        closeModal(); refreshAll(); toast(`${lineNo} posted: ${line.quantity} ${line.uom}`);
      } }],
    });
  }

  /* ------------------------------------------------------------ export */
  function saveBlob(name, blob) { const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  function sheetIO() {
    if (window.VRSheetIO) return Promise.resolve(window.VRSheetIO);
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = `${EST_ROOT}shared/sheetio.js`; s.onload = () => res(window.VRSheetIO); s.onerror = () => rej(new Error('Could not load the workbook writer.')); document.head.appendChild(s); });
  }
  async function scopeRows(div) {
    const X = await xref();
    const t = TRADE.get(div);
    const secs = allSections().filter((s) => s.div === div);
    const sheets = X.sheets.filter((s) => t && t.discs.includes(s.disc)).map((s) => s.no);
    const rows = secs.map((s) => {
      const cites = [...new Set(X.specRefs.filter((r) => r.no === s.no).map((r) => r.sheet))];
      const notes = X.notes.filter((n) => n.doc === s.doc && n.page >= s.page && n.page <= s.end).map((n) => `${n.kind}: ${n.text}`);
      return { no: s.no, title: s.title, pages: s.page === s.end ? `${s.page}` : `${s.page}-${s.end}`, sheets: sheets.join(', '), cites: cites.join(', '), notes: notes.join(' | '), status: 'In spec book' };
    });
    const book = new Set(secs.map((s) => s.no));
    [...new Set(X.specRefs.filter((r) => r.no.slice(0, 2) === div && !book.has(r.no)).map((r) => r.no))].forEach((no) => {
      rows.push({ no, title: '', pages: '', sheets: sheets.join(', '), cites: [...new Set(X.specRefs.filter((r) => r.no === no).map((r) => r.sheet))].join(', '), notes: '', status: 'Cited on drawings, not in spec book' });
    });
    const dn = X.notes.filter((n) => BD.docs.find((x) => x.id === n.doc && x.kind === 'drawings') && sheets.includes(n.where));
    return { trade: t, rows, drawingNotes: dn };
  }
  function tradesPresent() {
    const divs = new Set(allSections().map((s) => s.div));
    (XREF ? XREF.specRefs : []).forEach((r) => divs.add(r.no.slice(0, 2)));
    return TRADES.filter((t) => divs.has(t[0])).map((t) => t[0]);
  }
  async function exportScope(divs) {
    const io = await sheetIO();
    const sheets = [];
    for (const div of divs) {
      const S = await scopeRows(div);
      const rows = S.rows.map((r) => [r.no, r.title, r.status, r.pages, r.cites, r.sheets, r.notes, '', '']);
      S.drawingNotes.forEach((n) => rows.push(['', `Drawing note (${n.kind})`, 'On drawings', '', n.where, '', n.text, '', '']));
      sheets.push({ name: `${div} ${S.trade ? S.trade.name : ''}`.slice(0, 31), header: ['Spec section', 'Title', 'Status', 'Spec pages', 'Cited on sheets', 'Trade sheets in set', 'Scope notes', 'Included in bid (Y/N)', 'Bidder comments'], rows });
    }
    sheets.unshift({ name: 'About', header: ['Item', 'Value'], rows: [['Estimate', `${D.project.project_no} ${D.project.project_name}`], ['Prepared', new Date().toISOString().slice(0, 10)],
      ['Documents', BD.docs.map((d) => `${d.name} (${d.pages} p)`).join('; ')], ['Basis', 'Rule-based index of the bid documents in VREST Bid Desk. Bidders confirm scope against the documents.']] });
    const blob = await io.xlsxBlob(sheets);
    saveBlob(`${D.project.project_no}-scope-sheets${divs.length === 1 ? `-div${divs[0]}` : ''}.xlsx`, blob);
  }

  /* ------------------------------------------------------------ go / no-go */
  const GNG = [
    ['client', 'Client relationship and payment record', 15], ['fit', 'Fit with our capabilities and experience', 15], ['size', 'Size against current capacity and bonding', 10],
    ['location', 'Location, access and logistics', 10], ['schedule', 'Schedule achievability', 10], ['competition', 'Competition (number and strength of bidders)', 10],
    ['margin', 'Expected margin', 15], ['terms', 'Contract terms and risk allocation', 10], ['effort', 'Cost and time to prepare the bid', 5],
  ];
  function gngScore() {
    let w = 0, s = 0, n = 0;
    GNG.forEach(([k, , wt]) => { const v = BD.gng.scores[k]; if (v) { w += wt; s += wt * v / 5; n++; } });
    const pct = w ? (s / w) * 100 : null;
    return { pct, n, verdict: pct == null ? 'Not scored' : pct >= 70 ? 'Go' : pct >= 55 ? 'Review' : 'No-go' };
  }

  /* ------------------------------------------------------------ adding files */
  async function addFiles(files, kind) {
    const list = Array.from(files || []).filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!list.length) { toast('Choose PDF files', true); return; }
    for (const f of list) {
      const busyNote = toast(`Reading ${f.name}…`);
      try { const m = await ingest(f.name, new Uint8Array(await f.arrayBuffer()), kind); toast(`${f.name}: ${m.kind === 'specs' ? `${(m.sections || []).length} spec sections` : `${m.pages} sheets`} indexed`); } catch (e) { console.error(e); toast(`${f.name}: ${e.message || 'could not be read'}`, true); }
      void busyNote;
    }
    invalidate(); redraw();
  }
  async function loadDemo() {
    for (const [i, u] of DEMO_SET.entries()) {
      try {
        const r = await fetch(u); if (!r.ok) throw new Error(`${u} not found`);
        await ingest(u.split('/').pop(), new Uint8Array(await r.arrayBuffer()), i ? 'specs' : 'drawings');
      } catch (e) { toast(e.message, true); }
    }
    invalidate(); redraw();
  }
  async function removeDoc(id) {
    BD.docs = BD.docs.filter((d) => d.id !== id);
    BD.groups = BD.groups.filter((g) => !g.hits.some((h) => h.doc === id));
    PAGES.delete(id); save(); invalidate();
    try { await idb('readwrite', (s) => s.delete(id)); } catch (e) { /* ignore */ }
    redraw();
  }

  /* ------------------------------------------------------------ views */
  function redraw() { if (ROOT && ROOT.isConnected) view(ROOT); }
  function seg() {
    const tabs = [['set', 'Bid set'], ['gng', 'Go / no-go'], ['qty', 'Quantities'], ['scope', 'Scope sheets'], ['checks', 'Checks']];
    return el('div', { class: 'seg', style: 'margin-bottom:10px' }, tabs.map(([k, t]) => el('button', { class: SUB === k ? 'ghost on' : 'ghost', 'data-sub': k, onclick: () => { SUB = k; redraw(); } }, t)));
  }
  function view(root) {
    ROOT = root; root.textContent = '';
    root.append(el('div', { class: 'hint mb10', text: 'Read the bid documents, decide whether to bid, take quantities off the drawings, cut trade scope sheets and check the set for gaps. Rule-based and read in this browser; nothing is uploaded and no AI is used.' }), seg());
    const host = el('div'); root.append(host);
    ({ set: vSet, gng: vGng, qty: vQty, scope: vScope, checks: vChecks })[SUB](host);
  }
  function vSet(host) {
    const fd = el('input', { type: 'file', multiple: true, accept: 'application/pdf,.pdf', style: 'display:none', onchange: (e) => { addFiles(e.target.files, 'drawings'); e.target.value = ''; } });
    const fs = el('input', { type: 'file', multiple: true, accept: 'application/pdf,.pdf', style: 'display:none', onchange: (e) => { addFiles(e.target.files, 'specs'); e.target.value = ''; } });
    const sh = allSheets(), se = allSections();
    host.append(el('div', { class: 'grid g4 mb10' },
      kpiCard('Documents', int(BD.docs.length), `${drawingDocs().length} drawing set(s), ${specDocs().length} spec book(s)`, 'blue'),
      kpiCard('Sheets', int(sh.length), `${new Set(sh.map((s) => s.disc)).size} disciplines`, 'blue'),
      kpiCard('Spec sections', int(se.length), `${new Set(se.map((s) => s.div)).size} divisions`, 'blue'),
      kpiCard('Bid decision', gngScore().verdict, gngScore().pct == null ? 'score it on Go / no-go' : `${Math.round(gngScore().pct)}% weighted`, gngScore().verdict === 'Go' ? 'green' : gngScore().verdict === 'No-go' ? 'accent' : 'amber')));
    host.append(card('Bid documents', [
      el('div', { class: 'toolbar' },
        el('button', { class: 'primary', id: 'bd-add-dwg', onclick: () => fd.click() }, 'Add drawings (PDF)…'), fd,
        el('button', { class: 'ghost', id: 'bd-add-spec', onclick: () => fs.click() }, 'Add spec book (PDF)…'), fs,
        !isUser() ? el('button', { class: 'ghost', id: 'bd-demo', onclick: loadDemo, disabled: BD.docs.some((d) => /^VR-DEMO-BID-001/.test(d.name)) || null }, 'Load the demo bid set') : null,
        el('span', { class: 'hint', text: 'PDFs with a text layer (exported from CAD or a word processor) index fully. Scanned sheets open and can be symbol-counted, but have no text to index.' })),
      BD.docs.length ? dataTable([
        { key: 'name', label: 'File' }, { key: 'kind', label: 'Type', width: 110, render: (d) => (d.kind === 'specs' ? 'Spec book' : 'Drawings') },
        { key: 'pages', label: 'Pages', num: true, width: 70 },
        { key: 'found', label: 'Indexed', render: (d) => (d.kind === 'specs' ? `${(d.sections || []).length} sections` : `${(d.sheets || []).filter((s) => !/^p\d+$/.test(s.no)).length} of ${d.pages} sheet numbers read`) },
        { key: 'added', label: 'Added', width: 140, mono: true },
        { key: 'act', label: '', width: 170, render: (d) => el('span', { style: 'display:flex;gap:6px' },
          d.kind === 'drawings' ? el('button', { class: 'ghost sm', onclick: () => viewer({ doc: d.id, page: 1 }) }, 'Open') : null,
          el('button', { class: 'ghost sm', onclick: () => confirmRemove(d) }, 'Remove')) },
      ], BD.docs, {}).wrap : el('div', { class: 'hint', text: 'No documents yet. Add the drawing set and the spec book.' }),
    ]).card);
    if (sh.length || se.length) {
      host.append(el('div', { class: 'split split-3-2', style: 'margin-top:12px' },
        card('Sheet index', dataTable([{ key: 'no', label: 'Sheet', mono: true, width: 110 }, { key: 'title', label: 'Title' }, { key: 'disc', label: 'Discipline', width: 120 }, { key: 'page', label: 'Page', num: true, width: 60 }],
          sh, { maxHeight: 360, empty: 'No drawings' }).wrap).card,
        card('Spec sections', dataTable([{ key: 'no', label: 'Section', mono: true, width: 96 }, { key: 'title', label: 'Title' }, { key: 'trade', label: 'Division', width: 140, render: (s) => (TRADE.get(s.div) || {}).name || s.div }, { key: 'page', label: 'Page', num: true, width: 60 }],
          se, { maxHeight: 360, empty: 'No spec book' }).wrap).card));
    }
  }
  function confirmRemove(d) {
    modal({ title: `Remove ${d.name}?`, sub: 'The copy kept in this browser and any counts taken from it are removed. Posted takeoff lines stay.', width: 480, body: el('div'),
      buttons: [{ label: 'Cancel', onClick: closeModal }, { label: 'Remove', primary: true, onClick: () => { closeModal(); removeDoc(d.id); } }] });
  }
  function vGng(host) {
    const s = gngScore();
    host.append(el('div', { class: 'grid g3 mb10' },
      kpiCard('Decision', s.verdict, s.n ? `${s.n} of ${GNG.length} criteria scored` : 'score each criterion 1-5', s.verdict === 'Go' ? 'green' : s.verdict === 'No-go' ? 'accent' : 'amber'),
      kpiCard('Weighted score', s.pct == null ? '—' : `${Math.round(s.pct)}%`, 'Go at 70%, review from 55%', 'blue', s.pct),
      kpiCard('Scope notes found', '…', 'from the bid documents', 'blue')));
    const tb = el('tbody');
    GNG.forEach(([k, label, wt]) => {
      const sel = el('select', { 'aria-label': label, 'data-gng': k, onchange: (e) => { const v = Number(e.target.value); if (v) BD.gng.scores[k] = v; else delete BD.gng.scores[k]; save(); redraw(); } },
        el('option', { value: '' }, '—'), ...[1, 2, 3, 4, 5].map((v) => el('option', { value: v, selected: BD.gng.scores[k] === v || null }, `${v} ${['', 'poor', 'weak', 'fair', 'good', 'strong'][v]}`)));
      tb.append(el('tr', {}, el('td', { text: label }), el('td', { class: 'num mono', text: `${wt}` }), el('td', {}, sel)));
    });
    const note = el('textarea', { rows: 3, style: 'width:100%', placeholder: 'Reasons, conditions of bidding, who decided', onchange: (e) => { BD.gng.note = e.target.value; save(); } });
    note.value = BD.gng.note || '';
    const notesHost = el('div', {}, el('div', { class: 'hint', text: 'Reading the documents…' }));
    host.append(el('div', { class: 'split split-3-2' },
      card('Criteria', [el('table', { class: 'data mini' }, el('thead', {}, el('tr', {}, el('th', {}, 'Criterion'), el('th', { class: 'num' }, 'Weight'), el('th', {}, 'Score'))), tb), el('div', { style: 'margin-top:8px' }, note)]).card,
      card('Scope and commercial notes in the documents', notesHost).card));
    if (!BD.docs.length) { notesHost.textContent = ''; notesHost.append(el('div', { class: 'hint', text: 'Add the bid documents to list exclusions, allowances, alternates, permit triggers and commercial terms.' })); return; }
    xref().then((X) => {
      notesHost.textContent = '';
      const k = host.querySelectorAll('.kpi .val')[2]; if (k) k.textContent = int(X.notes.length);
      notesHost.append(dataTable([{ key: 'kind', label: 'Type', width: 110, render: (n) => pill(n.kind, n.kind === 'Exclusion' ? 'amber' : n.kind === 'Commercial' ? 'accent' : 'blue') }, { key: 'text', label: 'Text' }, { key: 'where', label: 'Where', width: 110, mono: true }],
        X.notes, { maxHeight: 420, empty: 'No scope notes found' }).wrap);
    }).catch((e) => { notesHost.textContent = e.message; });
  }
  function vQty(host) {
    if (!drawingDocs().length) { host.append(el('div', { class: 'hint', text: 'Add a drawing set on Bid set first.' })); return; }
    const mode = el('select', { id: 'bd-mode', 'aria-label': 'Count by' },
      el('option', { value: 'steel' }, 'Steel member sizes (W, HP, C, MC, S, M)'), el('option', { value: 'exact' }, 'Exact text (tag, mark)'), el('option', { value: 'starts' }, 'Text starting with'), el('option', { value: 'regex' }, 'Pattern (regular expression)'));
    const txt = el('input', { type: 'text', id: 'bd-text', placeholder: 'e.g. LF-A, AHU-, EF-\\d+', style: 'width:220px' });
    const scope = el('select', { 'aria-label': 'Documents' }, el('option', { value: '' }, 'All drawing sets'), ...drawingDocs().map((d) => el('option', { value: d.id }, d.name)));
    const run = async () => {
      try {
        const found = await textCount(mode.value, txt.value, scope.value);
        if (!found.length) { toast('Nothing found in the drawing text.', true); return; }
        addGroups(found, mode.value === 'steel' ? 'steel' : 'text');
        toast(`${found.length} count group${found.length === 1 ? '' : 's'} added (${found.reduce((a, f) => a + f.hits.length, 0)} hits)`); redraw();
      } catch (e) { toast(e.message, true); }
    };
    host.append(card('Count from drawing text', [
      el('div', { class: 'toolbar' }, mode, txt, scope, el('button', { class: 'primary', id: 'bd-count', onclick: run }, 'Count'),
        el('span', { style: 'flex:1' }),
        el('button', { class: 'ghost', id: 'bd-symbol', onclick: () => viewer({ doc: drawingDocs()[0].id, page: 1, after: redraw }) }, 'Symbol count…')),
      el('div', { class: 'hint', text: 'Text counts read the words on the sheets: tags, marks and member sizes. Steel sizes carry their weight per foot (W12X26 = 26 lb/ft); enter the length of each member to get tons. Symbol count matches a symbol you pick on a sheet.' }),
    ]).card);
    const rows = BD.groups;
    const t = dataTable([
      { key: 'label', label: 'Counted', render: (g) => el('span', {}, el('b', { text: g.label }), g.kind === 'symbol' ? el('span', { class: 'hint', text: ' symbol' }) : null) },
      { key: 'n', label: 'Count', num: true, width: 70, sortVal: (g) => live(g).length, render: (g) => `${live(g).length}${(g.excluded || []).length ? ` (${g.excluded.length} rejected)` : ''}` },
      { key: 'sheets', label: 'Sheets', render: (g) => groupSheets(g).join(', ') },
      { key: 'plf', label: 'lb/ft', num: true, width: 60, render: (g) => g.plf || '' },
      { key: 'len', label: 'Length each (ft)', width: 120, render: (g) => (g.plf ? (() => { const i = el('input', { type: 'number', min: '0', step: 'any', value: g.len ?? '', style: 'width:80px;text-align:right', 'aria-label': `${g.label} length each` }); i.onchange = () => { g.len = i.value === '' ? null : Number(i.value); save(); redraw(); }; return i; })() : '') },
      { key: 'tons', label: 'Tons', num: true, width: 70, sortVal: (g) => tons(g) || 0, render: (g) => (tons(g) == null ? '' : tons(g).toFixed(2)) },
      { key: 'posted', label: 'Posted', width: 90, mono: true, render: (g) => g.posted || '' },
      { key: 'act', label: '', width: 230, render: (g) => el('span', { style: 'display:flex;gap:6px' },
        el('button', { class: 'ghost sm', onclick: () => viewer({ doc: g.hits[0].doc, page: g.hits[0].page, group: g, after: redraw }) }, 'Review'),
        el('button', { class: 'ghost sm', onclick: () => postDialog(g) }, g.posted ? 'Post again' : 'Post'),
        el('button', { class: 'ghost sm', onclick: () => { BD.groups = BD.groups.filter((x) => x !== g); save(); redraw(); } }, 'Drop')) },
    ], rows, { maxHeight: 520, empty: 'No counts yet' });
    const steel = rows.filter((g) => g.plf);
    const totalT = steel.reduce((a, g) => a + (tons(g) || 0), 0);
    host.append(card(`Counts${steel.length ? ` · steel ${totalT.toFixed(2)} tons from ${steel.filter((g) => g.len).length} of ${steel.length} sizes with lengths` : ''}`, [t.wrap,
      rows.length ? el('div', { class: 'toolbar', style: 'margin-top:8px' }, el('button', { class: 'ghost', onclick: async () => {
        const io = await sheetIO();
        saveBlob(`${D.project.project_no}-bid-desk-counts.xlsx`, await io.xlsxBlob([{ name: 'Counts', header: ['Counted', 'Kind', 'Count', 'Rejected', 'Sheets', 'lb/ft', 'Length each ft', 'Tons', 'Posted line'],
          rows: rows.map((g) => [g.label, g.kind, live(g).length, (g.excluded || []).length, groupSheets(g).join(', '), g.plf || '', g.len || '', tons(g) == null ? '' : Math.round(tons(g) * 100) / 100, g.posted || '']) }]));
      } }, 'Export counts (Excel)')) : null]).card);
  }
  function vScope(host) {
    if (BD.docs.length && !XREF) { host.append(el('div', { class: 'hint', text: 'Reading the documents…' })); xref().then(redraw).catch((e) => toast(e.message, true)); return; }
    const divs = tradesPresent();
    if (!divs.length) { host.append(el('div', { class: 'hint', text: 'Add the spec book and drawings on Bid set first.' })); return; }
    const pick = el('select', { id: 'bd-trade', 'aria-label': 'Trade' }, ...divs.map((d) => el('option', { value: d }, `Division ${d} — ${TRADE.get(d).name}`)));
    if (vScope.last && divs.includes(vScope.last)) pick.value = vScope.last;
    const out = el('div');
    async function draw() {
      vScope.last = pick.value;
      out.textContent = '';
      const S = await scopeRows(pick.value);
      out.append(dataTable([
        { key: 'no', label: 'Section', mono: true, width: 96 }, { key: 'title', label: 'Title' },
        { key: 'status', label: 'Status', width: 200, render: (r) => (r.status === 'In spec book' ? pill(r.status, 'green') : pill(r.status, 'amber')) },
        { key: 'pages', label: 'Spec pages', width: 90, mono: true }, { key: 'cites', label: 'Cited on', width: 110, mono: true }, { key: 'notes', label: 'Scope notes' },
      ], S.rows, { empty: 'Nothing in this division' }).wrap);
      out.append(el('div', { class: 'hint', style: 'margin-top:6px', text: `Trade sheets in the set: ${S.rows.length && S.rows[0].sheets ? S.rows[0].sheets : (allSheets().filter((s) => S.trade.discs.includes(s.disc)).map((s) => s.no).join(', ') || 'none')}` }));
      if (S.drawingNotes.length) out.append(el('div', { style: 'margin-top:8px' }, el('b', { text: 'Notes on the trade sheets' }), dataTable([{ key: 'kind', label: 'Type', width: 110 }, { key: 'text', label: 'Text' }, { key: 'where', label: 'Sheet', width: 90, mono: true }], S.drawingNotes, {}).wrap));
    }
    pick.onchange = draw;
    host.append(card('Trade scope sheet', [el('div', { class: 'toolbar' }, pick,
      el('button', { class: 'primary', id: 'bd-scope-x', onclick: () => exportScope([pick.value]).catch((e) => toast(e.message, true)) }, 'Export this trade (Excel)'),
      el('button', { class: 'ghost', id: 'bd-scope-all', onclick: () => exportScope(divs).catch((e) => toast(e.message, true)) }, `Export all ${divs.length} trades`)), out]).card);
    draw().catch((e) => { out.textContent = e.message; });
  }
  function vChecks(host) {
    if (!BD.docs.length) { host.append(el('div', { class: 'hint', text: 'Add the bid documents on Bid set first.' })); return; }
    const out = el('div', {}, el('div', { class: 'hint', text: 'Checking…' }));
    host.append(card('Checks', [el('div', { class: 'hint mb10', text: 'Rule-based checks of the bid set. Each finding can raise a prefilled RFI in VRRFI or be dismissed when it does not apply.' }), out]).card);
    findings().then((F) => {
      out.textContent = '';
      out.append(el('div', { class: 'grid g3 mb10' },
        kpiCard('High', int(F.filter((f) => f.sev === 'High').length), 'missing documents', 'accent'), kpiCard('Medium', int(F.filter((f) => f.sev === 'Medium').length), 'coverage gaps', 'amber'),
        kpiCard('Info', int(F.filter((f) => f.sev === 'Info').length), 'to confirm', 'blue')));
      out.append(dataTable([
        { key: 'sev', label: 'Severity', width: 90, render: (f) => pill(f.sev, f.sev === 'High' ? 'accent' : f.sev === 'Medium' ? 'amber' : 'blue') },
        { key: 'type', label: 'Check', width: 200 }, { key: 'detail', label: 'Finding' }, { key: 'where', label: 'Where', width: 120, mono: true },
        { key: 'act', label: '', width: 190, render: (f) => el('span', { style: 'display:flex;gap:6px' },
          el('button', { class: 'ghost sm', onclick: () => raiseRfi(f) }, 'Raise RFI'),
          el('button', { class: 'ghost sm', onclick: () => { BD.dismissed.push(f.id); save(); redraw(); } }, 'Dismiss')) },
      ], F, { empty: 'No findings' }).wrap);
      if (BD.dismissed.length) out.append(el('div', { class: 'toolbar', style: 'margin-top:8px' }, el('span', { class: 'hint', text: `${BD.dismissed.length} dismissed.` }), el('button', { class: 'ghost sm', onclick: () => { BD.dismissed = []; save(); redraw(); } }, 'Show dismissed again')));
    }).catch((e) => { out.textContent = e.message; });
  }

  window.BidDesk = { view, _test: { textCount, findings, xref, ingest, matchNCC, scopeRows, gngScore, state: () => BD } };
}());
