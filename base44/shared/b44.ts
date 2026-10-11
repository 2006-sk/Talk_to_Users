// Base44 bindings for the crew: entity-backed Store, Bright Data cache, usage counters, audit log.
// Deno-only (imported by backend functions). Never logs secrets or full bank numbers.
import { BrightData, type Cache, today } from "./bd.ts";
import { runCrewCore, type AgentKey, type InvoiceIn, type Store, type VendorIn, type CrewResult } from "./crew.ts";
import { band, nameSimilar, splitDomain, normDomain, DEFAULT_POLICY, type Policy, type CallOutcome } from "./core.ts";

export const log = (fn: string, msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ fn, msg, ...extra, at: new Date().toISOString() }));
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const arr = (x: any) => (Array.isArray(x) ? x : x?.items ?? []);

/** Entity access that retries when Base44 rate-limits (many crews writing at once). Same API as base44.asServiceRole.entities. */
const RATE = /rate limit|too many requests|429/i;
export function rdb(base44: any): any {
  const ents = base44.asServiceRole.entities;
  return new Proxy({}, {
    get(_t, name: string) {
      const E = ents[name];
      return new Proxy(E, {
        get(t: any, m: string) {
          const f = t[m];
          if (typeof f !== "function") return f;
          return async (...args: unknown[]) => {
            for (let a = 0; ; a++) {
              try { return await f.apply(t, args); }
              catch (e) {
                if (a < 6 && RATE.test(String((e as any)?.message ?? e))) { await sleep(700 * 2 ** a + Math.random() * 500); continue; }
                throw e;
              }
            }
          };
        },
      });
    },
  });
}

/** Keep cached payloads small: cap arrays and long strings (Trustpilot returns ~500 KB of reviews). */
function slim(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.length > 300 ? v.slice(0, 300) : v;
  if (Array.isArray(v)) return v.slice(0, depth === 0 ? 25 : 8).map((x) => slim(x, depth + 1));
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) { if (depth >= 3 && typeof x === "object") continue; o[k] = slim(x, depth + 1); }
    return o;
  }
  return v;
}

export class EntityCache implements Cache {
  constructor(private db: any) {}
  async get(key: string) {
    const rows = arr(await this.db.BdCache.filter({ key }, "-created_date", 1));
    if (!rows[0]) return undefined;
    try { return { v: JSON.parse(rows[0].v), day: rows[0].day }; } catch { return undefined; }
  }
  async set(key: string, v: unknown, day: string) {
    // entity string fields have a size cap: drop nested objects, shorten text, then drop rows until it fits
    let rows = Array.isArray(v) ? v.length : 0;
    let text = JSON.stringify(slim(v));
    while (text.length > 28_000 && rows > 1) { rows = Math.floor(rows * 0.6); text = JSON.stringify((v as unknown[]).slice(0, rows).map((x) => slim(x, 2))); }
    if (text.length > 28_000) { log("cache", "skip (too large)", { key: key.slice(0, 80), size: text.length }); return; }
    try { await this.db.BdCache.create({ key, day, v: text }); }
    catch (e) { log("cache", "set failed", { key: key.slice(0, 80), size: text.length, err: String(e).slice(0, 100) }); }
  }
}

export function makeBD(db: any, key: string) {
  return new BrightData(key, new EntityCache(db), { concurrency: 4, maxAgeDays: 30 });
}

export async function flushUsage(db: any, bd: BrightData) {
  const day = today();
  for (const [product, u] of Object.entries(bd.usage)) {
    if (!u.requests && !u.cache_hits) continue;
    const row = arr(await db.BrightDataUsage.filter({ day, product }, "-created_date", 1))[0];
    if (row) await db.BrightDataUsage.update(row.id, { requests: (row.requests ?? 0) + u.requests, ok: (row.ok ?? 0) + u.ok, cache_hits: (row.cache_hits ?? 0) + u.cache_hits });
    else await db.BrightDataUsage.create({ day, product, requests: u.requests, ok: u.ok, cache_hits: u.cache_hits });
  }
}

export async function auditLog(db: any, company_id: string, invoice_id: string | null, actor: string, action: string, detail = "") {
  try { await db.AuditLog.create({ company_id, invoice_id, actor, action, detail }); } catch { /* never block the crew on audit */ }
}

export async function getCompany(db: any, key: string) {
  const c = arr(await db.Company.filter({ key }, "-created_date", 1))[0];
  return c ?? null;
}
export function policyOf(c: any): Policy {
  return { approval_threshold: Number(c?.approval_threshold ?? DEFAULT_POLICY.approval_threshold), always_call_on_bank_change: c?.always_call_on_bank_change !== false };
}

