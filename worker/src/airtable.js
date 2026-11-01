/* Airtable push — a port of newbase.js pushToAirtable() / _nbCreateJob() and the page's
   serializeQuoteForAirtable() / resolveInv(). Every table + field ID below is copied
   from newbase.js (NB) and canopy_quote_calculator.html (AIRTABLE_CFG) — the source of truth.
   Differences from the page (on purpose):
     • no Quote PDF upload and the Quote PDF field is NOT touched (the desktop step attaches it)
     • margin snapshot is material-only (the page's install-labor strip needs the Installer Pay feed) */
import { canopyTrueCost } from '../../engine/quote-engine.js';
import { todayISO } from './quote.js';

export const NB = {
  baseId: 'appgkGZ1G6YeHOVAi',            // Flow Digital Migration Base (live)
  t: { quotes: 'tbluonHEUpfEp64Ze', reqs: 'tblEVnvT3rVK50Xe6', lines: 'tbl6lzqYtBTDFR3KX', inv: 'tblfsAblcEvPFWbKK' },
  q: {  // Quotes/Work Orders
    name: 'fldFG9G78g04eHdxo', type: 'fldyuEW1nUiYWZkeB', reqLink: 'fldJ6M9OyUmH66kEn', lineLink: 'fldBjdHC0Y9HLiWgx',
    state: 'fldd7zyICqmX7xnxJ', sqft: 'fldxJJjfxP9n2uxWs', distance: 'fld54Ggr8d7MXu7AN', pdf: 'fldqoBvjSCGlbERe1',
    contract: 'fld7eNrlItCIJL5s7', qbNo: 'fldKFjD9VfrimA8h9', company: 'fldlZJWNDJXgzvLrV', service: 'fldqxv5b9n9hxEAUh',
    pm: 'fld9CnrOq3V1lv0TZ', siteContact: 'fldSvsSEhbGRW8iqg', bidStatus: 'fldKRJwVJibEPSj35', quoteSent: 'fldbUaFIpvxQjxH5M',
    matCost: 'fldpZIOlWqBZK6kWt', target: 'fldMyqqRr6oSuuxoE', basis: 'fldxu6Ws12T8dhQTo', marginLabor: 'fldlX1h4TWCSQXxPx',
    laborCost: 'fldMIO6AU0hRlSZO3', travelCost: 'fld4WllzlOrfOdjbq', laborBasis: 'fldi4t4qNIJUz25b2',
    snapDate: 'fldwXsoIYroXhKrUq', history: 'fldGH8p0NN5iLX6M2', bidDueLk: 'fldMuXZa9HX6N2UzV', addrLk: 'fld1U7J97YY0KVcYc',
    builtOut: 'fld87IQul02q2WpyN',   // "Quote Built Out?" — checked = Quotes Waiting Approval page
  },
  r: {  // Quote Requests
    projName: 'fldt6IkbytVXaoPlo', address: 'fldYtcQCEJnsoTvfY', city: 'fldii344bPuQWXduV', state: 'fldT1HtAR8jzyaIlc',
    zip: 'fldQZJuNgpyryB0iv', details: 'fld5zK52jpWKcJEpc', bidDue: 'fldxd04HylKNmP3Rj', distance: 'fldzPdTK28j1aLXgN',
    customer: 'fldJQm29Xtu2woqGK',
  },
  li: { parent: 'fldtaiuuiYPmdAlHA', qty: 'fldRfSY9Wgh2K4h27', inv: 'fldEw0ChyiUpv6vgj', desc: 'fldRzlvWQmnrH0d97', total: 'fldq6hiF98nOSZVCy' },
  invName: 'fldfLIGLTdzyEQWop',             // Quote Inventory "Name" (NB_INV.qi.name)
  pmUser: 'usrbYftDso64IrJbg',              // Mike Sommer — PM on jobs the builder creates
  closedStatuses: ['Won', 'Lost', 'No Bid', 'No Canopies / Awnings'],
  marginTarget: 42.5,                       // page's #mc-target default (%)
};

