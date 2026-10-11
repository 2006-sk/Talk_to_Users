// Incoming verify call — appears on every page when the crew decides to call. Answer in the browser (microphone) as the vendor.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, PhoneOff, Mic, MicOff, Loader2 } from "lucide-react";
import { useLive, C } from "@/lib/pc";
import { usePC } from "@/components/pc/Shell";
import { answer, decline, hangUp, toggleMute, subscribe } from "@/lib/vapiCall";
import { toast } from "sonner";

export function useCallState() {
  const [s, setS] = useState({ active: false });
  useEffect(() => subscribe(setS), []);
  return s;
}

export function IncomingCall() {
  const { companyKey } = usePC();
  const nav = useNavigate();
  const call = useCallState();
  const { rows } = useLive("VerifyCall", { company_id: companyKey, status: "queued", channel: "web" }, "-created_date", 3, 1500);
  const ringing = (rows ?? []).find((r) => !r.outcome);
  const [busy, setBusy] = useState(false);

  const onAnswer = async () => {
    setBusy(true);
    nav(`/bill/${ringing.invoice_id}/call`);
    try { await answer(ringing); } catch (e) { toast.error(`Couldn't start the call: ${e?.message ?? e}. Allow microphone access and try again.`); }
    finally { setBusy(false); }
  };

  return (
    <AnimatePresence>
      {call.active ? (
        <motion.div key="live" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="fixed top-[84px] right-6 z-50 raised px-4 py-3 flex items-center gap-3 shadow-2xl" style={{ boxShadow: `0 0 0 1px ${C.calling}88, 0 0 40px ${C.calling}33` }}>
          <span className="h-2.5 w-2.5 rounded-full bg-[#EF4444] pc-pulse" />
          <span className="text-sm font-semibold">{call.connecting ? "Connecting…" : "Verify call live"}</span>
          <button onClick={toggleMute} className="p-2 rounded-lg bg-[#1E2A38] hover:bg-[#263445]" title={call.muted ? "Unmute" : "Mute"}>{call.muted ? <MicOff className="h-4 w-4 text-[#F59E0B]" /> : <Mic className="h-4 w-4" />}</button>
          <button onClick={hangUp} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white bg-[#EF4444] hover:bg-[#DC2626]"><PhoneOff className="h-4 w-4" />Hang up</button>
        </motion.div>
      ) : ringing ? (
        <motion.div key={ringing.id} initial={{ opacity: 0, y: -16, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.25 }}
          className="fixed top-[84px] right-6 z-50 w-[380px] rounded-2xl p-5 bg-[#131B26]" style={{ boxShadow: `0 0 0 1px ${C.calling}99, 0 20px 60px rgba(0,0,0,.6), 0 0 60px ${C.calling}33` }}>
          <div className="flex items-center gap-3">
            <motion.div className="h-12 w-12 rounded-full flex items-center justify-center" style={{ background: `${C.calling}26` }} animate={{ scale: [1, 1.12, 1] }} transition={{ duration: 1.2, repeat: Infinity }}>
              <Phone className="h-6 w-6" style={{ color: C.calling }} />
            </motion.div>
            <div className="min-w-0">
              <div className="label" style={{ color: C.calling }}>Incoming verify call</div>
              <div className="font-bold text-lg truncate">BillProof → {ringing.call_vars?.vendor ?? "vendor"}</div>
              <div className="mono text-sm text-[#8B98A9]">{ringing.number_displayed}</div>
            </div>
          </div>
          <div className="text-sm text-[#C9D4E0] mt-3">Answer as the vendor's accounts-receivable team. The AI will ask about invoice <span className="mono">{ringing.call_vars?.inv}</span> ({ringing.call_vars?.amount}) and the account ending <span className="mono">{ringing.call_vars?.last4}</span>.</div>
          <div className="flex gap-2 mt-4">
            <button onClick={onAnswer} disabled={busy} className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 font-bold text-[#070A0F] bg-[#10B981] hover:bg-[#34D399] disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}Answer as vendor
            </button>
            <button onClick={() => decline(ringing)} className="flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-semibold text-[#EF4444] bg-[#EF4444]/10 ring-1 ring-[#EF4444]/40"><PhoneOff className="h-4 w-4" /></button>
          </div>
          <div className="text-[11px] text-[#8B98A9] mt-3">Browser call via Vapi — uses your microphone. Not answering counts as “no answer” (one retry, then a human decides).</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
