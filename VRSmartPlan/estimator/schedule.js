/* VREstimator — Schedule tab and P6 XER export.
   The estimate becomes a resource-loaded P6 schedule:
     project WBS -> area -> discipline package -> activities.
   Detailed Takeoff disciplines give one activity per takeoff line in its
   area; Parametric / Known Qty disciplines give one activity each under
   "PW — Project-wide (factored)". Durations come from the crew on the line
   (or the discipline default crew), the crews working in parallel and the
   shift: work days = MH / (heads x crews x shift hours). Activities in a
   package follow each other (FS); the next discipline in an area starts
   after an overlap (SS + lag) and cannot finish before the previous one
   (FF); areas are staggered (SS + lag). Each area ends with a mechanical
   completion milestone.
   The file is written by the VRTAR XER writer (VRPlanner calendar edition,
   vendor/vrtar-writers.js) unchanged; links between packages are added to
   its TASKPRED table afterwards because the writer only links inside a
   package. */

const SCH_WEEKS = { 4: [0, 1, 1, 1, 1, 0, 0], 5: [0, 1, 1, 1, 1, 1, 0], 6: [0, 1, 1, 1, 1, 1, 1], 7: [1, 1, 1, 1, 1, 1, 1] };
const SCH_DISC_CODE = { Civil: 'CIV', Structural: 'STR', Mechanical: 'MEC', Piping: 'PIP', Electrical: 'ELE', Instrumentation: 'INS', Insulation: 'INU', Painting: 'PAI' };
const SCH_FALLBACK_HEADS = 6;

function schedDefaults(d) {
  const p = (d && d.project) || {};
  return { start: p.data_date || TODAY, start_h: 7, days_week: 5, shift_h: 10, stagger_wd: 10, overlap_pct: 30, target_wd: 120, crews: {}, include: {} };
}
function schedEnsure(d) {
  const def = schedDefaults(d);
  if (!d.sched || typeof d.sched !== 'object') d.sched = def;
  Object.keys(def).forEach((k) => { if (d.sched[k] === undefined || d.sched[k] === null || d.sched[k] === '') d.sched[k] = def[k]; });
  if (typeof d.sched.crews !== 'object') d.sched.crews = {};
  if (typeof d.sched.include !== 'object') d.sched.include = {};
}

/* Working-time clock: hours of work from the start -> a calendar Date, on a
   week of `week` days with `hpd` hours a day starting at startH and a 1 h
   meal break after 4 h (matches the writer's clndr_data). */
function schedClock(start, startH, hpd, week) {
  const days = week.filter(Boolean).length;
  const b = new Date(`${start}T00:00`);
  const base = isNaN(b) ? new Date(`${TODAY}T00:00`) : b;
  return (hrs, fin) => {
    let o = Math.floor(num(hrs) / hpd), i = num(hrs) - o * hpd;
    if (fin && i < 1e-9 && o > 0) { o -= 1; i = hpd; }
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    while (!week[d.getDay()]) d.setDate(d.getDate() + 1);
    d.setDate(d.getDate() + 7 * Math.floor(o / days));
    let c = o % days;
    while (c > 0) { d.setDate(d.getDate() + 1); if (week[d.getDay()]) c -= 1; }
    const u = startH + i + (i > 4 + 1e-9 || (i > 4 - 1e-9 && !fin) ? 1 : 0);
    d.setMinutes(Math.round(60 * u));
    return d;
  };
}
const schedDay = (d) => (isNaN(d) ? '\u2014' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
const schedSlug = (s, n) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, n || 20).replace(/-+$/, '');

/** Crew picture for one line: heads, labor shares by craft, equipment units. */
function schedCrewFor(c, disc, craft) {
  const cr = c && c.crew ? c.crew : (disc && disc.crew && IDX.crewById ? IDX.crewById.get(disc.crew) : null);
  if (cr && cr.heads > 0) {
    return { name: cr.crew.name, id: cr.crew.id, heads: cr.heads, mix: cr.mix.map((m) => ({ craft: m.craft, share: m.share })),
      equip: (cr.crew.equipment || []).filter((e) => num(e.qty) > 0).map((e) => ({ desc: e.desc, qty: num(e.qty), rate: num(e.rate_hr) })) };
  }
  if (craft) return { name: `${craft} crew`, id: '', heads: SCH_FALLBACK_HEADS, mix: [{ craft, share: 1 }], equip: [] };
  const crafts = (DISC_CRAFTS_FALLBACK[disc ? disc.discipline : ''] || []).filter((x) => IDX.craftByName.get(x));
  const list = crafts.length ? crafts : [D.crafts[0] ? D.crafts[0].craft : 'Craft'];
  return { name: `${disc ? disc.discipline : ''} crafts`, id: '', heads: SCH_FALLBACK_HEADS, mix: list.map((x) => ({ craft: x, share: 1 / list.length })), equip: [] };
}

