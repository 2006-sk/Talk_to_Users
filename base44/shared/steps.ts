// Single-step crew runs for the Base44 crew Agents. Each step reads what earlier steps stored (AgentRun output + Evidence),
// and if a prerequisite step hasn't run yet it is run first ("invoke the other agent if required").
import { arr, auditLog, findVendor, getCompany, makeBD, flushUsage, policyOf, entityStore, rdb } from "./b44.ts";
import { makeCtx, OWNED_ISSUES, stepIntake, stepLedger, stepWeb, stepPrice, stepIdentity, stepRiskJudge, stepCall, stepRouter, type AgentKey, type Ctx } from "./crew.ts";
import { band, type Ev } from "./core.ts";

export const STEP_KEYS: AgentKey[] = ["intake", "ledger", "web_verifier", "price_checker", "identity_matcher", "risk_judge", "call_agent", "router"];
export const DEPS: Record<AgentKey, AgentKey[]> = {
  intake: [], ledger: ["intake"], web_verifier: ["intake"], price_checker: ["intake"], identity_matcher: ["web_verifier"],
  risk_judge: ["ledger", "web_verifier", "price_checker", "identity_matcher"], call_agent: ["risk_judge"], router: ["call_agent"],
};
const FN: Record<AgentKey, (c: Ctx) => Promise<void>> = {
  intake: stepIntake, ledger: stepLedger, web_verifier: stepWeb, price_checker: stepPrice, identity_matcher: stepIdentity,
  risk_judge: stepRiskJudge, call_agent: stepCall, router: stepRouter,
};
const WEB_GROUPS = ["existence", "age", "reputation", "activity", "risk_news"];
// which stored Evidence rows a step wrote (so a re-run replaces them instead of doubling them)
const OWNS_EVIDENCE: Partial<Record<AgentKey, (e: any) => boolean>> = {
  intake: (e) => e.source_name === "Intake" || e.label === "Bank account on file vs bill",
  ledger: (e) => e.source_name === "Internal ledger" && e.label !== "Bank account on file vs bill",
  web_verifier: (e) => WEB_GROUPS.includes(e.group),
  price_checker: (e) => e.group === "price",
  identity_matcher: (e) => e.group === "identity",
};

const toEv = (e: any): Ev => ({ id: e.id, group: e.group, source_name: e.source_name, label: e.label, value: e.value, expected_value: e.expected_value, match: e.match, source_url: e.source_url, fetched_at: e.fetched_at, quote: e.quote, flag: e.flag ?? null });

export async function runStep(base44: any, bdKey: string, invoiceId: string, step: AgentKey, trail: AgentKey[] = []): Promise<{ step: AgentKey; ran: AgentKey[]; summary: string; status: string; issues: any[] }> {
  const db = rdb(base44);
  if (!STEP_KEYS.includes(step)) throw new Error(`unknown step ${step}`);
  // prerequisites first — only the ones that never finished for this bill
  let runs = arr(await db.AgentRun.filter({ invoice_id: invoiceId }, "-created_date", 100));
  for (const dep of DEPS[step]) {
    if (!runs.some((r: any) => r.agent === dep && ["done", "skipped"].includes(r.status))) { await runStep(base44, bdKey, invoiceId, dep, trail); runs = arr(await db.AgentRun.filter({ invoice_id: invoiceId }, "-created_date", 100)); }
  }

  const inv = await db.Invoice.get(invoiceId);
  const company = await getCompany(db, inv.company_id);
  const vendor = await findVendor(db, inv.company_id, inv);
  const bd = makeBD(db, bdKey);
  const vIn = vendor ? { id: vendor.id, name: vendor.name, official_domain: vendor.official_domain, alternate_domains: vendor.alternate_domains ?? [], known_bank_last4: vendor.known_bank_last4, open_pos: vendor.open_pos ?? [], avg_amount: vendor.avg_amount, official_phone: vendor.official_phone, official_phone_sources: vendor.official_phone_sources } : null;

  // replace this step's previous trace and evidence
  for (const r of runs.filter((r: any) => r.agent === step)) await db.AgentRun.delete(r.id);
  const evidence = arr(await db.Evidence.filter({ invoice_id: invoiceId }, "-created_date", 300));
  const owns = OWNS_EVIDENCE[step];
  if (owns) for (const e of evidence.filter(owns)) await db.Evidence.delete(e.id);

  const c = makeCtx(inv, vIn, bd, entityStore(base44, inv, vendor), policyOf(company), {});
  c.issues = (inv.issues ?? []).filter((i: any) => !(OWNED_ISSUES[step] ?? []).includes(i.code));

  // rebuild what later steps need from what earlier steps stored
  if (["identity_matcher", "risk_judge", "call_agent", "router"].includes(step)) {
    const o = runs.find((r: any) => r.agent === "web_verifier")?.output ?? {};
    const kept = evidence.filter((e: any) => !(owns && owns(e)));
    c.verify = {
      official_domain: o.official_domain ?? null, official_name: o.official_name ?? null, domain_confidence: o.domain_confidence ?? "none",
      evidence: [...kept.filter((e: any) => WEB_GROUPS.includes(e.group)).map(toEv), ...(o.identity_evidence ?? [])],
      phones: [], official_phone: o.official_phone ?? null, lookalike: o.lookalike ?? null, name_lookalike: !!o.name_lookalike, ms: 0, requests: 0, status: o.status ?? {},
    };
  }
  if (["call_agent", "router"].includes(step)) {
    c.judgement = runs.find((r: any) => r.agent === "risk_judge")?.output;
    c.risk = inv.risk_level;
  }
  if (step === "router") c.call = runs.find((r: any) => r.agent === "call_agent")?.output ?? { call: false, needed: false, reason: "Call rule not triggered" };

  await FN[step](c);
  await flushUsage(db, bd);
  await (c.store as any).flushLogs?.();

  // persist the step's results on the bill
  const patch: Record<string, unknown> = { issues: c.issues };
  if (step === "intake") patch.status = inv.status; // a single-step run must not leave the bill marked "running"
  if (step === "risk_judge" && c.judgement) Object.assign(patch, { trust_score: c.judgement.trust_score, web_confidence: c.judgement.coverage, risk_level: c.risk, explanation: c.explanation });
  if (step === "router" && c.route) Object.assign(patch, { status: c.route.status, decision: c.route.decision, decision_reason: c.route.reason, needs_owner: c.route.needs_owner });
  if (step === "identity_matcher" && c.verify?.lookalike?.verdict === "lookalike") { const l = c.verify.lookalike; patch.lookalike = { sender_base: l.sender_base, official_base: l.official_base, kind: l.kind, diff_positions: l.diff_positions ?? [] }; }
  await db.Invoice.update(invoiceId, patch);
  if (step === "router" && c.route) {
    const pay = arr(await db.Payment.filter({ invoice_id: invoiceId }, "-created_date", 1))[0];
    if (pay) await db.Payment.update(pay.id, { status: c.route.payment }); else await db.Payment.create({ company_id: inv.company_id, invoice_id: invoiceId, amount: inv.amount, status: c.route.payment });
  }
  if (step === "web_verifier" && vendor && c.verify) await db.Vendor.update(vendor.id, { last_verified_at: new Date().toISOString() });
  const latest = arr(await db.AgentRun.filter({ invoice_id: invoiceId, agent: step }, "-created_date", 1))[0];
  await auditLog(db, inv.company_id, invoiceId, `${step} agent`, "step_run", latest?.summary ?? "");
  trail.push(step);
  return { step, ran: [...trail], summary: latest?.summary ?? "", status: latest?.status ?? "done", issues: c.issues };
}

export { band };
