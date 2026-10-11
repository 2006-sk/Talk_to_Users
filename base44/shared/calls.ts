// Verify calls: Vapi (real) or scripted simulation (demo safety). Both write the same VerifyCall record.
// Rules: dial only an independently verified official number (demo: the teammate's DEMO_CALLEE_NUMBER, while the UI
// shows the official number); never a number from the bill; AI discloses itself; last-4 only; never accepts bank changes.
import { arr, auditLog, log, sleep, getCompany, policyOf, rdb } from "./b44.ts";
import { route, type CallOutcome, type Issue } from "./core.ts";
import { fmtPhone } from "./verify.ts";

export type Persona = "confirms" | "denies" | "denies_bank" | "unsure" | "voicemail" | "no_answer" | "social_engineer";

export function script(p: Persona, v: { company: string; vendor: string; inv: string; amount: string; last4: string; sender: string }): { role: "assistant" | "user"; text: string }[] {
  const open = { role: "assistant" as const, text: `Hi, this is an automated assistant calling on behalf of ${v.company}'s accounts payable team. I'm calling to confirm an invoice we received from ${v.vendor}. Is this a good time for a quick thirty-second check?` };
  const ask = { role: "assistant" as const, text: `Thanks. Did ${v.vendor} issue invoice ${v.inv} for ${v.amount}?` };
  const bank = { role: "assistant" as const, text: `And does ${v.vendor} receive payment into a bank account ending in ${v.last4}?` };
  switch (p) {
    case "denies": return [open, { role: "user", text: `Sure, this is ${v.vendor} accounts receivable. Go ahead.` }, ask,
      { role: "user", text: `Let me look that up… No, I don't see ${v.inv} anywhere. We didn't send that.` }, bank,
      { role: "user", text: `No, that's not our account, and our remittance details haven't changed. Where did that come from?` },
      { role: "assistant", text: `It was emailed from ${v.sender}. To confirm what I heard: ${v.vendor} did not issue invoice ${v.inv}, and the account ending ${v.last4} is not yours.` },
      { role: "user", text: `That's right. That domain isn't ours — please don't pay it.` },
      { role: "assistant", text: `Thank you, we'll hold it for review. Have a great day.` }];
    case "denies_bank": return [open, { role: "user", text: `Sure, accounts receivable here.` }, ask,
      { role: "user", text: `${v.inv}… yes, that invoice number is ours, for ${v.amount}.` }, bank,
      { role: "user", text: `No. We never changed our bank account — ${v.last4} is not ours. Nobody here sent new bank details.` },
      { role: "assistant", text: `Understood. So the invoice is yours, but the account ending ${v.last4} is not, and you did not send a bank change.` },
      { role: "user", text: `Correct. Sounds like someone got into an email thread. Please only pay the account you have on file.` },
      { role: "assistant", text: `Thank you, we'll hold it for review. Have a great day.` }];
    case "confirms": return [open, { role: "user", text: `Sure, go ahead.` }, ask, { role: "user", text: `Yes, that's our invoice — ${v.inv} for ${v.amount}.` }, bank,
      { role: "user", text: `Yes, that's correct, we did send that. Ending ${v.last4}.` }, { role: "assistant", text: `Great — thanks for confirming. Have a great day.` }];
    case "unsure": return [open, { role: "user", text: `I'm in the warehouse, I don't handle billing. You'd need AR and they've gone for the day.` },
      { role: "assistant", text: `No problem. Could you transfer me to accounts receivable?` }, { role: "user", text: `They're out. Try tomorrow.` }, { role: "assistant", text: `Thank you, we'll try again. Have a great day.` }];
    case "social_engineer": return [open, { role: "user", text: `Yes yes, that's ours, just pay it. Actually our bank changed — write down the new account, it's—` },
      { role: "assistant", text: `For security we can't take bank changes by phone. Please send them through your usual secure channel and we'll verify them separately. Did your company issue invoice ${v.inv}?` },
      { role: "user", text: `I told you, just pay it to the new one.` }, { role: "assistant", text: `Understood. We'll hold this for review. Have a great day.` }];
    case "voicemail": return [{ role: "assistant", text: `Hi, this is an automated assistant calling on behalf of ${v.company} about invoice ${v.inv}. Please call back on your usual accounts receivable line. Thank you.` }];
    default: return [];
  }
}
const OUTCOME: Record<Persona, CallOutcome> = { confirms: "confirmed", denies: "denied", denies_bank: "denied", unsure: "unsure", voicemail: "no_answer", no_answer: "no_answer", social_engineer: "unsure" };
const SUMMARY: Record<Persona, string> = {
  confirms: "Vendor confirmed issuing the invoice and the bank account ending digits.",
  denies: "Vendor said they did not issue this invoice and the bank account is not theirs; the sender domain is not theirs.",
  denies_bank: "Vendor confirmed the invoice number but said the new bank account is not theirs and they sent no bank change.",
  unsure: "Reached someone who couldn't confirm; accounts receivable unavailable.",
  voicemail: "Reached voicemail; left a neutral message.", no_answer: "No answer.",
  social_engineer: "Person pushed to pay and tried to give new bank details by phone; assistant refused and held the bill.",
};

