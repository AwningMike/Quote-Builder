/* APMG Quote Engine — headless pricing for the canopy Quote Builder.
   ------------------------------------------------------------------------------------
   ONE source of truth for every dollar the Quote Builder prints. The page
   (canopy_quote_calculator.html) loads this file as a classic <script> and reads
   `window.QuoteEngine`; Node (18+) loads it with require() or `import` (the CommonJS
   exports are detected by Node's ESM loader, so `import { priceCanopy } from
   './quote-engine.js'` works from an .mjs file). No DOM, no network, no deps.

   Pure functions:
     priceCanopy(spec, opts)        -> computeCanopy() result (materialsTotal, labor, bd, …)
     priceStandingSeam(spec, opts)  -> computeStandingSeam() result
     priceFabric(spec, opts)        -> computeFabric() result
     priceSunshade(spec, opts)      -> computeSunshade() result
     priceRecover(spec, opts)       -> computeRecover() result
     pricePatio(spec, opts)         -> computePatio() result (custom-priced: $ typed by Mike)
     priceItem(item, opts)          -> the rounded $ fields that live on a quote line item
                                       ({amount, labor, paintCost, downspoutCost, …, bd})
     buildItem(type, spec, meta)    -> a complete quote item (title/sub/group + priceItem fields)
     computeTotals(items, extras)   -> renderQuote()'s math (installation, delivery, tax, total …)
     deliveryCost(miles, rates)     -> job delivery $ from ROUND-TRIP miles
     importTakeoff(data)            -> APMG_TAKEOFF v1 JSON -> { items, hdr, extraVals, extraChecks, … }

   Rounding is identical to the page: line amounts are Math.ceil'd when the item is
   created, delivery/tax/survey/lift/stamped are Math.ceil'd, and the grand total is the
   sum of those already-rounded parts.
   ------------------------------------------------------------------------------------ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { factory(module.exports); }
  else { root.QuoteEngine = factory({}); }
}(typeof self !== 'undefined' ? self : this, function (exports) {
'use strict';

/* ---------------- RATE MODEL (verbatim from the page) ----------------
   Confirmed with shop: install labor is $65/ft for both 8" and 12" face.
   8" Face MFG = $95/sqft all tiers. 12" Face MFG = $105/sqft all tiers.
   The page's Rate Settings panel edits THIS object in place, so the page and the
   engine always price from the same numbers. */
const RATES = {
  jobLevel: {
    deliveryRate: 4.25,        // $/mile (ONE-WAY miles, per Mike 09/24/26) — applies only beyond the flat zone
    flatDeliveryUnderMi: 70,   // one-way miles — under this, delivery is a flat charge
    flatDeliveryPrice: 250,    // the flat delivery charge inside the zone
  },
  canopy8: {
    laborPerFt: 65,
    tiers: [
      { key:'t1', name:"Tier 1 · <5' Proj / <10' Width",  mfg:95, lights:275, downspout:650, cchannel:30, outrigger:30, miter:500, post:650 },
      { key:'t2', name:"Tier 2 · <5' Proj / 10'+ Width",  mfg:95, lights:275, downspout:650, cchannel:30, outrigger:30, miter:500, post:650 },
      { key:'t3', name:"Tier 3 · >5' Proj / <10' Width",  mfg:95, lights:275, downspout:650, cchannel:30, outrigger:30, miter:2500, post:650 },
      { key:'t4', name:"Tier 4 · >5' Proj / 10'+ Width",  mfg:95, lights:275, downspout:650, cchannel:30, outrigger:30, miter:2500, post:650 },
    ]
  },
  canopy12: {
    laborPerFt: 65,
    tiers: [
      { key:'t1', name:"Tier 1 · <5' Proj / <10' Width",  mfg:105, lights:400, downspout:650, cchannel:30, outrigger:30,  miter:500, post:650 },
      { key:'t2', name:"Tier 2 · <5' Proj / 10'+ Width",  mfg:105, lights:275, downspout:650, cchannel:30, outrigger:30,  miter:500, post:650 },
      { key:'t3', name:"Tier 3 · >5' Proj / <10' Width",  mfg:105, lights:275, downspout:650, cchannel:30, outrigger:45,  miter:500, post:650 },
      { key:'t4', name:"Tier 4 · >5' Proj / 10'+ Width",  mfg:105, lights:275, downspout:650, cchannel:30, outrigger:150, miter:500, post:650 },
    ]
  },
  standingSeam: { mfgPerFt:195, endsRate:150, valancePerFt:15, laborPerFt:45 },
  fabric:        { mfgPerFt:75, laborPerFt:45, mfgPerSqft:35 },   // $75 per lineal ft of WIDTH (confirmed 07/2026); optional $35/sqft mode (per Mike 10/01/26)
  sunshade:      { mfgPerSqft:95, laborPerFt:65 },
  recover: {
    fabrics: {
      sunbrella: { yd:33, label:'Sunbrella 60"' },
      ferrari:   { yd:38, label:'Ferrari 74"' },
      majestic:  { yd:30, label:'Majestic 80" (translucent)' },
      cooley:    { yd:55, label:'Cooley 70"' },
    },
    markup: 2.5,
    graphic1: 150,
    graphic2: 250,
    retrofitRate: 15,   // $/ft of width, additional, when selected (09/26)
    skinRate: 10,       // $/ft; covered ends add projection x 2 ft (09/26)
    takedownRate: 20,   // $/ft of width - take down / rehang (09/26)
    surveyDefault: 450, // recover survey default (09/26)
    dropExtraFt: 0.5,   // +6" of fabric width per pass for the drop - pricing only
    deliveryRate: 3.75,
  }
};

/* Constants that live outside RATES on the page (hard-coded in the compute functions). */
const CONST = {
  PAINT_PER_SQFT: 9,          // $9.00/sqft averaged paint adder, baked into the canopy price (per Mike 09/16/26)
  POST_DEFAULT: 650,          // $/post when a tier has no post rate; also fabric + patio posts
  PATIO_LIGHT: 275,           // patio canopy lights $/ea
  PATIO_DOWNSPOUT: 650,       // patio canopy downspouts $/ea
  PATIO_SQFT_RATE: 35,        // sunshade "Patio Canopy variant" + recover "Patio Canopy" $/sqft
  INDIANA_TAX_PERCENT: 7,     // Indiana: 7% on materials (canopies + downspouts + lights + posts) only
  SURVEY_DEFAULT: 500,        // job-level survey default
  STAMPED_DEFAULT: 1250,      // stamped engineering default
  TIER_WIDTH_FT: 10,          // pickTier: width >= 10 ft = "10'+ Width"
  TIER_PROJ_FT: 5,            // pickTier: projection >= 5 ft = ">5' Proj"
  CUSTOM_FASCIA_OVER_IN: 12,  // face > 12" = custom fascia, priced perimeter x tier.cchannel ($30/ft)
};

// Combined Ohio sales tax rate (5.75% state + county local rate) by county, as of mid-2026.
// OHIO: tax applies to EVERY line (materials, install, survey, lift, engineering).
const OHIO_COUNTY_RATES = [
  ["Adams",7.25],["Allen",6.75],["Ashland",7.00],["Ashtabula",6.75],["Athens",7.25],
  ["Auglaize",7.25],["Belmont",7.25],["Brown",7.25],["Butler",6.50],["Carroll",6.75],
  ["Champaign",7.25],["Clark",7.25],["Clermont",6.75],["Clinton",7.25],["Columbiana",7.25],
  ["Coshocton",7.75],["Crawford",7.25],["Cuyahoga",8.00],["Darke",7.25],["Defiance",6.75],
  ["Delaware",7.00],["Erie",6.75],["Fairfield",6.75],["Fayette",7.25],["Franklin",8.00],
  ["Fulton",7.25],["Gallia",7.25],["Geauga",6.75],["Greene",6.75],["Guernsey",7.25],
  ["Hamilton",7.80],["Hancock",6.75],["Hardin",7.25],["Harrison",7.25],["Henry",7.25],
  ["Highland",7.25],["Hocking",7.25],["Holmes",7.00],["Huron",7.25],["Jackson",7.25],
  ["Jefferson",7.25],["Knox",7.25],["Lake",6.50],["Lawrence",7.25],["Licking",7.25],
  ["Logan",7.25],["Lorain",6.50],["Lucas",7.75],["Madison",7.00],["Mahoning",7.50],
  ["Marion",7.25],["Medina",6.75],["Meigs",7.25],["Mercer",7.25],["Miami",7.00],
  ["Monroe",7.25],["Montgomery",7.50],["Morgan",7.25],["Morrow",7.25],["Muskingum",7.25],
  ["Noble",7.25],["Ottawa",7.00],["Paulding",7.25],["Perry",7.25],["Pickaway",7.25],
  ["Pike",7.25],["Portage",6.75],["Preble",7.25],["Putnam",7.00],["Richland",7.00],
  ["Ross",7.25],["Sandusky",7.25],["Scioto",7.25],["Seneca",7.25],["Shelby",7.25],
  ["Stark",6.50],["Summit",6.25],["Trumbull",6.75],["Tuscarawas",6.75],["Union",7.00],
  ["Van Wert",7.25],["Vinton",7.25],["Warren",6.75],["Washington",7.25],["Wayne",6.50],
  ["Williams",7.25],["Wood",6.75],["Wyandot",7.25]
];

const GROUP_CANOPY  = 'Metal-Tech Canopy - Fully welded construction';
const GROUP_FABRIC  = 'Fabric Awnings';
const GROUP_SS      = 'Standing Seam Awning - Fully welded construction';
const GROUP_PATIO   = 'Metal Patio Canopy - Fully welded construction';
const GROUP_RAILING = 'Aluminum Patio Railing - Fully welded construction';

/* ---------------- helpers ---------------- */
const num = (v, d) => { const n = parseFloat(v); return isNaN(n) ? (d || 0) : n; };
const ceil = (n) => Math.ceil(n);
function ratesOf(opts){ return (opts && opts.rates) || RATES; }

