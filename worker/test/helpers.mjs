/* Test helpers: rebuild APMG_TAKEOFF v1 inputs from the saved Quote Builder State fixtures
   (engine/fixtures) and a fake fetch that records every request. No network anywhere. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFtInInches } from '../../engine/quote-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIX_DIR = path.join(here, '..', '..', 'engine', 'fixtures');

export function loadFixtures() {
  return fs.readdirSync(FIX_DIR).filter(f => /^rec.*\.json$/.test(f)).sort()
    .map(f => JSON.parse(fs.readFileSync(path.join(FIX_DIR, f), 'utf8')));
}
export function loadFixture(recordId) {
  return JSON.parse(fs.readFileSync(path.join(FIX_DIR, recordId + '.json'), 'utf8'));
}

const rIn = ft => Math.round((+ft || 0) * 12);
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : (d || 0); };

/* One saved line item -> one takeoff canopy entry (only canopy + fabric lines; the page's
   Import Takeoff does not take standing seam / sunshade / recover). */
export function itemToCanopy(it) {
  const s = it.spec || {};
  if (it.type === 'fabric') {
    const wIn = s.widthIn !== undefined ? s.widthIn : parseFtInInches(s.widthStr);
    const pIn = s.projIn !== undefined ? s.projIn : parseFtInInches(s.projStr);
    const hIn = s.heightIn !== undefined ? s.heightIn : parseFtInInches(s.heightStr);
    return { mark: `L${it.id}`, name: it.title, type: 'fabric', qty: s.qty || 1, widthIn: wIn, projIn: pIn, heightIn: hIn, posts: s.postsPerUnit || 0, confidence: 'high' };
  }
  if (it.type !== 'canopy') return null;
  const c = { mark: `L${it.id}`, name: it.title, type: 'canopy', qty: s.qty || 1, face: num(s.face, 8) || 8,
    lights: s.lightsPerUnit || 0, downspouts: s.downspoutPerUnit || 0, posts: s.postsPerUnit || 0,
    attach: s.attach, arms: s.arms || 0, paint: s.paint || '', blocking: s.blocking || 'wood', confidence: 'high' };
  if (s.mitered && Array.isArray(s.legs) && s.legs.length >= 2) {
    c.legs = s.legs.map(l => {
      const p1 = l.p1Ft !== undefined && l.p1Ft !== null ? l.p1Ft : l.pFt;
      const leg = { widthIn: rIn(l.wFt), projIn: rIn(p1) };
      if (l.taper && l.p2Ft) leg.projCornerIn = rIn(l.p2Ft);
      return leg;
    });
  } else {
    c.widthIn = rIn(s.widthFt);
    if (s.tapered && s.proj1Ft !== null && s.proj1Ft !== undefined && s.proj2Ft) { c.projIn = rIn(s.proj1Ft); c.projEndIn = rIn(s.proj2Ft); }
    else c.projIn = rIn(s.projFt);
  }
  return c;
}

/* "Chipotle (Shell) - Dry Ridge, KY" fixture -> APMG_TAKEOFF v1 */
export function fixtureToTakeoff(fx, overrides) {
  const st = fx.state, h = st.hdr || {};
  const cs = (h['hdr-address2'] || '').match(/^(.*?),\s*([A-Za-z]{2})\b/);
  const canopies = st.items.map(itemToCanopy).filter(Boolean);
  const t = {
    format: 'APMG_TAKEOFF', version: 1,
    job: {
      projectName: h['hdr-projname'] || '', projectNo: h['hdr-projno'] || '', gc: h['hdr-gc'] || '', to: h['hdr-to'] || '',
      shipName: h['hdr-shipname'] || '', address: h['hdr-address1'] || '', cityStateZip: h['hdr-address2'] || '',
      color: (st.extraVals || {})['extra-color'] || '', state: cs ? cs[2].toUpperCase() : '', county: '',
      bidDue: h['hdr-biddue'] || '', customer: { name: '', company: '', email: h['hdr-custemail'] || '', phone: h['hdr-custphone'] || '' },
    },
    canopies, warnings: [],
  };
  return Object.assign(t, overrides || {});
}

/* fake fetch: records every call, answers from a route table */
export function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    init = init || {};
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    const rec = { method, url: String(url), body, headers: init.headers || {} };
    calls.push(rec);
    for (const r of routes) {
      if (r.method && r.method !== method) continue;
      if (typeof r.match === 'string' ? !rec.url.includes(r.match) : !r.match.test(rec.url)) continue;
      const resp = typeof r.respond === 'function' ? r.respond(rec) : r.respond;
      return { ok: (resp && resp.__status || 200) < 400, status: resp && resp.__status || 200, json: async () => resp };
    }
    throw new Error('fakeFetch: no route for ' + method + ' ' + rec.url);
  };
  fn.calls = calls;
  return fn;
}

export const ENV = { DEFAULT_MARGIN: '3.25', DEFAULT_LIFT: '1500', DEFAULT_SURVEY: '500.00', DEFAULT_STAMPED: '1250', AIRTABLE_TOKEN: 'pat.fake.token', QUOTE_API_KEY: 'test-key', AIRTABLE_BASE_ID: 'appgkGZ1G6YeHOVAi' };
export const NOW = new Date('2026-11-01T15:00:00Z');   // 11/1/2026 in Indianapolis
