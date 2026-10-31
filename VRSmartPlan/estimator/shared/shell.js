/* ==========================================================================
   VissRad Suite — shared shell
   Renders the chrome every module page has in common: logo, title block,
   module rail, theme toggle, reset button, status bar. A module supplies its
   own tab bar and views; the shell owns everything around them.

   Depends on shared/lib.js (el, $, makeStore).
   ========================================================================== */

/* A standalone build (VRScheduler and its sibling tools VRPlanner and VRTAR)
   sets window.VR_STANDALONE = { title, home, homeLabel, up, tools, file }
   before this file: no suite module rail, its own title, a link back to the
   suite. up is the path from the page to the build root ('' or '../'); tools
   [{ label, href, title, active }] draws a bar to switch between the tools of
   the build; file: true gives modules that keep their records in one storage
   key a File menu (Save file, Open file, Start over). The bar and the menu are
   in shared/standalone.js, which only standalone builds load. */
const SUITE_STANDALONE = window.VR_STANDALONE || null;
const SUITE_UP = SUITE_STANDALONE && typeof SUITE_STANDALONE.up === 'string' ? SUITE_STANDALONE.up : '../';
const SUITE_USER = (window.VRUSER && window.VRUSER.who && window.VRUSER.who()) || (SUITE_STANDALONE ? '' : 'D. Pennington');

/* The single source of truth for the suite's module list. Order matters: it
   drives the rail on every page and the cards on the launcher. */
