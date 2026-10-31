/* ===========================================================
   zipWrite.js — minimal ZIP (stored, no compression) writer.

   VRConstruction has to hand a planner a real .xlsx file, and an
   .xlsx is a ZIP of XML parts. The suite carries no third-party
   spreadsheet library, so the container is built here: local file
   headers, a central directory and an end-of-central-directory
   record, with CRC-32 over each part. Entries are stored rather
   than deflated, which Excel, LibreOffice and P6's import all
   accept; the files are small enough that compression buys little.

   Exposes window.VissRadZip:
     crc32(bytes)              -> unsigned 32-bit
     zipBlob([{name, text}])   -> Blob (application/zip)
   =========================================================== */
(function (global) {
  'use strict';

  const TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[n] = c >>> 0;
    }
    return t;
  }());

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* MS-DOS packed date and time, as the ZIP format requires. */
  function dosStamp(dt) {
    const time = ((dt.getHours() & 0x1F) << 11)
      | ((dt.getMinutes() & 0x3F) << 5)
      | ((Math.floor(dt.getSeconds() / 2)) & 0x1F);
    const date = (((dt.getFullYear() - 1980) & 0x7F) << 9)
      | (((dt.getMonth() + 1) & 0x0F) << 5)
      | (dt.getDate() & 0x1F);
    return { time: time, date: date };
  }

  function writer(size) {
    const buf = new Uint8Array(size);
    let p = 0;
    return {
      u16: function (v) { buf[p++] = v & 0xFF; buf[p++] = (v >>> 8) & 0xFF; },
      u32: function (v) {
        buf[p++] = v & 0xFF; buf[p++] = (v >>> 8) & 0xFF;
        buf[p++] = (v >>> 16) & 0xFF; buf[p++] = (v >>> 24) & 0xFF;
      },
      bytes: function (b) { buf.set(b, p); p += b.length; },
      at: function () { return p; },
      done: function () { return buf.subarray(0, p); },
    };
  }

  function zipBlob(entries) {
    const enc = new TextEncoder();
    const stamp = dosStamp(new Date());
    const parts = entries.map(function (e) {
      const nameBytes = enc.encode(e.name);
      const dataBytes = e.bytes || enc.encode(e.text || '');
      return {
        nameBytes: nameBytes,
        dataBytes: dataBytes,
        crc: crc32(dataBytes),
      };
    });

    let total = 0;
    parts.forEach(function (p) {
      total += 30 + p.nameBytes.length + p.dataBytes.length;   /* local */
      total += 46 + p.nameBytes.length;                        /* central */
    });
    total += 22;                                               /* EOCD */

    const w = writer(total);
    const offsets = [];

    parts.forEach(function (p) {
      offsets.push(w.at());
      w.u32(0x04034B50);          /* local file header signature */
      w.u16(20);                  /* version needed */
      w.u16(0x0800);              /* flags: UTF-8 names */
      w.u16(0);                   /* method: stored */
      w.u16(stamp.time);
      w.u16(stamp.date);
      w.u32(p.crc);
      w.u32(p.dataBytes.length);  /* compressed size */
      w.u32(p.dataBytes.length);  /* uncompressed size */
      w.u16(p.nameBytes.length);
      w.u16(0);                   /* extra field length */
      w.bytes(p.nameBytes);
      w.bytes(p.dataBytes);
    });

    const cdStart = w.at();
    parts.forEach(function (p, i) {
      w.u32(0x02014B50);          /* central directory signature */
      w.u16(20);                  /* version made by */
      w.u16(20);                  /* version needed */
      w.u16(0x0800);
      w.u16(0);
      w.u16(stamp.time);
      w.u16(stamp.date);
      w.u32(p.crc);
      w.u32(p.dataBytes.length);
      w.u32(p.dataBytes.length);
      w.u16(p.nameBytes.length);
      w.u16(0);                   /* extra */
      w.u16(0);                   /* comment */
      w.u16(0);                   /* disk number start */
      w.u16(0);                   /* internal attributes */
      w.u32(0);                   /* external attributes */
      w.u32(offsets[i]);
      w.bytes(p.nameBytes);
    });
    const cdSize = w.at() - cdStart;

    w.u32(0x06054B50);            /* end of central directory */
    w.u16(0);
    w.u16(0);
    w.u16(parts.length);
    w.u16(parts.length);
    w.u32(cdSize);
    w.u32(cdStart);
    w.u16(0);

    return new Blob([w.done()], { type: 'application/zip' });
  }

  global.VissRadZip = { crc32: crc32, zipBlob: zipBlob };
})(window);
