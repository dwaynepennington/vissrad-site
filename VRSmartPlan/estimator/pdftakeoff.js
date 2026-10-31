/* One code base, two homes: VREstimator (standalone builds set VR_STANDALONE)
   and VREST inside the VissRad Suite (web/estimating, shared files one
   level up). EST_BRAND names the tool in titles, files and messages;
   EST_ROOT is where vendor/ and shared/ sit. */
window.EST_BRAND = window.VR_STANDALONE ? 'VREstimator' : 'VREST';
window.EST_ROOT = window.VR_STANDALONE ? '' : '../';
/* ==========================================================================
   VREST — drawing takeoff from PDF.
   Open a PDF drawing (or, in demo mode, a sample drawing from DEng), set the
   scale from a known dimension, then measure:
     Count  — one click per item (valves, supports, foundations, devices)
     Length — click along a run; double-click or "Finish run" closes it
     Area   — click round a boundary; "Finish run" closes the polygon
   Quantities are converted to the library unit (LF, FT, EA, SF, SY, CY
   with a depth) and posted as a takeoff line that keeps a note of the
   drawing, page, scale and number of marks. Nothing leaves the browser; the
   PDF is read with the vendored pdf.js and not stored.
   ========================================================================== */
'use strict';

let EST_PDFJS = null;
async function estPdfjs() {
  if (EST_PDFJS) return EST_PDFJS;
  const base = new URL(`${EST_ROOT}vendor/pdfjs/`, document.baseURI).href;
  let lib;
  try { lib = await import(`${base}pdf.min.mjs`); } catch (e) {
    /* Opened straight from a folder: the browser blocks the PDF reader. The
       installed VRSmartPlan / VREstimator icons start the window so it works. */
    if (location.protocol === 'file:') throw new Error(`PDF reading needs the installed app: open ${EST_BRAND} from its desktop icon (or the hosted site). Opened straight from a folder, the browser blocks it.`);
    throw e;
  }
  lib.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
  EST_PDFJS = lib;
  return lib;
}

const tkFmt = (v, d) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const PDF_TK_SAMPLE = 'samples/drawings/VR-DEMO-001-CSA-LAY-0002_0.pdf';

/** The drawing a PDF takeoff came from, read from its file name
    (VR-DEMO-001-PIP-ISO-0003_0.pdf, or "... (sample)"), so the posted line
    carries its P&ID or isometric reference. Sheet = the page measured. */
function pdfTkDrawingRef(name, page) {
  const base = String(name || '').replace(/\s*\(.*\)\s*$/, '').replace(/\.pdf$/i, '').trim();
  const m = /^([A-Z0-9]+(?:-[A-Z0-9]+)*-[A-Z]{2,4}-\d{3,})(?:[_ ]+(?:rev[_ ]?)?([A-Z0-9]{1,3}))?$/i.exec(base);
  if (!m) return [];
  const doc = m[1].toUpperCase();
  const reg = typeof drawRegisterGet === 'function' ? drawRegisterGet(doc) : null;
  const type = typeof drefGuessType === 'function' ? drefGuessType(doc) : 'OTH';
  return [{ type, doc_no: doc, sheet: page ? String(page) : '', rev: m[2] ? m[2].toUpperCase() : (reg ? reg.rev : '') }];
}

