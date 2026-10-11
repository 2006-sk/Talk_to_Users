// Verify Call (/bill/:id/call) — the wow moment: number + sources, live waveform, streaming transcript, outcome card.
import { useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Phone, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, HelpCircle, PhoneOff, Bot, FlaskConical } from "lucide-react";
import { useLive, useOne, money, C } from "@/lib/pc";
import { Waveform, TranscriptBubble, Pill, Empty, fade } from "@/components/pc/ui";
import { useCallState } from "@/components/pc/IncomingCall";
import { answer, hangUp, toggleMute } from "@/lib/vapiCall";
import { Mic, MicOff, Monitor } from "lucide-react";
import { toast } from "sonner";

const STEPS = [
  { k: "queued", label: "Dialing" },
  { k: "ringing", label: "Ringing" },
  { k: "in_progress", label: "Connected" },
  { k: "completed", label: "Ended" },
];
const OUT = {
  confirmed: { icon: CheckCircle2, color: C.safe, title: "Confirmed", sub: "Vendor confirmed the bill — review the transcript before paying" },
  denied: { icon: XCircle, color: C.block, title: "Vendor denied", sub: "High risk — blocked for review" },
  unsure: { icon: HelpCircle, color: C.review, title: "Unsure", sub: "Holding the bill; one retry, then a human decides" },
  no_answer: { icon: PhoneOff, color: C.muted, title: "No answer", sub: "Holding the bill; one retry, then a human decides" },
};

