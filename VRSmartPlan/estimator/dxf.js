/* ==========================================================================
   VREstimator — DXF reader and quantity engine (no DOM; runs in the browser
   and in Node for tests).

   Reads ASCII DXF (R12 to current): HEADER $INSUNITS, LAYER table, BLOCKS
   and model-space ENTITIES. Measures, per layer, the length of LINE,
   LWPOLYLINE / POLYLINE (bulge arcs included), ARC, CIRCLE, ELLIPSE and
   SPLINE (fit or control points), and the area and perimeter of closed
   shapes. Counts block INSERTs per block name, with MINSERT arrays and
   nested blocks (counted separately). Paper-space entities are ignored.
   Quantities are in drawing units; the caller converts with unitsToFeet.
   ========================================================================== */
'use strict';

const DXF_UNITS = { 0: ['Unitless', null], 1: ['Inches', 1 / 12], 2: ['Feet', 1], 3: ['Miles', 5280], 4: ['Millimeters', 1 / 304.8], 5: ['Centimeters', 1 / 30.48], 6: ['Meters', 1 / 0.3048], 7: ['Kilometers', 1000 / 0.3048], 9: ['Mils', 1 / 12000], 10: ['Yards', 3], 14: ['Decimeters', 1 / 3.048] };
/* AutoCAD colour index 1-9 and a few common ones, for the preview. */
const DXF_ACI = { 1: '#ff4040', 2: '#ffff40', 3: '#40ff40', 4: '#40ffff', 5: '#4080ff', 6: '#ff40ff', 7: '#e6e6e6', 8: '#8c8c8c', 9: '#c0c0c0', 30: '#ff8c1a', 40: '#ffbf00', 140: '#40a0ff', 251: '#5a5a5a', 252: '#787878', 253: '#969696' };
function dxfColor(c) { const n = Math.abs(Number(c) || 7); return DXF_ACI[n] || ['#e6e6e6', '#ff8c1a', '#40c0ff', '#a0ff40', '#ff6fb0', '#c0a0ff'][n % 6]; }

