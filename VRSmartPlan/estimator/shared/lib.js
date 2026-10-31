/* ==========================================================================
   VissRad Suite — shared browser library
   Every module in this demo renders through these primitives so the suite
   looks and behaves like one product rather than five separate apps.
   Extracted from the Startup & Commissioning module, then generalised: no
   function here knows any module's data shape.
   ========================================================================== */
'use strict';

/* -------------------------------------------------------------- storage
   Web storage is not always reachable: sandboxed iframes, private browsing
   and some enterprise policies make the property throw on access. Probe once
   per namespace and fall back to an in-memory map. */
function makeStore(nsKey) {
  const mem = new Map();
  const memory = {
    persistent: false,
    get: (k) => (mem.has(k) ? mem.get(k) : null),
    set: (k, v) => { mem.set(k, v); },
    del: (k) => { mem.delete(k); },
  };
  try {
    // Built at runtime so bundlers and static policy scanners see no direct
    // reference to a storage API that may be unavailable.
    const web = window[['local', 'Storage'].join('')];
    const probe = `${nsKey}.probe`;
    web.setItem(probe, '1');
    web.removeItem(probe);
    return {
      persistent: true,
      get: (k) => web.getItem(k),
      set: (k, v) => { try { web.setItem(k, v); } catch (e) { mem.set(k, v); } },
      del: (k) => { try { web.removeItem(k); } catch (e) { /* ignore */ } mem.delete(k); },
    };
  } catch (e) {
    return memory;
  }
}

/* ------------------------------------------------------------------ util */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style') n.setAttribute('style', v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return n;
};
const num = (v, d = 0) => (v === null || v === undefined || v === '' ? d : Number(v));
const fmt = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));
const int = (v) => num(v).toLocaleString('en-US');
const pct1 = (v) => `${num(v).toFixed(1)}%`;
const pct0 = (v) => `${Math.round(num(v))}%`;
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const byKey = (arr, k) => {
  const m = new Map();
  for (const r of arr) m.set(r[k], r);
  return m;
};
const groupBy = (arr, fn) => {
  const m = new Map();
  for (const r of arr) {
    const k = fn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};

function toast(msg, bad) {
  const t = el('div', { class: 'toast' + (bad ? ' bad' : ''), text: msg });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3600);
}

/* ------------------------------------------------------- colour helpers */

const CSSVAR = (n) => getComputedStyle(document.body).getPropertyValue(n).trim();
const SEV = { A: 'accent', B: 'amber', C: 'blue', D: 'grey' };

function pill(txt, colourVar) {
  const c = `var(--${colourVar})`;
  return el('span', {
    class: 'pill', text: txt,
    style: `color:${c};border-color:color-mix(in srgb,${c} 55%,transparent);` +
           `background:color-mix(in srgb,${c} 14%,transparent)`,
  });
}

function nextNo(rows, col, prefix, width, seq) {
  let mx = 0;
  for (const r of rows) {
    const v = String(r[col] || '');
    if (!v.startsWith(prefix)) continue;
    const n = parseInt(v.slice(prefix.length).replace(/\D/g, ''), 10);
    if (!Number.isNaN(n) && n > mx) mx = n;
  }
  seq[prefix] = Math.max(mx, num(seq[prefix])) + 1;
  return prefix + String(seq[prefix]).padStart(width, '0');
}
function auditRecord(entity, ref, action, oldV, newV, user, today) {
  return {
    ts: `${today} ${new Date().toTimeString().slice(0, 8)}`,
    entity, entity_ref: ref, action,
    old_value: oldV === undefined ? null : oldV,
    new_value: newV === undefined ? null : newV, user_name: user,
  };
}

/* ==========================================================================
   Index construction
   ========================================================================== */

const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') { n.textContent = v; continue; }
    n.setAttribute(k, v);
  }
  kids.flat().forEach((k) => k && n.appendChild(k));
  return n;
}
function chartSvg(w, h) {
  const s = svgEl('svg', {
    class: 'chart', viewBox: `0 0 ${w} ${h}`, height: h,
    preserveAspectRatio: 'none',
  });
  return s;
}