export default function VerifyCallPage() {
  const { id } = useParams();
  const { row: inv } = useOne("Invoice", id);
  const { rows: calls } = useLive("VerifyCall", { invoice_id: id }, "-created_date", 5, 700);
  const call = calls?.[0];
  const me = useCallState();
  const mine = me.active && me.vcId === call?.id;
  const endRef = useRef(null);
  const scroller = useRef(null);
  // keep the newest line in view as the transcript streams in (partials included)
  useEffect(() => { const el = scroller.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); }, [call?.messages?.length, call?.live_partial?.text]);

  const stepIdx = !call ? -1 : call.outcome || ["completed", "no_answer", "voicemail", "failed"].includes(call.status) ? 3 : call.status === "in_progress" ? 2 : call.status === "ringing" ? 1 : 0;
  const live = call && !call.outcome && call.status === "in_progress";
  const out = call?.outcome ? OUT[call.outcome] : null;
  const vendor = inv?.issues?.some((i) => i.code === "name_lookalike") ? inv?.issues?.find((i) => i.code === "name_lookalike")?.label.match(/"(.+)"/)?.[1] : inv?.vendor_name_on_invoice;

  return (
    <div className="max-w-[1500px] mx-auto space-y-5">
      <div className="flex items-center gap-4">
        <Link to={`/bill/${id}`} className="raised p-2 hover:border-[#22D3EE]/50"><ArrowLeft className="h-4 w-4" /></Link>
        <h1 className="text-2xl font-extrabold">Verify call</h1>
        {call?.simulated && <Pill color={C.review}><FlaskConical className="h-3 w-3" />Simulation — pre-recorded vendor</Pill>}
        {call?.channel === "web" && <Pill color={C.calling}><Monitor className="h-3 w-3" />Browser call · Vapi</Pill>}
      </div>

      {!call ? <div className="panel"><Empty icon={Phone} title="No call for this bill" hint="Calls are placed only when an issue is found and web confidence is low, or when bank details change." /></div> : (
        <div className="grid grid-cols-1 lg:grid-cols-[440px_minmax(0,1fr)] gap-6 items-start">
          <div className="space-y-4">
            <motion.div {...fade} className="panel p-6" style={{ boxShadow: live ? `0 0 0 1px ${C.calling}66, 0 0 60px ${C.calling}22` : undefined }}>
              <div className="label">Calling</div>
              <div className="text-3xl font-extrabold mt-1">{vendor}</div>
              <div className="text-sm text-[#8B98A9]">about {inv?.invoice_number} · {money(inv?.amount)}</div>
              <div className="mono text-4xl font-bold mt-5 tracking-wide" style={{ color: C.calling }}>{call.number_displayed}</div>
              <div className="flex flex-wrap gap-2 mt-3">
                {(call.number_sources ?? []).map((s) => <Pill key={s} color={C.safe}><ShieldCheck className="h-3 w-3" />{s} ✓</Pill>)}
              </div>
              {call.channel === "web" && call.status === "queued" && !call.outcome && (
                <button onClick={async () => { try { await answer(call); } catch (e) { toast.error(`Couldn't start the call: ${e?.message ?? e}`); } }}
                  className="mt-5 w-full flex items-center justify-center gap-2 rounded-xl py-3 text-lg font-bold text-[#070A0F] bg-[#10B981] hover:bg-[#34D399] shadow-[0_0_30px_rgba(16,185,129,.35)]">
                  <Mic className="h-5 w-5" />Answer as vendor
                </button>
              )}
              {mine && (
                <div className="mt-5 flex gap-2">
                  <button onClick={toggleMute} className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 font-semibold raised">{me.muted ? <><MicOff className="h-4 w-4 text-[#F59E0B]" />Unmute</> : <><Mic className="h-4 w-4" />Mute</>}</button>
                  <button onClick={hangUp} className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 font-bold text-white bg-[#EF4444] hover:bg-[#DC2626]"><PhoneOff className="h-4 w-4" />Hang up</button>
                </div>
              )}
              {call.verified_number && call.verified_number !== call.number_displayed && <div className="mt-3 text-xs text-[#8B98A9]">Vendor's verified number from official sources: <span className="mono text-[#E6EDF3]">{call.verified_number}</span></div>}
              {inv?.phone_on_invoice && call.number_displayed?.replace(/\D/g, "").slice(-10) !== inv.phone_on_invoice.replace(/\D/g, "").slice(-10) && <div className="mt-4 flex items-center gap-2 text-sm rounded-lg px-3 py-2" style={{ color: C.review, background: `${C.review}14`, boxShadow: `inset 0 0 0 1px ${C.review}44` }}>
                <AlertTriangle className="h-4 w-4" />Not the number on the bill <span className="mono line-through opacity-70 ml-1">{inv.phone_on_invoice}</span>
              </div>}
              <div className="flex items-center gap-1 mt-6">
                {STEPS.map((s, i) => (
                  <div key={s.k} className="flex-1">
                    <motion.div className="h-1.5 rounded-full" animate={{ background: i <= stepIdx ? (i === stepIdx && !call.outcome ? C.calling : C.safe) : C.border }} />
                    <div className={`text-[11px] mt-1.5 ${i === stepIdx ? "text-white font-semibold" : "text-[#8B98A9]"}`}>{s.label}</div>
                  </div>
                ))}
              </div>
              <Waveform active={live || mine || call.status === "ringing"} color={call.status === "ringing" ? C.running : C.calling} />
            </motion.div>

            <AnimatePresence>{out && (
              <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }} className="panel p-6" style={{ boxShadow: `inset 0 0 0 1px ${out.color}66, 0 0 50px ${out.color}22` }}>
                <div className="flex items-center gap-3"><out.icon className="h-10 w-10" style={{ color: out.color }} /><div><div className="text-2xl font-extrabold" style={{ color: out.color }}>{out.title}</div><div className="text-sm text-[#8B98A9]">{out.sub}</div></div></div>
                {call.summary && <div className="mt-4 text-[15px] leading-relaxed">{call.summary}</div>}
                <div className="flex gap-4 mt-4 text-sm text-[#8B98A9]">
                  <span>{call.duration_sec ?? "—"}s</span>
                  {call.disclosed_ai && <span className="text-[#10B981] flex items-center gap-1"><Bot className="h-4 w-4" />AI disclosed itself ✓</span>}
                  <span>attempt {call.attempt ?? 1}</span>
                </div>
                {call.recording_url && <audio controls src={call.recording_url} className="w-full mt-4" />}
              </motion.div>
            )}</AnimatePresence>
          </div>

          <div className="panel p-6 flex flex-col h-[calc(100vh-190px)] min-h-[520px] lg:sticky lg:top-[90px]">
            <div className="flex items-center gap-2 mb-4">
              <span className="label">Live transcript</span>
              {live && <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#EF4444]"><span className="h-2 w-2 rounded-full bg-[#EF4444] pc-pulse" />LIVE</span>}
              {!call.simulated && <span className="text-[11px] text-[#8B98A9]">· streamed from Vapi</span>}
              <span className="ml-auto mono text-[11px] text-[#8B98A9]">{(call.messages ?? []).length} lines</span>
            </div>
            <div ref={scroller} className="space-y-3 flex-1 min-h-0 overflow-y-auto pr-2 scroll-smooth">
              {(call.messages ?? []).map((m, i) => <TranscriptBubble key={i} role={m.role} text={m.text} />)}
              {call.live_partial?.text && !call.outcome && (
                <div className={`flex ${call.live_partial.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className="max-w-[75%] rounded-2xl px-4 py-2.5 text-[15px] italic text-[#8B98A9] border border-dashed border-[#334155]">
                    <div className="label mb-1">{call.live_partial.role === "user" ? "Vendor" : "BillProof AI"} · speaking…</div>{call.live_partial.text}
                  </div>
                </div>
              )}
              {live && !call.live_partial?.text && <div className="flex gap-1 pl-2">{[0, 1, 2].map((i) => <motion.span key={i} className="h-2 w-2 rounded-full bg-[#A78BFA]" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }} />)}</div>}
              {!call.messages?.length && !out && <div className="text-[#8B98A9] text-sm">{call.status === "ringing" ? "Ringing…" : "Connecting…"}</div>}
              <div ref={endRef} />
            </div>
            <div className="text-[11px] text-[#8B98A9] mt-4 border-t border-[#1E2A38] pt-3">The assistant says it is automated, only mentions the last 4 digits of any account, and never accepts new bank details by phone. The transcript is saved as evidence on the bill.</div>
          </div>
        </div>
      )}
    </div>
  );
}
