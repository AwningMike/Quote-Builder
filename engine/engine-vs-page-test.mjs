// Cross-check the headless engine against a page run captured by page-forms-test.cjs:
//   node engine/page-forms-test.cjs canopy_quote_calculator.html /tmp/forms.json
//   node engine/engine-vs-page-test.mjs /tmp/forms.json
// 1) priceItem(item) must reproduce amount/labor/... for every line the page built (18 lines)
// 2) importTakeoff(TAKEOFF) must produce the same lines (title, sub, group, $, spec) as the page's import
// 3) computeTotals(state) must equal the page's lastQuoteSummary for the captured extras
import fs from 'node:fs';
import { priceItem, importTakeoff, computeTotals, applyMargin, marginSummary } from './quote-engine.js';

const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let fails = 0;
const eq = (a,b) => JSON.stringify(a) === JSON.stringify(b);

// 1) re-price every page-built line from its spec
for(const it of run.items){
  const p = priceItem(it); delete p._r; delete p.passthrough;
  for(const k of Object.keys(p)){
    if(k === 'bd'){ if(!eq(p.bd, it.bd)){ fails++; console.log('BD', it.title, JSON.stringify(it.bd), '\n   ', JSON.stringify(p.bd)); } continue; }
    if(p[k] !== it[k]){ fails++; console.log('ITEM', it.title, k, 'page', it[k], 'engine', p[k]); }
  }
}
console.log(`1) priceItem round-trip: ${run.items.length} page-built lines re-priced from spec — ${fails} mismatches`);

// 2) headless import vs page import (the page imported TAKEOFF first, so its first N items are the import)
const TAKEOFF = JSON.parse(fs.readFileSync(new URL('./page-forms-test.cjs', import.meta.url), 'utf8').match(/const TAKEOFF = (\{[\s\S]*?\n\});/)[1].replace(/(\w+):/g, '"$1":').replace(/'/g, '"'));
const eng = importTakeoff(TAKEOFF, { startId: 1 });
const pageImported = run.items.slice(0, eng.items.length);
let f2 = 0;
eng.items.forEach((e, i) => {
  const pg = pageImported[i];
  for(const k of ['title','sub','group','amount','labor','paintCost','downspoutCost','downspoutQty','lightsCost','lightsQty','postsCost','postsQty','faceInches','lineGroup','ownLine','type','takeoffNote']){
    if(!eq(e[k] === undefined ? null : e[k], pg[k] === undefined ? null : pg[k])){ f2++; console.log('IMPORT', i, k, 'page', JSON.stringify(pg[k]), 'engine', JSON.stringify(e[k])); }
  }
  if(!eq(e.bd, pg.bd)){ f2++; console.log('IMPORT bd', i, JSON.stringify(pg.bd), '\n   ', JSON.stringify(e.bd)); }
  // spec: every key the page saved must match (engine may carry extra keys like widthIn)
  for(const sk of Object.keys(pg.spec || {})){
    const a = pg.spec[sk], b = e.spec[sk];
    if(sk === 'legs' && Array.isArray(a)){ a.forEach((la, j) => { for(const lk of Object.keys(la)) if(!eq(la[lk], b[j][lk])){ f2++; console.log('IMPORT leg', i, j, lk, la[lk], b[j][lk]); } }); continue; }
    if(!eq(a === undefined ? null : a, b === undefined ? null : b)){ f2++; console.log('IMPORT spec', i, sk, 'page', JSON.stringify(a), 'engine', JSON.stringify(b)); }
  }
});
if(!eq(eng.added, run.importResult.added) || !eq(eng.skipped, run.importResult.skipped) || !eq(eng.warnings, run.importResult.warnings) || !eq(eng.info, run.importResult.info)){ f2++; console.log('IMPORT report differs', JSON.stringify(eng), JSON.stringify(run.importResult)); }
console.log(`2) importTakeoff headless vs page: ${eng.items.length} lines — ${f2} mismatches (added/skipped/warnings/info ${eq(eng.added, run.importResult.added)&&eq(eng.skipped, run.importResult.skipped)&&eq(eng.info, run.importResult.info) ? 'match' : 'DIFFER'})`);
console.log('   header from takeoff:', JSON.stringify(eng.hdr), 'extras:', JSON.stringify(eng.extraVals), JSON.stringify(eng.extraChecks));

// 3) totals from the captured state (page's last renderQuote = delivery-only variant)
const st = run.state;
const T = computeTotals(st.items, { extraVals: st.extraVals, extraChecks: st.extraChecks });
const s = run.totalsDeliveryOnly;
let f3 = 0;
for(const k of Object.keys(s)) if(k !== 'hasNonCanopy' && T[k] !== s[k]){ f3++; console.log('TOTALS', k, 'page', s[k], 'engine', T[k]); }
console.log(`3) computeTotals vs page lastQuoteSummary: ${f3} mismatches (total ${T.total} vs ${s.total})`);
// 4) "Set to 3x": engine applyMargin(items, 3) vs the page's setPriceToMultiple(3)
let f4 = 0;
if(run.itemsAfter3x){
  const r = applyMargin(run.items, 3);
  r.items.forEach((e, i) => { const pg = run.itemsAfter3x[i]; if(e.amount !== pg.amount){ f4++; console.log('3x', e.title, 'page', pg.amount, 'engine', e.amount); } });
  const T3 = computeTotals(r.items, { extraVals: st.extraVals, extraChecks: st.extraChecks });
  if(T3.total !== run.totalsAfter3x.total){ f4++; console.log('3x total page', run.totalsAfter3x.total, 'engine', T3.total); }
  const ms = marginSummary(r.items);
  console.log(`4) applyMargin(items, 3) vs page Set-to-3x: ${r.items.filter(i=>i.type==='canopy').length} canopy lines — ${f4} mismatches (material $${ms.mat.toFixed(2)}, sell ex-paint $${ms.sell}, multiple ${ms.mult.toFixed(4)}x, total ${T3.total})`);
}
process.exit(fails + f2 + f3 + f4 ? 1 : 0);