/** Build the schedule model from the live estimate. */
function schedBuild() {
  schedEnsure(D);
  const S = D.sched;
  const hpd = Math.max(1, Math.min(24, num(S.shift_h, 10) || 10));
  const dpw = SCH_WEEKS[num(S.days_week)] ? num(S.days_week) : 5;
  const week = SCH_WEEKS[dpw].map(Boolean);
  const startH = Math.max(0, Math.min(23 - hpd > 0 ? 23 - hpd : 0, num(S.start_h, 7)));
  const R = rollup();
  const areaName = new Map(D.areas.map((a) => [a.area_code || a.code, a.area_name || a.name]));
  const discIdx = new Map(D.disciplines.map((d, i) => [d.discipline, i]));
  const inc = (d) => S.include[d.discipline] !== false;

  /* 1. packages with raw activities (MH, crew) */
  const pk = new Map(); // key area|disc
  const getPk = (area, disc) => {
    const k = `${area}|${disc.discipline}`;
    if (!pk.has(k)) pk.set(k, { area, disc, wo: `${area}-${SCH_DISC_CODE[disc.discipline] || schedSlug(disc.discipline, 3)}`, acts: [], mh: 0 });
    return pk.get(k);
  };
  D.disciplines.filter((d) => d.method === 'detailed_takeoff' && inc(d)).forEach((d) => {
    (IDX.linesByDisc.get(d.discipline) || []).forEach((l) => {
      const c = computeLine(l);
      if (!(c.totalMh > 0)) return;
      const area = l.area && areaName.has(l.area) ? l.area : (l.area ? schedSlug(l.area, 8) : 'NA');
      const p = getPk(area, d);
      p.acts.push({ line: l, mh: c.totalMh, crew: schedCrewFor(c, d, l.craft), desc: `${l.description || (c.mhRow && c.mhRow.work_item) || l.master_key} \u2014 ${int(Math.round(num(l.quantity)))} ${l.unit || ''}`.trim(), lineId: l.line_id || l.id });
      p.mh += c.totalMh;
    });
  });
  R.usedByDisc.filter((u) => u.disc.method !== 'detailed_takeoff' && inc(u.disc) && u.usedMh > 0).forEach((u) => {
    const p = getPk('PW', u.disc);
    p.acts.push({ line: null, mh: u.usedMh, crew: schedCrewFor(null, u.disc, ''), desc: `${u.disc.discipline} construction (${METHOD_LABEL[u.disc.method] || u.disc.method})`, lineId: 'ALL' });
    p.mh += u.usedMh;
  });

  /* 2. crews in parallel per discipline: user value or auto from the target */
  const discStats = new Map();
  [...pk.values()].forEach((p) => {
    const s = discStats.get(p.disc.discipline) || { disc: p.disc, mh: 0, maxPk: 0, heads: 0, wMh: 0, pkgs: 0 };
    s.mh += p.mh; s.maxPk = Math.max(s.maxPk, p.mh); s.pkgs += 1;
    p.acts.forEach((a) => { s.heads += a.crew.heads * a.mh; s.wMh += a.mh; });
    discStats.set(p.disc.discipline, s);
  });
  const tgt = Math.max(1, num(S.target_wd, 120));
  const pkHeads = (p) => { const w = p.acts.reduce((a, x) => a + x.mh, 0); return w ? p.acts.reduce((a, x) => a + x.crew.heads * x.mh, 0) / w : SCH_FALLBACK_HEADS; };
  /* crews for a package: the user's number for the discipline, or enough to
     finish the package near the target duration */
  const crewsFor = (p) => { const u = num(S.crews[p.disc.discipline]); return u >= 1 ? Math.round(u) : Math.max(1, Math.ceil(p.mh / (pkHeads(p) * hpd * tgt))); };
  discStats.forEach((s, k) => {
    s.avgHeads = s.wMh ? s.heads / s.wMh : SCH_FALLBACK_HEADS;
    const u = num(S.crews[k]);
    s.isAuto = !(u >= 1);
    const list = [...pk.values()].filter((p) => p.disc.discipline === k).map(crewsFor);
    s.crewMin = Math.min(...list); s.crewMax = Math.max(...list); s.crews = s.crewMax;
    s.auto = s.crewMax;
  });

  /* 3. rows, durations, intra-package FS links */
  const order = (a, b) => (a === 'PW') - (b === 'PW') || String(a).localeCompare(String(b));
  const areas = [...new Set([...pk.values()].map((p) => p.area))].sort(order);
  const pkgs = [];
  areas.forEach((area) => {
    [...pk.values()].filter((p) => p.area === area).sort((a, b) => discIdx.get(a.disc.discipline) - discIdx.get(b.disc.discipline)).forEach((p) => {
      const n = crewsFor(p);
      p.crews = n;
      const used = new Set();
      p.rows = p.acts.map((a, i) => {
        let uid = String(a.lineId);
        if (uid.startsWith(`${p.wo}-`)) uid = uid.slice(p.wo.length + 1);
        uid = schedSlug(uid, 18) || `A${i + 1}`;
        while (used.has(uid)) uid = `${uid.slice(0, 15)}-${i + 1}`;
        used.add(uid);
        const days = Math.max(1, Math.ceil(a.mh / (a.crew.heads * n * hpd)));
        return { uid, desc: a.desc.slice(0, 120), dur: days * hpd, days, mh: a.mh, crew: a.crew, crews: n, preds: [], line: a.line };
      });
      p.rows.forEach((r, i) => { if (i) r.preds.push({ id: p.rows[i - 1].uid, type: 'FS', lag: 0 }); });
      p.days = p.rows.reduce((x, r) => x + r.days, 0);
      pkgs.push(p);
    });
  });

  /* 4. links between packages (and milestones) */
  const links = []; // {from:{p,uid}, to:{p,uid}, type, lag}
  const ms = [];
  const ovl = Math.max(0, Math.min(100, num(S.overlap_pct, 30))) / 100;
  let prevFirst = null;
  areas.forEach((area) => {
    const list = pkgs.filter((p) => p.area === area);
    list.forEach((p, i) => {
      if (!i) return;
      const q = list[i - 1];
      links.push({ from: [q, q.rows[0].uid], to: [p, p.rows[0].uid], type: 'SS', lag: Math.round(q.days * ovl) * hpd });
      links.push({ from: [q, q.rows[q.rows.length - 1].uid], to: [p, p.rows[p.rows.length - 1].uid], type: 'FF', lag: 0 });
    });
    if (area !== 'PW') {
      if (prevFirst && list.length) links.push({ from: prevFirst, to: [list[0], list[0].rows[0].uid], type: 'SS', lag: Math.max(0, num(S.stagger_wd, 10)) * hpd });
      if (list.length) prevFirst = [list[0], list[0].rows[0].uid];
    }
    const m = { area, wo: `${area}-MS`, disc: null, rows: [{ uid: 'MC', desc: `${area === 'PW' ? 'Project-wide factored scope' : `${area} ${areaName.get(area) || ''}`.trim()} \u2014 mechanical completion`, dur: 0, days: 0, mh: 0, crew: null, crews: 0, preds: [] }], milestone: true };
    list.forEach((p) => links.push({ from: [p, p.rows[p.rows.length - 1].uid], to: [m, 'MC'], type: 'FS', lag: 0 }));
    if (list.length) ms.push(m);
  });
  /* one open start and one open end: project-wide work starts with the first
     area, and a project milestone closes every area's mechanical completion */
  const firstArea = areas.find((a) => a !== 'PW');
  const pw = pkgs.filter((p) => p.area === 'PW');
  if (firstArea && pw.length) { const f = pkgs.find((p) => p.area === firstArea); links.push({ from: [f, f.rows[0].uid], to: [pw[0], pw[0].rows[0].uid], type: 'SS', lag: 0 }); }
  if (ms.length > 1) {
    const pm = { area: 'PRJ', wo: 'PRJ-MS', disc: null, rows: [{ uid: 'MC', desc: 'Project mechanical completion', dur: 0, days: 0, mh: 0, crew: null, crews: 0, preds: [] }], milestone: true };
    ms.forEach((m) => links.push({ from: [m, 'MC'], to: [pm, 'MC'], type: 'FS', lag: 0 }));
    ms.push(pm); areas.push('PRJ');
  }
  const all = [];
  areas.forEach((a) => { pkgs.filter((p) => p.area === a).forEach((p) => all.push(p)); ms.filter((m) => m.area === a).forEach((m) => all.push(m)); });

  /* 5. forward pass (construction order is topological) */
  const key = (p, uid) => `${p.wo}|${uid}`;
  const node = new Map();
  all.forEach((p) => p.rows.forEach((r) => { r.inX = []; node.set(key(p, r.uid), r); }));
  links.forEach((L) => node.get(key(...L.to)).inX.push({ r: node.get(key(...L.from)), type: L.type, lag: L.lag }));
  all.forEach((p) => p.rows.forEach((r, i) => {
    let es = 0;
    const ins = r.inX.slice();
    if (i && r.preds.length) ins.push({ r: p.rows[i - 1], type: 'FS', lag: 0 });
    ins.forEach((x) => {
      const v = x.type === 'SS' ? x.r.es + x.lag : x.type === 'FF' ? x.r.ef + x.lag - r.dur : x.r.ef + x.lag;
      es = Math.max(es, v);
    });
    r.es = es; r.ef = es + r.dur;
  }));
  all.forEach((p) => { p.es = Math.min(...p.rows.map((r) => r.es)); p.ef = Math.max(...p.rows.map((r) => r.ef)); });

  /* 6. resources: crafts (labor) and crew equipment */
  const res = new Map();
  const codes = new Set();
  const addRes = (id, name, type, rate, base) => {
    if (res.has(id)) return res.get(id);
    let c = schedSlug(base, 20) || 'RES', k = 2;
    while (codes.has(c)) { c = `${schedSlug(base, 17)}-${k}`; k += 1; }
    codes.add(c);
    const o = { id, name, type, rate, code: c }; res.set(id, o); return o;
  };
  const totByRes = {};
  all.forEach((p) => p.rows.forEach((r) => {
    r.byRes = {}; r.labour = 0; r.equip = 0;
    if (!r.crew) return;
    r.crew.mix.forEach((m) => {
      const cr = IDX.craftByName.get(m.craft);
      const o = addRes(`L:${m.craft}`, m.craft, 'labor', num(cr ? cr.all_in_rate : 0), m.craft);
      const h = r.mh * m.share; if (!(h > 0)) return;
      r.byRes[o.id] = (r.byRes[o.id] || 0) + h; r.labour += h;
    });
    const crewHrs = r.mh / r.crew.heads;
    r.crew.equip.forEach((e) => {
      const o = addRes(`E:${e.desc}`, e.desc, 'equip', e.rate, `EQ-${e.desc}`);
      const h = crewHrs * e.qty; if (!(h > 0)) return;
      r.byRes[o.id] = (r.byRes[o.id] || 0) + h; r.equip += h;
    });
    Object.keys(r.byRes).forEach((k) => { totByRes[k] = (totByRes[k] || 0) + r.byRes[k]; });
    r.labour = Math.round(r.labour * 100) / 100; r.equip = Math.round(r.equip * 100) / 100;
  }));

  /* 7. headcount by working day (heads x crews while an activity runs) */
  const finish = all.length ? Math.max(...all.map((p) => p.ef)) : 0;
  const nDays = Math.ceil(finish / hpd);
  const heads = new Array(Math.max(0, nDays)).fill(0);
  pkgs.forEach((p) => p.rows.forEach((r) => { for (let d = Math.floor(r.es / hpd); d < Math.ceil(r.ef / hpd) && d < nDays; d++) heads[d] += r.crew.heads * r.crews; }));

  const clock = schedClock(S.start, startH, hpd, week);
  const p0 = D.project;
  const ctx = {
    event: { code: schedSlug(p0.project_no || 'VREST', 20), name: `${p0.project_name || 'Estimate'} \u2014 construction schedule from ${EST_BRAND}`, data_date: S.start, currency: p0.currency || 'USD', wbs_root: schedSlug(p0.project_no || 'VREST', 40), shutdown: `${S.start}T${String(Math.floor(startH)).padStart(2, '0')}:00` },
    units: areas.map((a) => ({ code: a, name: a === 'PW' ? 'Project-wide (factored disciplines)' : a === 'PRJ' ? 'Project milestones' : (areaName.get(a) || a) })),
    resources: [...res.values()].map((o) => ({ id: o.id, name: o.name, type: o.type, rate: Math.round(o.rate * 100) / 100, code: o.code })),
    resCode: (o) => o.code,
    cal: { name: `${EST_BRAND} ${dpw}-day week, ${hpd} h`, hpd, week, startH },
    clock,
  };
  const entries = all.map((p) => ({
    item: { id: p.wo, wo: p.wo, tag: p.milestone ? '' : (p.area === 'PW' ? 'PW' : p.area), desc: p.milestone ? 'Milestones' : p.disc.discipline, unit: p.area, after: [] },
    start: 0,
    est: { rows: p.rows.map((r) => ({ uid: r.uid, desc: r.desc, dur: r.dur, labour: r.labour, equip: r.equip, es: r.es, ef: r.ef, preds: r.preds, byRes: Object.fromEntries(Object.entries(r.byRes).map(([k, v]) => [k, Math.round(v * 100) / 100])) })),
      totals: { byRes: totByRes }, duration: p.ef - p.es, module_name: p.milestone ? 'Milestones' : p.disc.discipline, module_id: p.wo },
  }));
  const mhIn = pkgs.reduce((a, p) => a + p.mh, 0);
  return { S, hpd, dpw, week, startH, clock, pkgs, ms, all, links, areas, discStats, entries, ctx, finish, nDays, heads, mhIn, R,
    acts: all.reduce((a, p) => a + p.rows.length, 0), rels: all.reduce((a, p) => a + p.rows.reduce((b, r) => b + r.preds.length, 0), 0) + links.length };
}

