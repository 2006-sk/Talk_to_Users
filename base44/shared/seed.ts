// Idempotent demo seeding helpers shared by seedDemo and runDemo.
import { arr } from "./b44.ts";
import { DEMO_COMPANY, DEMO_VENDORS, DEMO_HISTORY } from "./demo.ts";
import { normDomain } from "./core.ts";

export async function ensureDemoCompany(db: any) {
  let c = arr(await db.Company.filter({ key: "demo" }, "-created_date", 1))[0];
  if (!c) c = await db.Company.create(DEMO_COMPANY);
  const vendors = arr(await db.Vendor.filter({ company_id: "demo" }, "-created_date", 200));
  for (const v of DEMO_VENDORS) {
    const have = vendors.find((x: any) => x.name === v.name);
    if (!have) await db.Vendor.create({ ...v, company_id: "demo", first_seen_at: "2025-01-15T00:00:00Z", status: "active", changes: [] });
    else await db.Vendor.update(have.id, { known_bank_last4: v.known_bank_last4, open_pos: v.open_pos, avg_amount: v.avg_amount, status: "active", changes: [] });
  }
  return c;
}

/** Wipe demo bills and everything hanging off them; keep company, vendors and cache. */
export async function resetDemo(db: any) {
  for (const E of ["AgentRun", "Evidence", "VerifyCall", "Payment", "AuditLog", "Invoice"]) {
    for (let k = 0; k < 20; k++) {
      const rows = arr(await db[E].filter({ company_id: "demo" }, "-created_date", 200));
      if (!rows.length) break;
      await Promise.all(rows.map((r: any) => db[E].delete(r.id).catch(() => null)));
    }
  }
  const vendors = arr(await db.Vendor.filter({ company_id: "demo" }, "-created_date", 200));
  const known = new Set(DEMO_VENDORS.map((v) => v.name));
  for (const v of vendors) if (!known.has(v.name)) await db.Vendor.delete(v.id).catch(() => null);
  // history (already-paid bills) so the ledger has something to compare against
  const vs = arr(await db.Vendor.filter({ company_id: "demo" }, "-created_date", 200));
  for (const h of DEMO_HISTORY) {
    const v = vs.find((x: any) => x.name === h.vendor);
    const inv = await db.Invoice.create({ company_id: "demo", vendor_id: v?.id, source: "demo", vendor_name_on_invoice: h.vendor, sender_domain: v?.official_domain, sender_email: `billing@${v?.official_domain}`, invoice_number: h.invoice_number, invoice_date: h.invoice_date, amount: h.amount, currency: "USD", po_number: h.po_number, bank_account_last4: v?.known_bank_last4, status: "approved", decision: "approve", decision_reason: "Paid last month (history)", trust_score: 90, web_confidence: "high", risk_level: "low", seq: 0, issues: [] });
    await db.Payment.create({ company_id: "demo", invoice_id: inv.id, amount: h.amount, status: "released" });
  }
}

export const senderDomain = (e?: string | null) => normDomain(e);
