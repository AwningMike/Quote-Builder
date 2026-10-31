/* =========================================================================
   NEW BASE LINK  (Flow Digital Migration Base)                      v1
   Loaded AFTER the main script in canopy_quote_calculator.html and
   fabric_quote_calculator.html. Replaces the dormant "Send to New Base"
   push with one that:
     • links the quote to a JOB RECORD by record ID (never by name)
     • lets you pick the job from the base (🔗 Pick Job), or creates it once
     • re-pushing UPDATES that same quote (old line items replaced, no dupes)
     • sends the builder's exact line prices (Builder Line Total)
     • writes price, margin, labor/travel, Margin History, Quote PDF,
       Bid Status / Quote Sent Date
   The record ID travels with the quote (hidden header field "hdr-nbquote"),
   so it is saved with device quotes and the cloud Quote Builder State, and a
   takeoff JSON can carry it as "recordId" (or job.recordId).
   ========================================================================= */
const NB = {
  baseId: 'appgkGZ1G6YeHOVAi',            // Flow Digital Migration Base (live)
  t: { quotes:'tbluonHEUpfEp64Ze', reqs:'tblEVnvT3rVK50Xe6', lines:'tbl6lzqYtBTDFR3KX', inv:'tblfsAblcEvPFWbKK' },
  q: {  // Quotes/Work Orders
    name:'fldFG9G78g04eHdxo', type:'fldyuEW1nUiYWZkeB', reqLink:'fldJ6M9OyUmH66kEn', lineLink:'fldBjdHC0Y9HLiWgx',
    state:'fldd7zyICqmX7xnxJ', sqft:'fldxJJjfxP9n2uxWs', distance:'fld54Ggr8d7MXu7AN', pdf:'fldqoBvjSCGlbERe1',
    contract:'fld7eNrlItCIJL5s7', qbNo:'fldKFjD9VfrimA8h9', company:'fldlZJWNDJXgzvLrV', service:'fldqxv5b9n9hxEAUh',
    pm:'fld9CnrOq3V1lv0TZ', siteContact:'fldSvsSEhbGRW8iqg', bidStatus:'fldKRJwVJibEPSj35', quoteSent:'fldbUaFIpvxQjxH5M',
    matCost:'fldpZIOlWqBZK6kWt', target:'fldMyqqRr6oSuuxoE', basis:'fldxu6Ws12T8dhQTo', marginLabor:'fldlX1h4TWCSQXxPx',
    laborCost:'fldMIO6AU0hRlSZO3', travelCost:'fld4WllzlOrfOdjbq', laborBasis:'fldi4t4qNIJUz25b2',
    snapDate:'fldwXsoIYroXhKrUq', history:'fldGH8p0NN5iLX6M2', bidDueLk:'fldMuXZa9HX6N2UzV', addrLk:'fld1U7J97YY0KVcYc',
    builtOut:'fld87IQul02q2WpyN',   // "Quote Built Out?" — checked = Quotes Waiting Approval page
  },
  r: {  // Quote Requests
    projName:'fldt6IkbytVXaoPlo', address:'fldYtcQCEJnsoTvfY', city:'fldii344bPuQWXduV', state:'fldT1HtAR8jzyaIlc',
    zip:'fldQZJuNgpyryB0iv', details:'fld5zK52jpWKcJEpc', bidDue:'fldxd04HylKNmP3Rj', distance:'fldzPdTK28j1aLXgN',
    customer:'fldJQm29Xtu2woqGK',
  },
  li: { parent:'fldtaiuuiYPmdAlHA', qty:'fldRfSY9Wgh2K4h27', inv:'fldEw0ChyiUpv6vgj', desc:'fldRzlvWQmnrH0d97', total:'fldq6hiF98nOSZVCy' },
  pmUser: 'usrbYftDso64IrJbg',            // Mike Sommer — PM on jobs the builder creates
  closedStatuses: ['Won','Lost','No Bid','No Canopies / Awnings'],
};

/* ---- point the existing new-base helpers (inventory map, preview) at the live base ---- */
try {
  if (typeof AIRTABLE_CFG !== 'undefined') {
    AIRTABLE_CFG.enabled = true;
    AIRTABLE_CFG.baseId = NB.baseId;
    AIRTABLE_CFG.fields.li_lineTotal = NB.li.total;
    AIRTABLE_CFG.inventory.posts    = 'recpmAwaldBBHs5CW';
    AIRTABLE_CFG.inventory.miter    = 'recQ8ZuvFmrBeQgua';
    AIRTABLE_CFG.inventory.sunshade = 'recba3n89Lqy036s6';
  }
} catch (e) {}

/* ---- hidden header field that carries the linked record ID ---- */
function _nbEnsureLinkField(){
  if (!document.getElementById('hdr-nbquote')) {
    const inp = document.createElement('input');
    inp.type = 'hidden'; inp.id = 'hdr-nbquote';
    const anchor = document.getElementById('hdr-projno') || document.body;
    (anchor.parentNode || document.body).appendChild(inp);
  }
  try { if (typeof QB_HDR_FIELDS !== 'undefined' && QB_HDR_FIELDS.indexOf('hdr-nbquote') < 0) QB_HDR_FIELDS.push('hdr-nbquote'); } catch (e) {}
}
function nbLinkedId(){ const el = document.getElementById('hdr-nbquote'); return el ? (el.value || '').trim() : ''; }
function nbSetLinked(id, name){
  _nbEnsureLinkField();
  document.getElementById('hdr-nbquote').value = id || '';
  try { localStorage.setItem('nb_linked_name_' + id, name || ''); } catch (e) {}
  _nbRenderBadge(name);
}
function _nbRenderBadge(name){
  let b = document.getElementById('nb-link-badge');
  const id = nbLinkedId();
  if (!b) {
    b = document.createElement('div'); b.id = 'nb-link-badge';
    b.style.cssText = 'font-size:12px;margin:6px 0;padding:6px 8px;border-radius:5px;';
    const btn = document.getElementById('nb-pick-btn');
    if (btn && btn.parentNode) btn.parentNode.insertBefore(b, btn); else return;
  }
  if (!name && id) { try { name = localStorage.getItem('nb_linked_name_' + id) || ''; } catch (e) {} }
  if (id) {
    b.style.background = '#e7f5ec'; b.style.color = '#1a5f2f';
    b.innerHTML = `🔗 Linked to new-base job: <b>${_nbEsc(name || id)}</b> <a href="#" style="margin-left:6px;color:#b23" onclick="nbUnlink();return false;">unlink</a>`;
  } else {
    b.style.background = '#fff6e5'; b.style.color = '#7a5200';
    b.innerHTML = 'Not linked to a new-base job yet — <b>🔗 Pick Job</b> first, or Upload will create a new job.';
  }
}
function nbUnlink(){ nbSetLinked('', ''); }
const _nbEsc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const _nbApi = (tbl, rest) => `https://api.airtable.com/v0/${NB.baseId}/${tbl}${rest || ''}`;
const _nbH = token => ({ 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' });
async function _nbJson(r){ let b = {}; try { b = await r.json(); } catch (e) {} if (!r.ok || b.error) throw new Error((b.error && (b.error.message || b.error.type)) || ('HTTP ' + r.status)); return b; }
const _nbFirst = v => Array.isArray(v) ? v[0] : v;

/* ---- relabel / add buttons once the page is up ---- */
function _nbInitUi(){
  _nbEnsureLinkField();
  const sendBtn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('onclick') || '').indexOf('pushToAirtable()') >= 0);
  if (sendBtn && !document.getElementById('nb-pick-btn')) {
    sendBtn.textContent = '⬆ Upload to New Base';
    sendBtn.title = 'Upload this quote to the linked job in the new base (Flow Digital Migration Base)';
    sendBtn.style.background = '#1a7f37'; sendBtn.classList.remove('secondary');
    const pick = document.createElement('button');
    pick.id = 'nb-pick-btn'; pick.className = 'btn secondary'; pick.textContent = '🔗 Pick Job (new base)';
    pick.title = 'Choose which job in the new base this quote belongs to';
    pick.onclick = () => nbOpenPicker();
    sendBtn.parentNode.insertBefore(pick, sendBtn);
    _nbRenderBadge();
  }
  const oldBtn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('onclick') || '').indexOf('pushToCurrentBase()') >= 0);
  if (oldBtn) { oldBtn.textContent = '⬆ Upload to OLD base (APMG Projects)'; oldBtn.style.background = '#6b7280'; }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _nbInitUi); else _nbInitUi();

