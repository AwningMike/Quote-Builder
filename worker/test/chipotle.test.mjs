/* (b) End-to-end: the Chipotle (Shell) - Dry Ridge, KY quote (recUJElazgmmRxcWx) rebuilt as a
   takeoff and run through the worker's pricing path, compared to the dollars Mike saved.

   The saved quote: margin 3×, lift $750, survey on ($500), stamped off, extra-miles "288".
   "288" is the ROUND-TRIP box value (the page stores Math.round(oneWay*2); Dry Ridge KY is
   ~144 mi from the shop one-way) -> delivery = ceil(144 × $4.25) = $612. Sale Price 9,734:
     2 × 2,973 canopy + 2 × 275 lights = 6,496 materials
     2 × 688 labor + 612 delivery        = 1,988 installation
     survey 500 + lift 750               -> 9,734  ✓ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMargin, importTakeoff, computeTotals } from '../../engine/quote-engine.js';
import { priceTakeoff } from '../src/quote.js';
import { loadFixture, fixtureToTakeoff, ENV, NOW } from './helpers.mjs';

const fx = loadFixture('recUJElazgmmRxcWx');
const takeoff = fixtureToTakeoff(fx, { warnings: ['Chipotle standard: face 6, no C-channel.'] });
takeoff.job.county = 'Grant';

test('Chipotle takeoff rebuild matches the saved spec (6" face, 10\'-7" × 3\'-6", 1 light each)', () => {
  assert.equal(takeoff.canopies.length, 2);
  takeoff.canopies.forEach(c => { assert.equal(c.face, 6); assert.equal(c.widthIn, 127); assert.equal(c.projIn, 42); assert.equal(c.lights, 1); assert.equal(c.downspouts, 0); });
  const imp = importTakeoff(takeoff);
  imp.items.forEach((it, k) => {
    const sv = fx.state.items[k];
    assert.equal(it.spec.widthStr, sv.spec.widthStr); assert.equal(it.spec.projStr, sv.spec.projStr);
    assert.equal(it.faceInches, 6); assert.equal(it.spec.cchannelPerUnit, 0);
    assert.equal(it.labor, sv.labor); assert.equal(it.lightsCost, sv.lightsCost); assert.equal(it.paintCost, sv.paintCost);
  });
});

test('3× margin, lift 750, survey on, 144 mi one-way (= saved 288 round trip): lines and total match the saved quote to the dollar', async () => {
  const r = await priceTakeoff(takeoff, { margin: 3, lift: 750, survey: true, miles: 144 }, ENV, { now: NOW });
  assert.equal(r.margin, 3);
  assert.equal(r.state.extraVals['extra-miles'], fx.state.extraVals['extra-miles']);   // "288"
  assert.equal(r.state.extraVals['extra-lift'], '750');
  r.items.forEach((it, k) => assert.equal(it.amount, fx.state.items[k].amount, `line ${k + 1} amount`));   // 2973, 2973
  assert.equal(r.totals.deliveryCost, 612);
  assert.equal(r.totals.installation, 1988);
  assert.equal(r.totals.taxableMaterials, 6496);
  assert.equal(r.totals.total, fx.salePrice);   // 9734
  // and computeTotals over the SAVED state gives the same number (same math both sides)
  const saved = computeTotals(fx.state.items, { extraVals: fx.state.extraVals, extraChecks: fx.state.extraChecks });
  assert.equal(saved.total, r.totals.total);
  // Kentucky: no auto tax, flagged
  assert.equal(r.totals.taxOn, false);
  assert.ok(r.warnings.some(w => /KY job — no tax set/.test(w)));
  // header as the page would have it
  assert.equal(r.state.hdr['hdr-projname'], 'Chipotle (Shell) - Dry Ridge, KY');
  assert.equal(r.state.hdr['hdr-address2'], 'Dry Ridge, KY 41035');
  assert.equal(r.state.hdr['hdr-projno'], 'BCP002');
  assert.equal(r.state.hdr['hdr-to'], 'Brent Anderson');
  assert.equal(r.state.extraVals['extra-color'], 'Black (match storefront)');
});

test('standing rule: lift 1500 instead of the saved 750 -> total is exactly +750 (10,484)', async () => {
  const r = await priceTakeoff(takeoff, { margin: 3, miles: 144 }, ENV, { now: NOW });   // lift defaults from env (1500), survey defaults on
  assert.equal(r.state.extraVals['extra-lift'], '1500');
  assert.equal(r.totals.lift, 1500);
  assert.equal(r.totals.total, fx.salePrice + 750);   // 10484
  r.items.forEach((it, k) => assert.equal(it.amount, fx.state.items[k].amount));
});

test('if "288" were taken as ONE-WAY the total would be 10,346 at lift 750 (documented delta: delivery 1,224 vs 612)', async () => {
  const r = await priceTakeoff(takeoff, { margin: 3, lift: 750, miles: 288 }, ENV, { now: NOW });
  assert.equal(r.state.extraVals['extra-miles'], '576');
  assert.equal(r.totals.deliveryCost, Math.ceil(288 * 4.25));   // 1224
  assert.equal(r.totals.total, fx.salePrice + (1224 - 612));    // 10346
});

test('3.25× (new default): canopy lines re-snap to material × 3.25; total == direct engine math', async () => {
  const r = await priceTakeoff(takeoff, { lift: 750, miles: 144 }, ENV, { now: NOW });
  assert.equal(r.margin, 3.25);
  const imp = importTakeoff(takeoff);
  const m = applyMargin(imp.items, 3.25);
  assert.ok(m.ok);
  r.items.forEach((it, k) => assert.equal(it.amount, m.items[k].amount));
  const direct = computeTotals(m.items, { extraVals: r.state.extraVals, extraChecks: r.state.extraChecks });
  assert.equal(r.totals.total, direct.total);
  const r3 = await priceTakeoff(takeoff, { margin: 3, lift: 750, miles: 144 }, ENV, { now: NOW });
  assert.ok(r.totals.total > r3.totals.total, '3.25× sells for more than 3×');
  // material × 0.25 ≈ the uplift (rounded to the dollar across 2 lines)
  assert.ok(Math.abs((r.totals.total - r3.totals.total) - m.mat * 0.25) <= 1);
  assert.ok(r.steps.some(s => /margin 3\.25×/.test(s)));
});
