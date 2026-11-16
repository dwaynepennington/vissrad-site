/* ==========================================================================
   VREstimator — Crew mixes (InEight-style crews).

   A crew is a mix of crafts (heads) and equipment (units at $/hr). It gives:
     blended labor $/MH  = sum(heads x craft all-in rate) / sum(heads)
     equipment $/MH      = sum(units x equipment $/hr) / sum(heads)
     crew $/hr           = labor $/hr + equipment $/hr
   A takeoff line with a crew is priced at the crew's blended rate and carries
   the crew's equipment in its equipment cost. Assemblies rows can name a crew,
   so Takeoff Board lines pick it up. A discipline's default crew sets the
   blended rate used to turn Parametric / Known Quantity labor $ into MH, and
   how those MH spread over crafts on Resources. Crew-hours and crew-days
   follow from MH / heads / shift hours, for duration checks against the
   schedule.
   ========================================================================== */
'use strict';

function crewSeed() {
  const L = (craft, qty) => ({ craft, qty });
  const E = (desc, rate_hr, qty) => ({ desc, rate_hr, qty });
  return [
    { id: 'CR-CIV-01', name: 'Foundation concrete crew', discipline: 'Civil', shift_hours: 10, labor: [L('General Foreman', 0.25), L('Carpenter', 4), L('Laborer', 3), L('Operator', 1)], equipment: [E('Concrete pump, 36 m boom', 210, 0.5), E('Backhoe loader', 95, 1)] },
    { id: 'CR-CIV-02', name: 'Earthwork crew', discipline: 'Civil', shift_hours: 10, labor: [L('Operator', 2), L('Laborer', 2)], equipment: [E('Excavator, 30 t', 145, 1), E('Plate compactor', 15, 1), E('Dump truck', 85, 1)] },
    { id: 'CR-STR-01', name: 'Steel erection crew', discipline: 'Structural', shift_hours: 10, labor: [L('General Foreman', 0.25), L('Ironworker', 4), L('Millwright/Rigger', 1), L('Operator', 1)], equipment: [E('Crawler crane, 90 t', 265, 1), E('Boom lift, 60 ft', 28, 2)] },
    { id: 'CR-MEC-01', name: 'Equipment setting crew', discipline: 'Mechanical', shift_hours: 10, labor: [L('General Foreman', 0.25), L('Millwright/Rigger', 3), L('Pipefitter', 1), L('Operator', 1)], equipment: [E('Hydraulic crane, 50 t', 185, 1), E('Forklift, 10k lb', 45, 1)] },
    { id: 'CR-PIP-01', name: 'Pipe erection crew', discipline: 'Piping', shift_hours: 10, labor: [L('General Foreman', 0.25), L('Pipefitter', 4), L('Welder', 2), L('Laborer', 1)], equipment: [E('Welding machine', 18, 2), E('Picker truck, 15 t', 95, 1), E('Boom lift, 60 ft', 28, 1)] },
    { id: 'CR-PIP-02', name: 'Weld-out crew', discipline: 'Piping', shift_hours: 10, labor: [L('Welder', 2), L('Pipefitter', 1)], equipment: [E('Welding machine', 18, 2)] },
    { id: 'CR-ELE-01', name: 'Electrical crew', discipline: 'Electrical', shift_hours: 10, labor: [L('General Foreman', 0.25), L('Electrician', 4), L('Laborer', 1)], equipment: [E('Boom lift, 40 ft', 24, 1), E('Cable puller', 40, 0.5)] },
    { id: 'CR-INS-01', name: 'Instrument crew', discipline: 'Instrumentation', shift_hours: 10, labor: [L('Instrument Tech', 3), L('Electrician', 1)], equipment: [E('Calibration kit', 12, 1), E('Tube bender set', 6, 1)] },
    { id: 'CR-INU-01', name: 'Insulation crew', discipline: 'Insulation', shift_hours: 10, labor: [L('Insulator', 4), L('Laborer', 1)], equipment: [E('Boom lift, 40 ft', 24, 1)] },
    { id: 'CR-PAI-01', name: 'Paint crew', discipline: 'Painting', shift_hours: 10, labor: [L('Painter', 3), L('Laborer', 1)], equipment: [E('Air compressor, 185 cfm', 35, 1), E('Blast pot', 22, 1)] },
  ];
}
const CREW_DISC_DEFAULT = { Civil: 'CR-CIV-01', Structural: 'CR-STR-01', Mechanical: 'CR-MEC-01', Piping: 'CR-PIP-01', Electrical: 'CR-ELE-01', Instrumentation: 'CR-INS-01', Insulation: 'CR-INU-01', Painting: 'CR-PAI-01' };