/* Seed inventory record IDs (AIRTABLE_CFG.inventory + the newbase.js overrides) — fallback
   when the live Quote Inventory map has no name match. */
export const INV_SEED = {
  fascia8: 'recwjSdzxcMyIvkUT', fascia12: 'recWgwiYk0tkLyqzo', labor: 'rec1aNDVdfBDV6ccK', leds: 'rec5VZDSO7eHiOo9f',
  outriggers: 'recAmFtXR4xEuWxxU', cchannel: 'recBbreF1HM8PvTeB', downspouts: 'recJ8uFivckWpIQjG', travel: 'recLCPDYLByMCcCDP',
  closedEnds: 'recZ3LwroNzVGLbiq', engineering: 'reciZp1aB5LEzASgi', standingSeam: 'rec0xAwA99LkV4Oyj', fabric: 'rec1HEgYC6Ad1pLhm',
  posts: 'recpmAwaldBBHs5CW', miter: 'recQ8ZuvFmrBeQgua', sunshade: 'recba3n89Lqy036s6',
  recover: 'recPpnjxiSNhUCEgi', survey: 'recLRY0TYYFPgLxiR', lift: 'recjcZ8e5qX15H3vu',
};

export const atNorm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function resolveInv(invName, invKey, liveMap) {
  const hit = liveMap && liveMap[atNorm(invName)];
  if (hit) return hit;
  return INV_SEED[invKey] || null;
}

/* Split "City, ST ZIP" into parts (best-effort, for Quote Request fields) */
export function splitCityStateZip(s) {
  s = (s || '').trim();
  const m = s.match(/^(.*?),\s*([A-Za-z]{2})\s*(\d{5})?/);
  if (m) return { city: m[1].trim(), state: m[2].toUpperCase(), zip: m[3] || '' };
  return { city: s, state: '', zip: '' };
}
/* Project name for Airtable = "<name> - City, ST" (appends location if not already present) */
export function projectNameForUpload(hdr) {
  const baseName = (hdr['hdr-projname'] || '').trim() || (hdr['hdr-shipname'] || '').trim() || 'Untitled Bid';
  const cs = splitCityStateZip(hdr['hdr-address2']);
  const loc = (cs.city && cs.state) ? `${cs.city}, ${cs.state}` : (cs.city || cs.state || '');
  if (loc && baseName.toLowerCase().indexOf(loc.toLowerCase()) < 0) return `${baseName} - ${loc}`;
  return baseName;
}
export function serviceFromItems(items) {
  const set = new Set();
  (items || []).forEach(it => {
    if (it.type === 'canopy') set.add('Metal Canopy');
    else if (it.type === 'fabric') set.add('Fabric Awning(s)');
    else if (it.type === 'sunshade') set.add('Sunshade(s)');
    else if (it.type === 'standingSeam') set.add('Standing Seam Awning(s)');
    else if (it.type === 'recover') set.add('Recover Fabric Awning(s)');
    else if (it.type === 'patiocanopy') set.add('Metal Canopy');
  });
  return [...set];
}
const usDate = s => { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return ''; const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; };

