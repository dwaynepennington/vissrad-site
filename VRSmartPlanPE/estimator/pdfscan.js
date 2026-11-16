/* ==========================================================================
   VREST — Scan drawings (PDF).
   Reads piping isometrics, P&IDs and other drawings and pulls out what is
   printed on them, then proposes takeoff lines from fixed, visible rules:

     1. Words. The PDF text layer is read with the vendored pdf.js. A sheet
        with little or no text (a scan, or CAD output with the lettering
        drawn as outlines) is read with OCR (vendored tesseract.js, loaded
        only when needed): a whole-sheet pass finds the tables and the title
        block, then those areas are read again at 300 dpi; a table cell that
        still comes back empty is read once more on its own.
     2. Tables. Bill-of-material / material take-off tables are found from
        their header row (QTY plus DESCRIPTION or SIZE), split into columns
        and read row by row, with section rows (PIPE, FITTINGS, ERECTION
        MATERIALS ...) and wrapped descriptions. A cut-pipe-length table is
        read too and its total checked against the BOM pipe quantity.
     3. Title block: drawing / document number, revision, sheet, line
        number, scale, size, service, spec and insulation.
     4. Tags: instruments (including bubbles with letters over the number),
        control and hand valves, equipment, supports and field welds.
     5. Rollup: pipe length by size band, field and socket welds, bolt-ups,
        valves, supports, instruments and equipment, each with its basis and
        the sheets it came from. Everything is editable before posting.

   Nothing leaves the browser and nothing here is a learned model: a result
   marked "Check" is a rule that could not confirm the value.
   ========================================================================== */
'use strict';

const SCAN_SAMPLES = [
  'samples/scan/VR-DEMO-001-PIP-ISO-0101_0.pdf',
  'samples/scan/VR-DEMO-001-PIP-ISO-0102_0.pdf',
  'samples/scan/VR-DEMO-001-PIP-ISO-0103_0.pdf',
  'samples/scan/VR-DEMO-001-PRO-PID-0101_0.pdf',
];
const SCAN_MIN_TEXT = 60;      // alphanumeric characters below which a sheet is OCR'd
const SCAN_MAX_PX = 16e6;      // canvas pixel cap (iOS Safari limit is ~16.7M)

