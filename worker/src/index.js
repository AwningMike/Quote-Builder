/* apmg-quote-service — APMG_TAKEOFF JSON -> priced quote -> Airtable, no browser.
   GET  /health          -> { ok, engine, version }
   POST /quote           -> price + push to Airtable (Authorization: Bearer QUOTE_API_KEY)
   POST /price           -> same, push forced off (pure pricing) */
import { priceTakeoff, QuoteError, ENGINE_DATE } from './quote.js';
import { pushQuote } from './airtable.js';

export const VERSION = '1.0.0';
const DEFAULT_ORIGIN = 'https://awningmike.github.io';

function corsHeaders(env, req) {
  const allowed = (env && env.ALLOWED_ORIGIN) || DEFAULT_ORIGIN;
  const origin = req && req.headers.get('Origin');
  const h = {
    'Access-Control-Allow-Origin': origin && origin === allowed ? origin : allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  return h;
}
function json(body, status, extra) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, extra || {}) });
}
function authorized(req, env) {
  const key = env && env.QUOTE_API_KEY;
  if (!key) return false;
  const h = req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const given = m[1].trim();
  if (given.length !== key.length) return false;
  let diff = 0; for (let i = 0; i < key.length; i++) diff |= given.charCodeAt(i) ^ key.charCodeAt(i);
  return diff === 0;
}

/* One request's work, DOM-free and fetch-injectable (tests pass a fake fetch). */
export async function handleQuote(body, env, deps, forcePriceOnly) {
  if (!body || typeof body !== 'object') throw new QuoteError(400, 'Body must be a JSON object: { takeoff, options? }');
  const options = Object.assign({}, body.options || {});
  if (forcePriceOnly) { options.push = false; }
  const priced = await priceTakeoff(body.takeoff, options, env, deps);
  const out = {
    ok: true, quoteId: priced.state.hdr['hdr-nbquote'] || null, created: false, pushed: false,
    items: priced.items, totals: priced.totals, state: priced.state, margin: priced.margin, marginInfo: priced.marginInfo,
    oneWayMiles: priced.oneWayMiles, warnings: priced.warnings, steps: priced.steps, imported: priced.imported,
  };
  const doPush = options.push !== false && !options.dryRun && !forcePriceOnly;
  if (doPush) {
    const r = await pushQuote(priced, { recordId: options.recordId, markSent: !!options.markSent }, env, deps);
    out.quoteId = r.quoteId; out.created = r.created; out.pushed = true; out.airtable = { name: r.name, url: r.url };
    out.steps.push(...r.steps);
    out.state = priced.state;   // hdr-nbquote now carries the record ID
  } else {
    out.steps.push(forcePriceOnly ? 'pricing only (no Airtable)' : options.dryRun ? 'dry run — Airtable not touched' : 'push off — Airtable not touched');
  }
  return out;
}

export default {
  async fetch(req, env, ctx) {
    void ctx;
    const url = new URL(req.url);
    const cors = corsHeaders(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/health' && req.method === 'GET') return json({ ok: true, engine: ENGINE_DATE, version: VERSION }, 200, cors);
    if (url.pathname === '/quote' || url.pathname === '/price') {
      if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405, cors);
      if (!authorized(req, env)) return json({ ok: false, error: 'Unauthorized' }, 401, cors);
      let body;
      try { body = await req.json(); } catch (e) { return json({ ok: false, error: 'Body is not valid JSON' }, 400, cors); }
      try {
        const out = await handleQuote(body, env, null, url.pathname === '/price');
        return json(out, 200, cors);
      } catch (e) {
        const status = e && e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
        // never echo secrets: messages here are our own or Airtable's error text
        return json({ ok: false, error: e && e.message ? e.message : 'Internal error' }, status, cors);
      }
    }
    return json({ ok: false, error: 'Not found' }, 404, cors);
  },
};
