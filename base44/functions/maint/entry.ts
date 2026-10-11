// maint — operator-only maintenance (header x-paycrew-secret). Actions:
//   { action: "purge_vendors" }               delete vendor rows with no company_id (schema-migration leftovers) and re-seed demo vendors
//   { action: "import_cache", rows: [{key, day, v}] }  pre-warm the Bright Data cache from the eval runner's cache (demo speed)
//   { action: "cache_count" }
import { createClientFromRequest } from "npm:@base44/sdk";
import { secrets } from "base44:runtime";
import { arr } from "../../shared/b44.ts";
import { ensureDemoCompany } from "../../shared/seed.ts";
import { DEMO_COMPANY, DEMO_VENDORS } from "../../shared/demo.ts";

export default async function (req: Request): Promise<Response> {
  try {
    const want = secrets.get("PAYCREW_WEBHOOK_SECRET");
    if (!want || req.headers.get("x-paycrew-secret") !== want) return Response.json({ error: "unauthorized" }, { status: 401 });
    const db = createClientFromRequest(req).asServiceRole.entities;
    const b = await req.json();
    if (b.action === "purge_vendors") {
      let n = 0;
      for (const v of arr(await db.Vendor.list("-created_date", 500))) if (!v.company_id || (v.company_id === "demo" && !v.official_domain && !v.trust_score)) { await db.Vendor.delete(v.id); n++; }
      await ensureDemoCompany(db);
      return Response.json({ ok: true, deleted: n, vendors: arr(await db.Vendor.filter({ company_id: "demo" }, "-created_date", 100)).length });
    }
    if (b.action === "import_cache") {
      let n = 0;
      for (const r of b.rows ?? []) {
        const have = arr(await db.BdCache.filter({ key: r.key }, "-created_date", 1))[0];
        if (have) continue;
        await db.BdCache.create({ key: r.key, day: r.day, v: typeof r.v === "string" ? r.v : JSON.stringify(r.v) });
        n++;
      }
      return Response.json({ ok: true, imported: n });
    }
    if (b.action === "seed_test") {
      // isolated test company (never touches the public demo): same vendor master as the demo, bills wiped
      const key = "e2etest";
      if (!arr(await db.Company.filter({ key }, "-created_date", 1))[0]) await db.Company.create({ ...DEMO_COMPANY, key, name: "E2E test company (hidden)" });
      for (const E of ["AgentRun", "Evidence", "VerifyCall", "Payment", "AuditLog", "BdLog", "Invoice"]) for (const r of arr(await db[E].filter({ company_id: key }, "-created_date", 300))) await db[E].delete(r.id).catch(() => null);
      const have = arr(await db.Vendor.filter({ company_id: key }, "-created_date", 200));
      for (const v of have) await db.Vendor.delete(v.id).catch(() => null);
      for (const v of DEMO_VENDORS) await db.Vendor.create({ ...v, company_id: key, first_seen_at: "2025-01-15T00:00:00Z", status: "active", changes: [] });
      if (b.call_channel) { const c = arr(await db.Company.filter({ key }, "-created_date", 1))[0]; await db.Company.update(c.id, { call_channel: b.call_channel, call_simulation: !!b.call_simulation }); }
      return Response.json({ ok: true, company: key });
    }
    if (b.action === "ingest") {
      const inv = await db.Invoice.create({ company_id: b.company_key ?? "e2etest", source: "upload", file_url: b.file_url, status: "received", seq: 100, call_attempts: 0 });
      return Response.json({ ok: true, invoice_id: inv.id });
    }
    if (b.action === "cache_count") return Response.json({ ok: true, rows: arr(await db.BdCache.list("-created_date", 5000)).length });
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
