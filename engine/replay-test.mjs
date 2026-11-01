// Replay test: re-price every saved Quote Builder State fixture through the headless
// engine and compare against the dollars that were saved with the quote.
//
//   node engine/replay-test.mjs            -> table + per-item mismatch detail
//   node engine/replay-test.mjs --json     -> machine-readable result on stdout
//
// Fixtures: engine/fixtures/rec*.json — pulled (read-only) from the old APMG Projects
// base (appHEn1othbGBQEMc / tbl0xMHhBBN2k64aU): Quote Builder State (fld6FjuUbTeTrUaHk),
// Sale Price (fldk1MFcMie7OXiq6) and Name (fldi6oZ93a30ob48U).
//
// Three comparisons per quote:
//   1) item amount  — priceItem(item).amount vs item.amount saved on the line
//   2) item labor   — priceItem(item).labor  vs item.labor
//   3) job total    — computeTotals(items, extras).total vs Airtable Sale Price
// Items are re-priced from their SPEC only (sizes/options), never from the saved dollars.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { priceItem, computeTotals, priceCanopy, CONST } from './quote-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(here, 'fixtures');
const asJson = process.argv.includes('--json');
const files = fs.readdirSync(FIX).filter(f=>/^rec.*\.json$/.test(f)).sort();

const rows = [], detail = [], bdChecks = { ok:0, total:0 };
for(const f of files){
  const fx = JSON.parse(fs.readFileSync(path.join(FIX,f),'utf8'));
  const st = fx.state;
  let matched = 0, maxDiff = 0, laborMismatch = 0;
  const repriced = [];
  for(const item of st.items){
    const p = priceItem(item);
    const dAmt = p.amount - item.amount;
    const dLab = (p.labor||0) - (item.labor||0);
    if(dAmt === 0 && dLab === 0) matched++;
    if(dLab !== 0) laborMismatch++;
    maxDiff = Math.max(maxDiff, Math.abs(dAmt));
    if(item.type === 'canopy' && item.bd){
      // Rate-card check: the engine's unrounded component breakdown must equal the `bd`
      // breakdown saved with the line (mfg, c-channel, outriggers, fascia, sqft, labor ft).
      const r = priceCanopy(item.spec);
      const bdSaved = item.bd, bdEng = r.bd;
      const close = (a,b)=>Math.abs((a||0)-(b||0)) < 1e-6;
      const bdOk = close(bdSaved.mfg,bdEng.mfg) && close(bdSaved.cchannelCost,bdEng.cchannelCost) && close(bdSaved.outriggerCost,bdEng.outriggerCost)
                && close(bdSaved.fasciaCost,bdEng.fasciaCost) && close(bdSaved.sqft,bdEng.sqft) && close(bdSaved.laborFt,bdEng.laborFt) && close(bdSaved.labor,bdEng.labor);
      bdChecks.total++; if(bdOk) bdChecks.ok++;
      else detail.push({ job: fx.name, item: `#${item.id} ${item.title}`, type:'canopy bd', saved: JSON.stringify(bdSaved), engine: JSON.stringify(bdEng), diff:'BD MISMATCH', why:'rate-card breakdown differs' });
    }
    if(dAmt !== 0 || dLab !== 0){
      let why = '';
      if(item.type === 'canopy' && item.bd){
        const r = priceCanopy(item.spec);
        const base = item.bd.mfg + item.bd.cchannelCost + item.bd.outriggerCost + item.bd.fasciaCost;   // rate-card body, ex-paint
        const savedPaint = item.paintCost;
        const mult = base > 0 ? (item.amount - (savedPaint||0)) / base : 1;
        const notes = [];
        if(savedPaint === undefined && r.paintCost > 0) notes.push(`pre-09/16/26 quote: no $${CONST.PAINT_PER_SQFT}/sqft paint adder (engine adds $${Math.ceil(r.paintCost)})`);
        if(Math.abs(mult - 1) > 0.0015) notes.push(`amount overridden by margin-check "Set to N×": saved = rate card × ${mult.toFixed(3)}`);
        why = notes.join(' · ');
      }
      detail.push({ job: fx.name, item: `#${item.id} ${item.title}`, type: item.type, saved: item.amount, engine: p.amount, diff: dAmt, laborSaved: item.labor, laborEngine: p.labor, why });
    }
    repriced.push(Object.assign({}, item, p));
  }
  // job total with the SAVED line dollars (isolates the renderQuote math from line pricing)
  const totSaved = computeTotals(st.items, { extraVals: st.extraVals, extraChecks: st.extraChecks });
  // job total with the RE-PRICED line dollars (what the API would produce today)
  const totEngine = computeTotals(repriced, { extraVals: st.extraVals, extraChecks: st.extraChecks });
  rows.push({
    job: fx.name, record: fx.recordId, savedAt: st.savedAt.slice(0,10),
    items: `${matched}/${st.items.length}`, maxItemDiff: maxDiff,
    salePrice: fx.salePrice,
    totalSavedLines: totSaved.total, diffSavedLines: +(totSaved.total - fx.salePrice).toFixed(2),
    totalRepriced: totEngine.total, diffRepriced: +(totEngine.total - fx.salePrice).toFixed(2),
    miles: totSaved.miles, delivery: totSaved.deliveryCost, deliveryFlat: totSaved.deliveryFlat
  });
}

if(asJson){ console.log(JSON.stringify({ rows, detail }, null, 2)); process.exit(0); }

console.log('\nREPLAY — engine vs saved Quote Builder State (13 quotes)\n');
console.table(rows.map(r=>({ job: r.job, saved: r.savedAt, 'items ok': r.items, 'max item $diff': r.maxItemDiff,
  'Sale Price': r.salePrice, 'total (saved lines)': r.totalSavedLines, 'diff': r.diffSavedLines,
  'total (re-priced)': r.totalRepriced, 'diff ': r.diffRepriced, miles: r.miles, delivery: r.delivery })));
if(detail.length){
  console.log('\nItem mismatches (engine re-priced from spec vs $ saved on the line):\n');
  console.table(detail);
}
const exact = rows.filter(r=>r.maxItemDiff===0).length;
console.log(`\n${exact}/${rows.length} quotes: every line item re-priced to the exact saved amount.`);
console.log(`${bdChecks.ok}/${bdChecks.total} canopy lines: engine rate-card breakdown (mfg, c-channel, outriggers, fascia, sqft, labor) == saved bd exactly.`);
console.log('"total (saved lines)" = computeTotals() over the dollars saved on the lines; a non-zero diff there is');
console.log('job-level math that changed after the quote was saved (delivery rule) or a Sale Price edited by hand.');