// "10'-7\"" -> 127 ; "3'" -> 36 ; "7\"" -> 7 ; "" -> 0   (inverse of the page's ftInLabel)
function parseFtInInches(str){
  if(str === null || str === undefined) return 0;
  if(typeof str === 'number') return str;
  const s = String(str).trim();
  if(!s) return 0;
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft)?\s*(?:-\s*)?(?:(\d+(?:\.\d+)?)\s*(?:"|″|in)?)?\s*$/);
  if(m && (s.includes("'") || s.includes('ft'))) return num(m[1])*12 + num(m[2]);
  const inOnly = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|″|in)$/);
  if(inOnly) return num(inOnly[1]);
  if(m) return num(m[1])*12 + num(m[2]);
  return 0;
}
// same formatting as the page's ftInLabel()/decFeetLabel() — from whole inches
function ftInLabel(totalIn){
  const tot = Math.max(0, Math.round(+totalIn||0));
  const ft = Math.floor(tot/12), inch = tot%12;
  if(ft===0 && inch>0) return `${inch}"`;
  if(inch>0) return `${ft}'-${inch}"`;
  return `${ft}'`;
}
// width in feet from a spec that may carry widthFt, widthIn or only widthStr
function specFt(spec, ftKey, inKey, strKey){
  if(spec[ftKey] !== undefined && spec[ftKey] !== null && spec[ftKey] !== '') return num(spec[ftKey]);
  if(spec[inKey] !== undefined && spec[inKey] !== null && spec[inKey] !== '') return num(spec[inKey])/12;
  return parseFtInInches(spec[strKey])/12;
}

/* ---------------- TIER AUTO-DETECT ---------------- */
function pickTier(tiers, widthFt, projFt){
  const wideEnough = widthFt >= CONST.TIER_WIDTH_FT;
  const projEnough = projFt >= CONST.TIER_PROJ_FT;
  if(!projEnough && !wideEnough) return tiers[0];
  if(!projEnough && wideEnough) return tiers[1];
  if(projEnough && !wideEnough) return tiers[2];
  return tiers[3];
}
// which rate section a canopy prices on: the 8" tab (6"/8" face) or the 12" tab (10"/12"/custom)
function canopySection(spec){
  if(spec.section === 'canopy8' || spec.section === 'canopy12') return spec.section;
  const face = num(spec.face, 8) || 8;
  return face <= 8 ? 'canopy8' : 'canopy12';
}

/* ---------------- CANOPY (8"/12" face, mitered, tapered, custom fascia) ----------------
   spec (as saved in Quote Builder State items[].spec):
     qty, widthFt, projFt (AVERAGE depth when tapered), tapered, proj1Ft, proj2Ft, projMaxFt,
     face (inches), mitered, legCount, legs:[{wFt,pFt,taper,p1Ft,p2Ft}], downspoutPerUnit,
     lightsPerUnit, postsPerUnit, cchannelPerUnit (lin ft per unit, already perimeter if auto),
     outriggerPerUnit (qty per unit, default 0), fasciaAdd ($ manual "Added Fascia", default 0),
     paintOn (default true), customFasciaIn (default: face when face > 12), section (optional). */
function priceCanopy(spec, opts){
  const rates = ratesOf(opts);
  const sectionKey = canopySection(spec);
  const cfg = rates[sectionKey];
  const mitered = !!spec.mitered;
  const qty = Math.max(1, num(spec.qty, 1) || 1);

  let legs = [];
  if(mitered){
    const src = Array.isArray(spec.legs) ? spec.legs : [];
    for(const l of src){
      const p1 = num(l.p1Ft !== undefined && l.p1Ft !== null ? l.p1Ft : l.pFt);
      const p2 = num(l.p2Ft);
      const lt = l.taper !== undefined ? !!l.taper : (p2 > 0 && Math.abs(p2 - p1) > 0.001);
      legs.push({ wFt:num(l.wFt), pFt: lt ? (p1+p2)/2 : p1, p1Ft:p1, p2Ft: lt ? p2 : null, taper: lt });
    }
  } else {
    const w = specFt(spec, 'widthFt', 'widthIn', 'widthStr');
    const p = specFt(spec, 'projFt', 'projIn', 'projStr');
    legs = [{ wFt:w, pFt:p, p1Ft:p, p2Ft:null, taper:false }];
  }
  const legCount = mitered ? legs.length : 1;
  const miterTapered = mitered && legs.some(l=>l.taper);
  // single-run taper: priced on the AVERAGE depth, deepest end sets the tier
  const singleTaper = !mitered && !!spec.tapered && spec.proj1Ft !== null && spec.proj1Ft !== undefined
                      && spec.proj2Ft !== null && spec.proj2Ft !== undefined;
  const proj1Ft = singleTaper ? num(spec.proj1Ft) : (legs[0] ? legs[0].pFt : 0);
  const proj2Ft = singleTaper ? num(spec.proj2Ft) : 0;
  const tapered = !mitered && proj2Ft > 0 && Math.abs(proj2Ft - proj1Ft) > 0.001;
  const projAvgFt = tapered ? (proj1Ft + proj2Ft)/2 : proj1Ft;
  if(tapered) legs[0] = { wFt: legs[0].wFt, pFt: projAvgFt };
  const widthFt = legs.reduce((a,l)=>a+l.wFt, 0);
  const projFt  = tapered ? Math.max(proj1Ft, proj2Ft)
                : mitered ? legs.reduce((m,l)=>Math.max(m, l.p1Ft||l.pFt, l.p2Ft||0), 0)
                          : legs.reduce((m,l)=>Math.max(m,l.pFt), 0);
  const sqft    = legs.reduce((a,l)=>a + l.wFt*l.pFt, 0);

  const lights = num(spec.lightsPerUnit);
  const downspout = num(spec.downspoutPerUnit);
  const posts = num(spec.postsPerUnit);
  const outrigger = num(spec.outriggerPerUnit);
  const fascia = num(spec.fasciaAdd);

  const perimFt = mitered ? (widthFt + (legs[0].p1Ft||legs[0].pFt) + (legs[legs.length-1].p1Ft||legs[legs.length-1].pFt))
                : tapered ? (widthFt + proj1Ft + proj2Ft)
                : (widthFt + 2*projFt);
  const cchannelPerim = !!spec.cchannelPerimeter;
  const cchannel = cchannelPerim ? perimFt : num(spec.cchannelPerUnit);
  const tier = pickTier(cfg.tiers, widthFt, projFt);
  // custom / large fascia (> 12") — priced like C-Channel: perimeter × tier.cchannel
  const face = num(spec.face, 8) || 8;
  const cfIn = spec.customFasciaIn !== undefined && spec.customFasciaIn !== null
             ? num(spec.customFasciaIn) : (face > CONST.CUSTOM_FASCIA_OVER_IN ? face : 0);
  const cfOn = cfIn > 0;
  const customFasciaFt = perimFt;
  const customFasciaCost = cfOn ? customFasciaFt * tier.cchannel * qty : 0;

  const mfgBase = sqft*tier.mfg*qty;
  const lightsCost = lights*tier.lights*qty;
  const downspoutCost = downspout*tier.downspout*qty;
  const postsCost = posts*(tier.post||CONST.POST_DEFAULT)*qty;
  const cchannelCost = cchannel*tier.cchannel*qty;
  const outriggerCost = outrigger*tier.outrigger*qty;
  const fasciaCost = fascia*qty + customFasciaCost;
  const paintOn = spec.paintOn === undefined || spec.paintOn === null ? true : !!spec.paintOn;
  const paintCost = paintOn ? sqft*CONST.PAINT_PER_SQFT*qty : 0;
  const materialsTotal = mfgBase + cchannelCost + outriggerCost + fasciaCost + paintCost;
  const labor = widthFt*cfg.laborPerFt*qty;

  return { materialsTotal, labor, paintCost, downspoutCost, downspoutQty: downspout*qty, downspoutPerUnit: downspout,
    lightsCost, lightsQty: lights*qty, lightsPerUnit: lights, postsCost, postsQty: posts*qty, postsPerUnit: posts,
    cchannelPerUnit: cchannel, cchannelPerim, tier, widthFt, projFt, qty, mitered, legs, legCount,
    tapered, proj1Ft, proj2Ft, projAvgFt, miterTapered, sqft, perimFt,
    sectionKey, face, customFasciaOn: cfOn, customFasciaIn: cfIn, customFasciaFt, customFasciaCost,
    mfgBase, cchannelCost, outriggerCost, fasciaCost, fasciaManual: fascia*qty, outrigger, paintOn,
    bd: { sqft: sqft*qty, mfg: mfgBase, cchannelCost, cchannelFt: cchannel*qty, outriggerCost, outriggerFt: outrigger*qty,
          miterCost:0, miterQty:0, fasciaCost, paintCost, labor, laborFt: widthFt*qty } };
}

/* ---------------- PATIO (custom-priced: Mike types MFG $ and install $ per unit) ----------------
   spec: product 'canopy'|'railing', qty, mfgPerUnit, installPerUnit, widthFt/projFt (canopy),
         lightsPerUnit, downspoutPerUnit, postsPerUnit (canopy), lenFt/heightIn (railing) */
function pricePatio(spec, opts){
  const qty = Math.max(1, num(spec.qty, 1) || 1);
  const mfg = num(spec.mfgPerUnit);
  const install = num(spec.installPerUnit);
  const product = spec.product || (spec.lenFt !== undefined || spec.lengthStr !== undefined ? 'railing' : 'canopy');
  if(product === 'canopy'){
    const widthFt = specFt(spec, 'widthFt', 'widthIn', 'widthStr'), projFt = specFt(spec, 'projFt', 'projIn', 'projStr');
    const sqft = widthFt*projFt;
    const lights = num(spec.lightsPerUnit), downspout = num(spec.downspoutPerUnit), posts = num(spec.postsPerUnit);
    const lightsCost = lights*CONST.PATIO_LIGHT*qty, downspoutCost = downspout*CONST.PATIO_DOWNSPOUT*qty, postsCost = posts*CONST.POST_DEFAULT*qty;
    const materialsTotal = mfg*qty, labor = install*qty;
    const perSqft = sqft>0 ? (mfg/sqft) : 0;
    return { product, widthFt, projFt, sqft, qty, mfg, install, perSqft, materialsTotal, labor,
      lightsCost, lightsQty: lights*qty, lightsPerUnit: lights,
      downspoutCost, downspoutQty: downspout*qty, downspoutPerUnit: downspout,
      postsCost, postsQty: posts*qty, postsPerUnit: posts };
  }
  const lenFt = specFt(spec, 'lenFt', 'lenIn', 'lengthStr');
  const heightIn = num(spec.heightIn, 36) || 36;
  const materialsTotal = mfg*qty, labor = install*qty;
  const perFt = lenFt>0 ? (mfg/lenFt) : 0;
  return { product, lenFt, heightIn, qty, mfg, install, perFt, materialsTotal, labor };
}

