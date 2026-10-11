// inbound — POST /functions/inbound for forwarded bills. Header x-paycrew-secret required.
// Body: { company_key, file_url?, text?, sender_email?, subject? } → creates an Invoice (source=email) and starts the crew.
// The email/bill text is stored as DATA and never interpreted as instructions.
import { createClientFromRequest } from "npm:@base44/sdk";
import { secrets } from "base44:runtime";
import { auditLog, getCompany, rdb } from "../../shared/b44.ts";
import { normDomain } from "../../shared/core.ts";

export default async function (req: Request): Promise<Response> {
  try {
    const want = secrets.get("PAYCREW_WEBHOOK_SECRET");
    if (!want || req.headers.get("x-paycrew-secret") !== want) return Response.json({ error: "unauthorized" }, { status: 401 });
    const base44 = createClientFromRequest(req);
    const db = rdb(base44);
    const b = await req.json();
    const company = await getCompany(db, b.company_key ?? "demo");
    if (!company) return Response.json({ error: "unknown company" }, { status: 404 });
    if (!b.file_url && !b.text) return Response.json({ error: "file_url or text required" }, { status: 400 });
    const inv = await db.Invoice.create({ company_id: company.key, source: "email", file_url: b.file_url ?? null, raw_text: b.text ?? null, sender_email: b.sender_email ?? null, sender_domain: normDomain(b.sender_email), status: "received" });
    await auditLog(db, company.key, inv.id, "inbound_api", "bill_received", `From ${b.sender_email ?? "unknown sender"}${b.subject ? ` · ${String(b.subject).slice(0, 80)}` : ""}`);
    const r = await base44.asServiceRole.functions.invoke("runCrew", { invoice_id: inv.id }).catch((e: unknown) => ({ data: { error: String(e) } }));
    return Response.json({ ok: true, invoice_id: inv.id, crew: (r as any)?.data ?? null }, { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
