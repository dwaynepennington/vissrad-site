/* ==========================================================================
   VissRad Suite — sheet in / out (window.VRSheetIO)

   readGrids(file)   -> [{ name, grid: [[cell, ...], ...] }]   .xlsx / .xlsm / .csv / .tsv / .txt
   xlsxBlob(sheets)  -> Blob   sheets: [{ name, header: [...], rows: [[...], ...], widths?: [...] }]

   No third-party library: the workbook is read with a minimal zip reader
   (DecompressionStream for deflated parts) and written as stored OOXML parts
   through zipWrite.js, loaded on demand.
   ========================================================================== */
(function (global) {
  'use strict';
  if (global.VRSheetIO) return;
  const td = new TextDecoder();

  async function unzip(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let e = buf.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('This is not an Excel .xlsx workbook. Save it as .xlsx or CSV.');
    const n = dv.getUint16(e + 10, true);
    let off = dv.getUint32(e + 16, true);
    const files = new Map();
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
      const nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
      files.set(td.decode(buf.subarray(off + 46, off + 46 + nlen)), { method, csize, lho: dv.getUint32(off + 42, true) });
      off += 46 + nlen + xlen + clen;
    }
    return async (name) => {
      const f = files.get(name);
      if (!f) return null;
      const start = f.lho + 30 + dv.getUint16(f.lho + 26, true) + dv.getUint16(f.lho + 28, true);
      const data = buf.subarray(start, start + f.csize);
      if (f.method === 0) return td.decode(data);
      if (f.method !== 8) throw new Error('Unsupported compression in workbook.');
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .xlsx files; save the sheet as CSV.');
      return td.decode(new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
    };
  }
  const xmlDoc = (t) => new DOMParser().parseFromString(t || '<x/>', 'application/xml');
  const tags = (n, t) => Array.from(n.getElementsByTagNameNS('*', t));
  async function readXlsx(bytes) {
    const get = await unzip(bytes);
    const wb = xmlDoc(await get('xl/workbook.xml'));
    const rels = xmlDoc(await get('xl/_rels/workbook.xml.rels'));
    const target = {};
    tags(rels, 'Relationship').forEach((r) => { target[r.getAttribute('Id')] = r.getAttribute('Target'); });
    const ss = [];
    const sst = await get('xl/sharedStrings.xml');
    if (sst) tags(xmlDoc(sst), 'si').forEach((si) => ss.push(tags(si, 't').map((t) => t.textContent).join('')));
    const col = (ref) => { let c = 0; for (const ch of String(ref).replace(/\d+$/, '')) c = c * 26 + (ch.charCodeAt(0) - 64); return c - 1; };
    const sheets = [];
    for (const s of tags(wb, 'sheet')) {
      const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
      let t = target[rid] || '';
      t = t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`;
      const text = await get(t);
      if (!text) continue;
      const grid = [];
      tags(xmlDoc(text), 'row').forEach((row) => {
        const out = [];
        let ci = 0;
        tags(row, 'c').forEach((c) => {
          if (c.getAttribute('r')) ci = col(c.getAttribute('r'));
          const ty = c.getAttribute('t') || 'n';
          const v = tags(c, 'v')[0];
          out[ci] = ty === 's' ? (v ? ss[+v.textContent] || '' : '') : ty === 'inlineStr' ? tags(c, 't').map((x) => x.textContent).join('') : v ? v.textContent : '';
          ci++;
        });
        grid.push(Array.from(out, (x) => (x === undefined ? '' : x)));
      });
      sheets.push({ name: s.getAttribute('name'), grid });
    }
    return sheets;
  }
  function readDelimited(text) {
    const first = text.split(/\r?\n/, 1)[0] || '';
    const cnt = (ch) => (first.match(new RegExp(ch === '\t' ? '\\t' : `\\${ch}`, 'g')) || []).length;
    const d = cnt('\t') > cnt(',') ? '\t' : cnt(';') > cnt(',') ? ';' : ',';
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === d) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  async function readGrids(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (/\.xls$/i.test(file.name)) throw new Error('Old .xls workbooks cannot be read. Save it as .xlsx or CSV.');
    if (/\.xls[xm]$/i.test(file.name) || (bytes[0] === 0x50 && bytes[1] === 0x4b)) return readXlsx(bytes);
    let text = td.decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return [{ name: file.name.replace(/\.[^.]+$/, ''), grid: readDelimited(text) }];
  }

  /* ------------------------------------------------------------ writer */
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  function ref(c, r) { let s = ''; let x = c; while (x >= 0) { s = String.fromCharCode(65 + (x % 26)) + s; x = Math.floor(x / 26) - 1; } return s + r; }
  function sheetXml(s) {
    const cell = (v, ci, ri, st) => {
      const r = ref(ci, ri), sa = st ? ` s="${st}"` : '';
      if (v === '' || v === null || v === undefined) return `<c r="${r}"${sa}/>`;
      if (typeof v === 'number' && isFinite(v)) return `<c r="${r}"${sa}><v>${v}</v></c>`;
      return `<c r="${r}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    };
    const widths = s.widths || s.header.map((h, i) => Math.min(60, Math.max(10, String(h).length + 2, ...s.rows.slice(0, 200).map((r) => String(r[i] === undefined || r[i] === null ? '' : r[i]).length + 2))));
    const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
    const rows = [`<row r="1">${s.header.map((h, i) => cell(h, i, 1, 1)).join('')}</row>`]
      .concat(s.rows.map((r, ri) => `<row r="${ri + 2}">${r.map((v, i) => cell(v, i, ri + 2, 0)).join('')}</row>`));
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      + `${cols}<sheetData>${rows.join('')}</sheetData>${s.rows.length ? `<autoFilter ref="A1:${ref(s.header.length - 1, s.rows.length + 1)}"/>` : ''}</worksheet>`;
  }
  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDE7EA"/></patternFill></fill></fills>'
    + '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  function zipLib() {
    if (global.VissRadZip) return Promise.resolve(global.VissRadZip);
    const base = (document.currentScript && document.currentScript.src) || '';
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      const me = Array.from(document.scripts).map((x) => x.src).find((u) => /\/sheetio\.js(\?|$)/.test(u)) || base;
      s.src = me ? me.replace(/sheetio\.js(\?.*)?$/, 'zipWrite.js') : '../shared/zipWrite.js';
      s.onload = () => res(global.VissRadZip); s.onerror = () => rej(new Error('Could not load the workbook writer.'));
      document.head.appendChild(s);
    });
  }
  async function xlsxBlob(sheets) {
    const Z = await zipLib();
    const safe = (n, i) => String(n || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${i + 1}`;
    const parts = [
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        + sheets.map((s, i) => `<sheet name="${esc(safe(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
        + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', text: STYLES },
    ].concat(sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s) })));
    const b = Z.zipBlob(parts);
    return b.type ? b : new Blob([b], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  global.VRSheetIO = { readGrids, readDelimited, xlsxBlob };
})(typeof window !== 'undefined' ? window : globalThis);