/* ---------------- STANDING SEAM ----------------  spec: qty, widthStr|widthFt|widthIn, ends, valanceIn */
function priceStandingSeam(spec, opts){
  const cfg = ratesOf(opts).standingSeam;
  const widthIn = spec.widthIn !== undefined && spec.widthIn !== null ? num(spec.widthIn)
                : (spec.widthFt !== undefined && spec.widthFt !== null ? num(spec.widthFt)*12 : parseFtInInches(spec.widthStr));
  const ends = num(spec.ends);
  const valanceIn = spec.valanceIn !== undefined && spec.valanceIn !== null ? num(spec.valanceIn) : parseFtInInches(spec.valanceStr);
  const qty = Math.max(1, num(spec.qty, 1) || 1);
  const widthFt = widthIn/12;
  const mfgBase = widthFt*cfg.mfgPerFt*qty;
  const endsCost = ends*cfg.endsRate*qty;
  const valanceCost = (valanceIn/12)*cfg.valancePerFt*qty;
  const materialsTotal = mfgBase + endsCost + valanceCost;
  const labor = widthFt*cfg.laborPerFt*qty;
  return { materialsTotal, labor, widthFt, ends, valanceIn, qty, mfgBase, endsCost, valanceCost };
}

/* ---------------- FABRIC ----------------  spec: qty, widthStr|widthFt|widthIn, projStr|projFt, priceMode 'perft'|'sqft', postsPerUnit
   NOTE: posts on a fabric line are NOT multiplied by qty on the page (posts*650) — reproduced as-is. */
function priceFabric(spec, opts){
  const cfg = ratesOf(opts).fabric;
  const widthIn = spec.widthIn !== undefined && spec.widthIn !== null ? num(spec.widthIn)
                : (spec.widthFt !== undefined && spec.widthFt !== null ? num(spec.widthFt)*12 : parseFtInInches(spec.widthStr));
  const widthFt = widthIn/12;
  const projFt = specFt(spec, 'projFt', 'projIn', 'projStr');
  const mode = spec.priceMode === 'sqft' ? 'sqft' : 'perft';
  const sqftMode = mode==='sqft';
  const sqft = widthFt*projFt;
  const qty = Math.max(1, num(spec.qty, 1) || 1);
  const posts = num(spec.postsPerUnit);
  const postsCost = posts*CONST.POST_DEFAULT;
  const materialsTotal = sqftMode ? sqft*cfg.mfgPerSqft*qty : widthFt*cfg.mfgPerFt*qty;
  const labor = widthFt*cfg.laborPerFt*qty;
  return { materialsTotal, labor, widthFt, projFt, qty, postsCost, postsQty: posts, priceMode: mode, sqft };
}

/* ---------------- SUNSHADE ----------------  spec: widthStr|widthFt, projStr|projFt, patio (flat $35/sqft variant) */
function priceSunshade(spec, opts){
  const cfg = ratesOf(opts).sunshade;
  const widthFt = specFt(spec, 'widthFt', 'widthIn', 'widthStr');
  const projFt = specFt(spec, 'projFt', 'projIn', 'projStr');
  const isPatio = !!spec.patio;
  const sqft = widthFt*projFt;
  const rate = isPatio ? CONST.PATIO_SQFT_RATE : cfg.mfgPerSqft;
  const materialsTotal = sqft*rate;
  const labor = projFt*cfg.laborPerFt;
  return { materialsTotal, labor, sqft, rate, widthFt, projFt, patio: isPatio };
}

/* ---------------- RECOVER ----------------
   spec: qty, widthStr|widthFt, projStr|projFt, heightStr, patio, passes (1), ends (0), fabric ('sunbrella'),
         graphic1 (qty), graphic2 (qty), retrofit, skin, skinEnds, takedown, delivery (qty), survey ($, 450)
   The whole item total (survey + mfg + delivery + install) is the line amount; no separate labor. */
function priceRecover(spec, opts){
  const cfg = ratesOf(opts).recover;
  const patio = !!spec.patio;
  const widthFt = specFt(spec, 'widthFt', 'widthIn', 'widthStr');
  const projFt = specFt(spec, 'projFt', 'projIn', 'projStr');
  const passes = spec.passes === undefined || spec.passes === null ? 1 : num(spec.passes);
  const ends = num(spec.ends);
  const fabricKey = cfg.fabrics[spec.fabric] ? spec.fabric : 'sunbrella';
  const g1 = num(spec.graphic1), g2 = num(spec.graphic2);
  const retrofitOn = !!spec.retrofit, skinOn = !!spec.skin, skinEnds = !!spec.skinEnds, takedownOn = !!spec.takedown;
  const delivery = num(spec.delivery);
  const survey = spec.survey === undefined || spec.survey === null ? cfg.surveyDefault : num(spec.survey);
  const qty = Math.max(1, parseInt(spec.qty, 10) || 1);

  const yardage = ((widthFt + cfg.dropExtraFt)*passes + ends*2)/3;
  const sqft = widthFt*projFt;
  const fabricRate = cfg.fabrics[fabricKey].yd;
  const graphicCost = g1*cfg.graphic1 + g2*cfg.graphic2;
  const materialCost = patio ? (sqft*CONST.PATIO_SQFT_RATE) : ((yardage*fabricRate)*cfg.markup);
  const mfgTotal = materialCost + graphicCost;
  const retrofitCost = retrofitOn ? widthFt*cfg.retrofitRate : 0;
  const skinFt = widthFt + (skinEnds ? projFt*2 : 0);
  const skinCost = skinOn ? skinFt*cfg.skinRate : 0;
  const takedownCost = takedownOn ? widthFt*cfg.takedownRate : 0;
  const deliveryCost = delivery*cfg.deliveryRate;
  const installTotal = retrofitCost + skinCost + takedownCost;
  const unitTotal = survey + mfgTotal + deliveryCost + installTotal;
  const grandTotal = unitTotal*qty;
  return { grandTotal, unitTotal, yardage, sqft, patio, qty, widthFt, projFt, fabricKey, fabricRate, materialCost, graphicCost,
    mfgTotal, retrofitCost, skinFt, skinCost, takedownCost, deliveryCost, installTotal, survey };
}

/* ---------------- ITEM-LEVEL DISPATCH ----------------
   Returns the rounded $ fields exactly as add*ToQuote() writes them onto a quote line item. */
function priceItem(item, opts){
  const type = item.type || 'canopy';
  const spec = item.spec || {};
  switch(type){
    case 'canopy': {
      const r = priceCanopy(spec, opts);
      return { amount: ceil(r.materialsTotal), paintCost: ceil(r.paintCost||0), labor: ceil(r.labor),
        downspoutCost: ceil(r.downspoutCost), downspoutQty: r.downspoutQty, lightsCost: ceil(r.lightsCost), lightsQty: r.lightsQty,
        postsCost: ceil(r.postsCost), postsQty: r.postsQty, bd: r.bd, _r: r };
    }
    case 'standingSeam': { const r = priceStandingSeam(spec, opts); return { amount: ceil(r.materialsTotal), labor: ceil(r.labor), _r: r }; }
    case 'fabric': { const r = priceFabric(spec, opts); return { amount: ceil(r.materialsTotal), labor: ceil(r.labor), postsCost: ceil(r.postsCost), postsQty: r.postsQty, _r: r }; }
    case 'sunshade': { const r = priceSunshade(spec, opts); return { amount: ceil(r.materialsTotal), labor: ceil(r.labor), _r: r }; }
    case 'recover': { const r = priceRecover(spec, opts); return { amount: ceil(r.grandTotal), _r: r }; }
    case 'patiocanopy': {
      if(spec.mfgPerUnit === undefined) return { amount: item.amount||0, labor: item.labor||0, lightsCost: item.lightsCost||0, lightsQty: item.lightsQty||0,
        downspoutCost: item.downspoutCost||0, downspoutQty: item.downspoutQty||0, postsCost: item.postsCost||0, postsQty: item.postsQty||0, passthrough: true };
      const r = pricePatio(Object.assign({product:'canopy'}, spec), opts);
      return { amount: ceil(r.materialsTotal), labor: ceil(r.labor), lightsCost: ceil(r.lightsCost), lightsQty: r.lightsQty,
        downspoutCost: ceil(r.downspoutCost), downspoutQty: r.downspoutQty, postsCost: ceil(r.postsCost), postsQty: r.postsQty, _r: r };
    }
    case 'patiorailing': {
      if(spec.mfgPerUnit === undefined) return { amount: item.amount||0, labor: item.labor||0, passthrough: true };
      const r = pricePatio(Object.assign({product:'railing'}, spec), opts);
      return { amount: ceil(r.materialsTotal), labor: ceil(r.labor), _r: r };
    }
    default:
      // unknown / hand-edited line: keep whatever dollars are on it
      return { amount: item.amount||0, labor: item.labor||0, passthrough: true };
  }
}

