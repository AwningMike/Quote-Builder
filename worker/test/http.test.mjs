/* HTTP layer: auth, CORS, routing, error shapes — through the Worker's fetch handler with
   Node's built-in Request/Response. /price is used so no Airtable call is attempted. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { VERSION } from '../src/index.js';
import { loadFixture, fixtureToTakeoff, ENV } from './helpers.mjs';

const takeoff = fixtureToTakeoff(loadFixture('recUJElazgmmRxcWx'));
const req = (path, init) => worker.fetch(new Request('https://apmg-quote-service.example.workers.dev' + path, init), ENV, {});

test('GET /health', async () => {
  const r = await req('/health');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.version, VERSION); assert.match(j.engine, /^\d{2}\/\d{2}\/\d{2}$/);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://awningmike.github.io');
});

test('OPTIONS preflight allows the GitHub Pages origin', async () => {
  const r = await req('/quote', { method: 'OPTIONS', headers: { Origin: 'https://awningmike.github.io' } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://awningmike.github.io');
  assert.match(r.headers.get('Access-Control-Allow-Headers'), /Authorization/);
});

test('POST /quote without / with wrong bearer -> 401', async () => {
  const body = JSON.stringify({ takeoff, options: { miles: 144 } });
  assert.equal((await req('/quote', { method: 'POST', body })).status, 401);
  assert.equal((await req('/quote', { method: 'POST', body, headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await req('/price', { method: 'POST', body, headers: { Authorization: 'Bearer test-keyX' } })).status, 401);
  const noKey = await worker.fetch(new Request('https://x/price', { method: 'POST', body, headers: { Authorization: 'Bearer test-key' } }), Object.assign({}, ENV, { QUOTE_API_KEY: '' }), {});
  assert.equal(noKey.status, 401, 'no key configured = nobody gets in');
});

test('POST /price prices with the right key and never touches Airtable', async () => {
  const r = await req('/price', { method: 'POST', body: JSON.stringify({ takeoff, options: { miles: 144, margin: 3, lift: 750 } }), headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.pushed, false); assert.equal(j.totals.total, 9734); assert.equal(j.margin, 3);
  assert.equal(j.items.length, 2); assert.equal(j.state.v, 1); assert.ok(Array.isArray(j.warnings)); assert.ok(Array.isArray(j.steps));
  assert.equal(j.quoteId, null);
});

test('bad JSON / bad takeoff -> 400 with a message; GET /quote -> 405; unknown -> 404', async () => {
  const H = { Authorization: 'Bearer test-key' };
  const a = await req('/price', { method: 'POST', body: '{nope', headers: H });
  assert.equal(a.status, 400); assert.match((await a.json()).error, /valid JSON/);
  const b = await req('/price', { method: 'POST', body: JSON.stringify({ takeoff: { format: 'APMG_TAKEOFF', version: 1 } }), headers: H });
  assert.equal(b.status, 400); assert.match((await b.json()).error, /canopies/);
  const c = await req('/price', { method: 'POST', body: JSON.stringify({ takeoff: { format: 'APMG_TAKEOFF', version: 1, canopies: [] } }), headers: H });
  assert.equal(c.status, 422);
  assert.equal((await req('/quote', { method: 'GET', headers: H })).status, 405);
  assert.equal((await req('/nope')).status, 404);
});

test('POST /quote with push on but no AIRTABLE_TOKEN -> 500, message names the secret but not its value', async () => {
  const r = await worker.fetch(new Request('https://x/quote', { method: 'POST', body: JSON.stringify({ takeoff, options: { miles: 144 } }), headers: { Authorization: 'Bearer test-key' } }), Object.assign({}, ENV, { AIRTABLE_TOKEN: '' }), {});
  assert.equal(r.status, 500);
  const j = await r.json();
  assert.match(j.error, /AIRTABLE_TOKEN/);
  assert.ok(!/test-key/.test(j.error));
});
