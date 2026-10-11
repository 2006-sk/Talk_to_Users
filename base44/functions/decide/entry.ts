// decide — human decisions with role checks. BillProof never pays: "approve" only marks the bill ready for a human to pay in their bank.
// Input: { invoice_id, action: approve|hold|block|reject|release|request_call, reason?, demo_role? }
// Roles: owner (everything) · bookkeeper (hold, request_call, approve ≤ threshold & not high risk; can't release a block) · viewer (nothing).
import { createClientFromRequest } from "npm:@base44/sdk";
import { arr, auditLog, getCompany, policyOf, rdb } from "../../shared/b44.ts";

const PAY: Record<string, string> = { approve: "ready_for_human", release: "ready_for_human", hold: "on_hold", block: "on_hold", reject: "cancelled", request_call: "on_hold" };
const STATUS: Record<string, string> = { approve: "approved", release: "approved", hold: "needs_review", block: "blocked", reject: "rejected", request_call: "needs_call" };

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const db = rdb(base44);
    const { invoice_id, action, reason, demo_role } = await req.json();
    if (!PAY[action]) return Response.json({ error: "unknown action" }, { status: 400 });
    const inv = await db.Invoice.get(invoice_id);
    let me: any = null;
    try { me = await base44.auth.me(); } catch { /* anonymous viewer of the public demo */ }
    // demo company: role comes from the in-app role switcher; real companies: from the user's record
    const isDemo = inv.company_id === "demo";
    if (!isDemo && me?.company_id !== inv.company_id) return Response.json({ error: "not your company" }, { status: 403 });
    const role = isDemo ? (demo_role ?? "owner") : me?.app_role ?? "viewer";
    const company = await getCompany(db, inv.company_id);
    const policy = policyOf(company);
    const highRisk = ["high", "critical"].includes(inv.risk_level) || inv.status === "blocked" || inv.needs_owner || (inv.amount ?? 0) > policy.approval_threshold;
    if (role === "viewer") return Response.json({ error: "Viewers can't make decisions" }, { status: 403 });
    if (role === "bookkeeper") {
      if (action === "release" || (inv.status === "blocked" && action === "approve")) return Response.json({ error: "Only the owner can release a blocked bill" }, { status: 403 });
      if (action === "approve" && highRisk) return Response.json({ error: "Owner approval required (above threshold or high risk)" }, { status: 403 });
    }
    const actor = `${role}${me?.email ? ` (${me.email})` : isDemo ? " (demo)" : ""}`;
    await db.Invoice.update(invoice_id, { status: STATUS[action], decision: action, decision_reason: reason || `${action} by ${role}`, decided_by: actor, decided_at: new Date().toISOString() });
    const pay = arr(await db.Payment.filter({ invoice_id }, "-created_date", 1))[0];
    if (pay) await db.Payment.update(pay.id, { status: PAY[action] });
    else await db.Payment.create({ company_id: inv.company_id, invoice_id, amount: inv.amount, status: PAY[action] });
    await auditLog(db, inv.company_id, invoice_id, actor, `human_${action}`, reason ?? "");
    return Response.json({ ok: true, status: STATUS[action], payment: PAY[action], next_attempt: (inv.call_attempts ?? 0) + 1 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