export async function findVendor(db: any, company_id: string, inv: any) {
  if (inv.vendor_id) { try { return await db.Vendor.get(inv.vendor_id); } catch { /* fall through */ } }
  const vs = arr(await db.Vendor.filter({ company_id }, "-created_date", 500));
  const sd = splitDomain(normDomain(inv.sender_domain || inv.sender_email)).base;
  // a sender-domain match only counts when it is exactly the vendor's own domain (never a lookalike)
  return vs.find((v: any) => sd && v.official_domain && splitDomain(v.official_domain).base === sd)
    ?? vs.find((v: any) => nameSimilar(v.name, inv.vendor_name_on_invoice)) ?? null;
}

const PACE: Record<AgentKey, number> = { intake: 1100, ledger: 700, web_verifier: 900, price_checker: 600, identity_matcher: 1000, risk_judge: 1100, call_agent: 600, router: 700 };

export function entityStore(base44: any, inv: any, vendor: any, opts: { pace?: boolean } = {}): Store {
  const db = rdb(base44);
  const base = { company_id: inv.company_id, invoice_id: inv.id };
  let logBuf: any[] = [], logTimer: any = null;
  const flushLogs = async () => {
    clearTimeout(logTimer); logTimer = null;
    const batch = logBuf; logBuf = [];
    if (batch.length) await db.BdLog.bulkCreate(batch).catch((e: unknown) => log("bdlog", "write failed", { n: batch.length, err: String(e).slice(0, 80) }));
  };
  return {
    async startRun(agent, summary) {
      const r = await db.AgentRun.create({ ...base, agent, status: "running", started_at: new Date().toISOString(), summary: summary ?? "" });
      return r.id;
    },
    async endRun(id, p) {
      const output = p.output == null ? null : Array.isArray(p.output) || typeof p.output !== "object" ? { items: p.output } : p.output;
      await db.AgentRun.update(id, { status: p.status ?? "done", verdict: p.verdict ?? "ok", summary: p.summary, output, confidence: p.confidence ?? null, model_used: p.model_used ?? null, finished_at: new Date().toISOString() });
    },
    async addEvidence(e) {
      const r = await db.Evidence.create({ ...base, vendor_id: vendor?.id ?? null, group: e.group, source_name: e.source_name, label: e.label, value: e.value == null ? null : String(e.value), expected_value: e.expected_value ?? null, match: e.match, source_url: e.source_url ?? null, fetched_at: e.fetched_at ?? new Date().toISOString(), quote: e.quote ?? null, flag: e.flag ?? null, product: (e as any).product ?? null });
      return r.id;
    },
    async history() {
      return arr(await db.Invoice.filter({ company_id: inv.company_id }, "-created_date", 300)).filter((x: any) => x.id !== inv.id && x.status !== "rejected" && (!inv.created_date || !x.created_date || x.created_date < inv.created_date)).map((x: any) => ({ ...x, vendor_name: x.vendor_name_on_invoice, created_at: x.created_date }));
    },
    async patchInvoice(p) {
      const allowed = ["vendor_name_on_invoice", "sender_email", "sender_domain", "invoice_number", "invoice_date", "due_date", "amount", "currency", "po_number", "bank_name", "bank_account_last4", "bank_changed", "remit_address", "phone_on_invoice", "line_items", "raw_text", "vendor_city", "vendor_state", "status"];
      const clean = Object.fromEntries(Object.entries(p).filter(([k, v]) => allowed.includes(k) && v !== undefined));
      await db.Invoice.update(inv.id, clean);
    },
    async llm(prompt, schema, file_urls) {
      const args: any = { prompt, response_json_schema: schema };
      if (file_urls?.filter(Boolean).length) args.file_urls = file_urls.filter(Boolean);
      return await base44.asServiceRole.integrations.Core.InvokeLLM(args);
    },
    pace: opts.pace ? async (a) => { await sleep(PACE[a]); } : undefined,
    bdLog(e) { logBuf.push({ ...base, ...e }); if (!logTimer) logTimer = setTimeout(flushLogs, 1500); }, // batched: one write per ~1.5s
    flushLogs: () => flushLogs(),
    async resolveVendor(i) {
      const v = await findVendor(db, inv.company_id, i);
      return v ? { id: v.id, name: v.name, official_domain: v.official_domain, alternate_domains: v.alternate_domains ?? [], known_bank_last4: v.known_bank_last4, open_pos: v.open_pos ?? [], avg_amount: v.avg_amount, official_phone: v.official_phone, official_phone_sources: v.official_phone_sources } : null;
    },
  };
}

