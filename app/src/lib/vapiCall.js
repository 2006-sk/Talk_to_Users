// Browser verify call (Vapi Web SDK). One call at a time; survives page navigation.
// Streams transcript lines to the backend (callEvent) so every screen sees them; the outcome is decided server-side from Vapi's analysis.
import VapiModule from "@vapi-ai/web";

// The SDK ships as CommonJS; depending on the bundler the class arrives as the default export or nested under .default.
const Vapi = typeof VapiModule === "function" ? VapiModule : VapiModule?.default?.default ?? VapiModule?.default;
import { base44 } from "@/api/base44Client";

// Vapi PUBLIC key + assistant id are designed for client-side use (no secrets here).
const VAPI_PUBLIC_KEY = "3ad339c0-9e4c-4a0c-809d-f3248e170e7e";
const VAPI_ASSISTANT_ID = "82b5fc3e-0724-44bb-ae20-d4fc1c3f10a8";

let vapi = null;
let current = null; // { vcId, vapiCallId, muted }
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(state()));
export const state = () => ({ active: !!current, vcId: current?.vcId ?? null, muted: !!current?.muted, connecting: !!current?.connecting, level: current?.level ?? 0, speaking: current?.speaking ?? null });
export const subscribe = (fn) => { listeners.add(fn); fn(state()); return () => listeners.delete(fn); };

const send = (payload) => base44.functions.invoke("callEvent", payload).catch(() => null);

let partialTimer = null, lastPartial = null;
function sendPartial(p) {
  lastPartial = p;
  if (partialTimer) return;
  partialTimer = setTimeout(() => { partialTimer = null; if (lastPartial && current) send({ verify_call_id: current.vcId, type: "transcript", ...lastPartial, final: false }); }, 450);
}

function ensure() {
  if (vapi) return vapi;
  vapi = new Vapi(VAPI_PUBLIC_KEY);
  vapi.on("call-start", () => { if (current) { current.connecting = false; emit(); } });
  vapi.on("speech-start", () => { if (current) { current.speaking = "assistant"; emit(); } });
  vapi.on("speech-end", () => { if (current) { current.speaking = null; emit(); } });
  vapi.on("volume-level", (v) => { if (current) { current.level = v; emit(); } });
  vapi.on("message", (m) => {
    if (!current || m?.type !== "transcript") return;
    const role = m.role === "user" ? "user" : "assistant";
    if (m.transcriptType === "final") { lastPartial = null; send({ verify_call_id: current.vcId, type: "transcript", role, text: m.transcript, final: true }); }
    else sendPartial({ role, text: m.transcript });
  });
  const end = () => {
    if (!current) return;
    const c = current; current = null; emit();
    send({ verify_call_id: c.vcId, type: "ended", vapi_call_id: c.vapiCallId });
  };
  vapi.on("call-end", end);
  vapi.on("error", (e) => { console.error("[BillProof] vapi error", e); end(); });
  return vapi;
}

/** Answer an incoming verify call in the browser (needs a user click for the microphone). */
export async function answer(vc) {
  if (current) return;
  const v = ensure();
  current = { vcId: vc.id, connecting: true, muted: false };
  emit();
  const vars = vc.call_vars ?? {};
  try {
    const call = await v.start(VAPI_ASSISTANT_ID, {
      variableValues: { company_name: vars.company, vendor_name: vars.vendor, invoice_number: vars.inv, amount: vars.amount, bank_last4_on_invoice: vars.last4 },
      metadata: { verify_call_id: vc.id, invoice_id: vc.invoice_id },
    });
    if (!call?.id) throw new Error("Vapi didn't start the call");
    current.vapiCallId = call.id;
    await send({ verify_call_id: vc.id, type: "started", vapi_call_id: call.id });
  } catch (e) {
    console.error("[BillProof] call start failed", e);
    current = null; emit();
    await send({ verify_call_id: vc.id, type: "declined" });
    throw e;
  }
}

export function hangUp() { try { vapi?.stop(); } catch { /* already ended */ } }
export function toggleMute() { if (!current || !vapi) return; current.muted = !current.muted; vapi.setMuted(current.muted); emit(); }
export const decline = (vc) => send({ verify_call_id: vc.id, type: "declined" });
