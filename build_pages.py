#!/usr/bin/env python3
"""Generate the inner pages of vissrad.com from shared chrome + per-page bodies."""
from pathlib import Path

ROOT = Path(__file__).parent

NAV = [("platform.html", "Platform"), ("modules.html", "Modules"),
       ("demo.html", "Demo"), ("company.html", "Company")]


def head(title, desc, canon):
    return f"""<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="https://vissrad.com/{canon}">
<meta property="og:image" content="https://vissrad.com/assets/img/hero-plant.webp">
<link rel="canonical" href="https://vissrad.com/{canon}">
<link rel="preconnect" href="https://api.fontshare.com" crossorigin>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@700,800&f[]=satoshi@400,500,700&display=swap" rel="stylesheet">
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/base.css">
<link rel="stylesheet" href="assets/css/style.css">
</head>
<body>

<a class="sr-only" href="#main">Skip to content</a>
"""


def header(active):
    links = "\n".join(
        '      <a href="{}"{}>{}</a>'.format(
            h, ' aria-current="page"' if h == active else "", label)
        for h, label in NAV)
    drawer = "\n".join(
        '  <a href="{}"{}>{}</a>'.format(
            h, ' aria-current="page"' if h == active else "", label)
        for h, label in NAV)
    return f"""
<header class="header">
  <div class="header__inner">
    <a class="logo" href="index.html" aria-label="VissRad home">
      <img class="logo__mark" src="assets/brand/mark-red.svg" alt="" width="34" height="11">
      <span class="logo__type">VissRad</span>
    </a>
    <nav class="nav" aria-label="Main">
{links}
    </nav>
    <div class="header__actions">
      <button class="icon-btn" type="button" data-theme-toggle aria-label="Switch color theme"></button>
      <a class="btn btn--primary btn--sm" href="contact.html">Request a demo</a>
      <button class="icon-btn burger" type="button" data-burger aria-expanded="false" aria-label="Open menu">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M3.5 7h17M3.5 12h17M3.5 17h17"/></svg>
      </button>
    </div>
  </div>
</header>
<div class="drawer" data-drawer data-open="false">
{drawer}
  <a class="btn btn--primary" href="contact.html">Request a demo</a>
</div>

<main id="main">
"""


FOOTER = """
</main>

<footer class="footer">
  <div class="wrap">
    <div class="footer__grid">
      <div>
        <a class="logo" href="index.html" aria-label="VissRad home">
          <img class="logo__mark" src="assets/brand/mark-red.svg" alt="" width="34" height="11">
          <span class="logo__type">VissRad</span>
        </a>
        <p class="footer__tag">Wisdom in decision making</p>
        <p class="small" style="margin-top:var(--space-5);max-width:34ch">Integrated project controls, completions and finance applications for industrial capital projects.</p>
        <p class="small" style="margin-top:var(--space-5);max-width:34ch">Built by <a class="link" href="https://penningtongrp.com" rel="noopener">Pennington Group Associates</a> &mdash; data driven project management &amp; controls.</p>
      </div>
      <div>
        <h3>Product</h3>
        <ul role="list">
          <li><a href="platform.html">Platform</a></li>
          <li><a href="modules.html">All modules</a></li>
          <li><a href="platform.html#link">Link exchange</a></li>
          <li><a href="platform.html#deployment">Deployment</a></li>
        </ul>
      </div>
      <div>
        <h3>Evaluate</h3>
        <ul role="list">
          <li><a href="demo.html">Live demo</a></li>
          <li><a href="contact.html">Request a demo</a></li>
          <li><a href="modules.html#vissrad-computer">VissRad Computer</a></li>
        </ul>
      </div>
      <div>
        <h3>Company</h3>
        <ul role="list">
          <li><a href="company.html">About</a></li>
          <li><a href="company.html#services">Services</a></li>
          <li><a href="contact.html">Contact</a></li>
          <li><a href="https://penningtongrp.com" rel="noopener">Pennington Group</a></li>
        </ul>
      </div>
    </div>
    <div class="footer__base">
      <p>&copy; 2026 VissRad. All rights reserved.</p>
      <p class="mono">Houston, Texas &middot; vissrad.com</p>
    </div>
  </div>
</footer>

<script src="assets/js/main.js" defer></script>
</body>
</html>
"""


def page_head(eyebrow, h1, lede):
    return f"""
  <section class="pagehead gridbg">
    <div class="wrap">
      <p class="eyebrow">{eyebrow}</p>
      <h1 class="h-1">{h1}</h1>
      <p class="lede" style="margin-top:var(--space-6)">{lede}</p>
    </div>
  </section>
"""