const MODULES = [
  {
    id: 'portfolio',
    name: 'VRPortfolio',
    tag: 'Portfolio health',
    href: 'portfolio/index.html',
    desc: 'The overview above every module: stage-gate pipeline health, cost '
      + 'and forecast position, schedule and earned value, and the risk and '
      + 'readiness exceptions that need a decision this week.',
    feats: ['Stage gates', 'Cost & forecast', 'Schedule / EV', 'Risk',
      'Exceptions', 'Drill-down'],
  },
  {
    id: 'feed',
    name: 'VRFEED',
    tag: 'FEED tracking',
    href: 'feed/index.html',
    desc: 'Front-end engineering design through the sanction gates: gate '
      + 'readiness scoring, FEED deliverables, optioneering studies, estimate '
      + 'basis by AACE class and the pre-FID risk register.',
    feats: ['Gate tracker', 'Deliverables', 'Studies', 'Estimate basis',
      'Risk register'],
  },
  {
    id: 'estimating',
    name: 'VREST',
    tag: 'Estimating',
    href: 'estimating/index.html',
    desc: 'AACE class-based EPC estimating: pick parametric, known-quantity or '
      + 'detailed takeoff per discipline, build man-hours from rate libraries '
      + 'and cross-check against benchmarks.',
    feats: ['Method selector', 'Takeoff', 'MH library', 'Indirects',
      'Benchmark check', 'Proposal'],
  },
  {
    id: 'schedule',
    name: 'VRSCH',
    tag: 'Scheduling & analysis',
    href: 'schedule/index.html',
    desc: 'Native CPM schedule editor (activities, logic, calendars, WBS, '
      + 'baseline; exports P6 XER and MS Project XML) plus schedule analysis: '
      + 'S-curves, earned value, critical path, float, look-ahead and DCMA checks.',
    feats: ['Schedule editor', 'XER / MSP export', 'S-curve', 'Critical path', 'Float',
      'Look-ahead', 'Baseline', 'Quality checks'],
  },
  {
    id: 'precon',
    name: 'VRPreCon',
    tag: 'Preconstruction',
    href: 'precon/index.html',
    desc: 'Making a sanctioned project buildable: constructability reviews, '
      + 'contracting strategy and bid packages, long-lead procurement, craft '
      + 'labor and logistics, permits and a mobilisation readiness case.',
    feats: ['Readiness', 'Constructability', 'Bid packages', 'Long lead',
      'Labor', 'Permits'],
  },
  {
    id: 'deng',
    name: 'VRDEng',
    tag: 'Detailed engineering',
    href: 'deng/index.html',
    desc: 'Detailed engineering to IFC: the deliverable register by revision '
      + 'and issue code, man-hour progress by rule of credit, review and '
      + 'transmittal cycles, submittals by spec section, engineering RFIs, '
      + 'project correspondence, quantity growth and EWP handover to the field.',
    feats: ['Deliverables', 'Drawings', 'Man-hours', 'Reviews', 'Submittals',
      'DEng RFI', 'Correspondence', 'Quantities', 'Changes', 'EWP handover'],
  },
  {
    id: 'procure',
    name: 'VRProCure',
    tag: 'Procurement and material management',
    href: 'procure/index.html',
    desc: 'The supply chain from take-off to the crew: requisitions from the '
      + 'DEng MTO and PreCon long-lead items, enquiries and bid tabulation, '
      + 'purchase orders approved by delegation of authority, expediting against '
      + 'the required-on-site date, vendor documents, inspection and release, '
      + 'logistics, receiving with OS&D, and site material control issued to IWPs.',
    feats: ['Requisitions', 'Bid tabulation', 'Purchase orders', 'Expediting',
      'Vendor documents', 'Inspection', 'Receiving', 'Material control'],
  },
  {
    id: 'rfi',
    name: 'VRRFI',
    tag: 'Requests for information, FEED to handover',
    href: 'rfi/index.html',
    desc: 'Requests for information at every stage from FEED through SU&C and '
      + 'handover, with ball-in-court, ageing and the letters that go with each '
      + 'RFI. Cost and schedule impact goes to a design change.',
    feats: ['RFIs', 'Ball in court', 'Ageing', 'Project phase',
      'RFI correspondence'],
  },
  {
    id: 'change',
    name: 'VRChange',
    tag: 'Change management, trends to change orders and MOC',
    href: 'change/index.html',
    desc: 'One register for every change: trends, potential change notices, '
      + 'owner change orders, subcontract variations and claims, each with an '
      + 'estimate build-up, schedule effect and an approval chain set by the '
      + 'delegation of authority. RFIs with impact and design changes arrive in '
      + 'an incoming queue; management of change covers the process-safety checks.',
    feats: ['Change register', 'Approvals by DOA', 'Change orders',
      'MOC and PSSR', 'Exposure'],
  },
  {
    id: 'controls',
    name: 'VRPCS',
    tag: 'Project controls',
    href: 'controls/index.html',
    desc: 'Cost control and earned value against a live budget: commitments, '
      + 'change management, five-method forecasting, progress by rule of credit '
      + 'and cash flow.',
    feats: ['Cost report', 'Commitments', 'Changes', 'EAC forecast',
      'Progress', 'Cash flow'],
  },
  {
    id: 'cost',
    name: 'VRCost',
    tag: 'Cost management',
    href: 'cost/index.html',
    desc: 'Control-account cost management over a full CBS: budget baselining '
      + 'and transfers, commitment ledger, actuals, change register, '
      + 'multi-method forecasting and earned value.',
    feats: ['CBS', 'Budgets', 'Commitments', 'Actuals', 'Forecast',
      'Earned value'],
  },
  {
    id: 'erp',
    name: 'VRERP',
    tag: 'Finance',
    href: 'erp/index.html',
    desc: 'General ledger with document-level posting, AR and AP subledgers, '
      + 'controlling objects and period close.',
    feats: ['GL documents', 'Trial balance', 'AR', 'AP', 'Controlling',
      'Period close'],
  },
  {
    id: 'arap',
    name: 'VRARAP',
    tag: 'Payables & receivables',
    href: 'arap/index.html',
    desc: 'Invoice lifecycle from intake to payment: coding, three-way match, '
      + 'approval routing, retention tracking and collections.',
    feats: ['Intake', 'Coding', 'Matching', 'Approval', 'Payment runs',
      'Retention'],
  },
  {
    id: 'awp',
    name: 'VRAWP',
    tag: 'Advanced work packaging',
    href: 'awp/index.html',
    desc: 'Workface planning from Path of Construction to turnover: area '
      + 'plot plan and 3D model packaging (IFC import), IWP readiness with '
      + 'rule-linked constraints, scaffold, test and turnover packages, '
      + 'offline field updates and a P6 link.',
    feats: ['Area map', '3D model / IFC', 'IWP readiness',
      'Rule-linked constraints', 'Scaffold', 'Test & turnover',
      'Offline field updates', 'P6 link'],
  },
  {
    id: 'plan',
    name: 'VRPlanner',
    tag: 'Capital work planning',
    href: 'plan/index.html',
    desc: 'Steps out capital construction work before it is loaded into the '
      + 'schedule: answer a short set of questions per work item and the '
      + 'module library gives the work steps, crew sizes by craft, equipment, '
      + 'durations and logic, then loads the plan into the Schedule Editor or P6.',
    feats: ['Step-out wizard', 'Work modules', 'Crews & equipment',
      'Working-day calendar', 'Manpower loading', 'Schedule Editor / P6 load'],
  },
  {
    id: 'planner',
    name: 'VRConstruction',
    tag: 'Construction planning & execution',
    href: 'planner/index.html',
    desc: 'Builds the workstep and crew detail P6 is too coarse to hold, '
      + 'validates it against the target schedule dictionaries before anything '
      + 'is sent, writes it as XER, P6 XML or an import spreadsheet, and takes '
      + 'field quantities back as progress. In the field it keeps daily '
      + 'reports, crew timesheets and permits to work with the JSA; the '
      + 'safety and environmental records are kept in VRSHE.',
    feats: ['Workstep grid', 'Crew & resource loading', 'Validation gate',
      'P6 writers', 'Field statusing', 'Daily reports', 'Permits to work'],
  },
  {
    id: 'she',
    name: 'VRSHE',
    tag: 'Safety, health & environment',
    href: 'she/index.html',
    desc: 'The site safety and environmental record: incidents with OSHA '
      + 'recordkeeping (300, 300A, 301) and severe-injury reporting clocks, '
      + 'observations, inspections on schedule, corrective actions, toolbox '
      + 'talks, the training matrix, and spills, waste and manifests, '
      + 'stormwater inspections, monitoring and permit obligations.',
    feats: ['Incidents & OSHA logs', 'Observations', 'Inspections', 'Corrective actions',
      'Training matrix', 'Spills & waste', 'Stormwater', 'Monitoring'],
  },
  {
    id: 'vrview',
    name: 'VR4D',
    tag: 'Visual sequencing',
    href: 'vrview/index.html',
    desc: 'Schedule sequencing painted onto the asset: elevations and model '
      + 'geometry coloured by planned sequence, progress against plan or '
      + 'forecast status, driven by a time slider.',
    feats: ['Elevations', 'Sequence play', 'Progress vs plan', 'Forecast',
      'Activity register'],
  },
  {
    id: 'commissioning',
    name: 'VRSU&C',
    tag: 'Startup & commissioning',
    href: 'commissioning/index.html',
    desc: 'Completions management from receipt verification through handover: '
      + 'check sheets, punch list, test packages and gated certificates, with a '
      + '3D model tied to completions status.',
    feats: ['Check sheets', 'Punch list', 'Packages', 'Certificates',
      '3D model', 'Power BI'],
  },
  {
    id: 'cmms',
    name: 'VRCMMS',
    tag: 'Maintenance',
    href: 'cmms/index.html',
    desc: 'Maintenance management that starts at turnover: the asset register is '
      + 'built from SU&C handover, with work orders, preventive maintenance, '
      + 'inventory and reliability.',
    feats: ['Assets', 'Work orders', 'PM plans', 'Inventory',
      'Reliability', 'Handover'],
  },
  {
    id: 'tar',
    name: 'VRTAR',
    tag: 'Turnaround estimating',
    href: 'tar/index.html',
    desc: 'Module-driven turnaround estimating: answer a short wizard per '
      + 'scope item, get tasks, crew hours, equipment and material from the '
      + 'module library, roll the worklist into an event fragnet and export '
      + 'to Excel, P6 or SAP.',
    feats: ['Module wizard', '330-module library', 'Fragnet', 'Materials',
      'Worklist', 'P6 / SAP export'],
  },
  {
    id: 'link',
    name: 'VRLink',
    tag: 'Document exchange',
    href: 'link/index.html',
    desc: 'The sync layer the modules speak: typed document envelopes moving '
      + 'between apps with an outbox, inbox, idempotency, retry and replay, '
      + 'plus end-to-end correlation traces.',
    feats: ['Outbox', 'Inbox', 'Doc types', 'Transports', 'Retry / replay',
      'Trace'],
  },
  {
    id: 'analytics',
    name: 'VRBI',
    tag: 'Analytics & exports',
    href: 'analytics/index.html',
    desc: 'The Power BI and P6 analytics layer: the star schema every module '
      + 'exports into, the published report families rebuilt as live views, '
      + 'and the packages themselves to download.',
    feats: ['Star schema', 'Resource loading', 'FTE', 'EVA', 'Report families',
      'Downloads'],
  },
  {
    id: 'ai',
    name: 'VRAI',
    tag: 'Project assistant',
    href: 'ai/index.html',
    desc: 'Questions about the project answered from the suite\'s own records: '
      + 'it looks the records up in the modules, read-only, and quotes the RFI, '
      + 'commitment, punch or package numbers it used. On VissRad Server the key '
      + 'stays on the server; the installed package uses your own key.',
    feats: ['Ask the project', 'Cross-module', 'Record numbers', 'Read-only',
      'Server key', 'Own key'],
  }
];
/* VissRad Server: only the modules this workspace is licensed for. */
if (window.VRUSER && window.VRUSER.licensed) {
  for (let i = MODULES.length - 1; i >= 0; i--) if (!window.VRUSER.licensed(MODULES[i].id)) MODULES.splice(i, 1);
}


