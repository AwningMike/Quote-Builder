// Drives the calculator FORMS (not restoreQuoteState) so the compute*/add*ToQuote paths
// are exercised end to end, then dumps the resulting quote items + totals.
// Usage: node engine/page-forms-test.cjs <page.html> [out.json]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const ROOT = path.resolve(__dirname, '..');
function freePort(){ return new Promise(res=>{ const s=net.createServer(); s.listen(0,()=>{ const p=s.address().port; s.close(()=>res(p)); }); }); }
const wait = ms => new Promise(r=>setTimeout(r,ms));

// A synthetic APMG_TAKEOFF exercising mitered legs, leg taper, single taper, custom fascia,
// 6"/10" faces, lights/downspouts/posts, line groups, fabric (with posts) and a skipped type.
const TAKEOFF = {
  format:'APMG_TAKEOFF', version:1,
  job:{ projectName:'Engine Test Job', projectNo:'T-1', gc:'Test GC', shipName:'Test Ship', address:'1 Main St', cityStateZip:'Columbus, OH 43215', state:'OH', county:'Franklin County', color:'Bronze', bidDue:'11/15/2026', customer:{ company:'ACME', name:'Jane', email:'j@acme.test', phone:'555' } },
  canopies:[
    { mark:'C1', name:'Entry', sheet:'A201', face:8, widthIn:127.4, projIn:42.6, qty:2, lights:2, downspouts:1, posts:1, attach:'cchannel', arms:4, paint:'Black', blocking:'masonry', confidence:'high', notes:'dim' },
    { mark:'C2', name:'Taper', face:6, widthIn:200, projIn:36, projEndIn:60, qty:1 },
    { mark:'C3', name:'Big', face:16, widthIn:500, projIn:90, qty:1, lights:5, group:'Bldg A' },
    { mark:'C4', name:'Ten', face:10, widthIn:150, projIn:48, qty:3, lineGroup:'Lease' },
    { mark:'C5', name:'Miter', face:12, legs:[{widthIn:240,projIn:48},{widthIn:120,projIn:48,projCornerIn:36},{widthIn:96,projIn:48}], qty:1, downspouts:2 },
    { mark:'C6', name:'Seven', face:7, widthIn:100, projIn:30 },
    { mark:'F1', name:'Fab', type:'fabric', widthIn:140, projIn:36, heightIn:24, qty:2, posts:2, group:'Bldg B', sheet:'A202' },
    { mark:'X1', name:'Skip', type:'sunshade', widthIn:100, projIn:50 },
    { mark:'C7', name:'NoProj', face:8, widthIn:100 }
  ],
  warnings:['w1']
};

