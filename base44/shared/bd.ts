// Bright Data client — runtime-agnostic (Deno in Base44, Node in local evals).
// Endpoints verified in BRIGHTDATA_RECON.md. Rules: cache every response by (source, query, date); concurrency ≤ 4
// (account limit ~20 req/min); backoff on 429/5xx/empty-body; max 3 retries; count requests per product.

export interface Cache {
  get(key: string): Promise<{ v: unknown; day: string } | undefined>;
  set(key: string, v: unknown, day: string): Promise<void>;
}

export class MemoryCache implements Cache {
  m = new Map<string, { v: unknown; day: string }>();
  async get(k: string) { return this.m.get(k); }
  async set(k: string, v: unknown, day: string) { this.m.set(k, { v, day }); }
}

export interface Usage { [product: string]: { requests: number; ok: number; cache_hits: number } }

/** One line of the Bright Data activity log (shown per source in the UI). */
export interface BdLogEvent {
  source: string;            // what the user sees, e.g. "Amazon scraper", "Trustpilot scraper", "Web search · official site"
  product: string;           // Bright Data product: SERP API, Web Unlocker, Business Search, Web Scraper API
  event: "started" | "cache_hit" | "snapshot" | "polling" | "completed" | "failed" | "timeout" | "retry";
  detail: string;
  ms?: number;
  rows?: number;
  at: string;
}
export const MAX_PARALLEL_SCRAPERS = 2;

