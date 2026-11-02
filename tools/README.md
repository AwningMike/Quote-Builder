# tools/

`build_quote_pdf.py` — builds the clean one-page quote PDF from a quote-service response
(or a saved Quote Builder State) by loading `canopy_quote_calculator.html` headlessly and
printing its own formal estimate. Replaces the old loose APMG_Quote_Kit.

    pip install playwright && python -m playwright install chromium   # once
    python3 tools/build_quote_pdf.py response.json -o out --name "Job Name"

Writes `out/<Job>_Quote.pdf` and `out/<Job>_Quote.png` (preview). Accepts the service's
`{ok,state,totals,...}` body, the plan filer's `{status,ok,body}` wrapper, or a bare state.
