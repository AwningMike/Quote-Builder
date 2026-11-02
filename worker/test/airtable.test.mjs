/* (c) Airtable push with a fake fetch: asserts the request sequence and the field IDs
   (all copied from newbase.js / AIRTABLE_CFG) for both the linked-record path and the
   create-job path. Nothing touches the network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceTakeoff } from '../src/quote.js';
import { pushQuote, NB, INV_SEED, serializeLines, scaleLines, projectNameForUpload, resolveInv } from '../src/airtable.js';
import { handleQuote } from '../src/index.js';
import { loadFixture, fixtureToTakeoff, fakeFetch, ENV, NOW } from './helpers.mjs';

const BASE = 'https://api.airtable.com/v0/appgkGZ1G6YeHOVAi/';
const Q = NB.q, L = NB.li, R = NB.r;
const fx = loadFixture('recUJElazgmmRxcWx');
const takeoff = fixtureToTakeoff(fx);

function routes(opts) {
  opts = opts || {};
  const quoteFields = Object.assign({ [Q.name]: 'Chipotle (Shell) - Dry Ridge, KY', [Q.lineLink]: opts.oldLines || [], [Q.reqLink]: ['recREQ00000000001'], [Q.bidStatus]: opts.status || 'Estimating', [Q.history]: opts.history || '' }, opts.quoteFields || {});
  return [
    { method: 'GET', match: BASE + NB.t.quotes + '/recUJElazgmmRxcWx', respond: { id: 'recUJElazgmmRxcWx', fields: quoteFields } },
    { method: 'GET', match: BASE + NB.t.quotes + '/recNEW00000000001', respond: { id: 'recNEW00000000001', fields: { [Q.name]: 'Chipotle (Shell) - Dry Ridge, KY', [Q.reqLink]: ['recREQ00000000002'] } } },
    { method: 'GET', match: BASE + NB.t.inv, respond: { records: [
      { id: 'recLIVEfascia8', fields: { [NB.invName]: '6"-8" Fascia Size' } },
      { id: 'recLIVElabor', fields: { [NB.invName]: 'Labor' } },
      { id: 'recLIVEleds', fields: { [NB.invName]: 'LEDs' } } ] } },
    { method: 'DELETE', match: BASE + NB.t.lines, respond: { records: [] } },
    { method: 'POST', match: BASE + NB.t.lines, respond: (rec) => ({ records: rec.body.records.map((r, i) => ({ id: 'recLINE' + i, fields: r.fields })) }) },
    { method: 'PATCH', match: BASE + NB.t.quotes, respond: { records: [{ id: 'recUJElazgmmRxcWx' }] } },
    { method: 'POST', match: BASE + NB.t.quotes, respond: { records: [{ id: 'recNEW00000000001', fields: {} }] } },
    { method: 'GET', match: BASE + NB.t.reqs + '/recREQ', respond: { id: 'recREQ', fields: { [R.address]: '77 Blackburn Lane' } } },
    { method: 'PATCH', match: BASE + NB.t.reqs, respond: { records: [] } },
    { method: 'POST', match: BASE + NB.t.reqs, respond: { records: [{ id: 'recREQ00000000002' }] } },
    { method: 'GET', match: BASE + NB.t.contacts, respond: opts.contactHit ? { records: [{ id: 'recCONTACT000001', fields: {} }] } : { records: [] } },
    { method: 'POST', match: BASE + NB.t.contacts, respond: { records: [{ id: 'recCONTACTNEW001' }] } },
    { method: 'GET', match: BASE + NB.t.companies, respond: opts.companyHit ? { records: [{ id: 'recCOMPANY000001', fields: {} }] } : { records: [] } },
    { method: 'POST', match: BASE + NB.t.companies, respond: { records: [{ id: 'recCOMPANYNEW001' }] } },
  ];
}

test('push to a linked record: GET quote → GET inventory → DELETE old lines → POST lines → PATCH quote → fill request blanks', async () => {
  const f = fakeFetch(routes({ oldLines: ['recOLD1', 'recOLD2'], history: '2026-10-16 · Quote Builder · sell $9,734' }));
  const priced = await priceTakeoff(takeoff, { margin: 3, lift: 750, miles: 144 }, ENV, { now: NOW });
  const r = await pushQuote(priced, { recordId: 'recUJElazgmmRxcWx', markSent: false }, ENV, { fetch: f, now: NOW });
  assert.equal(r.quoteId, 'recUJElazgmmRxcWx');
  assert.equal(r.created, false);
  assert.equal(r.name, 'Chipotle (Shell) - Dry Ridge, KY');
  const seq = f.calls.map(c => c.method + ' ' + c.url.replace(BASE, '').split('?')[0]);
  assert.deepEqual(seq, [
    'GET ' + NB.t.quotes + '/recUJElazgmmRxcWx',
    'GET ' + NB.t.inv,
    'DELETE ' + NB.t.lines,
    'POST ' + NB.t.lines,
    'PATCH ' + NB.t.quotes,
    'GET ' + NB.t.reqs + '/recREQ00000000001',
    'PATCH ' + NB.t.reqs,
    'GET ' + NB.t.contacts,        // customer by email (bids@deohio.com) — not found
    'GET ' + NB.t.companies,       // Derek, Inc. — not found
    'POST ' + NB.t.companies,      // created
    'POST ' + NB.t.contacts,       // created, linked to the company
    'PATCH ' + NB.t.reqs,          // contact + company linked on the Quote Request
  ]);
  // every call carries the bearer token and nothing else leaks
  f.calls.forEach(c => assert.equal(c.headers.Authorization, 'Bearer pat.fake.token'));
  // old lines deleted by id
  assert.ok(f.calls[2].url.includes('records%5B%5D=recOLD1&records%5B%5D=recOLD2'));
  // line items: field IDs, parent link, inventory links (live map wins over seed)
  const lines = f.calls[3].body.records;
  assert.equal(f.calls[3].body.typecast, undefined);
  lines.forEach(l => {
    assert.deepEqual(l.fields[L.parent], ['recUJElazgmmRxcWx']);
    assert.equal(typeof l.fields[L.qty], 'number');
    assert.equal(typeof l.fields[L.total], 'number');
    assert.equal(typeof l.fields[L.desc], 'string');
    assert.ok(!/mapes|awnex/i.test(l.fields[L.desc]));
  });
  const byDesc = (re) => lines.find(l => re.test(l.fields[L.desc]));
  assert.deepEqual(byDesc(/MFG incl\. paint/).fields[L.inv], ['recLIVEfascia8']);
  assert.deepEqual(byDesc(/— Labor$/).fields[L.inv], ['recLIVElabor']);
  assert.deepEqual(byDesc(/— Lights$/).fields[L.inv], ['recLIVEleds']);
  assert.deepEqual(byDesc(/Delivery \/ mileage/).fields[L.inv], [INV_SEED.travel]);
  assert.deepEqual(byDesc(/Survey \/ PM/).fields[L.inv], [INV_SEED.survey]);
  assert.deepEqual(byDesc(/Lift rental/).fields[L.inv], [INV_SEED.lift]);
  assert.equal(byDesc(/Delivery \/ mileage/).fields[L.qty], 288);   // round-trip box value, as the page sends it
  // lines sum to the pre-tax total (= 9734, no tax in KY)
  assert.equal(lines.reduce((a, l) => a + l.fields[L.total], 0), 9734);
  // quote PATCH: field IDs + values
  const patch = f.calls[4].body;
  assert.equal(patch.typecast, true);
  assert.equal(patch.records[0].id, 'recUJElazgmmRxcWx');
  const qf = patch.records[0].fields;
  assert.equal(qf[Q.contract], 9734);
  assert.equal(qf[Q.sqft], 74);
  assert.equal(qf[Q.distance], 288);
  assert.equal(qf[Q.bidStatus], 'Ready to Quote');
  assert.equal(qf[Q.qbNo], 'BCP002');
  assert.deepEqual(qf[Q.service], ['Metal Canopy']);
  assert.equal(qf[Q.company], 'SA');
  assert.equal(qf[Q.basis], 'Material only');
  assert.equal(qf[Q.target], 0.425);
  assert.equal(typeof qf[Q.matCost], 'number');
  assert.equal(qf[Q.snapDate], '2026-11-01');
  assert.ok(qf[Q.history].startsWith('2026-10-16 · Quote Builder · sell $9,734\n2026-11-01 · Quote Service (3× margin) · sell $9,734 · canopy sell $5,278 · material $'), qf[Q.history]);
  assert.equal(qf[Q.pdf], undefined, 'Quote PDF field left alone');
  assert.equal(qf[Q.builtOut], undefined, 'builtOut only when markSent');
  assert.equal(qf[Q.quoteSent], undefined);
  const state = JSON.parse(qf[Q.state]);
  assert.equal(state.v, 1);
  assert.equal(state.hdr['hdr-nbquote'], 'recUJElazgmmRxcWx');
  assert.equal(state.items.length, 2);
  assert.equal(state.extraVals['extra-miles'], '288');
  // request blanks: address already set -> city/state/zip + bid due (ISO) filled, address untouched
  const rp = f.calls[6].body.records[0];
  assert.equal(rp.id, 'recREQ00000000001');
  assert.deepEqual(rp.fields, { [R.city]: 'Dry Ridge', [R.state]: 'KY', [R.zip]: '41035', [R.bidDue]: '2026-10-28' });
});

test('markSent: Bid Status → Quote Sent, Quote Sent Date today, Quote Built Out? checked; closed statuses untouched', async () => {
  const f = fakeFetch(routes({ status: 'Ready to Quote' }));
  const priced = await priceTakeoff(takeoff, { miles: 144 }, ENV, { now: NOW });
  await pushQuote(priced, { recordId: 'recUJElazgmmRxcWx', markSent: true }, ENV, { fetch: f, now: NOW });
  const qf = f.calls.find(c => c.method === 'PATCH' && c.url.includes(NB.t.quotes)).body.records[0].fields;
  assert.equal(qf[Q.bidStatus], 'Quote Sent'); assert.equal(qf[Q.quoteSent], '2026-11-01'); assert.equal(qf[Q.builtOut], true);
  assert.ok(/3\.25× margin/.test(qf[Q.history]));
  const f2 = fakeFetch(routes({ status: 'Won' }));
  await pushQuote(priced, { recordId: 'recUJElazgmmRxcWx', markSent: true }, ENV, { fetch: f2, now: NOW });
  const qf2 = f2.calls.find(c => c.method === 'PATCH' && c.url.includes(NB.t.quotes)).body.records[0].fields;
  assert.equal(qf2[Q.bidStatus], undefined); assert.equal(qf2[Q.builtOut], undefined);
});

test('no recordId: creates Quote Request + Quote like _nbCreateJob, then pushes', async () => {
  const f = fakeFetch(routes());
  const priced = await priceTakeoff(takeoff, { miles: 144 }, ENV, { now: NOW });
  const r = await pushQuote(priced, { markSent: false }, ENV, { fetch: f, now: NOW });
  assert.equal(r.created, true);
  assert.equal(r.quoteId, 'recNEW00000000001');
  const seq = f.calls.map(c => c.method + ' ' + c.url.replace(BASE, '').split('?')[0]);
  assert.deepEqual(seq.slice(0, 4), ['POST ' + NB.t.reqs, 'POST ' + NB.t.quotes, 'GET ' + NB.t.quotes + '/recNEW00000000001', 'GET ' + NB.t.quotes + '/recNEW00000000001']);
  const rf = f.calls[0].body.records[0].fields;
  assert.equal(rf[R.projName], 'Chipotle (Shell) - Dry Ridge, KY');
  assert.equal(rf[R.address], '77 Blackburn Lane'); assert.equal(rf[R.city], 'Dry Ridge'); assert.equal(rf[R.state], 'KY'); assert.equal(rf[R.zip], '41035');
  assert.equal(rf[R.customer], 'Brent Anderson'); assert.equal(rf[R.distance], 288);
  assert.ok(/Created from APMG Quote Builder .*GC: Derek, Inc\./.test(rf[R.details]));
  const qf = f.calls[1].body.records[0].fields;
  assert.equal(f.calls[1].body.typecast, true);
  assert.equal(qf[Q.type], 'Quote'); assert.deepEqual(qf[Q.reqLink], ['recREQ00000000002']); assert.equal(qf[Q.bidStatus], 'Estimating');
  assert.equal(qf[Q.company], 'SA'); assert.deepEqual(qf[Q.pm], [{ id: NB.pmUser }]); assert.equal(qf[Q.siteContact], 'Derek, Inc.');
  const st = JSON.parse(f.calls.find(c => c.method === 'PATCH' && c.url.includes(NB.t.quotes)).body.records[0].fields[Q.state]);
  assert.equal(st.hdr['hdr-nbquote'], 'recNEW00000000001');
});

test('linked record that cannot be opened -> 404-style error, no writes', async () => {
  const f = fakeFetch([{ method: 'GET', match: 'recGONE', respond: { __status: 404, error: { type: 'NOT_FOUND' } } }]);
  const priced = await priceTakeoff(takeoff, { miles: 144 }, ENV, { now: NOW });
  await assert.rejects(pushQuote(priced, { recordId: 'recGONE0000000000' }, ENV, { fetch: f, now: NOW }), /could not be opened/);
  assert.equal(f.calls.length, 1);
});

test('handleQuote: dryRun / push:false / /price never call Airtable', async () => {
  const f = fakeFetch([]);
  const body = { takeoff, options: { miles: 144, dryRun: true } };
  const a = await handleQuote(body, ENV, { fetch: f, now: NOW }, false);
  assert.equal(a.pushed, false); assert.equal(a.margin, 3.25); assert.equal(f.calls.length, 0);
  const b = await handleQuote({ takeoff, options: { miles: 144, push: false } }, ENV, { fetch: f, now: NOW }, false);
  assert.equal(b.pushed, false); assert.equal(f.calls.length, 0);
  const c = await handleQuote({ takeoff, options: { miles: 144, push: true } }, ENV, { fetch: f, now: NOW }, true);
  assert.equal(c.pushed, false); assert.equal(f.calls.length, 0);
  assert.ok(c.steps.some(s => /pricing only/.test(s)));
});

test('serializeLines / scaleLines / projectNameForUpload / resolveInv behave like the page', async () => {
  const priced = await priceTakeoff(takeoff, { margin: 3, lift: 750, miles: 144 }, ENV, { now: NOW });
  const p = serializeLines(priced.items, priced.totals, priced.state.extraVals);
  assert.equal(p.sqft, 74); assert.equal(p.distance, 288);
  // raw lines carry the rate-card MFG (bd.mfg, pre-margin) like the page; _nbScaleLines settles them on the pre-tax total
  const raw = p.lineItems.reduce((a, l) => a + l.lineTotal, 0);
  assert.ok(raw > 9734, 'rate-card lines before scaling');
  scaleLines(p.lineItems, priced.totals.total - priced.totals.tax);
  assert.equal(p.lineItems.reduce((a, l) => a + l.lineTotal, 0), 9734);
  const lines = [{ lineTotal: 100 }, { lineTotal: 300 }];
  scaleLines(lines, 1000);
  assert.deepEqual(lines.map(l => l.lineTotal), [250, 750]);
  assert.equal(projectNameForUpload({ 'hdr-projname': 'Valvoline', 'hdr-address2': 'Tiffin, OH 44883' }), 'Valvoline - Tiffin, OH');
  assert.equal(projectNameForUpload({ 'hdr-projname': 'Valvoline - Tiffin, OH', 'hdr-address2': 'Tiffin, OH 44883' }), 'Valvoline - Tiffin, OH');
  assert.equal(resolveInv('C-Channel', 'cchannel', { cchannel: 'recLIVE' }), 'recLIVE');
  assert.equal(resolveInv('C-Channel', 'cchannel', {}), INV_SEED.cchannel);
  assert.equal(resolveInv('Nothing', 'nothing', {}), null);
});

test("contacts rule: customer found by email + company found -> only linked; nothing created", async () => {
  const f = fakeFetch(routes({ contactHit: true, companyHit: true }));
  const priced = await priceTakeoff(takeoff, { miles: 144 }, ENV, { now: NOW });
  const r = await pushQuote(priced, { recordId: 'recUJElazgmmRxcWx', markSent: false }, ENV, { fetch: f, now: NOW });
  const seq = f.calls.map(c => c.method + ' ' + c.url.replace(BASE, '').split('?')[0]);
  assert.ok(!seq.includes('POST ' + NB.t.contacts) && !seq.includes('POST ' + NB.t.companies));
  const emailQ = f.calls.find(c => c.url.includes(NB.t.contacts)).url;
  assert.ok(decodeURIComponent(emailQ).includes("LOWER({Email})='bids@deohio.com'"));
  const link = f.calls.filter(c => c.method === 'PATCH' && c.url.includes(NB.t.reqs)).pop().body.records[0];
  assert.equal(link.id, 'recREQ00000000001');
  assert.deepEqual(link.fields[R.contacts], ['recCONTACT000001']);
  assert.deepEqual(link.fields[R.companies], ['recCOMPANY000001']);
  assert.ok(r.steps.some(s => /contact .*found, company found, linked on the Quote Request/.test(s)), r.steps.join(' | '));
});

test('contacts rule: missing customer is created with email, phone, company link and a note; already-linked request is left alone', async () => {
  const f = fakeFetch(routes({ companyHit: true }));
  const priced = await priceTakeoff(takeoff, { miles: 144 }, ENV, { now: NOW });
  await pushQuote(priced, { recordId: 'recUJElazgmmRxcWx', markSent: false }, ENV, { fetch: f, now: NOW });
  const created = f.calls.find(c => c.method === 'POST' && c.url.includes(NB.t.contacts)).body;
  assert.equal(created.typecast, true);
  const cf = created.records[0].fields;
  assert.equal(cf[NB.c.name], 'bids@deohio.com');       // takeoff has no person name -> email stands in
  assert.equal(cf[NB.c.email], 'bids@deohio.com');
  assert.equal(cf[NB.c.phone], '(513) 667-2351');
  assert.deepEqual(cf[NB.c.companies], ['recCOMPANY000001']);
  assert.ok(/Added by the quote service 2026-11-01/.test(cf[NB.c.notes]));
  // request already linked to this contact + company -> no second PATCH
  const f2 = fakeFetch(routes({ contactHit: true, companyHit: true }).map(r => r.match === BASE + NB.t.reqs + '/recREQ' ? Object.assign({}, r, { respond: { id: 'recREQ', fields: { [R.address]: '77 Blackburn Lane', [R.contacts]: ['recCONTACT000001'], [R.companies]: ['recCOMPANY000001'] } } }) : r));
  const r2 = await pushQuote(priced, { recordId: 'recUJElazgmmRxcWx', markSent: false }, ENV, { fetch: f2, now: NOW });
  const patches = f2.calls.filter(c => c.method === 'PATCH' && c.url.includes(NB.t.reqs));
  assert.equal(patches.length, 1);   // only the blanks fill, no link patch
  assert.ok(r2.steps.some(s => /already linked/.test(s)));
});
