// runDemo — resets the demo company and creates the 10 seeded bills. Returns their ids; the caller runs runCrew on each.
// Input: { only?: string[] (demo keys) }
import { createClientFromRequest } from "npm:@base44/sdk";
import { DEMO_BILLS, DEMO_LINE } from "../../shared/demo.ts";
import { ensureDemoCompany, resetDemo, senderDomain } from "../../shared/seed.ts";
import { auditLog, rdb } from "../../shared/b44.ts";

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const db = rdb(base44);
    const body = await req.json().catch(() => ({}));
    await ensureDemoCompany(db);
    await resetDemo(db);
    const bills = DEMO_BILLS.filter((b) => !body.only?.length || body.only.includes(b.key));
    const created: { id: string; seq: number; key: string }[] = [];
    for (const b of bills) {
      const inv = await db.Invoice.create({ company_id: "demo", source: "demo", demo_key: b.key, seq: b.seq, sim_persona: b.persona ?? null, status: "received", ...b.bill, phone_on_invoice: DEMO_LINE, sender_domain: senderDomain(b.bill.sender_email), call_attempts: 0 }); // demo: every bill carries the demo line
      await auditLog(db, "demo", inv.id, "demo", "bill_received", `${b.bill.vendor_name_on_invoice} · $${b.bill.amount}`);
      created.push({ id: inv.id, seq: b.seq, key: b.key });
    }
    // the caller (browser or script) runs runCrew per bill, staggered — each crew runs inside its own request
    return Response.json({ ok: true, bills: created });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