/** Pure geometry, exposed for tests. pts are drawing units (PDF points at scale 1). */
function tkLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return s;
}
function tkArea(pts) {
  if (pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}
/** Convert a measured quantity in feet / square feet / count to a library unit. */
function tkToUnit(mode, feet, uom, depthFt) {
  const u = String(uom || '').toUpperCase();
  if (mode === 'count') return feet;
  if (mode === 'length') {
    if (u === 'M' || u === 'LM') return feet * 0.3048;
    if (u === 'YD') return feet / 3;
    return feet; // LF, FT
  }
  if (u === 'SY') return feet / 9;
  if (u === 'M2' || u === 'SM') return feet * 0.092903;
  if (u === 'CY') return (feet * (depthFt || 0)) / 27;
  return feet; // SF
}

/* ==========================================================================
   Auto count: find every copy of a boxed symbol on a page by normalised
   cross-correlation (template matching). Coarse pass on a reduced image with
   integral-image window statistics, refined at full analysis resolution,
   then overlapping hits are merged (non-maximum suppression). Optional 90,
   180 and 270 degree turns of the symbol. Rule-based image matching, not AI.
   ========================================================================== */
const TK_AUTO_MAX_PX = 12e6;
/** Page area → grey image { w, h, g: Uint8Array } at `scale` px per pt. */
async function tkGreyPage(page, scale) {
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: x, viewport: vp, background: 'rgb(255,255,255)' }).promise;
  const d = x.getImageData(0, 0, c.width, c.height).data;
  const g = new Uint8Array(c.width * c.height);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  c.width = c.height = 0;
  return { w: Math.round(vp.width), h: Math.round(vp.height), g };
}
/** Box-average reduction by an integer factor. */
function tkReduce(img, f) {
  if (f <= 1) return img;
  const w = Math.floor(img.w / f), h = Math.floor(img.h / f), g = new Uint8Array(w * h), n = f * f;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let j = 0; j < f; j++) { const o = (y * f + j) * img.w + x * f; for (let i = 0; i < f; i++) s += img.g[o + i]; }
    g[y * w + x] = Math.round(s / n);
  }
  return { w, h, g };
}
function tkCrop(img, x0, y0, w, h) {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) g.set(img.g.subarray((y0 + y) * img.w + x0, (y0 + y) * img.w + x0 + w), y * w);
  return { w, h, g };
}
/** Turn an image a quarter turn clockwise `q` times. */
function tkTurn(img, q) {
  let a = img;
  for (let k = 0; k < (q % 4); k++) {
    const w = a.h, h = a.w, g = new Uint8Array(w * h);
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) g[x * w + (w - 1 - y)] = a.g[y * a.w + x];
    a = { w, h, g };
  }
  return a;
}
/** Zero-mean template { w, h, t: Float32Array, norm } or null when the box is blank. */
function tkTemplate(img) {
  const n = img.w * img.h;
  let m = 0;
  for (let i = 0; i < n; i++) m += img.g[i];
  m /= n;
  const t = new Float32Array(n);
  let s2 = 0;
  for (let i = 0; i < n; i++) { t[i] = img.g[i] - m; s2 += t[i] * t[i]; }
  if (s2 / n < 25) return null; // nothing drawn in the box
  return { w: img.w, h: img.h, t, norm: Math.sqrt(s2) };
}
function tkIntegral(img) {
  const W = img.w + 1, S = new Float64Array(W * (img.h + 1)), Q = new Float64Array(W * (img.h + 1));
  for (let y = 0; y < img.h; y++) {
    let rs = 0, rq = 0;
    for (let x = 0; x < img.w; x++) {
      const v = img.g[y * img.w + x]; rs += v; rq += v * v;
      S[(y + 1) * W + x + 1] = S[y * W + x + 1] + rs; Q[(y + 1) * W + x + 1] = Q[y * W + x + 1] + rq;
    }
  }
  return { W, S, Q };
}
/** NCC score of template T at (x, y) of img; `I` from tkIntegral(img). */
function tkScoreAt(img, I, T, x, y) {
  const n = T.w * T.h, W = I.W;
  const a = y * W + x, b = y * W + x + T.w, c = (y + T.h) * W + x, d = (y + T.h) * W + x + T.w;
  const s = I.S[d] - I.S[b] - I.S[c] + I.S[a];
  const q = I.Q[d] - I.Q[b] - I.Q[c] + I.Q[a];
  const v = q - (s * s) / n;
  if (v < n * 25) return 0; // blank paper
  let num = 0;
  for (let j = 0; j < T.h; j++) {
    const o = (y + j) * img.w + x, to = j * T.w;
    for (let i = 0; i < T.w; i++) num += img.g[o + i] * T.t[to + i];
  }
  return num / (Math.sqrt(v) * T.norm);
}
/**
 * Find copies of `tplImg` (grey crop at full analysis resolution) in `img`.
 * Returns hits in analysis pixels: [{ x, y, w, h, score, turn }].
 */
async function tkFindSymbol(img, tplImg, { turns = false, minScore = 0.5, onProgress } = {}) {
  const f = Math.max(1, Math.min(4, Math.floor(Math.min(tplImg.w, tplImg.h) / 10)));
  const small = tkReduce(img, f), Is = tkIntegral(small), Ifull = tkIntegral(img);
  const variants = (turns ? [0, 1, 2, 3] : [0]).map((q) => {
    const full = tkTurn(tplImg, q);
    return { q, full: tkTemplate(full), small: tkTemplate(tkReduce(full, f)) };
  }).filter((v) => v.full && v.small);
  if (!variants.length) return null;
  const cand = [];
  const coarseMin = Math.max(0.35, minScore - 0.2);
  let done = 0;
  const total = variants.reduce((a, v) => a + Math.max(0, small.h - v.small.h + 1), 0);
  for (const v of variants) {
    const T = v.small;
    for (let y = 0; y + T.h <= small.h; y++) {
      for (let x = 0; x + T.w <= small.w; x++) {
        const sc = tkScoreAt(small, Is, T, x, y);
        if (sc >= coarseMin) cand.push({ x, y, sc, v });
      }
      if (++done % 24 === 0) { if (onProgress) onProgress(done / total); await new Promise((r) => setTimeout(r, 0)); }
    }
  }
  // keep the best coarse candidates only, then refine each at full resolution
  cand.sort((a, b) => b.sc - a.sc);
  const keep = [];
  for (const c of cand) {
    if (keep.length >= 4000) break;
    if (keep.some((k) => k.v === c.v && Math.abs(k.x - c.x) * f < c.v.full.w * 0.5 && Math.abs(k.y - c.y) * f < c.v.full.h * 0.5)) continue;
    keep.push(c);
  }
  const hits = [];
  for (const c of keep) {
    const T = c.v.full;
    let best = { sc: -1 };
    for (let dy = -f; dy <= f; dy++) for (let dx = -f; dx <= f; dx++) {
      const x = c.x * f + dx, y = c.y * f + dy;
      if (x < 0 || y < 0 || x + T.w > img.w || y + T.h > img.h) continue;
      const sc = tkScoreAt(img, Ifull, T, x, y);
      if (sc > best.sc) best = { sc, x, y };
    }
    if (best.sc >= minScore) hits.push({ x: best.x, y: best.y, w: T.w, h: T.h, score: best.sc, turn: c.v.q * 90 });
  }
  return tkNms(hits);
}
/** Merge overlapping hits, keeping the strongest. */
function tkNms(hits) {
  hits.sort((a, b) => b.score - a.score);
  const out = [];
  for (const h of hits) {
    const cx = h.x + h.w / 2, cy = h.y + h.h / 2;
    if (out.some((o) => Math.abs(o.x + o.w / 2 - cx) < 0.6 * Math.max(o.w, h.w) && Math.abs(o.y + o.h / 2 - cy) < 0.6 * Math.max(o.h, h.h))) continue;
    out.push(h);
  }
  return out;
}