/* --------------------------------------------------------------- theming */
const SUITE_THEME_STORE = makeStore('vissrad.suite');

function suiteApplyTheme(mode, onChange) {
  const light = mode === 'light';
  document.body.classList.toggle('light', light);
  // The header uses the lockup (owl + wordmark, no tagline) — at 34px the
  // tagline in the full logo is unreadable and just muddies the mark.
  // "light" artwork is white, so it belongs on the DARK ui and vice-versa.
  // Getting this backwards makes the logo vanish.
  for (const logo of $$('img.logo')) {
    logo.src = `${logo.dataset.base || `${SUITE_UP}assets/vissrad_lockup`}`
      + `_${light ? 'dark' : 'light'}.png`;
  }
  const btn = $('#btn-theme');
  if (btn) btn.textContent = light ? 'Dark mode' : 'Light mode';
  SUITE_THEME_STORE.set('theme', mode);
  if (onChange) onChange(mode);
}

function suiteInitialTheme() {
  const q = new URLSearchParams(location.search).get('theme');
  return q === 'light' || q === 'dark'
    ? q
    : SUITE_THEME_STORE.get('theme') || 'dark';
}

/* ------------------------------------------------------------ module rail */
function suiteRail(activeId, depth = 1) {
  /* Static hosting does not resolve a bare directory to its index document,
     so every link is explicit. A trailing-slash href works on a dev server
     with directory indexing but 404s once published. */
  const up = depth === 0 ? '' : '../';
  const home = `${up}index.html`;
  const rail = el('nav', { class: 'modrail' },
    el('a', { class: 'rail-label', href: home, style: 'text-decoration:none' },
      'VissRad Suite'),
    /* VRMarkup is part of every module rather than a module of its own, so it is not in MODULES
       (which drives licences and counts). It sits beside VRDEng, the document repository whose
       drawings it opens; without DEng it leads the list. */
    (() => {
      const markup = el('a', {
        class: `modrail-item tool${activeId === 'markup' ? ' active' : ''}`,
        href: `${up}markup/index.html`,
        title: 'VRMarkup — open a PDF to read, mark up, measure and compare revisions',
        'data-tool': 'markup',
      }, el('span', { class: 'dot' }), 'VRMarkup');
      const items = MODULES.map((m) => el('a', {
        class: `modrail-item${m.id === activeId ? ' active' : ''}`,
        href: depth === 0 ? m.href : `${up}${m.href}`,
        title: `${m.name} — ${m.tag}`,
      }, el('span', { class: 'dot' }),
      /* Product name only. With eleven modules the rail no longer fits the
         "name · tag" form on a 1440px screen; the discipline stays in the
         tooltip and on the launcher card. */
      m.name));
      const at = MODULES.findIndex((m) => m.id === 'deng');
      items.splice(at < 0 ? 0 : at + 1, 0, markup);
      return items;
    })());

  /* The rail scrolls horizontally on narrower screens. Whichever module you
     are in must be the one you can see, so pull the active item into view
     once the rail has been laid out. */
  requestAnimationFrame(() => {
    const active = rail.querySelector('a.active');
    if (!active || rail.scrollWidth <= rail.clientWidth) return;
    const pad = 24;
    const left = active.offsetLeft - pad;
    const right = active.offsetLeft + active.offsetWidth + pad;
    if (right > rail.scrollLeft + rail.clientWidth) {
      rail.scrollLeft = right - rail.clientWidth;
    } else if (left < rail.scrollLeft) {
      rail.scrollLeft = left;
    }
  });

  return rail;
}