# ===========================================================================
# PLATFORM
# ===========================================================================
PLATFORM = page_head(
    "Platform",
    "Eleven applications, one accountable chain of record.",
    "VissRad is deliberately not a monolith. Each application owns its own data and its own users, and they exchange signed business documents through a transport layer called Link. That is how a certified quantity in the field ends up governing what finance is allowed to pay."
) + """
  <section class="section section--tight">
    <div class="wrap">
      <div class="grid grid-3">
        <div class="stat reveal"><p class="stat__num">11</p><p class="stat__label">Applications across controls, commissioning, packaging and finance</p></div>
        <div class="stat reveal"><p class="stat__num">11</p><p class="stat__label">Link document types moving between them</p></div>
        <div class="stat reveal"><p class="stat__num">3</p><p class="stat__label">Deployment shapes &mdash; laptop, plant network or cloud</p></div>
      </div>
    </div>
  </section>

  <!-- ================= ARCHITECTURE ================= -->
  <section class="section section--panel section--rule">
    <div class="wrap">
      <div class="sec-head reveal">
        <p class="eyebrow">Architecture</p>
        <h2 class="h-1">Each application is real software, not a tab.</h2>
        <p class="lede">The desktop applications are Python and PySide6, built on a shared <span class="mono">vissrad_core</span> library and a shared <span class="mono">vissrad_link</span> client, then packaged independently. A cost engineer installs the cost engineer's tool. Nobody inherits a payables module they will never open.</p>
      </div>
      <div class="grid grid-3">
        <article class="card reveal">
          <p class="chip">Layer 1</p>
          <h3 class="h-3" style="margin-top:var(--space-4)">Application</h3>
          <p class="small" style="margin-top:var(--space-3)">Purpose-built screens for one discipline &mdash; project controls, commissioning, work packaging, payables, general ledger. Own database, own permissions, own release cadence.</p>
        </article>
        <article class="card reveal">
          <p class="chip">Layer 2</p>
          <h3 class="h-3" style="margin-top:var(--space-4)">Link exchange</h3>
          <p class="small" style="margin-top:var(--space-3)">An outbox and inbox on every application. Documents are written as JSON, addressed to a recipient, and acknowledged once posted. Money is carried as decimal strings so nothing rounds in transit.</p>
        </article>
        <article class="card reveal">
          <p class="chip">Layer 3</p>
          <h3 class="h-3" style="margin-top:var(--space-4)">Reporting</h3>
          <p class="small" style="margin-top:var(--space-3)">Star-schema exports and a read-only SQLite ODBC surface, so Power BI, Excel and your existing corporate reporting read the same facts the applications wrote.</p>
        </article>
      </div>
    </div>
  </section>

  <!-- ================= LINK ================= -->
  <section class="section" id="link">
    <div class="wrap">
      <div class="sec-head reveal">
        <p class="eyebrow">Link exchange</p>
        <h2 class="h-1">Integration as a document, not a database join.</h2>
        <p class="lede">Real organizations already move work as documents &mdash; a claim, a certificate, an invoice, a payment advice. Link keeps that shape. Every message has an idempotency key, so a retry after a network drop cannot post the same invoice twice.</p>
      </div>

      <div class="split" style="margin-top:var(--space-4)">
        <div class="reveal">
          <h3 class="h-3">Eleven document types</h3>
          <ul class="feat" style="margin-top:var(--space-5)">
            <li><strong>Masters</strong> &mdash; <span class="mono">master_vendor</span>, <span class="mono">master_customer</span>, <span class="mono">master_cost_object</span>, <span class="mono">master_gl_account</span></li>
            <li><strong>Field &amp; progress</strong> &mdash; <span class="mono">progress_claim</span>, <span class="mono">progress_certificate</span></li>
            <li><strong>Finance</strong> &mdash; <span class="mono">vendor_invoice</span>, <span class="mono">payment_advice</span>, <span class="mono">journal_entry</span></li>
            <li><strong>Cost</strong> &mdash; <span class="mono">commitment</span>, <span class="mono">actual_cost</span></li>
          </ul>
        </div>
        <div class="reveal">
          <h3 class="h-3">Three transports</h3>
          <ul class="feat" style="margin-top:var(--space-5)">
            <li><strong>Folder</strong> &mdash; a watched directory. Nothing to install, nothing to open a port for.</li>
            <li><strong>HTTP</strong> &mdash; the Link Hub REST service with API-key authentication: <span class="mono">POST /messages</span>, <span class="mono">GET /messages</span>, <span class="mono">POST /ack</span>, <span class="mono">GET /health</span>.</li>
            <li><strong>Direct</strong> &mdash; in-process delivery for a single machine or an automated test harness.</li>
          </ul>
        </div>
      </div>

      <div class="callout reveal" style="margin-top:var(--space-12)">
        <h3 class="h-4">Failure is a designed state</h3>
        <p class="small" style="margin-top:var(--space-3)">Undelivered documents retry on a fixed ladder &mdash; 5 seconds, 15 seconds, 1 minute, 5 minutes, 15 minutes, then 1 hour &mdash; for seven attempts in total. Anything still stuck lands in the hub console, where it can be inspected and replayed. A message is never silently dropped, and a silent gap between two applications never becomes a silent gap in the cost report.</p>
      </div>
    </div>
  </section>

  <!-- ================= DATA & REPORTING ================= -->
  <section class="section section--panel section--rule">
    <div class="wrap">
      <div class="split split--copy-first">
        <div class="reveal">
          <p class="eyebrow">Data &amp; reporting</p>
          <h2 class="h-1">Your schedule in. Your dashboards out.</h2>
          <p class="body-muted" style="margin-top:var(--space-5)">Project controls does not begin on a blank screen. VissRadPCS imports the CSV export of a Primavera P6 schedule &mdash; it needs activity ID, start date and finish date &mdash; matches activities to the work breakdown structure, and reports every activity it could not match rather than quietly absorbing it.</p>
          <p class="body-muted" style="margin-top:var(--space-4)">On the way out, the same project produces a monthly cost report PDF, a star-schema export for BI tooling, and a read-only SQLite ODBC connection that Power BI Desktop can refresh against directly.</p>
        </div>
        <div class="reveal">
          <ul class="feat">
            <li><strong>In</strong> &mdash; P6 activity CSV, cost and quantity CSV imports, tag and ITR registers</li>
            <li><strong>In</strong> &mdash; VissRad4D reads P6 XER, XML, CSV and XLSX directly</li>
            <li><strong>Out</strong> &mdash; monthly cost report PDF with CPI, EAC and VAC</li>
            <li><strong>Out</strong> &mdash; star-schema fact and dimension tables for Power BI</li>
            <li><strong>Out</strong> &mdash; read-only ODBC over the project database</li>
            <li><strong>Out</strong> &mdash; payment files in NACHA and ISO 20022 <span class="mono">pain.001</span>, plus check register and remittance advice</li>
          </ul>
          <p class="field__hint" style="margin-top:var(--space-5)">P6 exchange is file-based. VissRad does not write back into your P6 database.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- ================= DEPLOYMENT ================= -->
  <section class="section" id="deployment">
    <div class="wrap">
      <div class="sec-head reveal">
        <p class="eyebrow">Deployment</p>
        <h2 class="h-1">One laptop, one plant network, or your cloud.</h2>
        <p class="lede">The same applications run in all three shapes. Nothing in the architecture forces you into a hosted subscription to get started, and nothing stops you moving up when the joint venture arrives.</p>
      </div>
      <div class="grid grid-3">
        <article class="card reveal">
          <p class="chip">Single machine</p>
          <h3 class="h-3" style="margin-top:var(--space-4)">Standalone</h3>
          <p class="small" style="margin-top:var(--space-3)">SQLite per application, Link over a watched folder or the direct in-process transport. One estimator or one controls engineer, no servers, no IT ticket.</p>
        </article>
        <article class="card reveal">
          <p class="chip">On premises</p>
          <h3 class="h-3" style="margin-top:var(--space-4)">Plant network</h3>
          <p class="small" style="margin-top:var(--space-3)">PostgreSQL with a FastAPI Link Hub on the site network and authenticated HTTP transport between applications. Project data never leaves your environment.</p>
        </article>
        <article class="card reveal">
          <p class="chip">Cloud</p>
          <h3 class="h-3" style="margin-top:var(--space-4)">Hosted</h3>
          <p class="small" style="margin-top:var(--space-3)">Managed PostgreSQL with a replicated Link Hub behind TLS, for multi-office teams and joint ventures working the same capital project.</p>
        </article>
      </div>
      <div class="callout callout--neutral reveal" style="margin-top:var(--space-10)">
        <h3 class="h-4">What VissRad does not claim</h3>
        <p class="small" style="margin-top:var(--space-3)">There is no single shared database behind the suite &mdash; integration is document exchange, and that is a deliberate choice. Primavera P6 is a file import, not a live two-way link. Payment files follow NACHA and ISO 20022 layouts but are not bank-certified for transmission, and the demo build stamps them accordingly. Bulk invoice import from CSV and PDF is a stub, not a shipping feature. Live 3D model translation depends on your own Autodesk platform entitlements. We would rather you read that here than discover it in month three.</p>
      </div>
    </div>
  </section>

  <section class="section section--rule">
    <div class="wrap">
      <div class="cta reveal">
        <div>
          <p class="eyebrow">Next</p>
          <h2 class="h-2">See the applications themselves.</h2>
          <p class="body-muted" style="margin-top:var(--space-5)">Six core applications carry most of a capital project. Five more cover estimating, scheduling, reporting and the AI research desk.</p>
          <div class="btn-row" style="margin-top:var(--space-8)">
            <a class="btn btn--primary" href="modules.html">All eleven modules</a>
            <a class="btn btn--ghost" href="demo.html">Open the demo</a>
          </div>
        </div>
        <div>
          <figure class="figframe">
            <img src="assets/img/control-room.webp" alt="Industrial control room with monitoring screens" width="1800" height="1013" loading="lazy">
            <figcaption>Project controls, commissioning and finance reading one record</figcaption>
          </figure>
        </div>
      </div>
    </div>
  </section>
"""


