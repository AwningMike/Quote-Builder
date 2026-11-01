/* Pricing pipeline: APMG_TAKEOFF v1 -> Quote Builder State (+ totals) with no DOM.
   Every dollar comes from engine/quote-engine.js (the same file the page loads), so the
   worker and the Quote Builder can never disagree on a price. */
import { importTakeoff, applyMargin, computeTotals, CONST, EMS_QUOTE } from '../../engine/quote-engine.js';
import { deliveryMiles } from './geo.js';

export const ENGINE_DATE = EMS_QUOTE.date;
export const QB_STATE_VERSION = 1;
export const TZ = 'America/Indiana/Indianapolis';
const HDR_FIELDS = ['hdr-shipname','hdr-address1','hdr-address2','hdr-projno','hdr-projname','hdr-gc','hdr-to','hdr-terms','hdr-company','hdr-date','hdr-custemail','hdr-custphone','hdr-biddue','hdr-nbquote'];
const EXTRA_VALS = ['extra-miles','extra-lift','extra-color','extra-ohio-county','extra-survey','extra-stamped'];
const EXTRA_CHECKS = ['extra-survey-on','extra-stamped-on','extra-tax','extra-scupper','extra-individual-items','extra-delivery-only'];

export class QuoteError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
/* page: new Date().toLocaleDateString('en-US') -> "11/1/2026" (shop-local day) */
export function todayUS(now, tz) {
  const d = now || new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || TZ, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.month}/${p.day}/${p.year}`;
}
/* page: new Date().toLocaleDateString('en-CA') -> "2026-11-01" (shop-local day) */
export function todayISO(now, tz) {
  const d = now || new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/* ---- margin resolution: ONE place that decides the multiplier. Today a single number
   (options.margin > env.DEFAULT_MARGIN > 3.25); later a table by canopy size / engineering
   can live here without touching the pipeline. `items` is passed so a future tiered rule
   can look at sqft / face / attach. */
export function resolveMargin(options, env, items) {
  void items;
  const o = options && options.margin;
  if (o !== undefined && o !== null && o !== '') {
    const m = num(o, NaN);
    if (!(m > 0)) throw new QuoteError(400, 'options.margin must be a positive number');
    return m;
  }
  const e = env && env.DEFAULT_MARGIN;
  const m = num(e, NaN);
  return m > 0 ? m : 3.25;
}

/* ---- validation ---- */
export function validateTakeoff(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw new QuoteError(400, 'Body needs a "takeoff" object (APMG_TAKEOFF v1).');
  if (t.format !== undefined && String(t.format).toUpperCase() !== 'APMG_TAKEOFF') throw new QuoteError(400, `takeoff.format must be "APMG_TAKEOFF" (got ${JSON.stringify(t.format)}).`);
  if (t.version !== undefined && String(t.version) !== '1') throw new QuoteError(400, `takeoff.version must be 1 (got ${JSON.stringify(t.version)}).`);
  if (!Array.isArray(t.canopies)) throw new QuoteError(400, 'takeoff.canopies must be an array.');
  if (!t.canopies.length) throw new QuoteError(422, 'takeoff.canopies is empty — nothing to quote.');
  if (t.job !== undefined && (typeof t.job !== 'object' || t.job === null)) throw new QuoteError(400, 'takeoff.job must be an object.');
  return t;
}
export function validateOptions(o) {
  o = o || {};
  if (typeof o !== 'object' || Array.isArray(o)) throw new QuoteError(400, 'options must be an object.');
  const posNum = (k) => { if (o[k] === undefined || o[k] === null) return; if (!(num(o[k], NaN) >= 0)) throw new QuoteError(400, `options.${k} must be a number >= 0`); };
  posNum('lift'); posNum('miles');
  if (o.margin !== undefined && o.margin !== null && !(num(o.margin, NaN) > 0)) throw new QuoteError(400, 'options.margin must be a positive number');
  for (const k of ['survey','stamped','scupper','markSent','push','dryRun']) if (o[k] !== undefined && typeof o[k] !== 'boolean') throw new QuoteError(400, `options.${k} must be true/false`);
  if (o.recordId !== undefined && o.recordId !== null && o.recordId !== '' && !/^rec[A-Za-z0-9]{14}$/.test(String(o.recordId))) throw new QuoteError(400, 'options.recordId must look like recXXXXXXXXXXXXXX');
  if (o.to !== undefined && o.to !== null && typeof o.to !== 'string') throw new QuoteError(400, 'options.to must be a string');
  return o;
}

/* "2+ GCs bidding" rule: leave To: blank when the takeoff warnings say several GCs are bidding. */
const MULTI_GC = /\b(?:(?:[2-9]|\d{2,}|two|three|four|five|several|multiple)\s*\+?\s*(?:GCs?|general\s+contractors|bidders|contractors)\b(?:[^.\n]*\b(?:bidding|invited|invites?|bids?)\b)?|(?:GCs?|general\s+contractors)\s+(?:are\s+)?bidding)/i;
export function multipleGCs(takeoff) {
  const w = Array.isArray(takeoff.warnings) ? takeoff.warnings : [];
  const extra = [takeoff.job && takeoff.job.gcNote, takeoff.job && takeoff.job.notes].filter(Boolean);
  return w.concat(extra).some(s => MULTI_GC.test(String(s)));
}

/* ---- the pipeline ---- */
export async function priceTakeoff(takeoff, options, env, deps) {
  deps = deps || {};
  const fetchImpl = deps.fetch || fetch;
  const now = deps.now || new Date();
  env = env || {};
  validateTakeoff(takeoff); options = validateOptions(options);
  const steps = [], warnings = [];

  // (1) takeoff -> items (same code path as the page's Import Takeoff)
  const imp = importTakeoff(takeoff);
  if (!imp.items.length) throw new QuoteError(422, 'No priceable canopies/fabric awnings in the takeoff.' + (imp.skipped.length ? ' Skipped: ' + imp.skipped.join('; ') : ''));
  steps.push(`imported ${imp.items.length} line(s)` + (imp.skipped.length ? `, skipped ${imp.skipped.length}` : ''));
  imp.skipped.forEach(s => warnings.push('Skipped: ' + s));
  (takeoff.warnings || []).forEach(w => warnings.push(String(w)));

  // (2) margin on canopy lines
  const margin = resolveMargin(options, env, imp.items);
  let items = imp.items;
  const cans = items.filter(i => i.type === 'canopy');
  let marginInfo = null;
  if (cans.length) {
    const r = applyMargin(items, margin);
    if (!r.ok) throw new QuoteError(422, 'Margin could not be applied: ' + r.reason);
    items = r.items; marginInfo = { m: margin, material: r.mat, factor: r.factor, sellBefore: r.sellNow, sellTarget: r.target };
    steps.push(`margin ${margin}× on ${cans.length} canopy line(s) (material $${Math.round(r.mat).toLocaleString()} → canopy sell $${Math.round(r.target).toLocaleString()})`);
  } else steps.push('no canopy lines — margin not applied (fabric/other lines price from the rate card)');

  // (3) miles: options.miles is ONE-WAY; extra-miles holds ROUND TRIP (page convention)
  const job = takeoff.job || {};
  let oneWay = null, milesSrc = '';
  if (options.miles !== undefined && options.miles !== null) { oneWay = num(options.miles, 0); milesSrc = 'given'; }
  else if (job.cityStateZip) {
    try { const d = await deliveryMiles(job.cityStateZip, fetchImpl); oneWay = d.oneWay; milesSrc = (d.est ? 'straight-line est. to ' : 'driving to ') + d.place; }
    catch (e) { warnings.push(`Delivery miles not calculated (${e.message}) — extra-miles left blank, delivery $0. Pass options.miles.`); milesSrc = 'failed'; }
  } else { warnings.push('No job.cityStateZip — delivery miles left blank, delivery $0. Pass options.miles.'); milesSrc = 'no city'; }
  const roundTrip = oneWay === null ? '' : String(Math.round(oneWay * 2));
  if (oneWay !== null) steps.push(`miles ${Math.round(oneWay)} one-way / ${roundTrip} round trip (${milesSrc})`);

  // (4) extras per Mike's standing rules
  const lift = options.lift !== undefined && options.lift !== null ? num(options.lift, 0) : num(env.DEFAULT_LIFT, 1500);
  const surveyOn = options.survey === undefined ? true : !!options.survey;
  const stampedOn = !!options.stamped;
  const extraVals = {
    'extra-miles': roundTrip, 'extra-lift': lift ? String(lift) : '', 'extra-color': imp.extraVals['extra-color'] || '',
    'extra-ohio-county': imp.extraVals['extra-ohio-county'] !== undefined ? String(imp.extraVals['extra-ohio-county']) : '',
    'extra-survey': env.DEFAULT_SURVEY || '500.00', 'extra-stamped': env.DEFAULT_STAMPED || '1250',
  };
  const extraChecks = {
    'extra-survey-on': surveyOn, 'extra-stamped-on': stampedOn, 'extra-tax': !!imp.extraChecks['extra-tax'],
    'extra-scupper': !!options.scupper, 'extra-individual-items': false, 'extra-delivery-only': false,
  };
  const st = String(job.state || '').trim().toUpperCase();
  const taxMsg = (imp.info || []).find(s => /tax/i.test(s)) || '';
  if (st && !['OH','OHIO','IN','INDIANA'].includes(st)) warnings.push(taxMsg || `${st} job — no tax set (only OH / IN are automatic). Check that state's tax.`);
  else if ((st === 'OH' || st === 'OHIO') && !extraVals['extra-ohio-county']) warnings.push(taxMsg || `Ohio job but county "${job.county || '?'}" not found — pick the county by hand.`);
  else if (!st) warnings.push('No job.state — no sales tax applied.');
  if (taxMsg) steps.push(taxMsg);
  steps.push(`lift $${lift} · survey ${surveyOn ? 'on $' + extraVals['extra-survey'] : 'off'} · stamped ${stampedOn ? 'on $' + extraVals['extra-stamped'] : 'off'}`);

  // (5) totals (renderQuote math)
  const totals = computeTotals(items, { extraVals, extraChecks });
  steps.push(`total $${Math.round(totals.total).toLocaleString()} (materials $${totals.taxableMaterials.toLocaleString()}, installation $${totals.installation.toLocaleString()}, tax $${totals.tax})`);

  // (6) Quote Builder State, as captureQuoteState() would save it
  const noTo = options.to === '' || multipleGCs(takeoff);
  if (noTo && options.to !== '') steps.push('To: left blank (2+ GCs bidding)');
  const hdr = {};
  HDR_FIELDS.forEach(k => hdr[k] = '');
  Object.assign(hdr, imp.hdr);
  hdr['hdr-terms'] = '30% Down, Balance per Contract';
  hdr['hdr-company'] = 'SA';
  hdr['hdr-date'] = todayUS(now, env.TZ);
  hdr['hdr-to'] = noTo ? '' : (typeof options.to === 'string' && options.to ? options.to : (hdr['hdr-to'] || ''));
  hdr['hdr-nbquote'] = options.recordId || takeoff.recordId || job.recordId || '';
  HDR_FIELDS.forEach(k => { if (hdr[k] === undefined || hdr[k] === null) hdr[k] = ''; else hdr[k] = String(hdr[k]); });
  const state = {
    v: QB_STATE_VERSION, savedAt: now.toISOString(),
    items: JSON.parse(JSON.stringify(items)),
    hdr, extraVals: pick(extraVals, EXTRA_VALS), extraChecks: pick(extraChecks, EXTRA_CHECKS),
  };
  return { items, totals, state, margin, marginInfo, warnings, steps, oneWayMiles: oneWay, imported: { added: imp.added, skipped: imp.skipped, info: imp.info } };
}
function pick(o, keys) { const out = {}; keys.forEach(k => out[k] = o[k]); return out; }
export { CONST };