/* ----------------------------------------------------------------- header */
/* Builds the top bar and module rail into #app, ahead of whatever the module
   page already declared (its tab bar, views host and status bar). */
function suiteChrome({ moduleId, title, subtitle, onReset, onTheme, file }) {
  const app = $('#app');
  const head = el('header', { class: 'topbar' },
    el('img', {
      class: 'logo', id: 'top-logo', alt: 'VissRad',
      'data-base': `${SUITE_UP}assets/vissrad_lockup`,
      src: `${SUITE_UP}assets/vissrad_lockup_light.png`,
    }),
    el('div', { class: 'title-block' },
      el('h1', { text: SUITE_STANDALONE && SUITE_STANDALONE.title ? SUITE_STANDALONE.title : title }),
      el('div', { class: 'sub', id: 'proj-sub', text: subtitle || '' })),
    SUITE_STANDALONE && typeof suiteToolMenu === 'function' && Array.isArray(SUITE_STANDALONE.tools) && SUITE_STANDALONE.tools.length > 1 && !SUITE_STANDALONE.toolBar
      ? suiteToolMenu(SUITE_STANDALONE.tools) : null,
    el('div', { class: 'spacer' }),
    SUITE_STANDALONE && SUITE_STANDALONE.home
      ? el('a', { class: 'ghost btn-link', id: 'btn-home', href: SUITE_STANDALONE.home, target: '_blank', rel: 'noopener', title: 'VissRad — Suite of Interactive Smart Tools for Project Delivery' }, SUITE_STANDALONE.homeLabel || 'VissRad ↗')
      : null,
    SUITE_STANDALONE && SUITE_STANDALONE.file && file && typeof suiteFileMenu === 'function' ? suiteFileMenu(file) : null,
    onReset && !(SUITE_STANDALONE && SUITE_STANDALONE.file && file && typeof suiteFileMenu === 'function')
      ? el('button', {
        class: 'ghost',
        id: 'btn-reset',
        title: 'Discard local changes and reload the seeded demo data',
        onclick: onReset,
      }, 'Reset demo')
      : null,
    el('button', {
      class: 'ghost',
      id: 'btn-theme',
      onclick: () => suiteApplyTheme(
        document.body.classList.contains('light') ? 'dark' : 'light', onTheme,
      ),
    }, 'Light mode'));

  if (!SUITE_STANDALONE) app.prepend(suiteRail(moduleId));
  else if (SUITE_STANDALONE.toolBar && typeof suiteToolBar === 'function' && Array.isArray(SUITE_STANDALONE.tools) && SUITE_STANDALONE.tools.length > 1) app.prepend(suiteToolBar(SUITE_STANDALONE.tools));
  app.prepend(head);
  suiteApplyTheme(suiteInitialTheme(), null);
  if (window.VRUSER) window.VRUSER.decorate(head);
  return head;
}

