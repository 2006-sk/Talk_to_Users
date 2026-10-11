// updateSettings — owner-only company settings. Input: { company_key, patch, demo_role? }
import { createClientFromRequest } from "npm:@base44/sdk";
import { auditLog, getCompany, rdb } from "../../shared/b44.ts";

const ALLOWED = ["name", "approval_threshold", "always_call_on_bank_change", "notification_email", "demo_mode", "call_simulation", "call_channel"];
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const db = rdb(base44);
    const { company_key, patch = {}, demo_role } = await req.json();
    let me: any = null;
    try { me = await base44.auth.me(); } catch { /* public demo */ }
    const role = company_key === "demo" ? demo_role ?? "owner" : me?.company_id === company_key ? me?.app_role : null;
    if (role !== "owner") return Response.json({ error: "Only the owner can change settings" }, { status: 403 });
    const c = await getCompany(db, company_key);
    if (!c) return Response.json({ error: "unknown company" }, { status: 404 });
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => ALLOWED.includes(k)));
    const updated = await db.Company.update(c.id, clean);
    await auditLog(db, company_key, null, me?.email ?? "owner (demo)", "settings_changed", JSON.stringify(clean));
    return Response.json({ ok: true, company: updated ?? { ...c, ...clean } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