/* --------------------------------------------------------------- parsing */
const scanNorm = (s) => String(s == null ? '' : s).replace(/[\u2018\u2019\u2032\u00b4`]/g, "'").replace(/[\u201c\u201d\u2033]/g, '"').replace(/\s+/g, ' ').trim();

/** Feet from a feet-inches string: 64'-6", 75'8.3/16", 1'0", 12' 6 1/2", 8", 4 1/2". OCR forms ° and '' are accepted. */
function scanFtIn(raw) {
  let s = scanNorm(raw).replace(/\u00b0/g, "'").replace(/''+/g, "'").replace(/\s*-\s*/g, '-');
  s = s.replace(/(?<=\d)[Oo]|[Oo](?=\d)/g, '0').replace(/(?<=\d)[lI|]|[lI|](?=\d)/g, '1');
  let m = /^(\d+)'-?(?:(\d+)(?:[.\s-](\d+)\/(\d+))?)?"?$/.exec(s);
  if (m) return Number(m[1]) + (Number(m[2] || 0) + (m[3] ? Number(m[3]) / Number(m[4]) : 0)) / 12;
  m = /^(\d+(?:\.\d+)?)"$/.exec(s);
  if (m) return Number(m[1]) / 12;
  m = /^(\d+)[\s-](\d+)\/(\d+)"$/.exec(s);
  if (m) return (Number(m[1]) + Number(m[2]) / Number(m[3])) / 12;
  return null;
}

/** Quantity cell → { qty, unit, ft }. Pipe rows read as length; others as a count. */
function scanQty(raw, isLength, headerUnit) {
  let s = scanNorm(raw);
  if (!s) return null;
  const ft = scanFtIn(s);
  if (ft != null && /['"\u00b0]/.test(s)) return { qty: Math.round(ft * 1000) / 1000, unit: 'FT', ft, text: s };
  let m = /^(\d+(?:[.,]\d+)?)\s*(M|MTR|LM|MM|FT|LF|EA|PCS?|NO|SET|SETS)\.?$/i.exec(s.replace(/(?<=\d)[Oo]/g, '0'));
  if (m) {
    const v = Number(m[1].replace(',', '.')), u = m[2].toUpperCase();
    if (u === 'MM') return { qty: v / 1000, unit: 'M', ft: v / 304.8, text: s };
    if (u === 'M' || u === 'MTR' || u === 'LM') return { qty: v, unit: 'M', ft: v / 0.3048, text: s };
    if (u === 'FT' || u === 'LF') return { qty: v, unit: 'FT', ft: v, text: s };
    return { qty: v, unit: 'EA', ft: null, text: s };
  }
  const n = s.replace(/(?<=\d)[Oo]|[Oo](?=\d)/g, '0').replace(/^[lI|]$/, '1').replace(/(?<=\d)[lI|]|[lI|](?=\d)/g, '1');
  if (/^\d+(\.\d+)?$/.test(n)) {
    const v = Number(n);
    if (isLength) {
      const u = (headerUnit || 'FT').toUpperCase();
      return { qty: v, unit: u, ft: u === 'M' ? v / 0.3048 : v, text: s, assumed: !headerUnit };
    }
    return { qty: v, unit: 'EA', ft: null, text: s };
  }
  return null;
}

/** Size cell → { main, branch } in inches: 6", 6"x4", 10x2, 1-1/2, 3/4", 1 1/2", DN150, 4in. */
function scanSize(raw) {
  const s = scanNorm(raw).toUpperCase().replace(/(?<=\d)L?N\b/, 'IN').replace(/(?<=\d)[O]/g, '0');
  if (!s) return null;
  const one = (t) => {
    t = t.replace(/"|IN(CH)?|NB|NPS/g, '').trim();
    let m = /^(\d+)[-\s](\d+)\/(\d+)$/.exec(t); if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
    m = /^(\d+)\/(\d+)$/.exec(t); if (m) return Number(m[1]) / Number(m[2]);
    m = /^(\d+(?:\.\d+)?)$/.exec(t); if (m) return Number(m[1]);
    return null;
  };
  const dn = /^DN\s*(\d+)/.exec(s);
  if (dn) { const mm = Number(dn[1]); const T = { 15: 0.5, 20: 0.75, 25: 1, 32: 1.25, 40: 1.5, 50: 2, 65: 2.5, 80: 3, 100: 4, 150: 6, 200: 8, 250: 10, 300: 12 }; return { main: T[mm] || Math.round(mm / 25), branch: null }; }
  const parts = s.split(/\s*[X\u00d7*]\s*/);
  const main = one(parts[0]);
  if (main == null || main <= 0 || main > 120) return null;
  const branch = parts[1] ? one(parts[1]) : null;
  return { main, branch };
}

const SCAN_CLASSES = [
  ['control valve', /CONTROL\s*VALVE|\bC\.?V\.?\b|\bCV\b/],
  ['valve', /\bVALVE|\bVLV\b|\bVALVES\b/],
  ['support', /SUPPORT|\bSHOE\b|\bGUIDE\b|\bANCHOR\b|HANGER|TRUNNION|\bCLAMP\b|SPRING|DUMMY\s*LEG|\bSTOP\b/],
  ['gasket', /GASKET|\bGSKT\b/],
  ['bolt', /\bBOLT|\bSTUD/],
  ['flange', /FLANGE|\bFLG\b/],
  ['olet', /OLET\b/],
  ['elbow', /ELBOW|\bELL\b|\bEL\b|\bBEND\b/],
  ['tee', /\bTEE\b|LATERAL|\bCROSS\b/],
  ['reducer', /REDUCER|\bRED\b|SWAGE/],
  ['cap', /\bCAP\b/],
  ['coupling', /COUPLING|\bCPLG\b|\bUNION\b|NIPPLE|\bPLUG\b/],
  ['pipe', /^PIPE\b|\bPIPE[,;]/],
];
function scanClass(desc, section) {
  const d = scanNorm(desc).toUpperCase();
  for (const [k, re] of SCAN_CLASSES) if (re.test(d)) return k;
  const sec = String(section || '').toUpperCase();
  if (/^PIPE$/.test(sec)) return 'pipe';
  if (/VALVE/.test(sec)) return 'valve';
  if (/SUPPORT/.test(sec)) return 'support';
  return 'other';
}
function scanEnds(desc, cls, size) {
  const d = scanNorm(desc).toUpperCase();
  if (/\bSW\b|SOCKET|\bS\.W\.?\b/.test(d)) return 'SW';
  if (/\bTHD|\bTHRD|\bSCRD|\bNPT\b|THREAD/.test(d)) return 'THD';
  if (/\bBW\b|BUTT\s*-?WELD|\bBE\b|BEVEL/.test(d)) return 'BW';
  if (cls === 'flange' && /\bSO\b|SLIP/.test(d)) return 'SO';
  if (cls === 'flange' || /\bRF\b|\bFF\b|\bRTJ\b|FLGD|FLANGED|\bLUG\b|WAFER/.test(d)) return 'FLG';
  if (/\bPE\b/.test(d)) return 'SW';
  if (['elbow', 'tee', 'reducer', 'cap', 'olet', 'coupling'].includes(cls)) return size && size < 2.5 ? 'SW' : 'BW';
  return '';
}
/** Weld ends one piece brings to the line (approximate — fitting-to-fitting joints count twice). */
function scanWeldEnds(cls, ends, desc) {
  const d = String(desc || '').toUpperCase();
  if (cls === 'elbow') return 2;
  if (cls === 'tee') return 3;
  if (cls === 'reducer') return 2;
  if (cls === 'cap') return 1;
  if (cls === 'olet') return 2;
  if (cls === 'coupling') return /\bHALF\b/.test(d) ? 1 : 2;
  if (cls === 'flange') return /BLIND|\bBL\b/.test(d) ? 0 : 1;
  if (cls === 'valve' || cls === 'control valve') return ends === 'SW' || ends === 'BW' ? 2 : 0;
  return 0;
}
function scanMaterial(desc) {
  const d = scanNorm(desc).toUpperCase();
  if (/A333|LTCS/.test(d)) return 'A333';
  if (/\bP91\b|F91\b/.test(d)) return 'P91';
  if (/\bP22\b|F22\b|2-?1\/4\s*CR/.test(d)) return 'P22';
  if (/\bP11\b|F11\b|1-?1\/4\s*CR/.test(d)) return 'P11';
  if (/A312|\bSS\b|STAINLESS|\b304L?\b|\b316L?\b|WP304|WP316/.test(d) && !/WINDING/.test(d)) return 'SS';
  if (/A106|A53|A105|A234|WPB|\bCS\b|CARBON/.test(d)) return 'CS';
  return '';
}
/** Outside diameter (in) for a nominal size — ASME B36.10M. */
function scanOD(nps) {
  const T = { 0.5: 0.84, 0.75: 1.05, 1: 1.315, 1.25: 1.66, 1.5: 1.9, 2: 2.375, 2.5: 2.875, 3: 3.5, 4: 4.5, 6: 6.625, 8: 8.625, 10: 10.75, 12: 12.75 };
  return T[nps] || (nps >= 14 ? nps : nps + 0.3);
}

/* ------------------------------------------------------- words and lines */
/** Unified word: { t, x0, x1, y0, y1, cy, h, conf, src } in PDF points, top-left origin. */
function scanWordsFromText(tc, vp) {
  const out = [];
  const T = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  for (const it of tc.items) {
    const str = it.str || '';
    if (!str.trim()) continue;
    const m = T(vp.transform, it.transform);
    const fh = Math.hypot(m[2], m[3]);
    const rot = Math.abs(Math.atan2(m[1], m[0])) > 0.2;
    const x = m[4], base = m[5];
    const w = (it.width || str.length * fh * 0.5) * vp.scale;
    const h = fh * 0.72;
    if (rot) { out.push({ t: str.trim(), x0: x, x1: x + h, y0: base - w, y1: base, cy: base - w / 2, h, conf: 100, src: 'text', rot: true }); continue; }
    // split a run into words in proportion to character position
    const re = /\S+/g; let mm;
    while ((mm = re.exec(str))) {
      const a = x + (w * mm.index) / str.length, b = x + (w * (mm.index + mm[0].length)) / str.length;
      out.push({ t: mm[0], x0: a, x1: b, y0: base - h, y1: base, cy: base - h / 2, h, conf: 100, src: 'text' });
    }
  }
  return out;
}

function scanMedian(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

function scanLines(words) {
  const ws = words.filter((w) => !w.rot).sort((a, b) => a.cy - b.cy || a.x0 - b.x0);
  const lines = [];
  for (const w of ws) {
    let hit = null;
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 4; i--) {
      const L = lines[i];
      if (Math.abs(L.cy - w.cy) < 0.5 * Math.max(L.h, w.h)) { hit = L; break; }
    }
    if (hit) { hit.words.push(w); hit.cy = (hit.cy * (hit.words.length - 1) + w.cy) / hit.words.length; hit.h = Math.max(hit.h, w.h); }
    else lines.push({ cy: w.cy, h: w.h, words: [w] });
  }
  lines.forEach((L) => { L.words.sort((a, b) => a.x0 - b.x0); L.h = scanMedian(L.words.map((w) => w.h)) || L.h; });
  lines.sort((a, b) => a.cy - b.cy);
  return lines;
}
/** Words → cells, splitting where the gap is wider than k × text height. */
function scanCells(words, h, k = 1.6) {
  const cells = [];
  for (const w of words) {
    const c = cells[cells.length - 1];
    if (c && w.x0 - c.x1 < k * h) { c.t += ` ${w.t}`; c.x1 = Math.max(c.x1, w.x1); c.words.push(w); c.conf = Math.min(c.conf, w.conf); }
    else cells.push({ t: w.t, x0: w.x0, x1: w.x1, cy: w.cy, words: [w], conf: w.conf });
  }
  return cells;
}

/* ---------------------------------------------------------------- tables */
function scanLev1(a, b) {
  // true when a and b differ by at most one edit
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return e + (a.length - i) + (b.length - j) <= 1;
}
function scanLabel(t) {
  const u = String(t).toUpperCase().replace(/[:'‘“"]+/g, '').replace(/[:]+$/, '');
  let v = u.replace(/[.()]/g, '');
  for (const long of ['DESCRIPTION', 'COMPONENT', 'QUANTITY', 'COMMODITY', 'REMARKS', 'LENGTH']) if (v.length >= 5 && v !== long && scanLev1(v, long)) v = long;
  if (/^[NM][PR][S5]$/.test(v)) v = 'NPS';
  if (/^(QTY|QUANTITY|QUAN|QNTY|QTY\d*|[QO0]T[YV]|QIY|QTV)$/.test(v)) return 'qty';
  if (/^(DESCRIPTION|DESC|DESCR|COMPONENT)$/.test(v)) return 'desc';
  if (/^(NPS|SIZE|NB|DN|ND|BORE)$/.test(v) || u === 'N.B.' || u === 'N.B') return 'size';
  if (/^(PT|ITEM|MARK|PIECE|PC|PTNO|PT\.NO|PTNO\.)$/.test(v)) return 'item';
  if (/^(CODE|IDENT|COMMODITY|PART|MATL)$/.test(v)) return 'code';
  if (/^(UNIT|UOM|U\/M)$/.test(v)) return 'unit';
  if (/^(CUT|LENGTH)$/.test(v)) return 'len';
  if (/^(REMARKS|REMARK)$/.test(v)) return 'rem';
  if (/^(SCH|SCHEDULE|RATING|CLASS|SPEC|MATERIAL)$/.test(v)) return 'other';
  if (/^(INS|IN|MM|M|FT|NO)$/.test(v) && /\(|^NO/.test(u)) return 'suffix';
  return null;
}
const SCAN_NOT_BOM = /^(REV|DATE|CHK|CHKD|CHK'D|APP|APPD|MADE|BY|ISSUED|DRN|ENG)$/i;
const SCAN_PAIR = { 'COMPONENT DESCRIPTION': 'desc', 'ITEM CODE': 'code', 'PT NO': 'item', 'PART NO': 'code', 'CUT LENGTH': 'len', 'PIECE NO': 'item', 'ITEM NO': 'item' };

/** Find header runs in a line: label words with nothing but labels between them. */
function scanHeaderRuns(L) {
  const runs = [];
  let cur = null;
  const h = L.h;
  const hasDesc = L.words.some((w) => scanLabel(w.t) === 'desc');
  const notBom = L.words.some((w) => SCAN_NOT_BOM.test(w.t.replace(/[.:]+$/, '')));
  let unk = 0;
  for (const w of L.words) {
    let k = scanLabel(w.t);
    if (!k && hasDesc && !notBom && cur && /^[A-Za-z]{2,10}\)?$/.test(w.t) && w.x0 - cur.cols[cur.cols.length - 1].x1 > 2 * h) k = `unk${unk++}`;
    if (!k) {
      if (cur && cur.cols.length && w.x0 - cur.cols[cur.cols.length - 1].x1 < 1.2 * h && w.t.length <= 6 && !/\d/.test(w.t)) { cur.cols[cur.cols.length - 1].x1 = w.x1; continue; }
      if (cur) runs.push(cur);
      cur = null; continue;
    }
    if (!cur) cur = { cols: [] };
    const prev = cur.cols[cur.cols.length - 1];
    const pair = prev ? `${prev.label.toUpperCase().replace(/[.:]/g, '')} ${w.t.toUpperCase().replace(/[.:]/g, '')}` : '';
    if (prev && SCAN_PAIR[pair] && w.x0 - prev.x1 < 2.2 * h) { prev.kind = SCAN_PAIR[pair]; prev.label += ` ${w.t}`; prev.x1 = w.x1; continue; }
    if (k === 'suffix' && prev && w.x0 - prev.x1 < 2.2 * h) { prev.label += ` ${w.t}`; prev.x1 = w.x1; continue; }
    cur.cols.push({ kind: k === 'suffix' ? 'other' : k, label: w.t, x0: w.x0, x1: w.x1 });
  }
  if (cur) runs.push(cur);
  return runs.filter((r) => {
    const ks = r.cols.map((c) => c.kind);
    r.type = ks.includes('qty') && (ks.includes('desc') || ks.includes('size')) ? 'bom'
      : ks.includes('item') && ks.includes('len') && !ks.includes('qty') ? 'cut'
      : ks.includes('desc') && (ks.some((x) => /^unk/.test(x)) || ks.includes('size')) ? 'bom' : null;
    r.inferred = r.type === 'bom' && !ks.includes('qty');
    return !!r.type;
  });
}
/** Split a cell where a column starts between two of its words (left-aligned
    columns at their left edge, right-aligned numbers at their right edge). */
function scanSplitAtCols(cells, cols, h) {
  const bounds = [];
  cols.forEach((c) => { bounds.push(c.x0); if (c.kind === 'qty' || c.kind === 'size') bounds.push(c.x1 + 0.5 * h); });
  const out = [];
  cells.forEach((c) => {
    let cur = null;
    c.words.forEach((w, i) => {
      const prev = c.words[i - 1];
      const cut = prev && bounds.some((b) => b >= prev.x1 - 0.3 * h && b <= w.x0 + 0.5 * h);
      if (!cur || cut) { cur = { t: w.t, x0: w.x0, x1: w.x1, cy: w.cy, words: [w], conf: w.conf }; out.push(cur); }
      else { cur.t += ` ${w.t}`; cur.x1 = w.x1; cur.words.push(w); cur.conf = Math.min(cur.conf, w.conf); }
    });
  });
  return out;
}
function scanColFor(cell, cols) {
  let best = null, bd = Infinity;
  for (const c of cols) {
    const d = Math.min(Math.abs(cell.x0 - c.x0), Math.abs(cell.x1 - c.x1), Math.abs((cell.x0 + cell.x1) / 2 - (c.x0 + c.x1) / 2));
    const inside = cell.x0 >= c.x0 - 2 && cell.x1 <= c.x1 + 2 ? -1 : 0;
    if (d + inside < bd) { bd = d + inside; best = c; }
  }
  return best;
}
const SCAN_STOP = /^(PIPE SPOOLS?|SPOOL\b|CUT PIPE|CUT LENGTH|NOTES?\b|GENERAL NOTES|WELD (LIST|SUMMARY|MAP)|FIELD WELDS?:|SHOP WELDS?:|TOTAL WEIGHT|ERECTION ITEMS NOT)/;

/** Parse every BOM and cut-length table on a sheet. */
function scanTables(lines) {
  const tables = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    for (const run of scanHeaderRuns(L)) {
      const cols = run.cols.map((c) => ({ ...c }));
      const h = L.h;
      let x0 = Math.min(...cols.map((c) => c.x0)) - 2 * h, x1 = Math.max(...cols.map((c) => c.x1)) + 10 * h;
      // a following header line (PT / NO, N.B. / (INS)) folds into the labels
      let j = i + 1;
      while (j < lines.length && lines[j].cy - L.cy < 2.4 * h) {
        const ws = lines[j].words.filter((w) => w.x1 > x0 && w.x0 < x1);
        if (ws.length && ws.every((w) => !/\d/.test(w.t) && (w.t.length <= 3 || /^\(.*\)$/.test(w.t) || scanLabel(w.t)))) {
          ws.forEach((w) => { const c = scanColFor(w, cols); if (c) { c.label += ` ${w.t}`; } });
          j++;
        } else break;
      }
      // header read without its QTY label: a right-aligned column of numbers
      // just right of the last labelled column is the quantity
      if (run.type === 'bom' && !cols.some((c) => c.kind === 'qty' || /^unk/.test(c.kind))) {
        const right = Math.max(...cols.map((c) => c.x1));
        const nums = [];
        for (let k = j; k < Math.min(lines.length, j + 30); k++) lines[k].words.forEach((w) => { if (w.x0 > right + 2 * h && w.x0 < right + 25 * h && (scanQty(w.t, false) != null || scanFtIn(w.t) != null)) nums.push(w); });
        const ends = nums.map((w) => w.x1).sort((a, b) => a - b);
        const mid = ends[Math.floor(ends.length / 2)];
        const al = nums.filter((w) => Math.abs(w.x1 - mid) < 3 * h);
        if (al.length >= 2) { cols.push({ kind: 'qty', label: '(quantity column, header not read)', x0: Math.min(...al.map((w) => w.x0)), x1: Math.max(...al.map((w) => w.x1)) }); x1 = Math.max(x1, cols[cols.length - 1].x1 + 3 * h); run.inferred = false; }
        else continue;
      }
      const unitFromHdr = (() => { const q = cols.find((c) => c.kind === 'qty'); const m = q && /\((M|FT|MM|EA)\)/i.exec(q.label); return m ? m[1].toUpperCase() : ''; })();
      const T = { type: run.type, cols, rows: [], x0, x1, y0: L.cy - h, y1: L.cy + h, h, headerUnit: unitFromHdr, section: '' };
      let lastCy = lines[j - 1].cy;
      for (; j < lines.length; j++) {
        const R = lines[j];
        const ws = R.words.filter((w) => w.x1 > x0 && w.x0 < x1);
        if (!ws.length) continue;
        if (R.cy - lastCy > 6.5 * h) break;
        const text = ws.map((w) => w.t).join(' ').toUpperCase();
        if (SCAN_STOP.test(text)) break;
        if (scanHeaderRuns({ ...R, words: ws }).length) break;
        const qc = cols.filter((c) => /qty|size|code|unit|len/.test(c.kind));
        if (/^[A-Z][A-Z /&-]{2,40}$/.test(text) && !ws.some((w) => qc.some((c) => w.x1 > c.x0 - 0.5 * h && w.x0 < c.x1 + 0.5 * h))) {
          T.rows.push({ cy: R.cy, cells: {}, section: text.trim(), raw: text, gap: R.cy - lastCy, conf: 100 });
          lastCy = R.cy; T.y1 = R.cy + h; continue;
        }
        const cells = scanSplitAtCols(scanCells(ws, h), cols, h);
        const byKind = {};
        cells.forEach((c) => {
          const col = scanColFor(c, cols);
          if (!col) return;
          const key = T.type === 'cut' ? `${col.kind}${cols.filter((k) => k.kind === 'item' && k.x0 <= col.x0).length}` : col.kind;
          byKind[key] = byKind[key] ? { ...byKind[key], t: `${byKind[key].t} ${c.t}`, x1: c.x1, conf: Math.min(byKind[key].conf, c.conf) } : { ...c };
        });
        T.rows.push({ cy: R.cy, cells: byKind, raw: text, gap: R.cy - lastCy, conf: Math.min(...cells.map((c) => c.conf)) });
        lastCy = R.cy;
        T.y1 = R.cy + h;
      }
      if (run.inferred && !scanResolveCols(T)) continue;
      tables.push(T);
    }
  }
  return tables;
}

/** A header OCR could not read: name the unknown columns from their contents —
    the rightmost numeric column is the quantity, a column of pipe sizes
    left of it is the size, small integers left of the description are item
    numbers. Needs two or more data rows. */
function scanResolveCols(T) {
  const unk = T.cols.filter((c) => /^unk/.test(c.kind));
  const vals = (k) => T.rows.filter((r) => !r.section).map((r) => r.cells[k] && r.cells[k].t).filter(Boolean);
  const ratio = (k, f) => { const v = vals(k); return v.length ? v.filter(f).length / v.length : 0; };
  const desc = T.cols.find((c) => c.kind === 'desc');
  const isNum = (t) => scanQty(t, false) != null || scanFtIn(t) != null;
  const qty = [...unk].reverse().find((c) => vals(c.kind).length >= 2 && ratio(c.kind, isNum) >= 0.6 && (!desc || c.x0 > desc.x0));
  if (!qty) return false;
  const rename = (c, kind) => { T.rows.forEach((r) => { if (r.cells[c.kind]) { r.cells[kind] = r.cells[c.kind]; delete r.cells[c.kind]; } }); c.label += ` (read as ${kind})`; c.kind = kind; };
  rename(qty, 'qty');
  const size = unk.filter((c) => c !== qty && /^unk/.test(c.kind) && c.x1 < qty.x0 && ratio(c.kind, (t) => { const z = scanSize(t); return z && z.main <= 60; }) >= 0.6).pop();
  if (size) rename(size, 'size');
  unk.filter((c) => /^unk/.test(c.kind) && desc && c.x1 < desc.x0 && ratio(c.kind, (t) => /^\d{1,3}$/.test(t)) >= 0.6).forEach((c) => rename(c, 'item'));
  T.inferred = true;
  return true;
}

/** BOM table rows → material rows (sections, wrapped descriptions). */
function scanBomRows(T, sheet) {
  const out = [];
  let section = '';
  for (const r of T.rows) {
    if (r.section) { section = r.section; continue; }
    const c = r.cells;
    const desc = c.desc ? c.desc.t : '';
    const qtyT = c.qty ? c.qty.t : '';
    const item = c.item ? c.item.t : '';
    const onlyText = !qtyT && !c.size && !c.code;
    if (onlyText && !item && desc && /^[A-Z /&-]{3,40}$/.test(desc.toUpperCase()) && !/\d/.test(desc) && desc === desc.toUpperCase()) {
      section = desc.toUpperCase(); continue;
    }
    if (!qtyT && !item && (desc || c.code) && out.length && r.gap < 2.6 * T.h) {
      const p = out[out.length - 1];
      if (desc) p.desc = `${p.desc} ${desc}`.trim();
      if (c.code) p.code = `${p.code} ${c.code.t}`.trim();
      continue;
    }
    if (!qtyT && !desc) continue;
    out.push({ sheet: sheet.id, section, item: item.replace(/[<>]/g, ''), desc, sizeText: c.size ? c.size.t : '', qtyText: qtyT, code: c.code ? c.code.t : '',
      unitText: c.unit ? c.unit.t : '', conf: r.conf, cy: r.cy, src: sheet.src, headerUnit: T.headerUnit });
  }
  return out.map(scanFinishRow);
}
/** Derive class, size, quantity and status for a material row (also after an edit). */
function scanFinishRow(r) {
  r.cls = r.clsLocked ? r.cls : scanClass(r.desc, r.section);
  const sz = scanSize(r.sizeText);
  r.size = sz ? sz.main : null; r.branch = sz ? sz.branch : null;
  const isLen = r.cls === 'pipe';
  let qt = r.qtyText, guessed = '';
  // OCR often drops the foot mark: 32.0" / 32-0" on a pipe row is 32'-0"
  const lost = r.src === 'ocr' && isLen && /^(\d+)[.,\s-]+(\d{1,2})((?:[.\s]\d+\/\d+)?)["\u201d]$/.exec(scanNorm(qt));
  if (lost && Number(lost[2]) < 12) { qt = `${lost[1]}'-${lost[2]}${lost[3] || ''}"`; guessed = `read "${r.qtyText}" as ${qt} (foot mark assumed)`; }
  const q = scanQty(qt, isLen, r.unitText || r.headerUnit);
  r.qty = q ? q.qty : null; r.unit = r.unitLocked ? r.unit : (q ? q.unit : (isLen ? 'FT' : 'EA'));
  r.ft = q && q.ft != null ? q.ft : (r.unit === 'M' && r.qty != null ? r.qty / 0.3048 : r.unit === 'FT' ? r.qty : null);
  r.ends = scanEnds(r.desc, r.cls, r.size);
  r.material = scanMaterial(r.desc);
  const why = [];
  if (r.qty == null) why.push('quantity not read');
  if (r.size == null && r.cls !== 'bolt') why.push('size not read');
  if (r.cls === 'other') why.push('component type not recognized');
  if (isLen && q && q.assumed) why.push('length unit assumed feet');
  if (isLen && r.unit === 'EA') why.push('pipe quantity is not a length');
  if (r.src === 'ocr' && r.conf < 75) why.push(`OCR confidence ${Math.round(r.conf)}`);
  if (r.cutCheck) why.push(r.cutCheck);
  if (guessed) why.push(guessed);
  r.status = why.length ? 'Check' : 'OK';
  r.why = why.join('; ');
  if (r.include == null) r.include = r.qty != null;
  return r;
}
/** A cut length as OCR gives it: degree signs and slashes for foot marks. */
function scanCutText(t) {
  let v = scanFtIn(t);
  if (v != null) return v;
  const u = scanNorm(t).replace(/[\u00b0\u00ba\u2019\u2018`\u00b4]\s*/g, "'").replace(/'\s+/g, "'");
  v = scanFtIn(u);
  if (v != null) return v;
  const m = /^(\d+)\/(\d{1,2})(["\u201d])$/.exec(u); // 1/0" -> 1'0"
  if (m && (Number(m[2]) === 0 || Number(m[2]) < 12 && Number(m[1]) > Number(m[2]))) return scanFtIn(`${m[1]}'${m[2]}"`);
  return null;
}
function scanCutPieces(T) {
  const pieces = [];
  for (const r of T.rows) {
    for (let g = 1; g <= 4; g++) {
      const p = r.cells[`item${g}`], l = r.cells[`len${g}`], s = r.cells[`size${g}`];
      if (!l) continue;
      const ft = scanCutText(l.t);
      if (ft == null) continue;
      pieces.push({ piece: p ? p.t.replace(/[<>]/g, '') : '', ft, size: s ? (scanSize(s.t) || {}).main : null, text: l.t });
    }
  }
  return pieces;
}

/* ----------------------------------------------------------- title block */
const SCAN_TB = {
  drawing: [/^(DRAWING|DWG|DOC(UMENT)?|DRG)\.?\s*(NO|NUMBER|#)\.?:?/i, /[A-Z0-9]{1,}[-_][A-Z0-9][A-Z0-9_&-]{4,}/i],
  line: [/^LINE\s*(NO|NUMBER|#)\.?:?/i, /\d/],
  rev: [/^REV(ISION)?\.?\s*(NO\.?)?:?$/i, /^[A-Z0-9]{1,3}$/i],
  sheet: [/^SHEET(\s*NO\.?)?:?$/i, /^\d+(\s*(OF|\/)\s*\d+)?$/i],
  scale: [/^SCALE:?$/i, /\S/],
  size: [/^SIZE:?$/i, /^\d/],
  service: [/^SERV(ICE)?\.?:?$/i, /^[A-Z0-9-]{1,8}$/i],
  spec: [/^(PIPE\s*)?SPEC\.?:?$/i, /^[A-Z0-9-]{2,10}$/i],
  insul: [/^INSUL(ATION)?\.?:?$/i, /^[A-Z0-9-]{1,8}$/i],
};
function scanIsLabelText(t) { return Object.values(SCAN_TB).some(([re]) => re.test(t)) || /^(TITLE|PROJECT|DRAWN|CHECKED|APPROVED|DATE|ZONE|PAINT|HYDROTEST|PWHT|DESCRIPTION)\b/.test(t); }
function scanTitleBlock(lines, skip) {
  const tb = {};
  const isLab = (ws, i) => scanIsLabelText(ws[i].t) || (ws[i + 1] && scanIsLabelText(`${ws[i].t} ${ws[i + 1].t}`) && !scanIsLabelText(ws[i + 1].t));
  const cellsOf = lines.map((L) => {
    const raw = scanCells(L.words.filter((w) => !skip(w)), L.h, 1.6);
    const cells = [];
    raw.forEach((c) => {
      let cur = null;
      c.words.forEach((w, i) => {
        if (!cur || (i > 0 && isLab(c.words, i) && !isLab(c.words, i - 1))) { cur = { t: w.t, x0: w.x0, x1: w.x1, cy: w.cy, words: [w] }; cells.push(cur); }
        else { cur.t += ` ${w.t}`; cur.x1 = w.x1; cur.words.push(w); }
      });
    });
    return { L, cells };
  });
  // a large-font value can come back as two cells: 6" + -AB1-...
  const joined = (M, k) => {
    const row = cellsOf.find((x) => x.L === M) || { cells: [] };
    let t = k.t, x1 = k.x1;
    for (const n of row.cells.filter((o) => o.x0 > k.x1).sort((a, b) => a.x0 - b.x0)) {
      if (n.x0 - x1 > 6 * M.h || !/^[-&]/.test(n.t) && !/-$/.test(t)) break;
      t += n.t; x1 = n.x1;
    }
    return t;
  };
  const near = (L, c, valRe) => {
    const row = cellsOf.find((x) => x.L === L);
    const right = row.cells.filter((k) => k.x0 > c.x1 && k.x0 - c.x1 < 260).sort((a, b) => a.x0 - b.x0)[0];
    if (right && !scanIsLabelText(right.t) && valRe.test(right.t)) return joined(L, right);
    for (const dir of [1, -1]) {
      const cand = [];
      cellsOf.forEach(({ L: M, cells }) => {
        const dy = (M.cy - L.cy) * dir;
        if (dy <= 0 || dy > 3.2 * L.h) return;
        cells.forEach((k) => { if (k.x1 > c.x0 - 2 * L.h && k.x0 < c.x1 + 6 * L.h && !scanIsLabelText(k.t) && valRe.test(k.t)) cand.push({ k, dy, M }); });
      });
      cand.sort((a, b) => a.dy - b.dy || a.k.x0 - b.k.x0);
      if (cand[0]) return joined(cand[0].M, cand[0].k);
    }
    return '';
  };
  // a label can appear in the notes too ("REFER TO DOCUMENT NO ..."); the title
  // block is the one nearest the bottom-right corner
  const best = {};
  const pgW = Math.max(1, ...lines.flatMap((L) => L.words.map((w) => w.x1))), pgH = Math.max(1, ...lines.map((L) => L.cy));
  for (const { L, cells } of cellsOf) {
    for (const c of cells) {
      for (const [key, [labRe, valRe]] of Object.entries(SCAN_TB)) {
        const m = labRe.exec(c.t);
        if (!m) continue;
        const rest = c.t.slice(m[0].length).trim().replace(/^[:.]\s*/, '');
        let v = rest && valRe.test(rest) ? rest : '';
        if (!v && !rest) v = near(L, c, valRe);
        const score = L.cy + c.x0;
        if (key === 'drawing' && c.x0 < 0.45 * pgW) continue; // notes, not the title block (bottom right)
        if (v && (!best[key] || score > best[key].score)) best[key] = { v: v.replace(/\s+/g, ' ').trim(), score };
      }
    }
  }
  Object.entries(best).forEach(([k, b]) => { tb[k] = b.v; });
  // sanity checks: values that are really labels or other fields
  if (/^(PIPE|LINE|SIZE|SPEC|NO)$/i.test(tb.service || '')) delete tb.service;
  if (/^[O0]+$/i.test(tb.rev || '')) tb.rev = tb.rev.replace(/O/gi, '0');
  if (/^(CWP|EWP|CWA|IWP)\b/i.test(tb.line || '')) delete tb.line;
  const sh = /^(\d+)\s*(?:OF|\/)\s*(\d+)$/i.exec(tb.sheet || '');
  if (sh && Number(sh[1]) > Number(sh[2])) delete tb.sheet;
  if (tb.line) tb.line = tb.line.replace(/\s*-\s*/g, '-').replace(/["\u201d]\s*-/, '"-');
  return tb;
}

/* ------------------------------------------------------------------ tags */
const SCAN_TAG_RULES = [
  ['field weld', /^FW(-?\d{1,4})?$/],
  ['support', /^(PS|SP|PSU|SUP|PSP)-?\d{2,6}[A-Z]?$/],
  ['relief valve', /^(PSV|PRV|TSV|RV|SV)-?\d{2,6}[A-Z]?$/],
  ['control valve', /^(FV|PV|LV|TV|XV|HCV|FCV|PCV|LCV|TCV|SDV|BDV|ESDV|MOV|AV)-?\d{2,6}[A-Z]?$/],
  ['hand valve', /^(HV|MV)-?\d{2,6}[A-Z]?$/],
  ['instrument', /^(F|P|T|L|A|D|PD|DP|W|Z|S|E|H|J|K|Q|Y|M|B)(T|E|I|G|S|C|IT|IC|ID|DT|DI|SH|SL|SHH|SLL|AH|AL|Q|Y|R|W|X|Z|IR|IS|K|QI)-?\d{3,6}[A-Z]?$/],
  ['equipment', /^(P|V|E|T|TK|C|K|D|R|PK|SK|PKG|F|H|B|X|AC|M)-\d{3,6}[A-Z]?(\/[A-Z])?$/],
];
function scanTagKind(t) { for (const [k, re] of SCAN_TAG_RULES) if (re.test(t)) return k; return null; }
const SCAN_LINE_RE = /^\d+(?:[-.]\d\/\d|\.\d+)?["\u201d]?-[A-Z0-9]{1,6}-[A-Z0-9][A-Z0-9&-]{3,}$/;
function scanTags(words, skip) {
  const ws = words.filter((w) => !skip(w));
  const used = new Set();
  const tags = [];
  const add = (t, w, how) => { const k = scanTagKind(t); if (k) tags.push({ tag: t, kind: k, x: (w.x0 + w.x1) / 2, y: w.cy, how }); };
  // bubbles: letters over a number (FT / 1101)
  ws.forEach((a, i) => {
    if (!/^[A-Z]{2,4}$/.test(a.t)) return;
    const b = ws.find((w, j) => j !== i && !used.has(j) && /^\d{3,6}[A-Z]?$/.test(w.t) && w.cy > a.cy && w.cy - a.cy < 2.6 * a.h && Math.abs((w.x0 + w.x1) / 2 - (a.x0 + a.x1) / 2) < 1.6 * a.h);
    if (b && scanTagKind(`${a.t}-${b.t}`)) { used.add(i); used.add(ws.indexOf(b)); add(`${a.t}-${b.t}`, a, 'bubble'); }
  });
  ws.forEach((w, i) => {
    if (used.has(i)) return;
    const t = w.t.replace(/[.,;:)]+$/, '').replace(/^[(]+/, '');
    if (/^FW$/.test(t)) { tags.push({ tag: 'FW', kind: 'field weld', x: (w.x0 + w.x1) / 2, y: w.cy, how: 'mark' }); return; }
    if (ws.some((o) => /^LICEN[CS]E|^PERMIT|^CERT/i.test(o.t) && Math.abs(o.cy - w.cy) < 3 * w.h && o.x0 < w.x0 + 4 * w.h && w.x0 - o.x1 < 30 * w.h)) return;
    add(t, w, 'text');
  });
  const lines = ws.map((w) => w.t.replace(/[.,;]+$/, '')).filter((t) => SCAN_LINE_RE.test(t));
  return { tags, lineNos: [...new Set(lines)] };
}

/* ------------------------------------------------------------ one sheet */
/** Parse a sheet's words → tables, material rows, title block, tags. Pure. */
function scanParseSheet(sheet) {
  const lines = scanLines(sheet.words);
  const tables = scanTables(lines);
  const inTable = (w) => tables.some((T) => w.cy >= T.y0 - T.h && w.cy <= T.y1 + T.h && w.x1 > T.x0 && w.x0 < T.x1);
  sheet.tables = tables;
  sheet.rows = [];
  sheet.cut = [];
  tables.forEach((T) => { if (T.type === 'bom') sheet.rows.push(...scanBomRows(T, sheet)); else sheet.cut.push(...scanCutPieces(T)); });
  // de-duplicate rows read twice (overlapping header runs)
  const seen = new Set();
  sheet.rows = sheet.rows.filter((r) => { const k = `${r.item}|${r.desc}|${r.qtyText}|${Math.round(r.cy)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  sheet.tb = scanTitleBlock(lines, inTable);
  const tg = scanTags(sheet.words, inTable);
  sheet.tags = tg.tags;
  if (!sheet.tb.line && tg.lineNos.length === 1) sheet.tb.line = tg.lineNos[0];
  sheet.lineNos = tg.lineNos;
  sheet.fw = (() => { const f = tg.tags.filter((t) => t.kind === 'field weld'); const named = new Set(f.filter((t) => t.tag !== 'FW').map((t) => t.tag)); return named.size + f.filter((t) => t.tag === 'FW').length; })();
  // cut-length cross-check against the BOM pipe quantity, by size
  if (sheet.cut.length) {
    const pipe = sheet.rows.filter((r) => r.cls === 'pipe' && r.ft != null);
    const bySize = {};
    sheet.cut.forEach((p) => { const k = p.size || (pipe[0] && pipe[0].size) || 0; bySize[k] = (bySize[k] || 0) + p.ft; });
    pipe.forEach((r) => {
      const c = bySize[r.size];
      if (c == null) return;
      r.cutTotal = c;
      if (Math.abs(c - r.ft) > 1 / 12) {
        // OCR reads a foot mark as 7, 1 or / now and then (1'0" as 170"): try each
        // way of putting it back on pieces with no foot mark; keep it only if the
        // pieces then add up to the BOM quantity exactly
        const alt = (p) => { const t = scanNorm(p.text); if (/'/.test(t)) return []; const out = []; for (let i = 1; i < t.length - 1; i++) { if (/[71\/]/.test(t[i])) { const v = scanFtIn(`${t.slice(0, i)}'${t.slice(i + 1)}`); if (v != null) out.push(v); } if (/\d/.test(t[i - 1]) && /\d/.test(t[i])) { const v = scanFtIn(`${t.slice(0, i)}'${t.slice(i)}`); if (v != null) out.push(v); } } return out; };
        const same = sheet.cut.filter((p) => (p.size || r.size) === r.size);
        for (const p of same) {
          const fix = alt(p).find((v) => Math.abs(c - p.ft + v - r.ft) < 1 / 192);
          if (fix != null) { p.fixed = `${p.text} read as ${scanFmtFt(fix)}`; p.ft = fix; break; }
        }
        const c2 = same.reduce((a, p) => a + p.ft, 0);
        if (Math.abs(c2 - r.ft) <= 1 / 12) { r.cutTotal = c2; r.cutOk = true; r.cutNote = same.filter((p) => p.fixed).map((p) => p.fixed).join('; '); return; }
      }
      if (Math.abs(c - r.ft) > 1 / 12) { r.cutCheck = `cut pieces total ${scanFmtFt(c)}, BOM says ${scanFmtFt(r.ft)}`; scanFinishRow(r); }
      else r.cutOk = true;
    });
  }
  sheet.lineSize = (() => {
    const s = scanSize(sheet.tb.size || '') || scanSize(String(sheet.tb.line || '').split('-')[0]);
    if (s) return s.main;
    const p = sheet.rows.filter((r) => r.cls === 'pipe' && r.size).sort((a, b) => (b.ft || 0) - (a.ft || 0))[0];
    return p ? p.size : null;
  })();
  const fileNo = String(sheet.file).replace(/\.pdf$/i, '').replace(/\s*\(.*\)$/, '').replace(/_[A-Z0-9]{1,2}$/i, '');
  const squash = (t) => String(t).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0');
  // OCR read only the start of the number and the file name carries all of it
  if (sheet.tb.drawing && sheet.src === 'ocr' && squash(fileNo).startsWith(squash(sheet.tb.drawing)) && fileNo.length > sheet.tb.drawing.length) delete sheet.tb.drawing;
  if (!sheet.tb.drawing) {
    const ref = typeof pdfTkDrawingRef === 'function' ? pdfTkDrawingRef(sheet.file, sheet.page) : [];
    sheet.tb.drawing = ref.length ? ref[0].doc_no : String(sheet.file).replace(/\.pdf$/i, '').replace(/\s*\(.*\)$/, '');
    sheet.tb.drawingFrom = 'file name';
  }
  return sheet;
}
/** Re-parse after an edit, keeping title-block fields and FW count the user typed. */
function scanParseSheetKeepTb(sheet) {
  const tb = { ...sheet.tb }, fw = sheet.fwLocked;
  scanParseSheet(sheet);
  Object.assign(sheet.tb, tb);
  if (fw != null) sheet.fw = fw;
  const s2 = scanSize(sheet.tb.size || '') || scanSize(String(sheet.tb.line || '').split('-')[0]);
  if (s2) sheet.lineSize = s2.main;
  return sheet;
}
function scanFmtFt(ft) {
  if (ft == null) return '';
  const six = Math.round(ft * 12 * 16);
  const f = Math.floor(six / 192), rest = six - f * 192;
  const whole = Math.floor(rest / 16); let n = rest - whole * 16, d = 16;
  while (n && n % 2 === 0) { n /= 2; d /= 2; }
  return `${f}'-${whole}${n ? ` ${n}/${d}` : ''}"`;
}

/* --------------------------------------------------------------- rollup */
function scanLibFind(re, size) {
  const lib = (typeof D !== 'undefined' && D.mh_library) || [];
  const hits = lib.filter((m) => re.test(m.description || m.work_item || ''));
  if (!hits.length) return null;
  if (size == null) return hits[0];
  const band = (m) => { const b = /(\d+)\s*-\s*(\d+)\s*in/i.exec(m.description || m.work_item || ''); return b ? [Number(b[1]), Number(b[2])] : null; };
  const banded = hits.map((m) => ({ m, b: band(m) })).filter((x) => x.b);
  if (!banded.length) return hits[0];
  const inBand = banded.find((x) => size >= x.b[0] && size <= x.b[1]);
  if (inBand) return inBand.m;
  banded.sort((a, b) => a.b[0] - b.b[0]);
  return size < banded[0].b[0] ? banded[0].m : banded[banded.length - 1].m;
}
function scanWeldKey(mat) {
  const wf = (typeof D !== 'undefined' && D.weld_factors) || [];
  const f = (re) => (wf.find((w) => re.test(w.material || '')) || {}).key || '';
  if (mat === 'A333') return f(/A333|low temp/i);
  if (mat === 'P11') return f(/P11/i);
  if (mat === 'P22') return f(/P22/i);
  if (mat === 'P91') return f(/P91/i);
  if (mat === 'SS') return f(/stainless|A312|304|316/i);
  if (mat === 'CS') return f(/A106|carbon steel(?!.*A333)/i);
  return '';
}

/** Sheets → proposed takeoff lines. Each: { id, key, qty, uom, basis, refs[], src[], include, disc, weld_key }. */
function scanRollup(sheets, opts = {}) {
  const P = new Map();
  const put = (id, re, size, qty, basis, sheet, extra = {}) => {
    if (!(qty > 0)) return;
    const lib = scanLibFind(re, size);
    const key = opts.perDrawing ? `${id}|${lib ? lib.key : id}|${sheet.id}` : `${id}|${lib ? lib.key : id}`;
    const p = P.get(key) || { id: key, rule: id, key: lib ? lib.key : '', disc: lib ? lib.discipline : '', uom: lib ? lib.uom : '', qty: 0, basis, src: [], refs: [], include: extra.include !== false, mats: new Set(), note: extra.note || '' };
    p.qty += qty;
    p.src.push(`${sheet.tb.drawing || sheet.file} p${sheet.page}: ${extra.how || Math.round(qty * 100) / 100}`);
    if (!p.refs.includes(sheet.id)) p.refs.push(sheet.id);
    if (extra.mat) p.mats.add(extra.mat);
    if (extra.include === false) p.include = false;
    P.set(key, p);
  };
  const bomSheets = sheets.filter((s) => s.rows.some((r) => r.include));
  const bomTags = new Set();
  bomSheets.forEach((s) => s.tags.forEach((t) => bomTags.add(t.tag)));
  const counted = new Set(); // a tag on several P&IDs is one item
  const anyBom = (cls) => bomSheets.some((s) => s.rows.some((r) => r.include && r.cls === cls));

  for (const s of sheets) {
    const rows = s.rows.filter((r) => r.include && r.qty != null);
    const size = s.lineSize;
    const sw = rows.some((r) => r.ends === 'SW') && !rows.some((r) => r.ends === 'BW');
    // pipe by size band
    rows.filter((r) => r.cls === 'pipe').forEach((r) => {
      const ft = r.ft != null ? r.ft : r.qty;
      put('pipe', /erect pipe|pipe,? (handle|erect|install)/i, r.size || size, ft, 'Pipe length from the BOM, by size band', s, { how: `${Math.round(ft * 100) / 100} ft of ${r.size || '?'} in`, mat: r.material });
    });
    // welds
    let bwEnds = 0, swEnds = 0;
    rows.forEach((r) => { const e = scanWeldEnds(r.cls, r.ends, r.desc) * r.qty; if (r.ends === 'SW') swEnds += e; else if (r.ends === 'BW' || (r.cls === 'flange' && !/SO|FLG/.test(r.ends) && r.ends !== '')) bwEnds += e; else if (r.cls === 'flange' && /\bWN\b|WELD\s*NECK/i.test(r.desc)) bwEnds += e; });
    const mat = (rows.find((r) => r.cls === 'pipe') || rows[0] || {}).material || '';
    if (sw) {
      if (swEnds) put('sw', /socket weld/i, null, swEnds, 'Socket welds: SW fitting and valve ends (elbow 2, tee 3, coupling 2, flange 1, valve 2)', s, { how: `${swEnds} ends`, mat });
    } else {
      if (s.fw) put('fw', /field butt weld|butt weld/i, size, s.fw, 'Field welds: FW marks on the drawing, at the line size', s, { how: `${s.fw} FW marks`, mat });
      if (swEnds) put('sw', /socket weld/i, null, swEnds, 'Socket welds: SW fitting and valve ends', s, { how: `${swEnds} ends`, mat });
      const shop = Math.max(0, bwEnds - s.fw);
      if (shop) put('shop', /field butt weld|butt weld/i, size, shop, 'Shop butt welds (approximate): BW fitting ends less field welds. Off by default — usually priced with spool fabrication', s, { how: `${bwEnds} ends - ${s.fw} FW`, include: false, mat });
    }
    // bolt-ups from gaskets; else flanged joints from flanges
    const gaskets = rows.filter((r) => r.cls === 'gasket').reduce((a, r) => a + r.qty, 0);
    const flanges = rows.filter((r) => r.cls === 'flange').reduce((a, r) => a + r.qty, 0);
    if (gaskets) put('boltup', /bolt-?up/i, null, gaskets, 'Flange bolt-ups: one per gasket in the BOM', s, { how: `${gaskets} gaskets` });
    else if (flanges) put('boltup', /bolt-?up/i, null, Math.ceil(flanges / 2), 'Flange bolt-ups: half the flanges (no gaskets listed) — check', s, { how: `${flanges} flanges / 2` });
    // valves, supports
    const valves = rows.filter((r) => r.cls === 'valve').reduce((a, r) => a + r.qty, 0);
    const cvs = rows.filter((r) => r.cls === 'control valve').reduce((a, r) => a + r.qty, 0);
    const sups = rows.filter((r) => r.cls === 'support').reduce((a, r) => a + r.qty, 0);
    if (valves) put('valve', /manual valve/i, null, valves, 'Manual valves from the BOM', s);
    if (cvs) { put('cv', /control valve, install|control valve install/i, null, cvs, 'Control valves from the BOM', s); put('cvi', /control valve instrumentation|tie-in/i, null, cvs, 'Control valve instrument tie-in, one per control valve', s); }
    if (sups) put('support', /pipe support/i, null, sups, 'Pipe supports from the BOM', s);
    else if (!rows.length) {
      const ps = new Set(s.tags.filter((t) => t.kind === 'support').map((t) => t.tag));
      if (ps.size) put('support', /pipe support/i, null, ps.size, 'Pipe supports: PS tags on the drawing (no BOM read)', s, { how: `${ps.size} tags` });
    }
    // paint / insulation surface (off by default)
    rows.filter((r) => r.cls === 'pipe' && r.size).forEach((r) => {
      const sf = (r.ft != null ? r.ft : r.qty) * Math.PI * scanOD(r.size) / 12;
      put('paint', /primer/i, null, sf, 'Pipe outside surface for painting: length x pi x OD (ASME B36.10M). Off by default', s, { how: `${Math.round(sf)} sf`, include: false });
      const ins = String(s.tb.insul || '').toUpperCase();
      if (ins && !/^(N|NO|NONE|-|0)$/.test(ins)) {
        put('insul', /^C/.test(ins) ? /insulation, cold/i : /insulation, hot/i, null, sf, `Insulated surface (code ${ins}): bare pipe OD area, before insulation thickness. Off by default`, s, { how: `${Math.round(sf)} sf`, include: false });
      }
    });
    // tags from sheets without a BOM (P&IDs, layouts); skip tags already on a BOM sheet
    if (!rows.length) {
      const uniq = new Map();
      s.tags.forEach((t) => { if (t.tag === 'FW') return; if (bomTags.has(t.tag) && /valve|support/.test(t.kind)) return; if (counted.has(t.tag)) return; uniq.set(t.tag, t); });
      uniq.forEach((t, k) => counted.add(k));
      const of = (k) => [...uniq.values()].filter((t) => t.kind === k);
      const inst = of('instrument');
      const inl = inst.filter((t) => /^(F|T|A)/.test(t.tag)), imp = inst.filter((t) => !/^(F|T|A)/.test(t.tag));
      if (inl.length) put('inl', /in-line/i, null, inl.length, 'Instruments, in-line type (flow, temperature, analyser tags)', s, { how: inl.map((t) => t.tag).join(', ') });
      if (imp.length) put('imp', /impulse/i, null, imp.length, 'Instruments, impulse-line type (pressure, level tags)', s, { how: imp.map((t) => t.tag).join(', ') });
      const cv = of('control valve');
      if (cv.length && !anyBom('control valve')) { put('cv', /control valve, install|control valve install/i, null, cv.length, 'Control valves: valve tags on the drawing', s, { how: cv.map((t) => t.tag).join(', ') }); put('cvi', /control valve instrumentation|tie-in/i, null, cv.length, 'Control valve instrument tie-in, one per control valve tag', s); }
      const hv = [...of('hand valve'), ...of('relief valve')];
      if (hv.length && !anyBom('valve')) put('valve', /manual valve/i, null, hv.length, 'Manual / relief valves: tags on the drawing', s, { how: hv.map((t) => t.tag).join(', ') });
      if (inst.length + cv.length) put('loop', /loop check/i, null, inst.length + cv.length, 'Loop checks, one per instrument and control valve tag. Off by default', s, { include: false });
      const eq = of('equipment');
      const E = [['pump', /^P-/, /pump/i], ['comp', /^(C|K)-/, /compressor/i], ['vessel', /^(V|D)-/, /vertical vessel/i], ['exch', /^E-/, /exchanger/i], ['tank', /^(T|TK)-/, /tank/i], ['pkg', /^(PK|SK|PKG)-/, /package|skid/i]];
      E.forEach(([id, tre, lre]) => { const n = eq.filter((t) => tre.test(t.tag)); if (n.length) put(`eq-${id}`, lre, null, n.length, `Equipment tags ${n.map((t) => t.tag).join(', ')}`, s, { how: n.map((t) => t.tag).join(', ') }); });
    }
  }
  const out = [...P.values()].map((p) => {
    p.qty = Math.round(p.qty * 100) / 100;
    p.weld_key = p.disc === 'Piping' ? scanWeldKey([...p.mats][0] || '') : '';
    delete p.mats;
    return p;
  });
  const order = ['pipe', 'fw', 'sw', 'shop', 'boltup', 'valve', 'cv', 'cvi', 'support', 'inl', 'imp', 'loop', 'paint', 'insul'];
  out.sort((a, b) => ((order.indexOf(a.rule) + 1) || 99) - ((order.indexOf(b.rule) + 1) || 99) || String(a.key).localeCompare(String(b.key)));
  return out;
}

/* ------------------------------------------------------------------ OCR */
const SCAN_OCR = { worker: null, loading: null, psm: null, idle: 0 };
function scanLoadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(`could not load ${src}`)); document.head.appendChild(s); });
}
async function scanOcrWorker(onProgress) {
  clearTimeout(SCAN_OCR.idle);
  if (SCAN_OCR.worker) return SCAN_OCR.worker;
  if (!SCAN_OCR.loading) {
    SCAN_OCR.loading = (async () => {
      const base = new URL(`${EST_ROOT}vendor/tesseract/`, document.baseURI).href;
      if (typeof Tesseract === 'undefined') await scanLoadScript(`${base}tesseract.min.js`);
      if (location.protocol === 'file:') { try { await fetch(`${base}README.txt`); } catch (e) { throw new Error(`Text recognition needs the installed app: open ${EST_BRAND} from its desktop icon (or the hosted site). Opened straight from a folder, the browser blocks it.`); } }
      const w = await Tesseract.createWorker('eng', 1, {
        workerPath: `${base}worker.min.js`, corePath: `${base}tesseract-core-simd-lstm.wasm.min.js`, langPath: base, gzip: true, cachePath: 'vissrad-ocr-fast-1',
        logger: (m) => { if (SCAN_OCR.onProgress) SCAN_OCR.onProgress(m); },
      });
      SCAN_OCR.worker = w;
      return w;
    })();
  }
  SCAN_OCR.onProgress = onProgress;
  try { return await SCAN_OCR.loading; } catch (e) { SCAN_OCR.loading = null; throw e; }
}
function scanOcrRelease() {
  clearTimeout(SCAN_OCR.idle);
  SCAN_OCR.idle = setTimeout(() => { if (SCAN_OCR.worker) { SCAN_OCR.worker.terminate(); SCAN_OCR.worker = null; SCAN_OCR.loading = null; SCAN_OCR.psm = null; } }, 120000);
}
/** Render a page area to a white canvas at `dpi`; returns { canvas, scale }. */
async function scanRender(page, clip, dpi) {
  const base = page.getViewport({ scale: 1 });
  const r = clip || { x0: 0, y0: 0, x1: base.width, y1: base.height };
  const w = r.x1 - r.x0, h = r.y1 - r.y0;
  const scale = Math.min(dpi / 72, Math.sqrt(SCAN_MAX_PX / (w * h)));
  const vp = page.getViewport({ scale, offsetX: -r.x0 * scale, offsetY: -r.y0 * scale });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport: vp, background: 'rgb(255,255,255)' }).promise;
  return { canvas: c, scale, x0: r.x0, y0: r.y0 };
}
/** Whiten long horizontal and vertical ink runs (table rules, borders, pipe
    lines) so OCR sees letters, not boxes. `minRun` in pixels. */
function scanUnrule(canvas, minRun) {
  const w = canvas.width, h = canvas.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, w, h), d = img.data;
  const grey = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < grey.length; i += 4, j++) grey[j] = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
  const kill = new Uint8Array(w * h);
  const run = Math.max(24, Math.round(minRun));
  const LINE = 215; // faint rules count as lines too
  for (let y = 0; y < h; y++) { let s = -1; for (let x = 0; x <= w; x++) { const on = x < w && grey[y * w + x] < LINE; if (on && s < 0) s = x; else if (!on && s >= 0) { if (x - s >= run) for (let k = s; k < x; k++) kill[y * w + k] = 1; s = -1; } } }
  for (let x = 0; x < w; x++) { let s = -1; for (let y = 0; y <= h; y++) { const on = y < h && grey[y * w + x] < LINE; if (on && s < 0) s = y; else if (!on && s >= 0) { if (y - s >= run) for (let k = s; k < y; k++) kill[k * w + x] = 1; s = -1; } } }
  // black-and-white, rules removed, lone specks dropped
  const ink = new Uint8Array(w * h);
  const INK = ((typeof window !== 'undefined' && window.__SCAN_OPTS) || {}).ink || SCAN_INK.v;
  for (let j = 0; j < ink.length; j++) ink[j] = !kill[j] && grey[j] < INK ? 1 : 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const j = y * w + x;
    if (ink[j] && !ink[j - 1] && !ink[j + 1] && !ink[j - w] && !ink[j + w] && !ink[j - w - 1] && !ink[j - w + 1] && !ink[j + w - 1] && !ink[j + w + 1]) ink[j] = 2;
  }
  for (let j = 0, i = 0; j < ink.length; j++, i += 4) { const v = ink[j] === 1 ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  g.putImageData(img, 0, 0);
}
async function scanOcr(page, clip, dpi, psm, onProgress) {
  const W = await scanOcrWorker(onProgress);
  const key = `${psm}/${Math.round(dpi)}`;
  if (SCAN_OCR.psm !== key) { await W.setParameters({ tessedit_pageseg_mode: String(psm), preserve_interword_spaces: '1', user_defined_dpi: String(Math.round(dpi)) }); SCAN_OCR.psm = key; }
  // small crops: render with a margin so table rules are long enough to be
  // found and removed, then blank the margin
  const small = clip && (clip.x1 - clip.x0 < 60 || clip.y1 - clip.y0 < 60);
  const vp0 = page.getViewport({ scale: 1 });
  const M = 30;
  const big = small ? { x0: Math.max(0, clip.x0 - M), y0: Math.max(0, clip.y0 - M), x1: Math.min(vp0.width, clip.x1 + M), y1: Math.min(vp0.height, clip.y1 + M) } : clip;
  const R = await scanRender(page, big, dpi);
  scanUnrule(R.canvas, 19 * R.scale);
  if (small) {
    const g = R.canvas.getContext('2d');
    const ix0 = (clip.x0 - R.x0) * R.scale, iy0 = (clip.y0 - R.y0) * R.scale, ix1 = (clip.x1 - R.x0) * R.scale, iy1 = (clip.y1 - R.y0) * R.scale;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, R.canvas.width, iy0); g.fillRect(0, iy1, R.canvas.width, R.canvas.height - iy1);
    g.fillRect(0, iy0, ix0, iy1 - iy0); g.fillRect(ix1, iy0, R.canvas.width - ix1, iy1 - iy0);
  }
  const { data } = await W.recognize(R.canvas, {}, { blocks: true, text: false });
  const out = [];
  (data.blocks || []).forEach((b) => (b.paragraphs || []).forEach((p) => (p.lines || []).forEach((l) => (l.words || []).forEach((w) => {
    const t = String(w.text || '').trim().replace(/^[\[\]|{}_\u2014]+|[\[\]|{}_\u2014]+$/g, '');
    if (!t || w.confidence < 20 || !/[A-Za-z0-9]/.test(t)) return;
    const k = 1 / R.scale, bb = w.bbox;
    const y0 = R.y0 + bb.y0 * k, y1 = R.y0 + bb.y1 * k;
    out.push({ t, x0: R.x0 + bb.x0 * k, x1: R.x0 + bb.x1 * k, y0, y1, cy: (y0 + y1) / 2, h: (y1 - y0) * 0.85, conf: w.confidence, src: 'ocr' });
  }))));
  R.canvas.width = R.canvas.height = 0;
  return out;
}
/** Group words near the given anchors into areas worth a 300 dpi read. */
function scanOcrAreas(words, pageW, pageH) {
  const anchor = (w) => /^(QTY|QUANTITY|DESCRIPTION|COMPONENT|MATERIALS?|PIECE|LENGTH|N\.?B\.?|NPS|LINE|DOC|DRAWING|DWG|REV|SHEET|SCALE|SIZE|SERV\.?|SPEC|INSUL\.?|ITEM)$/i.test(w.t.replace(/[:.]+$/, ''));
  const pad = 14;
  const areas = [];
  const h = scanMedian(words.map((w) => w.h)) || 8;
  const used = new Set();
  words.forEach((a, i) => {
    if (!anchor(a) || used.has(i)) return;
    // grow a cluster from the anchor over nearby words
    const box = { x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1 };
    let grew = true;
    used.add(i);
    while (grew) {
      grew = false;
      words.forEach((w, j) => {
        if (used.has(j)) return;
        if (w.x0 < box.x1 + 9 * h && w.x1 > box.x0 - 9 * h && w.y0 < box.y1 + 4.5 * h && w.y1 > box.y0 - 4.5 * h) {
          used.add(j); box.x0 = Math.min(box.x0, w.x0); box.x1 = Math.max(box.x1, w.x1); box.y0 = Math.min(box.y0, w.y0); box.y1 = Math.max(box.y1, w.y1); grew = true;
        }
      });
    }
    // tables: right-aligned quantities the coarse pass missed sit just outside the cluster
    const tab = /^(QTY|QUANTITY|DESCRIPTION|COMPONENT|MATERIALS?|PIECE|LENGTH|N\.?B\.?|NPS|ITEM)$/i.test(a.t.replace(/[:.]+$/, ''));
    const px = tab ? Math.max(pad, 0.05 * pageW) : pad;
    areas.push({ tab: tab && /^(QTY|QUANTITY|PIECE)$/i.test(a.t.replace(/[:.]+$/, '')), x0: Math.max(0, box.x0 - px), y0: Math.max(0, box.y0 - pad), x1: Math.min(pageW, box.x1 + px), y1: Math.min(pageH, box.y1 + pad + (tab ? 2 * h : 0)) });
  });
  // merge overlapping areas
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < areas.length && !merged; i++) for (let j = i + 1; j < areas.length && !merged; j++) {
      const A = areas[i], B = areas[j];
      const yov = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0), gap = Math.max(A.x0, B.x0) - Math.min(A.x1, B.x1);
      if ((A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1) || (yov > 0.5 * Math.min(A.y1 - A.y0, B.y1 - B.y0) && gap < 0.3 * pageW)) { areas[i] = { tab: A.tab || B.tab, x0: Math.min(A.x0, B.x0), y0: Math.min(A.y0, B.y0), x1: Math.max(A.x1, B.x1), y1: Math.max(A.y1, B.y1) }; areas.splice(j, 1); merged = true; }
    }
  }
  areas.forEach((A) => { A.tab = words.some((w) => /^(QTY|QUANTITY|PIECE|MATERIALS|BILL)$/i.test(w.t.replace(/[:.]+$/, '')) && w.cy > A.y0 && w.cy < A.y1 && w.x0 > A.x0 && w.x1 < A.x1); });
  // the iso / P&ID body is never re-read whole: cap an area at 45% of the sheet
  return areas.filter((A) => (A.x1 - A.x0) * (A.y1 - A.y0) < 0.45 * pageW * pageH);
}