/** XER text: the VRTAR writer, plus the cross-package links in TASKPRED. */
function schedXer(M) {
  const W = window.VissRadPlannerWriters;
  if (!W || !W.xer) throw new Error('XER writer not loaded');
  let x = W.xer(M.entries, M.ctx);
  x = x.replace(/^ERMHDR\t([^\t]*)\t([^\t]*)\tProject\tVRPlanner\tVissRad\tVRPlanner/, `ERMHDR\t$1\t$2\tProject\t${EST_BRAND}\tVissRad\t${EST_BRAND}`);
  const lines = x.split('\r\n');
  /* task_code -> task_id from the writer's TASK table */
  const ti = lines.indexOf('%T\tTASK');
  const f = lines[ti + 1].split('\t').slice(1);
  const iId = f.indexOf('task_id'), iCode = f.indexOf('task_code'), iProj = f.indexOf('proj_id');
  const idBy = new Map();
  let proj = '';
  for (let i = ti + 2; i < lines.length && lines[i].startsWith('%R'); i++) { const v = lines[i].split('\t').slice(1); idBy.set(v[iCode], v[iId]); proj = v[iProj]; }
  const code = (p, uid) => `${p.wo}-${uid}`.slice(0, 40);
  const pf = ['task_pred_id', 'task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt'];
  let pi = lines.indexOf('%T\tTASKPRED');
  let nextId = 25001, insertAt;
  if (pi >= 0) {
    insertAt = pi + 2;
    while (insertAt < lines.length && lines[insertAt].startsWith('%R')) { nextId = Math.max(nextId, num(lines[insertAt].split('\t')[1]) + 1); insertAt++; }
  } else {
    insertAt = lines.indexOf('%T\tTASKRSRC'); if (insertAt < 0) insertAt = lines.indexOf('%E');
  }
  const add = [];
  M.links.forEach((L) => {
    const a = idBy.get(code(...L.from)), b = idBy.get(code(...L.to));
    if (!a || !b) return;
    add.push(['%R', nextId++, b, a, proj, proj, `PR_${L.type}`, L.lag].join('\t'));
  });
  if (pi < 0 && add.length) add.unshift('%T\tTASKPRED', `%F\t${pf.join('\t')}`);
  /* finish milestones: start = finish (the writer starts them next morning) */
  const iType = f.indexOf('task_type'), iEs = f.indexOf('early_start_date'), iEe = f.indexOf('early_end_date'), iTs = f.indexOf('target_start_date'), iTe = f.indexOf('target_end_date');
  for (let i = ti + 2; i < lines.length && lines[i].startsWith('%R'); i++) {
    const v = lines[i].split('\t');
    if (v[iType + 1] === 'TT_FinMile') { v[iEs + 1] = v[iEe + 1]; v[iTs + 1] = v[iTe + 1]; lines[i] = v.join('\t'); }
  }
  lines.splice(insertAt, 0, ...add);
  return lines.join('\r\n');
}