/* Called on boot before the board. Crews are reference data: seeded once,
   then held with the estimate. First seeding also sets each discipline's
   default crew and gives assembly rows the crew of their discipline. */
function crewEnsure(d) {
  if (Array.isArray(d.crews)) return;
  d.crews = crewSeed();
  d.disciplines.forEach((x) => { if (x.crew === undefined) x.crew = CREW_DISC_DEFAULT[x.discipline] || ''; });
  const lib = new Map(d.mh_library.map((m) => [m.key, m]));
  (d.assemblies || []).forEach((a) => a.rows.forEach((r) => { if (r.crew === undefined) { const m = lib.get(r.master_key); r.crew = m ? CREW_DISC_DEFAULT[m.discipline] || '' : ''; } }));
}

/** Rates for one crew from the current craft rates. */
function crewRate(c) {
  const craftBy = IDX && IDX.craftByName ? IDX.craftByName : new Map(D.crafts.map((x) => [x.craft, x]));
  let heads = 0, laborHr = 0, equipHr = 0;
  const mix = [];
  (c.labor || []).forEach((m) => { const q = num(m.qty); const r = craftBy.get(m.craft); heads += q; laborHr += q * num(r ? r.all_in_rate : 0); mix.push({ craft: m.craft, qty: q }); });
  (c.equipment || []).forEach((e) => { equipHr += num(e.qty) * num(e.rate_hr); });
  mix.forEach((m) => { m.share = heads ? m.qty / heads : 0; });
  return { crew: c, heads, laborHr, equipHr, perMh: heads ? laborHr / heads : 0, equipPerMh: heads ? equipHr / heads : 0, crewHr: laborHr + equipHr, shift: num(c.shift_hours, 10) || 10, mix };
}
function crewIndex() { return new Map((D.crews || []).map((c) => [c.id, crewRate(c)])); }
/** Crew to use for a new line of a discipline (assembly row first, then the discipline default). */
function crewForDisc(disc) { const d = D.disciplines.find((x) => x.discipline === disc); return d && d.crew ? d.crew : ''; }

/** MH and $ assigned to each crew: detailed lines with a crew, plus
    Parametric / Known Quantity disciplines through their default crew. */
function crewUsage() {
  const R = rollup();
  const use = new Map((D.crews || []).map((c) => [c.id, { lines: 0, mh: 0, labor: 0, equip: 0, discs: new Set() }]));
  D.takeoff_lines.forEach((l) => {
    const d = D.disciplines.find((x) => x.discipline === l.discipline);
    if (!d || d.method !== 'detailed_takeoff' || !l.crew || !use.has(l.crew)) return;
    const c = computeLine(l); const u = use.get(l.crew);
    u.lines += 1; u.mh += c.totalMh; u.labor += c.laborCost; u.equip += c.crewEquip; u.discs.add(l.discipline);
  });
  R.usedByDisc.filter((x) => x.disc.method !== 'detailed_takeoff' && x.disc.crew && use.has(x.disc.crew)).forEach((x) => {
    const u = use.get(x.disc.crew); u.mh += x.usedMh; u.labor += x.usedLabor; u.discs.add(`${x.disc.discipline} (${METHOD_LABEL[x.disc.method]})`);
  });
  return use;
}

/* ==========================================================================
   VIEW — Crews
   ========================================================================== */