/** Read one sheet's words: text layer, or OCR (two passes). */
// ink cut-off for black-and-white: scanned paper (one big image) is cut harder
// than thin anti-aliased vector strokes
const SCAN_INK = { v: 200 };
async function scanIsRaster(page) {
  try {
    const ops = await page.getOperatorList();
    const O = (await estPdfjs()).OPS;
    if (!O) return false;
    let img = 0, path = 0;
    ops.fnArray.forEach((f) => { if (f === O.paintImageXObject || f === O.paintInlineImageXObject || f === O.paintJpegXObject) img++; else if (f === O.constructPath) path++; });
    return img > 0 && path < 60;
  } catch (e) { return false; }
}
async function scanReadSheet(sheet, onStatus, force) {
  const page = await sheet.doc.getPage(sheet.page);
  const vp = page.getViewport({ scale: 1 });
  sheet.w = vp.width; sheet.h = vp.height;
  const tc = await page.getTextContent();
  const textWords = scanWordsFromText(tc, vp);
  const alnum = textWords.reduce((a, w) => a + (w.t.match(/[A-Za-z0-9]/g) || []).length, 0);
  sheet.textChars = alnum;
  if (!force && alnum >= SCAN_MIN_TEXT) { sheet.words = textWords; sheet.src = 'text'; return sheet; }
  sheet.src = 'ocr';
  sheet.raster = await scanIsRaster(page);
  SCAN_INK.v = sheet.raster ? 165 : 200;
  const prog = (stage) => (m) => { if (m && m.status === 'recognizing text') onStatus(`${stage} ${Math.round((m.progress || 0) * 100)}%`); else if (m && m.status) onStatus(`${m.status}`); };
  onStatus('reading the whole sheet (OCR)');
  // whole sheet at 200 dpi, in tiles when the sheet is large (D/E size)
  const dpi0 = 200, k0 = dpi0 / 72, tileMax = 9e6;
  const nx = Math.max(1, Math.ceil(Math.sqrt((vp.width * vp.height * k0 * k0) / tileMax) * (vp.width / vp.height) ** 0.5));
  const ny = Math.max(1, Math.ceil((vp.width * vp.height * k0 * k0) / tileMax / nx));
  const ov = 24;
  let coarse = [];
  for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
    const T = { x0: Math.max(0, (vp.width * tx) / nx - ov), x1: Math.min(vp.width, (vp.width * (tx + 1)) / nx + ov), y0: Math.max(0, (vp.height * ty) / ny - ov), y1: Math.min(vp.height, (vp.height * (ty + 1)) / ny + ov) };
    const n = ty * nx + tx + 1;
    const ws = await scanOcr(page, nx * ny > 1 ? T : null, dpi0, 11, prog(nx * ny > 1 ? `reading the whole sheet, part ${n} of ${nx * ny} (OCR)` : 'reading the whole sheet (OCR)'));
    // keep each word once: the tile whose own (un-overlapped) cell holds its centre
    const cx0 = (vp.width * tx) / nx, cx1 = (vp.width * (tx + 1)) / nx, cy0 = (vp.height * ty) / ny, cy1 = (vp.height * (ty + 1)) / ny;
    coarse = coarse.concat(ws.filter((w) => { const cx = (w.x0 + w.x1) / 2; return cx >= cx0 && cx < cx1 && w.cy >= cy0 && w.cy < cy1; }));
  }
  const areas = scanOcrAreas(coarse, vp.width, vp.height);
  sheet.ocrAreas = areas;
  let words = coarse;
  for (let i = 0; i < areas.length; i++) {
    onStatus(`reading area ${i + 1} of ${areas.length} at high resolution`);
    const A = areas[i];
    const O = (typeof window !== 'undefined' && window.__SCAN_OPTS) || {};
    const fine = await scanOcr(page, A, O.dpi || 300, O.psm || (A.tab ? 6 : 11), prog(`area ${i + 1} of ${areas.length}`));
    words = words.filter((w) => !(w.cy > A.y0 && w.cy < A.y1 && w.x0 >= A.x0 - 2 && w.x1 <= A.x1 + 2)).concat(fine);
  }
  // keep any genuine text-layer words (stamps, revision clouds) that OCR did not cover
  sheet.words = words.concat(textWords.filter((t) => !words.some((w) => Math.abs(w.cy - t.cy) < t.h && w.x0 < t.x1 && t.x0 < w.x1)));
  scanOcrRelease();
  return sheet;
}