function schedExport() {
  const M = schedBuild();
  if (!M.acts) { toast('Nothing to schedule: the estimate has no man-hours yet', true); return; }
  let text;
  try { text = schedXer(M); } catch (e) { toast(`XER export failed: ${e.message}`, true); return; }
  const name = `${schedSlug(D.project.project_no || EST_BRAND, 30)}-schedule.xer`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  audit('schedule', D.project.project_no, 'export_xer', null, `${M.acts} activities, ${M.rels} relationships, finish ${schedDay(M.clock(M.finish, true))}`);
  toast(`${name}: ${M.acts} activities, ${M.rels} relationships, ${M.ctx.resources.length} resources`);
}

const pkHeadsOf = (p) => { const w = p.rows.reduce((a, r) => a + r.mh, 0); return w ? p.rows.reduce((a, r) => a + r.crew.heads * r.mh, 0) / w : 0; };

/** VRSmartPlan: hand the schedule to the VRScheduler Schedule Editor on the
    same site (same handoff as VRPlanner / VRTAR / VRCMMS). */
const SCH_TO_SCHEDULE_KEY = 'vissrad.plan.toschedule.v1';
function schedEditorUrl() { const s = window.VR_STANDALONE; return s ? (s.schedule || '') : '../index.html#editor'; }
const SCHED_EDITOR_NAME = window.VR_STANDALONE ? 'the VRScheduler Schedule Editor' : 'the VRSCH Schedule Editor';
function schedSend() {
  const M = schedBuild();
  if (!M.acts) { toast('Nothing to schedule: the estimate has no man-hours yet', true); return; }
  let xer; try { xer = schedXer(M); } catch (e) { toast(`Could not build the schedule: ${e.message}`, true); return; }
  const msg = { v: 1, from: 'est', name: `${D.project.project_name || 'Estimate'} \u2014 ${D.project.project_no || ''}`.trim(), code: M.ctx.event.code, items: M.pkgs.length, acts: M.acts, at: new Date().toISOString(), xer };
  const hs = makeStore(SCH_TO_SCHEDULE_KEY);
  if (!hs.persistent) { toast('Browser storage is not available here \u2014 the schedule was downloaded as an XER instead; load it in the Schedule Editor.', true); schedExport(); return; }
  hs.set(SCH_TO_SCHEDULE_KEY, JSON.stringify(msg));
  if (hs.get(SCH_TO_SCHEDULE_KEY) === null) { toast('Browser storage is full \u2014 the schedule was downloaded as an XER instead; load it in the Schedule Editor.', true); schedExport(); return; }
  audit('schedule', D.project.project_no, 'send_to_editor', null, `${M.acts} activities, ${M.rels} relationships`);
  saveOverlay();
  /* The Schedule Editor opens in its own window (reused if already open, e.g.
     on another screen), so the estimate stays open here. A fresh query makes
     an open editor reload and pick the schedule up. */
  const u = new URL(schedEditorUrl(), location.href); u.searchParams.set('from', 'est'); u.searchParams.set('t', Date.now().toString(36));
  const w = window.open(u.href, 'vrproject-editor');
  if (w) { try { w.focus(); } catch (e) { /* ignore */ } toast('Opened in the Schedule Editor window'); } else location.href = u.href;
}