/* ------------------------------------------------------------ reader */
function dxfParse(text) {
  if (typeof text !== 'string') text = new TextDecoder('utf-8').decode(text);
  if (/^AutoCAD Binary DXF/.test(text.slice(0, 22))) throw new Error('This is a binary DXF. Save it from CAD as an ASCII DXF and try again.');
  if (/^AC10\d\d/.test(text.slice(0, 6))) throw new Error('This is a DWG file. Save it as DXF from your CAD program (DWG reading is planned).');
  const raw = text.split(/\r\n|\r|\n/);
  const P = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const c = parseInt(raw[i], 10);
    if (Number.isNaN(c)) { i -= 1; continue; } // tolerate stray blank lines
    P.push([c, raw[i + 1].replace(/\s+$/, '')]);
  }
  if (!P.some((p) => p[0] === 0 && p[1] === 'SECTION')) throw new Error('No DXF sections found. Is this an ASCII DXF file?');
  const doc = { insunits: 0, layers: {}, blocks: {}, ents: [], warnings: [], types: {} };
  let i = 0, section = '';
  const next = () => P[i++];
  /* read one entity starting at P[i] (code 0 TYPE); returns { type, g: [[code, value]...] } */
  function readEnt() {
    const type = P[i][1]; const g = []; i++;
    while (i < P.length && P[i][0] !== 0) { g.push(P[i]); i++; }
    return { type, g };
  }
  function readEntities(endTag, into) {
    while (i < P.length) {
      const p = P[i];
      if (p[0] === 0 && (p[1] === endTag || p[1] === 'ENDSEC')) return;
      if (p[0] !== 0) { i++; continue; }
      const e = readEnt();
      if (e.type === 'POLYLINE') {
        e.verts = [];
        while (i < P.length && P[i][0] === 0 && P[i][1] === 'VERTEX') e.verts.push(readEnt());
        if (i < P.length && P[i][0] === 0 && P[i][1] === 'SEQEND') readEnt();
      } else if (e.type === 'INSERT') {
        while (i < P.length && P[i][0] === 0 && P[i][1] === 'ATTRIB') readEnt();
        if (i < P.length && P[i][0] === 0 && P[i][1] === 'SEQEND') readEnt();
      }
      into.push(e);
    }
  }
  while (i < P.length) {
    const p = next();
    if (p[0] === 0 && p[1] === 'SECTION') { const n = next(); section = n && n[0] === 2 ? n[1] : ''; continue; }
    if (p[0] === 0 && p[1] === 'ENDSEC') { section = ''; continue; }
    if (section === 'HEADER' && p[0] === 9 && p[1] === '$INSUNITS') { const v = next(); doc.insunits = parseInt(v[1], 10) || 0; continue; }
    if (section === 'TABLES' && p[0] === 0 && p[1] === 'LAYER') {
      i--; const e = readEnt(); const name = gv(e.g, 2); if (name != null) doc.layers[name] = { color: Number(gv(e.g, 62, 7)), frozen: (Number(gv(e.g, 70, 0)) & 1) === 1 };
      continue;
    }
    if (section === 'BLOCKS' && p[0] === 0 && p[1] === 'BLOCK') {
      i--; const b = readEnt(); const name = gv(b.g, 2) || gv(b.g, 3) || '';
      const blk = { name, x: num0(gv(b.g, 10)), y: num0(gv(b.g, 20)), ents: [] };
      readEntities('ENDBLK', blk.ents);
      if (i < P.length && P[i][1] === 'ENDBLK') readEnt();
      doc.blocks[name] = blk; continue;
    }
    if (section === 'ENTITIES' && p[0] === 0) { i--; readEntities('ENDSEC', doc.ents); continue; }
  }
  doc.ents = doc.ents.filter((e) => Number(gv(e.g, 67, 0)) !== 1); // model space only
  return doc;
}
function gv(g, code, def) { for (const p of g) if (p[0] === code) return p[1]; return def === undefined ? null : def; }
function gall(g, code) { return g.filter((p) => p[0] === code).map((p) => Number(p[1])); }
function num0(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/* ------------------------------------------------------------ geometry */
const DXF_STEP = Math.PI / 90; // 2 degree tessellation
function arcPts(cx, cy, r, a0, a1, out) {
  let sweep = a1 - a0; while (sweep <= 0) sweep += Math.PI * 2;
  const n = Math.max(2, Math.ceil(sweep / DXF_STEP));
  for (let k = out.length ? 1 : 0; k <= n; k++) { const a = a0 + (sweep * k) / n; out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
  return r * sweep;
}
/* Bulge segment p->q: returns arc length and appends points (excluding p). */
function bulgePts(p, q, b, out) {
  const c = Math.hypot(q.x - p.x, q.y - p.y);
  if (!b || c === 0) { out.push({ x: q.x, y: q.y }); return c; }
  const th = 4 * Math.atan(b); // signed included angle
  const r = c / (2 * Math.sin(Math.abs(th) / 2));
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  const d = r * Math.cos(Math.abs(th) / 2); // centre distance from chord midpoint
  const ux = (q.x - p.x) / c, uy = (q.y - p.y) / c;
  const s = b > 0 ? 1 : -1; // centre left of the chord for CCW arcs (d turns negative past 180 degrees)
  const cx = mx - uy * d * s, cy = my + ux * d * s;
  const a0 = Math.atan2(p.y - cy, p.x - cx);
  const n = Math.max(2, Math.ceil(Math.abs(th) / DXF_STEP));
  for (let k = 1; k <= n; k++) { const a = a0 + (th * k) / n; out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
  return r * Math.abs(th);
}
function shoelace(pts) { let a = 0; for (let k = 0; k < pts.length; k++) { const p = pts[k], q = pts[(k + 1) % pts.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a) / 2; }

/** Geometry of one entity: { len, closed, area, paths: [[{x,y}]] } in its own coordinates. */
function dxfGeom(e) {
  const g = e.g, t = e.type;
  const mir = Number(gv(g, 230, 1)) < 0; // OCS mirrored about Y (extrusion 0,0,-1)
  const fx = (x) => (mir ? -x : x);
  if (t === 'LINE') { const p = { x: num0(gv(g, 10)), y: num0(gv(g, 20)) }, q = { x: num0(gv(g, 11)), y: num0(gv(g, 21)) }; return { len: Math.hypot(q.x - p.x, q.y - p.y), closed: false, area: 0, paths: [[p, q]] }; }
  if (t === 'LWPOLYLINE' || t === 'POLYLINE') {
    let V = [];
    if (t === 'LWPOLYLINE') { let cur = null; for (const [c, v] of g) { if (c === 10) { cur = { x: fx(Number(v)), y: 0, b: 0 }; V.push(cur); } else if (c === 20 && cur) cur.y = Number(v); else if (c === 42 && cur) cur.b = Number(v) * (mir ? -1 : 1); } }
    else {
      const fl = Number(gv(g, 70, 0)); if (fl & (16 | 64)) return { len: 0, closed: false, area: 0, paths: [], skip: 'mesh' };
      V = (e.verts || []).filter((v) => !(Number(gv(v.g, 70, 0)) & 16)).map((v) => ({ x: fx(num0(gv(v.g, 10))), y: num0(gv(v.g, 20)), b: num0(gv(v.g, 42)) * (mir ? -1 : 1) }));
    }
    if (V.length < 2) return { len: 0, closed: false, area: 0, paths: [] };
    let closed = (Number(gv(g, 70, 0)) & 1) === 1;
    const last = V[V.length - 1];
    if (!closed && V.length > 2 && Math.hypot(last.x - V[0].x, last.y - V[0].y) < 1e-9) { closed = true; V = V.slice(0, -1); V[V.length - 1].b = V[V.length - 1].b || last.b; }
    const pts = [{ x: V[0].x, y: V[0].y }]; let len = 0;
    const n = closed ? V.length : V.length - 1;
    for (let k = 0; k < n; k++) len += bulgePts(V[k], V[(k + 1) % V.length], V[k].b, pts);
    let area = 0;
    if (closed) { /* exact: vertex polygon plus the circular segment of each bulge */
      let sa = 0; for (let k = 0; k < V.length; k++) { const p = V[k], q = V[(k + 1) % V.length]; sa += (p.x * q.y - q.x * p.y) / 2;
        if (p.b) { const c = Math.hypot(q.x - p.x, q.y - p.y), th = 4 * Math.atan(Math.abs(p.b)), r = c / (2 * Math.sin(th / 2)); sa += Math.sign(p.b) * (r * r / 2) * (th - Math.sin(th)); } }
      area = Math.abs(sa);
    }
    return { len, closed, area, paths: [pts] };
  }
  if (t === 'CIRCLE') { const cx = fx(num0(gv(g, 10))), cy = num0(gv(g, 20)), r = num0(gv(g, 40)); const pts = []; arcPts(cx, cy, r, 0, Math.PI * 2, pts); return { len: 2 * Math.PI * r, closed: true, area: Math.PI * r * r, paths: [pts] }; }
  if (t === 'ARC') {
    const cx = num0(gv(g, 10)), cy = num0(gv(g, 20)), r = num0(gv(g, 40));
    let a0 = (num0(gv(g, 50)) * Math.PI) / 180, a1 = (num0(gv(g, 51)) * Math.PI) / 180;
    const pts = []; const len = arcPts(cx, cy, r, a0, a1, pts);
    if (mir) pts.forEach((p) => { p.x = -p.x; });
    return { len, closed: false, area: 0, paths: [pts] };
  }
  if (t === 'ELLIPSE') {
    const cx = num0(gv(g, 10)), cy = num0(gv(g, 20)), mx = num0(gv(g, 11)), my = num0(gv(g, 21)), ratio = num0(gv(g, 40)) || 1;
    let p0 = num0(gv(g, 41)), p1 = Number(gv(g, 42, Math.PI * 2)); while (p1 <= p0) p1 += Math.PI * 2;
    const a = Math.hypot(mx, my), rot = Math.atan2(my, mx), b = a * ratio, n = Math.max(8, Math.ceil((p1 - p0) / DXF_STEP));
    const pts = []; let len = 0;
    for (let k = 0; k <= n; k++) { const tt = p0 + ((p1 - p0) * k) / n; const x = a * Math.cos(tt), y = b * Math.sin(tt); const P2 = { x: fx(cx + x * Math.cos(rot) - y * Math.sin(rot)), y: cy + x * Math.sin(rot) + y * Math.cos(rot) }; if (k) len += Math.hypot(P2.x - pts[k - 1].x, P2.y - pts[k - 1].y); pts.push(P2); }
    const full = Math.abs(p1 - p0 - Math.PI * 2) < 1e-6;
    return { len, closed: full, area: full ? Math.PI * a * b : 0, paths: [pts] };
  }
  if (t === 'SPLINE') {
    const fxs = gall(g, 11), fys = gall(g, 21);
    const xs = fxs.length > 1 ? fxs : gall(g, 10), ys = fxs.length > 1 ? fys : gall(g, 20);
    const pts = xs.map((x, k) => ({ x: fx(x), y: ys[k] || 0 }));
    let len = 0; for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    return { len, closed: (Number(gv(g, 70, 0)) & 1) === 1, area: 0, paths: [pts], approx: fxs.length > 1 ? '' : 'control' };
  }
  return null;
}

/* ------------------------------------------------------------ quantities */
const DXF_MEASURED = new Set(['LINE', 'LWPOLYLINE', 'POLYLINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'SPLINE']);
function insertCount(e) { return Math.max(1, Number(gv(e.g, 70, 1)) || 1) * Math.max(1, Number(gv(e.g, 71, 1)) || 1); }
/** Layer and block quantities in drawing units. */
function dxfSummarize(doc) {
  const layers = {}, blocks = {}, types = {}, warn = new Set();
  const L = (n) => (layers[n] = layers[n] || { len: 0, area: 0, perim: 0, closed: 0, ents: 0, color: doc.layers[n] ? doc.layers[n].color : 7 });
  const B = (n) => (blocks[n] = blocks[n] || { direct: 0, nested: 0, layers: {} });
  const minmax = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  doc.ents.forEach((e) => {
    types[e.type] = (types[e.type] || 0) + 1;
    const lay = gv(e.g, 8, '0');
    if (e.type === 'INSERT') {
      const name = gv(e.g, 2, ''); const n = insertCount(e); const b = B(name); b.direct += n; b.layers[lay] = (b.layers[lay] || 0) + n;
      nested(name, n, 0); L(lay);
      const x = num0(gv(e.g, 10)), y = num0(gv(e.g, 20)); ext(x, y); return;
    }
    if (!DXF_MEASURED.has(e.type)) return;
    const geo = dxfGeom(e); if (!geo) return;
    if (geo.skip) warn.add('3D meshes and polyface entities are skipped');
    if (geo.approx) warn.add('Some splines have no fit points; their length uses the control polygon (slightly long)');
    const l = L(lay); l.ents += 1; l.len += geo.len;
    if (geo.closed) { l.closed += 1; l.area += geo.area; l.perim += geo.len; }
    geo.paths.forEach((pp) => pp.forEach((p) => ext(p.x, p.y)));
  });
  function nested(name, mult, depth) {
    const blk = doc.blocks[name]; if (!blk || depth > 8) return;
    blk.ents.forEach((e) => { if (e.type !== 'INSERT') return; const n2 = gv(e.g, 2, ''); const k = insertCount(e) * mult; B(n2).nested += k; nested(n2, k, depth + 1); });
  }
  function ext(x, y) { if (x < minmax.x0) minmax.x0 = x; if (y < minmax.y0) minmax.y0 = y; if (x > minmax.x1) minmax.x1 = x; if (y > minmax.y1) minmax.y1 = y; }
  Object.keys(layers).forEach((k) => { const l = layers[k]; if (!l.ents && !Object.values(blocks).some((b) => b.layers[k])) delete layers[k]; });
  const round = (o) => { Object.values(o).forEach((v) => { ['len', 'area', 'perim'].forEach((f) => { if (f in v) v[f] = Math.round(v[f] * 1e4) / 1e4; }); }); return o; };
  return { insunits: doc.insunits, layers: round(layers), blocks, types, entities: doc.ents.length, extents: Number.isFinite(minmax.x0) ? minmax : null, warnings: [...warn] };
}

/* ------------------------------------------------------------ preview paths */
/** Flattened paths for drawing: [{ layer, block, pts }], inserts expanded with their transforms. */
function dxfPaths(doc, maxPaths) {
  const out = []; const cap = maxPaths || 60000;
  function emit(ents, T, layerIn, blockIn, depth) {
    for (const e of ents) {
      if (out.length >= cap) return;
      let lay = gv(e.g, 8, '0'); if (lay === '0' && layerIn) lay = layerIn;
      if (e.type === 'INSERT') {
        if (depth > 6) continue;
        const name = gv(e.g, 2, ''); const blk = doc.blocks[name]; if (!blk) continue;
        const sx = Number(gv(e.g, 41, 1)) || 1, sy = Number(gv(e.g, 42, 1)) || 1, rot = (num0(gv(e.g, 50)) * Math.PI) / 180;
        const cols = Math.max(1, Number(gv(e.g, 70, 1)) || 1), rows = Math.max(1, Number(gv(e.g, 71, 1)) || 1), cs = num0(gv(e.g, 44)), rs = num0(gv(e.g, 45));
        const mir = Number(gv(e.g, 230, 1)) < 0;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const ox = c * cs, oy = r * rs;
          const px = num0(gv(e.g, 10)) * (mir ? -1 : 1), py = num0(gv(e.g, 20));
          const cosr = Math.cos(rot), sinr = Math.sin(rot);
          const local = (p) => { const x = (p.x - blk.x) * sx + ox, y = (p.y - blk.y) * sy + oy; return { x: px + x * cosr - y * sinr, y: py + x * sinr + y * cosr }; };
          emit(blk.ents, (p) => T(local(p)), lay, blockIn || name, depth + 1);
        }
        continue;
      }
      if (!DXF_MEASURED.has(e.type)) continue;
      const geo = dxfGeom(e); if (!geo) continue;
      geo.paths.forEach((pp) => out.push({ layer: lay, block: blockIn, pts: pp.map(T) }));
    }
  }
  emit(doc.ents, (p) => p, '', '', 0);
  return out;
}

/* ------------------------------------------------------------ auto-mapping
   Name patterns -> how to price a layer or block. Learned choices (the
   estimate's own mapping rules) are applied before these. Pipe layers read
   the nominal size from the name (e.g. P-PIPE-CS-10 -> 10 in). */
const DXF_BLOCK_RULES = [
  [/CONTROL.?VALVE|^CV[-_ ]|^FCV|^LCV|^PCV|^TCV/i, { lib: 'PIP-030' }],
  [/PUMP/i, { asm: 'ASM-009' }],
  [/VALVE|^VLV|GATE|GLOBE|BALL.?V|CHECK.?V|BUTTERFLY/i, { lib: 'PIP-029' }],
  [/TRANSMIT|^INST|GAUGE|^[FPTL]T[-_ \d]|^[FPTL]IT[-_ \d]|SWITCH|ANALY[SZ]ER/i, { asm: 'ASM-010' }],
  [/LIGHT|LUMINAIRE|FIXTURE|LUM[-_]/i, { asm: 'ASM-011' }],
  [/JUNCTION|^JB[-_ ]/i, { lib: 'INS-044' }],
  [/SUPPORT|SHOE|GUIDE|ANCHOR|HANGER/i, { lib: 'PIP-031' }],
  [/FLANGE/i, { lib: 'PIP-028' }],
  [/EXCHANGER|^HX|^E-\d/i, { lib: 'MEC-019' }],
  [/COMPRESSOR/i, { lib: 'MEC-016' }],
  [/VESSEL|DRUM|TOWER|COLUMN/i, { lib: 'MEC-017' }],
  [/MCC/i, { lib: 'ELE-037' }],
  [/PANEL|DCS|PLC/i, { lib: 'INS-045' }],
];
const DXF_LAYER_RULES = [
  [/FDN|FOUND|FOOTING|PIER|PILE.?CAP/i, { measure: 'area', asm: 'ASM-001', depth_ft: 3 }],
  [/SLAB|PAVING|PAVE/i, { measure: 'area', asm: 'ASM-002', depth_ft: 0.5 }],
  [/PLATFORM|GRATING|GRATE/i, { measure: 'area', asm: 'ASM-003' }],
  [/TRAY/i, { measure: 'length', asm: 'ASM-008' }],
  [/DUCT.?BANK/i, { measure: 'length', lib: 'CIV-006' }],
  [/CONDUIT|CNDT/i, { measure: 'length', lib: 'ELE-033' }],
  [/GROUND|GRND|EARTH/i, { measure: 'length', lib: 'ELE-039' }],
  [/RACK/i, { measure: 'length', asm: 'ASM-007' }],
  [/HANDRAIL|GUARDRAIL/i, { measure: 'length', lib: 'STR-011' }],
  [/TUBING|TUBE/i, { measure: 'length', lib: 'INS-043' }],
  [/INSUL/i, { measure: 'length', asm: 'ASM-006', height_ft: 1 }],
];
function dxfPipeSize(name) {
  if (!/PIPE|PIP[-_]|LINE[-_]/i.test(name)) return null;
  const m = /(?:^|[-_ ])(\d{1,2}(?:\.\d+)?)(?:IN|"|INCH|NPS)?(?=$|[-_ ])/i.exec(name.replace(/^.*?PIPE/i, '-'));
  return m ? Number(m[1]) : null;
}
/** Suggested pricing for a layer or block name, or null. */
function dxfSuggest(source, name) {
  if (source === 'block') {
    if (/TITLE|BORDER|NORTH|ARROW|LOGO|LEGEND|^\*|^A\$|_ArchTick|_Closed|_Open|_Dot/i.test(name)) return null;
    for (const [re, s] of DXF_BLOCK_RULES) { const m = re.exec(name); if (m) return Object.assign({ measure: 'count', why: `block name contains "${m[0].replace(/[-_ ]$/, '')}"` }, s); }
    return null;
  }
  if (/GRID|ANNO|TEXT|DIM|TITLE|BORDER|VIEWPORT|DEFPOINTS|HATCH|CENTER|^0$/i.test(name)) return null;
  const size = dxfPipeSize(name);
  if (size != null) {
    if (size <= 6) return { measure: 'length', asm: 'ASM-005', why: `pipe layer, ${size} in` };
    if (size <= 16) return { measure: 'length', asm: 'ASM-004', why: `pipe layer, ${size} in` };
    if (size <= 30) return { measure: 'length', lib: 'PIP-024', why: `pipe layer, ${size} in` };
  }
  for (const [re, s] of DXF_LAYER_RULES) { const m = re.exec(name); if (m) return Object.assign({ why: `layer name contains "${m[0]}"` }, s); }
  return null;
}

if (typeof module !== 'undefined') module.exports = { dxfParse, dxfSummarize, dxfPaths, dxfSuggest, dxfGeom, DXF_UNITS };