/** OCR sheets: re-read empty quantity / size / item cells of BOM rows one
    cell at a time (single-line mode, 300 dpi), then parse again. */
async function scanRetryCells(sheet, onStatus) {
  if (sheet.src !== 'ocr') return 0;
  const page = await sheet.doc.getPage(sheet.page);
  const jobs = [];
  sheet.tables.filter((T) => T.type === 'bom').forEach((T) => {
    const col = (k) => T.cols.find((c) => c.kind === k);
    const right = T.cols.reduce((a, c) => Math.max(a, c.x1), 0);
    T.rows.filter((r) => !r.section && r.cells.desc && !/^[A-Z /&-]+$/.test(r.raw || '')).forEach((r) => {
      [['qty', (c) => [c.x0 - 8 * T.h, Math.max(c.x1 + 9 * T.h, right + 2 * T.h)]], ['size', (c) => [c.x0 - 2 * T.h, c.x1 + 2 * T.h]], ['item', (c) => [c.x0 - 1.5 * T.h, c.x1 + 1.5 * T.h]]].forEach(([k, span]) => {
        const c = col(k);
        if (!c) return;
        const have = r.cells[k];
        const pipeRow = /^\W*PIPE\b(?!\s*SUPPORT)/i.test(r.cells.desc.t || '');
        const weak = have && k === 'qty' && (have.conf < 50 || (pipeRow && !/['"\u2019\u201dM]|FT|LF/i.test(have.t)) || !/\d/.test(have.t));
        if (have && !weak) return;
        const [x0, x1] = span(c);
        const others = T.cols.filter((o) => o !== c);
        const lo = Math.max(x0, ...others.filter((o) => o.x1 < c.x0 + 1).map((o) => o.kind === 'desc' ? -Infinity : o.x1 + 0.5 * T.h));
        jobs.push({ k, r, A: { x0: Math.max(0, lo), x1: Math.min(sheet.w, x1), y0: r.cy - 1.6 * T.h, y1: r.cy + 1.6 * T.h } });
      });
    });
  });
  // cut lists: a piece number or size with no cut length beside it
  sheet.tables.filter((T) => T.type === 'cut').forEach((T) => {
    const items = T.cols.filter((c) => c.kind === 'item').sort((a, b) => a.x0 - b.x0);
    T.rows.forEach((r) => items.forEach((ic, gi) => {
      const g = gi + 1;
      if (r.cells[`len${g}`] || !(r.cells[`item${g}`] || r.cells[`size${g}`])) return;
      const lc = T.cols.find((c) => c.kind === 'len' && c.x0 > ic.x0 && (!items[g] || c.x0 < items[g].x0));
      if (!lc) return;
      const nx = T.cols.filter((c) => c.x0 > lc.x0).sort((a, b) => a.x0 - b.x0)[0];
      jobs.push({ k: 'len', g, r, A: { x0: ic.x1 + 0.5 * T.h, x1: nx ? nx.x0 - 0.3 * T.h : lc.x1 + 6 * T.h, y0: r.cy - 1.6 * T.h, y1: r.cy + 1.6 * T.h } });
    }));
  });
  let got = 0;
  for (const [i, j] of jobs.slice(0, 40).entries()) {
    onStatus(`re-reading empty cell ${i + 1} of ${Math.min(40, jobs.length)}`);
    const ws = await scanOcr(page, j.A, 300, 7, () => {});
    if (typeof window !== 'undefined' && window.__SCAN_OPTS && window.__SCAN_OPTS.log) window.__SCAN_OPTS.log.push(`${j.k}${j.g || ''} @${Math.round(j.A.x0)}-${Math.round(j.A.x1)},${Math.round(j.r.cy)}: ${ws.map((w) => w.t).join(' ')}`);
    const keep = ws.filter((w) => w.cy > j.A.y0 && w.cy < j.A.y1 && (j.k === 'item' || /\d/.test(w.t)));
    if (!keep.length) continue;
    const t = keep.map((w) => w.t).join(' ');
    const okv = j.k === 'len' ? (scanFtIn(t) != null || scanCutText(t) != null) : j.k === 'qty' ? (scanQty(t, true) || scanFtIn(t) != null || /^\d+[-.,\s]+\d{1,2}["\u201d]$/.test(scanNorm(t))) : j.k === 'size' ? scanSize(t) : /^\d{1,3}$/.test(t);
    if (!okv) continue;
    sheet.words = sheet.words.filter((w) => !(w.cy > j.A.y0 && w.cy < j.A.y1 && w.x0 >= j.A.x0 - 1 && w.x1 <= j.A.x1 + 1)).concat(keep.map((w) => ({ ...w, cy: j.r.cy, retry: true })));
    got++;
  }
  return got;
}

/* ------------------------------------------------------------------- UI */
function scanCsv(rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}
function scanDownload(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function openPdfScan(onPosted, initial) {
  const S = { sheets: [], sel: null, tab: 'material', busy: false, perDrawing: false, proposals: [], seq: 0, area: null, drag: null };
  const fileIn = el('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: 'multiple', style: 'display:none', onchange: (e) => { addFiles([...e.target.files]); e.target.value = ''; } });
  const status = el('span', { class: 'hint scan-status', 'aria-live': 'polite' });
  const area = el('select', { 'aria-label': 'Area' }, ...D.areas.map((a) => el('option', { value: a.area_code }, `${a.area_code} \u2014 ${a.area_name}`)));
  const perDwg = el('input', { type: 'checkbox', id: 'scan-perdwg', onchange: () => { S.perDrawing = perDwg.checked; roll(); } });
  const sheetList = el('div', { class: 'scan-sheets' });
  const prevCanvas = el('canvas', { class: 'scan-prev' });
  const prevOver = el('canvas', { class: 'scan-over' });
  const prevStage = el('div', { class: 'scan-stage' }, prevCanvas, prevOver);
  const prevInfo = el('div', { class: 'scan-tb' });
  const areaBtn = el('button', { class: 'ghost', onclick: () => { if (!S.sel) return; S.area = 'pick'; prevOver.style.cursor = 'crosshair'; status.textContent = 'Drag a box round the table or block to read.'; } }, 'Read an area');
  const ocrBtn = el('button', { class: 'ghost', onclick: () => { if (S.sel) readSheet(S.sel, true); } }, 'Read with OCR');
  const tabsBar = el('div', { class: 'seg scan-tabs' });
  const pane = el('div', { class: 'scan-pane' });
  const tabBtns = {};
  [['material', 'Material'], ['tags', 'Tags'], ['lines', 'Proposed takeoff lines']].forEach(([k, lab]) => {
    tabBtns[k] = el('button', { class: 'ghost', onclick: () => { S.tab = k; paintPane(); } }, lab);
    tabsBar.appendChild(tabBtns[k]);
  });

  const body = el('div', { class: 'scan-wrap' },
    el('div', { class: 'toolbar' },
      el('button', { class: 'ghost', onclick: () => fileIn.click() }, 'Open PDFs\u2026'), fileIn,
      !(window.VRUSER && window.VRUSER.user) ? el('button', { class: 'ghost', onclick: loadSamples }, 'Sample drawings') : '',
      el('label', { class: 'hint', text: 'Area' }), area,
      el('label', { class: 'scan-chk' }, perDwg, ' One takeoff line per drawing'),
      el('span', { style: 'flex:1' }), status),
    el('div', { class: 'scan-grid' },
      el('div', { class: 'scan-left' }, sheetList, el('div', { class: 'toolbar scan-prevbar' }, areaBtn, ocrBtn), prevStage, prevInfo),
      el('div', { class: 'scan-right' }, tabsBar, pane)));

  modal({
    title: 'Scan drawings (PDF)',
    sub: 'Reads bills of material, title blocks and tags from isometrics, P&IDs and other drawings, then proposes takeoff lines by fixed rules. Check every line before posting; the files stay in this browser.',
    width: 1320, body,
    buttons: [
      { label: 'Post selected takeoff lines', primary: true, onClick: post },
      { label: 'Export material CSV', onClick: exportCsv },
      { label: 'Close', onClick: () => { scanOcrRelease(); closeModal(); } },
    ],
  });
  paintSheets(); paintPane();
  window.__PDFSCAN_LAST = S; // read by the browser tests
  if (Array.isArray(initial) && initial.length) addLoaded(initial); // handed over from Drawing takeoff

  async function loadSamples() {
    const files = [];
    for (const p of SCAN_SAMPLES) {
      try { const r = await fetch(p); if (!r.ok) throw new Error(r.status); files.push({ name: `${p.split('/').pop().replace(/\.pdf$/, '')} (sample)`, bytes: new Uint8Array(await r.arrayBuffer()) }); }
      catch (e) { toast(`Sample ${p} not found`, true); }
    }
    await addLoaded(files);
  }
  async function addFiles(list) {
    const files = [];
    for (const f of list) files.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    await addLoaded(files);
  }
  async function addLoaded(files) {
    let lib;
    try { lib = await estPdfjs(); } catch (e) { toast(`Could not load the PDF reader: ${e.message}`, true); return; }
    const added = [];
    for (const f of files) {
      try {
        const doc = await lib.getDocument({ data: f.bytes, isEvalSupported: false }).promise;
        for (let p = 1; p <= doc.numPages; p++) {
          const sh = { id: `S${++S.seq}`, file: f.name, doc, page: p, pages: doc.numPages, words: [], rows: [], tags: [], tables: [], cut: [], tb: {}, state: 'waiting', src: '' };
          S.sheets.push(sh); added.push(sh);
        }
      } catch (e) { toast(`Could not read ${f.name}: ${e.message}`, true); }
    }
    if (!S.sel && added[0]) S.sel = added[0];
    paintSheets();
    for (const sh of added) await readSheet(sh, false);
  }
  async function readSheet(sh, force) {
    if (S.busy && !force) { await S.busy; }
    const job = (async () => {
      sh.state = 'reading'; paintSheets();
      const say = (m) => { sh.msg = m; status.textContent = `${sh.tb.drawing || sh.file} p${sh.page}: ${m}`; const row = sheetList.querySelector(`[data-id="${sh.id}"] .scan-st`); if (row) row.textContent = m; };
      try {
        const t0 = performance.now();
        await scanReadSheet(sh, say, force);
        scanParseSheet(sh);
        if (await scanRetryCells(sh, say)) scanParseSheet(sh);
        if (sh.src === 'ocr') scanOcrRelease();
        sh.state = 'done'; sh.ms = Math.round(performance.now() - t0);
        status.textContent = `${sh.tb.drawing} p${sh.page}: ${sh.rows.length} material rows, ${sh.tags.length} tags (${sh.src === 'ocr' ? 'OCR' : 'text layer'})`;
      } catch (e) { sh.state = 'failed'; sh.msg = e.message; status.textContent = `${sh.file} p${sh.page}: ${e.message}`; }
      paintSheets(); roll();
      if (S.sel === sh) paintPreview();
    })();
    S.busy = job;
    await job;
    S.busy = false;
  }

  function roll() { S.proposals = scanRollup(S.sheets.filter((s) => s.state === 'done'), { perDrawing: S.perDrawing }); paintPane(); }

  function paintSheets() {
    sheetList.textContent = '';
    if (!S.sheets.length) { sheetList.appendChild(el('div', { class: 'hint', style: 'padding:10px' }, 'Open one or more PDF drawings. Several files at once is fine: isometrics, P&IDs, layouts.')); return; }
    const t = el('table', { class: 'data scan-tbl' }, el('thead', {}, el('tr', {}, ...['Drawing', 'Pg', 'Read by', 'Rows', 'Tags', 'Status'].map((h) => el('th', { text: h })))));
    const tb = el('tbody');
    S.sheets.forEach((s) => {
      const checks = s.rows.filter((r) => r.status === 'Check').length;
      tb.appendChild(el('tr', { 'data-id': s.id, class: S.sel === s ? 'sel' : '', onclick: () => { S.sel = s; paintSheets(); paintPreview(); paintPane(); } },
        el('td', { title: s.file }, s.tb.drawing || s.file), el('td', { text: String(s.page) }),
        el('td', { text: s.src === 'ocr' ? 'OCR' : s.src === 'text' ? 'Text layer' : '\u2014' }),
        el('td', { text: s.state === 'done' ? String(s.rows.length) : '' }), el('td', { text: s.state === 'done' ? String(new Set(s.tags.map((x) => x.tag)).size) : '' }),
        el('td', { class: 'scan-st' }, s.state === 'done' ? (checks ? pill(`${checks} to check`, 'amber') : pill('Read', 'green')) : s.state === 'failed' ? pill('Failed', 'red') : (s.msg || s.state))));
    });
    t.appendChild(tb);
    sheetList.appendChild(t);
  }

  async function paintPreview() {
    const s = S.sel;
    prevInfo.textContent = '';
    if (!s) return;
    const page = await s.doc.getPage(s.page);
    const base = page.getViewport({ scale: 1 });
    const fit = Math.min(520 / base.width, 1.4);
    const dpr = window.devicePixelRatio || 1;
    const vp = page.getViewport({ scale: fit * dpr });
    prevCanvas.width = vp.width; prevCanvas.height = vp.height; prevOver.width = vp.width; prevOver.height = vp.height;
    [prevCanvas, prevOver].forEach((c) => { c.style.width = `${Math.round(base.width * fit)}px`; c.style.height = `${Math.round(base.height * fit)}px`; });
    S.prev = { fit, dpr, s };
    const g = prevCanvas.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, vp.width, vp.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    paintOverlay();
    const tb = s.tb || (s.tb = {});
    const fields = [['drawing', 'Drawing'], ['rev', 'Rev'], ['sheet', 'Sheet'], ['line', 'Line'], ['scale', 'Scale'], ['size', 'Size'], ['service', 'Service'], ['spec', 'Spec'], ['insul', 'Insulation']];
    const dl = el('dl', { class: 'scan-kv' });
    fields.forEach(([k, lab]) => {
      dl.append(el('dt', { text: lab + (k === 'drawing' && tb.drawingFrom ? ' (file name)' : '') }),
        el('dd', {}, el('input', { type: 'text', value: tb[k] || '', 'aria-label': lab, 'data-tb': k, onchange: (e) => { tb[k] = e.target.value.trim(); if (k === 'drawing') delete tb.drawingFrom; scanParseSheetKeepTb(s); roll(); paintSheets(); } })));
    });
    dl.append(el('dt', { text: 'Field welds (FW)' }), el('dd', {}, el('input', { type: 'number', min: 0, value: s.state === 'done' ? String(s.fw || 0) : '', 'aria-label': 'Field welds', onchange: (e) => { s.fw = Math.max(0, Number(e.target.value) || 0); s.fwLocked = s.fw; roll(); } })));
    dl.append(el('dt', { text: 'Read by' }), el('dd', { text: s.src === 'ocr' ? `OCR, ${(s.ocrAreas || []).length} area(s) at 300 dpi` : s.src === 'text' ? 'PDF text layer' : '' }));
    prevInfo.appendChild(dl);
    const pipe = s.rows.find((r) => r.cutTotal != null);
    if (pipe) prevInfo.appendChild(el('div', { class: 'hint' }, pipe.cutOk ? `Cut pipe lengths add up to the BOM pipe quantity (${scanFmtFt(pipe.cutTotal)}).${pipe.cutNote ? ` OCR correction: ${pipe.cutNote}.` : ''}` : pipe.cutCheck));
  }
  function paintOverlay(hl) {
    const P = S.prev; if (!P) return;
    const g = prevOver.getContext('2d');
    g.clearRect(0, 0, prevOver.width, prevOver.height);
    const k = P.fit * P.dpr;
    const s = P.s;
    g.lineWidth = 1.5 * P.dpr;
    (s.ocrAreas || []).forEach((A) => { g.setLineDash([4 * P.dpr, 3 * P.dpr]); g.strokeStyle = '#7a7974'; g.strokeRect(A.x0 * k, A.y0 * k, (A.x1 - A.x0) * k, (A.y1 - A.y0) * k); });
    g.setLineDash([]);
    s.tables.forEach((T) => { g.strokeStyle = '#4f98a3'; g.strokeRect((T.x0) * k, (T.y0) * k, (T.x1 - T.x0) * k, (T.y1 - T.y0) * k); });
    s.tags.forEach((t) => { g.strokeStyle = '#e8af34'; g.beginPath(); g.arc(t.x * k, t.y * k, 5 * P.dpr, 0, 7); g.stroke(); });
    if (hl) { g.fillStyle = 'rgba(232,175,52,.35)'; g.fillRect(hl.x0 * k, hl.y0 * k, (hl.x1 - hl.x0) * k, (hl.y1 - hl.y0) * k); }
    if (S.drag) { g.strokeStyle = '#dd6974'; g.strokeRect(S.drag.x0 * k, S.drag.y0 * k, (S.drag.x1 - S.drag.x0) * k, (S.drag.y1 - S.drag.y0) * k); }
  }
  const toPt = (ev) => { const r = prevOver.getBoundingClientRect(); return { x: (ev.clientX - r.left) / S.prev.fit, y: (ev.clientY - r.top) / S.prev.fit }; };
  prevOver.addEventListener('mousedown', (ev) => { if (S.area !== 'pick' || !S.prev) return; const p = toPt(ev); S.drag = { ox: p.x, oy: p.y, x0: p.x, y0: p.y, x1: p.x, y1: p.y }; });
  prevOver.addEventListener('mousemove', (ev) => { if (!S.drag) return; const p = toPt(ev); Object.assign(S.drag, { x0: Math.min(S.drag.ox, p.x), y0: Math.min(S.drag.oy, p.y), x1: Math.max(S.drag.ox, p.x), y1: Math.max(S.drag.oy, p.y) }); paintOverlay(); });
  window.addEventListener('mouseup', async () => {
    if (!S.drag) return;
    const A = S.drag; S.drag = null; S.area = null; prevOver.style.cursor = '';
    if (A.x1 - A.x0 < 8 || A.y1 - A.y0 < 6) { paintOverlay(); return; }
    await readArea(S.prev.s, A);
  }, { once: false });

  async function readArea(s, A) {
    status.textContent = 'Reading the area\u2026';
    try {
      let fine;
      if (s.src === 'text') fine = s.words.filter((w) => w.cy > A.y0 && w.cy < A.y1 && w.x0 >= A.x0 - 2 && w.x1 <= A.x1 + 2);
      else {
        const page = await s.doc.getPage(s.page);
        fine = await scanOcr(page, A, 300, 6, (m) => { if (m && m.status === 'recognizing text') status.textContent = `Reading the area ${Math.round(m.progress * 100)}%`; });
        s.words = s.words.filter((w) => !(w.cy > A.y0 && w.cy < A.y1 && w.x0 >= A.x0 - 2 && w.x1 <= A.x1 + 2)).concat(fine);
        s.ocrAreas = (s.ocrAreas || []).concat([A]);
        scanOcrRelease();
      }
      const before = s.rows.length;
      scanParseSheetKeepTb(s);
      roll(); paintSheets(); paintPreview();
      const text = scanLines(fine).map((L) => L.words.map((w) => w.t).join(' ')).join('\n');
      status.textContent = s.rows.length > before ? `Area read: ${s.rows.length - before} more material rows.` : 'Area read. No table header found in it; the text is shown under the preview.';
      if (s.rows.length <= before) prevInfo.appendChild(el('textarea', { class: 'scan-text', readonly: 'readonly', rows: 6 }, text));
    } catch (e) { toast(`Could not read the area: ${e.message}`, true); }
  }

  function paintPane() {
    Object.entries(tabBtns).forEach(([k, b]) => b.classList.toggle('on', k === S.tab));
    const done = S.sheets.filter((s) => s.state === 'done');
    tabBtns.material.textContent = `Material (${done.reduce((a, s) => a + s.rows.length, 0)})`;
    tabBtns.tags.textContent = `Tags (${new Set(done.flatMap((s) => s.tags.map((t) => t.tag))).size})`;
    tabBtns.lines.textContent = `Proposed takeoff lines (${S.proposals.filter((p) => p.include && p.key).length})`;
    pane.textContent = '';
    if (S.tab === 'material') paintMaterial(done);
    else if (S.tab === 'tags') paintTags(done);
    else paintLines();
  }
  const CLS = ['pipe', 'elbow', 'tee', 'reducer', 'cap', 'olet', 'coupling', 'flange', 'gasket', 'bolt', 'valve', 'control valve', 'support', 'other'];
  function paintMaterial(done) {
    const only = S.sel && S.sel.state === 'done' ? S.sel : null;
    const list = only ? [only] : done;
    pane.appendChild(el('div', { class: 'toolbar' },
      el('span', { class: 'hint' }, only ? `${only.tb.drawing} p${only.page} \u2014 click another sheet on the left, or ` : 'All sheets \u2014 ', only ? el('a', { href: '#', onclick: (e) => { e.preventDefault(); S.sel = null; paintSheets(); paintPane(); } }, 'show all sheets') : ''),
      el('span', { style: 'flex:1' }),
      only ? el('button', { class: 'ghost', onclick: () => { only.rows.push(scanFinishRow({ sheet: only.id, section: '', item: '', desc: '', sizeText: '', qtyText: '', code: '', conf: 100, src: 'manual', include: true, manual: true })); roll(); } }, '+ Row') : ''));
    const t = el('table', { class: 'data scan-tbl scan-mat' }, el('thead', {}, el('tr', {}, ...['', 'Drawing', 'Section', 'PT', 'Description', 'Size', 'Qty', 'Unit', 'Type', 'Ends', 'Status'].map((h) => el('th', { text: h })))));
    const tb = el('tbody');
    list.forEach((s) => s.rows.forEach((r) => {
      const upd = () => { scanFinishRow(r); roll(); };
      const inp = (k, w) => el('input', { value: r[k] || '', style: `width:${w}`, 'aria-label': k, onchange: (e) => { r[k] = e.target.value; upd(); } });
      const tr = el('tr', { class: r.status === 'Check' ? 'chk' : '', onmouseenter: () => { if (S.prev && S.prev.s === s && r.cy != null) { const T = s.tables[0]; paintOverlay({ x0: T ? T.x0 : 0, x1: T ? T.x1 : s.w, y0: r.cy - 6, y1: r.cy + 6 }); } } },
        el('td', {}, el('input', { type: 'checkbox', checked: r.include ? 'checked' : null, 'aria-label': 'Include', onchange: (e) => { r.include = e.target.checked; roll(); } })),
        el('td', { text: s.tb.drawing || s.file, class: 'scan-dim' }), el('td', { text: r.section, class: 'scan-dim' }), el('td', { text: r.item }),
        el('td', {}, inp('desc', '100%')), el('td', {}, inp('sizeText', '62px')), el('td', {}, inp('qtyText', '78px')),
        el('td', {}, el('select', { 'aria-label': 'Unit', onchange: (e) => { r.unit = e.target.value; r.unitLocked = true; r.unitText = e.target.value; upd(); } }, ...['EA', 'FT', 'M'].map((u) => el('option', { value: u, selected: r.unit === u ? 'selected' : null }, u)))),
        el('td', {}, el('select', { 'aria-label': 'Type', onchange: (e) => { r.cls = e.target.value; r.clsLocked = true; upd(); } }, ...CLS.map((c) => el('option', { value: c, selected: r.cls === c ? 'selected' : null }, c)))),
        el('td', { text: r.ends }),
        el('td', { title: r.why || '' }, r.status === 'OK' ? pill('OK', 'green') : pill('Check', 'amber'), r.why ? el('div', { class: 'scan-why', text: r.why }) : ''));
      tb.appendChild(tr);
    }));
    t.appendChild(tb);
    pane.appendChild(t);
    if (!list.some((s) => s.rows.length)) pane.appendChild(el('div', { class: 'hint', style: 'padding:10px' }, done.length ? 'No bill-of-material table found. Use Read an area on the preview, or + Row to enter it by hand.' : 'Nothing read yet.'));
  }
  function paintTags(done) {
    const by = new Map();
    done.forEach((s) => s.tags.forEach((t) => { if (t.tag === 'FW') return; const k = t.tag; const e = by.get(k) || { tag: k, kind: t.kind, sheets: new Set(), bom: false }; e.sheets.add(`${s.tb.drawing} p${s.page}`); if (s.rows.length) e.bom = true; by.set(k, e); }));
    const fw = done.reduce((a, s) => a + (s.fw || 0), 0);
    pane.appendChild(el('div', { class: 'hint', style: 'margin:4px 0 8px' }, `Field welds marked FW: ${fw}. Tags on sheets with a bill of material are not counted again from the tags (the BOM wins).`));
    const t = el('table', { class: 'data scan-tbl' }, el('thead', {}, el('tr', {}, ...['Tag', 'Type', 'Drawings', 'Counted from'].map((h) => el('th', { text: h })))));
    const tb = el('tbody');
    [...by.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.tag.localeCompare(b.tag, undefined, { numeric: true })).forEach((e) => {
      tb.appendChild(el('tr', {}, el('td', { text: e.tag }), el('td', { text: e.kind }), el('td', { text: [...e.sheets].join(', '), class: 'scan-dim' }), el('td', { text: e.bom ? 'BOM' : e.kind === 'field weld' ? 'FW count' : 'tag' })));
    });
    t.appendChild(tb); pane.appendChild(t);
  }
  function paintLines() {
    const lib = D.mh_library;
    pane.appendChild(el('div', { class: 'hint', style: 'margin:4px 0 8px' }, 'Each line shows the rule that produced it. Change the library key or quantity before posting; lines that are off are suggestions you can switch on.'));
    const t = el('table', { class: 'data scan-tbl scan-lines' }, el('thead', {}, el('tr', {}, ...['', 'Library key', 'Qty', 'UoM', 'Basis', 'From'].map((h) => el('th', { text: h })))));
    const tb = el('tbody');
    S.proposals.forEach((p) => {
      const keySel = el('select', { 'aria-label': 'Library key', onchange: (e) => { p.key = e.target.value; const m = IDX.mhByKey.get(p.key); p.uom = m ? m.uom : ''; p.disc = m ? m.discipline : ''; paintPane(); } },
        el('option', { value: '' }, '\u2014 choose \u2014'), ...lib.map((m) => el('option', { value: m.key, selected: m.key === p.key ? 'selected' : null }, `${m.key} \u2014 ${m.description} (${m.uom})`)));
      tb.appendChild(el('tr', { class: p.include ? '' : 'off' },
        el('td', {}, el('input', { type: 'checkbox', checked: p.include ? 'checked' : null, 'aria-label': 'Post', onchange: (e) => { p.include = e.target.checked; paintPane(); } })),
        el('td', {}, keySel),
        el('td', {}, el('input', { type: 'number', step: 'any', value: p.qty, style: 'width:86px', 'aria-label': 'Quantity', onchange: (e) => { p.qty = Number(e.target.value); } })),
        el('td', { text: p.uom }),
        el('td', { class: 'scan-basis' }, p.basis, p.weld_key ? el('div', { class: 'scan-why', text: `Weld factor ${p.weld_key}` }) : ''),
        el('td', { class: 'scan-dim', title: p.src.join('\n') }, p.src.length > 2 ? `${p.src.slice(0, 2).join('; ')}; +${p.src.length - 2} more` : p.src.join('; '))));
    });
    t.appendChild(tb); pane.appendChild(t);
    if (!S.proposals.length) pane.appendChild(el('div', { class: 'hint', style: 'padding:10px' }, 'No takeoff lines yet.'));
  }

  function exportCsv() {
    const done = S.sheets.filter((s) => s.state === 'done');
    if (!done.length) { toast('Nothing read yet', true); return; }
    const rows = [['file', 'page', 'drawing', 'rev', 'line', 'read_by', 'section', 'pt', 'description', 'size', 'qty_text', 'qty', 'unit', 'length_ft', 'type', 'ends', 'material', 'item_code', 'status', 'check']];
    done.forEach((s) => s.rows.forEach((r) => rows.push([s.file, s.page, s.tb.drawing, s.tb.rev || '', s.tb.line || '', s.src, r.section, r.item, r.desc, r.sizeText, r.qtyText, r.qty, r.unit, r.ft != null ? Math.round(r.ft * 1000) / 1000 : '', r.cls, r.ends, r.material, r.code, r.status, r.why])));
    scanDownload(`material-takeoff-${new Date().toISOString().slice(0, 10)}.csv`, scanCsv(rows));
  }

  function post() {
    const pick = S.proposals.filter((p) => p.include && p.key && p.qty > 0);
    if (!pick.length) { toast('Nothing selected to post. Tick a proposed line that has a library key.', true); return; }
    const posted = [];
    for (const p of pick) {
      const lib = IDX.mhByKey.get(p.key);
      if (!lib) continue;
      const sheets = p.refs.map((id) => S.sheets.find((s) => s.id === id)).filter(Boolean);
      const refs = [];
      sheets.forEach((s) => {
        const doc = String(s.tb.drawing || '').toUpperCase();
        if (!doc || refs.some((r) => r.doc_no === doc && r.sheet === String(s.page))) return;
        refs.push({ type: typeof drefGuessType === 'function' ? drefGuessType(doc) : 'OTH', doc_no: doc, sheet: String(s.page), rev: s.tb.rev ? String(s.tb.rev).toUpperCase() : '' });
      });
      const crafts = (typeof DISC_CRAFTS_FALLBACK !== 'undefined' && DISC_CRAFTS_FALLBACK[lib.discipline]) || [];
      const craft = (crafts.find((c) => IDX.craftByName.get(c)) || (D.crafts[0] || {}).craft || '');
      const lineNo = nextNo(D.takeoff_lines, 'line_no', 'TKL-', 4, SEQ);
      const how = sheets.some((s) => s.src === 'ocr') ? (sheets.every((s) => s.src === 'ocr') ? 'OCR' : 'text layer + OCR') : 'text layer';
      const qty = Math.round(p.qty * 100) / 100;
      const line = {
        id: lineNo, line_no: lineNo, discipline: lib.discipline, area: area.value, master_key: lib.key,
        description: lib.description, quantity: qty, uom: lib.uom, unit: lib.uom,
        discipline_factor: 1, global_factor: 1, item_factor: 1, weld_key: p.weld_key || '', craft,
        drawing_refs: refs,
        source: `PDF scan (${how}): ${p.basis}. ${p.src.slice(0, 6).join('; ')}${p.src.length > 6 ? `; +${p.src.length - 6} more` : ''}`,
      };
      D.takeoff_lines.push(line);
      audit('takeoff_line', lineNo, 'create', null, `${line.discipline} ${line.master_key} qty ${qty} ${line.uom} \u2014 ${line.source}`);
      posted.push(line);
      p.include = false; p.posted = lineNo;
    }
    paintPane();
    toast(posted.length ? `${posted.length} takeoff line${posted.length === 1 ? '' : 's'} posted: ${posted.map((l) => l.line_no).join(', ')}` : 'Nothing posted', !posted.length);
    if (onPosted) onPosted(posted);
  }
}

if (typeof window !== 'undefined') {
  window.PDFSCAN = { scanRetryCells, scanFtIn, scanQty, scanSize, scanClass, scanEnds, scanWordsFromText, scanLines, scanTables, scanParseSheet, scanTitleBlock, scanTags, scanRollup, scanReadSheet, scanFmtFt, scanOcrAreas };
}