/* serializeQuoteForAirtable() — line items with the builder's exact $ per line */
export function serializeLines(items, totals, extraVals) {
  const s = totals || {};
  const lines = [];
  const push = (invKey, invName, qty, lineTotal, desc) => {
    if (!lineTotal) return;
    if (invKey === 'labor' && s.deliveryOnly) return;
    lines.push({ invKey, invName, qty: Math.round((qty || 0) * 100) / 100, lineTotal: Math.round(lineTotal), desc: desc || '' });
  };
  let sqftTotal = 0;
  (items || []).forEach(it => {
    if (it.type === 'canopy') {
      const b = it.bd || {}; sqftTotal += (b.sqft || 0);
      const fasciaKey = (it.faceInches || 8) <= 8 ? 'fascia8' : 'fascia12';
      const fasciaName = (it.faceInches || 8) <= 8 ? '6"-8" Fascia Size' : '10"-12" Fascia Size';
      push(fasciaKey, fasciaName, b.sqft, (b.mfg || 0) + (b.fasciaCost || 0) + (b.paintCost || 0), `${it.title} — MFG${(b.paintCost || 0) > 0 ? ' incl. paint $9/sqft' : ''} (${it.spec.widthStr} × ${it.spec.projStr})`);
      push('cchannel', 'C-Channel', b.cchannelFt, b.cchannelCost, `${it.title} — C-Channel`);
      push('outriggers', 'Outriggers', b.outriggerFt, b.outriggerCost, `${it.title} — Outriggers`);
      push('miter', 'Miter', b.miterQty, b.miterCost, `${it.title} — Miter`);
      push('labor', 'Labor', b.laborFt, b.labor, `${it.title} — Labor`);
      push('leds', 'LEDs', it.lightsQty, it.lightsCost, `${it.title} — Lights`);
      push('downspouts', 'Downspouts', it.downspoutQty, it.downspoutCost, `${it.title} — Downspouts`);
      push('posts', 'Posts', it.postsQty, it.postsCost, `${it.title} — Posts`);
    } else if (it.type === 'standingSeam') {
      push('standingSeam', 'Standing seam awning', it.spec && it.spec.qty || 1, it.amount, `${it.title} — Standing Seam`);
      push('labor', 'Labor', 1, it.labor, `${it.title} — Labor`);
    } else if (it.type === 'fabric') {
      push('fabric', 'Fabric Awning', it.spec && it.spec.qty || 1, it.amount, `${it.title} — Fabric`);
      push('labor', 'Labor', 1, it.labor, `${it.title} — Labor`);
      push('posts', 'Posts', it.postsQty, it.postsCost, `${it.title} — Posts`);
    } else if (it.type === 'sunshade') {
      push('sunshade', 'Sunshade', it.spec && it.spec.qty || 1, it.amount, `${it.title} — Sunshade`);
      push('labor', 'Labor', 1, it.labor, `${it.title} — Labor`);
    } else if (it.type === 'patiocanopy') {
      push('patiocanopy', 'Metal Patio Canopy', it.spec && it.spec.qty || 1, it.amount, `${it.title} — Patio Canopy (custom priced)`);
      push('labor', 'Labor', 1, it.labor, `${it.title} — Install (custom priced)`);
      push('leds', 'LEDs', it.lightsQty, it.lightsCost, `${it.title} — Lights`);
      push('downspouts', 'Downspouts', it.downspoutQty, it.downspoutCost, `${it.title} — Downspouts`);
      push('posts', 'Posts', it.postsQty, it.postsCost, `${it.title} — Posts`);
    } else if (it.type === 'patiorailing') {
      push('patiorailing', 'Patio Railing', it.spec && it.spec.qty || 1, it.amount, `${it.title} — Patio Railing (custom priced)`);
      push('labor', 'Labor', 1, it.labor, `${it.title} — Install (custom priced)`);
    } else if (it.type === 'recover') {
      push('recover', 'Recover', it.spec && it.spec.qty || 1, it.amount, `${it.title} — Recover`);
    }
  });
  const miles = parseFloat((extraVals || {})['extra-miles']) || 0;
  push('travel', 'Travel Rate', miles, s.deliveryCost, 'Delivery / mileage');
  push('survey', 'Survey / PM', 1, s.survey, 'Survey / PM');
  push('lift', 'Lift', 1, s.lift, 'Lift rental');
  push('engineering', 'Engineering', 1, s.stamped, 'Stamped engineering');
  return { lineItems: lines, sqft: Math.round(sqftTotal), distance: miles };
}
/* _nbScaleLines: make the per-line totals add up to the real pre-tax total */
export function scaleLines(lines, target) {
  target = Math.round(target || 0);
  const sum = lines.reduce((a, l) => a + (l.lineTotal || 0), 0);
  if (!target || !sum || Math.abs(sum - target) < 1) return lines;
  const k = target / sum; let acc = 0, big = 0;
  lines.forEach((l, i) => { l.lineTotal = Math.round(l.lineTotal * k); acc += l.lineTotal; if (l.lineTotal > lines[big].lineTotal) big = i; });
  lines[big].lineTotal += target - acc;
  return lines;
}
/* nbMarginSnapshot() — material-only part (the install-labor strip needs the page's Installer Pay feed) */
export function marginSnapshot(items) {
  const cans = (items || []).filter(i => i.type === 'canopy');
  if (!cans.length) return null;
  let sell = 0, mat = 0, sqft = 0;
  cans.forEach(i => { const c = canopyTrueCost(i.spec); sell += i.amount + (i.downspoutCost || 0) - (i.paintCost || 0); mat += c.material; sqft += c.sqft; });
  if (sell <= 0) return null;
  return { sell, mat, sqft, target: NB.marginTarget, marginPct: (sell - mat) / sell * 100 };
}
/* _nbReqFillFromHeader: fill blank request fields from the quote header (never overwrites) */
export function reqFillFromHeader(hdr, reqFields) {
  const R = NB.r, f = {};
  const cs = splitCityStateZip(hdr['hdr-address2'] || '');
  if (!reqFields[R.address] && hdr['hdr-address1']) f[R.address] = hdr['hdr-address1'];
  if (!reqFields[R.city] && cs.city) f[R.city] = cs.city;
  if (!reqFields[R.state] && cs.state) f[R.state] = cs.state;
  if (!reqFields[R.zip] && cs.zip) f[R.zip] = cs.zip;
  const due = usDate(hdr['hdr-biddue']); if (!reqFields[R.bidDue] && due) f[R.bidDue] = due;
  return f;
}