# ===========================================================================
# MODULES
# ===========================================================================
def module(anchor, name, role, lede, blocks, tags, note=None):
    b = "\n".join(
        f"""          <div>
            <h4 class="h-4">{t}</h4>
            <p class="small" style="margin-top:var(--space-2)">{d}</p>
          </div>""" for t, d in blocks)
    tag_html = "".join(f'<span class="chip">{t}</span>' for t in tags)
    note_html = f'\n      <p class="field__hint" style="margin-top:var(--space-6)">{note}</p>' if note else ""
    return f"""
  <section class="section section--rule" id="{anchor}">
    <div class="wrap">
      <div class="split split--copy-first split--top reveal">
        <div>
          <p class="eyebrow">{role}</p>
          <h2 class="h-2">{name}</h2>
          <p class="body-muted" style="margin-top:var(--space-5)">{lede}</p>
          <div class="mod__tags" style="margin-top:var(--space-6)">{tag_html}</div>
        </div>
        <div class="grid grid-2" style="gap:var(--space-6)">
{b}
        </div>
      </div>{note_html}
    </div>
  </section>
"""


MODULES = page_head(
    "Modules",
    "Six applications that carry the project. Five more that surround it.",
    "Each module is installed and run on its own. They agree with one another because they exchange documents through Link, not because they were bolted into one oversized program."
) + module(
    "vissradpcs", "VissRadPCS", "Project controls",
    "One project per <span class=\"mono\">.vrpcs</span> file. Progress, completions, certification and cost live in the same record, so a certificate cannot be issued against work the field never signed off, and a forecast cannot ignore a commitment that has already been placed.",
    [("Project health", "A single dashboard for schedule, progress, cost and certification status with the current blockers surfaced rather than buried."),
     ("Completions", "Unit to system to subsystem hierarchy, a tag register, ITRs, and punch items graded A through D."),
     ("Certificates", "MCC, RFCC and RFSU packs that show their live blockers &mdash; outstanding ITRs and category A and B punch &mdash; before anyone signs."),
     ("Progress &amp; earned value", "Progress by WBS, discipline and unit of measure, with weighted rule-of-credit steps, a performance factor, CPI, and shift-by-shift quantity entry."),
     ("Cost", "Cost report, commitments, changes and trends, cash flow and forecast, with CPI, EAC and VAC computed from the same actuals."),
     ("Forecasting", "Five estimate-at-completion methods &mdash; CPI performance, remaining-to-plan, full reforecast, manual ETC with a mandatory written reason, and committed plus remaining &mdash; alongside a contingency drawdown register.")],
    ["Earned value", "P6 import", "5 EAC methods", "Cost report PDF", "ODBC for Power BI"],
    "Schedule data arrives as a Primavera P6 CSV export requiring activity ID, start date and finish date. Unmatched activities are reported, not absorbed."
) + module(
    "vissradsuc", "VissRadSU&amp;C", "Startup &amp; commissioning",
    "Systemisation through to handover in eight working tabs, driving a gated certificate ladder. Nothing advances a gate on optimism &mdash; the check sheets and punch status decide.",
    [("The gate ladder", "RVC to MCC to RFC to SCC to DCC to HOC, each gate holding until its evidence exists."),
     ("Eight tabs", "Dashboard, Systemisation, Check Sheets, Punch List, Packages, Certificates, 3D Model, and Exports &amp; Audit."),
     ("Navisworks, properly", "A COM bridge to a running Navisworks session, plus file exchange &mdash; search-set XML, appearance profiles, TimeLiner CSV and a DataTools ODBC definition."),
     ("Browser viewer", "A Three.js viewer for reviewing system coloring without a Navisworks seat on every desk.")],
    ["6 certificate gates", "ITRs &amp; punch", "Navisworks COM", "Search sets", "Audit export"]
) + module(
    "vissradcost", "VissRadCost", "Cost management",
    "A cost breakdown structure with budget control, commitments, actuals, change management and forecasting &mdash; the EcoSys-shaped discipline, sized for a project team rather than an enterprise rollout. It extends the same cost engine PCS reports from.",
    [("Nine views", "Dashboard, Project Structure, Budgets, Commitments, Actuals, Change Management, Forecast, Earned Value and Reports."),
     ("Change control", "Trends and approved changes move the control budget explicitly, with the original budget preserved for comparison."),
     ("Forecast", "Forecast at completion by cost account, reconciled against committed value and remaining scope."),
     ("Earned value", "The same CPI, SPI, EAC and VAC definitions used across the suite &mdash; not a second, differently-defined set.")],
    ["CBS", "Budgets", "Commitments", "Change control", "Cash flow"]
) + module(
    "vissradarap", "VissRadARAP", "Accounts payable &amp; receivable",
    "The payables desk, wired to the field. Progress claims are verified against certified quantities from PCS before they reach the approval queue, and retention is withheld and released against real certificates rather than a calendar.",
    [("Dashboards", "AP and AR aging, cash forecast, approval bottlenecks, early-payment discount capture and DPO."),
     ("Matching", "Three-way purchase order, receipt and invoice match, plus progress-claim verification against PCS field data."),
     ("Approval", "A queue with delegation and escalation, so an absent approver is a routing event and not a two-week hold."),
     ("Retention", "Withheld on invoice and released on certificate &mdash; the certificate, not the promise, is what moves the money."),
     ("Payment run", "Exports NACHA, ISO 20022 <span class=\"mono\">pain.001</span>, a check register CSV and a remittance advice PDF."),
     ("Coding", "GL coding with line-total validation, and duplicate detection on invoice intake.")],
    ["3-way match", "Retention", "NACHA", "ISO 20022", "Duplicate detection"],
    "Payment files are format-correct but not bank-certified; demo output carries a &ldquo;DEMO &mdash; NOT FOR TRANSMISSION&rdquo; banner. Bulk invoice import from CSV and PDF is a labeled stub."
) + module(
    "vissradawp", "VissRadAWP", "Advanced work packaging",
    "Construction work areas down to installation work packages, with a release gate that actually holds. An IWP is released when its constraints are clear &mdash; materials, drawings, access, permits, labour &mdash; not when the lookahead needs it to be.",
    [("Package hierarchy", "CWA to CWP to EWP to IWP, with registers at each level."),
     ("Release gate", "An IWP cannot be released with open constraints, and the Constraint Matrix shows exactly what is holding it."),
     ("Path of construction", "Sequence and lookahead views built from the imported P6 schedule."),
     ("Progress", "Package-level progress that reports into the same earned-value picture as PCS.")],
    ["CWA / CWP / EWP / IWP", "Constraint matrix", "IWP release gate", "Lookahead"]
) + module(
    "vissrad4d", "VissRad4D", "4D schedule visualization",
    "Schedule time painted onto a picture of the job. Give it one P6 schedule and one elevation drawing &mdash; no model required &mdash; and it will show the planned sequence, progress against plan, and the forecast, with the SPI and finish variance to argue from.",
    [("Two inputs", "One P6 schedule in XER, XML, CSV or XLSX, and one elevation drawing. That is the whole setup."),
     ("Three modes", "Planned sequence, progress versus plan, and forecast."),
     ("The numbers", "SPI, finish variance, an S-curve and a full activity register alongside the visual."),
     ("Optional live 3D", "Autodesk Platform Services translation of NWD, RVT, IFC and DWG to SVF2 with TimeLiner mapping, when your entitlements allow it."),
     ("VRView", "A Node and Express service with a React front end and <span class=\"mono\">better-sqlite3</span> storage."),
     ("Standalone", "VissRad4D runs on its own and does not require the Link exchange layer.")],
    ["P6 XER / XML / CSV / XLSX", "No model required", "SPI", "S-curve", "Optional APS 3D"]
) + """
  <!-- ================= COMPUTER ================= -->
  <section class="section section--panel section--rule" id="vissrad-computer">
    <div class="wrap">
      <div class="split split--copy-first split--top reveal">
        <div>
          <p class="eyebrow">Research desk</p>
          <h2 class="h-2">VissRad Computer</h2>
          <p class="body-muted" style="margin-top:var(--space-5)">An AI research and analysis desk built for the way project work actually happens &mdash; sometimes online with the whole web available, and sometimes on a plant network with nothing but a folder of specifications and a schedule export.</p>
          <ul class="feat" style="margin-top:var(--space-6)">
            <li><strong>Online</strong> &mdash; web search with citations you can follow back to the source</li>
            <li><strong>Offline</strong> &mdash; local reference sets indexed with SQLite FTS5 over PDF, XLSX, DOCX, CSV, XML and P6 XER files</li>
            <li><strong>Your key, your model</strong> &mdash; any OpenAI-compatible endpoint: OpenAI, OpenRouter, Together, Ollama or LM Studio</li>
            <li><strong>Python workspace</strong> &mdash; for the takeoff arithmetic and schedule analysis that no chat window handles well</li>
            <li><strong>One switch</strong> &mdash; Online and Offline are a toggle, not two products</li>
            <li><strong>Deploys</strong> &mdash; as a Windows application or a private hosted server</li>
          </ul>
        </div>
        <div>
          <figure class="figframe">
            <img src="assets/img/commissioning.webp" alt="Commissioning engineers reviewing documentation on site" width="1800" height="1200" loading="lazy">
            <figcaption>Built for the plant network as much as the office</figcaption>
          </figure>
          <p class="field__hint" style="margin-top:var(--space-4)">Python and FastAPI with a pywebview shell. You supply the model key; nothing is routed through VissRad.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- ================= THE REST ================= -->
  <section class="section">
    <div class="wrap">
      <div class="sec-head reveal">
        <p class="eyebrow">Also in the suite</p>
        <h2 class="h-1">The remaining modules.</h2>
        <p class="lede">Estimating, scheduling and reporting round out the eleven. They follow the same rules: own their data, exchange documents, and export somewhere your existing reporting can read.</p>
      </div>
      <div class="reveal">
        <div class="modrow">
          <div>
            <p class="modrow__name">VissRadEST</p>
            <p class="modrow__role">Estimating</p>
          </div>
          <p class="small">Discipline takeoff and cost estimating for industrial piping, equipment, engineering and construction scope &mdash; the workbook discipline this whole suite grew out of, with the budget handed forward to PCS and Cost rather than retyped.</p>
        </div>
        <div class="modrow">
          <div>
            <p class="modrow__name">VissRadSCH</p>
            <p class="modrow__role">Scheduling</p>
          </div>
          <p class="small">Schedule development and maintenance alongside the P6 data the rest of the suite consumes, keeping activity structure aligned to the work breakdown structure that progress is measured against.</p>
        </div>
        <div class="modrow">
          <div>
            <p class="modrow__name">VissRadBI</p>
            <p class="modrow__role">Reporting</p>
          </div>
          <p class="small">The reporting layer over the star-schema exports &mdash; project, portfolio and executive views built on the same facts the applications wrote, with Power BI and Excel reading through ODBC.</p>
        </div>
        <div class="modrow">
          <div>
            <p class="modrow__name">VissRadERP</p>
            <p class="modrow__role">Financial &amp; management accounting</p>
          </div>
          <p class="small">General ledger, accounts payable and receivable, cost centre accounting and internal orders, driven from a <span class="mono">Ctrl+K</span> transaction-code command bar with <span class="mono">/n</span> and <span class="mono">/o</span> prefixes and description search. Period close runs posting-period control, balance carry-forward, the recurring-entry run and the <span class="mono">ZCLOSECHK</span> and <span class="mono">ZRECON</span> checks. 276 standard FI and CO codes are catalogd; 66 of 280 screens are fully built.</p>
        </div>
        <div class="modrow">
          <div>
            <p class="modrow__name">VissRad Link</p>
            <p class="modrow__role">Exchange layer</p>
          </div>
          <p class="small">The outbox, inbox, document schema and transports that make the rest of it one system. <a class="link" href="platform.html#link">How Link works</a>.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="section section--rule">
    <div class="wrap">
      <div class="cta reveal">
        <div>
          <p class="eyebrow">Evaluate</p>
          <h2 class="h-2">Open it rather than read about it.</h2>
          <p class="body-muted" style="margin-top:var(--space-5)">There is a running demonstration of the suite with a populated project dataset, and a guided walkthrough if you would rather be shown the chain from field quantity to withheld payment.</p>
          <div class="btn-row" style="margin-top:var(--space-8)">
            <a class="btn btn--primary" href="demo.html">Open the demo</a>
            <a class="btn btn--ghost" href="contact.html">Book a walkthrough</a>
          </div>
        </div>
        <div>
          <figure class="figframe">
            <img src="assets/img/valve-detail.webp" alt="Close detail of industrial valves and instrumentation" width="1800" height="1200" loading="lazy">
            <figcaption>Wisdom in decision making</figcaption>
          </figure>
        </div>
      </div>
    </div>
  </section>
"""