/** Run the crew for one invoice and persist every result. Returns the crew result. */
export async function runAndPersist(base44: any, bdKey: string, invoiceId: string, o: { pace?: boolean; call_outcome?: CallOutcome | null; call_attempts?: number } = {}): Promise<CrewResult> {
  const db = rdb(base44);
  const inv = await db.Invoice.get(invoiceId);
  const company = await getCompany(db, inv.company_id);
  const policy = policyOf(company);
  let vendor = await findVendor(db, inv.company_id, inv);
  // re-runs start clean so the trace isn't doubled
  for (const r of arr(await db.AgentRun.filter({ invoice_id: invoiceId }, "-created_date", 100))) await db.AgentRun.delete(r.id);
  for (const r of arr(await db.Evidence.filter({ invoice_id: invoiceId }, "-created_date", 300))) if (r.group !== "call") await db.Evidence.delete(r.id);
  await db.Invoice.update(invoiceId, { status: "running", decision: null, decision_reason: null, issues: [], trust_score: null, web_confidence: null, risk_level: null, explanation: null, lookalike: null });
  await auditLog(db, inv.company_id, invoiceId, "crew", "crew_started", `Checking ${inv.vendor_name_on_invoice ?? "bill"} ${inv.amount ? "$" + inv.amount : ""}`);

  const bd = makeBD(db, bdKey);
  const vIn: VendorIn | null = vendor ? { id: vendor.id, name: vendor.name, official_domain: vendor.official_domain, alternate_domains: vendor.alternate_domains ?? [], known_bank_last4: vendor.known_bank_last4, open_pos: vendor.open_pos ?? [], avg_amount: vendor.avg_amount, official_phone: vendor.official_phone, official_phone_sources: vendor.official_phone_sources } : null;
  const store = entityStore(base44, inv, vendor, { pace: o.pace });
  const res = await runCrewCore(inv as InvoiceIn, vIn, bd, store, { policy, call_outcome: o.call_outcome, call_attempts: o.call_attempts });
  await flushUsage(db, bd);
  await (store as any).flushLogs?.();

  // the crew may have matched the vendor only after reading the bill (uploads)
  if (!vendor && res.vendor_id) vendor = await db.Vendor.get(res.vendor_id).catch(() => null);
  if (!vendor) vendor = await findVendor(db, inv.company_id, res.invoice);
  const v = res.verify;
  const j = res.judgement;
  const nowIso = new Date().toISOString();
  const vendorPatch: any = {
    trust_score: j.trust_score, coverage: j.coverage, band: band(j), last_verified_at: nowIso,
    web_profile: { status: v?.status ?? {}, official_name: v?.official_name ?? null, domain_confidence: v?.domain_confidence ?? null, group_scores: j.group_scores },
  };
  if (v?.official_domain && !res.issues.some((i) => i.code === "name_lookalike")) vendorPatch.official_domain = v.official_domain;
  if (v?.official_phone && !v.name_lookalike) { vendorPatch.official_phone = v.official_phone.e164; vendorPatch.official_phone_sources = v.official_phone.sources; }
  if (vendor) {
    if (res.invoice.bank_account_last4 && vendor.known_bank_last4 && res.invoice.bank_account_last4 !== vendor.known_bank_last4) vendorPatch.changes = [...(vendor.changes ?? []), { at: nowIso, field: "bank_account_last4", from: `•••• ${vendor.known_bank_last4}`, to: `•••• ${res.invoice.bank_account_last4}`, invoice_id: invoiceId }];
    await db.Vendor.update(vendor.id, vendorPatch);
  } else {
    vendor = await db.Vendor.create({ company_id: inv.company_id, name: res.invoice.vendor_name_on_invoice ?? "Unknown vendor", first_seen_at: nowIso, status: "under_review", city: res.invoice.vendor_city, state: res.invoice.vendor_state, ...vendorPatch });
  }
  if (res.route.status === "blocked") await db.Vendor.update(vendor.id, { status: "under_review" });

  const lk = v?.lookalike?.verdict === "lookalike" ? { sender_base: v.lookalike.sender_base, official_base: v.lookalike.official_base, kind: v.lookalike.kind, diff_positions: v.lookalike.diff_positions ?? [] } : null;
  await db.Invoice.update(invoiceId, {
    vendor_id: vendor.id, status: res.route.status, decision: res.route.decision, decision_reason: res.route.reason, issues: res.issues, trust_score: j.trust_score,
    web_confidence: j.coverage, risk_level: res.risk, explanation: res.explanation, lookalike: lk, needs_owner: res.route.needs_owner, crew_ms: res.ms,
    official_phone_display: res.official_phone_display, official_phone_sources: res.call.needed && (res.call as any).sources ? (res.call as any).sources : (v?.official_phone?.sources ?? []), bank_changed: !!(res.invoice as any).bank_changed,
  });
  const pay = arr(await db.Payment.filter({ invoice_id: invoiceId }, "-created_date", 1))[0];
  if (pay) await db.Payment.update(pay.id, { status: res.route.payment, amount: res.invoice.amount });
  else await db.Payment.create({ company_id: inv.company_id, invoice_id: invoiceId, amount: res.invoice.amount, status: res.route.payment });
  await auditLog(db, inv.company_id, invoiceId, "router", `decision_${res.route.decision}`, `${res.route.reason} · trust ${j.trust_score} · web ${j.coverage} · ${(res.ms / 1000).toFixed(1)}s`);
  return res;
}
