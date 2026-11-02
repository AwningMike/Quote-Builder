#!/usr/bin/env python3
"""Build the clean one-page APMG quote PDF from a quote-service response (or a saved
Quote Builder State) by printing the Quote Builder's own formal estimate.

    python3 tools/build_quote_pdf.py <response.json | state.json> [more ...] [-o OUTDIR] [--name "Job Name"]

Input: either the JSON the quote service returns ({ok, state, totals, ...}, or the filer's
{"status","ok","body":{...}} wrapper around it) or a bare Quote Builder State
({v, items, hdr, extraVals, extraChecks}).

Output: OUTDIR/<Job>_Quote.pdf (default OUTDIR = ./out). <Job> = --name, else the state's
project name, else the input file's stem. Also writes <Job>_Quote.png (page 1 preview) so
the result can be looked at before it is filed.

How it works: Playwright/Chromium loads canopy_quote_calculator.html from this repo
(file://), restores the state with the page's own restoreQuoteState(), calls
populateFormalQuoteDoc(), hides the app and prints #print-quote-doc as US Letter with
0.5in margins. No browser header/footer, no screenshots. Fonts come from Google Fonts
when the network allows; otherwise Chromium falls back to Arial.
"""
import asyncio, json, os, re, sys, glob

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
PAGE = os.path.join(REPO, 'canopy_quote_calculator.html')


def load_state(path):
    d = json.load(open(path, encoding='utf-8'))
    if isinstance(d, dict) and 'body' in d and isinstance(d['body'], dict):
        d = d['body']                      # filer wrapper
    if isinstance(d, dict) and 'state' in d and isinstance(d['state'], dict):
        return d['state'], d                # service response
    if isinstance(d, dict) and 'items' in d and 'hdr' in d:
        return d, None                      # bare Quote Builder State
    raise SystemExit(f'{path}: not a service response or Quote Builder State')


def safe_name(s):
    s = re.sub(r'[\\/:*?"<>|]+', '-', s).strip().rstrip('.')
    return s or 'Quote'


async def main():
    args = sys.argv[1:]
    outdir, name, files = 'out', None, []
    i = 0
    while i < len(args):
        if args[i] == '-o': outdir = args[i+1]; i += 2
        elif args[i] == '--name': name = args[i+1]; i += 2
        else: files.append(args[i]); i += 1
    if not files:
        print(__doc__); sys.exit(1)
    os.makedirs(outdir, exist_ok=True)

    from playwright.async_api import async_playwright
    exe = (glob.glob('/opt/pw-browsers/chromium-*/chrome-linux/chrome') or [None])[0]
    async with async_playwright() as p:
        b = await (p.chromium.launch(executable_path=exe) if exe else p.chromium.launch())
        pg = await b.new_page(viewport={'width': 900, 'height': 1200})
        # never let a dialog freeze the run
        await pg.add_init_script("window.alert=function(){};window.confirm=function(){return true};window.prompt=function(){return null};")
        pg.on('dialog', lambda d: asyncio.ensure_future(d.dismiss()))
        await pg.goto('file://' + PAGE, wait_until='load')
        await pg.wait_for_timeout(400)

        for f in files:
            state, resp = load_state(f)
            ok = await pg.evaluate("""(st) => {
                try { restoreQuoteState(st); } catch(e) { return 'restore failed: ' + e; }
                try { renderQuote(); } catch(e) {}
                const r = populateFormalQuoteDoc();
                if (!r) return 'populateFormalQuoteDoc returned false (no line items?)';
                document.querySelector('.app').style.display = 'none';
                const el = document.getElementById('print-quote-doc');
                el.style.display = 'block';
                document.body.style.background = '#fff';
                return 'ok';
            }""", state)
            if ok != 'ok':
                print(f'{f}: {ok}'); continue
            await pg.wait_for_timeout(250)
            job = name or (state.get('hdr', {}) or {}).get('hdr-projname') or (state.get('hdr', {}) or {}).get('hdr-shipname') or os.path.splitext(os.path.basename(f))[0]
            job = safe_name(job)
            # fit to one page: measure and scale down if needed (Letter minus 0.5in margins = 10in ≈ 960px)
            h = await pg.evaluate("document.querySelector('.pq-page').getBoundingClientRect().height")
            sc = max(min(1.0, 940.0 / h), 0.6)
            pdf = os.path.join(outdir, f'{job}_Quote.pdf')
            await pg.emulate_media(media='print')
            await pg.pdf(path=pdf, format='Letter', scale=sc, print_background=True,
                         display_header_footer=False,
                         margin={'top': '0.5in', 'bottom': '0.5in', 'left': '0.5in', 'right': '0.5in'})
            await pg.emulate_media(media='screen')
            png = os.path.join(outdir, f'{job}_Quote.png')
            await pg.screenshot(path=png, full_page=True)
            total = (resp or {}).get('totals', {}).get('total') if resp else None
            print(f'{job}: page {round(h)}px scale {sc:.2f} -> {pdf}' + (f'  total ${total:,.0f}' if total else ''))
            # reset for the next quote
            await pg.evaluate("document.querySelector('.app').style.display=''; document.getElementById('print-quote-doc').style.display='none';")
        await b.close()

asyncio.run(main())
