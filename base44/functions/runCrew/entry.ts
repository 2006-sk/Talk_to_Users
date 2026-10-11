// runCrew — runs the 8-agent crew on one bill: intake → (ledger ‖ web verifier ‖ price) → identity → risk judge → call → router.
// Input: { invoice_id, pace?: boolean, async?: boolean }. Runs inside the request (background work is cut off after the response);
// when the call rule fires it also runs the verify call before returning. async:true = fire-and-forget (best effort).
import { createClientFromRequest } from "npm:@base44/sdk";
import { secrets, waitUntil } from "base44:runtime";
import { runAndPersist, log, rdb } from "../../shared/b44.ts";

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const invoiceId = body.invoice_id ?? body.data?.id ?? body.event?.entity_id;
    if (!invoiceId) return Response.json({ error: "invoice_id required" }, { status: 400 });
    const key = secrets.get("BRIGHTDATA_API_KEY");
    if (!key) return Response.json({ error: "BRIGHTDATA_API_KEY not set" }, { status: 500 });
    const work = (async () => {
      try {
        const res = await runAndPersist(base44, key, invoiceId, { pace: !!body.pace });
        log("runCrew", "done", { invoiceId, status: res.route.status, ms: res.ms, call: res.call.call });
        if (res.call.call) await base44.asServiceRole.functions.invoke("placeCall", { invoice_id: invoiceId, attempt: 1, wait: true }).catch((e: unknown) => log("runCrew", "placeCall failed", { err: String(e).slice(0, 200) }));
        return res;
      } catch (e) {
        log("runCrew", "error", { invoiceId, err: String(e).slice(0, 300) });
        await rdb(base44).Invoice.update(invoiceId, { status: "needs_review", decision: "needs_review", decision_reason: `The crew hit an error — check manually (${String(e).slice(0, 140)})` });
      }
    })();
    if (body.async) { waitUntil(work); return Response.json({ ok: true, started: invoiceId }, { status: 202 }); }
    const r = await work;
    return Response.json({ ok: true, status: r?.route.status, decision: r?.route.decision, call: r?.call.call ?? false, ms: r?.ms });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