# ===========================================================================
# DEMO
# ===========================================================================
DEMO = page_head(
    "Demo",
    "See the chain from field quantity to withheld payment.",
    "The demonstration environments run on a populated industrial project dataset. Nothing in them is a click-through mock-up &mdash; the numbers are computed by the same code that would run on your project."
) + """
  <section class="section section--tight">
    <div class="wrap">
      <div class="grid grid-3">
        <article class="card reveal">
          <p class="chip chip--accent">Recommended</p>
          <h3 class="h-3" style="margin-top:var(--space-4)">Guided walkthrough</h3>
          <p class="small" style="margin-top:var(--space-3)">Forty-five minutes, screen-shared, on your kind of project. We start at a shift quantity entry and end at a payment the approval queue refused to release.</p>
          <p style="margin-top:var(--space-6)"><a class="btn btn--primary btn--sm" href="contact.html">Book a walkthrough</a></p>
        </article>
        <article class="card reveal">
          <p class="chip">Self-serve</p>
          <h3 class="h-3" style="margin-top:var(--space-4)">Browser demo</h3>
          <p class="small" style="margin-top:var(--space-3)">A hosted browser build of the module set, with the demonstration project loaded. Best for getting a feel for the structure and the reports before a call.</p>
          <p style="margin-top:var(--space-6)"><a class="btn btn--ghost btn--sm" href="contact.html">Request access</a></p>
        </article>
        <article class="card reveal">
          <p class="chip">Desktop</p>
          <h3 class="h-3" style="margin-top:var(--space-4)">Hosted desktop build</h3>
          <p class="small" style="margin-top:var(--space-3)">The real PySide6 applications running on a hosted desktop session, for evaluating the actual working software rather than a web approximation.</p>
          <p style="margin-top:var(--space-6)"><a class="btn btn--ghost btn--sm" href="contact.html">Request credentials</a></p>
        </article>
      </div>
      <p class="field__hint reveal" style="margin-top:var(--space-8)">Demonstration environments are issued per evaluation so the dataset stays clean and we know who to help. Access details arrive by email, usually the same day.</p>
    </div>
  </section>

  <!-- ================= WHAT YOU'LL SEE ================= -->
  <section class="section section--panel section--rule">
    <div class="wrap">
      <div class="sec-head reveal">
        <p class="eyebrow">The walkthrough</p>
        <h2 class="h-1">Four moments worth forty-five minutes.</h2>
        <p class="lede">We do not tour menus. We follow one piece of work from the field to the bank file and stop wherever you want to argue with it.</p>
      </div>
      <div class="grid grid-4">
        <div class="numitem reveal">
          <h3 class="h-4">Quantity to progress</h3>
          <p class="small" style="margin-top:var(--space-3)">A shift entry in PCS moves weighted rule-of-credit steps, and the earned-value picture updates &mdash; no month-end recalculation.</p>
        </div>
        <div class="numitem reveal">
          <h3 class="h-4">Progress to certificate</h3>
          <p class="small" style="margin-top:var(--space-3)">SU&amp;C shows the gate refusing to advance while ITRs and category A punch remain open against the subsystem.</p>
        </div>
        <div class="numitem reveal">
          <h3 class="h-4">Claim to verification</h3>
          <p class="small" style="margin-top:var(--space-3)">A subcontractor claim arrives in ARAP, is checked against certified field quantities, and the variance is put in front of the approver.</p>
        </div>
        <div class="numitem reveal">
          <h3 class="h-4">Certificate to money</h3>
          <p class="small" style="margin-top:var(--space-3)">Retention releases on the certificate, the payment run produces the file, and the cost report and forecast already know about it.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- ================= COMPUTER DEMO ================= -->
  <section class="section">
    <div class="wrap">
      <div class="split split--copy-first split--top reveal">
        <div>
          <p class="eyebrow">Also available</p>
          <h2 class="h-2">VissRad Computer, online and offline.</h2>
          <p class="body-muted" style="margin-top:var(--space-5)">The research desk can be demonstrated separately, including the offline mode &mdash; a local reference set indexed over specifications, workbooks and a P6 export, answering with citations and no outbound connection.</p>
          <p class="body-muted" style="margin-top:var(--space-4)">Bring a folder of your own documents if you want a fair test. That is the only way to know whether the retrieval is any good.</p>
          <div class="btn-row" style="margin-top:var(--space-8)">
            <a class="btn btn--primary" href="contact.html">Ask for a Computer demo</a>
            <a class="btn btn--ghost" href="modules.html#vissrad-computer">What it does</a>
          </div>
        </div>
        <div>
          <div class="ledger">
            <div class="ledger__head">
              <p class="ledger__title">Demonstration dataset</p>
              <p class="mono tiny">VRPCS</p>
            </div>
            <div class="ledger__rows">
              <div class="lrow"><span class="lrow__label">Project type</span><span class="lrow__val mono">Industrial / process</span></div>
              <div class="lrow"><span class="lrow__label">Structure</span><span class="lrow__val mono">Unit &rarr; system &rarr; subsystem</span></div>
              <div class="lrow"><span class="lrow__label">Schedule source</span><span class="lrow__val mono">Primavera P6 export</span></div>
              <div class="lrow"><span class="lrow__label">Progress method</span><span class="lrow__val mono">Rule of credit</span></div>
              <div class="lrow"><span class="lrow__label">Certificates</span><span class="lrow__val mono">MCC / RFCC / RFSU</span></div>
              <div class="lrow lrow--total"><span class="lrow__label">Overclaim caught</span><span class="lrow__val mono">$152,522</span></div>
            </div>
          </div>
          <p class="field__hint" style="margin-top:var(--space-4)">Payment files produced in the demonstration are stamped &ldquo;DEMO &mdash; NOT FOR TRANSMISSION&rdquo;.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="section section--rule">
    <div class="wrap">
      <div class="cta reveal">
        <div>
          <p class="eyebrow">Get started</p>
          <h2 class="h-2">Tell us what kind of project you run.</h2>
          <p class="body-muted" style="margin-top:var(--space-5)">We will set the demonstration up around it &mdash; the right modules, the right progress method, and the reporting shape your organization already expects.</p>
          <div class="btn-row" style="margin-top:var(--space-8)">
            <a class="btn btn--primary" href="contact.html">Request a demo</a>
            <a class="btn btn--ghost" href="platform.html">How the platform works</a>
          </div>
        </div>
        <div>
          <ul class="feat">
            <li><strong>No installation</strong> for the browser and hosted desktop builds</li>
            <li><strong>Populated dataset</strong> so the reports have something to say</li>
            <li><strong>Your documents</strong> welcome for the Computer demonstration</li>
            <li><strong>No sales sequence</strong> &mdash; one engineer, one conversation</li>
          </ul>
        </div>
      </div>
    </div>
  </section>
"""