const API = "https://api.brightdata.com";
export const SERP_ZONE = "serp_api1";
export const UNLOCKER_ZONE = "mcp_unlocker";
export const DS = {
  crunchbase: "gd_l1vijqt9jfj7olije",
  trustpilot: "gd_lm5zmhwd2sni130p",
  indeed: "gd_l7qekxkv2i7ve6hx1s",
  linkedin: "gd_l1vikfnt1wgvvqz95w",
  mapsPlace: "gd_m8ebnr0q2qlklc02fz",
  amazonSearch: "gd_lwdb4vjm1ehb499uxs",
  walmart: "gd_l95fol7l1ru6rlo116",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const today = () => new Date().toISOString().slice(0, 10);

export class BrightData {
  usage: Usage = {};
  requests = 0;
  private active = 0;
  private queue: (() => void)[] = [];
  /** maxAgeDays: how old a cached response may be and still be reused (demo/evals reuse; 0 = same day only). */
  private key: string;
  private cache: Cache;
  private opts: { concurrency?: number; maxAgeDays?: number; offline?: boolean; onLog?: (e: BdLogEvent) => void };
  private scraperActive = 0;
  private scraperQueue: (() => void)[] = [];
  constructor(key: string, cache: Cache = new MemoryCache(), opts: { concurrency?: number; maxAgeDays?: number; offline?: boolean; onLog?: (e: BdLogEvent) => void } = {}) {
    this.key = key; this.cache = cache; this.opts = opts;
  }
  /** Attach/replace the activity logger (one per bill). */
  setLogger(fn?: (e: BdLogEvent) => void) { this.opts.onLog = fn; }
  private log(source: string, product: string, event: BdLogEvent["event"], detail: string, extra: { ms?: number; rows?: number } = {}) {
    try { this.opts.onLog?.({ source, product, event, detail, at: new Date().toISOString(), ...extra }); } catch { /* logging never breaks a check */ }
  }
  /** Public log line (for steps that resolve from cache without a request). */
  note(source: string, product: string, event: BdLogEvent["event"], detail: string, extra: { ms?: number; rows?: number } = {}) { this.log(source, product, event, detail, extra); }
  /** Web Scraper API jobs: at most MAX_PARALLEL_SCRAPERS at once. */
  private async scraperSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.scraperActive >= MAX_PARALLEL_SCRAPERS) await new Promise<void>((r) => this.scraperQueue.push(r));
    this.scraperActive++;
    try { return await fn(); } finally { this.scraperActive--; this.scraperQueue.shift()?.(); }
  }
  /** Cached value if present (no request). */
  async peek<T>(product: string, query: string): Promise<T | undefined> {
    const hit = await this.cache.get(`${product}|${query}`);
    const maxAge = this.opts.maxAgeDays ?? 0;
    return hit && (Date.now() - Date.parse(hit.day)) / 864e5 <= maxAge + 1 ? (hit.v as T) : undefined;
  }
  async store(product: string, query: string, v: unknown) { await this.cache.set(`${product}|${query}`, v, today()); }

  private curLabel: string | null = null;
  private u(product: string) { return (this.usage[product] ??= { requests: 0, ok: 0, cache_hits: 0 }); }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= (this.opts.concurrency ?? 4)) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try { return await fn(); } finally { this.active--; this.queue.shift()?.(); }
  }

  /** Cached wrapper. key = product|query; reuse within maxAgeDays. Only successful results are cached. */
  async cached<T>(product: string, query: string, fn: () => Promise<{ ok: boolean; value: T }>, label?: string, what?: string): Promise<{ ok: boolean; value: T; cached: boolean; day: string }> {
    const k = `${product}|${query}`;
    const src = label ?? product;
    const kind = PRODUCT_KIND[product] ?? product;
    const hit = await this.cache.get(k);
    const maxAge = this.opts.maxAgeDays ?? 0;
    if (hit && (Date.now() - Date.parse(hit.day)) / 864e5 <= maxAge + 1) {
      this.u(product).cache_hits++;
      this.log(src, kind, "cache_hit", `Reused response from ${hit.day} — ${what ?? short(query)}`, { rows: countRows(hit.v), ms: 0 });
      return { ok: true, value: hit.v as T, cached: true, day: hit.day };
    }
    if (this.opts.offline) return { ok: false, value: null as T, cached: false, day: today() };
    const t0 = Date.now();
    if (kind !== "Web Scraper API") this.log(src, kind, "started", `Request sent — ${what ?? short(query)}`); // scraper jobs log their own submit
    const r = await fn();
    const ms = Date.now() - t0;
    if (r.ok) this.log(src, kind, "completed", `Completed in ${(ms / 1000).toFixed(1)}s`, { ms, rows: countRows(r.value) });
    else this.log(src, kind, (r as any).timeout ? "timeout" : "failed", (r as any).timeout ? `Still running after ${(ms / 1000).toFixed(0)}s — marked pending` : `No usable data after ${(ms / 1000).toFixed(1)}s`, { ms });
    if (r.ok) await this.cache.set(k, r.value, today());
    return { ...r, cached: false, day: today() };
  }

  private async post(product: string, path: string, body: unknown, o: { timeoutMs?: number; okStatus?: number[]; valid?: (t: string) => boolean } = {}) {
    const okStatus = o.okStatus ?? [200];
    let last = { status: 0, text: "" };
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await this.slot(async () => {
        this.u(product).requests++; this.requests++;
        try {
          const r = await fetch(`${API}${path}`, {
            method: "POST", headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
            body: JSON.stringify(body), signal: AbortSignal.timeout(o.timeoutMs ?? 75_000),
          });
          const text = await r.text();
          if (r.headers.get("x-brd-err-code") === "client_10110") return { status: 429, text: "rate_limited" };
          return { status: r.status, text };
        } catch (e) { return { status: 0, text: String(e) }; }
      });
      let st = res.status;
      if (okStatus.includes(st) && o.valid && !o.valid(res.text)) st = 0;
      if (okStatus.includes(st)) { this.u(product).ok++; return res; }
      last = res;
      if (st === 0 || st === 429 || st >= 500) { if (attempt < 3) { this.log(this.curLabel ?? product, PRODUCT_KIND[product] ?? product, "retry", `HTTP ${st || "error"}${st === 429 ? " (rate limited)" : ""} — retry ${attempt + 1}/3 in ${2 ** attempt * 2}s`); await sleep(2 ** attempt * 2000); } continue; }
      break;
    }
    return last;
  }

  private async get(product: string, path: string) {
    this.u(product).requests++; this.requests++;
    try {
      const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${this.key}` }, signal: AbortSignal.timeout(30_000) });
      return { status: r.status, text: await r.text() };
    } catch (e) { return { status: 0, text: String(e) }; }
  }

  /** SERP API (Google, parsed JSON). */
  serp(q: string, extra = "", label = "Web search") {
    return this.cached<any>("SERP API", q + extra, async () => {
      this.curLabel = label;
      const url = `https://www.google.com/search?q=${encodeURIComponent(q)}&gl=us&hl=en&brd_json=1${extra}`;
      const r = await this.post("SERP API", "/request", { zone: SERP_ZONE, url, format: "raw" }, {
        timeoutMs: 45_000, valid: (t) => { try { return Array.isArray(JSON.parse(t).organic) || !!JSON.parse(t).general; } catch { return false; } },
      });
      try { const j = JSON.parse(r.text); return { ok: r.status === 200, value: { organic: j.organic ?? [], knowledge: j.knowledge ?? null, url } }; }
      catch { return { ok: false, value: { organic: [], knowledge: null, url } }; }
    }, label, `Google: “${q}”`);
  }

  /** Web Unlocker → markdown. */
  unlock(url: string, render = false, label = "Company website · contact page") {
    return this.cached<string>("Web Unlocker", url + (render ? "#render" : ""), async () => {
      const body: Record<string, unknown> = { zone: UNLOCKER_ZONE, url, format: "raw", data_format: "markdown" };
      if (render) body.render = "true";
      const r = await this.post("Web Unlocker", "/request", body, { timeoutMs: 60_000, valid: (t) => t.trim().length > 200 });
      return { ok: r.status === 200, value: r.status === 200 ? r.text : "" };
    }, label, url);
  }

  /** Business Search (LinkedIn company index, ~1s). */
  business(q: string, label = "LinkedIn (Business Search)") {
    return this.cached<any[]>("Business Search", q, async () => {
      const r = await this.post("Business Search", "/search/company", { source: "linkedin_company", mode: "instant", query: q, offset: 0, limit: 5, view: "summary" }, { timeoutMs: 20_000 });
      try { return { ok: r.status === 200, value: (JSON.parse(r.text).documents ?? []).map((d: any) => d.data ?? d) }; } catch { return { ok: false, value: [] }; }
    }, label, `company search “${q}”`);
  }

  /** Web Scraper API dataset, sync with snapshot polling up to waitMs. */
  dataset(product: string, datasetId: string, input: unknown[], qs = "", waitMs = 100_000, label = `${product} scraper`) {
    return this.cached<any[]>(product, JSON.stringify(input) + qs, () => this.scraperSlot(async () => {
      const L = (ev: BdLogEvent["event"], d: string, x: { ms?: number; rows?: number } = {}) => this.log(label, "Web Scraper API", ev, d, x);
      L("started", `Job submitted to dataset ${datasetId} (${input.length} input${input.length > 1 ? "s" : ""})`);
      const r = await this.post(product, `/datasets/v3/scrape?dataset_id=${datasetId}&format=json&include_errors=true${qs}`, { input }, { okStatus: [200, 202], timeoutMs: 75_000 });
      if (r.status === 200) {
        try { const j = JSON.parse(r.text); return { ok: Array.isArray(j), value: Array.isArray(j) ? j : [] }; } catch { return { ok: false, value: [] }; }
      }
      if (r.status !== 202) return { ok: false, value: [] };
      let sid = "";
      try { sid = JSON.parse(r.text).snapshot_id; } catch { return { ok: false, value: [] }; }
      L("snapshot", `Running async — snapshot ${sid}`);
      const deadline = Date.now() + waitMs;
      let polls = 0;
      while (Date.now() < deadline) {
        await sleep(5000);
        const p = await this.get(product, `/datasets/v3/progress/${sid}`);
        let st = "running";
        try { st = JSON.parse(p.text).status; } catch { /* keep polling */ }
        if (++polls % 3 === 1 && st !== "ready") L("polling", `Snapshot ${st} (${polls * 5}s)`);
        if (st === "failed") return { ok: false, value: [] };
        if (st === "ready") {
          const s = await this.get(product, `/datasets/v3/snapshot/${sid}?format=json`);
          try { const j = JSON.parse(s.text); if (Array.isArray(j)) { this.u(product).ok++; return { ok: true, value: j }; } } catch { /* ndjson */ }
          const rows = s.text.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
          return { ok: rows.length > 0, value: rows };
        }
      }
      return { ok: false, value: [], timeout: true } as any; // timed out → caller marks the source "pending"
    }), label, `${input.length} input${input.length > 1 ? "s" : ""}`);
  }
}

const PRODUCT_KIND: Record<string, string> = { "SERP API": "SERP API", "Web Unlocker": "Web Unlocker", "Business Search": "Business Search", "archive.org": "archive.org (not Bright Data)", Trustpilot: "Web Scraper API", Crunchbase: "Web Scraper API", Indeed: "Web Scraper API", Amazon: "Web Scraper API", Walmart: "Web Scraper API" };
const short = (q: string) => (q.length > 90 ? q.slice(0, 90) + "…" : q);
function countRows(v: any): number | undefined {
  if (Array.isArray(v)) return v.length;
  if (v && Array.isArray(v.organic)) return v.organic.length;
  if (typeof v === "string") return v.length ? 1 : 0;
  return v ? 1 : 0;
}

// ---------- free public helper (not Bright Data; labelled as such in evidence)
export async function waybackFirstSeen(domain: string): Promise<{ first_seen: string; url: string } | null> {
  try {
    const r = await fetch(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}&limit=1&output=json`, { signal: AbortSignal.timeout(35_000) });
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const ts: string = rows[1][1];
    return { first_seen: `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`, url: `https://web.archive.org/web/${ts}/${rows[1][2]}` };
  } catch { return null; }
}