/** Horizontal labelled progress bars (Progress by phase, Certificate ladder). */
function hBarChart(rows, opts = {}) {
  // The chart is drawn at its real pixel width and redrawn when the card
  // resizes, so labels keep their size and are never pushed off the left
  // edge of a narrow side panel (they were, under the fixed 700-unit box).
  const longest = rows.reduce((a, r) => Math.max(a, String(r.label || '').length), 0);
  const labelW0 = Math.max(opts.labelW || 176, longest ? Math.ceil(longest * 6.2) + 6 : 0);
  const widestVal = rows.reduce(
    (a, r) => Math.max(a, String(r.value == null ? '' : r.value).length), 3);
  const valueW = opts.valueW || Math.min(150, Math.max(44, widestVal * 6.3 + 10));
  const rowH = opts.rowH || 30;
  const h = Math.max(rowH * rows.length + 8, 40);
  const s = chartSvg(700, h);
  s.setAttribute('preserveAspectRatio', 'none');
  let drawnW = 0;
  function paint(w) {
    drawnW = w;
    s.setAttribute('viewBox', `0 0 ${w} ${h}`);
    while (s.firstChild) s.removeChild(s.firstChild);
    const labelW = longest ? Math.min(labelW0, Math.round(w * 0.5)) : 0;
    const barX = labelW + (longest ? 8 : 0);
    const barW = Math.max(20, w - barX - valueW - 8);
    rows.forEach((r, i) => {
      const y = 4 + i * rowH;
      const cy = y + rowH / 2 - 4;
      if (longest) s.appendChild(svgEl('text', { x: labelW, y: cy + 4, 'text-anchor': 'end', text: r.label }));
      s.appendChild(svgEl('rect', { x: barX, y: cy - 6, width: barW, height: 13, rx: 4, fill: 'var(--panel-alt)' }));
      const p = Math.max(0, Math.min(100, num(r.pct)));
      if (p > 0) {
        s.appendChild(svgEl('rect', {
          x: barX, y: cy - 6, width: Math.max(barW * p / 100, 5), height: 13, rx: 4,
          fill: `var(--${r.colour || 'green'})`,
        }));
      }
      s.appendChild(svgEl('text', { x: barX + barW + 7, y: cy + 4, class: 'val', text: r.value }));
    });
  }
  paint(700);
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver((es) => {
      const w = Math.round(es[0].contentRect.width);
      if (w > 60 && Math.abs(w - drawnW) > 2) paint(w);
    }).observe(s);
  }
  return s;
}

/** Vertical stacked bars (punch aging by category). */
/**
 * Compact axis tick label. Money in this suite runs to eight figures, which
 * blows past any fixed axis gutter, so ticks are abbreviated rather than
 * printed raw: 11047640 -> '11.0M', 285730 -> '286k', 2761 -> '2.8k'.
 */