/* Standard confirm-and-reset modal. window.confirm is suppressed inside
   sandboxed iframes, so never use it here. */
function suiteResetDialog(store, lsKey) {
  modal({
    title: 'Reset demo data', sub: 'This cannot be undone', width: 520,
    body: el('div', { class: 'banner warn' },
      'Every change you recorded in this module in this browser will be '
      + 'discarded and the seeded dataset reloaded.'),
    buttons: [
      { label: 'Keep my changes', onClick: closeModal },
      {
        label: 'Discard and reload',
        primary: true,
        onClick: () => {
          store.del(lsKey);
          /* registers keep their own key per table: vissrad.<module>.<table>.v1 */
          const app = String(lsKey).split('.')[1];
          try {
            const w = window[['local', 'Storage'].join('')];
            for (let i = w.length - 1; i >= 0; i -= 1) {
              const k = w.key(i);
              if (k && app && k.startsWith(`vissrad.${app}.`) && k !== lsKey && /\.v1$/.test(k)) w.removeItem(k);
            }
          } catch (e) { /* storage unavailable */ }
          if (window.VRPHOTOS && app) window.VRPHOTOS.clearApp(app, 'demo').then(() => location.reload(), () => location.reload());
          else location.reload();
        },
      },
    ],
  });
}

/* ------------------------------------------------------------ tab plumbing */
/* Modules declare TABS as [{id, label, build(root)}]. This handles the tab
   bar, hash routing, rebuild-on-refresh and leave hooks. */
