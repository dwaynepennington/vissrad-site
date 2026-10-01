#!/usr/bin/env python3
"""End-to-end document-link check: click through from every linked module into
VissRadDEng Documents and back, in the demo.

    pip install playwright && python -m playwright install chromium
    python tools/doc_links_e2e.py                                   # the live public demo
    python tools/doc_links_e2e.py --base http://localhost:8000/app   # a local preview of this site

Each step clicks a real document chip or button (CMMS, SU&C, ProCure, FEED,
RFI, Change, PreCon, AWP, Estimating, Construction, TAR), checks that DEng opens
the right document (and the viewer when a file is attached), then goes Back.
It runs in a fresh browser profile, so edits it makes (an MOC document, a bid
document, a workstep drawing) stay in that throwaway profile. Exits 1 on any
failure. The data audit (doc_links_check.py) lives in the
vissrad-suite repository.
"""
import argparse,os,re,sys
from playwright.sync_api import sync_playwright
ap=argparse.ArgumentParser(description=__doc__.split('\n')[0])
ap.add_argument('--base',default='https://vissrad.com/app',help='URL of the folder holding the module folders')
ap.add_argument('--chrome',default=os.environ.get('VR_CHROME'),help='Chromium executable (default: the Playwright one)')
A=ap.parse_args()
B=A.base.rstrip('/')
RES=[]
HASFILE=[None]
def rec(name,ok,info=''): RES.append((name,ok,info)); print(('PASS' if ok else 'FAIL'),name,info,flush=True)
with sync_playwright() as p:
    br=p.chromium.launch(**({'executable_path':A.chrome} if A.chrome else {})); ctx=br.new_context(viewport={'width':1440,'height':900},accept_downloads=True); pg=ctx.new_page()
    errs=[]; pg.on('pageerror', lambda e: errs.append(pg.url.replace(B,'')+' '+str(e)[:160]))
    dls=[]; pg.on('download', lambda d: dls.append(d.suggested_filename))
    def land(expect_doc, name, back_mod=None, want_viewer=None):
        if want_viewer is None: want_viewer = HASFILE[0] if HASFILE[0] is not None else True
        HASFILE[0]=None
        pg.wait_for_url(re.compile(r'/deng/index'), timeout=8000); pg.wait_for_timeout(2800)
        url=pg.url; v=pg.locator('.dwg-view'); lab=v.get_attribute('aria-label') if v.count() else None
        stale=[k for k in ('vdrl','mr','asset','rfi','moc','iwp') if f'{k}=' in url]
        sel=expect_doc in pg.locator('#view-documents').inner_text() if pg.locator('#view-documents').count() else False
        ok=sel and (lab==f'Drawing {expect_doc}' if want_viewer else True) and '?doc=' not in url
        rec(name, ok, f'viewer={lab} selected={sel} url_after={url.replace(B,'')} stale={stale}')
        if back_mod:
            if v.count(): pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
            pg.go_back(); pg.wait_for_timeout(2000)
            rec(name+' / back', f'/{back_mod}/' in pg.url, pg.url.replace(B,''))
    def chip(sel_text, scope='body'):
        c=pg.locator(f'{scope} .dref-chip:visible', has_text=sel_text).first
        HASFILE[0]=c.locator('.dref-file').count()>0
        c.click(timeout=5000)
    def go(path): pg.goto(B+path); pg.wait_for_timeout(2600)
    # 1 CMMS asset
    go('/cmms/index.html?asset=C-100009')
    chip('PID-100-03'); land('PID-100-03','CMMS asset -> P&ID','cmms')
    go('/cmms/index.html?asset=C-100009')
    om=pg.locator('.dref-chip:visible', has_text='OM-'); n=om.count()
    if n: t=om.first.inner_text(); no=re.search(r'OM-[A-Z]-\d+',t).group(0); om.first.click(); land(no,'CMMS asset -> O&M manual')
    else: rec('CMMS asset -> O&M manual',False,'no OM chip on C-100009')
    # 2 SU&C ITR form
    go('/commissioning/index.html'); pg.locator('#tabs button',has_text='Check Sheets').click(); pg.wait_for_timeout(1500)
    pg.locator('table tbody tr:visible').first.dblclick(); pg.wait_for_timeout(1200)
    chip('ITR-FORM-A-01'); land('ITR-FORM-A-01','SU&C check sheet -> form (rev A)','commissioning')
    rv=None
    # 3 SU&C system boundary P&ID
    go('/commissioning/index.html'); pg.locator('#tabs button',has_text='Systemisation').click(); pg.wait_for_timeout(1500)
    chip('PID-100-02'); land('PID-100-02','SU&C system -> boundary P&ID')
    # 4 SU&C tag P&ID: search tag, click it
    go('/commissioning/index.html'); pg.locator('#tabs button',has_text='Systemisation').click(); pg.wait_for_timeout(1200)
    pg.locator('input[placeholder^="Search systems"]').fill('C-100009'); pg.wait_for_timeout(1200)
    t=pg.get_by_text('C-100009').first
    if t.count():
        t.click(); pg.wait_for_timeout(900)
        c=pg.locator('.dref-chip:visible', has_text='PID-100-03')
        if c.count(): HASFILE[0]=c.first.locator('.dref-file').count()>0; c.first.click(); land('PID-100-03','SU&C tag -> P&ID')
        else: rec('SU&C tag -> P&ID',False,'tag selected but no P&ID chip; chips='+str(pg.locator('.dref-chip:visible').all_inner_texts()[:6]))
    else: rec('SU&C tag -> P&ID',False,'tag not found in tree after search')
    # 5 ProCure VDRL open (PDF)
    go('/procure/index.html?vdrl=PO-DEMO-001-4001-PL-001#vdrl')
    pg.locator('button:visible',has_text='Open').first.click(); land('PO-DEMO-001-4001-PL-001','ProCure VDRL -> vendor doc','procure')
    # 6 ProCure VDRL attach
    go('/procure/index.html#vdrl'); a=pg.locator('#view-vdrl button:visible',has_text='Attach')
    if a.count():
        row=a.first.locator('xpath=ancestor::tr'); no=row.locator('td').first.inner_text().strip()
        a.first.click(); pg.wait_for_url(re.compile(r'/deng/'),timeout=8000); pg.wait_for_timeout(2800)
        rec('ProCure VDRL Attach -> DEng attach', no in pg.locator('#view-documents').inner_text(), no)
    # 7 ProCure MR engineering docs
    go('/procure/index.html#requisitions'); pg.locator('#view-requisitions table tbody tr:visible').first.click(); pg.wait_for_timeout(800)
    c=pg.locator('.dref-chip:visible').first; ttl=c.get_attribute('title'); no=re.search(r'(VR-[\w-]+)',ttl).group(1); HASFILE[0]=c.locator('.dref-file').count()>0; c.click(); land(no,'ProCure MR -> engineering doc','procure')
    # 8 FEED open
    go('/feed/index.html#deliverables'); b=pg.locator('#view-deliverables button:visible',has_text='Open')
    if b.count():
        row=b.first.locator('xpath=ancestor::tr'); no=re.search(r'VR-[\w-]+',row.inner_text()).group(0); b.first.click(); land(no,'FEED deliverable -> DEng','feed')
    else: rec('FEED deliverable -> DEng',False,'no Open button')
    # 9 RFI reference + spec
    go('/rfi/index.html?rfi=RFI-DEMO-001-002')
    cs=pg.locator('.dref-chip:visible'); txt=cs.all_inner_texts(); rec('RFI chips present',cs.count()>=2,str(txt))
    if cs.count():
        ttl=cs.first.get_attribute('title'); no=re.search(r'(VR-[\w-]+)',ttl).group(1); HASFILE[0]=cs.first.locator('.dref-file').count()>0; cs.first.click(); land(no,'RFI reference -> DEng (pin RFI)', 'rfi', want_viewer=False)
        go('/rfi/index.html?rfi=RFI-DEMO-001-002'); sp=pg.locator('.dref-chip:visible', has_text='SPS')
        if sp.count():
            ttl=sp.first.get_attribute('title'); no=re.search(r'(SPS-[\w-]+|VR-[\w-]+|[\w-]*\d[\w-]*)',ttl.split(' ',1)[1]).group(1); HASFILE[0]=sp.first.locator('.dref-file').count()>0; sp.first.click(); land(no.strip(),'RFI spec section -> DEng',want_viewer=False)
        else: rec('RFI spec section -> DEng',False,'no SPS chip')
    # 10 Change MOC add document, persist, open
    go('/change/index.html?moc=MOC-DEMO-001-001')
    e=pg.locator('button:visible',has_text='Edit documents')
    if e.count():
        e.first.click(); pg.wait_for_timeout(500)
        pg.locator('.dref-add button',has_text='Other document').click(); pg.locator('.dref-n').last.fill('VR-STD-PIP-001'); pg.locator('.dref-n').last.dispatch_event('change'); pg.wait_for_timeout(300)
        hint=pg.locator('.dref-hint').last.inner_text(); pg.locator('.modal button',has_text='Save').click(); pg.wait_for_timeout(800)
        pg.reload(); pg.wait_for_timeout(2500)
        go('/change/index.html?moc=MOC-DEMO-001-001')
        c=pg.locator('.dref-chip:visible',has_text='VR-STD-PIP-001'); rec('MOC document saved and persists', c.count()>0, hint)
        if c.count(): HASFILE[0]=c.first.locator('.dref-file').count()>0; c.first.click(); land('VR-STD-PIP-001','MOC -> standard','change')
    else: rec('MOC Edit documents',False,'button missing')
    # 11 PreCon bid package
    go('/precon/index.html'); 
    for t in pg.locator('#tabs button').all_inner_texts():
        if 'ontract' in t or 'Bid' in t: pg.locator('#tabs button',has_text=t).first.click(); break
    pg.wait_for_timeout(1200)
    rows=pg.locator('table tbody tr:visible')
    if rows.count(): rows.first.click(); pg.wait_for_timeout(800)
    e=pg.locator('button:visible',has_text='Edit bid documents')
    if e.count():
        e.first.click(); pg.wait_for_timeout(500)
        pg.locator('.dref-add button',has_text='Other document').click(); pg.locator('.dref-n').last.fill('VR-DEMO-001-PM-PRC-0001'); pg.wait_for_timeout(200)
        pg.locator('.modal button',has_text='Save').click(); pg.wait_for_timeout(800)
        c=pg.locator('.dref-chip:visible',has_text='PRC-0001'); rec('PreCon bid document saved',c.count()>0)
        if c.count(): HASFILE[0]=c.first.locator('.dref-file').count()>0; c.first.click(); land('VR-DEMO-001-PM-PRC-0001','PreCon bid package -> procedure','precon')
    else: rec('PreCon Edit bid documents',False,'not found on '+pg.url)
    # 12 AWP IWP
    go('/awp/index.html?iwp=IWP-0006'); c=pg.locator('.dref-chip:visible').first
    if c.count(): ttl=c.get_attribute('title'); no=re.search(r'(VR-[\w-]+)',ttl).group(1); HASFILE[0]=c.locator('.dref-file').count()>0; c.click(); land(no,'AWP IWP -> drawing','awp')
    # 13 Estimating (line detail), planner and TAR (editor Open button / action bar)
    def esc():
        for _ in range(2): pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
    def try_rows(mod):
        go(f'/{mod}/index.html'); esc()
        for ti in range(pg.locator('#tabs button').count()):
            esc(); pg.locator('#tabs button').nth(ti).click(); pg.wait_for_timeout(700)
            rows=pg.locator('table tbody tr:visible')
            for i in range(min(rows.count(),40)):
                try: rows.nth(i).click(timeout=1000); pg.wait_for_timeout(150)
                except Exception: esc(); continue
                c=pg.locator('.dref-chip:visible:not(.dref-unregistered):not(.dref-external)')
                if c.count(): return c.first
        return None
    c=try_rows('estimating')
    if c:
        ttl=c.get_attribute('title'); no=re.search(r'(VR-[\w-]+)',ttl).group(1); HASFILE[0]=c.locator('.dref-file').count()>0; c.click(); land(no,'Estimating takeoff line -> DEng','estimating')
    else: rec('Estimating takeoff line -> DEng',False,'no chip found')
    # Construction: the first visit asks which P6 mode to load into; confirm it,
    # then add a registered drawing to a workstep and open it from the editor.
    go('/planner/index.html')
    if pg.locator('button.mode-card').count():
        pg.locator('button.mode-card').first.click()
        pg.locator('.modal button', has_text='Confirm mode').click(); pg.wait_for_timeout(1500)
    b=pg.locator('button.dref-cell:visible')
    rec('Planner drawings cells present', b.count()>0, str(b.count()))
    b.first.click(); pg.wait_for_timeout(400)
    if not pg.locator('.dref-n').count():
        pg.locator('.dref-add button').first.click()
        pg.locator('.dref-n').last.fill('VR-DEMO-001-PRO-PID-0001'); pg.wait_for_timeout(200)
        pg.locator('.modal button', has_text='Save').click(); pg.wait_for_timeout(600)
        b.first.click(); pg.wait_for_timeout(400)
    o=pg.locator('.dref-o:visible')
    if o.count():
        no=pg.locator('.dref-n').first.input_value(); HASFILE[0]=None; o.first.click()
        land(no,'Planner workstep editor Open -> DEng','planner')
    else: rec('Planner workstep editor Open -> DEng',False,'no Open button in the editor')
    # TAR: the worklist is on its own tab; the selected item's drawings show on the action bar.
    go('/tar/index.html'); esc()
    pg.locator('#tabs button', has_text='Worklist').first.click(); pg.wait_for_timeout(1000)
    pg.locator('table tbody tr:visible').first.click(); pg.wait_for_timeout(500)
    ch=pg.locator('.dref-chip:visible')
    rec('TAR worklist action bar shows drawing chips', ch.count()>0, str([x.replace(chr(10),' ') for x in ch.all_inner_texts()[:3]]))
    # 14 non-PDF download from chip
    go('/deng/index.html?doc=VR-DEMO-001-ELE-CSH-0001#documents'); pg.wait_for_timeout(1500); rec('xlsx doc deep link downloads', any(x.endswith('.xlsx') for x in dls), str(dls))
    # 15 unknown doc deep link
    go('/deng/index.html?doc=NOPE-123#documents'); rec('unknown doc shows message','not in the document repository' in pg.locator('body').inner_text())
    rec('no page errors', not errs, str(errs[:5]))
    br.close()
print('\nSUMMARY', sum(1 for r in RES if r[1]),'/',len(RES))
sys.exit(0 if all(r[1] for r in RES) else 1)
