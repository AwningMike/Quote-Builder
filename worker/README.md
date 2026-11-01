# apmg-quote-service (Cloudflare Worker)

Turns an **APMG_TAKEOFF v1** JSON (what the canopy-takeoff step produces) into a priced quote
and pushes it to the **Flow Digital Migration Base** in Airtable — with no browser.

It bundles the Quote Builder's own engine (`../engine/quote-engine.js`), so every line amount,
the margin snap, delivery, tax and the grand total are the same numbers the page prints. The
result includes a **Quote Builder State** object identical in shape to what the page's
`captureQuoteState()` saves, so the quote reopens in the page from Airtable
(Quotes → From Airtable → Open).

What it does, in Mike's standing order:

1. `importTakeoff(takeoff)` → quote line items (same rounding / face / group / sub text as the page's Import Takeoff; no manufacturer names).
2. `applyMargin(items, margin)` on the canopy lines (the page's "Set to N×" button). Margin comes from `resolveMargin()` — see **Margin**.
3. Delivery miles: `options.miles` (one-way) if given, else geocode `job.cityStateZip` with Open-Meteo and route from the shop with OSRM, exactly like the page's "Auto-calc from Ship To city" button (straight-line × 1.25 fallback). See **Miles convention**.
4. Extras: lift (default `$1,500`), survey **on** (`$500`), stamped engineering per `options.stamped` (`$1,250`), Ohio county rate from `job.county` when `job.state` is OH, Indiana 7% materials flag when IN, any other state flagged in `warnings`.
5. `computeTotals(items, extras)` — the page's renderQuote math.
6. Builds the Quote Builder State (`v`, `savedAt`, `items`, `hdr`, `extraVals`, `extraChecks`). Terms `30% Down, Balance per Contract`, company `SA`, date = today (Indianapolis). `hdr-to` is **blank** when the takeoff warnings say 2+ GCs are bidding, or when `options.to === ''`.
7. Unless `dryRun` / `push:false` / `/price`: pushes to Airtable the way the page's `pushToAirtable()` does — find the job (`options.recordId`) or create Quote Request + Quote, replace the line items (with Builder Line Total + Quote Inventory links), update the quote (state JSON, Contract Amount, sqft, distance, Bid Status rule, margin snapshot + Margin History line, `Quote Built Out?` only when `markSent`), fill blank address / bid-due fields on the Quote Request. **It never uploads a PDF and never touches the Quote PDF field** — the desktop step does that.

## Endpoints

| Method | Path      | Auth | Does |
|--------|-----------|------|------|
| GET    | `/health` | none | `{ ok:true, engine:"10/02/26", version:"1.0.0" }` — `engine` is the EMS price-book date the bundled engine prices from |
| POST   | `/quote`  | `Authorization: Bearer <QUOTE_API_KEY>` | price + push to Airtable |
| POST   | `/price`  | same | same as `/quote` with push forced off (pure pricing, handy for tests) |

CORS is open to `https://awningmike.github.io` (the GitHub Pages Quote Builder) — change `ALLOWED_ORIGIN` in `wrangler.toml`.

### Request body

```json
{
  "takeoff": { "format": "APMG_TAKEOFF", "version": 1, "job": { "...": "..." }, "canopies": [ "..." ], "warnings": [ "..." ] },
  "options": {
    "margin": 3.25,          // multiplier for canopy lines; default = DEFAULT_MARGIN var (3.25)
    "lift": 1500,            // $ lift charge; default DEFAULT_LIFT (1500); 0 = none
    "survey": true,          // default true ($500)
    "stamped": false,        // default false ($1,250 when true)
    "scupper": false,        // the page's "scupper" checkbox (state only)
    "miles": 144,            // ONE-WAY miles shop → site; overrides geocoding
    "to": "Brent Anderson",  // overrides the takeoff's To:; "" forces it blank
    "recordId": "recUJElazgmmRxcWx",  // Quotes/Work Orders record to update; omitted = create Quote Request + Quote
    "markSent": false,       // true = Bid Status "Quote Sent" + Quote Sent Date today + Quote Built Out?
    "push": true,            // false = price only
    "dryRun": false          // true = price only (alias)
  }
}
```

The takeoff can also carry the record ID itself (`takeoff.recordId` or `takeoff.job.recordId`),
same as the page.

Validation: `takeoff` must be an object; `format` (if present) must be `APMG_TAKEOFF`, `version`
(if present) must be `1`, `canopies` must be a non-empty array → otherwise `400` / `422` with a
plain-English `error`. Lines the page's importer would skip (standing seam entered by hand, a
canopy missing `widthIn`/`projIn`, more than 5 legs) are listed in `warnings`; if nothing is
left to price the call is `422`.

### Response

```json
{
  "ok": true,
  "quoteId": "recUJElazgmmRxcWx",   // Airtable record (null when not pushed and none was given)
  "created": false,                 // true when the job was created
  "pushed": true,
  "airtable": { "name": "Chipotle (Shell) - Dry Ridge, KY", "url": "https://airtable.com/app…/tbl…/rec…" },
  "margin": 3.25,                   // the multiplier actually used
  "marginInfo": { "m": 3.25, "material": 1759.23, "factor": 0.81, "sellBefore": 7038, "sellTarget": 5717.5 },
  "oneWayMiles": 144,
  "items": [ "… quote line items (title, sub, group, amount, labor, lightsCost, …, spec) …" ],
  "totals": { "total": 10374, "taxableMaterials": 6386, "installation": 1988, "deliveryCost": 612, "survey": 500, "lift": 1500, "stamped": 0, "tax": 0, "taxOn": false, "…": "…" },
  "state": { "v": 1, "savedAt": "…", "items": [], "hdr": { "hdr-shipname": "…", "…": "…", "hdr-nbquote": "rec…" }, "extraVals": { "extra-miles": "288", "…": "…" }, "extraChecks": { "extra-survey-on": true, "…": true } },
  "warnings": [ "takeoff warnings + tax / miles / skipped-line notes" ],
  "steps": [ "imported 2 line(s)", "margin 3.25× on 2 canopy line(s) (…)", "miles 144 one-way / 288 round trip (given)", "…", "2 line items (replaced 2 old)", "price $10,374 · Bid Status → Ready to Quote" ],
  "imported": { "added": [], "skipped": [], "info": [] }
}
```

Errors: `{ ok:false, error:"…" }` with `400` (bad input), `401` (bad/missing bearer), `404`
(linked record cannot be opened), `405`, `422` (nothing priceable / margin cannot be set),
`500` (missing secret), `502` (Airtable said no).

## Margin

`resolveMargin(options, env, items)` in `src/quote.js` is the **one** place that decides the
multiplier: `options.margin` → `DEFAULT_MARGIN` var → `3.25`. Change the default in
`wrangler.toml` `[vars]` (or in the Cloudflare dashboard → Settings → Variables) — no code
deploy needed. The multiplier used is echoed as `margin` in the response and in the Margin
History line written to Airtable (`… · Quote Service (3.25× margin) · sell $… · canopy sell $… · material $… · NN.N% material (target 42.5%)`).
When Mike moves to tiered multipliers (by canopy size / engineering) that function grows into a
table; `items` is already passed in for that.

## Miles convention (one-way vs round trip)

- **`options.miles` is ONE-WAY** (shop → site). That is how Mike thinks about it and how the
  engine's rate is defined (`RATES.jobLevel.deliveryRate` = `$4.25` per **one-way** mile beyond a
  70-mile one-way flat zone of `$250`).
