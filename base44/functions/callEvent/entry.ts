// callEvent — the browser reports a web verify call's progress: { verify_call_id, type: started|transcript|ended|declined, vapi_call_id?, role?, text?, final? }.
// Transcript lines stream into VerifyCall so every screen sees them live. The OUTCOME is never taken from the browser:
// on "ended" the backend reads Vapi's own call record and structured analysis with the private key.
import { createClientFromRequest } from "npm:@base44/sdk";
import { secrets } from "base44:runtime";
import { finalize, finalizeFromVapi } from "../../shared/calls.ts";
import { auditLog, rdb } from "../../shared/b44.ts";

const line = (m: any) => `${m.role === "assistant" ? "PayCrew AI" : "Vendor"}: ${m.text}`;

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const db = rdb(base44);
    const b = await req.json();
    const vc = b.verify_call_id ? await db.VerifyCall.get(b.verify_call_id).catch(() => null) : null;
    if (!vc || vc.channel !== "web") return Response.json({ error: "unknown web call" }, { status: 404 });
    if (vc.outcome) return Response.json({ ok: true, done: true });

    if (b.type === "started") {
      if (!b.vapi_call_id) return Response.json({ error: "vapi_call_id required" }, { status: 400 });
      await db.VerifyCall.update(vc.id, { status: "in_progress", vapi_call_id: String(b.vapi_call_id), started_at: new Date().toISOString() });
      await auditLog(db, vc.company_id, vc.invoice_id, "call_agent", "browser_call_connected", `Vapi web call ${String(b.vapi_call_id).slice(0, 8)}…`);
    } else if (b.type === "transcript") {
      const role = b.role === "user" ? "user" : "assistant";
      const text = String(b.text ?? "").slice(0, 1000);
      if (!b.final) await db.VerifyCall.update(vc.id, { live_partial: { role, text, at: new Date().toISOString() } });
      else {
        const msgs = [...(vc.messages ?? [])];
        const last = msgs[msgs.length - 1];
        if (last && last.role === role && Date.now() - Date.parse(last.at ?? 0) < 3500) last.text = `${last.text} ${text}`.trim(), last.at = new Date().toISOString();
        else msgs.push({ role, text, at: new Date().toISOString() });
        await db.VerifyCall.update(vc.id, { messages: msgs, live_partial: null, transcript: msgs.map(line).join("\n") });
      }
    } else if (b.type === "ended") {
      await db.VerifyCall.update(vc.id, { status: "completed", live_partial: null });
      const key = secrets.get("VAPI_API_KEY");
      const id = vc.vapi_call_id || b.vapi_call_id;
      if (!key || !id) await finalize(base44, vc.id, "no_answer", { summary: "Call ended before it connected", status: "no_answer" });
      else await finalizeFromVapi(base44, vc.id, id, key);
    } else if (b.type === "declined") {
      await finalize(base44, vc.id, "no_answer", { summary: "Not answered in the browser", status: "no_answer" });
    } else return Response.json({ error: "unknown type" }, { status: 400 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