/* Build a complete quote line item (title / sub / group / spec / $) — mirrors add*ToQuote(). */
function tierShort(tier){ return tier.name.split('·')[1].trim(); }
function canopyFaceLabel(face){ return face > CONST.CUSTOM_FASCIA_OVER_IN ? `${face}"` : `${face}" Face`; }
function buildItem(type, spec, meta, opts){
  meta = meta || {};
  const p = priceItem({ type, spec }, opts);
  const r = p._r; delete p._r;
  const qty = spec.qty || 1;
  let title = meta.title, sub = '', group = meta.group;
  if(type === 'canopy'){
    const faceLabel = canopyFaceLabel(r.face);
    title = title || `${faceLabel} Canopy`;
    group = group === undefined ? GROUP_CANOPY : group;
    sub = `${faceLabel} · ${tierShort(r.tier)} · ${r.widthFt.toFixed(1)}ft × ${r.tapered ? `${r.proj1Ft.toFixed(1)}–${r.proj2Ft.toFixed(1)}ft TAPERED` : `${r.projFt.toFixed(1)}ft`}${r.miterTapered ? ' · TAPERED legs' : ''}${r.qty>1 ? ` · qty ${r.qty}` : ''}`;
    if(meta.customFasciaSub && r.face > CONST.CUSTOM_FASCIA_OVER_IN && r.bd.fasciaCost > 0) sub += ` · incl. ${r.face}″ custom fascia upcharge $${Math.round(r.bd.fasciaCost).toLocaleString()}`;
  } else if(type === 'standingSeam'){
    title = title || 'Standing Seam'; group = group === undefined ? GROUP_SS : group;
    sub = `Standing Seam · ${r.widthFt.toFixed(1)}ft width${r.qty>1 ? ` · qty ${r.qty}` : ''}`;
  } else if(type === 'fabric'){
    title = title || 'Fabric Awning'; group = group === undefined ? GROUP_FABRIC : group;
    sub = `Fabric · ${r.widthFt.toFixed(1)}ft width${r.priceMode==='sqft' ? ` · ${r.sqft.toFixed(0)} sqft @ $${ratesOf(opts).fabric.mfgPerSqft}/sqft` : ''}${r.qty>1 ? ` · qty ${r.qty}` : ''}`;
  } else if(type === 'sunshade'){
    title = title || 'Sunshade'; group = group === undefined ? '' : group;
    sub = `Sunshade · ${r.sqft.toFixed(1)} sqft`;
  } else if(type === 'recover'){
    title = title || 'Recover'; group = group === undefined ? '' : group;
    sub = (r.patio ? `Recover · Patio · ${r.sqft.toFixed(1)} sqft` : `Recover · ${r.yardage.toFixed(1)} yd`) + (r.qty>1 ? ` · qty ${r.qty}` : '');
  } else if(type === 'patiocanopy'){
    title = title || 'Metal Patio Canopy'; group = group === undefined ? GROUP_PATIO : group;
    sub = `Patio Canopy (custom priced) · ${r.widthFt.toFixed(1)}ft × ${r.projFt.toFixed(1)}ft${r.qty>1?` · qty ${r.qty}`:''}`;
  } else if(type === 'patiorailing'){
    title = title || 'Patio Railing'; group = group === undefined ? GROUP_RAILING : group;
    sub = `Patio Railing (custom priced) · ${r.lenFt.toFixed(1)} lin ft · ${r.heightIn}&quot; high${r.qty>1?` · qty ${r.qty}`:''}`;
  }
  const item = Object.assign({ id: meta.id || null, title, sub, group: group || '' }, p, { type, spec });
  if(type === 'canopy'){ item.faceInches = r.face; item.lineGroup = meta.lineGroup || null; item.ownLine = !!meta.ownLine; }
  if(meta.takeoffNote) item.takeoffNote = meta.takeoffNote;
  void qty;
  return item;
}

/* ---------------- JOB TOTALS (renderQuote math) ----------------
   extras: { extraVals:{'extra-miles','extra-lift','extra-ohio-county','extra-survey','extra-stamped', ...},
             extraChecks:{'extra-survey-on','extra-stamped-on','extra-tax','extra-delivery-only', ...} }
   (the objects saved in Quote Builder State) — or a flat object with those same keys. */
function deliveryCost(miles, rates){
  const jl = (rates || RATES).jobLevel;
  miles = num(miles);
  const oneWayMi = miles/2;
  const deliveryFlat = miles>0 && oneWayMi < jl.flatDeliveryUnderMi;
  const cost = miles<=0 ? 0 : (deliveryFlat ? jl.flatDeliveryPrice : Math.ceil(oneWayMi*jl.deliveryRate));
  return { miles, oneWayMi, deliveryFlat, deliveryCost: cost };
}
function computeTotals(items, extras, opts){
  const rates = ratesOf(opts);
  items = Array.isArray(items) ? items : [];
  extras = extras || {};
  const ev = extras.extraVals || extras, ec = extras.extraChecks || extras;
  const gv = (k) => ev[k] === undefined ? '' : ev[k];
  const gc = (k) => !!ec[k];

  const groups = {}, standalone = [];
  items.forEach(i=>{ const g = (i.group||'').trim(); if(g){ (groups[g]=groups[g]||[]).push(i); } else standalone.push(i); });

  const canopyMaterials = items.reduce((s,i)=>s+i.amount,0);
  const downspoutsTotal = items.reduce((s,i)=>s+(i.downspoutCost||0),0);
  const downspoutsQty = items.reduce((s,i)=>s+(i.downspoutQty||0),0);
  const lightsTotal = items.reduce((s,i)=>s+(i.lightsCost||0),0);
  const lightsQty = items.reduce((s,i)=>s+(i.lightsQty||0),0);
  const postsTotal = items.reduce((s,i)=>s+(i.postsCost||0),0);
  const postsQty = items.reduce((s,i)=>s+(i.postsQty||0),0);
  const taxableMaterials = canopyMaterials + downspoutsTotal + lightsTotal + postsTotal;

  const deliveryOnly = gc('extra-delivery-only');
  const laborSubtotal = deliveryOnly ? 0 : items.reduce((s,i)=>s+(i.labor||0),0);
  const miles = num(gv('extra-miles'));
  const d = deliveryCost(miles, rates);
  const installation = laborSubtotal + d.deliveryCost;

  const surveyOn = gc('extra-survey-on');
  const survey = surveyOn ? Math.ceil(num(gv('extra-survey'))) : 0;
  const lift = Math.ceil(num(gv('extra-lift')));
  const stampedOn = gc('extra-stamped-on');
  const stamped = stampedOn ? Math.ceil(num(gv('extra-stamped'))) : 0;

  const ohioRate = num(gv('extra-ohio-county'));
  const taxOn = gc('extra-tax') || ohioRate>0;
  const taxRatePercent = ohioRate>0 ? ohioRate : CONST.INDIANA_TAX_PERCENT;
  const taxAllLines = ohioRate>0;
  const taxBase = taxAllLines ? (taxableMaterials + installation + survey + lift + stamped) : taxableMaterials;
  const tax = taxOn ? Math.ceil(taxBase*(taxRatePercent/100)) : 0;
  const total = taxableMaterials + installation + survey + lift + stamped + tax;

  return {
    groups: { groups, standalone },
    hasNonCanopy: items.some(i=>i.type && i.type!=='canopy'),
    canopyMaterials, taxableMaterials,
    downspoutsTotal, downspoutsQty, lightsTotal, lightsQty, postsTotal, postsQty,
    laborSubtotal, miles, oneWayMi: d.oneWayMi, deliveryFlat: d.deliveryFlat, deliveryCost: d.deliveryCost,
    installation, deliveryOnly, surveyOn, survey, lift, stampedOn, stamped, taxOn, taxRatePercent, taxAllLines, taxBase, tax, total
  };
}

/* ---------------- TAKEOFF IMPORT (APMG_TAKEOFF v1) ----------------
   Ported from the page's importTakeoff(): same rounding (inches -> whole ft/in), same
   face / tab / custom-fascia rules, same names, groups and sub text. Returns the quote
   items plus the header + extras the page would have filled in (blank-only fill is the
   caller's job — this returns what the takeoff offers). Delivery miles are NOT computed
   here (the page geocodes the city); the caller sets extraVals['extra-miles'] (round trip). */
function extractTakeoffJSON(text){
  text = String(text||'').trim();
  try{ return JSON.parse(text); }catch(e){}
  const ok = o=>o && typeof o==='object' && Array.isArray(o.canopies);
  for(const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)){ try{ const o=JSON.parse(m[1]); if(ok(o)) return o; }catch(e){} }
  for(let s=text.indexOf('{'); s>=0; s=text.indexOf('{', s+1)){
    let depth=0, inStr=false, esc=false;
    for(let k=s;k<text.length;k++){
      const ch=text[k];
      if(inStr){ if(esc) esc=false; else if(ch==='\\') esc=true; else if(ch==='"') inStr=false; continue; }
      if(ch==='"') inStr=true; else if(ch==='{') depth++;
      else if(ch==='}'){ if(--depth===0){ try{ const o=JSON.parse(text.slice(s,k+1)); if(ok(o)) return o; }catch(e){} break; } }
    }
  }
  throw new Error('No takeoff JSON (with a "canopies" list) found in the pasted text.');
}
function extractTakeoffAll(text){
  text = String(text||'').trim();
  const ok = o=>o && typeof o==='object' && Array.isArray(o.canopies);
  try{ const o=JSON.parse(text); if(Array.isArray(o)) return o.filter(ok); if(ok(o)) return [o]; }catch(e){}
  const found=[];
  for(const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)){ try{ const o=JSON.parse(m[1]); if(ok(o)) found.push(o); }catch(e){} }
  if(found.length) return found;
  return [extractTakeoffJSON(text)];
}
// Ohio county / Indiana sales tax from job.state + job.county -> extras + message
function takeoffTax(job){
  const st = String(job.state||'').trim().toUpperCase();
  const cty = String(job.county||'').replace(/\s*county\s*$/i,'').trim().toLowerCase();
  const out = { extraVals:{}, extraChecks:{}, msg:'' };
  if(!st) return out;
  if(st==='OH' || st==='OHIO'){
    const hit = cty ? OHIO_COUNTY_RATES.find(([n])=>n.toLowerCase()===cty) : null;
    if(hit){ out.extraVals['extra-ohio-county'] = String(hit[1]); out.extraChecks['extra-tax'] = false; out.msg = `Ohio tax set: ${hit[0]} County — ${hit[1].toFixed(2)}% (all line items).`; }
    else out.msg = `Ohio job but county "${job.county||'?'}" not found — pick the county by hand.`;
    return out;
  }
  if(st==='IN' || st==='INDIANA'){ out.extraChecks['extra-tax'] = true; out.extraVals['extra-ohio-county'] = '0'; out.msg = 'Indiana job — 7% sales tax on materials turned on.'; return out; }
  out.msg = `${st} job — no tax set (only OH / IN are automatic). Check that state's tax.`;
  return out;
}
const roundIn = v => Math.max(0, Math.round(+v||0));   // _tkSetFtIn: inches -> whole ft/in fields

