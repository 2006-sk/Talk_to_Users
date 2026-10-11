# Collect async snapshots from the smoke test + retry walmart (needs domain) and contact page (render).
import json, os, sys, time, urllib.request
KEY = os.environ["BRIGHTDATA_API_KEY"]; OUT = os.path.join(os.path.dirname(__file__), "brightdata")
def req(method, path, body=None, timeout=120):
    r = urllib.request.Request("https://api.brightdata.com" + path, data=json.dumps(body).encode() if body else None,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as x: return x.status, x.read().decode(), dict(x.headers)
    except urllib.error.HTTPError as e: return e.code, e.read().decode(), {}
    except Exception as e: return 0, str(e), {}
snaps = {n: json.load(open(f"{OUT}/{n}.json"))["snapshot_id"] for n in ["crunchbase", "trustpilot", "indeed_company"]}
t0 = time.time()
while snaps and time.time() - t0 < 600:
    for n, sid in list(snaps.items()):
        s, t, _ = req("GET", f"/datasets/v3/progress/{sid}")
        st = json.loads(t).get("status") if s == 200 else f"http{s}"
        if st == "ready":
            s, t, _ = req("GET", f"/datasets/v3/snapshot/{sid}?format=json")
            open(f"{OUT}/{n}.json", "w").write(t); print(n, "ready", round(time.time()-t0), "s", len(t), t[:200].replace("\n"," "), flush=True); snaps.pop(n)
        elif st == "failed": print(n, "FAILED", t[:200], flush=True); snaps.pop(n)
    time.sleep(10)
print("still pending:", snaps)
s, t, _ = req("POST", "/datasets/v3/scrape?dataset_id=gd_l95fol7l1ru6rlo116&format=json&include_errors=true&type=discover_new&discover_by=keyword", {"input": [{"keyword": "copy paper 8.5 x 11 case", "domain": "https://www.walmart.com"}]})
open(f"{OUT}/walmart_search.json", "w").write(t); print("walmart", s, len(t), t[:200].replace("\n"," "))
s, t, h = req("POST", "/request", {"zone": "mcp_unlocker", "url": "https://www.grainger.com/content/general-contact-us", "format": "raw", "data_format": "markdown", "render": "true"})
open(f"{OUT}/unlocker_contact.json", "w").write(t); print("unlocker", s, len(t), h.get("x-brd-err-code"), t[:200].replace("\n"," "))
