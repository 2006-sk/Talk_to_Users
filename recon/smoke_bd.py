# Phase 0 smoke test: one real company (Grainger) per Bright Data source. Raw JSON saved to recon/brightdata/.
import json, os, sys, time, urllib.request, concurrent.futures as cf
KEY = os.environ["BRIGHTDATA_API_KEY"]
OUT = os.path.join(os.path.dirname(__file__), "brightdata")
def post(path, body, timeout=120):
    req = urllib.request.Request("https://api.brightdata.com" + path, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}, method="POST")
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode(), round(time.time() - t, 1), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), round(time.time() - t, 1), {}
    except Exception as e:
        return 0, str(e), round(time.time() - t, 1), {}
def ds(id_, inp, qs=""):
    return post(f"/datasets/v3/scrape?dataset_id={id_}&format=json&include_errors=true{qs}", {"input": inp})
TESTS = {
    "crunchbase": lambda: ds("gd_l1vijqt9jfj7olije", [{"url": "https://www.crunchbase.com/organization/grainger"}]),
    "trustpilot": lambda: ds("gd_lm5zmhwd2sni130p", [{"url": "https://www.trustpilot.com/review/grainger.com"}]),
    "indeed_company": lambda: ds("gd_l7qekxkv2i7ve6hx1s", [{"url": "https://www.indeed.com/cmp/Grainger"}]),
    "linkedin_company": lambda: ds("gd_l1vikfnt1wgvvqz95w", [{"url": "https://www.linkedin.com/company/grainger"}]),
    "amazon_search": lambda: ds("gd_lwdb4vjm1ehb499uxs", [{"keyword": "copy paper 8.5 x 11 case", "url": "https://www.amazon.com", "pages_to_search": 1}]),
    "walmart_search": lambda: ds("gd_l95fol7l1ru6rlo116", [{"keyword": "copy paper 8.5 x 11 case"}], "&type=discover_new&discover_by=keyword"),
    "serp_official": lambda: post("/request", {"zone": "serp_api1", "url": "https://www.google.com/search?q=Grainger+industrial+supply+official+site&gl=us&hl=en&brd_json=1", "format": "raw"}),
    "unlocker_contact": lambda: post("/request", {"zone": "mcp_unlocker", "url": "https://www.grainger.com/content/general-contact-us", "format": "raw", "data_format": "markdown"}),
    "business_search": lambda: post("/search/company", {"source": "linkedin_company", "mode": "instant", "query": "Grainger Lake Forest", "offset": 0, "limit": 3, "view": "summary"}),
}
which = sys.argv[1:] or list(TESTS)
def run(name):
    s, text, secs, h = TESTS[name]()
    open(os.path.join(OUT, f"{name}.json"), "w").write(text)
    return name, s, secs, len(text), h.get("x-brd-err-code", ""), text[:160].replace("\n", " ")
with cf.ThreadPoolExecutor(4) as ex:
    for r in ex.map(run, which):
        print(*r, sep=" | ", flush=True)