(async()=>{
  const pageFile = process.argv[2] || 'canopy_quote_calculator.html';
  const port = await freePort();
  const srv = spawn('python3', ['-m','http.server', String(port), '--bind','127.0.0.1'], { cwd: ROOT, stdio:'ignore' });
  await wait(800);
  let browser;
  try { browser = await chromium.launch({ headless:true }); }
  catch(e){ browser = await chromium.launch({ headless:true, executablePath:'/usr/bin/google-chrome', args:['--no-sandbox'] }); }
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e=>errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r=>r.abort());
  await page.goto(`http://127.0.0.1:${port}/${pageFile}`, { waitUntil:'load' });
  await page.evaluate(()=>{ window.alert=()=>{}; window.confirm=()=>true; });

  const out = await page.evaluate(async (tk)=>{
    const setFtIn=(p,inches)=>{ const t=Math.round(inches); document.getElementById(p+'-ft').value=Math.floor(t/12); document.getElementById(p+'-in').value=t%12; };
    const set=(id,v)=>{ const el=document.getElementById(id); el.value=v; el.dispatchEvent(new Event('input')); };
    const chk=(id,on)=>{ const el=document.getElementById(id); el.checked=on; el.dispatchEvent(new Event('change')); };
    const res = {};
    // 1) takeoff import through the page
    const r = importTakeoff(tk);
    res.importResult = { added:r.added, skipped:r.skipped, warnings:r.warnings, info:r.info };
    // 2) hand-entered canopy with c-channel perimeter, outriggers, manual fascia, paint off, custom fascia
    activeTab='canopy12'; buildTabs(); renderCalc();
    setFtIn('c-width', 300); setFtIn('c-proj', 70); set('c-qty', 2); set('c-lights', 1); set('c-downspout', 2); set('c-posts', 3); set('c-outrigger', 4); set('c-fascia', 125);
    chk('c-cchannel-perimeter', true); chk('c-paint9', false); chk('c-customface-toggle', true); set('c-customface-in', 18);
    document.getElementById('c-name').value='Hand 12'; document.getElementById('c-add-btn').click();
    res.handBreakdown12 = document.getElementById('c-breakdown').innerText;
    res.tierOut12 = document.getElementById('tier-out').innerText;
    // 3) 8" tab, 6" face, manual c-channel, outriggers
    activeTab='canopy8'; buildTabs(); renderCalc();
    document.getElementById('c-facesize').value='6';
    setFtIn('c-width', 90); setFtIn('c-proj', 30); set('c-cchannel', 12.5); set('c-outrigger', 2);
    document.getElementById('c-add-btn').click();
    res.handBreakdown8 = document.getElementById('c-breakdown').innerText;
    // 4) patio canopy + railing
    activeTab='patio'; buildTabs(); renderCalc();
    setFtIn('p-width', 240); setFtIn('p-proj', 120); set('p-qty', 2); set('p-mfg', 4000); set('p-install', 900); set('p-lights', 2); set('p-downspout', 1); set('p-posts', 4);
    res.patioBreakdown = document.getElementById('p-breakdown').innerText;
    document.getElementById('p-add-btn').click();
    patioProduct='railing'; renderPatioForm();
    setFtIn('p-len', 300); set('p-height', 42); set('p-qty', 3); set('p-mfg', 1500); set('p-install', 300);
    res.railingBreakdown = document.getElementById('p-breakdown').innerText;
    document.getElementById('p-add-btn').click();
    // 5) standing seam
    activeTab='standingSeam'; buildTabs(); renderCalc();
    setFtIn('ss-width', 127); setFtIn('ss-proj', 36); setFtIn('ss-height', 42); setFtIn('ss-valance', 18); set('ss-ends', 2); set('ss-qty', 3);
    res.ssBreakdown = document.getElementById('ss-breakdown').innerText;
    addStandingSeamToQuote();
    // 6) fabric per-ft with posts, and sqft mode
    activeTab='fabric'; buildTabs(); renderCalc();
    setFtIn('fb-width', 104); setFtIn('fb-proj', 48); setFtIn('fb-height', 24); set('fb-qty', 4); chk('fb-posts-on', true); set('fb-posts', 3); set('fb-signpanel', 12);
    res.fbBreakdown = document.getElementById('fb-breakdown').innerText;
    addFabricToQuote();
    document.getElementById('fb-pricemode').value='sqft'; computeFabric();
    res.fbBreakdownSqft = document.getElementById('fb-breakdown').innerText;
    addFabricToQuote();
    // 7) sunshade normal + patio
    activeTab='sunshade'; buildTabs(); renderCalc();
    setFtIn('sh-width', 150); setFtIn('sh-proj', 66);
    res.shBreakdown = document.getElementById('sh-breakdown').innerText;
    addSunshadeToQuote();
    chk('sh-patio', true); addSunshadeToQuote();
    // 8) recover: yardage mode with everything on, then patio mode
    activeTab='recover'; buildTabs(); renderCalc();
    setFtIn('rc-width', 180); setFtIn('rc-height', 30); setFtIn('rc-proj', 42); set('rc-passes', 2); set('rc-ends', 2); set('rc-qty', 2);
    document.getElementById('rc-fabric').value='ferrari'; set('rc-g1', 1); set('rc-g2', 1);
    chk('rc-takedown-on', true); chk('rc-skin-on', true); chk('rc-skin-ends', true); chk('rc-retrofit-on', true); set('rc-delivery', 2); set('rc-survey', 450);
    res.rcBreakdown = document.getElementById('rc-breakdown').innerText;
    addRecoverToQuote();
    chk('rc-patio', true); addRecoverToQuote();
    // 9) job extras: Ohio county (set by takeoff), lift, stamped, survey, miles far + near, delivery-only
    set('extra-lift', 1500); chk('extra-stamped-on', true); chk('extra-survey-on', true); set('extra-survey', 500);
    set('extra-miles', 300); renderQuote(); res.totalsFar = JSON.parse(JSON.stringify(lastQuoteSummary, (k,v)=>k==='groups'?undefined:v));
    res.milesStatusFar = document.getElementById('extra-miles-status').innerText;
    set('extra-miles', 90); renderQuote(); res.totalsNear = JSON.parse(JSON.stringify(lastQuoteSummary, (k,v)=>k==='groups'?undefined:v));
    res.milesStatusNear = document.getElementById('extra-miles-status').innerText;
    document.getElementById('extra-ohio-county').value='0'; chk('extra-tax', true); renderQuote(); res.totalsIN = JSON.parse(JSON.stringify(lastQuoteSummary, (k,v)=>k==='groups'?undefined:v));
    chk('extra-delivery-only', true); renderQuote(); res.totalsDeliveryOnly = JSON.parse(JSON.stringify(lastQuoteSummary, (k,v)=>k==='groups'?undefined:v));
    res.quotePanel = document.getElementById('quote-list').innerText;
    res.items = JSON.parse(JSON.stringify(quoteItems));
    res.state = captureQuoteState();
    // 10) margin check + "Set to 3x" (confirm is stubbed to true) + cut sheet
    res.marginCheckBefore = document.getElementById('mc-body').innerText;
    setPriceToMultiple(3);
    res.itemsAfter3x = JSON.parse(JSON.stringify(quoteItems)).map(i=>({id:i.id, type:i.type, amount:i.amount, paintCost:i.paintCost}));
    res.totalsAfter3x = JSON.parse(JSON.stringify(lastQuoteSummary, (k,v)=>k==='groups'?undefined:v));
    res.marginCheckAfter = document.getElementById('mc-body').innerText;
    openCostSheet(); res.costSheet = document.getElementById('cs-body').innerText;
    openPriceBook(); res.priceBook = document.getElementById('pb-body').innerText;
    return res;
  }, TAKEOFF);
  out.pageErrors = errors;
  await browser.close(); srv.kill();
  const outFile = process.argv[3];
  if(outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`${pageFile}: ${out.items.length} items, totalFar=${out.totalsFar.total} totalNear=${out.totalsNear.total} totalIN=${out.totalsIN.total} deliveryOnly=${out.totalsDeliveryOnly.total} after3x=${out.totalsAfter3x.total} errors=${errors.length}`);
})().catch(e=>{ console.error(e); process.exit(1); });
