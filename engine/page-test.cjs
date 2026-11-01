// Headless page test: loads canopy_quote_calculator.html in Chromium, restores every
// fixture's Quote Builder State and reads lastQuoteSummary.total (+ per-item amounts).
// Usage: node engine/page-test.cjs [outfile.json]
// Serves the repo folder itself with python3 -m http.server on a free port.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');

function freePort(){ return new Promise(res=>{ const s=net.createServer(); s.listen(0,()=>{ const p=s.address().port; s.close(()=>res(p)); }); }); }
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

(async()=>{
  const port = await freePort();
  const srv = spawn('python3', ['-m','http.server', String(port), '--bind','127.0.0.1'], { cwd: ROOT, stdio:'ignore' });
  await wait(800);
  let browser;
  try { browser = await chromium.launch({ headless:true }); }
  catch(e){ browser = await chromium.launch({ headless:true, executablePath:'/usr/bin/google-chrome', args:['--no-sandbox'] }); }
  const page = await browser.newPage();
  page.on('pageerror', e=>console.error('PAGE ERROR:', e.message));
  // block external calls (airtable, geocoding, osrm) so the test is hermetic
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r=>r.abort());
  await page.goto(`http://127.0.0.1:${port}/canopy_quote_calculator.html`, { waitUntil:'load' });
  await page.evaluate(()=>{ window.alert=()=>{}; window.confirm=()=>true; });

  const files = fs.readdirSync(FIX).filter(f=>/^rec.*\.json$/.test(f)).sort();
  const out = {};
  for(const f of files){
    const fx = JSON.parse(fs.readFileSync(path.join(FIX,f),'utf8'));
    const r = await page.evaluate((st)=>{
      restoreQuoteState(st);
      const s = lastQuoteSummary;
      return { total:s.total, installation:s.installation, deliveryCost:s.deliveryCost, laborSubtotal:s.laborSubtotal,
        survey:s.survey, lift:s.lift, stamped:s.stamped, tax:s.tax, taxRatePercent:s.taxRatePercent,
        lightsTotal:s.lightsTotal, downspoutsTotal:s.downspoutsTotal, postsTotal:s.postsTotal,
        items: quoteItems.map(i=>({id:i.id, amount:i.amount, labor:i.labor})) };
    }, fx.state);
    out[fx.recordId] = { name: fx.name, salePrice: fx.salePrice, ...r };
    console.log(`${fx.recordId}  ${fx.name.padEnd(44)} page total=${r.total}  salePrice=${fx.salePrice}`);
  }
  await browser.close();
  srv.kill();
  const outFile = process.argv[2];
  if(outFile){ fs.writeFileSync(outFile, JSON.stringify(out,null,2)); console.log('wrote', outFile); }
})().catch(e=>{ console.error(e); process.exit(1); });