- The Quote Builder page stores **round trip** in the `extra-miles` box (`calcDeliveryMiles()`
  sets `Math.round(oneWay * 2)`), and the engine's `deliveryCost(miles)` halves it back
  (`oneWayMi = miles / 2`) before charging. So the worker writes
  `extraVals['extra-miles'] = String(Math.round(oneWay * 2))` — the saved state reopens in the
  page with the same number the page would have produced, and the charge is one-way × $4.25.
- Proof from the saved Chipotle quote (recUJElazgmmRxcWx): its box says `288`; Dry Ridge, KY is
  ~144 mi from the shop; delivery = ceil(144 × 4.25) = $612 and the saved Sale Price $9,734 only
  reconciles with 288 as a round trip (see `test/chipotle.test.mjs`).
- Airtable `Distance` (Quote and Quote Request) gets the same round-trip box value the page sends.

## Secrets (names only — never commit values)

| Secret           | Used for |
|------------------|----------|
| `AIRTABLE_TOKEN` | Airtable personal access token, `data.records:read` + `data.records:write` on base `appgkGZ1G6YeHOVAi` |
| `QUOTE_API_KEY`  | the bearer token callers must send on `/quote` and `/price` |

Set them with `npx wrangler secret put AIRTABLE_TOKEN` / `npx wrangler secret put QUOTE_API_KEY`
or in the dashboard (Worker → Settings → Variables and Secrets). For local `wrangler dev`, put
them in `worker/.dev.vars` (git-ignored). Non-secret settings live in `wrangler.toml` `[vars]`:
`DEFAULT_MARGIN`, `DEFAULT_LIFT`, `DEFAULT_SURVEY`, `DEFAULT_STAMPED`, `ALLOWED_ORIGIN`, `AIRTABLE_BASE_ID`.