function importTakeoff(data, opts){
  opts = opts || {};
  if(typeof data==='string'){
    const all = extractTakeoffAll(data);
    if(all.length>1){
      const res = { items:[], hdr:{}, extraVals:{}, extraChecks:{}, added:[], skipped:[], warnings:[], info:[] };
      all.forEach((d,i)=>{
        const r = importTakeoff(d, opts);
        res.items.push(...r.items);
        if(i===0){ res.hdr = r.hdr; res.extraVals = r.extraVals; res.extraChecks = r.extraChecks; }
        res.added.push(...r.added); res.skipped.push(...r.skipped);
        res.warnings.push(...r.warnings.map(w=>`[${(d.job&&d.job.shipName)||'takeoff '+(i+1)}] ${w}`)); res.info.push(...(r.info||[]));
      });
      res.info.unshift(`${all.length} takeoff blocks imported into this one quote (job header from the first).`);
      res.info = [...new Set(res.info)];
      return res;
    }
    data = all[0];
  }
  if(!data || !Array.isArray(data.canopies)) throw new Error('Takeoff has no "canopies" list.');
  const job = data.job||{};
  const cust = job.customer||{};
  const hdr = {};
  const setIf = (k,v)=>{ if(v) hdr[k]=v; };
  setIf('hdr-projname', job.projectName); setIf('hdr-projno', job.projectNo);
  setIf('hdr-gc', job.gc); setIf('hdr-to', job.to); setIf('hdr-shipname', job.shipName);
  setIf('hdr-address1', job.address); setIf('hdr-address2', job.cityStateZip);
  if(!job.to && (cust.company||cust.name)) setIf('hdr-to', [cust.company, cust.name?`Attn: ${cust.name}`:''].filter(Boolean).join(' — '));
  if(!job.gc && cust.company) setIf('hdr-gc', cust.company);
  setIf('hdr-custemail', cust.email); setIf('hdr-custphone', cust.phone); setIf('hdr-biddue', job.bidDue);
  const extraVals = {}, extraChecks = {};
  if(job.color) extraVals['extra-color'] = job.color;
  const info = [];
  const tx = takeoffTax(job);
  Object.assign(extraVals, tx.extraVals); Object.assign(extraChecks, tx.extraChecks);
  if(tx.msg) info.push(tx.msg);
  if(job.bidDue) info.push(`Bid due: ${job.bidDue}`);

  const items = [], added = [], skipped = [];
  let nextId = opts.startId || 1;
  data.canopies.forEach((c,idx)=>{
    const label = c.name||c.mark||`Canopy ${idx+1}`;
    const type = String(c.type||'canopy').toLowerCase();
    if(type==='fabric'){
      if(!(+c.widthIn>0)){ skipped.push(`${label} — fabric awning missing widthIn`); return; }
      const wIn = roundIn(c.widthIn), pIn = +c.projIn>0 ? roundIn(c.projIn) : 0, hIn = +c.heightIn>0 ? roundIn(c.heightIn) : 0;
      const qty = Math.max(1, parseInt(c.qty,10)||1);
      const posts = parseInt(c.posts,10)>0 ? parseInt(c.posts,10) : 0;
      const fnm = [c.mark, c.name].filter(Boolean).join(' — ') || label;
      const spec = { qty, widthStr: ftInLabel(wIn), projStr: ftInLabel(pIn), heightStr: ftInLabel(hIn), signPanelIn: 0, priceMode: 'perft', postsPerUnit: posts,
                     widthIn: wIn, projIn: pIn, heightIn: hIn };
      const it = buildItem('fabric', spec, { id: nextId++, title: fnm + (c.sheet ? ` (${c.sheet})` : ''),
        group: c.group ? `${c.group} — ${GROUP_FABRIC}` : GROUP_FABRIC,
        takeoffNote: (c.notes || c.confidence) ? [c.confidence?`scale confidence: ${c.confidence}`:'', c.notes||''].filter(Boolean).join(' · ') : null }, opts);
      items.push(it);
      added.push(`${fnm} (fabric)${c.qty>1?` ×${c.qty}`:''}`);
      return;
    }
    if(type!=='canopy'){ skipped.push(`${label} — type "${c.type}" not auto-imported (enter by hand)`); return; }
    const legsIn = Array.isArray(c.legs) ? c.legs.filter(l=>+l.widthIn>0) : [];
    const mitered = legsIn.length>=2;
    if(mitered && legsIn.length>5){ skipped.push(`${label} — ${legsIn.length} legs (builder max is 5)`); return; }
    if(!mitered && !(+c.widthIn>0 && +c.projIn>0)){ skipped.push(`${label} — missing widthIn/projIn`); return; }
    if(mitered && legsIn.some(l=>!(+l.projIn>0))){ skipped.push(`${label} — a leg is missing projIn`); return; }
    const face = +c.face||8;
    const key = face<=8 ? 'canopy8' : 'canopy12';
    const tabFace = key==='canopy8' ? 8 : 12;
    // face-size picker: 6/8 on the 8" tab, 10/12 on the 12" tab (same sell pricing); >12 = custom fascia
    let faceInches = tabFace, customFasciaIn = 0;
    if(face>12){ customFasciaIn = face; faceInches = face; }
    else if((key==='canopy8' && (face===6||face===8)) || (key==='canopy12' && (face===10||face===12))) faceInches = face;
    const qty = Math.max(1, parseInt(c.qty,10)||1);
    const spec = {
      qty, face: faceInches, section: key, mitered, legCount: mitered ? legsIn.length : 1,
      downspoutPerUnit: parseInt(c.downspouts,10)||0, lightsPerUnit: parseInt(c.lights,10)||0, postsPerUnit: parseInt(c.posts,10)||0,
      cchannelPerUnit: 0, outriggerPerUnit: 0, fasciaAdd: 0, paintOn: true, customFasciaIn,
      attach: ['tierod','cchannel','topsupport'].includes(c.attach) ? c.attach : (tabFace >= 12 ? 'tierod' : 'topsupport'),
      paint: c.paint ? String(c.paint) : '',
      blocking: ['wood','masonry','metal'].includes(c.blocking) ? c.blocking : 'wood',
      armHeightIn: 65,
      arms: (+c.arms>=2 && +c.arms<=16) ? parseInt(c.arms,10) : 0
    };
    if(mitered){
      const legs = legsIn.map(l=>{
        const wIn = roundIn(l.widthIn), p1In = roundIn(l.projIn);
        const p2In = (+l.projCornerIn>0 && Math.round(+l.projCornerIn)!==Math.round(+l.projIn)) ? roundIn(l.projCornerIn) : 0;
        const p1 = p1In/12, p2 = p2In/12;
        const lt = p2 > 0 && Math.abs(p2 - p1) > 0.001;
        const pFt = lt ? (p1+p2)/2 : p1;
        return { wFt: wIn/12, pFt, wIn, pIn: pFt*12, wLabel: ftInLabel(wIn), pLabel: lt ? `${ftInLabel(p1In)} tapering to ${ftInLabel(p2In)}` : ftInLabel(p1In), taper: lt, p1Ft: p1, p2Ft: lt ? p2 : null };
      });
      spec.legs = legs;
      spec.widthSegments = legs.map(l=>l.wLabel);
      spec.widthSegIn = legs.map(l=>l.wIn);
      spec.widthStr = legs.map(l=>l.wLabel).join(' x ');
      spec.projStr = legs.map(l=>l.pLabel).join(' / ');
      spec.widthFt = legs.reduce((a,l)=>a+l.wFt,0);
      spec.projMaxFt = legs.reduce((m,l)=>Math.max(m, l.p1Ft||l.pFt, l.p2Ft||0), 0);
      spec.projFt = spec.projMaxFt;
      spec.tapered = legs.some(l=>l.taper);
      spec.proj1Ft = null; spec.proj2Ft = null;
      spec.taperDesc = spec.tapered ? legs.map((l,i)=>l.taper ? `Leg ${i+1}: ${l.p1Ft.toFixed(2)}' at free end to ${l.p2Ft.toFixed(2)}' at corner` : `Leg ${i+1}: ${l.pFt.toFixed(2)}' constant`).join('; ') : null;
    } else {
      const wIn = roundIn(c.widthIn), pIn = roundIn(c.projIn);
      const p2In = (+c.projEndIn>0 && Math.round(+c.projEndIn)!==Math.round(+c.projIn)) ? roundIn(c.projEndIn) : 0;
      const p1 = pIn/12, p2 = p2In/12;
      const tapered = p2 > 0 && Math.abs(p2 - p1) > 0.001;
      spec.widthFt = wIn/12;
      spec.widthStr = ftInLabel(wIn);
      spec.legs = null; spec.widthSegments = null; spec.widthSegIn = null;
      spec.tapered = tapered;
      spec.proj1Ft = tapered ? p1 : null; spec.proj2Ft = tapered ? p2 : null;
      spec.projMaxFt = tapered ? Math.max(p1,p2) : p1;
      spec.projFt = tapered ? (p1+p2)/2 : p1;
      spec.projStr = tapered ? `${ftInLabel(pIn)} tapering to ${ftInLabel(p2In)}` : ftInLabel(pIn);
      spec.taperDesc = tapered ? `projection varies ${p1.toFixed(2)}' to ${p2.toFixed(2)}' across the run` : null;
    }
    const nm = [c.mark, c.name].filter(Boolean).join(' — ') || label;
    const it = buildItem('canopy', spec, { id: nextId++, title: nm + (c.sheet ? ` (${c.sheet})` : ''),
      group: c.group ? `${c.group} — ${GROUP_CANOPY}` : GROUP_CANOPY,
      lineGroup: c.lineGroup || null, customFasciaSub: true,
      takeoffNote: (c.notes || c.confidence) ? [c.confidence?`scale confidence: ${c.confidence}`:'', c.notes||''].filter(Boolean).join(' · ') : null }, opts);
    items.push(it);
    added.push(`${nm}${c.qty>1?` ×${c.qty}`:''}`);
  });
  return { items, hdr, extraVals, extraChecks, added, skipped, warnings: Array.isArray(data.warnings)?data.warnings:[], info };
}

/* ---------------- TRUE COST (margin check) — ported verbatim from the page ----------------
   Material from the canopy framing recipe (BOM, costed by proportional lineal feet + 5% waste
   from the Eastern Metal Supply price book) + shop labor + paint material + freight.
   The page's Margin Check, cut sheet, shop BOM sheet, drawings and the "Set to N×" button all
   read from THIS copy (window.QuoteEngine), so the material number can never drift. */
