/* (a) Pricing path vs the engine called directly, for every fixture whose lines the
   Import Takeoff path can take (canopy + fabric). Standing-seam-only fixtures are checked
   to be rejected cleanly (the page's Import Takeoff skips that type too). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importTakeoff, priceItem, applyMargin, computeTotals, canopyTrueCost } from '../../engine/quote-engine.js';
import { priceTakeoff, resolveMargin, QuoteError } from '../src/quote.js';
import { loadFixtures, fixtureToTakeoff, ENV, NOW } from './helpers.mjs';

const MFR = /\b(mapes|awnex|architectural fabrication|helios|uni-?structures|api canopies|victory|dittmer|metal-?tech\s+inc)\b/i;

for (const fx of loadFixtures()) {
  const takeoff = fixtureToTakeoff(fx);
  const importable = fx.state.items.some(i => i.type === 'canopy' || i.type === 'fabric');
  const miles = Math.round((parseFloat(fx.state.extraVals['extra-miles']) || 0) / 2);   // saved box is round trip

  if (!importable) {
    test(`${fx.name}: standing-seam-only fixture is rejected with 422 (not importable by takeoff)`, async () => {
      await assert.rejects(priceTakeoff(takeoff, { miles }, ENV, { now: NOW }), e => e instanceof QuoteError && e.status === 422);
    });
    continue;
  }

  test(`${fx.name}: worker pricing == importTakeoff + applyMargin + computeTotals (3.25× default)`, async () => {
    const r = await priceTakeoff(takeoff, { miles, lift: 1500, survey: true }, ENV, { now: NOW });
    // direct path
    const imp = importTakeoff(takeoff);
    const m = resolveMargin({}, ENV, imp.items);
    assert.equal(m, 3.25);
    assert.equal(r.margin, 3.25);
    const hasCanopy = imp.items.some(i => i.type === 'canopy');
    const direct = hasCanopy ? applyMargin(imp.items, m).items : imp.items;
    assert.equal(r.items.length, direct.length);
    r.items.forEach((it, k) => {
      assert.equal(it.amount, direct[k].amount, `${it.title} amount`);
      assert.equal(it.labor || 0, direct[k].labor || 0, `${it.title} labor`);
      // the rate-card line (pre-margin) must be exactly priceItem(spec)
      const p = priceItem(imp.items[k]);
      assert.equal(imp.items[k].amount, p.amount);
      assert.equal(it.spec.cchannelPerUnit || 0, 0, 'takeoff lines never carry C-channel');
      assert.ok(!MFR.test(it.title + ' ' + it.sub + ' ' + (it.group || '')), 'no manufacturer names in ' + it.title);
    });
    const tot = computeTotals(direct, { extraVals: r.state.extraVals, extraChecks: r.state.extraChecks });
    assert.equal(r.totals.total, tot.total);
    assert.equal(r.totals.deliveryCost, tot.deliveryCost);
    assert.equal(r.state.extraVals['extra-miles'], String(miles * 2));
    assert.equal(r.state.extraVals['extra-lift'], '1500');
    assert.equal(r.state.extraChecks['extra-survey-on'], true);
    assert.equal(r.state.extraChecks['extra-stamped-on'], false);
    assert.equal(r.state.hdr['hdr-terms'], '30% Down, Balance per Contract');
    assert.equal(r.state.hdr['hdr-company'], 'SA');
    assert.equal(r.state.hdr['hdr-date'], '11/1/2026');
    assert.equal(r.state.v, 1);
    assert.deepEqual(Object.keys(r.state.extraVals), ['extra-miles','extra-lift','extra-color','extra-ohio-county','extra-survey','extra-stamped']);
    assert.deepEqual(Object.keys(r.state.extraChecks), ['extra-survey-on','extra-stamped-on','extra-tax','extra-scupper','extra-individual-items','extra-delivery-only']);
    if (hasCanopy) {
      // canopy sell (ex paint, incl. downspouts) lands on material × 3.25 to the dollar
      let mat = 0, sell = 0;
      r.items.filter(i => i.type === 'canopy').forEach(i => { mat += canopyTrueCost(i.spec).material; sell += i.amount - (i.paintCost || 0) + (i.downspoutCost || 0); });
      assert.ok(Math.abs(sell - mat * 3.25) < 1, `sell ${sell} vs material×3.25 ${mat * 3.25}`);
    }
  });

  test(`${fx.name}: tax flags follow the state (IN 7% materials / OH county / other flagged)`, async () => {
    const r = await priceTakeoff(takeoff, { miles }, ENV, { now: NOW });
    const st = takeoff.job.state;
    if (st === 'IN') { assert.equal(r.state.extraChecks['extra-tax'], true); assert.equal(r.totals.taxRatePercent, 7); assert.equal(r.totals.taxAllLines, false); }
    else if (st === 'OH') { assert.ok(r.warnings.some(w => /Ohio job but county/.test(w)), 'no county in synthesized takeoff -> warn'); }
    else { assert.equal(r.totals.taxOn, false); assert.ok(r.warnings.some(w => new RegExp(st + ' job — no tax set').test(w)), 'other state flagged'); }
  });
}

test('Ohio county lookup sets the combined rate on all lines', async () => {
  const fx = loadFixtures().find(f => f.name.startsWith('Valvoline - Tiffin'));
  const takeoff = fixtureToTakeoff(fx);
  takeoff.job.county = 'Seneca';
  const r = await priceTakeoff(takeoff, { miles: 116 }, ENV, { now: NOW });
  assert.equal(r.state.extraVals['extra-ohio-county'], '7.25');
  assert.equal(r.totals.taxAllLines, true);
  assert.equal(r.totals.taxRatePercent, 7.25);
  assert.equal(r.totals.tax, Math.ceil(r.totals.taxBase * 0.0725));
});

test('resolveMargin: options > env var > 3.25 fallback', () => {
  assert.equal(resolveMargin({ margin: 3 }, ENV, []), 3);
  assert.equal(resolveMargin({ margin: '2.75' }, ENV, []), 2.75);
  assert.equal(resolveMargin({}, { DEFAULT_MARGIN: '3.5' }, []), 3.5);
  assert.equal(resolveMargin({}, {}, []), 3.25);
  assert.throws(() => resolveMargin({ margin: 0 }, ENV, []), /positive/);
});

test('miles: options.miles is one-way, extra-miles is round trip, delivery is one-way × $4.25 beyond 70', async () => {
  const fx = loadFixtures().find(f => f.name.startsWith('Chipotle'));
  const t = fixtureToTakeoff(fx);
  const far = await priceTakeoff(t, { miles: 144 }, ENV, { now: NOW });
  assert.equal(far.state.extraVals['extra-miles'], '288');
  assert.equal(far.totals.oneWayMi, 144);
  assert.equal(far.totals.deliveryCost, Math.ceil(144 * 4.25));
  const near = await priceTakeoff(t, { miles: 30 }, ENV, { now: NOW });
  assert.equal(near.totals.deliveryFlat, true);
  assert.equal(near.totals.deliveryCost, 250);
});

test('miles: geocoding path (stubbed Open-Meteo + OSRM) stores Math.round(oneWay*2)', async () => {
  const fx = loadFixtures().find(f => f.name.startsWith('Chipotle'));
  const t = fixtureToTakeoff(fx);
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    if (url.includes('geocoding-api.open-meteo.com')) return { json: async () => ({ results: [
      { name: 'Dry Ridge', admin1: 'Ohio', country_code: 'US', latitude: 1, longitude: 1 },
      { name: 'Dry Ridge', admin1: 'Kentucky', country_code: 'US', latitude: 38.68, longitude: -84.59 } ] }) };
    if (url.includes('router.project-osrm.org')) {
      assert.ok(url.includes('/driving/-86.1815,39.7893;-84.59,38.68'), 'routes from QB_SHOP to the Kentucky hit');
      return { json: async () => ({ code: 'Ok', routes: [{ distance: 143.6 * 1609.344 }] }) };
    }
    throw new Error('unexpected ' + url);
  };
  const r = await priceTakeoff(t, {}, ENV, { now: NOW, fetch: f });
  assert.equal(calls.length, 2);
  assert.equal(r.state.extraVals['extra-miles'], String(Math.round(143.6 * 2)));
  assert.ok(Math.abs(r.oneWayMiles - 143.6) < 1e-6);
});

test('To: is blank when the takeoff says 2+ GCs are bidding, or options.to === ""', async () => {
  const fx = loadFixtures().find(f => f.name.startsWith('Chipotle'));
  const t = fixtureToTakeoff(fx);
  t.job.to = 'Brent Anderson';
  const a = await priceTakeoff(t, { miles: 1 }, ENV, { now: NOW });
  assert.equal(a.state.hdr['hdr-to'], 'Brent Anderson');
  const b = await priceTakeoff(Object.assign({}, t, { warnings: ['Bid invites from 2 GCs (Derek Inc and Hotz) — same plans.'] }), { miles: 1 }, ENV, { now: NOW });
  assert.equal(b.state.hdr['hdr-to'], '');
  const c = await priceTakeoff(t, { miles: 1, to: '' }, ENV, { now: NOW });
  assert.equal(c.state.hdr['hdr-to'], '');
  const d = await priceTakeoff(t, { miles: 1, to: 'Someone Else' }, ENV, { now: NOW });
  assert.equal(d.state.hdr['hdr-to'], 'Someone Else');
});

test('validation: bad takeoffs get 4xx with a clear message', async () => {
  const bad = async (takeoff, opts, status, re) => {
    await assert.rejects(priceTakeoff(takeoff, opts || {}, ENV, { now: NOW }), e => e instanceof QuoteError && e.status === status && re.test(e.message));
  };
  await bad(null, {}, 400, /takeoff/);
  await bad({ format: 'SOMETHING', canopies: [] }, {}, 400, /format/);
  await bad({ format: 'APMG_TAKEOFF', version: 2, canopies: [] }, {}, 400, /version/);
  await bad({ format: 'APMG_TAKEOFF', version: 1 }, {}, 400, /canopies/);
  await bad({ format: 'APMG_TAKEOFF', version: 1, canopies: [] }, {}, 422, /empty/);
  await bad({ format: 'APMG_TAKEOFF', version: 1, canopies: [{ type: 'canopy', widthIn: 0 }] }, {}, 422, /No priceable/);
  await bad({ format: 'APMG_TAKEOFF', version: 1, canopies: [{ type: 'canopy', widthIn: 120, projIn: 48 }] }, { margin: -1 }, 400, /margin/);
  await bad({ format: 'APMG_TAKEOFF', version: 1, canopies: [{ type: 'canopy', widthIn: 120, projIn: 48 }] }, { recordId: 'nope' }, 400, /recordId/);
  await bad({ format: 'APMG_TAKEOFF', version: 1, canopies: [{ type: 'canopy', widthIn: 120, projIn: 48 }] }, { survey: 'yes' }, 400, /survey/);
});