/* ---- tiny Airtable client ---- */
function client(env, fetchImpl) {
  const token = env.AIRTABLE_TOKEN;
  if (!token) throw Object.assign(new Error('AIRTABLE_TOKEN secret is not set on the Worker'), { status: 500 });
  const baseId = env.AIRTABLE_BASE_ID || NB.baseId;
  const H = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
  const api = (tbl, rest) => `https://api.airtable.com/v0/${baseId}/${tbl}${rest || ''}`;
  async function call(url, init) {
    const r = await fetchImpl(url, Object.assign({ headers: H }, init || {}));
    let b = {}; try { b = await r.json(); } catch (e) {}
    if (!r.ok || b.error) { const msg = (b.error && (b.error.message || b.error.type)) || ('HTTP ' + r.status); throw Object.assign(new Error('Airtable: ' + msg), { status: 502 }); }
    return b;
  }
  return { api, call, baseId };
}
export async function fetchInventoryMap(at) {
  const map = {}; let offset = '';
  do {
    const j = await at.call(at.api(NB.t.inv, `?pageSize=100&returnFieldsByFieldId=true${offset ? '&offset=' + offset : ''}`));
    (j.records || []).forEach(rec => {
      const f = rec.fields || {};
      const nm = f[NB.invName] || f['Name'] || Object.values(f).find(v => typeof v === 'string');
      if (nm) map[atNorm(nm)] = rec.id;
    });
    offset = j.offset || '';
  } while (offset);
  return map;
}
/* _nbCreateJob: Quote Request + Quote from the header */
export async function createJob(at, state, now) {
  const Q = NB.q, R = NB.r, hdr = state.hdr || {};
  const cs = splitCityStateZip(hdr['hdr-address2']);
  const rf = {};
  rf[R.projName] = projectNameForUpload(hdr);
  rf[R.address] = hdr['hdr-address1']; rf[R.city] = cs.city; rf[R.state] = cs.state; rf[R.zip] = cs.zip;
  rf[R.details] = `Created from APMG Quote Builder ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Indiana/Indianapolis' }).format(now || new Date())}. GC: ${hdr['hdr-gc'] || '—'}. Bid due: ${hdr['hdr-biddue'] || '—'}.`;
  if (hdr['hdr-to']) rf[R.customer] = hdr['hdr-to'];
  const miles = parseFloat((state.extraVals || {})['extra-miles']) || 0; if (miles) rf[R.distance] = miles;
  Object.keys(rf).forEach(k => { if (rf[k] == null || rf[k] === '') delete rf[k]; });
  const rq = await at.call(at.api(NB.t.reqs), { method: 'POST', body: JSON.stringify({ records: [{ fields: rf }] }) });
  const reqId = rq.records[0].id;
  const qf = {};
  qf[Q.type] = 'Quote'; qf[Q.reqLink] = [reqId]; qf[Q.bidStatus] = 'Estimating';
  qf[Q.company] = hdr['hdr-company'] || 'SA';
  if (NB.pmUser) qf[Q.pm] = [{ id: NB.pmUser }];
  if (hdr['hdr-gc']) qf[Q.siteContact] = hdr['hdr-gc'];
  const qq = await at.call(at.api(NB.t.quotes, '?returnFieldsByFieldId=true'), { method: 'POST', body: JSON.stringify({ records: [{ fields: qf }], typecast: true }) });
  const rec = qq.records[0];
  let name = rf[R.projName];
  try { const g = await at.call(at.api(NB.t.quotes, '/' + rec.id + '?returnFieldsByFieldId=true')); name = (g.fields || {})[Q.name] || name; } catch (e) {}
  return { id: rec.id, reqId, name };
}

