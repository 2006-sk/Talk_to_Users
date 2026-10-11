# Pre-warm the Base44 BdCache entity from the local Bright Data cache (cache/bd/*.json). Same trimming as shared/b44.ts slim().
import json, glob, os, sys, urllib.request, time
ENV = dict(l.split("=", 1) for l in open(os.path.join(os.path.dirname(__file__), "..", ".env")).read().split("\n") if "=" in l)
URL = "https://logical-smart-bill-guard.base44.app/functions/maint"
def slim(v, d=0):
    if isinstance(v, str): return v[:300]
    if isinstance(v, list): return [slim(x, d + 1) for x in v[: (25 if d == 0 else 8)]]
    if isinstance(v, dict): return {k: slim(x, d + 1) for k, x in v.items() if not (d >= 3 and isinstance(x, (dict, list)))}
    return v
def call(body):
    r = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "User-Agent": "curl/8.7.1", "x-paycrew-secret": ENV["PAYCREW_WEBHOOK_SECRET"]})
    return json.loads(urllib.request.urlopen(r, timeout=120).read())
if "--purge" in sys.argv: print(call({"action": "purge_vendors"})); sys.exit()
rows = []
for f in glob.glob(os.path.join(os.path.dirname(__file__), "..", "cache", "bd", "*.json")):
    d = json.load(open(f))
    rows.append({"key": d["k"], "day": d["day"], "v": json.dumps(slim(d["v"]))})
print(len(rows), "cache rows")
for i in range(0, len(rows), 1):
    for attempt in range(3):
        try: print(i, call({"action": "import_cache", "rows": rows[i:i + 1]})); break
        except Exception as e: print("retry", e); time.sleep(5)
print(call({"action": "cache_count"}))