function openPdfTakeoff(onPosted) {
  const S = { doc: null, name: '', page: 1, pages: 0, zoom: 1, mode: 'count', ftPerPt: null, cal: [], cur: [], runs: [], base: null,
    auto: { box: null, drag: null, pages: {}, thr: 0.8, turns: false, scope: 'page', busy: false, scale: 1, tplPage: 0, moved: false } };
  const canvas = el('canvas', { class: 'tk-canvas' });
  const overlay = el('canvas', { class: 'tk-overlay' });
  const stage = el('div', { class: 'tk-stage' }, canvas, overlay);
  const msg = el('div', { class: 'hint', style: 'margin:6px 0' });
  const readout = el('div', { class: 'tk-readout' });
  const pageLabel = el('span', { class: 'count' });
  const fileIn = el('input', { type: 'file', accept: 'application/pdf,.pdf', style: 'display:none', onchange: (e) => { const f = e.target.files[0]; if (f) f.arrayBuffer().then((b) => load(new Uint8Array(b), f.name)); } });

  const modeBtns = {};
  const modeBar = el('div', { class: 'seg' }, ...['count', 'auto', 'length', 'area', 'scale'].map((m) => {
    modeBtns[m] = el('button', { class: 'ghost', onclick: () => setMode(m) }, m === 'scale' ? 'Set scale' : m === 'auto' ? 'Auto count' : m[0].toUpperCase() + m.slice(1));
    return modeBtns[m];
  }));

  const disc = el('select', { 'aria-label': 'Discipline' }, ...D.disciplines.map((d) => el('option', { value: d.discipline }, d.discipline)));
  const key = el('select', { 'aria-label': 'Library key' });
  const area = el('select', { 'aria-label': 'Area' }, ...D.areas.map((a) => el('option', { value: a.area_code }, `${a.area_code} \u2014 ${a.area_name}`)));
  const craft = el('select', { 'aria-label': 'Craft' }, ...D.crafts.map((c) => el('option', { value: c.craft }, c.craft)));
  const depth = el('input', { type: 'number', value: 1, min: 0, step: '0.25', style: 'width:80px', 'aria-label': 'Depth ft' });
  function fillKeys() {
    key.textContent = '';
    D.mh_library.filter((m) => m.discipline === disc.value).forEach((m) => key.appendChild(el('option', { value: m.key }, `${m.key} \u2014 ${m.description} (${m.uom})`)));
    paint();
  }
  disc.onchange = fillKeys; key.onchange = () => paint(); depth.oninput = () => paint();

  const A = S.auto;
  const thrOut = el('span', { class: 'mono' }, A.thr.toFixed(2));
  const thrIn = el('input', { type: 'range', min: '0.5', max: '0.99', step: '0.01', value: String(A.thr), 'aria-label': 'Match threshold', oninput: (e) => { A.thr = Number(e.target.value); thrOut.textContent = A.thr.toFixed(2); paint(); } });
  const scopeSel = el('select', { 'aria-label': 'Pages to search', onchange: (e) => { A.scope = e.target.value; } }, el('option', { value: 'page' }, 'This page'), el('option', { value: 'all' }, 'All pages'));
  const turnsChk = el('input', { type: 'checkbox', 'aria-label': 'Also find the symbol turned', onchange: (e) => { A.turns = e.target.checked; } });
  const autoInfo = el('span', { class: 'hint' });
  const findBtn = el('button', { class: 'primary', onclick: () => runAuto() }, 'Find matches');
  const autoBar = el('div', { class: 'toolbar tk-auto', style: 'display:none' },
    el('label', { class: 'hint', text: 'Search' }), scopeSel,
    el('label', { class: 'tk-chk' }, turnsChk, ' Include turned 90/180/270\u00b0'),
    el('label', { class: 'hint', text: 'Match' }), thrIn, thrOut, findBtn,
    el('button', { class: 'ghost', onclick: () => { A.pages = {}; A.box = null; paint(); } }, 'Clear matches'),
    autoInfo);

  const body = el('div', { class: 'tk-wrap' },
    el('div', { class: 'toolbar' },
      el('button', { class: 'ghost', onclick: () => fileIn.click() }, 'Open PDF\u2026'), fileIn,
      !(window.VRUSER && window.VRUSER.user) ? el('button', { class: 'ghost', onclick: () => fetch(PDF_TK_SAMPLE).then((r) => r.arrayBuffer()).then((b) => load(new Uint8Array(b), 'VR-DEMO-001-CSA-LAY-0002 (sample)')).catch(() => toast('Sample drawing not found', true)) }, 'Sample drawing') : '',
      el('button', { class: 'ghost', title: 'Read the bill of material, title block and tags of this PDF and propose takeoff lines', onclick: () => {
        if (!S.doc || !S.bytes) { toast('Open a PDF first', true); return; }
        if (typeof openScanLazy !== 'function') { toast('Drawing scan not available', true); return; }
        openScanLazy([{ name: S.name, bytes: S.bytes.slice(0) }]);
      } }, 'Scan drawing'),
      el('button', { class: 'ghost', onclick: () => turn(-1) }, '\u2039'), pageLabel, el('button', { class: 'ghost', onclick: () => turn(1) }, '\u203a'),
      el('button', { class: 'ghost', onclick: () => { S.zoom = Math.max(0.5, S.zoom - 0.25); render(); } }, '\u2212'),
      el('button', { class: 'ghost', onclick: () => { S.zoom = Math.min(4, S.zoom + 0.25); render(); } }, '+'),
      el('span', { style: 'flex:1' }), modeBar,
      el('button', { class: 'ghost', onclick: finishRun }, 'Finish run'),
      el('button', { class: 'ghost', onclick: () => { if (S.cur.length) S.cur.pop(); else S.runs.pop(); paint(); } }, 'Undo'),
      el('button', { class: 'ghost', onclick: () => { S.cur = []; S.runs = []; S.auto.pages = {}; S.auto.box = null; paint(); } }, 'Clear')),
    msg, autoBar, stage,
    el('div', { class: 'form-grid tk-post' },
      el('label', { text: 'Discipline' }), disc, el('label', { text: 'Library key' }), key,
      el('label', { text: 'Area' }), area, el('label', { text: 'Craft' }), craft,
      el('label', { text: 'Depth ft (CY)' }), depth),
    readout);

  modal({
    title: 'Drawing takeoff', sub: 'Count, length and area from a PDF drawing. The file stays in this browser.', width: 1180, body,
    buttons: [
      { label: 'Post as takeoff line', primary: true, onClick: post },
      { label: 'Close', onClick: closeModal },
    ],
  });
  fillKeys(); setMode('count');
  window.__PDFTK_LAST = S; // read by the browser tests

  async function load(bytes, name) {
    try {
      const lib = await estPdfjs();
      S.bytes = bytes.slice(0); // PDF.js takes ownership of the buffer it is given; keep a copy for Scan drawing
      S.doc = await lib.getDocument({ data: bytes, isEvalSupported: false }).promise;
      S.name = name; S.pages = S.doc.numPages; S.page = 1; S.runs = []; S.cur = []; S.ftPerPt = null; S.auto.pages = {}; S.auto.box = null;
      await render();
      setMode('scale');
    } catch (e) { toast(`Could not read the PDF: ${e.message}`, true); }
  }
  async function turn(d) { if (!S.doc) return; const n = S.page + d; if (n < 1 || n > S.pages) return; S.page = n; S.runs = []; S.cur = []; await render(); }
  async function render() {
    if (!S.doc) return;
    const page = await S.doc.getPage(S.page);
    const base = page.getViewport({ scale: 1 });
    const fit = Math.min(1, 1100 / base.width) * S.zoom;
    const dpr = window.devicePixelRatio || 1;
    const vp = page.getViewport({ scale: fit * dpr });
    canvas.width = vp.width; canvas.height = vp.height;
    overlay.width = vp.width; overlay.height = vp.height;
    const w = `${Math.round(base.width * fit)}px`, h = `${Math.round(base.height * fit)}px`;
    [canvas, overlay].forEach((c) => { c.style.width = w; c.style.height = h; });
    S.base = { fit, dpr };
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    pageLabel.textContent = `${S.name} \u00b7 page ${S.page} of ${S.pages}`;
    paint();
  }
  function toPt(ev) {
    const r = overlay.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / S.base.fit, y: (ev.clientY - r.top) / S.base.fit };
  }
  overlay.addEventListener('mousedown', (ev) => {
    if (!S.doc || S.mode !== 'auto' || A.busy) return;
    A.drag = { a: toPt(ev), b: toPt(ev) }; A.moved = false;
  });
  overlay.addEventListener('mousemove', (ev) => {
    if (!A.drag) return;
    A.drag.b = toPt(ev);
    if (Math.abs(A.drag.b.x - A.drag.a.x) + Math.abs(A.drag.b.y - A.drag.a.y) > 3) A.moved = true;
    paint();
  });
  window.addEventListener('mouseup', () => {
    if (!A.drag) return;
    const { a, b } = A.drag; A.drag = null;
    if (!A.moved) { paint(); return; }
    const box = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
    if (box.w < 4 || box.h < 4) { toast('Draw the box round one whole symbol', true); paint(); return; }
    A.box = box; A.tplPage = S.page;
    runAuto();
  });
  overlay.addEventListener('click', (ev) => {
    if (!S.doc) return;
    const p = toPt(ev);
    if (S.mode === 'auto') {
      if (A.moved) { A.moved = false; return; }
      // click a match to drop it (or bring it back)
      const hit = (A.pages[S.page] || []).filter((h) => h.score >= A.thr).find((h) => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h);
      if (hit) { hit.off = !hit.off; paint(); }
      return;
    }
    if (S.mode === 'scale') {
      S.cal.push(p);
      if (S.cal.length === 2) askScale();
    } else if (S.mode === 'count') {
      S.runs.push({ mode: 'count', pts: [p] });
    } else S.cur.push(p);
    paint();
  });
  overlay.addEventListener('dblclick', (ev) => { ev.preventDefault(); if (S.mode === 'length' || S.mode === 'area') { if (S.cur.length) S.cur.pop(); finishRun(); } });

  async function runAuto() {
    if (!S.doc) { toast('Open a PDF drawing first', true); return; }
    if (!A.box) { toast('Drag a box round one symbol first', true); return; }
    if (A.busy) return;
    A.busy = true; findBtn.disabled = true;
    try {
      const tplPage = await S.doc.getPage(A.tplPage);
      const base = tplPage.getViewport({ scale: 1 });
      // analysis scale: about 150 dpi, enough pixels in the symbol, capped for big sheets
      A.scale = Math.min(150 / 72, Math.sqrt(TK_AUTO_MAX_PX / (base.width * base.height)));
      if (Math.min(A.box.w, A.box.h) * A.scale < 10) A.scale = Math.min(10 / Math.min(A.box.w, A.box.h), Math.sqrt(TK_AUTO_MAX_PX / (base.width * base.height)));
      const k = A.scale;
      const tplImgPage = await tkGreyPage(tplPage, k);
      const tx = Math.max(0, Math.round(A.box.x * k)), ty = Math.max(0, Math.round(A.box.y * k));
      const tw = Math.min(tplImgPage.w - tx, Math.round(A.box.w * k)), th = Math.min(tplImgPage.h - ty, Math.round(A.box.h * k));
      const tpl = tkCrop(tplImgPage, tx, ty, tw, th);
      const pages = A.scope === 'all' ? Array.from({ length: S.pages }, (_, i) => i + 1) : [S.page];
      A.pages = {};
      for (const pn of pages) {
        autoInfo.textContent = `Searching page ${pn} of ${S.pages}\u2026`;
        const page = pn === A.tplPage ? null : await S.doc.getPage(pn);
        const img = page ? await tkGreyPage(page, k) : tplImgPage;
        const hits = await tkFindSymbol(img, tpl, { turns: A.turns, minScore: 0.5, onProgress: (f) => { autoInfo.textContent = `Searching page ${pn} of ${S.pages}: ${Math.round(f * 100)}%`; } });
        if (hits == null) { toast('The box is blank: draw it round the symbol lines', true); break; }
        A.pages[pn] = hits.map((h) => ({ x: h.x / k, y: h.y / k, w: h.w / k, h: h.h / k, score: h.score, turn: h.turn, off: false }));
      }
    } catch (e) { toast(`Auto count failed: ${e.message}`, true); }
    A.busy = false; findBtn.disabled = false;
    paint();
  }
  function autoHits(pn) { return (A.pages[pn] || []).filter((h) => h.score >= A.thr && !h.off); }
  function autoTotal() { return Object.keys(A.pages).reduce((a, pn) => a + autoHits(Number(pn)).length, 0); }
  function askScale() {
    const ptLen = tkLength(S.cal);
    const box = el('div', { class: 'form-grid' },
      el('label', { text: 'Real length of the two points' }), el('input', { type: 'number', id: 'tk-real', value: '', step: 'any', min: 0 }),
      el('label', { text: 'Unit' }), el('select', { id: 'tk-unit' }, el('option', { value: 'ft' }, 'feet'), el('option', { value: 'm' }, 'meters'), el('option', { value: 'in' }, 'inches')));
    const inline = el('div', { class: 'tk-scale' }, box,
      el('button', { class: 'primary', onclick: () => {
        const v = Number(box.querySelector('#tk-real').value);
        const u = box.querySelector('#tk-unit').value;
        if (!(v > 0)) { toast('Enter the real length as a positive number', true); return; }
        const ft = u === 'm' ? v / 0.3048 : u === 'in' ? v / 12 : v;
        S.ftPerPt = ft / ptLen; S.cal = []; inline.remove(); setMode('count');
        toast(`Scale set: ${(1 / S.ftPerPt).toFixed(2)} pt per ft`);
      } }, 'Apply scale'),
      el('button', { class: 'ghost', onclick: () => { S.cal = []; inline.remove(); paint(); } }, 'Cancel'));
    msg.after(inline);
  }
  function finishRun() {
    if (S.mode === 'length' && S.cur.length >= 2) S.runs.push({ mode: 'length', pts: S.cur });
    else if (S.mode === 'area' && S.cur.length >= 3) S.runs.push({ mode: 'area', pts: S.cur });
    S.cur = []; paint();
  }
  function setMode(m) {
    if (S.cur.length) finishRun();
    S.mode = m; S.cal = [];
    Object.entries(modeBtns).forEach(([k, b]) => b.classList.toggle('on', k === m));
    autoBar.style.display = m === 'auto' ? '' : 'none';
    overlay.style.cursor = m === 'auto' ? 'crosshair' : '';
    const hints = {
      scale: 'Set scale: click both ends of a dimension you know (a grid spacing or a dimensioned line), then enter its real length.',
      count: 'Count: click once on each item.',
      auto: 'Auto count: drag a box tightly round one symbol. Every copy of it is found and added to the count. Click a match to drop it; move the Match slider to be stricter or looser. Symbols drawn at other angles than 0/90/180/270\u00b0 or other sizes are not found: count those by hand.',
      length: 'Length: click along the run; double-click or Finish run to close it. Start a new run for each line.',
      area: 'Area: click round the boundary; Finish run closes the shape.',
    };
    msg.textContent = S.doc ? hints[m] : 'Open a PDF drawing to start.';
    paint();
  }
  function totals() {
    const c = S.runs.filter((r) => r.mode === 'count').length + autoTotal();
    const lenPt = S.runs.filter((r) => r.mode === 'length').reduce((a, r) => a + tkLength(r.pts), 0);
    const areaPt = S.runs.filter((r) => r.mode === 'area').reduce((a, r) => a + tkArea(r.pts), 0);
    const f = S.ftPerPt;
    return { count: c, lengthFt: f ? lenPt * f : null, areaSf: f ? areaPt * f * f : null,
      lengthRuns: S.runs.filter((r) => r.mode === 'length').length, areaRuns: S.runs.filter((r) => r.mode === 'area').length };
  }
  function measured() {
    const t = totals();
    const lib = IDX.mhByKey.get(key.value);
    const uom = lib ? lib.uom : '';
    const u = String(uom).toUpperCase();
    let mode = 'count', raw = t.count;
    if (['LF', 'FT', 'M', 'LM', 'YD'].includes(u)) { mode = 'length'; raw = t.lengthFt; }
    else if (['SF', 'SY', 'M2', 'SM', 'CY'].includes(u)) { mode = 'area'; raw = t.areaSf; }
    else if (u !== 'EA' && u !== 'NO' && u !== 'SET') { mode = 'none'; raw = null; }
    const qty = raw == null ? null : tkToUnit(mode, raw, u, Number(depth.value));
    return { t, lib, uom, mode, qty };
  }
  function paint() {
    const g = overlay.getContext('2d');
    g.clearRect(0, 0, overlay.width, overlay.height);
    if (S.base) {
      const k = S.base.fit * S.base.dpr;
      const P = (p) => [p.x * k, p.y * k];
      g.lineWidth = 2 * S.base.dpr;
      const drawRun = (r, colour, closed) => {
        g.strokeStyle = colour; g.fillStyle = colour;
        if (r.mode === 'count') { const [x, y] = P(r.pts[0]); g.beginPath(); g.arc(x, y, 6 * S.base.dpr, 0, 7); g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1; g.stroke(); return; }
        g.beginPath(); r.pts.forEach((p, i) => { const [x, y] = P(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        if (closed) { g.closePath(); g.globalAlpha = 0.18; g.fill(); g.globalAlpha = 1; }
        g.stroke();
        r.pts.forEach((p) => { const [x, y] = P(p); g.fillRect(x - 3, y - 3, 6, 6); });
      };
      S.runs.forEach((r) => drawRun(r, r.mode === 'count' ? '#e8af34' : r.mode === 'length' ? '#4f98a3' : '#a86fdf', r.mode === 'area'));
      if (S.cur.length) drawRun({ mode: S.mode, pts: S.cur }, '#dd6974', false);
      if (S.cal.length) drawRun({ mode: 'length', pts: S.cal }, '#6daa45', false);
      const R = (b) => { const [x, y] = P(b); return [x, y, b.w * k, b.h * k]; };
      (A.pages[S.page] || []).filter((h) => h.score >= A.thr).forEach((h) => {
        g.save(); g.lineWidth = 2 * S.base.dpr;
        if (h.off) { g.setLineDash([4 * S.base.dpr, 3 * S.base.dpr]); g.strokeStyle = '#dd6974'; } else { g.strokeStyle = '#6daa45'; g.fillStyle = 'rgba(109,170,69,0.18)'; g.fillRect(...R(h)); }
        g.strokeRect(...R(h)); g.restore();
      });
      if (A.box && A.tplPage === S.page) { g.save(); g.strokeStyle = '#e8af34'; g.lineWidth = 2 * S.base.dpr; g.setLineDash([6 * S.base.dpr, 3 * S.base.dpr]); g.strokeRect(...R(A.box)); g.restore(); }
      if (A.drag) { const a = A.drag.a, b = A.drag.b; g.save(); g.strokeStyle = '#e8af34'; g.lineWidth = 2 * S.base.dpr; g.strokeRect(...R({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) })); g.restore(); }
    }
    const m = measured();
    const t = m.t;
    {
      const pg = Object.keys(A.pages).map(Number);
      const on = autoTotal(), dropped = pg.reduce((a, pn) => a + (A.pages[pn] || []).filter((h) => h.score >= A.thr && h.off).length, 0);
      if (!A.busy) autoInfo.textContent = !pg.length ? (A.box ? '' : 'Drag a box round one symbol.') : `${on} match${on === 1 ? '' : 'es'}${pg.length > 1 ? ` on ${pg.filter((pn) => autoHits(pn).length).length} page(s)` : ''}${dropped ? `, ${dropped} dropped` : ''}. Check them on the drawing.`;
    }
    readout.textContent = '';
    readout.append(
      el('span', {}, `Scale: ${S.ftPerPt ? `${(1 / S.ftPerPt).toFixed(2)} pt per ft` : 'not set'}`),
      el('span', {}, `Count ${int(t.count)}`),
      el('span', {}, `Length ${t.lengthFt == null ? '\u2014' : `${tkFmt(t.lengthFt, 1)} ft in ${t.lengthRuns} run(s)`}`),
      el('span', {}, `Area ${t.areaSf == null ? '\u2014' : `${tkFmt(t.areaSf, 1)} sf in ${t.areaRuns} shape(s)`}`),
      el('strong', {}, `To post: ${m.mode === 'none' ? `${m.uom} is not measurable on a drawing` : m.qty == null ? 'set the scale first' : `${tkFmt(m.qty, 2)} ${m.uom}`} (${m.mode})`));
  }
  function post() {
    const m = measured();
    if (!S.doc) { toast('Open a PDF drawing first', true); return; }
    if (!m.lib) { toast('Choose a library key', true); return; }
    if (m.mode === 'none') { toast(`${m.uom} cannot be measured from a drawing. Take the length or count here, then enter the ${m.uom} on a new takeoff line.`, true); return; }
    if (m.mode !== 'count' && !S.ftPerPt) { toast(`${m.uom} needs a length: set the scale first`, true); return; }
    if (!(m.qty > 0)) { toast(`Nothing measured for a ${m.uom} item. Use ${m.mode === 'count' ? 'Count' : m.mode === 'length' ? 'Length' : 'Area'} on the drawing.`, true); return; }
    const qty = Math.round(m.qty * 100) / 100;
    const lineNo = nextNo(D.takeoff_lines, 'line_no', 'TKL-', 4, SEQ);
    const autoN = m.mode === 'count' ? autoTotal() : 0;
    const autoPg = Object.keys(A.pages).length;
    const marks = S.runs.filter((r) => r.mode === m.mode).length;
    const line = {
      id: lineNo, line_no: lineNo, discipline: disc.value, area: area.value, master_key: m.lib.key,
      description: m.lib.description, quantity: qty, uom: m.lib.uom, unit: m.lib.uom,
      discipline_factor: 1, global_factor: 1, item_factor: 1, weld_key: '', craft: craft.value,
      drawing_refs: pdfTkDrawingRef(S.name, S.page),
      source: `PDF takeoff: ${S.name} p${S.page}, ${marks} ${m.mode === 'count' ? 'marks' : m.mode === 'length' ? 'runs' : 'shapes'}${autoN ? ` + ${autoN} auto-count matches (match ${A.thr.toFixed(2)}${autoPg > 1 ? `, ${autoPg} pages` : ''})` : ''}${S.ftPerPt ? `, ${(1 / S.ftPerPt).toFixed(2)} pt/ft` : ''}`,
    };
    D.takeoff_lines.push(line);
    audit('takeoff_line', lineNo, 'create', null, `${line.discipline} ${line.master_key} qty ${qty} ${line.uom} \u2014 ${line.source}`);
    S.runs = S.runs.filter((r) => r.mode !== m.mode);
    if (m.mode === 'count') { A.pages = {}; A.box = null; }
    paint();
    toast(`${lineNo} posted: ${tkFmt(qty, 2)} ${line.uom}`);
    if (onPosted) onPosted(line);
  }
}

/* ==========================================================================
   Measurements sent from VRMarkup (?new_takeoff=1&mk=…&mq=…).
   Each length, area or count arrives in feet / square feet / each (or metres);
   the estimator picks the library item, and each one is posted as a takeoff
   line carrying the drawing, page and scale. The line number is written back
   onto the markup so the measurement shows which line it became.
   ========================================================================== */
const MK_KIND = { mlen: 'length', mpoly: 'length', marea: 'area', mcount: 'count' };
const MK_NAME = { mlen: 'Length', mpoly: 'Polylength', marea: 'Area', mcount: 'Count' };
const MK_UOMS = { length: ['LF', 'FT', 'M', 'LM', 'YD'], area: ['SF', 'SY', 'M2', 'SM', 'CY'], count: ['EA', 'NO', 'SET'] };
/* Item value to the unit tkToUnit expects: feet for lengths, square feet for areas. */
function mkToFeet(it) {
  const kind = MK_KIND[it.t];
  if (kind === 'length') return it.u === 'm' ? it.v / 0.3048 : it.v;
  if (kind === 'area') return it.u === 'm' ? it.v / 0.092903 : it.v;
  return it.v;
}
function openMarkupTakeoff(mq, mkRef, onPosted) {
  let ref = null; try { ref = mkRef ? JSON.parse(mkRef) : null; } catch (e) { ref = null; }
  const items = (mq && Array.isArray(mq.items) ? mq.items : []).filter((i) => MK_KIND[i.t] && Number(i.v) > 0);
  if (!items.length) { toast('No measurements arrived from VRMarkup', true); return; }
  const docLabel = mq.doc ? `${mq.doc}${mq.rev ? ` rev ${mq.rev}` : ''}` : (mq.title || mq.name || 'drawing');
  const disc = el('select', { 'aria-label': 'Discipline' }, ...D.disciplines.map((d) => el('option', { value: d.discipline }, d.discipline)));
  const area = el('select', { 'aria-label': 'Area' }, ...D.areas.map((a) => el('option', { value: a.area_code }, `${a.area_code} \u2014 ${a.area_name}`)));
  const craft = el('select', { 'aria-label': 'Craft' }, ...D.crafts.map((c) => el('option', { value: c.craft }, c.craft)));
  const depth = el('input', { type: 'number', value: 1, min: 0, step: '0.25', style: 'width:80px', 'aria-label': 'Depth ft' });
  const discOpts = () => D.disciplines.map((d) => el('option', { value: d.discipline }, d.discipline));
  const rows = items.map((it) => ({ it, touched: false, on: el('input', { type: 'checkbox', checked: true, 'aria-label': 'Post this measurement' }),
    disc: el('select', { 'aria-label': 'Discipline for this measurement' }, ...discOpts()),
    key: el('select', { 'aria-label': 'Library key', style: 'width:100%' }), qty: el('span', { class: 'mono' }) }));
  const tbody = el('tbody');
  function libFor(kind, dv) { return D.mh_library.filter((m) => m.discipline === dv && MK_UOMS[kind].includes(String(m.uom).toUpperCase())); }
  function fillRow(r) {
    const prev = r.key.value; r.key.textContent = '';
    const lib = libFor(MK_KIND[r.it.t], r.disc.value);
    if (!lib.length) r.key.appendChild(el('option', { value: '' }, `No ${MK_KIND[r.it.t]} items in the ${r.disc.value} library`));
    lib.forEach((m) => r.key.appendChild(el('option', { value: m.key, selected: m.key === prev }, `${m.key} \u2014 ${m.description} (${m.uom})`)));
    r.on.checked = !!lib.length && (r.on.checked || !r.touchedOn);
  }
  function fill() {
    rows.forEach((r) => { if (!r.touched) r.disc.value = disc.value; fillRow(r); });
    paint();
  }
  function qtyOf(r) {
    const lib = IDX.mhByKey.get(r.key.value); if (!lib) return null;
    return { lib, qty: Math.round(tkToUnit(MK_KIND[r.it.t], mkToFeet(r.it), lib.uom, Number(depth.value)) * 100) / 100 };
  }
  function paint() { rows.forEach((r) => { const q = qtyOf(r); r.qty.textContent = q ? `${tkFmt(q.qty, 2)} ${q.lib.uom}` : '\u2014'; }); }
  rows.forEach((r) => {
    r.key.onchange = paint;
    r.on.onchange = () => { r.touchedOn = true; };
    r.disc.onchange = () => { r.touched = true; fillRow(r); paint(); };
    tbody.appendChild(el('tr', {},
      el('td', {}, r.on),
      el('td', {}, el('b', {}, `${MK_NAME[r.it.t]} ${r.it.x || ''}`), el('div', { class: 'hint' }, `${r.it.n ? `${r.it.n} \u00b7 ` : ''}page ${r.it.p || 1}`)),
      el('td', {}, r.disc),
      el('td', { style: 'min-width:300px' }, r.key),
      el('td', { class: 'num' }, r.qty)));
  });
  disc.onchange = fill; depth.oninput = paint;
  const body = el('div', {},
    el('div', { class: 'hint', style: 'margin-bottom:8px' }, `${items.length} measurement${items.length === 1 ? '' : 's'} from ${docLabel}${mq.scale ? ` \u00b7 scale ${mq.scale}` : ''}. Pick the library item for each; lengths need a length unit (LF, M), areas an area or volume unit (SF, SY, CY with a depth), counts EA. The discipline below applies to every row unless a row is changed.`),
    el('div', { class: 'form-grid' },
      el('label', { text: 'Discipline' }), disc, el('label', { text: 'Area' }), area,
      el('label', { text: 'Craft' }), craft, el('label', { text: 'Depth ft (CY)' }), depth),
    el('table', { class: 'tbl', style: 'width:100%;margin-top:10px' },
      el('thead', {}, el('tr', {}, el('th', {}, ''), el('th', {}, 'Measurement'), el('th', {}, 'Discipline'), el('th', {}, 'Library item'), el('th', { class: 'num' }, 'Quantity'))), tbody));
  modal({
    title: 'Takeoff from VRMarkup', sub: docLabel, width: 980, body,
    buttons: [
      { label: 'Cancel', onClick: closeModal },
      { label: 'Post takeoff lines', primary: true, onClick: post },
    ],
  });
  fill();
  function post() {
    const pick = rows.filter((r) => r.on.checked);
    if (!pick.length) { toast('Tick at least one measurement', true); return; }
    const bad = pick.find((r) => !qtyOf(r));
    if (bad) { toast(`Choose a library item for ${MK_NAME[bad.it.t]} ${bad.it.x || ''}`, true); return; }
    const posted = [];
    for (const r of pick) {
      const { lib, qty } = qtyOf(r);
      if (!(qty > 0)) continue;
      const lineNo = nextNo(D.takeoff_lines, 'line_no', 'TKL-', 4, SEQ);
      const refs = mq.doc
        ? [{ type: typeof drefGuessType === 'function' ? drefGuessType(mq.doc) : 'OTH', doc_no: mq.doc, sheet: String(r.it.p || ''), rev: mq.rev || '' }]
        : pdfTkDrawingRef(mq.name, r.it.p);
      const line = {
        id: lineNo, line_no: lineNo, discipline: r.disc.value, area: area.value, master_key: lib.key,
        description: r.it.n || lib.description, quantity: qty, uom: lib.uom, unit: lib.uom,
        discipline_factor: 1, global_factor: 1, item_factor: 1, weld_key: '', craft: craft.value,
        drawing_refs: refs,
        source: `VRMarkup: ${docLabel} p${r.it.p || 1}, ${MK_NAME[r.it.t].toLowerCase()} ${r.it.x || ''}${mq.scale && r.it.t !== 'mcount' ? `, ${mq.scale}` : ''}`,
      };
      D.takeoff_lines.push(line);
      audit('takeoff_line', lineNo, 'create', null, `${line.discipline} ${line.master_key} qty ${qty} ${line.uom} \u2014 ${line.source}`);
      if (ref && window.vrMarkupLink) window.vrMarkupLink(Object.assign({}, ref, { s: r.it.s }), { app: 'estimating', no: lineNo, label: `${qty} ${line.uom} ${lib.key}` });
      posted.push(line);
    }
    closeModal();
    toast(posted.length ? `${posted.map((l) => l.line_no).join(', ')} posted` : 'Nothing posted: the quantities came to zero', !posted.length);
    if (onPosted) onPosted(posted);
  }
}