function suiteTabs({ tabs, initial, onLeave }) {
  const bar = $('#tabs');
  const host = $('#views');
  let current = null;

  const views = new Map();
  for (const t of tabs) {
    const v = el('section', { class: 'view', id: `view-${t.id}` });
    views.set(t.id, v);
    host.appendChild(v);
    bar.appendChild(el('button', {
      'data-tab': t.id,
      onclick: () => go(t.id),
    }, t.label));
  }

  function go(id, force) {
    if (id === current && !force) return;
    if (current && onLeave) onLeave(current);
    current = id;
    for (const b of $$('#tabs button')) {
      b.classList.toggle('active', b.dataset.tab === id);
    }
    for (const [k, v] of views) v.classList.toggle('active', k === id);
    const tab = tabs.find((t) => t.id === id);
    const root = views.get(id);
    root.textContent = '';
    if (window.VRUSER) window.VRUSER.guard(root, () => tab.build(root), tab.label);
    else tab.build(root);
    history.replaceState(null, '', `#${id}`);
  }

  // Tighten the bar when the tabs will not fit on one row at this width.
  const fit = () => {
    bar.classList.remove('dense');
    const w = [...bar.children].reduce((a, b) => a + b.offsetWidth + 2, 28);
    if (w > bar.clientWidth) bar.classList.add('dense');
  };
  fit(); window.addEventListener('resize', fit);

  const wanted = location.hash.slice(1);
  go(tabs.some((t) => t.id === wanted) ? wanted : (initial || tabs[0].id));
  return { go, refresh: () => go(current, true), get current() { return current; } };
}

