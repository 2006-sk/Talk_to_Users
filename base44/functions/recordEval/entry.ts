// recordEval — writes EvalRun + EvalCase rows produced by the eval runner (eval/run_eval.ts). Header x-paycrew-secret required.
// Body: { run: {suite, started_at, finished_at, metrics, headline, passed, confusion, report_url}, cases: [{case_id, input, expected, actual, pass, notes}] }
import { createClientFromRequest } from "npm:@base44/sdk";
import { secrets } from "base44:runtime";

export default async function (req: Request): Promise<Response> {
  try {
    const want = secrets.get("PAYCREW_WEBHOOK_SECRET");
    if (!want || req.headers.get("x-paycrew-secret") !== want) return Response.json({ error: "unauthorized" }, { status: 401 });
    const db = createClientFromRequest(req).asServiceRole.entities;
    const { run, cases = [] } = await req.json();
    const r = await db.EvalRun.create(run);
    for (let i = 0; i < cases.length; i += 50) await db.EvalCase.bulkCreate(cases.slice(i, i + 50).map((c: any) => ({ ...c, run_id: r.id, suite: run.suite })));
    return Response.json({ ok: true, run_id: r.id, cases: cases.length });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