# ===========================================================================
# COMPANY
# ===========================================================================
COMPANY = page_head(
    "Company",
    "The software arm of a data driven project controls practice.",
    "VissRad is built by <a class=\"link\" href=\"https://penningtongrp.com\" rel=\"noopener\">Pennington Group Associates</a> &mdash; a Houston project management and controls practice that has spent its working life turning project data into decisions people can defend. VissRad is what happened when the workbooks, the CPM analysis and the Power BI models outgrew the tools they were built in."
) + """
  <section class="section section--tight">
    <div class="wrap">
      <div class="split split--copy-first split--top reveal">
        <div>
          <h2 class="h-2">One house, two halves.</h2>
          <p class="body-muted" style="margin-top:var(--space-5)">Pennington Group Associates is the practice: data driven project management and controls, delivered on live capital projects with advanced analytics and a disciplined CPM schedule management process behind it. Same tagline, same standard &mdash; <em>wisdom in decision making</em>.</p>
          <p class="body-muted" style="margin-top:var(--space-4)">VissRad is the product. Every screen in it started as a deliverable a client needed under a real deadline &mdash; a progress measurement system, a claim that would not reconcile, a cost report that had to survive an audit. When the same custom build was requested for the third time, it stopped being a workbook and became an application.</p>
          <p class="body-muted" style="margin-top:var(--space-4)">That is why the two halves still reinforce each other. Consulting keeps the software honest about how projects actually run. The software lets the consulting arrive already holding the instrumentation.</p>
          <div class="btn-row" style="margin-top:var(--space-8)">
            <a class="btn btn--ghost" href="https://penningtongrp.com" rel="noopener">Visit Pennington Group</a>
          </div>
        </div>
        <div>
          <figure class="figframe">
            <img src="assets/img/4d-elevation.webp" alt="Elevation view of an industrial process structure rendered as a wireframe" width="1350" height="1800" loading="lazy">
            <figcaption>Houston, Texas</figcaption>
          </figure>
        </div>
      </div>
    </div>
  </section>

  <section class="section section--panel section--rule">
    <div class="wrap">
      <div class="sec-head reveal">
        <p class="eyebrow">Our expertise</p>
        <h2 class="h-1">The problem was never the arithmetic.</h2>
        <p class="lede">On industrial capital projects the estimate, the schedule, the field, the cost report and the payables desk each keep a version of the truth. They are all defensible on their own. Put together they disagree &mdash; and by the time anyone notices, the invoice is paid.</p>
      </div>
      <div class="grid grid-3">
        <div class="numitem reveal">
          <h3 class="h-3">Data before opinion</h3>
          <p class="small" style="margin-top:var(--space-3)">We leverage project data to help teams make better decisions, manage risk and optimize performance. A percentage is not progress. A gate does not open because the schedule needs it to. Every status has a quantity, a signed check sheet or a certificate behind it, and the software will show you which.</p>
        </div>
        <div class="numitem reveal">
          <h3 class="h-3">Own your data</h3>
          <p class="small" style="margin-top:var(--space-3)">A project is a file you can copy. The reporting layer exports star schemas and speaks ODBC, so the numbers land in the Power BI and Excel models your organization already reads. Nothing is locked behind a hosted tenancy, and moving off VissRad is a supported operation rather than a negotiation.</p>
        </div>
        <div class="numitem reveal">
          <h3 class="h-3">Say what is not built</h3>
          <p class="small" style="margin-top:var(--space-3)">Stubs are labeled as stubs. Demo payment files are stamped. The P6 exchange is described as a file import because that is what it is. Overselling a project controls tool costs the buyer far more than it costs us.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- ================= SERVICES ================= -->
  <section class="section" id="services">
    <div class="wrap">
      <div class="sec-head reveal">
        <p class="eyebrow">Our services</p>
        <h2 class="h-1">We also do the work, not only the software.</h2>
        <p class="lede">Most engagements start with a real deliverable under a real deadline. We work closely with you to understand the project's goals, then build the management and analytics plan around them. If VissRad helps, we bring it. If a workbook and a Power BI model are the right answer this quarter, we say so.</p>
      </div>

      <div class="grid grid-3">
        <article class="card reveal">
          <p class="chip">01</p>
          <h3 class="h-3" style="margin-top:var(--space-4)">Project management</h3>
          <p class="small" style="margin-top:var(--space-3)">Project planning, risk identification and resource management aimed at delivery on time and on budget &mdash; with the plan built so its own progress can be measured rather than asserted.</p>
          <ul class="feat" style="margin-top:var(--space-5)">
            <li><strong>Planning</strong> &mdash; execution plans, work breakdown structures, responsibility matrices</li>
            <li><strong>Risk</strong> &mdash; identification, quantification and contingency drawdown discipline</li>
            <li><strong>Packaging</strong> &mdash; CWP, EWP and IWP structures with constraint-based release</li>
          </ul>
        </article>
        <article class="card reveal">
          <p class="chip">02</p>
          <h3 class="h-3" style="margin-top:var(--space-4)">Data analysis &amp; visualization</h3>
          <p class="small" style="margin-top:var(--space-3)">Advanced analytics over your project data alongside a CPM schedule management process, producing the visual insight that shows where performance is actually going &mdash; and the data requirements to keep it coming.</p>
          <ul class="feat" style="margin-top:var(--space-5)">
            <li><strong>Schedule data</strong> &mdash; Primavera P6 XER, XML, CSV and XLSX extraction and CPM analysis</li>
            <li><strong>Reporting &amp; BI</strong> &mdash; star-schema data models, Power BI dashboards, executive packs</li>
            <li><strong>4D</strong> &mdash; schedule sequence and progress painted onto the job, no model required</li>
          </ul>
        </article>
        <article class="card reveal">
          <p class="chip">03</p>
          <h3 class="h-3" style="margin-top:var(--space-4)">Project controls</h3>
          <p class="small" style="margin-top:var(--space-3)">Full visibility of project cost and trend, with customized controls reports that carry the analytics through instead of restating last month's totals in a new font.</p>
          <ul class="feat" style="margin-top:var(--space-5)">
            <li><strong>Progress</strong> &mdash; measurement systems, rule of credit, earned value, forecasting</li>
            <li><strong>Cost</strong> &mdash; budgets, commitments, change control, cash flow, EAC and VAC</li>
            <li><strong>Estimating</strong> &mdash; piping, equipment, engineering and construction discipline takeoff</li>
          </ul>
        </article>
      </div>

      <div class="callout reveal" style="margin-top:var(--space-12)">
        <h3 class="h-4">And the parts most people leave out</h3>
        <p class="small" style="margin-top:var(--space-3)">Completions and commissioning &mdash; systemization, ITR and punch structures, and certificate gate design. Systems design &mdash; ERP, procurement, accounts payable and cost workflow design for project organizations. These are where the chain from field to payment usually breaks, and they are the reason VissRad covers them at all.</p>
      </div>
    </div>
  </section>

  <section class="section section--rule">
    <div class="wrap">
      <div class="cta reveal">
        <div>
          <p class="eyebrow">Transform your projects</p>
          <h2 class="h-2">Bring the project, not the requirements document.</h2>
          <p class="body-muted" style="margin-top:var(--space-5)">Describe what is going wrong &mdash; the claim you cannot verify, the forecast nobody trusts, the turnover pack that is three weeks behind &mdash; and we will tell you honestly whether VissRad is the answer or whether this is a consulting problem.</p>
          <div class="btn-row" style="margin-top:var(--space-8)">
            <a class="btn btn--primary" href="contact.html">Start a conversation</a>
            <a class="btn btn--ghost" href="demo.html">See the demo first</a>
          </div>
        </div>
        <div>
          <div class="ledger">
            <div class="ledger__head">
              <p class="ledger__title">At a glance</p>
              <p class="mono tiny">VISSRAD</p>
            </div>
            <div class="ledger__rows">
              <div class="lrow"><span class="lrow__label">Practice</span><span class="lrow__val mono">Pennington Group</span></div>
              <div class="lrow"><span class="lrow__label">Based in</span><span class="lrow__val mono">Houston, Texas</span></div>
              <div class="lrow"><span class="lrow__label">Sectors</span><span class="lrow__val mono">Process &amp; industrial</span></div>
              <div class="lrow"><span class="lrow__label">Applications</span><span class="lrow__val mono">11</span></div>
              <div class="lrow"><span class="lrow__label">Stack</span><span class="lrow__val mono">Python / PySide6 / FastAPI</span></div>
              <div class="lrow"><span class="lrow__label">Reporting</span><span class="lrow__val mono">Power BI via ODBC</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
"""