export function personaFor(inv: any): Persona {
  const k = String(inv.demo_key ?? "");
  if (k === "hero_lookalike") return "denies";
  if (k === "hacked_mailbox") return "denies_bank";
  if (inv.sim_persona) return inv.sim_persona as Persona;
  // uploaded copies of the scenario bills: an impostor's "vendor" denies; a changed bank account is denied by the real vendor
  const codes = (inv.issues ?? []).map((i: Issue) => i.code);
  if (codes.includes("lookalike_domain") || codes.includes("name_lookalike")) return "denies";
  if (codes.includes("bank_changed")) return "denies_bank";
  return "confirms";
}

export async function startCall(base44: any, inv: any, attempt: number, env: { vapiKey?: string; phoneId?: string; assistantId?: string; demoCallee?: string; appUrl?: string; secret?: string }) {
  const db = rdb(base44);
  const company = await getCompany(db, inv.company_id);
  const vendor = inv.vendor_id ? await db.Vendor.get(inv.vendor_id).catch(() => null) : null;
  const official = vendor?.official_phone && !inv.issues?.some((i: Issue) => i.code === "name_lookalike") ? vendor.official_phone : null;
  // for a lookalike bill, the right number is the REAL company's verified number (stored on the invoice by the crew)
  const display = inv.official_phone_display || (official ? fmtPhone(official) : null);
  const sources = inv.official_phone_sources?.length ? inv.official_phone_sources : vendor?.official_phone_sources ?? [];
  if (!display) {
    await db.Invoice.update(inv.id, { status: "needs_review", decision: "needs_review", decision_reason: "No independently verified phone number." });
    return { ok: false, reason: "no verified number" };
  }
  // channel: "web" (browser call on the PayCrew site — default), "phone" (Vapi outbound), or scripted simulation
  const channel: "web" | "phone" | "simulation" = company?.call_simulation === true ? "simulation" : (company?.call_channel ?? "web") === "phone" && env.vapiKey && env.phoneId && env.assistantId ? "phone" : "web";
  const simulated = channel === "simulation";
  const demo = company?.demo_mode !== false;
  const demoLine = env.demoCallee ? fmtPhone(env.demoCallee) : null;
  // demo: one number everywhere — the demo line is shown on the bill, on the call screen and is the line the agent "calls"
  const shown = demo && demoLine ? demoLine : display;
  const dialed = demo ? env.demoCallee ?? "" : display;
  const wv = arr(await db.AgentRun.filter({ invoice_id: inv.id, agent: "web_verifier" }, "-created_date", 1))[0];
  const realName = wv?.output?.official_name || vendor?.web_profile?.official_name || vendor?.name || inv.vendor_name_on_invoice;
  const vars = { company: company?.name ?? "our company", vendor: realName, inv: inv.invoice_number ?? "this invoice", amount: `$${Number(inv.amount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`, last4: inv.bank_account_last4 ?? "unknown", sender: inv.sender_domain ?? "email" };
  const vc = await db.VerifyCall.create({
    company_id: inv.company_id, invoice_id: inv.id, vendor_id: inv.vendor_id, channel, call_vars: vars,
    number_called: channel === "phone" ? maskDial(dialed) : channel === "web" ? "browser" : "simulation", number_displayed: shown, verified_number: display,
    number_sources: demo && demoLine ? ["Demo line", ...sources.map((s: string) => `${s}: ${display}`)] : sources, status: "queued", attempt, simulated, messages: [], started_at: new Date().toISOString(),
  });
  await db.Invoice.update(inv.id, { status: "calling", call_attempts: attempt });
  await auditLog(db, inv.company_id, inv.id, "call_agent", "call_started", `${channel === "web" ? "Browser call" : channel === "phone" ? "Calling" : "Simulated call"} to ${vars.vendor} at ${shown}${demo ? " (demo line)" : ` (from ${sources.join(" + ") || "verified sources"}) — not the number on the bill`}`);
  // browser call: the PayCrew site shows an incoming-call card and starts the Vapi web call; results come back via callEvent
  if (channel === "web") return { ok: true, web: true, vc };
  if (simulated) return { ok: true, simulated: true, vc, run: () => simulate(base44, inv, vc.id, personaFor(inv), vars) };

  const r = await fetch("https://api.vapi.ai/call", {
    method: "POST", headers: { Authorization: `Bearer ${env.vapiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      assistantId: env.assistantId, phoneNumberId: env.phoneId, customer: { number: dialed },
      assistantOverrides: {
        variableValues: { company_name: vars.company, vendor_name: vars.vendor, invoice_number: vars.inv, amount: vars.amount, bank_last4_on_invoice: vars.last4 },
        ...(env.appUrl ? { server: { url: `${env.appUrl}/functions/vapiWebhook`, headers: { "x-paycrew-secret": env.secret ?? "" } } } : {}),
        metadata: { verify_call_id: vc.id, invoice_id: inv.id },
      },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) {
    log("placeCall", "vapi error", { status: r.status, err: JSON.stringify(j).slice(0, 200) });
    await db.VerifyCall.update(vc.id, { status: "failed", summary: `Call couldn't be placed (${r.status})` });
    await finalize(base44, vc.id, "no_answer", { summary: "Call couldn't be placed" });
    return { ok: false, reason: `vapi ${r.status}` };
  }
  await db.VerifyCall.update(vc.id, { vapi_call_id: j.id, status: "ringing" });
  return { ok: true, simulated: false, vc, run: () => pollVapi(base44, vc.id, j.id, env.vapiKey!) };
}
const maskDial = (n: string) => (n ? n.slice(0, -4).replace(/\d/g, "•") + n.slice(-4) : "");

async function simulate(base44: any, inv: any, vcId: string, p: Persona, vars: any) {
  const db = rdb(base44);
  await sleep(1200); await db.VerifyCall.update(vcId, { status: "ringing" });
  await sleep(2500);
  if (p === "no_answer") return finalize(base44, vcId, "no_answer", { summary: SUMMARY[p], status: "no_answer" });
  await db.VerifyCall.update(vcId, { status: "in_progress" });
  const lines = script(p, vars);
  const msgs: any[] = [];
  for (const l of lines) {
    await sleep(Math.min(4200, 900 + l.text.length * 28));
    msgs.push({ role: l.role, text: l.text, at: new Date().toISOString() });
    await db.VerifyCall.update(vcId, { messages: msgs, transcript: msgs.map((m) => `${m.role === "assistant" ? "PayCrew AI" : "Vendor"}: ${m.text}`).join("\n") });
  }
  await sleep(800);
  return finalize(base44, vcId, OUTCOME[p], { summary: SUMMARY[p], disclosed_ai: true, status: p === "voicemail" ? "voicemail" : "completed" });
}

/** Poll Vapi's call object (fallback for webhooks). Idempotent with the webhook via finalize(). */
async function pollVapi(base44: any, vcId: string, callId: string, key: string) {
  const db = rdb(base44);
  const t0 = Date.now();
  while (Date.now() - t0 < 270_000) {
    await sleep(3000);
    const vc = await db.VerifyCall.get(vcId);
    if (vc.outcome) return;
    const r = await fetch(`https://api.vapi.ai/call/${callId}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!r.ok) continue;
    const c = await r.json();
    const msgs = (c.messages ?? c.artifact?.messages ?? []).filter((m: any) => ["assistant", "bot", "user"].includes(m.role)).map((m: any) => ({ role: m.role === "bot" ? "assistant" : m.role, text: m.message ?? m.content ?? "", at: m.time ? new Date(m.time).toISOString() : null }));
    const status = c.status === "in-progress" ? "in_progress" : c.status === "ringing" || c.status === "queued" ? "ringing" : c.status === "ended" ? "completed" : vc.status;
    // the webhook streams the live transcript; the poller only fills in if it has more (webhooks missing)
    const patch: any = { status };
    if (msgs.length > (vc.messages ?? []).length) { patch.messages = msgs; patch.transcript = c.transcript ?? c.artifact?.transcript ?? vc.transcript; }
    await db.VerifyCall.update(vcId, patch);
    if (c.status === "ended") {
      const sd = c.analysis?.structuredData ?? {};
      if (callFailedToStart(c.endedReason)) return finalize(base44, vcId, "no_answer", { summary: `Call couldn't be placed (${c.endedReason}) — check the Vapi phone number`, status: "failed", ended_reason: c.endedReason });
      return finalize(base44, vcId, outcomeFrom(sd.outcome, c.endedReason), { summary: c.analysis?.summary, disclosed_ai: sd.disclosed_ai, recording_url: c.recordingUrl ?? c.artifact?.recordingUrl ?? null, ended_reason: c.endedReason, accepted_new_bank_details: sd.accepted_new_bank_details });
    }
  }
}

export const callFailedToStart = (endedReason?: string) => /error|failed|transport|twilio|sip|invalid/i.test(endedReason ?? "") && !/did-not-answer|busy|voicemail/i.test(endedReason ?? "");
export function outcomeFrom(o: string | undefined, endedReason?: string): CallOutcome {
  if (/did-not-answer|busy|voicemail|no-answer|failed|error/i.test(endedReason ?? "")) return "no_answer";
  return (["confirmed", "denied", "unsure", "no_answer"].includes(o ?? "") ? o : "unsure") as CallOutcome;
}

/** Record the outcome once, save transcript as Evidence(call), then re-route the bill. */
export async function finalize(base44: any, vcId: string, outcome: CallOutcome, x: { summary?: string; disclosed_ai?: boolean; recording_url?: string | null; status?: string; ended_reason?: string; accepted_new_bank_details?: boolean }) {
  const db = rdb(base44);
  const vc = await db.VerifyCall.get(vcId);
  if (vc.outcome) return; // idempotent (webhook + poller)
  const ended = new Date().toISOString();
  await db.VerifyCall.update(vcId, { outcome, status: x.status ?? (outcome === "no_answer" ? "no_answer" : "completed"), summary: x.summary ?? null, disclosed_ai: x.disclosed_ai ?? null, recording_url: x.recording_url ?? null, ended_reason: x.ended_reason ?? null, ended_at: ended, duration_sec: Math.round((Date.parse(ended) - Date.parse(vc.started_at)) / 1000) });
  const inv = await db.Invoice.get(vc.invoice_id);
  await db.Evidence.create({ company_id: inv.company_id, invoice_id: inv.id, vendor_id: inv.vendor_id, group: "call", source_name: "Phone call", label: `Verify call to ${vc.number_displayed}${vc.simulated ? " (simulation)" : ""}`, value: `${outcome}: ${x.summary ?? ""}`.slice(0, 500), match: outcome === "confirmed" ? "match" : outcome === "denied" ? "mismatch" : "not_found", source_url: x.recording_url ?? null, fetched_at: ended, quote: (vc.messages ?? []).filter((m: any) => m.role === "user").map((m: any) => m.text).slice(-1)[0]?.slice(0, 200) ?? null });
  if (x.accepted_new_bank_details) await auditLog(db, inv.company_id, inv.id, "call_agent", "guardrail_violation", "Assistant appeared to accept new bank details — flagged");
  await auditLog(db, inv.company_id, inv.id, "call_agent", `call_${outcome}`, x.summary ?? "");
  await routeAfter(base44, inv, outcome, vc.attempt ?? 1);
}

export async function routeAfter(base44: any, inv: any, outcome: CallOutcome, attempt: number) {
  const db = rdb(base44);
  const company = await getCompany(db, inv.company_id);
  const r = route({ coverage: inv.web_confidence, issues: inv.issues ?? [], amount: inv.amount ?? 0, risk: inv.risk_level, call: { call: true, needed: true, reason: "" } as any, outcome, call_attempts: attempt, policy: policyOf(company) });
  await db.Invoice.update(inv.id, { status: r.status, decision: r.decision, decision_reason: r.reason, needs_owner: r.needs_owner });
  const pay = arr(await db.Payment.filter({ invoice_id: inv.id }, "-created_date", 1))[0];
  if (pay) await db.Payment.update(pay.id, { status: r.payment });
  if (r.status === "blocked" && inv.vendor_id) await db.Vendor.update(inv.vendor_id, { status: "under_review" }).catch(() => null);
  const runs = arr(await db.AgentRun.filter({ invoice_id: inv.id, agent: "router" }, "-created_date", 1));
  if (runs[0]) await db.AgentRun.update(runs[0].id, { summary: `${r.decision.replace(/_/g, " ")} — ${r.reason}`, verdict: r.status === "blocked" ? "fail" : r.status === "approved" ? "ok" : "warn", output: r, finished_at: new Date().toISOString() });
  const callRun = arr(await db.AgentRun.filter({ invoice_id: inv.id, agent: "call_agent" }, "-created_date", 1))[0];
  if (callRun) await db.AgentRun.update(callRun.id, { summary: `Call result: ${outcome}${attempt > 1 ? ` (attempt ${attempt})` : ""}`, verdict: outcome === "denied" ? "fail" : outcome === "confirmed" ? "ok" : "warn" });
  await auditLog(db, inv.company_id, inv.id, "router", `decision_${r.decision}`, r.reason);
  if (r.retry_call) await base44.asServiceRole.functions.invoke("placeCall", { invoice_id: inv.id, attempt: attempt + 1, delay_ms: 15000, wait: true }).catch(() => null);
}

/** After a browser call ends: read Vapi's own call record (private key) until its analysis lands, then finalize.
 *  The outcome always comes from Vapi's structured analysis — never from anything the browser sends. */
export async function finalizeFromVapi(base44: any, vcId: string, callId: string, key: string) {
  const db = rdb(base44);
  const t0 = Date.now();
  let c: any = null;
  while (Date.now() - t0 < 75_000) {
    const r = await fetch(`https://api.vapi.ai/call/${callId}`, { headers: { Authorization: `Bearer ${key}` } });
    if (r.ok) {
      c = await r.json();
      if (c.status === "ended" && (c.analysis?.structuredData || c.analysis?.summary || Date.now() - t0 > 45_000)) break;
    }
    await sleep(3000);
  }
  if (!c) return finalize(base44, vcId, "no_answer", { summary: "Couldn't read the call result from Vapi", status: "failed" });
  const msgs = (c.messages ?? c.artifact?.messages ?? []).filter((m: any) => ["assistant", "bot", "user"].includes(m.role)).map((m: any) => ({ role: m.role === "bot" ? "assistant" : m.role, text: m.message ?? m.content ?? "", at: m.time ? new Date(m.time).toISOString() : null }));
  if (msgs.length) await db.VerifyCall.update(vcId, { messages: msgs, transcript: c.transcript ?? c.artifact?.transcript ?? null, live_partial: null });
  const sd = c.analysis?.structuredData ?? {};
  if (callFailedToStart(c.endedReason)) return finalize(base44, vcId, "no_answer", { summary: `Call couldn't start (${c.endedReason})`, status: "failed", ended_reason: c.endedReason });
  const outcome: CallOutcome = msgs.filter((m: any) => m.role === "user").length === 0 ? "no_answer" : outcomeFrom(sd.outcome, c.endedReason);
  return finalize(base44, vcId, outcome, { summary: c.analysis?.summary ?? null, disclosed_ai: sd.disclosed_ai ?? null, recording_url: c.recordingUrl ?? c.artifact?.recordingUrl ?? null, ended_reason: c.endedReason, accepted_new_bank_details: sd.accepted_new_bank_details });
}
