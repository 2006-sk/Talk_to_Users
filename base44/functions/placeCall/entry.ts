// placeCall — starts a verify call for a bill (Vapi, or scripted simulation when the company's call_simulation is on).
// Input: { invoice_id, attempt?, delay_ms?, wait? } — wait:true keeps the call inside this request (recommended). Guardrail: the number dialed is never taken from the bill.
import { createClientFromRequest } from "npm:@base44/sdk";
import { secrets, waitUntil } from "base44:runtime";
import { startCall } from "../../shared/calls.ts";
import { log, sleep, rdb } from "../../shared/b44.ts";

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    if (!body.invoice_id) return Response.json({ error: "invoice_id required" }, { status: 400 });
    const work = (async () => {
      if (body.delay_ms) await sleep(Math.min(60000, body.delay_ms));
      const inv = await rdb(base44).Invoice.get(body.invoice_id);
      const r = await startCall(base44, inv, body.attempt ?? 1, {
        vapiKey: secrets.get("VAPI_API_KEY"), phoneId: secrets.get("VAPI_PHONE_NUMBER_ID"), assistantId: secrets.get("VAPI_ASSISTANT_ID"),
        demoCallee: secrets.get("DEMO_CALLEE_NUMBER"), appUrl: secrets.get("APP_URL"), secret: secrets.get("PAYCREW_WEBHOOK_SECRET"),
      });
      log("placeCall", "started", { invoice: body.invoice_id, ok: r.ok, simulated: (r as any).simulated ?? null });
      if (r.ok && (r as any).run) await (r as any).run();
    })().catch((e) => log("placeCall", "error", { err: String(e).slice(0, 300) }));
    if (body.wait) { await work; return Response.json({ ok: true }); }
    waitUntil(work);
    return Response.json({ ok: true }, { status: 202 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