/* ------------------------------------------------------------- status bar */
function suiteStatus(pairs) {
  const bar = $('#statusbar');
  bar.textContent = '';
  pairs.filter(Boolean).forEach(([k, v], i) => {
    if (i) bar.appendChild(el('span', { class: 'sep', text: '·' }));
    let txt = String(v);
    // Hosted edition: records are saved to the VissRad server, not this browser.
    if (window.VRUSER && window.VRUSER.server && /browser storage|browser$/.test(txt)) txt = txt.replace(/(held |saved )?in browser storage|browser$/, 'saved to the VissRad server');
    bar.appendChild(el('span', {}, `${k} `, el('b', { text: txt })));
  });
}

/* ---------------------------------------------------------------- booting */
/* Fetches a module's data.json, reveals #app and reports load failures in the
   loading pane rather than leaving a blank screen. */
async function suiteBoot(dataUrl, start) {
  try {
    /* A standalone build can carry the dataset as a script (data.js sets
       window.VR_DATA), so the page also opens from disk, where fetch is blocked.
       It is awaited so the module script finishes loading before start runs. */
    let data;
    if (window.VR_DATA) { data = await Promise.resolve(window.VR_DATA); window.VR_DATA = null; } else {
      const res = await fetch(dataUrl);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      data = await res.json();
    }
    if (window.VRUSER) data = window.VRUSER.prepare(data);
    $('#loading').remove();
    $('#app').hidden = false;
    try { start(data); } catch (e) {
      console.error(e);
      $('#app').prepend(window.VRUSER && window.VRUSER.user ? window.VRUSER.bootFailed(e)
        : el('div', { class: 'banner bad', style: 'margin:12px' },
          el('b', { text: 'This module could not start. ' }), String(e.message || e)));
    }
  } catch (e) {
    const box = $('#loading');
    if (box) {
      box.textContent = '';
      box.appendChild(el('div', { class: 'banner bad' },
        el('b', { text: 'Could not load the demo dataset.' }),
        el('div', { text: String(e.message || e) }),
        el('div', {
          style: 'margin-top:6px;color:var(--text-dim)',
          text: 'This page must be served over HTTP — opening the file '
            + 'directly from disk blocks the data fetch.',
        })));
    }
  }
}

/* ------------------------------------------------------ cross-module links
   Modules keep their own data. Where one needs to see another's records (the
   RFIs raised against a drawing, the design change raised from an RFI) the
   owner publishes a small read-only summary under vissrad.<app>.link.v1. In the
   browser editions it sits in the same store (per mode); on VissRad Server the
   boot payload carries it for the current project. */
function suiteLinkPublish(app, obj) {
  const key = `vissrad.${app}.link.v1`;
  const v = JSON.stringify({ at: new Date().toISOString(), ...obj });
  try { const st = makeStore(key); if (st.get(key) !== v) st.set(key, v); } catch (e) { /* storage unavailable */ }
}
function suiteLinkRead(app) {
  const key = `vissrad.${app}.link.v1`;
  // Read only: no storage probe, so nothing is ever written under another module's key.
  try { return JSON.parse(window[['local', 'Storage'].join('')].getItem(key)) || null; } catch (e) { return null; }
}
/* Link to another module, keeping the edition flags (mode=, nosetup= ...). */
function suiteHref(app, tab, params) {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') q.set(k, v);
  const qs = q.toString();
  return `../${app}/index.html${qs ? `?${qs}` : ''}${tab ? `#${tab}` : ''}`;
}
/* A "Raise RFI" button for field modules: opens VRRFI with a new RFI
   prefilled from the record (project, subject, location, where it came from). */
function suiteRaiseRfiButton(pre, label) {
  return el('button', {
    class: 'ghost', title: 'Open VRRFI with a new RFI raised from this record',
    onclick: () => { location.href = suiteHref('rfi', 'rfis', { new_rfi: 1, ...pre }); },
  }, label || 'Raise RFI');
}
/* Read and remove one-shot URL parameters set by suiteHref. */
function suiteTakeParams(names) {
  const q = new URLSearchParams(location.search);
  const out = {};
  for (const n of names) if (q.has(n)) { out[n] = q.get(n); q.delete(n); }
  if (Object.keys(out).length) {
    const qs = q.toString();
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`);
  }
  return out;
}