/* pushToAirtable() — returns { quoteId, name, created, steps } */
export async function pushQuote(priced, opts, env, deps) {
  deps = deps || {};
  const fetchImpl = deps.fetch || fetch;
  const now = deps.now || new Date();
  const at = client(env, fetchImpl);
  const Q = NB.q, L = NB.li;
  const { items, totals, state, margin } = priced;
  const steps = [];
  // 1) the job record
  let quoteId = opts.recordId || state.hdr['hdr-nbquote'] || '', name = '', created = false, current;
  if (quoteId) {
    try { current = await at.call(at.api(NB.t.quotes, '/' + quoteId + '?returnFieldsByFieldId=true')); }
    catch (e) { throw Object.assign(new Error('The linked job (' + quoteId + ') could not be opened: ' + e.message), { status: 404 }); }
    name = (current.fields || {})[Q.name] || '';
  } else {
    const j = await createJob(at, state, now); quoteId = j.id; name = j.name; created = true;
    current = await at.call(at.api(NB.t.quotes, '/' + quoteId + '?returnFieldsByFieldId=true'));
    steps.push('created job ' + name);
  }
  state.hdr['hdr-nbquote'] = quoteId;   // the record ID travels with the saved state (page does this via the hidden field)
  const cf = current.fields || {};
  // 2) replace this quote's line items
  const p = serializeLines(items, totals, state.extraVals);
  scaleLines(p.lineItems, (totals.total || 0) - (totals.tax || 0));
  let invMap = {};
  try { invMap = await fetchInventoryMap(at); } catch (e) { steps.push('inventory map not loaded (' + e.message + ') — seed IDs used'); }
  const oldLines = cf[Q.lineLink] || [];
  for (let i = 0; i < oldLines.length; i += 10) {
    const qs = oldLines.slice(i, i + 10).map(id => 'records%5B%5D=' + id).join('&');
    await at.call(at.api(NB.t.lines, '?' + qs), { method: 'DELETE' });
  }
  const recs = p.lineItems.map(l => {
    const f = {}; f[L.parent] = [quoteId]; f[L.qty] = l.qty; f[L.desc] = l.desc; f[L.total] = l.lineTotal;
    const invId = resolveInv(l.invName, l.invKey, invMap); if (invId) f[L.inv] = [invId];
    return { fields: f };
  });
  for (let i = 0; i < recs.length; i += 10) {
    await at.call(at.api(NB.t.lines), { method: 'POST', body: JSON.stringify({ records: recs.slice(i, i + 10) }) });
  }
  steps.push(`${recs.length} line items` + (oldLines.length ? ` (replaced ${oldLines.length} old)` : ''));
  // 3) quote fields
  const today = todayISO(now, env.TZ);
  const qf = {};
  qf[Q.state] = JSON.stringify(state);
  qf[Q.sqft] = p.sqft; qf[Q.distance] = p.distance;
  qf[Q.contract] = Math.round((totals.total || 0) * 100) / 100;
  const qb = (state.hdr['hdr-projno'] || '').trim(); if (qb && !cf[Q.qbNo]) qf[Q.qbNo] = qb;
  const svc = serviceFromItems(items); if (svc.length) qf[Q.service] = [...new Set([...(cf[Q.service] || []), ...svc])];
  if (!cf[Q.company]) qf[Q.company] = state.hdr['hdr-company'] || 'SA';
  const st = cf[Q.bidStatus] || '';
  if (opts.markSent && NB.closedStatuses.indexOf(st) < 0) { qf[Q.bidStatus] = 'Quote Sent'; qf[Q.quoteSent] = today; qf[Q.builtOut] = true; }
  else if (!st || st === 'Estimating' || st === 'Scrubbing / Scaling') qf[Q.bidStatus] = 'Ready to Quote';
  const m = marginSnapshot(items);
  let mLine = `${today} · Quote Service (${margin}× margin) · sell $${Math.round(totals.total || 0).toLocaleString('en-US')}`;
  if (m) {
    qf[Q.matCost] = Math.round(m.mat); qf[Q.target] = Math.round(m.target * 10) / 1000; qf[Q.basis] = 'Material only';
    mLine += ` · canopy sell $${Math.round(m.sell).toLocaleString('en-US')} · material $${Math.round(m.mat).toLocaleString('en-US')} · ${m.marginPct.toFixed(1)}% material (target ${m.target}%)`;
    qf[Q.snapDate] = today;
  }
  qf[Q.history] = ((cf[Q.history] || '').trimEnd() + '\n' + mLine).trim();
  // NOTE: Q.pdf deliberately untouched (the page clears it and re-attaches; the desktop step owns the PDF)
  await at.call(at.api(NB.t.quotes), { method: 'PATCH', body: JSON.stringify({ records: [{ id: quoteId, fields: qf }], typecast: true }) });
  // fill blank Project Address / City / State / Zip / Bid Due on the Quote Request (never overwrites)
  try {
    const reqId = Array.isArray(cf[Q.reqLink]) ? cf[Q.reqLink][0] : cf[Q.reqLink];
    if (reqId) {
      const rq = await at.call(at.api(NB.t.reqs, '/' + reqId + '?returnFieldsByFieldId=true'));
      const rf = reqFillFromHeader(state.hdr, rq.fields || {});
      if (Object.keys(rf).length) { await at.call(at.api(NB.t.reqs), { method: 'PATCH', body: JSON.stringify({ records: [{ id: reqId, fields: rf }] }) }); steps.push('filled blank ' + Object.keys(rf).length + ' field(s) on the Quote Request'); }
    }
  } catch (e) { steps.push('Quote Request blanks not filled: ' + e.message); }
  steps.push('price $' + Math.round(totals.total || 0).toLocaleString('en-US') + (qf[Q.bidStatus] ? ' · Bid Status → ' + qf[Q.bidStatus] : ''));
  if (m) steps.push(`margin ${m.marginPct.toFixed(1)}% material`);
  return { quoteId, name, created, steps, url: `https://airtable.com/${at.baseId}/${NB.t.quotes}/${quoteId}` };
}