/* ---- keep the badge right after a quote is reopened (device or cloud) ---- */
if (typeof restoreQuoteState === 'function') {
  const _nbOrigRestore = restoreQuoteState;
  window.restoreQuoteState = function(st){ _nbEnsureLinkField(); const ok = _nbOrigRestore(st); _nbRenderBadge(); return ok; };
}

/* ---- takeoff JSON can carry the record ID: { "recordId": "rec…", job:{…}, canopies:[…] } ---- */
if (typeof importTakeoff === 'function') {
  const _nbOrigImport = importTakeoff;
  window.importTakeoff = function(data){
    try {
      let d = data;
      if (typeof d === 'string' && typeof _tkExtractAll === 'function') d = (_tkExtractAll(d) || [])[0];
      const rid = d && (d.recordId || (d.job && d.job.recordId));
      if (rid && /^rec[A-Za-z0-9]{14}$/.test(rid) && !nbLinkedId()) nbSetLinked(rid, (d.job && (d.job.projectName || d.job.shipName)) || rid);
    } catch (e) {}
    return _nbOrigImport(data);
  };
}

/* ========================= JOB PICKER ========================= */
function nbOpenPicker(){
  const back = document.createElement('div');
  back.className = 'drawing-modal-backdrop'; back.id = 'nb-pick-backdrop';
  back.onclick = (e) => { if (e.target === back) back.remove(); };
  back.innerHTML = `<div class="drawing-modal" style="max-width:640px">
    <h3>🔗 Pick the job (new base)</h3>
    <div style="font-size:12.5px;color:#555;margin-bottom:8px">Open bids/quotes from the Flow Digital Migration Base. Picking one links this quote to that record — uploads always go to it, whatever the names say.</div>
    <div style="display:flex;gap:6px;margin-bottom:8px">
      <input id="nb-pick-search" type="text" placeholder="Search job name…" style="flex:1;padding:10px;border:1px solid #bbb;border-radius:5px;font-size:15px"
        onkeydown="if(event.key==='Enter')nbSearchJobs()">
      <button class="btn" style="background:#3f5878;padding:7px 12px;font-size:12px" onclick="nbSearchJobs()">Search</button>
    </div>
    <div id="nb-pick-results" style="font-size:12px;color:#888;max-height:420px;overflow:auto">Loading open bids…</div>
    <div class="dm-actions" style="margin-top:10px"><button class="dm-close" onclick="document.getElementById('nb-pick-backdrop').remove()">Close</button></div>
  </div>`;
  document.body.appendChild(back);
  const s = document.getElementById('nb-pick-search');
  const guess = _atHdr('hdr-projname') || _atHdr('hdr-shipname');
  if (s && guess) s.value = guess.split(/[-–—,]/)[0].trim();
  nbSearchJobs();
}
async function nbSearchJobs(){
  const res = document.getElementById('nb-pick-results'); if (!res) return;
  const token = _atToken();
  if (!token) { res.innerHTML = '<span style="color:#b23">Paste your Airtable token first (⚙ Airtable connection). It needs access to the Flow Digital Migration Base.</span>'; return; }
  const term = ((document.getElementById('nb-pick-search') || {}).value || '').trim();
  const closed = NB.closedStatuses.map(s => `{Bid Status}=${JSON.stringify(s)}`).join(',');
  let formula = `AND({Type}='Quote', NOT(OR(${closed})))`;
  if (term) formula = `AND(${formula}, SEARCH(LOWER(${JSON.stringify(term)}), LOWER({Name}&'')))`;
  const Q = NB.q;
  const fields = [Q.name, Q.bidStatus, Q.contract, Q.bidDueLk, Q.addrLk, Q.state, Q.reqLink].map(f => '&fields%5B%5D=' + f).join('');
  res.textContent = 'Searching…';
  try {
    const url = _nbApi(NB.t.quotes, `?maxRecords=50&returnFieldsByFieldId=true&filterByFormula=${encodeURIComponent(formula)}`
      + `&sort%5B0%5D%5Bfield%5D=Last%20Modified%20Time&sort%5B0%5D%5Bdirection%5D=desc` + fields);
    const q = await _nbJson(await fetch(url, { headers: _nbH(token) }));
    const recs = q.records || [];
    window._nbPickCache = {}; recs.forEach(r => window._nbPickCache[r.id] = r);
    const newBtn = `<div style="padding:8px 10px;border:1px dashed #9aa;border-radius:6px;margin-bottom:8px;display:flex;align-items:center;gap:8px">
        <div style="flex:1">Not in the base yet? Create it from this quote's header (${_nbEsc(projectNameForUpload())}).</div>
        <button class="btn" style="background:#3f5878;padding:6px 10px;font-size:12px" onclick="nbCreateFromHeader()">＋ New job</button></div>`;
    if (!recs.length) { res.innerHTML = newBtn + `<div>No open bids matched${term ? ' "' + _nbEsc(term) + '"' : ''}.</div>`; return; }
    res.innerHTML = newBtn + recs.map(r => {
      const f = r.fields || {};
      const due = _nbFirst(f[Q.bidDueLk]) || '';
      const addr = _nbFirst(f[Q.addrLk]) || '';
      const price = f[Q.contract];
      return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #e3e8ef;border-radius:6px;margin-bottom:6px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13px">${_nbEsc(f[Q.name] || '(unnamed)')}</div>
          <div style="font-size:11px;color:#777">${_nbEsc(addr)}${due ? ' · due ' + _nbEsc(due) : ''}${f[Q.bidStatus] ? ' · ' + _nbEsc(f[Q.bidStatus]) : ''}${price ? ' · $' + Math.round(price).toLocaleString() : ''}${f[Q.state] ? ' · has saved quote' : ''}</div>
        </div>
        <button class="btn" style="background:#1a7f37;padding:6px 10px;font-size:12px" onclick="nbPickJob('${r.id}')">Link</button>
      </div>`;
    }).join('');
  } catch (e) { res.innerHTML = '<span style="color:#b23">Search failed: ' + _nbEsc(e.message) + '</span>'; }
}
async function nbPickJob(quoteId){
  const token = _atToken(); const Q = NB.q, R = NB.r;
  const rec = (window._nbPickCache || {})[quoteId];
  const name = rec && rec.fields[Q.name];
  try {
    // offer to reopen the saved quote if the screen is empty
    if (rec && rec.fields[Q.state] && !(quoteItems || []).length && confirm('This job has a saved Quote Builder quote. Open it?')) {
      try { restoreQuoteState(JSON.parse(rec.fields[Q.state])); } catch (e) {}
    }
    // fill blank header fields from the Quote Request
    const reqId = rec && _nbFirst(rec.fields[Q.reqLink]);
    if (reqId) {
      const rq = await _nbJson(await fetch(_nbApi(NB.t.reqs, '/' + reqId + '?returnFieldsByFieldId=true'), { headers: _nbH(token) }));
      const f = rq.fields || {};
      const fill = (id, v) => { const el = document.getElementById(id); if (el && v && !String(el.value || '').trim()) el.value = v; };
      fill('hdr-projname', f[R.projName]); fill('hdr-shipname', f[R.projName]);
      fill('hdr-address1', f[R.address]);
      const csz = [f[R.city], [f[R.state], f[R.zip]].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      const a2 = document.getElementById('hdr-address2');
      if (a2 && csz && !String(a2.value || '').trim()) { a2.value = csz; try { calcDeliveryMiles(); } catch (e) {} }
      fill('hdr-biddue', f[R.bidDue]);
      fill('hdr-to', f[R.customer]);
    }
    nbSetLinked(quoteId, name);
    const bd = document.getElementById('nb-pick-backdrop'); if (bd) bd.remove();
    try { renderQuote(); } catch (e) {}
  } catch (e) { alert('Could not link that job: ' + e.message); }
}

/* create Quote Request + Quote from the header (used by "＋ New job" and by Upload when nothing is linked) */
async function _nbCreateJob(token){
  const Q = NB.q, R = NB.r;
  const cs = _splitCityStateZip(_atHdr('hdr-address2'));
  const rf = {};
  rf[R.projName] = projectNameForUpload();
  rf[R.address] = _atHdr('hdr-address1'); rf[R.city] = cs.city; rf[R.state] = cs.state; rf[R.zip] = cs.zip;
  rf[R.details] = `Created from APMG Quote Builder ${new Date().toLocaleDateString()}. GC: ${_atHdr('hdr-gc') || '—'}. Bid due: ${_atHdr('hdr-biddue') || '—'}.`;
  const to = _atHdr('hdr-to'); if (to) rf[R.customer] = to;
  const miles = parseFloat((document.getElementById('extra-miles') || {}).value) || 0; if (miles) rf[R.distance] = miles;
  Object.keys(rf).forEach(k => { if (rf[k] == null || rf[k] === '') delete rf[k]; });
  const rq = await _nbJson(await fetch(_nbApi(NB.t.reqs), { method: 'POST', headers: _nbH(token), body: JSON.stringify({ records: [{ fields: rf }] }) }));
  const reqId = rq.records[0].id;
  const qf = {};
  qf[Q.type] = 'Quote'; qf[Q.reqLink] = [reqId]; qf[Q.bidStatus] = 'Estimating';
  qf[Q.company] = _atHdr('hdr-company') || 'SA';
  if (NB.pmUser) qf[Q.pm] = [{ id: NB.pmUser }];
  const gc = _atHdr('hdr-gc'); if (gc) qf[Q.siteContact] = gc;
  const qq = await _nbJson(await fetch(_nbApi(NB.t.quotes, '?returnFieldsByFieldId=true'), { method: 'POST', headers: _nbH(token), body: JSON.stringify({ records: [{ fields: qf }], typecast: true }) }));
  const rec = qq.records[0];
  // read back the formula name
  let name = rf[R.projName];
  try { const g = await _nbJson(await fetch(_nbApi(NB.t.quotes, '/' + rec.id + '?returnFieldsByFieldId=true'), { headers: _nbH(token) })); name = (g.fields || {})[Q.name] || name; } catch (e) {}
  nbSetLinked(rec.id, name);
  return { id: rec.id, reqId, name };
}
async function nbCreateFromHeader(){
  const token = _atToken(); if (!token) { alert('Paste your Airtable token first.'); return; }
  if (!confirm(`Create a NEW job in the new base?\n\n${projectNameForUpload()}\n${_atHdr('hdr-address1')} ${_atHdr('hdr-address2')}\n\nOnly do this if the bid isn't already in the base.`)) return;
  try { const j = await _nbCreateJob(token); const bd = document.getElementById('nb-pick-backdrop'); if (bd) bd.remove(); alert('Created ✓\n' + j.name + '\nThis quote is now linked to it.'); }
  catch (e) { alert('Create failed: ' + e.message); }
}

/* ========================= MARGIN SNAPSHOT (no write) ========================= */
function nbMarginSnapshot(){
  try {
    if (typeof canopyTrueCost !== 'function') return null;
    const cans = (quoteItems || []).filter(i => i.type === 'canopy');
    if (!cans.length) return null;
    let sell = 0, mat = 0, sqft = 0;
    cans.forEach(i => { const c = canopyTrueCost(i.spec); sell += i.amount + (i.downspoutCost || 0) - (i.paintCost || 0); mat += c.material; sqft += c.sqft; });
    if (sell <= 0) return null;
    const target = parseFloat((document.getElementById('mc-target') || {}).value) || 42.5;
    const out = { sell, mat, sqft, target, marginPct: (sell - mat) / sell * 100 };
    if (typeof getInstallerFeed === 'function') {
      const feed = getInstallerFeed();
      if (feed) {
        const crew = qbSelectedCrew(feed);
        const r = computeInstallerCost(feed, crew);
        const installation = (lastQuoteSummary && lastQuoteSummary.installation) || 0;
        const sellAll = sell + installation;
        if (sellAll > 0) Object.assign(out, { labor: r.labor, travel: r.travel, crew: crew.name, marginLPct: (sellAll - mat - r.labor - r.travel) / sellAll * 100 });
      }
    }
    return out;
  } catch (e) { return null; }
}

/* ========================= UPLOAD ========================= */
// opts: { markSent:true|false, noPrompt:true }  — noPrompt for scripted runs
async function pushToAirtable(opts){
  opts = opts || {};
  const token = _atToken();
  if (!token) { alert('Paste your Airtable token first (⚙ Airtable connection). It needs read+write access to the Flow Digital Migration Base.'); return; }
  if (!(quoteItems || []).length) { alert('Add at least one item to the quote first.'); return; }
  _nbEnsureLinkField();
  if (!opts.noPrompt) {
    const choice = await _nbConfirmUpload();
    if (!choice) return;
    opts.markSent = choice.markSent;
  }
  const Q = NB.q, L = NB.li, H = _nbH(token);
  const step = [];
  try {
    // 1) the job record
    let quoteId = nbLinkedId(), name = '', created = false, current = null;
    if (quoteId) {
      try { current = await _nbJson(await fetch(_nbApi(NB.t.quotes, '/' + quoteId + '?returnFieldsByFieldId=true'), { headers: H })); }
      catch (e) { throw new Error('The linked job (' + quoteId + ') could not be opened: ' + e.message + '. Unlink and pick the job again.'); }
      name = (current.fields || {})[Q.name] || '';
    } else {
      const j = await _nbCreateJob(token); quoteId = j.id; name = j.name; created = true;
      current = await _nbJson(await fetch(_nbApi(NB.t.quotes, '/' + quoteId + '?returnFieldsByFieldId=true'), { headers: H }));
    }
    const cf = current.fields || {};
    // 2) replace this quote's line items
    const p = serializeQuoteForAirtable();
    try { await fetchInventoryMap(token); } catch (e) {}
    const oldLines = cf[Q.lineLink] || [];
    for (let i = 0; i < oldLines.length; i += 10) {
      const qs = oldLines.slice(i, i + 10).map(id => 'records%5B%5D=' + id).join('&');
      await _nbJson(await fetch(_nbApi(NB.t.lines, '?' + qs), { method: 'DELETE', headers: H }));
    }
    const recs = p.lineItems.map(l => {
      const f = {}; f[L.parent] = [quoteId]; f[L.qty] = l.qty; f[L.desc] = l.desc; f[L.total] = l.lineTotal;
      const invId = resolveInv(l.invName, l.invKey); if (invId) f[L.inv] = [invId];
      return { fields: f };
    });
    for (let i = 0; i < recs.length; i += 10) {
      await _nbJson(await fetch(_nbApi(NB.t.lines), { method: 'POST', headers: H, body: JSON.stringify({ records: recs.slice(i, i + 10) }) }));
    }
    step.push(`${recs.length} line items` + (oldLines.length ? ` (replaced ${oldLines.length} old)` : ''));
    // 3) quote fields
    const s = lastQuoteSummary || {};
    const today = new Date().toLocaleDateString('en-CA');   // local YYYY-MM-DD (not UTC)
    const qf = {};
    qf[Q.state] = JSON.stringify(captureQuoteState());   // reopenable from "Open quote → From Airtable"
    qf[Q.sqft] = p.quote.sqft; qf[Q.distance] = p.quote.distance;
    qf[Q.contract] = Math.round((s.total || 0) * 100) / 100;
    const qb = _atHdr('hdr-projno'); if (qb && !cf[Q.qbNo]) qf[Q.qbNo] = qb;
    const svc = serviceFromQuote(); if (svc.length) qf[Q.service] = [...new Set([...(cf[Q.service] || []), ...svc])];
    if (!cf[Q.company]) qf[Q.company] = _atHdr('hdr-company') || 'SA';
    const st = cf[Q.bidStatus] || '';
    if (opts.markSent && NB.closedStatuses.indexOf(st) < 0) { qf[Q.bidStatus] = 'Quote Sent'; qf[Q.quoteSent] = today; qf[Q.builtOut] = true; }   // builtOut moves it to Quotes Waiting Approval
    else if (!st || st === 'Estimating' || st === 'Scrubbing / Scaling') qf[Q.bidStatus] = 'Ready to Quote';
    const m = nbMarginSnapshot();
    let mLine = `${today} · Quote Builder · sell $${Math.round(s.total || 0).toLocaleString()}`;
    if (m) {
      qf[Q.matCost] = Math.round(m.mat); qf[Q.target] = Math.round(m.target * 10) / 1000; qf[Q.basis] = 'Material only';
      mLine += ` · canopy sell $${Math.round(m.sell).toLocaleString()} · material $${Math.round(m.mat).toLocaleString()} · ${m.marginPct.toFixed(1)}% material (target ${m.target}%)`;
      if (m.marginLPct != null) {
        qf[Q.laborCost] = Math.round(m.labor); qf[Q.travelCost] = Math.round(m.travel);
        qf[Q.marginLabor] = Math.round(m.marginLPct * 10) / 1000; qf[Q.laborBasis] = 'Material + install labor (' + m.crew + ')';
        mLine += ` · ${m.marginLPct.toFixed(1)}% w/ install labor (${m.crew})`;
      }
      qf[Q.snapDate] = today;
    }
    qf[Q.history] = ((cf[Q.history] || '').trimEnd() + '\n' + mLine).trim();
    qf[Q.pdf] = [];                                       // replaced by the fresh PDF below
    await _nbJson(await fetch(_nbApi(NB.t.quotes), { method: 'PATCH', headers: H, body: JSON.stringify({ records: [{ id: quoteId, fields: qf }], typecast: true }) }));
    // fill blank Project Address / City / State / Zip / Bid Due on the Quote Request from this header (never overwrites)
    try {
      const reqId = _nbFirst(cf[Q.reqLink]);
      if (reqId) {
        const rq = await _nbJson(await fetch(_nbApi(NB.t.reqs, '/' + reqId + '?returnFieldsByFieldId=true'), { headers: H }));
        const hdr = {}; ['hdr-address1','hdr-address2','hdr-biddue'].forEach(id => hdr[id] = _atHdr(id));
        const rf = _nbReqFillFromHeader(hdr, rq.fields || {});
        if (Object.keys(rf).length) { await _nbJson(await fetch(_nbApi(NB.t.reqs), { method: 'PATCH', headers: H, body: JSON.stringify({ records: [{ id: reqId, fields: rf }] }) })); step.push('filled blank ' + Object.keys(rf).length + ' field(s) on the Quote Request'); }
      }
    } catch (e) {}
    step.push('price $' + Math.round(s.total || 0).toLocaleString() + (qf[Q.bidStatus] ? ' · Bid Status → ' + qf[Q.bidStatus] : ''));
    if (m) step.push(`margin ${m.marginPct.toFixed(1)}% material${m.marginLPct != null ? ' · ' + m.marginLPct.toFixed(1) + '% w/ labor' : ''}`);
    // 4) quote PDF
    try {
      const b64 = await generateQuotePdfBase64();
      if (b64) {
        const nm = _atHdr('hdr-projname') || _atHdr('hdr-shipname') || 'Quote';
        const r = await fetch(`https://content.airtable.com/v0/${NB.baseId}/${quoteId}/${Q.pdf}/uploadAttachment`, {
          method: 'POST', headers: H, body: JSON.stringify({ contentType: 'application/pdf', filename: `Quote - ${nm}.pdf`, file: b64 }) });
        step.push(r.ok ? 'quote PDF attached' : 'quote PDF NOT attached (' + r.status + ')');
      }
    } catch (e) { step.push('quote PDF NOT attached: ' + e.message); }
    const msg = `Uploaded to NEW base ✓\n${name}${created ? '  (new job created)' : ''}\n\n• ` + step.join('\n• ')
      + `\n\nhttps://airtable.com/${NB.baseId}/${NB.t.quotes}/${quoteId}`;
    window.__nbLastResult = { ok: true, quoteId, name, created, steps: step };
    alert(msg);
    _nbRenderBadge(name);
    return window.__nbLastResult;
  } catch (err) {
    window.__nbLastResult = { ok: false, error: err.message, steps: step };
    alert('Upload to new base failed: ' + err.message + (step.length ? '\n\nDone before the error:\n• ' + step.join('\n• ') : ''));
    return window.__nbLastResult;
  }
}
function _nbConfirmUpload(){
  return new Promise(resolve => {
    const linked = nbLinkedId();
    let nm = ''; try { nm = localStorage.getItem('nb_linked_name_' + linked) || ''; } catch (e) {}
    const s = lastQuoteSummary || {};
    const back = document.createElement('div');
    back.className = 'drawing-modal-backdrop'; back.id = 'nb-up-backdrop';
    back.innerHTML = `<div class="drawing-modal" style="max-width:520px">
      <h3>⬆ Upload to new base</h3>
      <div style="font-size:13px;line-height:1.5;margin-bottom:10px">
        ${linked ? `Updating job: <b>${_nbEsc(nm || linked)}</b>` : `<span style="color:#9a6700">No job linked.</span> A NEW job will be created: <b>${_nbEsc(projectNameForUpload())}</b><br><span style="font-size:12px;color:#777">If the bid is already in the base, Cancel and use 🔗 Pick Job instead.</span>`}
        <br>Quote total: <b>$${Math.round(s.total || 0).toLocaleString()}</b>
      </div>
      <label style="font-size:13px;display:flex;gap:6px;align-items:center;margin-bottom:12px"><input type="checkbox" id="nb-mark-sent"> Mark as <b>Quote Sent</b> today</label>
      <div class="dm-actions">
        <button class="dm-download" id="nb-up-go">Upload</button>
        <button class="dm-close" id="nb-up-cancel">Cancel</button>
      </div></div>`;
    document.body.appendChild(back);
    const done = v => { back.remove(); resolve(v); };
    document.getElementById('nb-up-go').onclick = () => done({ markSent: document.getElementById('nb-mark-sent').checked });
    document.getElementById('nb-up-cancel').onclick = () => done(null);
    back.onclick = (e) => { if (e.target === back) done(null); };
  });
}

/* ---- connection test: check BOTH bases ---- */
async function testAirtableConnection(){
  const t = document.getElementById('at-token-input');
  const token = (t && t.value.trim()) || _atToken();
  if (!token) { alert('Paste your Airtable token first, then Test.'); return; }
  try { localStorage.setItem('apmg_at_token', token); } catch (e) {}
  const btn = document.getElementById('at-test-conn'); if (btn) { btn.textContent = 'Testing…'; btn.disabled = true; }
  const check = async (base, tbl, label) => {
    try {
      const r = await fetch(`https://api.airtable.com/v0/${base}/${tbl}?maxRecords=1`, { headers: { 'Authorization': 'Bearer ' + token } });
      if (r.status === 200) return `✅ ${label}: read OK`;
      if (r.status === 401) return `❌ ${label}: token not recognized (re-copy the full pat… value)`;
      return `❌ ${label}: no access (HTTP ${r.status}) — add this base to the token's Access list`;
    } catch (e) { return `❌ ${label}: ${e.message}`; }
  };
  const a = await check(NB.baseId, NB.t.quotes, 'NEW base (Flow Digital Migration Base)');
  const b = (typeof CURRENT_BASE_CFG !== 'undefined') ? await check(CURRENT_BASE_CFG.baseId, CURRENT_BASE_CFG.table, 'OLD base (APMG Projects)') : '';
  alert('Airtable connection test:\n\n' + a + (b ? '\n' + b : '') + '\n\nUploads also need the "data.records:write" scope on the token.');
  if (btn) { btn.textContent = 'Test connection'; btn.disabled = false; }
}

/* ---- "Open quote → From Airtable": search the NEW base first, then the old one ---- */
if (typeof searchAirtableQuotes === 'function') {
  const _nbOrigSearch = searchAirtableQuotes;
  window.searchAirtableQuotes = async function(){
    const res = document.getElementById('qb-cloud-results'); if (!res) return;
    const term = ((document.getElementById('qb-cloud-search') || {}).value || '').trim();
    const token = _atToken();
    if (!token || !term) return _nbOrigSearch();
    res.textContent = 'Searching…';
    const Q = NB.q;
    let html = '';
    try {
      const formula = `AND({Quote Builder State}!='', SEARCH(LOWER(${JSON.stringify(term)}), LOWER({Name}&'')))`;
      const url = _nbApi(NB.t.quotes, `?maxRecords=25&returnFieldsByFieldId=true&filterByFormula=${encodeURIComponent(formula)}&fields%5B%5D=${Q.name}&fields%5B%5D=${Q.contract}&fields%5B%5D=${Q.bidStatus}`);
      const q = await _nbJson(await fetch(url, { headers: _nbH(token) }));
      const recs = q.records || [];
      html = `<div style="font-weight:700;color:#1a5f2f;margin:4px 0 6px">New base</div>` + (recs.length ? recs.map(r => {
        const f = r.fields || {};
        return `<div style="display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid #e3e8ef;border-radius:6px;margin-bottom:6px">
          <div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px">${_nbEsc(f[Q.name] || '(unnamed)')}</div>
          <div style="font-size:11px;color:#777">${f[Q.contract] ? '$' + Math.round(f[Q.contract]).toLocaleString() : '—'}${f[Q.bidStatus] ? ' · ' + _nbEsc(f[Q.bidStatus]) : ''}</div></div>
          <button class="btn" style="background:#1a7f37;padding:6px 10px;font-size:12px" onclick="nbOpenCloudQuote('${r.id}')">Open</button></div>`;
      }).join('') : '<div style="margin-bottom:8px">No saved quotes in the new base matched.</div>');
    } catch (e) { html = '<span style="color:#b23">New base search failed: ' + _nbEsc(e.message) + '</span>'; }
    await _nbOrigSearch();   // old base results (fills the same box)
    res.innerHTML = html + `<div style="font-weight:700;color:#5a6b82;margin:12px 0 6px">Old base (APMG)</div>` + res.innerHTML;
  };
}
async function nbOpenCloudQuote(quoteId){
  const token = _atToken(); const Q = NB.q;
  try {
    const q = await _nbJson(await fetch(_nbApi(NB.t.quotes, '/' + quoteId + '?returnFieldsByFieldId=true'), { headers: _nbH(token) }));
    const raw = (q.fields || {})[Q.state];
    if (!raw) { alert('That job has no saved Quote Builder state.'); return; }
    let st; try { st = JSON.parse(raw); } catch (e) { alert('Saved state on that job is unreadable.'); return; }
    if ((quoteItems || []).length && !confirm('Open this quote? It replaces what you have on screen now.')) return;
    if (restoreQuoteState(st)) {
      nbSetLinked(quoteId, (q.fields || {})[Q.name]);
      try { closeQuotesModal(); } catch (e) {}
    }
  } catch (e) { alert('Load failed: ' + e.message); }
}

/* =========================================================================
   v3 — PRICE SYNC + BACKFILL  (buttons in ⚙ Airtable connection)
   ========================================================================= */
const NB_INV = { // Quote Inventory (sell prices) + inventory (supplier material costs)
  qi: { tbl:'tblfsAblcEvPFWbKK', name:'fldfLIGLTdzyEQWop', notes:'fldgHHn4QksWBpeu9', price:'fldiFEBjklctP7HXu', type:'fldz6uyDXvXoAm6mt' },
  mat:{ tbl:'tbl7Smg8bz7aLFhAR', sku:'fldDze0vJWMRiszyp', desc:'fld0E39lwvr5tX0De', cost:'fldeA4q2PbAFyqf54', eff:'fldHbfUEEq0Ea2vMm', prev:'fldlCza56xfm9Y4Fo' },
};
async function _nbAll(tbl, params, token){
  let out = [], offset = '';
  do {
    const j = await _nbJson(await fetch(_nbApi(tbl, `?pageSize=100&returnFieldsByFieldId=true${params || ''}${offset ? '&offset=' + offset : ''}`), { headers: _nbH(token) }));
    out = out.concat(j.records || []); offset = j.offset || '';
  } while (offset);
  return out;
}
async function _nbWrite(tbl, method, recs, token){
  const ids = [];
  for (let i = 0; i < recs.length; i += 10) {
    const j = await _nbJson(await fetch(_nbApi(tbl), { method, headers: _nbH(token), body: JSON.stringify({ records: recs.slice(i, i + 10), typecast: true }) }));
    (j.records || []).forEach(r => ids.push(r.id));
    await new Promise(r => setTimeout(r, 220));
  }
  return ids;
}
const _nbUsDate = s => { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return ''; const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; };

/* Sell prices the builder actually uses, keyed by Quote Inventory item name */
function nbBuilderSellPrices(){
  const R = RATES, t8 = R.canopy8 && R.canopy8.tiers || [], t12 = R.canopy12 && R.canopy12.tiers || [];
  const val = id => parseFloat((document.getElementById(id) || {}).value) || null;
  const tiers = (arr, k, unit) => arr.map(t => `${t.name}: $${t[k]}${unit || ''}`).join(' | ');
  const p = {};
  if (t8.length) {
    p['6"-8" Fascia Size']   = { price: t8[0].mfg, note: '8" face MFG $/sqft by tier — ' + tiers(t8, 'mfg') };
    p['LEDs']                = { price: t8[0].lights, note: 'Lights $/ea — 8": ' + tiers(t8, 'lights') + ' || 12": ' + tiers(t12, 'lights') };
    p['Outriggers']          = { price: t8[0].outrigger, note: 'Outrigger $ — 8": ' + tiers(t8, 'outrigger') + ' || 12": ' + tiers(t12, 'outrigger') };
    p['C-Channel']           = { price: t8[0].cchannel, note: 'C-Channel $/ft — ' + tiers(t8, 'cchannel') };
    p['Downspouts']          = { price: t8[0].downspout, note: 'Downspout $/ea — ' + tiers(t8, 'downspout') };
    p['Miter']               = { price: t8[0].miter, note: 'Miter $/ea — 8": ' + tiers(t8, 'miter') + ' || 12": ' + tiers(t12, 'miter') };
    p['Posts']               = { price: t8[0].post || 650, note: 'Post $/ea' };
    p['Labor']               = { price: R.canopy8.laborPerFt, note: `Install labor $/ft — canopy ${R.canopy8.laborPerFt}, standing seam ${R.standingSeam && R.standingSeam.laborPerFt}, fabric ${R.fabric && R.fabric.laborPerFt}, sunshade ${R.sunshade && R.sunshade.laborPerFt}` };
  }
  if (t12.length) p['10"-12" Fascia Size'] = { price: t12[0].mfg, note: '12" face MFG $/sqft by tier — ' + tiers(t12, 'mfg') };
  if (R.jobLevel) p['Travel Rate'] = { price: R.jobLevel.deliveryRate, note: `$/mile one way beyond ${R.jobLevel.flatDeliveryUnderMi} mi; flat $${R.jobLevel.flatDeliveryPrice} inside that` };
  if (R.standingSeam) { p['Standing seam awning'] = { price: R.standingSeam.mfgPerFt, note: `MFG $/ft; ends $${R.standingSeam.endsRate}/ea, valance $${R.standingSeam.valancePerFt}/ft` }; p['Closed Ends'] = { price: R.standingSeam.endsRate, note: 'Standing seam closed ends $/ea' }; }
  if (R.fabric) p['Fabric Awning'] = { price: R.fabric.mfgPerFt, note: `MFG $/lineal ft of width (or $${R.fabric.mfgPerSqft}/sqft mode)` };
  if (R.sunshade) p['Sunshade'] = { price: R.sunshade.mfgPerSqft, note: `MFG $/sqft + $${R.sunshade.laborPerFt}/ft labor` };
  const stamped = val('extra-stamped'); if (stamped) p['Engineering'] = { price: stamped, note: 'Stamped engineering (builder default)' };
  const survey = val('extra-survey'); if (survey) p['Survey / PM'] = { price: survey, note: 'Survey / PM (builder default)' + (R.recover ? `; recover survey $${R.recover.surveyDefault}` : '') };
  p['Lift'] = { price: 1500, note: 'Standard lift charge (entered per job in the builder)' };
  if (R.recover) p['Recover'] = { price: null, note: 'Priced per job: fabric $/yd x markup ' + R.recover.markup + ' — ' + Object.values(R.recover.fabrics).map(f => `${f.label} $${f.yd}/yd`).join(', ') };
  return p;
}

/* opts.apply=false → preview only. Returns the change list. */
async function nbSyncPrices(opts){
  opts = opts || {};
  const token = _atToken(); if (!token) throw new Error('No Airtable token');
  const out = { sell: [], matUpdate: [], matCreate: [], skipped: [] };
  // 1) Quote Inventory sell prices
  const qi = await _nbAll(NB_INV.qi.tbl, '', token), sell = nbBuilderSellPrices();
  const byName = {}; qi.forEach(r => byName[_atNorm(r.fields[NB_INV.qi.name])] = r);
  const qiPatch = [], qiCreate = [];
  Object.entries(sell).forEach(([name, v]) => {
    const r = byName[_atNorm(name)];
    const f = {}; f[NB_INV.qi.notes] = v.note; if (v.price != null) f[NB_INV.qi.price] = v.price;
    if (!r) { f[NB_INV.qi.name] = name; qiCreate.push({ fields: f }); out.sell.push(`+ ${name} $${v.price}`); return; }
    const old = r.fields[NB_INV.qi.price];
    if ((v.price != null && old !== v.price) || (r.fields[NB_INV.qi.notes] || '') !== v.note) { qiPatch.push({ id: r.id, fields: f }); if (v.price != null && old !== v.price) out.sell.push(`${name}: $${old == null ? '—' : old} → $${v.price}`); }
  });
  // 2) inventory supplier costs (canopy builder's Eastern Metal price book)
  const matPatch = [], matCreate = [];
  if (typeof EMS !== 'undefined' && typeof EMS_QUOTE !== 'undefined') {
    const eff = _nbUsDate(EMS_QUOTE.date);
    const mat = await _nbAll(NB_INV.mat.tbl, '', token);
    const bySku = {}; mat.forEach(r => bySku[String(r.fields[NB_INV.mat.sku] || '').trim()] = r);
    Object.entries(EMS).forEach(([sku, e]) => {
      const stick = Math.round(e.ppf * e.len * 100) / 100;
      const r = bySku[sku];
      if (!r) { const f = {}; f[NB_INV.mat.sku] = sku; f[NB_INV.mat.desc] = e.d; f[NB_INV.mat.cost] = stick; f[NB_INV.mat.eff] = eff; matCreate.push({ fields: f }); out.matCreate.push(`${sku} ${e.d} $${stick}`); return; }
      const old = r.fields[NB_INV.mat.cost], oldEff = r.fields[NB_INV.mat.eff] || '';
      if (oldEff && oldEff > eff) { out.skipped.push(`${sku}: base price is newer (${oldEff})`); return; }
      if (old == null || Math.abs(old - stick) > 0.005) { const f = {}; f[NB_INV.mat.cost] = stick; f[NB_INV.mat.eff] = eff; if (old != null) f[NB_INV.mat.prev] = old; matPatch.push({ id: r.id, fields: f }); out.matUpdate.push(`${sku}: $${old == null ? '—' : old} → $${stick}`); }
    });
  }
  if (opts.apply) {
    if (qiPatch.length) await _nbWrite(NB_INV.qi.tbl, 'PATCH', qiPatch, token);
    if (qiCreate.length) await _nbWrite(NB_INV.qi.tbl, 'POST', qiCreate, token);
    if (matPatch.length) await _nbWrite(NB_INV.mat.tbl, 'PATCH', matPatch, token);
    if (matCreate.length) await _nbWrite(NB_INV.mat.tbl, 'POST', matCreate, token);
    out.applied = true;
    try { await fetchInventoryMap(token); } catch (e) {}
  }
  return out;
}
async function nbSyncPricesUi(){
  try {
    const p = await nbSyncPrices({ apply: false });
    const n = p.sell.length + p.matUpdate.length + p.matCreate.length;
    if (!n) { alert('Airtable prices already match the builder ✓'); return; }
    const list = [...p.sell.map(s => 'SELL  ' + s), ...p.matUpdate.map(s => 'COST  ' + s), ...p.matCreate.map(s => 'NEW   ' + s)];
    if (!confirm(`Sync prices to Airtable?\n\n${p.sell.length} sell price(s), ${p.matUpdate.length} material cost(s) to update, ${p.matCreate.length} new SKU(s):\n\n${list.slice(0, 25).join('\n')}${list.length > 25 ? `\n…and ${list.length - 25} more` : ''}`)) return;
    await nbSyncPrices({ apply: true });
    alert('Prices synced to Airtable ✓');
  } catch (e) { alert('Price sync failed: ' + e.message); }
}

/* ---- request blanks: fill address/city/state/zip/bid due from a quote header (never overwrites) ---- */
function _nbReqFillFromHeader(hdr, reqFields){
  const R = NB.r, f = {};
  const cs = _splitCityStateZip(hdr['hdr-address2'] || '');
  if (!reqFields[R.address] && hdr['hdr-address1']) f[R.address] = hdr['hdr-address1'];
  if (!reqFields[R.city] && cs.city) f[R.city] = cs.city;
  if (!reqFields[R.state] && cs.state) f[R.state] = cs.state;
  if (!reqFields[R.zip] && cs.zip) f[R.zip] = cs.zip;
  const due = _nbUsDate(hdr['hdr-biddue']); if (!reqFields[R.bidDue] && due) f[R.bidDue] = due;
  return f;
}
function _nbReqFillFromText(reqFields){
  const R = NB.r, f = {};
  const name = reqFields[R.projName] || '', det = reqFields[R.details] || '';
  if (!reqFields[R.state]) {
    const m = name.match(/(?:-|–|,)\s*([A-Za-z .'-]+?),\s*([A-Z]{2})\b(?!.*,\s*[A-Z]{2}\b)/);
    if (m && /^(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])$/.test(m[2])) { f[R.state] = m[2]; if (!reqFields[R.city]) f[R.city] = m[1].trim(); }
  }
  if (!reqFields[R.bidDue]) {
    const m = det.match(/(?:bid\s*)?due(?:\s*date)?[^0-9\n]{0,25}(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    const d = m && _nbUsDate(m[1]); if (d) f[R.bidDue] = d;
  }
  return f;
}

/* Backfill: rebuild line items (→ Quote Total) from each quote's saved builder state, and fill
   blank Project State / City / Address / Bid Due on the Quote Requests. Restores each quote on
   screen while it works, so save what you're working on first. opts.limit for a test run. */
async function nbBackfill(opts){
  opts = opts || {};
  const token = _atToken(); if (!token) throw new Error('No Airtable token');
  const Q = NB.q, R = NB.r, L = NB.li;
  const res = { quotesChecked: 0, linesBuilt: 0, quotesWithLines: 0, totalMismatch: [], reqFilled: 0, errors: [] };
  window.__nbBackfill = res;
  const quotes = await _nbAll(NB.t.quotes, `&filterByFormula=${encodeURIComponent("AND({Type}='Quote', {Quote Builder State}!='')")}&fields%5B%5D=${Q.name}&fields%5B%5D=${Q.state}&fields%5B%5D=${Q.lineLink}&fields%5B%5D=${Q.reqLink}&fields%5B%5D=${Q.contract}`, token);
  const reqs = await _nbAll(NB.t.reqs, `&fields%5B%5D=${R.projName}&fields%5B%5D=${R.address}&fields%5B%5D=${R.city}&fields%5B%5D=${R.state}&fields%5B%5D=${R.zip}&fields%5B%5D=${R.bidDue}&fields%5B%5D=${R.details}`, token);
  const reqById = {}; reqs.forEach(r => reqById[r.id] = r);
  const reqPatch = {};
  const saved = captureQuoteState();
  try { await fetchInventoryMap(token); } catch (e) {}
  let n = 0;
  for (const q of quotes) {
    if (opts.limit && n >= opts.limit) break;
    res.quotesChecked++;
    let st; try { st = JSON.parse(q.fields[Q.state]); } catch (e) { res.errors.push(q.id + ': unreadable state'); continue; }
    const reqId = _nbFirst(q.fields[Q.reqLink]);
    if (reqId && reqById[reqId] && st.hdr) {
      const f = _nbReqFillFromHeader(st.hdr, reqById[reqId].fields);
      if (Object.keys(f).length) { reqPatch[reqId] = Object.assign(reqPatch[reqId] || {}, f); Object.assign(reqById[reqId].fields, f); }
    }
    if ((q.fields[Q.lineLink] || []).length) { res.quotesWithLines++; continue; }
    if (!Array.isArray(st.items) || !st.items.length) continue;
    n++;
    try {
      quoteItems = []; if (!restoreQuoteState(st)) throw new Error('restore failed');
      try { renderQuote(); } catch (e) {}
      const p = serializeQuoteForAirtable();
      const recs = p.lineItems.map(l => { const f = {}; f[L.parent] = [q.id]; f[L.qty] = l.qty; f[L.desc] = l.desc; f[L.total] = l.lineTotal; const inv = resolveInv(l.invName, l.invKey); if (inv) f[L.inv] = [inv]; return { fields: f }; });
      if (recs.length) { await _nbWrite(NB.t.lines, 'POST', recs, token); res.linesBuilt += recs.length; }
      const sum = p.lineItems.reduce((a, l) => a + l.lineTotal, 0), contract = q.fields[Q.contract];
      if (contract && Math.abs(sum - contract) > Math.max(25, contract * 0.02)) res.totalMismatch.push(`${q.fields[Q.name]}: lines $${Math.round(sum)} vs contract $${Math.round(contract)}`);
    } catch (e) { res.errors.push((q.fields[Q.name] || q.id) + ': ' + e.message); }
  }
  // requests with no saved quote: fill from the project name / details text
  reqs.forEach(r => { const f = _nbReqFillFromText(r.fields); if (Object.keys(f).length) { reqPatch[r.id] = Object.assign(reqPatch[r.id] || {}, f); } });
  const rp = Object.entries(reqPatch).map(([id, fields]) => ({ id, fields }));
  if (rp.length && !opts.dryRun) { await _nbWrite(NB.t.reqs, 'PATCH', rp, token); }
  res.reqFilled = rp.length;
  try { quoteItems = []; restoreQuoteState(saved); } catch (e) {}
  res.done = true;
  return res;
}
async function nbBackfillUi(){
  if (!confirm('Backfill the new base?\n\n• Rebuild line items + Quote Total for saved quotes that have none\n• Fill blank Project State / City / Address / Bid Due on Quote Requests\n\nIt reopens each saved quote on screen while it works (your current quote is put back at the end). Takes a few minutes.')) return;
  try {
    const r = await nbBackfill();
    alert(`Backfill done ✓\n\nQuotes checked: ${r.quotesChecked}\nLine items built: ${r.linesBuilt}\nQuote Requests filled: ${r.reqFilled}\nLine total ≠ contract: ${r.totalMismatch.length}${r.totalMismatch.length ? '\n  ' + r.totalMismatch.slice(0, 8).join('\n  ') : ''}${r.errors.length ? '\nErrors: ' + r.errors.length : ''}`);
  } catch (e) { alert('Backfill failed: ' + e.message); }
}

/* add the two buttons to ⚙ Airtable connection */
if (typeof openAirtableSettings === 'function') {
  const _nbOrigSettings = openAirtableSettings;
  window.openAirtableSettings = function(){
    _nbOrigSettings();
    const ref = document.getElementById('at-refresh-inv');
    if (ref && !document.getElementById('nb-sync-prices')) {
      const a = document.createElement('button'); a.className = 'dm-download'; a.id = 'nb-sync-prices'; a.textContent = 'Sync prices to Airtable'; a.onclick = () => nbSyncPricesUi();
      const b = document.createElement('button'); b.className = 'dm-download'; b.id = 'nb-backfill'; b.textContent = 'Backfill line items & blanks'; b.onclick = () => nbBackfillUi();
      ref.parentNode.insertBefore(b, ref.nextSibling); ref.parentNode.insertBefore(a, ref.nextSibling);
    }
  };
}