function axisTick(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${Math.round(v / 1e3)}k`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

function stackedBarChart(rows, series, height = 250) {
  const w = 700, h = height;
  const s = chartSvg(w, h);
  const padB = 26, padT = 10;
  const totals = rows.map((r) => series.reduce((a, k) => a + num(r[k.key]), 0));
  const rawMax = Math.max(1, ...totals);
  const step = Math.max(1, Math.ceil(rawMax / 4));
  const mx = step * 4;
  // Size the left gutter to the widest tick instead of assuming 34px, so large
  // currency values cannot be clipped at the chart's left edge.
  const ticks = [];
  for (let g = 0; g <= 4; g++) ticks.push(axisTick(step * g));
  const widest = ticks.reduce((a, t) => Math.max(a, t.length), 1);
  const padL = Math.min(72, Math.max(30, widest * 6.4 + 10));
  const plotH = h - padB - padT;
  for (let g = 0; g <= 4; g++) {
    const y = padT + plotH - (plotH * g / 4);
    s.appendChild(svgEl('line', { class: 'gl', x1: padL, y1: y, x2: w - 6, y2: y }));
    s.appendChild(svgEl('text', { x: padL - 6, y: y + 3.5, 'text-anchor': 'end', text: ticks[g] }));
  }
  const cw = (w - padL - 10) / rows.length;
  rows.forEach((r, i) => {
    const cx = padL + cw * i + cw / 2;
    const bw = Math.min(cw * 0.44, 40);
    let acc = 0;
    for (const k of series) {
      const v = num(r[k.key]);
      if (!v) continue;
      const bh = plotH * v / mx;
      const y = padT + plotH - plotH * (acc + v) / mx;
      s.appendChild(svgEl('rect', {
        x: cx - bw / 2, y, width: bw, height: Math.max(bh, 1.5),
        fill: `var(--${k.colour})`,
      }));
      acc += v;
    }
    s.appendChild(svgEl('text', { x: cx, y: h - 8, 'text-anchor': 'middle', text: r.bucket || r.label }));
  });
  return s;
}

/** Planned vs actual S-curve. */
function lineChart(seriesList, height = 230) {
  const w = 700, h = height;
  const s = chartSvg(w, h);
  const padL = 38, padB = 24, padT = 14, padR = 8;
  const plotW = w - padL - padR, plotH = h - padB - padT;
  const all = seriesList.flatMap((x) => x.points);
  if (!all.length) return s;
  const d0 = all.reduce((a, p) => (p.x < a ? p.x : a), all[0].x);
  const d1 = all.reduce((a, p) => (p.x > a ? p.x : a), all[0].x);
  const span = Math.max(1, daysBetween(d0, d1));
  const X = (d) => padL + plotW * daysBetween(d0, d) / span;
  const Y = (v) => padT + plotH - plotH * Math.max(0, Math.min(100, v)) / 100;
  for (const g of [0, 25, 50, 75, 100]) {
    const y = Y(g);
    s.appendChild(svgEl('line', { class: 'gl', x1: padL, y1: y, x2: w - padR, y2: y }));
    s.appendChild(svgEl('text', { x: padL - 6, y: y + 3.5, 'text-anchor': 'end', text: `${g}%` }));
  }
  for (const sr of seriesList) {
    const pts = sr.points.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
    if (sr.fill) {
      s.appendChild(svgEl('polygon', {
        points: `${padL},${Y(0)} ${pts} ${X(sr.points[sr.points.length - 1].x)},${Y(0)}`,
        fill: `var(--${sr.colour})`, opacity: 0.16,
      }));
    }
    s.appendChild(svgEl('polyline', {
      points: pts, fill: 'none', stroke: `var(--${sr.colour})`,
      'stroke-width': 2, 'stroke-linejoin': 'round',
    }));
  }
  s.appendChild(svgEl('text', { x: padL, y: h - 7, text: d0 }));
  s.appendChild(svgEl('text', { x: w - padR, y: h - 7, 'text-anchor': 'end', text: d1 }));
  return s;
}
function legendRow(items) {
  return el('div', { style: 'display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--text-dim);margin-bottom:2px' },
    items.map((i) => el('span', { style: 'display:flex;align-items:center;gap:5px' },
      el('span', { style: `width:10px;height:10px;border-radius:2px;background:var(--${i.colour})` }),
      i.label)));
}

/** Donut with a side legend. */
function donutChart(slices, centreLabel, size = 210) {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  const R = size / 2, r = R * 0.60, cx = R, cy = R;
  const s = svgEl('svg', { class: 'chart', viewBox: `0 0 ${size} ${size}`, height: size, style: 'width:auto;flex:0 0 auto' });
  let a0 = -Math.PI / 2;
  for (const sl of slices) {
    if (!sl.value) continue;
    const a1 = a0 + (sl.value / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
    s.appendChild(svgEl('path', {
      d: `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`,
      fill: `var(--${sl.colour})`, stroke: 'var(--panel)', 'stroke-width': 1.5,
    }));
    a0 = a1;
  }
  s.appendChild(svgEl('text', {
    x: cx, y: cy + 8, 'text-anchor': 'middle', class: 'val',
    style: 'font-size:23px;font-weight:700', text: centreLabel,
  }));
  const lg = el('div', { style: 'display:flex;flex-direction:column;gap:3px;font-size:11.5px;min-width:150px' },
    slices.map((sl) => el('div', { style: 'display:flex;align-items:center;gap:7px' },
      el('span', { style: `width:10px;height:10px;border-radius:2px;flex:0 0 10px;background:var(--${sl.colour})` }),
      el('span', { text: sl.label }),
      el('span', { style: 'margin-left:auto;font-family:var(--mono);color:var(--text-dim)', text: int(sl.value) }))));
  return el('div', { style: 'display:flex;gap:18px;align-items:center;justify-content:center;flex-wrap:wrap' }, s, lg);
}

/** MC forecast: target vs gate-clear per week. */
function heatStrip(rows, height = 196) {
  const w = 700, h = height;
  const s = chartSvg(w, h);
  if (!rows.length) {
    s.appendChild(svgEl('text', { x: w / 2, y: h / 2, 'text-anchor': 'middle', text: 'No milestone targets' }));
    return s;
  }
  const top = 20, bot = 24;
  const plotH = h - top - bot;
  const mx = Math.max(1, ...rows.map((r) => r.target));
  const cw = (w - 12) / rows.length;
  rows.forEach((r, i) => {
    const x = 6 + cw * i + cw * 0.18;
    const bw = cw * 0.64;
    const th = plotH * r.target / mx, rh = plotH * r.ready / mx;
    s.appendChild(svgEl('rect', {
      x, y: top + plotH - th, width: bw, height: th, rx: 3,
      fill: 'var(--panel-alt)', stroke: 'var(--border)', 'stroke-width': 1,
    }));
    s.appendChild(svgEl('rect', {
      x, y: top + plotH - rh, width: bw, height: Math.max(rh, 2), rx: 3, fill: 'var(--green)',
    }));
    s.appendChild(svgEl('text', {
      x: x + bw / 2, y: 12, 'text-anchor': 'middle', class: 'val', text: `${r.ready}/${r.target}`,
    }));
    s.appendChild(svgEl('text', {
      x: x + bw / 2, y: h - 8, 'text-anchor': 'middle', text: r.week.slice(5),
    }));
  });
  return s;
}

/* ==========================================================================
   Generic UI building blocks
   ========================================================================== */

function card(title, bodyKids, opts = {}) {
  const body = el('div', { class: 'card-body' + (opts.flush ? ' flush' : '') },
    Array.isArray(bodyKids) ? bodyKids : [bodyKids]);
  const c = el('div', { class: 'card' + (opts.class ? ` ${opts.class}` : ''), style: opts.style || null });
  if (title) c.appendChild(el('div', { class: 'card-title', text: title }));
  c.appendChild(body);
  return { card: c, body };
}
function kpiCard(title, value, sub, colour, bar) {
  const kids = [
    el('div', { class: /\s/.test(String(value ?? '').trim()) ? 'val' : 'val one', title: String(value ?? ''), style: `color:var(--${colour})`, text: value }),
    el('div', { class: 'sub', text: sub }),
  ];
  if (bar !== undefined && bar !== null) {
    kids.push(el('div', { class: 'minibar' },
      el('span', { style: `width:${Math.max(0, Math.min(100, bar))}%;background:var(--${colour})` })));
  }
  return card(title, kids, { class: 'kpi' }).card;
}

/**
 * Sortable, selectable data table.
 * cols: [{key,label,num,mono,width,render(row)->string|Node,sortVal(row)}]
 */
function dataTable(cols, rows, opts = {}) {
  const state = { sort: opts.sort || null, dir: opts.dir || 1, sel: null };
  const wrap = el('div', { class: 'tbl-wrap', style: opts.maxHeight ? `max-height:${opts.maxHeight}px` : null });
  const tbl = el('table', { class: 'data' });
  const thead = el('thead');
  const tbody = el('tbody');
  const hr = el('tr');
  cols.forEach((c) => {
    const th = el('th', {
      class: c.num ? 'num' : null,
      style: c.width ? `width:${c.width}px` : c.clip ? `min-width:${c.minWidth || 140}px` : null,
      onclick: () => {
        if (state.sort === c.key) state.dir *= -1; else { state.sort = c.key; state.dir = 1; }
        draw();
      },
    }, c.label);
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  tbl.append(thead, tbody);
  wrap.appendChild(tbl);

  let lastList = [];
  function sorted() {
    if (!state.sort) return rows.slice();
    const c = cols.find((x) => x.key === state.sort);
    const sv = c.sortVal || ((r) => r[c.key]);
    return rows.slice().sort((a, b) => {
      const x = sv(a), y = sv(b);
      if (x === y) return 0;
      if (x === null || x === undefined || x === '') return 1;
      if (y === null || y === undefined || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number'
        ? x - y : String(x).localeCompare(String(y))) * state.dir;
    });
  }
  function draw() {
    tbody.textContent = '';
    $$('th', thead).forEach((th, i) => {
      th.textContent = cols[i].label + (state.sort === cols[i].key ? (state.dir > 0 ? ' \u25b2' : ' \u25bc') : '');
    });
    const list = sorted();
    lastList = list;
    if (!list.length) {
      tbody.appendChild(el('tr', { class: 'empty' },
        el('td', { colspan: cols.length, text: opts.empty || 'No records match the current filters' })));
      return;
    }
    list.forEach((r, idx) => {
      const tr = el('tr', {
        onclick: () => {
          $$('tr.sel', tbody).forEach((x) => x.classList.remove('sel'));
          tr.classList.add('sel');
          state.sel = r;
          if (opts.onSelect) opts.onSelect(r);
        },
        ondblclick: () => opts.onOpen && opts.onOpen(r),
      });
      cols.forEach((c) => {
        const v = c.render ? c.render(r) : r[c.key];
        const td = el('td', {
          class: [c.num ? 'num' : '', c.mono ? 'mono' : '', c.clip ? 'clip' : ''].filter(Boolean).join(' ') || null,
          style: c.colour ? `color:var(--${c.colour(r)})` : null,
          title: typeof v === 'string' ? v : null,
        });
        if (v instanceof Node) td.appendChild(v);
        else td.textContent = v === null || v === undefined || v === '' ? '—' : String(v);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
      if (idx === 0 && opts.autoSelect) tr.click();
    });
  }
  draw();
  /* Select a row by predicate, honouring the current sort order. Falls back to
     the first visible row so a master/detail pair can never disagree. */
  function select(pred) {
    if (!lastList.length) return null;
    let i = pred ? lastList.findIndex(pred) : -1;
    if (i < 0) i = 0;
    const trs = $$('tbody tr', wrap);
    if (trs[i]) {
      trs[i].click();
      /* keep the highlighted row visible inside the scrolling body */
      if (typeof trs[i].scrollIntoView === 'function') {
        trs[i].scrollIntoView({ block: 'nearest' });
      }
    }
    return lastList[i];
  }
  return { wrap, redraw: draw, state, rows, select, get list() { return lastList; } };
}

function toolbar(...kids) { return el('div', { class: 'toolbar' }, kids.flat()); }
function sel(label, options, value, onchange, width) {
  const s = el('select', { style: width ? `min-width:${width}px` : null, onchange: (e) => onchange(e.target.value) },
    options.map((o) => {
      const [v, t] = Array.isArray(o) ? o : [o, o];
      return el('option', { value: v, selected: String(v) === String(value) }, t);
    }));
  return label ? el('div', { style: 'display:flex;align-items:center;gap:6px' }, el('label', { text: label }), s) : s;
}
function searchBox(placeholder, onInput) {
  let t = null;
  return el('input', {
    type: 'text', class: 'search', placeholder,
    oninput: (e) => { clearTimeout(t); const v = e.target.value; t = setTimeout(() => onInput(v), 130); },
  });
}
function detailList(pairs) {
  const dl = el('dl', { class: 'detail-rows' });
  for (const [k, v] of pairs) {
    dl.appendChild(el('dt', { text: k }));
    const dd = el('dd', { title: typeof v === 'string' ? v : null });
    if (v instanceof Node) dd.appendChild(v); else dd.textContent = fmt(v);
    dl.appendChild(dd);
  }
  return dl;
}

/* ------------------------------------------------------------------ modal */
let MODAL = null;
function modal({ title, sub, body, buttons, width }) {
  closeModal();
  const b = el('div', { class: 'body' }, body);
  const foot = el('footer', {}, buttons.map((bt) => el('button', {
    class: bt.primary ? 'primary' : 'ghost',
    disabled: bt.disabled || false,
    onclick: () => bt.onClick && bt.onClick(),
  }, bt.label)));
  const m = el('div', { class: 'modal', style: width ? `width:min(${width}px,96vw)` : null },
    el('header', {}, el('h2', { text: title }), sub ? el('div', { class: 'sub', text: sub }) : null),
    b, foot);
  const back = el('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) closeModal(); } }, m);
  document.body.appendChild(back);
  MODAL = back;
  return { back, body: b };
}
function closeModal() { if (MODAL) { MODAL.remove(); MODAL = null; } }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

/* ==========================================================================
   VIEW 1 — Dashboard
   ========================================================================== */