## Deploying from GitHub (Cloudflare Workers Builds)

1. Cloudflare dashboard → Workers & Pages → Create → **Import a repository** → pick `Quote-Builder`.
2. Settings: **Root directory** `worker`, **Build command** *(none)*, **Deploy command**
   `npx wrangler deploy`. (Wrangler is a devDependency, so Workers Builds' `npm install` makes it available; the engine is pulled in from `../engine/quote-engine.js` at bundle time.)
3. Add the two secrets above and adjust `[vars]` if needed. Every push to the production branch
   redeploys; other branches get preview builds.

Manual: `cd worker && npm install && npx wrangler login && npx wrangler deploy`.

## Local checks

```
cd worker
npm install
npm test                                   # node --test, no network (46 tests)
npx wrangler deploy --dry-run --outdir dist   # proves it bundles (~104 KiB, 28.5 KiB gzip)
npx wrangler dev                           # local server on :8787 (needs .dev.vars)
```

## curl example

```bash
curl -s https://apmg-quote-service.<account>.workers.dev/quote \
  -H "Authorization: Bearer $QUOTE_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
{
  "takeoff": {
    "format": "APMG_TAKEOFF", "version": 1,
    "job": { "projectName": "Chipotle (Shell) - Dry Ridge, KY", "projectNo": "BCP002", "shipName": "Chipotle - CMG Dry Ridge Shell",
             "address": "77 Blackburn Lane", "cityStateZip": "Dry Ridge, KY 41035", "state": "KY", "county": "Grant",
             "gc": "Derek, Inc.", "to": "Brent Anderson", "color": "Black (match storefront)", "bidDue": "10/28/2026 2:00 PM",
             "customer": { "email": "bids@deohio.com", "phone": "(513) 667-2351" } },
    "canopies": [
      { "mark": "PU", "name": "Pick-up window canopy (north elev)", "sheet": "A403", "type": "canopy", "qty": 1, "face": 6, "widthIn": 127, "projIn": 42, "lights": 1, "downspouts": 0, "posts": 0 },
      { "mark": "ME", "name": "Main entry canopy (west elev)",      "sheet": "A140", "type": "canopy", "qty": 1, "face": 6, "widthIn": 127, "projIn": 42, "lights": 1, "downspouts": 0, "posts": 0 }
    ],
    "warnings": [ "Chipotle standard: face 6, no C-channel." ]
  },
  "options": { "recordId": "recUJElazgmmRxcWx", "miles": 144 }
}
EOF
```

Replace `/quote` with `/price` to see the numbers without writing to Airtable.

## Tests (`worker/test/`, plain `node --test`, no network)

- `pricing.test.mjs` — for each of the 13 saved Quote Builder State fixtures in `engine/fixtures/`
  an APMG_TAKEOFF is rebuilt from the saved specs and run through the worker; items and totals must
  equal `importTakeoff` + `applyMargin` + `computeTotals` called directly (10 fixtures; the 3
  standing-seam-only quotes are checked to be rejected cleanly, since the page's Import Takeoff
  doesn't take that type either). Also tax flags per state, Ohio county lookup, margin resolution,
  one-way/round-trip miles, stubbed geocoding, the 2+ GCs rule and input validation.
- `chipotle.test.mjs` — end-to-end against the saved Chipotle quote: 3×, lift 750, survey on,
  144 mi one-way → every line amount and the $9,734 total match to the dollar; lift 1,500 →
  $10,484; the "288 as one-way" reading → $10,346 (documented delta); 3.25× case equals the engine.
- `airtable.test.mjs` — the push with a recording fake fetch: request sequence and every field ID
  for the linked-record and create-job paths, markSent, failure handling, dryRun / `/price`.
- `http.test.mjs` — auth, CORS, routing, error shapes through the Worker's `fetch` handler.

## Not ported from newbase.js (on purpose)

- Quote PDF generation / upload (`generateQuotePdfBase64`, `uploadAttachment`) — browser-only; the
  Quote PDF field is left untouched.
- The install-labor half of the margin snapshot (`getInstallerFeed` / `computeInstallerCost`) —
  needs the page's Installer Pay feed; the worker writes the material-only snapshot and leaves
  Labor Cost / Travel Cost / Margin w/ Labor blank.
- UI only: job picker, badges, confirm dialogs, cloud save on 💾, price sync, backfill.
