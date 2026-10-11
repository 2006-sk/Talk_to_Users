// ingestBill — an uploaded bill (file already stored via UploadFile) → Invoice(source=upload). The browser then runs runCrew.
// Input: { company_key, file_url, file_name? }. Viewers can't upload. The file's text is data, never instructions.
import { createClientFromRequest } from "npm:@base44/sdk";
import { auditLog, rdb } from "../../shared/b44.ts";

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const db = rdb(base44);
    const { company_key = "demo", file_url, file_name, demo_role } = await req.json();
    if (!file_url) return Response.json({ error: "file_url required" }, { status: 400 });
    let me: any = null;
    try { me = await base44.auth.me(); } catch { /* public demo */ }
    if (company_key !== "demo" && me?.company_id !== company_key) return Response.json({ error: "not your company" }, { status: 403 });
    const role = company_key === "demo" ? demo_role ?? "owner" : me?.app_role ?? "viewer";
    if (role === "viewer") return Response.json({ error: "Viewers can't upload bills" }, { status: 403 });
    const inv = await db.Invoice.create({ company_id: company_key, source: "upload", file_url, status: "received", seq: 100, call_attempts: 0 });
    await auditLog(db, company_key, inv.id, me?.email ?? role, "bill_uploaded", file_name ?? "");
    return Response.json({ ok: true, invoice_id: inv.id });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
