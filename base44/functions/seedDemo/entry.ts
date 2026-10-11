// seedDemo — creates the demo company, vendor master and history (idempotent). Input: { reset?: boolean }
import { createClientFromRequest } from "npm:@base44/sdk";
import { ensureDemoCompany, resetDemo } from "../../shared/seed.ts";
import { rdb } from "../../shared/b44.ts";

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const db = rdb(base44);
    const body = await req.json().catch(() => ({}));
    const c = await ensureDemoCompany(db);
    if (body.reset) await resetDemo(db);
    return Response.json({ ok: true, company: c.key });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
