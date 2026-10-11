// vapiWebhook — public endpoint for Vapi server messages (status-update, transcript, end-of-call-report).
// Auth: shared secret header x-paycrew-secret (Vapi sends no org credential for per-call server URLs).
import { createClientFromRequest } from "npm:@base44/sdk";
import { secrets } from "base44:runtime";
import { finalize, outcomeFrom, callFailedToStart } from "../../shared/calls.ts";
import { arr, log, rdb } from "../../shared/b44.ts";

export default async function (req: Request): Promise<Response> {
  try {
    const want = secrets.get("PAYCREW_WEBHOOK_SECRET");
    if (!want || req.headers.get("x-paycrew-secret") !== want) return Response.json({ error: "unauthorized" }, { status: 401 });
    const base44 = createClientFromRequest(req);
    const db = rdb(base44);
    const { message: m = {} } = await req.json().catch(() => ({}));
    const callId = m.call?.id;
    const vcId = m.call?.assistantOverrides?.metadata?.verify_call_id ?? m.call?.metadata?.verify_call_id;
    const vc = vcId ? await db.VerifyCall.get(vcId).catch(() => null) : arr(await db.VerifyCall.filter({ vapi_call_id: callId }, "-created_date", 1))[0];
    if (!vc) return Response.json({ ok: true, ignored: "unknown call" });
    log("vapiWebhook", m.type, { vc: vc.id });
    if (m.type === "status-update") {
      const st = m.status === "in-progress" ? "in_progress" : m.status === "ringing" || m.status === "queued" ? "ringing" : m.status === "ended" ? "completed" : vc.status;
      await db.VerifyCall.update(vc.id, { status: st });
    } else if (String(m.type).startsWith("transcript")) {
      // live transcript: partials show as a "typing" bubble; finals append to the conversation
      const role = m.role === "user" ? "user" : "assistant";
      const final = m.transcriptType === "final" || String(m.type).includes("final");
      if (!final) await db.VerifyCall.update(vc.id, { live_partial: { role, text: m.transcript, at: new Date().toISOString() } });
      else {
        const msgs = [...(vc.messages ?? [])];
        const last = msgs[msgs.length - 1];
        if (last && last.role === role && !last.final_from_conversation && Date.now() - Date.parse(last.at ?? 0) < 4000) last.text = `${last.text} ${m.transcript}`.trim();
        else msgs.push({ role, text: m.transcript, at: new Date().toISOString() });
        await db.VerifyCall.update(vc.id, { messages: msgs, live_partial: null, status: "in_progress", transcript: msgs.map((x: any) => `${x.role === "assistant" ? "BillProof AI" : "Vendor"}: ${x.text}`).join("\n") });
      }
    } else if (m.type === "conversation-update") {
      // authoritative running conversation from Vapi
      const msgs = (m.messages ?? m.conversation ?? []).filter((x: any) => ["assistant", "bot", "user"].includes(x.role)).map((x: any) => ({ role: x.role === "bot" ? "assistant" : x.role, text: x.message ?? x.content ?? "", at: x.time ? new Date(x.time).toISOString() : new Date().toISOString(), final_from_conversation: true }));
      if (msgs.length >= (vc.messages ?? []).length) await db.VerifyCall.update(vc.id, { messages: msgs, transcript: msgs.map((x: any) => `${x.role === "assistant" ? "BillProof AI" : "Vendor"}: ${x.text}`).join("\n") });
    } else if (m.type === "end-of-call-report") {
      const sd = m.analysis?.structuredData ?? {};
      if (m.artifact?.messages?.length) {
        const msgs = m.artifact.messages.filter((x: any) => ["assistant", "bot", "user"].includes(x.role)).map((x: any) => ({ role: x.role === "bot" ? "assistant" : x.role, text: x.message ?? "", at: null }));
        await db.VerifyCall.update(vc.id, { messages: msgs, transcript: m.artifact.transcript ?? vc.transcript });
      }
      await db.VerifyCall.update(vc.id, { live_partial: null });
      if (callFailedToStart(m.endedReason)) { await finalize(base44, vc.id, "no_answer", { summary: `Call couldn't be placed (${m.endedReason}) — check the Vapi phone number`, status: "failed", ended_reason: m.endedReason }); return Response.json({ ok: true }); }
      await finalize(base44, vc.id, outcomeFrom(sd.outcome, m.endedReason), { summary: m.analysis?.summary, disclosed_ai: sd.disclosed_ai, recording_url: m.artifact?.recording?.url ?? m.recordingUrl ?? null, ended_reason: m.endedReason, accepted_new_bank_details: sd.accepted_new_bank_details });
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