# ===========================================================================
# CONTACT
# ===========================================================================
CONTACT = page_head(
    "Contact",
    "Request a demo, or just describe the problem.",
    "Tell us what kind of project you run and which part of the chain is breaking. You will hear back from an engineer, not a sequence."
) + """
  <section class="section section--tight">
    <div class="wrap">
      <div class="split split--copy-first">
        <div class="reveal">
          <form class="form" data-contact-form data-to="dpennington@penningtongrp.com" novalidate>
            <div class="form__row">
              <div class="field">
                <label for="name">Name <span class="req">*</span></label>
                <input id="name" name="name" type="text" autocomplete="name" required>
              </div>
              <div class="field">
                <label for="email">Work email <span class="req">*</span></label>
                <input id="email" name="email" type="email" autocomplete="email" required>
              </div>
            </div>
            <div class="form__row">
              <div class="field">
                <label for="company">Company</label>
                <input id="company" name="company" type="text" autocomplete="organization">
              </div>
              <div class="field">
                <label for="role">Role</label>
                <input id="role" name="role" type="text">
              </div>
            </div>
            <div class="field">
              <label for="interest">What are you looking at?</label>
              <select id="interest" name="interest">
                <option>A guided walkthrough of the suite</option>
                <option>Project controls and earned value (VissRadPCS)</option>
                <option>Startup and commissioning (VissRadSU&amp;C)</option>
                <option>Cost management (VissRadCost)</option>
                <option>Payables and claim verification (VissRadARAP)</option>
                <option>Advanced work packaging (VissRadAWP)</option>
                <option>4D schedule visualization (VissRad4D)</option>
                <option>VissRad Computer</option>
                <option>Consulting &mdash; estimating, controls or reporting</option>
              </select>
            </div>
            <div class="field">
              <label for="message">What is breaking? <span class="req">*</span></label>
              <textarea id="message" name="message" required placeholder="The claim we cannot verify, the forecast nobody trusts, the turnover pack that is three weeks behind&hellip;"></textarea>
              <p class="field__hint">Rough is fine. Two sentences is enough to have a useful first call.</p>
            </div>
            <div class="btn-row">
              <button class="btn btn--primary" type="submit">Send it</button>
            </div>
            <p class="form__status" data-form-status role="status" aria-live="polite"></p>
          </form>
        </div>
        <div class="reveal">
          <div class="card">
            <h3 class="h-4">Direct</h3>
            <p class="small" style="margin-top:var(--space-3)">If you would rather write yourself:</p>
            <p style="margin-top:var(--space-3)"><a class="link mono" href="mailto:dpennington@penningtongrp.com">dpennington@penningtongrp.com</a></p>
            <p class="field__hint" style="margin-top:var(--space-4)">Houston, Texas &middot; United States<br>Pennington Group Associates</p>
          </div>
          <div class="card" style="margin-top:var(--space-6)">
            <h3 class="h-4">What happens next</h3>
            <ul class="feat" style="margin-top:var(--space-4)">
              <li><strong>Same day</strong> &mdash; a reply with a couple of questions about your project</li>
              <li><strong>Within a week</strong> &mdash; a walkthrough shaped around your progress method and reporting</li>
              <li><strong>After that</strong> &mdash; a demonstration environment with your own scenario in it, if it is useful</li>
            </ul>
          </div>
          <div class="callout callout--neutral" style="margin-top:var(--space-6)">
            <h3 class="h-4">No list, no sequence</h3>
            <p class="small" style="margin-top:var(--space-3)">What you send is used to answer you and nothing else. No newsletter, no drip campaign, no resale.</p>
          </div>
        </div>
      </div>
    </div>
  </section>
"""