const EMS_QUOTE = { no:'584313', date:'10/02/26', supplier:'Eastern Metal Supply of MO' };  // monthly re-send 10/02/26 (order date 09/01/26, expires 10/02/26)
const EMS = {
 "60-00-200":{d:"MP-1 (.125\" WALL) X 24' (WHITE",ppf:2.8,len:24.0},
 "60-00-205":{d:"MP-1A (.100\" WALL) X 24'",ppf:2.35,len:24.0},
 "60-00-206":{d:"MP-1C (.063\" WALL) X 24'",ppf:1.8,len:24.0},
 "60-00-225":{d:"MP-3 (1\" X 2\") X 24'",ppf:2.74,len:24.0},
 "60-00-235":{d:"MP-3S(1\"X2\") X 24'",ppf:3.1,len:24.0},
 "60-00-255":{d:"MP-3H (1\" X 2\") X 24'",ppf:4.65,len:24.0},
 "60-00-221":{d:"MP-2 X 2 X 24'",ppf:6.1,len:24.0},
 "60-00-215":{d:"MP-2A (1\" FLANGE) X 24'",ppf:2.6,len:24.0},
 "60-00-220":{d:"MP-2B X 24'",ppf:2.45,len:24.0},
 "60-00-226":{d:"MP-3A(1\" X 2\") X 24'",ppf:4.35,len:24.0},
 "40-63-010":{d:"1\" SQ W/DOUBLE FLANGE X 24'",ppf:2.1,len:24.0},
 "60-00-240":{d:"MP-4 (1\" X 4\") X 24'",ppf:7.6,len:24.0},
 "56-63-015":{d:"3 X 6 X .065 X 24'",ppf:5.85,len:24.0},
 "56-63-033":{d:"4 X 6 X .093 X 24'",ppf:10.15,len:24.0},
 "56-63-016":{d:"4 X 8 X .125 X 24'",ppf:15.5,len:24.0},
 "56-63-039":{d:"4 X 8 X 3 X .125 X 24'",ppf:14.65,len:24.0},
 "56-63-043":{d:"4 X 10 X 4 X .140 X 24'",ppf:19.6,len:24.0},
 "56-63-045":{d:"4 X 10 X 4 X .125 X 30'",ppf:19,len:30.0},
 "56-63-042":{d:"4 X 12 X 5 X .160 X 24'",ppf:24.75,len:24.0},
 "56-63-046":{d:"2 X 8 X 24'",ppf:7.25,len:24.0},
 "19-63-345":{d:"1 X .093 X 24'",ppf:2,len:24.0},
 "19-63-170":{d:"1-1/2\" SQ X 1/8\" X 24'",ppf:4.2,len:24.0},
 "19-63-180":{d:"1 3/4 X .093 X 24'",ppf:3.75,len:24.0},
 "19-61-205":{d:"2\" SQ X .093 X 26'(BLUE ENDS)",ppf:4.4,len:26.0},
 "19-63-210":{d:"2\" SQ X 1/8\" X 24'",ppf:5.85,len:24.0},
 "11-61-270":{d:"2 X 2 X 3/16 X 25'",ppf:4.5,len:25.0},
 "19-61-212":{d:"2\" SQ X 1/4\" WALL X 24'",ppf:10.9,len:24.0},
 "19-63-235":{d:"3\" SQ X 1/8\" WALL X 24'",ppf:8.8,len:24.0},
 "11-63-335":{d:"3 X 3 X .250 X 20'",ppf:8.8,len:20.0},   /* 10/02/26 quote STILL lists this SKU twice (8.80 p4 / 8.55 p8) - keeping 8.80 per Mike 9/10/26; confirm w/ EMS */
 "19-61-258":{d:"5 X 1/4 X 24'",ppf:29.0,len:24.0},
 "19-61-260":{d:"6 X 1/4 X 24'",ppf:36.0,len:24.0},
 "20-63-222":{d:"1 X 2 X .062 X 24' W/.125 RAD",ppf:2.25,len:24.0},
 "20-63-227":{d:"1\" X 2\" X .093\" X 24'",ppf:3.2,len:24.0},
 "20-63-225":{d:"1 X 2 X 1/8 X 24'",ppf:4.25,len:24.0},
 "20-63-230":{d:"1 X 3 X 1/8 X 24'",ppf:5.8,len:24.0},
 "20-63-235":{d:"1 X 4 X 1/8 X 24'",ppf:7.3,len:24.0},
 "20-63-236":{d:"1 X 5 X 1/8 X 20'",ppf:8.76,len:20.0},
 "20-63-237":{d:"1 X 6 X .125 X 24'",ppf:10.3,len:24.0},
 "20-63-250":{d:"1 1/2 X 3 X 1/8 X 24'",ppf:6.4,len:24.0},
 "20-63-272":{d:"2 X 3 X .093 X 24'",ppf:5.35,len:24.0},
 "20-63-275":{d:"2 X 3 X 1/8 X 24'",ppf:7.15,len:24.0},
 "52-61-194":{d:"2 X 3 X 1/4 X 24'",ppf:13.15,len:24.0},
 "20-63-280":{d:"2 X 4 X 1/8 X 24'",ppf:8.8,len:24.0},
 "20-61-281":{d:"2 X 4 X 1/4 X 24'",ppf:16.5,len:24.0},
 "20-63-290":{d:"2 X 6 X 1/8 X 24'",ppf:11.75,len:24.0},
 "20-63-285":{d:"2 X 5 X 1/8 X 24'",ppf:10.25,len:24.0},
 "20-63-295":{d:"2 X 8 X 1/8 X 24'",ppf:15.0,len:24.0},
 "20-63-400":{d:"2 X 10 X 1/8 X 24'",ppf:18.5,len:24.0},
 "20-63-500":{d:"2 X 12 X .188 X 24'",ppf:33.0,len:24.0},
 "20-63-300":{d:"3 X 4 X 1/8 X 24'",ppf:10.5,len:24.0},
 "20-63-303":{d:"3 X 6 X 1/8 X 24'",ppf:13.2,len:24.0},
 "20-63-499":{d:"4 X 10 X .188 X 24'",ppf:33.0,len:24.0},
 "20-63-245":{d:"1 1/2 X 2 X 1/8 X 24'",ppf:4.95,len:24.0},
 "20-63-240":{d:"1-1/4 X 2-1/2 X 1/8 X 24' (RED",ppf:5.5,len:24.0},
 "10-61-215":{d:"1/8 X 1 X 12'",ppf:0.76,len:12.0},
 "10-61-325":{d:"1/4 X 1 X 12'",ppf:1.55,len:12.0},
 "10-61-340":{d:"1/4 X 2 X 12'",ppf:3.1,len:12.0},
 "10-61-345":{d:"1/4\" X 2-1/2\" X 12'",ppf:3.85,len:12.0},
 "10-61-350":{d:"1/4\" X 3\" X 12'",ppf:4.7,len:12.0},
 "10-63-345":{d:"1/4 X 4 X 20'",ppf:6.0,len:20.0},
 "10-61-360":{d:"1/4 X 5 X 12'",ppf:7.5,len:12.0},
 "10-63-350":{d:"1/4 X 6 X 20'",ppf:9.4,len:20.0},
 "10-63-280":{d:"3/16\" X 2\" X 20'",ppf:2.35,len:20.0},
 "10-63-285":{d:"3/16\" X 3\" X 20'",ppf:3.65,len:20.0},
 "10-61-370":{d:"1/4 X 8 X 12'",ppf:12.0,len:12.0},
 "10-61-375":{d:"1/4\" X 10\" X 12'",ppf:15.0,len:12.0},
 "33-61-100":{d:"1/4\" X 12\" X 12'",ppf:19.25,len:12.0},
 "18-63-225":{d:"1\" SCH 40 X 20'",ppf:3.0,len:20.0},
 "18-63-235":{d:"1-1/2\" SCH 40 X 20'",ppf:4.75,len:20.0},
 "14-63-215":{d:"1/2\" DIA X 20'",ppf:1.2,len:20.0},
 "11-63-269":{d:"1 X 1 1/2 X 1/8 X 20'",ppf:1.8,len:20.0},
 "11-63-365":{d:"1 X 2 X 1/16 X 20'",ppf:1.1,len:20.0},
 "11-63-370":{d:"1 X 2 X 1/8 X 20'",ppf:2.25,len:20.0},
 "11-63-410":{d:"1 1/2 X 2 X 1/8 X 20'",ppf:2.65,len:20.0},
 "11-63-375":{d:"1 X 3 X 1/8 X 20'",ppf:3.0,len:20.0},
 "11-63-390":{d:"2 X 3 X 1/8 X 20'",ppf:3.9,len:20.0},
 "11-63-395":{d:"2 X 4 X 1/8 X 20'",ppf:4.5,len:20.0},
 "11-63-396":{d:"2 X 4 X 1/4 X 20'",ppf:8.8,len:20.0},
 "11-63-405":{d:"2 X 5 X 1/8 X 20'",ppf:5.75,len:20.0},
 "11-63-415":{d:"2\" X 7\" X 1/4\" X 20'",ppf:14.0,len:20.0},
 "11-63-230":{d:"1 X 1 X 3/16 X 20'",ppf:2.2,len:20.0},
 "11-63-320":{d:"2 X 2 X 3/16 X 20'",ppf:4.4,len:20.0},
 "11-63-325":{d:"2 X 2 X 1/4 X 20'",ppf:5.65,len:20.0},
 "11-63-330":{d:"3 X 3 X 1/8 X 20'",ppf:4.5,len:20.0},
 "50-03-214":{d:".080 X 60 X 120",ppf:241,len:1.0},
 "50-03-600":{d:".080 X 72 X 120",ppf:306.0,len:1.0},
 "50-03-630":{d:".080 X 72 X 144",ppf:370.0,len:1.0},
 "50-03-129":{d:".090 X 48 X 96",ppf:172,len:1.0},
 "88-00-240":{d:".090 X 60 X 144",ppf:350.0,len:1.0},
 "50-03-173":{d:".125 X 48\" X 96\"",ppf:236,len:1.0},
 "50-03-300":{d:".250\" X 48\" X 96\"",ppf:490,len:1.0}
};
function emsStick(sku){ const m=EMS[sku]; return m ? m.ppf*m.len : 0; }   // $ per full stock length
function emsLen(sku){ const m=EMS[sku]; return m ? m.len : 24; }          // stock length (ft)
function emsDesc(sku){ const m=EMS[sku]; return m ? m.d : '(not in price book)'; }