/* ---------- Schedule tab ---------- */
function viewSchedule(root) {
  const M = schedBuild();
  const S = M.S;
  const set = (k, v, what) => { const o = S[k]; S[k] = v; audit('schedule', k, 'set', o, v); refreshAll(); if (what) toast(what); };

  root.appendChild(el('div', { class: 'banner info', style: 'margin-bottom:10px' },
    el('b', { text: 'P6 schedule from the estimate. ' }),
    'Each area is a WBS node with a package per discipline; takeoff lines become activities and factored disciplines one activity each under Project-wide. Durations come from crew size, crews in parallel and shift hours, with labor and crew equipment loaded as resources. Export writes a Primavera P6 XER with the VRTAR writer.'));

  root.appendChild(toolbar(
    schedEditorUrl() ? el('button', { class: 'primary', onclick: schedSend, disabled: !M.acts, title: `Open this schedule in ${SCHED_EDITOR_NAME}: add it under a WBS node of the open schedule, or open it as a new schedule` }, 'Send to Schedule Editor') : null,
    el('button', { class: schedEditorUrl() ? 'ghost' : 'primary', onclick: schedExport, disabled: !M.acts }, 'Export P6 XER'),
    el('button', { class: 'ghost', onclick: () => { S.crews = {}; audit('schedule', 'crews', 'auto', null, `target ${S.target_wd} wd`); refreshAll(); toast('Crews reset to automatic'); } }, 'Auto crews'),
    el('span', { class: 'hint', text: schedEditorUrl() ? `Send opens it in ${SCHED_EDITOR_NAME}. The XER imports in P6 with File \u203a Import \u203a Primavera PM (XER); then schedule (F9).` : 'Import in P6 with File \u203a Import \u203a Primavera PM (XER), then schedule (F9).' })));

  const numIn = (k, min, max, step, w, label) => el('input', { type: 'number', min, max, step, value: S[k], class: 'cbs-in', style: `width:${w}px`, 'aria-label': label, onchange: (e) => set(k, num(e.target.value)) });
  root.appendChild(el('div', { class: 'sch-settings' },
    el('label', { text: 'Start' }), el('input', { type: 'date', value: S.start, 'aria-label': 'Construction start', onchange: (e) => e.target.value && set('start', e.target.value) }),
    el('label', { text: 'at' }), numIn('start_h', 0, 14, 1, 52, 'Start hour'), el('span', { class: 'hint', text: ':00' }),
    el('span', { class: 'sep' }),
    sel('Work week', [[4, '4 days'], [5, '5 days'], [6, '6 days'], [7, '7 days']], S.days_week, (v) => set('days_week', num(v))),
    el('label', { text: 'Shift' }), numIn('shift_h', 4, 14, 0.5, 56, 'Shift hours'), el('span', { class: 'hint', text: 'h' }),
    el('span', { class: 'sep' }),
    el('label', { text: 'Discipline overlap' }), numIn('overlap_pct', 0, 100, 5, 56, 'Discipline overlap percent'), el('span', { class: 'hint', text: '%' }),
    el('label', { text: 'Area stagger' }), numIn('stagger_wd', 0, 250, 1, 56, 'Area stagger work days'), el('span', { class: 'hint', text: 'wd' }),
    el('label', { text: 'Target package' }), numIn('target_wd', 5, 1000, 5, 64, 'Target package duration'), el('span', { class: 'hint', text: 'wd (auto crews)' })));

  if (!M.acts) {
    root.appendChild(el('div', { class: 'empty-state', style: 'padding:40px;text-align:center' },
      el('div', { style: 'font-size:15px;margin-bottom:6px', text: 'Nothing to schedule yet' }),
      el('div', { class: 'hint', text: 'Add takeoff lines, or price disciplines on Methods; their man-hours become activities here.' })));
    return;
  }

  const startD = M.clock(0), finD = M.clock(M.finish, true);
  const wd = Math.ceil(M.finish / M.hpd);
  const rfsu = D.project.rfsu ? new Date(`${D.project.rfsu}T23:59`) : null;
  const late = rfsu && !isNaN(rfsu) ? Math.round((finD - rfsu) / 864e5) : null;
  const peak = M.heads.reduce((a, v) => Math.max(a, v), 0);
  const peakDay = M.heads.indexOf(peak);
  root.appendChild(el('div', { class: 'kpi-row' },
    kpiCard('Activities', `${int(M.acts)}`, `${int(M.rels)} relationships \u00b7 ${M.pkgs.length} packages \u00b7 ${M.ms.length} milestones`, 'blue', null),
    kpiCard('Construction duration', `${int(wd)} wd`, `${schedDay(startD)} \u2192 ${schedDay(finD)}`, 'text', null),
    kpiCard('Finish vs RFSU', late === null ? '\u2014' : late > 0 ? `${int(late)} d late` : `${int(-late)} d early`, D.project.rfsu ? `RFSU ${D.project.rfsu}` : 'no RFSU date set', late === null ? 'text' : late > 0 ? 'accent' : 'green', null),
    kpiCard('Peak headcount', int(Math.round(peak)), peak ? `week of ${schedDay(M.clock(peakDay * M.hpd))}` : '', 'violet', null),
    kpiCard('Man-hours loaded', MH(M.mhIn), `of ${MH(M.R.totalMh)} estimate MH \u00b7 ${M.ctx.resources.length} resources`, Math.abs(M.mhIn - M.R.totalMh) < 1 ? 'green' : 'amber', null)));

  /* disciplines */
  const rows = D.disciplines.map((d) => {
    const s = M.discStats.get(d.discipline);
    const included = S.include[d.discipline] !== false;
    const u = M.R.usedByDisc.find((x) => x.disc === d);
    const longest = s ? Math.max(...M.pkgs.filter((p) => p.disc === d).map((p) => p.days)) : 0;
    const crewName = d.crew && IDX.crewById.get(d.crew) ? IDX.crewById.get(d.crew).crew.name : '\u2014';
    return el('tr', { class: included ? null : 'muted' },
      el('td', {}, el('label', { style: 'display:flex;gap:6px;align-items:center' }, el('input', { type: 'checkbox', checked: included, 'aria-label': `Schedule ${d.discipline}`, onchange: (e) => { S.include[d.discipline] = e.target.checked; audit('schedule', d.discipline, 'include', !e.target.checked, e.target.checked); refreshAll(); } }), d.discipline)),
      el('td', {}, pill(METHOD_LABEL[d.method], METHOD_COLOUR[d.method] || 'grey')),
      el('td', { class: 'mono num', text: MH(u ? u.usedMh : 0) }),
      el('td', { text: crewName }),
      el('td', { class: 'num mono', text: s ? num(s.avgHeads).toFixed(1) : '' }),
      el('td', { class: 'num' }, s ? el('input', { type: 'number', min: 1, step: 1, class: 'cbs-in', value: s.isAuto ? '' : s.crews, placeholder: s.crewMin === s.crewMax ? `auto ${s.crewMax}` : `auto ${s.crewMin}\u2013${s.crewMax}`, style: 'width:104px', 'aria-label': `${d.discipline} crews in parallel`, onchange: (e) => { const v = num(e.target.value); if (v >= 1) S.crews[d.discipline] = Math.round(v); else delete S.crews[d.discipline]; audit('schedule', d.discipline, 'crews', null, v >= 1 ? v : 'auto'); refreshAll(); } }) : null),
      el('td', { class: 'num mono', text: s ? s.pkgs : '' }),
      el('td', { class: 'num mono', text: s ? int(longest) : '' }),
      el('td', { class: 'num mono', text: s ? int(Math.round(Math.max(...M.pkgs.filter((p) => p.disc === d).map((p) => pkHeadsOf(p) * p.crews)))) : '' }));
  });
  root.appendChild(el('div', { style: 'margin-top:10px' }, card('Disciplines \u2014 crews and durations', [
    el('div', { class: 'tbl-wrap' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, ['Discipline', 'Method', 'MH', 'Default crew', 'Heads / crew', 'Crews in parallel', 'Packages', 'Longest package wd', 'Peak heads (package)'].map((h, i) => el('th', { class: i >= 2 && i !== 3 ? 'num' : null, text: h })))),
      el('tbody', {}, rows))),
    el('div', { class: 'hint', style: 'margin-top:6px', text: 'Work days per activity = MH \u00f7 (heads \u00d7 crews \u00d7 shift hours), rounded up. Leave crews blank for automatic: each package gets enough crews to finish near the target duration. Lines without a crew use a 6-person crew of their craft.' })]).card));

  /* gantt by package + headcount histogram */
  const span = Math.max(1, M.finish);
  const pct = (h) => `${(h / span) * 100}%`;
  const months = [];
  { const d0 = M.clock(0), d1 = M.clock(M.finish, true); const m = new Date(d0.getFullYear(), d0.getMonth() + 1, 1);
    const tot = d1 - d0 || 1; while (m < d1) { months.push({ x: ((m - d0) / tot) * 100, t: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m.getMonth()]} \u2019${String(m.getFullYear()).slice(2)}` }); m.setMonth(m.getMonth() + 1); } }
  const scale = el('div', { class: 'sch-scale' }, months.map((m) => el('span', { style: `left:${m.x}%`, text: m.t })));
  const g = el('div', { class: 'sch-gantt' }, el('div', { class: 'sch-row sch-head' }, el('div', { class: 'sch-lbl', text: 'Package' }), el('div', { class: 'sch-bars' }, scale)));
  M.areas.forEach((area) => {
    const ar = M.ctx.units.find((u) => u.code === area);
    g.appendChild(el('div', { class: 'sch-row sch-area' }, el('div', { class: 'sch-lbl', text: `${area} \u2014 ${ar ? ar.name : ''}` }), el('div', { class: 'sch-bars' })));
    M.all.filter((p) => p.area === area).forEach((p) => {
      const lab = p.milestone ? (p.area === 'PRJ' ? 'Project mechanical completion' : 'Mechanical completion') : `${p.disc.discipline} \u00b7 ${p.rows.length} act \u00b7 ${int(p.days)} wd`;
      const bar = p.milestone
        ? el('i', { class: 'sch-ms', style: `left:${pct(p.ef)}`, title: `${p.rows[0].desc}: ${schedDay(M.clock(p.ef, true))}` })
        : el('i', { class: `sch-bar d${D.disciplines.indexOf(p.disc) % 8}`, style: `left:${pct(p.es)};width:${pct(Math.max(p.ef - p.es, M.hpd))}`, title: `${p.wo} ${p.disc.discipline}: ${schedDay(M.clock(p.es))} \u2192 ${schedDay(M.clock(p.ef, true))}, ${MH(p.mh)} MH, ${p.rows[0].crews} crew(s)` });
      g.appendChild(el('div', { class: 'sch-row' }, el('div', { class: 'sch-lbl', title: p.wo }, el('span', { class: 'mono', text: `${p.wo} ` }), lab), el('div', { class: 'sch-bars' }, bar)));
    });
  });
  /* weekly average headcount */
  const wk = M.dpw, weeks = [];
  for (let i = 0; i < M.heads.length; i += wk) { const s = M.heads.slice(i, i + wk); weeks.push(s.reduce((a, v) => a + v, 0) / s.length); }
  const wmax = Math.max(1, ...weeks);
  const hist = el('div', { class: 'sch-row sch-hist' }, el('div', { class: 'sch-lbl' }, el('b', { text: 'Headcount' }), el('div', { class: 'hint', text: `weekly average, peak ${int(Math.round(peak))}` })),
    el('div', { class: 'sch-bars sch-histbars' }, weeks.map((v, i) => el('i', { style: `left:${(i / weeks.length) * 100}%;width:${100 / weeks.length}%;height:${(v / wmax) * 100}%`, title: `Week of ${schedDay(M.clock(i * wk * M.hpd))}: ${int(Math.round(v))} heads` }))));
  g.appendChild(hist);
  root.appendChild(el('div', { style: 'margin-top:10px' }, card('Schedule preview \u2014 packages by area', [g,
    el('div', { class: 'hint', style: 'margin-top:6px', text: `Next discipline in an area starts after ${S.overlap_pct}% of the previous one (SS) and cannot finish before it (FF); areas start ${S.stagger_wd} wd apart. Calendar: ${M.dpw}-day week, ${M.hpd} h shift from ${String(M.startH).padStart(2, '0')}:00 with a 1 h break.` })]).card));
}