PAGES = {
    "platform.html": ("VissRad Platform &mdash; architecture, Link exchange and deployment",
                      "How the VissRad suite fits together: eleven applications, eleven Link document types, Primavera P6 import, star-schema and ODBC reporting, and standalone, on-premises or cloud deployment.",
                      PLATFORM),
    "modules.html": ("VissRad Modules &mdash; project controls, commissioning, cost, payables, work packaging and 4D",
                     "The eleven VissRad applications in detail: VissRadPCS, VissRadSU&C, VissRadCost, VissRadARAP, VissRadAWP, VissRad4D, VissRad Computer, plus estimating, scheduling, reporting and ERP.",
                     MODULES),
    "demo.html": ("VissRad Demo &mdash; see the chain from field quantity to withheld payment",
                  "Guided walkthrough, browser demo and hosted desktop build of the VissRad suite, running on a populated industrial project dataset.",
                  DEMO),
    "company.html": ("VissRad Company &mdash; built by industrial estimating and project controls practitioners",
                     "Why VissRad exists, the three commitments behind it, and the estimating, project controls, schedule data, reporting and systems design services we deliver directly.",
                     COMPANY),
    "contact.html": ("Contact VissRad &mdash; request a demo",
                     "Request a VissRad demonstration or describe the project controls, cost or completions problem you are trying to solve.",
                     CONTACT),
}

# Nav highlighting: contact has no nav entry
ACTIVE = {"platform.html": "platform.html", "modules.html": "modules.html",
          "demo.html": "demo.html", "company.html": "company.html",
          "contact.html": ""}

for fname, (title, desc, body) in PAGES.items():
    html = head(title, desc, fname) + header(ACTIVE[fname]) + body + FOOTER
    (ROOT / fname).write_text(html, encoding="utf-8")
    print(f"wrote {fname} ({len(html.splitlines())} lines)")