function viewCrews(root) {
  const use = crewUsage();
  const dd = (v, d) => num(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const crewOpts = [['', '\u2014 None (craft rates) \u2014'], ...D.crews.map((c) => [c.id, `${c.id} \u2014 ${c.name}`])];
  const tot = [...use.values()].reduce((a, u) => ({ mh: a.mh + u.mh, lines: a.lines + u.lines, equip: a.equip + u.equip }), { mh: 0, lines: 0, equip: 0 });
  const detailed = D.takeoff_lines.filter((l) => { const d = D.disciplines.find((x) => x.discipline === l.discipline); return d && d.method === 'detailed_takeoff'; });
  const noCrew = detailed.filter((l) => !l.crew);

  root.appendChild(el('div', { class: 'kpi-row' },
    kpiCard('Crews', String(D.crews.length), `${D.disciplines.filter((d) => d.crew).length} disciplines with a default crew`, 'text', null),
    kpiCard('Crewed man-hours', MH(tot.mh), `${tot.lines} detailed lines + method disciplines`, 'blue', null),
    kpiCard('Crew equipment', `USD ${M(tot.equip)}`, 'on detailed lines, at $/MH', 'violet', null),
    kpiCard('Detailed lines without a crew', String(noCrew.length), noCrew.length ? 'priced at their craft rate, no crew equipment' : 'every detailed line is crewed', noCrew.length ? 'amber' : 'green', null)));

  /* discipline defaults */
  const defRows = D.disciplines.map((d) => {
    const lines = detailed.filter((l) => l.discipline === d.discipline);
    const missing = lines.filter((l) => !l.crew);
    const cr = d.crew ? IDX.crewById.get(d.crew) : null;
    return el('tr', {},
      el('td', { text: d.discipline }), el('td', {}, pill(METHOD_LABEL[d.method], d.method === 'detailed_takeoff' ? 'green' : d.method === 'known_qty' ? 'violet' : 'blue')),
      el('td', {}, sel('', crewOpts, d.crew || '', (v) => { const o = d.crew; d.crew = v; audit('discipline', d.discipline, 'set_default_crew', o || null, v || null); refreshAll(); }, 280)),
      el('td', { class: 'num mono', text: cr ? dd(cr.perMh, 2) : dd(blendedRateForDisc(d.discipline), 2) }),
      el('td', { class: 'num mono', text: `${lines.length - missing.length} / ${lines.length}` }),
      el('td', {}, missing.length && d.crew ? el('button', { class: 'ghost', onclick: () => { missing.forEach((l) => { l.crew = d.crew; }); audit('discipline', d.discipline, 'apply_crew', null, `${d.crew} to ${missing.length} line(s)`); refreshAll(); toast(`${d.crew} applied to ${missing.length} ${d.discipline} line(s)`); } }, `Apply to ${missing.length} uncrewed`) : null));
  });
  root.appendChild(el('div', { style: 'margin-top:10px' }, card('Default crew by discipline', [
    el('div', { class: 'hint', style: 'margin-bottom:6px', text: 'The default crew sets the blended rate that converts Parametric and Known Quantity labor dollars to man-hours, and the crew new board and imported lines take when their assembly row names none.' }),
    el('div', { class: 'tbl-wrap' }, el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, ['Discipline', 'Method', 'Default crew', 'Blended $/MH', 'Detailed lines crewed', ''].map((h, i) => el('th', { class: i === 3 || i === 4 ? 'num' : null, text: h })))),
      el('tbody', {}, defRows)))]).card));

  root.appendChild(toolbar(el('button', { class: 'primary', onclick: newCrew }, '+ New crew'), el('span', { class: 'hint', text: 'Labor rates come from Resources (craft all-in rates); edit a craft rate and every crew using it reprices.' })));
  const host = el('div', { class: 'crew-grid' });
  root.appendChild(host);
  D.crews.forEach((c) => host.appendChild(crewCard(c)));

  function save(c, what) { audit('crew', c.id, 'edit', null, what); refreshAll(); }
  function usedBy(c) { return D.takeoff_lines.filter((l) => l.crew === c.id).length + D.disciplines.filter((d) => d.crew === c.id).length + D.assemblies.reduce((a, x) => a + x.rows.filter((r) => r.crew === c.id).length, 0); }
  function crewCard(c) {
    const r = IDX.crewById.get(c.id) || crewRate(c);
    const u = use.get(c.id) || { mh: 0, lines: 0, labor: 0, equip: 0, discs: new Set() };
    const crewHrs = r.heads ? u.mh / r.heads : 0;
    const crewDays = crewHrs / r.shift;
    const labRows = (c.labor || []).map((m, i) => {
      const cr = IDX.craftByName.get(m.craft);
      return el('tr', {},
        el('td', {}, sel('', D.crafts.map((x) => [x.craft, x.craft]), m.craft, (v) => { m.craft = v; save(c, `labor row ${i + 1} craft ${v}`); }, 170)),
        el('td', { class: 'num' }, el('input', { type: 'number', min: 0, step: '0.25', class: 'cbs-in', value: m.qty, 'aria-label': `${m.craft} heads`, onchange: (e) => { m.qty = num(e.target.value); save(c, `${m.craft} heads ${m.qty}`); } })),
        el('td', { class: 'num mono', text: dd(cr ? cr.all_in_rate : 0, 2) }),
        el('td', { class: 'num mono', text: dd(num(m.qty) * num(cr ? cr.all_in_rate : 0), 2) }),
        el('td', { class: 'num mono', text: r.heads ? `${Math.round((num(m.qty) / r.heads) * 100)}%` : '\u2014' }),
        el('td', {}, el('button', { class: 'ghost x', title: 'Remove', 'aria-label': 'Remove labor row', onclick: () => { c.labor.splice(i, 1); save(c, `labor row ${i + 1} removed`); } }, '\u00d7')));
    });
    const eqRows = (c.equipment || []).map((e, i) => el('tr', {},
      el('td', {}, el('input', { type: 'text', value: e.desc, style: 'width:170px', 'aria-label': 'Equipment', onchange: (ev) => { e.desc = ev.target.value; save(c, `equipment row ${i + 1} ${e.desc}`); } })),
      el('td', { class: 'num' }, el('input', { type: 'number', min: 0, step: '0.25', class: 'cbs-in', value: e.qty, 'aria-label': `${e.desc} units`, onchange: (ev) => { e.qty = num(ev.target.value); save(c, `${e.desc} units ${e.qty}`); } })),
      el('td', { class: 'num' }, el('input', { type: 'number', min: 0, step: '0.5', class: 'cbs-in', value: e.rate_hr, 'aria-label': `${e.desc} $/hr`, onchange: (ev) => { e.rate_hr = num(ev.target.value); save(c, `${e.desc} $/hr ${e.rate_hr}`); } })),
      el('td', { class: 'num mono', text: dd(num(e.qty) * num(e.rate_hr), 2) }), el('td'),
      el('td', {}, el('button', { class: 'ghost x', title: 'Remove', 'aria-label': 'Remove equipment row', onclick: () => { c.equipment.splice(i, 1); save(c, `equipment row ${i + 1} removed`); } }, '\u00d7'))));
    const n = usedBy(c);
    return card(null, [
      el('div', { class: 'asm-head' },
        el('input', { type: 'text', class: 'asm-name', value: c.name, 'aria-label': 'Crew name', onchange: (e) => { c.name = e.target.value.trim() || c.name; save(c, `name ${c.name}`); } }),
        el('span', { class: 'hint mono', text: c.id }),
        sel('', D.disciplines.map((d) => [d.discipline, d.discipline]), c.discipline, (v) => { c.discipline = v; save(c, `discipline ${v}`); }, 140),
        el('label', { class: 'hint', text: 'Shift h/day' }),
        el('input', { type: 'number', min: 1, max: 24, step: '0.5', class: 'cbs-in', style: 'width:56px', value: c.shift_hours, 'aria-label': 'Shift hours', onchange: (e) => { c.shift_hours = num(e.target.value, 10) || 10; save(c, `shift ${c.shift_hours} h`); } }),
        el('span', { style: 'flex:1' }),
        el('button', { class: 'ghost', onclick: () => { const x = JSON.parse(JSON.stringify(c)); x.id = nextCrewId(c.discipline); x.name = `${c.name} (copy)`; D.crews.push(x); audit('crew', x.id, 'create', null, `copy of ${c.id}`); refreshAll(); } }, 'Duplicate'),
        el('button', { class: 'ghost danger', disabled: n > 0 || null, title: n ? `Used by ${n} line(s), discipline default(s) or assembly row(s)` : 'Delete crew', onclick: () => { D.crews.splice(D.crews.indexOf(c), 1); audit('crew', c.id, 'delete', c.name, null); refreshAll(); } }, 'Delete')),
      el('div', { class: 'crew-body' },
        el('div', { class: 'tbl-wrap' }, el('table', { class: 'data crew-tbl' },
          el('thead', {}, el('tr', {}, ['Labor', 'Heads', '$/hr', 'Crew $/hr', 'Mix', ''].map((h, i) => el('th', { class: i && i < 5 ? 'num' : null, text: h })))),
          el('tbody', {}, labRows,
            el('tr', { class: 'crew-sub' }, el('td', { text: 'Labor' }), el('td', { class: 'num mono', text: dd(r.heads, 2) }), el('td'), el('td', { class: 'num mono', text: dd(r.laborHr, 2) }), el('td'), el('td')),
            el('tr', { class: 'crew-sep' }, ['Equipment', 'Units', '$/hr', 'Crew $/hr', '', ''].map((h, i) => el('td', { class: i && i < 4 ? 'num' : null, text: h }))),
            eqRows,
            el('tr', { class: 'crew-sub' }, el('td', { text: 'Equipment' }), el('td'), el('td'), el('td', { class: 'num mono', text: dd(r.equipHr, 2) }), el('td'), el('td')))),
          el('div', { class: 'asm-foot' },
            el('button', { class: 'ghost', onclick: () => { c.labor.push({ craft: D.crafts[0].craft, qty: 1 }); save(c, 'labor row added'); } }, '+ Craft'),
            el('button', { class: 'ghost', onclick: () => { c.equipment.push({ desc: 'New equipment', rate_hr: 0, qty: 1 }); save(c, 'equipment row added'); } }, '+ Equipment'))),
        el('div', { class: 'crew-stats' },
          stat('Blended labor', `$${dd(r.perMh, 2)}/MH`), stat('Equipment', `$${dd(r.equipPerMh, 2)}/MH`),
          stat('All-in', `$${dd(r.perMh + r.equipPerMh, 2)}/MH`), stat('Crew cost', `$${dd(r.crewHr, 0)}/hr`),
          el('div', { class: 'crew-div' }),
          stat('Assigned', `${MH(u.mh)} MH`), stat('Detailed lines', String(u.lines)),
          stat('Crew-hours', dd(crewHrs, 0)), stat('Crew-days', `${dd(crewDays, 1)} @ ${r.shift} h`),
          u.discs.size ? el('div', { class: 'hint', style: 'grid-column:1/-1', text: `Used on ${[...u.discs].join(', ')}` }) : el('div', { class: 'hint', style: 'grid-column:1/-1', text: n ? 'Assigned, no priced man-hours yet' : 'Not used yet' }))),
    ], { class: 'crew-card' }).card;
  }
  function stat(k, v) { return el('div', { class: 'crew-stat' }, el('span', { text: k }), el('b', { class: 'mono', text: v })); }
  function nextCrewId(disc) {
    const p = `CR-${String(disc || 'GEN').slice(0, 3).toUpperCase()}-`;
    let n = 1, id; do { id = `${p}${String(n).padStart(2, '0')}`; n++; } while (D.crews.some((c) => c.id === id)); return id;
  }
  function newCrew() {
    const name = el('input', { type: 'text', placeholder: 'e.g. Hydrotest crew' });
    const disc = el('select', {}, D.disciplines.map((d) => el('option', { value: d.discipline }, d.discipline)));
    modal({ title: 'New crew', sub: 'Starts with the discipline\u2019s typical crafts; add equipment after it is created', width: 460,
      body: el('div', { class: 'form-grid' }, el('label', { text: 'Name' }), name, el('label', { text: 'Discipline' }), disc),
      buttons: [{ label: 'Cancel', onClick: closeModal }, { label: 'Create', primary: true, onClick: () => {
        const id = nextCrewId(disc.value);
        D.crews.push({ id, name: name.value.trim() || 'New crew', discipline: disc.value, shift_hours: 10, labor: (DISC_CRAFTS_FALLBACK[disc.value] || [D.crafts[0].craft]).map((c, i) => ({ craft: c, qty: i ? 1 : 2 })), equipment: [] });
        audit('crew', id, 'create', null, name.value); closeModal(); refreshAll();
      } }] });
  }
}
