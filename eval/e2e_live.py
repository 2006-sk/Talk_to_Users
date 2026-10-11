# Live end-to-end test against the deployed backend (no frontend involved).
# Upload path: PDF URL → ingestBill → runCrew (InvokeLLM extraction from the PDF, Bright Data, scoring, router, call decision)
import json, sys, time, urllib.request, concurrent.futures as cf
F = "https://logical-smart-bill-guard.base44.app/functions"
PDF = "https://preview-sandbox--6acac653bce3f69086b7ffca.base44.app/sample-invoices/"
CASES = [
  ("1-CLEAN-Staples-should-approve.pdf", {"status": "approved", "call": False}),
  ("2-PRICE-Uline-3.5x-market-needs-review.pdf", {"status": "needs_review", "call": False, "issue": "price"}),
  ("3-BANK-CHANGED-Grainger-calls-then-blocks.pdf", {"status": "calling", "call": True, "issue": "bank_changed"}),
  ("4-IMPOSTOR-Grainqer-FICTIONAL-calls-then-blocks.pdf", {"status": "calling", "call": True, "issue": "lookalike_domain"}),
]
import os
ENV = dict(l.split("=", 1) for l in open(os.path.join(os.path.dirname(__file__), "..", ".env")).read().split("\n") if "=" in l)
def call(fn, body, timeout=320):
    r = urllib.request.Request(f"{F}/{fn}", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "User-Agent": "curl/8.7.1", "x-paycrew-secret": ENV["PAYCREW_WEBHOOK_SECRET"]})
    try:
        with urllib.request.urlopen(r, timeout=timeout) as x: return json.loads(x.read())
    except urllib.error.HTTPError as e: return {"http": e.code, "body": e.read().decode()[:300]}
    except Exception as e: return {"error": str(e)}
print("seed isolated test company:", call("maint", {"action": "seed_test", "call_channel": "web"}))
def one(case):
    pdf, exp = case
    t = time.time()
    ing = call("maint", {"action": "ingest", "company_key": "e2etest", "file_url": PDF + pdf})
    if "invoice_id" not in ing: return pdf, exp, {"ingest_failed": ing}, 0
    r = call("runCrew", {"invoice_id": ing["invoice_id"], "pace": False})
    return pdf, exp, {"invoice_id": ing["invoice_id"], **r}, round(time.time() - t, 1)
with cf.ThreadPoolExecutor(2) as ex:
    out = list(ex.map(one, CASES))
for pdf, exp, r, secs in out:
    print(f"{pdf}: {secs}s → {json.dumps(r)[:240]}")
json.dump([{"pdf": p, "expected": e, "result": r, "secs": s} for p, e, r, s in out], open("eval/results/e2e_live.json", "w"), indent=1)
