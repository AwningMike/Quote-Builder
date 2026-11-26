/* C-channel and the Chipotle rule in the worker's pricing path.
   A canopy carried as attach "cchannel" is priced with full-perimeter C-channel (W + 2P), the same as
   ticking "C-Channel auto - full perimeter" on the page. Chipotle canopies never get C-channel. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceTakeoff, isChipotle } from '../src/quote.js';
import { importTakeoff, applyMargin } from '../../engine/quote-engine.js';
import { airtableHealth } from '../src/airtable.js';
import { fakeFetch, ENV, NOW } from './helpers.mjs';

const tk = (name, attach) => ({ format: 'APMG_TAKEOFF', version: 1,
  job: { projectName: name, shipName: name, state: 'IN', cityStateZip: 'Indianapolis, IN 46202' },
  canopies: [{ mark: 'C1', name: 'Storefront canopy', type: 'canopy', qty: 2, face: 8, widthIn: 240, projIn: 48, attach }] });

test('attach "cchannel" prices full-perimeter C-channel: (20 + 2 x 4) ft = 28 lin ft per unit, x2 units', async () => {
  const withC = await priceTakeoff(tk('Dutch Bros - Avon, IN', 'cchannel'), { miles: 10 }, ENV, { now: NOW });
  const noC = await priceTakeoff(tk('Dutch Bros - Avon, IN', 'tierod'), { miles: 10 }, ENV, { now: NOW });
  const line = withC.items[0];
  assert.equal(line.spec.cchannelPerimeter, true);
  assert.equal(Math.round(line.bd.cchannelFt), 56);
  void noC;
  // margin first, then C-channel on top at the rate card $30/ft: 56 ft x $30 = $1,680 more than the margined line
  const base = applyMargin(importTakeoff(tk('Dutch Bros - Avon, IN', 'cchannel')).items, 3.25).items[0].amount;
  assert.equal(line.bd.cchannelCost, 56 * 30);
  assert.equal(line.amount, base + 56 * 30);
  assert.ok(withC.steps.some(s => /C-channel on .*56 lin ft.*\+\$1,680/.test(s)));
});

test('Chipotle: C-channel attachment is removed and warned, never priced', async () => {
  const r = await priceTakeoff(tk('Chipotle - Huber Heights, OH', 'cchannel'), { miles: 10 }, ENV, { now: NOW });
  const line = r.items[0];
  assert.notEqual(line.spec.attach, 'cchannel');
  assert.equal(line.spec.cchannelPerimeter, false);
  assert.equal(Math.round((line.bd && line.bd.cchannelFt) || 0), 0);
  assert.ok(r.warnings.some(w => /Chipotle canopies never get C-channel/.test(w)));
});

test('isChipotle matches the project or ship-to name only', () => {
  assert.equal(isChipotle(tk('CHIPOTLE #4120 - Dry Ridge, KY')), true);
  assert.equal(isChipotle(tk('Wawa #7615 - Louisville, KY')), false);
});

test('deep health: reports whether the Airtable token can read the base', async () => {
  const ok = await airtableHealth(ENV, { fetch: fakeFetch([{ method: 'GET', match: 'tbluonHEUpfEp64Ze', respond: { records: [] } }]) });
  assert.deepEqual(ok, { ok: true });
  const bad = await airtableHealth(ENV, { fetch: fakeFetch([{ method: 'GET', match: 'tbluonHEUpfEp64Ze', respond: { __status: 401, error: { type: 'AUTHENTICATION_REQUIRED' } } }]) });
  assert.equal(bad.ok, false); assert.equal(bad.status, 401);
});