/* Canopy framing recipe — each member points at a real SKU in the price book above. */
const CM = {
 pan6:   { sku:'56-63-015', cover:0.5 },
 pan8:   { sku:'56-63-046', cover:0.667 },
 fascia6:{ sku:'56-63-033' }, fascia8:{ sku:'56-63-016' }, fascia10:{ sku:'56-63-043' }, fascia12:{ sku:'56-63-042' },
 support14:{ sku:'20-63-235' },                         // 1x4 front/rear support — 10" & 12" face (per Mike, 07/2026)
 support12:{ sku:'20-63-225' },                         // 1x2 front/rear support — 6" & 8" face (per Mike, 07/2026)
 support16:{ sku:'20-63-237' },                         // 1x6x.125 REAR support — 12" face (per Mike, 08/2026)
 tierod1:{ sku:'18-63-225' },
 sleeve125:{ sku:'18-63-235' },                         // 1-1/2" Sch40 sleeve over the 1" tie-rod
 plate:{ sku:'10-63-350', platesPerUnit:40 },           // 6x6x1/4 wall plates sheared from 1/4"x6"x20' bar (40/bar) — STANDARD all canopies (per Mike)
 topplate56:{ sku:'10-63-350', platesPerUnit:48 },      // 5x6x1/4 canopy top plate (tie-rod) — 6" & 8" face (per Mike)
 topplate25:{ sku:'10-61-360', platesPerUnit:72 },      // 2x5x1/4 canopy top plate (tie-rod) — 10" & 12" face (per Mike)
 rodbar22:{ sku:'19-61-212' },                          // 2x2x1/4 tie-rod support bar across width — 12" face only, 8.5" from front to CL (per Mike)
 angle33:{ sku:'11-63-330' },                           // 3x3x1/8 angle — scupper brackets, (3) 4"-long per downspout (per DXF corpus)
 outrig22:{ sku:'11-63-320' },                          // 2x2x3/16 outrigger (optional / on request)
 downspout22:{ sku:'19-63-210' },                       // 2x2x1/8 square tube — downspout (default)
 downspout23:{ sku:'20-63-275' },                       // 2x3x1/8 tube — downspout on 10"+ fascia jobs
 cchannel:{ sku:'50-03-300', yieldFt:96 }               // C-channel brake-formed from 1/4"x4'x8' plate (~96 lin ft/sheet)
};
const DS_DROP_FT = 8;   // feet of downspout tube per drop (typical straight downspout)
// Framing material costing method:
//   'stick' = buy whole sticks (charge full stock length even if part is drop) — real PO cost.
//   'prop'  = proportional / lineal-foot: charge only the feet consumed (+ kerf) × waste allowance.
const CM_COST_MODE = 'prop';    // proportional lineal-foot costing (per Mike, 07/2026)
const CM_KERF_FT   = 1/12;      // saw kerf per cut (~1")
const CM_WASTE     = 1.05;      // drop/waste multiplier for 'prop' mode — +5% (owner-confirmed, 07/2026)
const CM_FAS = {6:'fascia6',8:'fascia8',10:'fascia10',12:'fascia12'};
const CM_LABOR = { weldHrPerSqft:0.08, prepHrPerSqft:0.06, paintHrPerSqft:0.06, rate:65 };
const CM_PAINTMAT = 4;   // $/sqft
const CM_FREIGHT = 0.05; // % of material
const CM_MISC_PCT = 0.03;   // fasteners / misc, +3% on framing
// SKU -> role, for tagging which price-book items the canopy recipe actually uses.
function recipeSkuRoles(){
  const roles={
    pan6:'Roof pan 6"', pan8:'Roof pan 8"', fascia6:'Fascia 6"', fascia8:'Fascia 8"',
    fascia10:'Fascia 10"', fascia12:'Fascia 12"', support14:'1×4 support', support12:'1×2 support', support16:'1×6 rear support',
    tierod1:'Tie-rod', sleeve125:'Tie-rod sleeve', plate:'Wall plate', outrig22:'Outrigger',
    topplate56:'Top plate 5×6', topplate25:'Top plate 2×5', rodbar22:'Rod support bar', angle33:'Scupper angle'
  };
  const map={};
  Object.keys(CM).forEach(k=>{ if(CM[k] && CM[k].sku) map[CM[k].sku]=roles[k]||k; });
  return map;
}
// first-fit-decreasing nesting of piece lengths into stock sticks (1" kerf per cut)
function cmFfd(pieces, stock){
  pieces=[...pieces].sort((a,b)=>b-a); let bins=[];
  for(const p of pieces){ let done=false;
    for(let i=0;i<bins.length;i++){ if(bins[i]>=p+1/12){ bins[i]-=(p+1/12); done=true; break; } }
    if(!done) bins.push(stock-p-1/12);
  }
  return bins.length;
}
// Per-leg tie-rod counts: auto = one per 4'-5' of width (+1); a manual override (spec.arms
// 2–16, per Mike 08/05/26) is distributed across legs by width. Shared by the margin engine,
// the shop BOM sheet, and the drawings so every count agrees.
function rodPerLeg(legs, arms){
  let per = legs.map(l=>Math.ceil(l.w/5)+1);
  if(arms>0){
    const totW = legs.reduce((a,l)=>a+l.w,0)||1;
    per = legs.map(l=>Math.max(1, Math.floor(arms*l.w/totW)));
    let rem = arms - per.reduce((a,b)=>a+b,0);
    const order = legs.map((l,i)=>i).sort((a,b)=>legs[b].w-legs[a].w);
    let g = 0;
    while(rem>0){ per[order[g%order.length]]++; rem--; g++; }
    while(rem<0 && g<64){ const j = order[order.length-1-(g%order.length)]; if(per[j]>1){ per[j]--; rem++; } g++; }
  }
  return per;
}
// True cost for one canopy line item (all qty). Also returns an itemized `lines` cut sheet
// built from the SAME math, so the breakdown can never disagree with the margin number.
function canopyTrueCost(spec, mode){
  mode = mode || CM_COST_MODE;   // 'stick' = whole-stick purchasing · 'prop' = lineal-foot proportional
  if(!spec) return {material:0,labor:0,finish:0,freight:0,cost:0,sqft:0,lines:[],qty:1,framingPU:0,miscPU:0,dsPU:0,ccPU:0};
  const face = spec.face||8, qty = spec.qty||1;
  const legs = (spec.mitered && spec.legs && spec.legs.length)
    ? spec.legs.map(l=>({w:l.wFt||0,p:l.pFt||0}))
    : [{w:spec.widthFt||0,p:spec.projFt||0}];
  const N = legs.length;
  const pan = CM[spec.panKey||'pan6'];
  const fasc = CM[CM_FAS[face]||'fascia8'];
  const lines = [];
  const stick = (role, sku, pieces, note) => {
    const per = emsStick(sku);
    let c, qtyText;
    if(mode==='prop'){
      const lf = pieces.reduce((a,p)=>a+p+CM_KERF_FT,0) * CM_WASTE;   // feet used + kerf, padded for drop waste
      const ppf = per / emsLen(sku);                                  // $/ft
      c = lf*ppf;
      qtyText = (lf*qty).toFixed(1)+' ft';
      lines.push({ role, sku, desc:emsDesc(sku), note, qtyText, unitText:'$'+ppf.toFixed(2)+'/ft', costPU:c, cat:'framing' });
      return c;
    }
    const s = cmFfd(pieces, emsLen(sku)); c = s*per; const js=s*qty;
    lines.push({ role, sku, desc:emsDesc(sku), note, qtyText:js+' stick'+(js===1?'':'s'), unitText:'$'+per.toFixed(2)+'/stick', costPU:c, cat:'framing' });
    return c;
  };
  let framingPU = 0;
  // Pans (per Mike, 07/2026): W × P × 2 = total lineal ft of 6" pan (area ÷ pan cover),
  // + the 5% drop rule, ÷ 24' stock for stick count. No per-piece kerf/roundup.
  const panArea = legs.reduce((a,l)=>a+l.w*l.p,0);
  const panLf0 = panArea/(pan.cover||0.5);
  const panLf  = panLf0*CM_WASTE;
  const panPpf = emsStick(pan.sku)/emsLen(pan.sku);
  const panSticks = Math.ceil((panLf*qty)/emsLen(pan.sku));
  const panCost = panLf*panPpf;
  lines.push({ role:'Roof pans', sku:pan.sku, desc:emsDesc(pan.sku), note:`W×P×2 = ${(panLf0*qty).toFixed(1)} ft + 5% drop ÷ ${emsLen(pan.sku)}′ = ${panSticks} sticks`, qtyText:(panLf*qty).toFixed(1)+' ft', unitText:'$'+panPpf.toFixed(2)+'/ft', costPU:panCost, cat:'framing' });
  framingPU += panCost;
  // fascia wraps the FULL perimeter: front + rear runs on every leg, plus the two exposed ends
  let fp=[]; legs.forEach(l=>{ fp.push(l.w); fp.push(l.w); }); fp.push(legs[0].p); fp.push(legs[N-1].p);
  framingPU += stick(`Gutter fascia ${face}"`, fasc.sku, fp, `${fp.length*qty} pcs · full perimeter · mitred corners`);
  // supports per Mike: 6"/8" face = 1×2 front & rear · 10" = 1×4 front & rear · 12" = 1×4 FRONT + 1×6 REAR
  if(face>=12){
    let spF=[]; legs.forEach(l=>spF.push(l.w));
    framingPU += stick('1×4 front support', CM.support14.sku, spF, `${spF.length*qty} pcs`);
    let spR=[]; legs.forEach(l=>spR.push(l.w));
    framingPU += stick('1×6 rear support', CM.support16.sku, spR, `${spR.length*qty} pcs`);
  } else {
    const sup = (face<=8) ? CM.support12 : CM.support14;
    let sp=[]; legs.forEach(l=>{ sp.push(l.w); sp.push(l.w); });
    framingPU += stick((face<=8?'1×2':'1×4')+' front/rear support', sup.sku, sp, `${sp.length*qty} pcs`);
  }
  let pts=0; legs.forEach(l=>pts+=Math.ceil(l.w/2)+1);
  if((spec.attach||'')==='tierod'){
    const rodPer = rodPerLeg(legs, spec.arms||0);
    let tp=[], rbAll=[]; legs.forEach((l,li)=>{ const n=rodPer[li]; for(let k=0;k<n;k++){ tp.push(l.p+3); rbAll.push(l.p); } });
    framingPU += stick('Tie-rods (1" Sch40)', CM.tierod1.sku, tp, `${tp.length*qty} rods @ ${(legs[0].p+3).toFixed(1)}′`);
    framingPU += stick('Tie-rod sleeves (2′ ea)', CM.sleeve125.sku, tp.map(()=>2), `${tp.length*qty} sleeves × 2′`);
    // canopy top plates — one per rod (per Mike): 5×6×¼ on 6"/8" face · 2×5×¼ on 10"/12"
    const tpM = (face<=8) ? CM.topplate56 : CM.topplate25;
    const tpSz = (face<=8) ? '5×6×¼' : '2×5×¼';
    const tpPer = emsStick(tpM.sku)/tpM.platesPerUnit;
    const tpCost = tp.length*tpPer;
    lines.push({ role:`Canopy top plates (${tpSz})`, sku:tpM.sku, desc:emsDesc(tpM.sku), note:`${tp.length*qty} plates (1/rod) · ${tpM.platesPerUnit}/bar`, qtyText:(tp.length*qty)+' plates', unitText:'$'+tpPer.toFixed(2)+'/plate', costPU:tpCost, cat:'framing' });
    framingPU += tpCost;
    // 12" canopies: 2×2×¼ bars run FRONT TO BACK — ONE PER TIE ROD (per Mike, 08/2026)
    if(face>=12){
      framingPU += stick('2×2×¼ rod support bars', CM.rodbar22.sku, rbAll, `${rbAll.length*qty} bars @ ${legs[0].p.toFixed(1)}′ · 1/rod · front-to-back`);
    }
  }
  // Wall plates: 6x6x1/4 standard — tie-rod jobs ONE PER ROD; all-thread jobs anchor into blocking (none).
  const platesPerBar = CM.plate.platesPerUnit;
  const platePer = emsStick(CM.plate.sku)/platesPerBar;
  const plateN = (spec.attach||'')==='tierod' ? rodPerLeg(legs, spec.arms||0).reduce((a,b)=>a+b,0) : 0;
  if(plateN>0){
    const plateCost = plateN*platePer;
    lines.push({ role:'Wall plates (6×6×¼)', sku:CM.plate.sku, desc:emsDesc(CM.plate.sku), note:`${plateN*qty} plates (1/rod) · ${platesPerBar}/bar`, qtyText:(plateN*qty)+' plates', unitText:'$'+platePer.toFixed(2)+'/plate', costPU:plateCost, cat:'framing' });
    framingPU += plateCost;
  }
  // Anchors/hardware EXCLUDED from margin for now (no real pricing yet — Mike to supply).
  lines.push({ role:'Anchors / hardware', sku:'—', desc:'1/2" all-thread + nuts/lags — NOT COSTED yet', note:`${pts*qty} anchor points · excluded from margin`, qtyText:(pts*qty)+' pts', unitText:'—', costPU:0, cat:'framing' });
  if(spec.outrig){ let op=[]; legs.forEach(l=>{ const n=Math.ceil(l.w/(spec.outsp||7))+1; for(let k=0;k<n;k++) op.push(l.p); }); framingPU += stick('Outriggers', CM.outrig22.sku, op, `${op.length*qty} pcs`); }
  const miscPU = framingPU*CM_MISC_PCT;
  // Downspouts & C-channel — material only, sized from real SKUs in the price book.
  const dsSku = (face>=10) ? CM.downspout23.sku : CM.downspout22.sku;
  const dsN = (spec.downspoutPerUnit||0);
  const dsPpf = EMS[dsSku] ? EMS[dsSku].ppf : 0;
  let dsPU = dsN * (dsPpf * DS_DROP_FT);
  if(dsN>0){
    lines.push({ role:'Downspouts', sku:dsSku, desc:emsDesc(dsSku), note:`${dsN*qty} drops × ${DS_DROP_FT}′`, qtyText:(dsN*DS_DROP_FT*qty).toFixed(0)+' ft', unitText:'$'+dsPpf.toFixed(2)+'/ft', costPU:dsPU, cat:'acc' });
    // scupper brackets: (3) 4"-long 3×3×⅛ angle per downspout = 1 ft/drop
    const angPpf = emsStick(CM.angle33.sku)/emsLen(CM.angle33.sku);
    const angPU = dsN * 1 * angPpf;
    lines.push({ role:'Downspout collector brackets', sku:CM.angle33.sku, desc:emsDesc(CM.angle33.sku), note:`${dsN*3*qty} pcs @ 4″ (3/drop) · per drawings`, qtyText:(dsN*qty).toFixed(0)+' ft', unitText:'$'+angPpf.toFixed(2)+'/ft', costPU:angPU, cat:'acc' });
    dsPU += angPU;
  }
  const ccFt = (spec.cchannelPerUnit||0);
  const ccPerFt = emsStick(CM.cchannel.sku)/CM.cchannel.yieldFt;
  const ccPU = ccFt*ccPerFt;
  if(ccFt>0) lines.push({ role:'C-channel (LED)', sku:CM.cchannel.sku, desc:emsDesc(CM.cchannel.sku), note:`${(ccFt*qty).toFixed(1)} ft · ¼×4×8 sheet ÷ ${CM.cchannel.yieldFt}ft`, qtyText:(ccFt*qty).toFixed(1)+' ft', unitText:'$'+ccPerFt.toFixed(2)+'/ft', costPU:ccPU, cat:'acc' });

  const materialPU = framingPU + miscPU + dsPU + ccPU;
  const mat = materialPU*qty;
  const sqft = legs.reduce((a,l)=>a+l.w*l.p,0)*qty;
  const labor = sqft*(CM_LABOR.weldHrPerSqft+CM_LABOR.prepHrPerSqft+CM_LABOR.paintHrPerSqft)*CM_LABOR.rate;
  const finish = sqft*CM_PAINTMAT;
  const freight = mat*CM_FREIGHT;
  return {material:mat, labor, finish, freight, cost:mat+labor+finish+freight, sqft,
          downspoutMat: dsPU*qty, cchannelMat: ccPU*qty,
          lines, qty, framingPU, miscPU, dsPU, ccPU, materialPU};
}

