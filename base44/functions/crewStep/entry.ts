// crewStep — run ONE crew agent on a bill: { invoice_id, step }. step ∈ intake | ledger | web_verifier | price_checker |
// identity_matcher | risk_judge | call_agent | router. Prerequisite steps that never ran are run first, automatically.
// Used by the Base44 crew Agents (each agent can run its own step and invoke the others when it needs their results).
// Never approves, pays or places a call: router only sets statuses; calls go through placeCall after a human confirms.
import { createClientFromRequest } from "npm:@base44/sdk";
import { secrets } from "base44:runtime";
import { runStep, STEP_KEYS } from "../../shared/steps.ts";

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const { invoice_id, step } = await req.json();
    if (!invoice_id || !STEP_KEYS.includes(step)) return Response.json({ error: `invoice_id and step (${STEP_KEYS.join(", ")}) required` }, { status: 400 });
    const key = secrets.get("BRIGHTDATA_API_KEY");
    if (!key) return Response.json({ error: "BRIGHTDATA_API_KEY not set" }, { status: 500 });
    const r = await runStep(base44, key, invoice_id, step);
    return Response.json({ ok: true, ...r });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
