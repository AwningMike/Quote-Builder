/* Delivery miles — port of the page's calcDeliveryMiles() (canopy_quote_calculator.html v96).
   Geocodes the Ship To city with Open-Meteo (free, no key), routes from the shop with OSRM,
   falls back to straight-line × 1.25. Returns ONE-WAY miles; the caller stores
   Math.round(oneWay * 2) in extra-miles exactly like the page does. */

export const QB_SHOP = { label: 'Sommer Awning — 1160 W 16th St, Indianapolis, IN 46202', lat: 39.7893, lon: -86.1815 };

const STATE_NAMES = { AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',DC:'District of Columbia' };

export function haversineMi(a, b) {
  const R = 3958.8, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* "Shelbyville, IN 46176" -> { cityName:"Shelbyville", stAbbr:"IN", noZip:"Shelbyville, IN" } */
export function parseCityState(raw) {
  raw = String(raw || '').trim();
  const noZip = raw.replace(/\s*\d{5}(-\d{4})?\s*$/, '').replace(/[,\s]+$/, '').trim();
  const parts = noZip.split(',').map(s => s.trim()).filter(Boolean);
  const cityName = parts[0] || noZip;
  const stAbbr = (parts[1] || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  return { cityName, stAbbr, noZip };
}

/* Returns { oneWay, roundTrip, place, est } or throws ('City not found' / network). */
export async function deliveryMiles(cityStateZip, fetchImpl) {
  const f = fetchImpl || fetch;
  const { cityName, stAbbr, noZip } = parseCityState(cityStateZip);
  if (!noZip) throw new Error('No Ship To city to geocode');
  const wantState = STATE_NAMES[stAbbr] || null;
  const gRes = await f('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(cityName) + '&count=10&language=en&format=json');
  const gJson = await gRes.json();
  let hits = (gJson.results || []).filter(r => r.country_code === 'US');
  if (wantState) hits = hits.filter(r => (r.admin1 || '') === wantState).concat(hits.filter(r => (r.admin1 || '') !== wantState));
  else hits = hits.filter(r => (r.admin1 || '') === 'Indiana').concat(hits.filter(r => (r.admin1 || '') !== 'Indiana'));
  const hit = hits[0];
  if (!hit) throw new Error('City not found');
  const dest = { lat: hit.latitude, lon: hit.longitude };
  const place = hit.name + ', ' + (hit.admin1 || '');
  let oneWay, est = false;
  try {
    const rRes = await f('https://router.project-osrm.org/route/v1/driving/' + QB_SHOP.lon + ',' + QB_SHOP.lat + ';' + dest.lon + ',' + dest.lat + '?overview=false');
    const rJson = await rRes.json();
    if (rJson.code === 'Ok' && rJson.routes && rJson.routes[0]) oneWay = rJson.routes[0].distance / 1609.344;
    else throw new Error('no route');
  } catch (e) { oneWay = haversineMi(QB_SHOP, dest) * 1.25; est = true; }
  return { oneWay, roundTrip: Math.round(oneWay * 2), place, est };
}