/* Margin check numbers for a quote (material-only, as the page shows them):
   sell = Σ canopy (amount + downspouts − paint adder), mat = Σ true material. */
function marginSummary(items, target){
  const cans = (items||[]).filter(i=>i.type==='canopy');
  let sell=0, mat=0, sqft=0;
  cans.forEach(i=>{ const c=canopyTrueCost(i.spec); sell+=i.amount+(i.downspoutCost||0)-(i.paintCost||0); mat+=c.material; sqft+=c.sqft; });
  const t = (target === undefined || target === null) ? 0.425 : target;
  const margin = sell>0 ? (sell-mat)/sell : 0;
  return { canopies: cans.length, sell, mat, sqft, margin, target: t, reqSell: mat/(1-t), ok: margin>=t, mult: mat>0 ? sell/mat : 0 };
}

/* ---- Price adjuster ("Set to N×" button): snap the canopy sell to material × N ----
   Scales every canopy line's amount proportionally so total canopy sell (incl. the downspout
   lines, EXCLUDING the $9/sqft paint adder which rides on top unchanged) lands exactly on
   material × m. Non-canopy items, lights, posts and labor are untouched. The last canopy
   absorbs rounding so the ex-paint total is exact. Pure: returns new item objects. */
function applyMargin(items, m){
  items = Array.isArray(items) ? items : [];
  const cans = items.filter(i=>i.type==='canopy');
  if(!cans.length) return { ok:false, reason:'Add a canopy first.', items };
  let mat=0, amtNow=0, dsNow=0, paintNow=0;
  cans.forEach(i=>{ mat+=canopyTrueCost(i.spec).material; amtNow+=(i.amount||0); dsNow+=(i.downspoutCost||0); paintNow+=(i.paintCost||0); });
  const baseNow = amtNow - paintNow;
  const sellNow = baseNow + dsNow;
  const target = mat*m;
  const newBaseTotal = target - dsNow;
  const info = { m, mat, amtNow, dsNow, paintNow, baseNow, sellNow, target, newBaseTotal, multBefore: mat>0 ? sellNow/mat : 0 };
  if(newBaseTotal <= 0 || baseNow <= 0) return Object.assign({ ok:false, reason:'Material × '+m+' is less than the downspout lines alone — cannot set.', items }, info);
  const factor = newBaseTotal/baseNow;
  let running=0;
  const amounts = new Map();
  cans.forEach((i,idx)=>{
    const p = i.paintCost||0;
    let amount;
    if(idx===cans.length-1){ amount = Math.round(newBaseTotal-running) + p; }
    else { const nb = Math.round(((i.amount||0)-p)*factor); amount = nb + p; running += nb; }
    amounts.set(i, amount);
  });
  const out = items.map(i => amounts.has(i) ? Object.assign({}, i, { amount: amounts.get(i) }) : i);
  return Object.assign({ ok:true, factor, items: out }, info);
}

/* ---------------- exports ---------------- */
exports.EMS_QUOTE = EMS_QUOTE;
exports.EMS = EMS;
exports.CM = CM;
exports.CM_CONST = { DS_DROP_FT, CM_COST_MODE, CM_KERF_FT, CM_WASTE, CM_FAS, CM_LABOR, CM_PAINTMAT, CM_FREIGHT, CM_MISC_PCT };
exports.emsStick = emsStick;
exports.emsLen = emsLen;
exports.emsDesc = emsDesc;
exports.recipeSkuRoles = recipeSkuRoles;
exports.cmFfd = cmFfd;
exports.rodPerLeg = rodPerLeg;
exports.canopyTrueCost = canopyTrueCost;
exports.marginSummary = marginSummary;
exports.applyMargin = applyMargin;
exports.RATES = RATES;
exports.CONST = CONST;
exports.OHIO_COUNTY_RATES = OHIO_COUNTY_RATES;
exports.GROUPS = { canopy: GROUP_CANOPY, fabric: GROUP_FABRIC, standingSeam: GROUP_SS, patiocanopy: GROUP_PATIO, patiorailing: GROUP_RAILING };
exports.pickTier = pickTier;
exports.canopySection = canopySection;
exports.parseFtInInches = parseFtInInches;
exports.ftInLabel = ftInLabel;
exports.priceCanopy = priceCanopy;
exports.pricePatio = pricePatio;
exports.priceStandingSeam = priceStandingSeam;
exports.priceFabric = priceFabric;
exports.priceSunshade = priceSunshade;
exports.priceRecover = priceRecover;
exports.priceItem = priceItem;
exports.buildItem = buildItem;
exports.deliveryCost = deliveryCost;
exports.computeTotals = computeTotals;
exports.importTakeoff = importTakeoff;
exports.extractTakeoffJSON = extractTakeoffJSON;
exports.extractTakeoffAll = extractTakeoffAll;
exports.takeoffTax = takeoffTax;
return exports;
}));
