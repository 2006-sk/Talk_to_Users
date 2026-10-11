// Mission Control (/) — hero counters, live bill stream with 8-node pipelines, web evidence radar, ticker, Bright Data strip.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Radio, ArrowUpRight, Zap } from "lucide-react";
import { useLive, money, C, STATUS, scoreColor } from "@/lib/pc";
import { usePC } from "@/components/pc/Shell";
import { CountUp, AgentPipeline, RadarSweep, ActivityTicker, StatusChip, ConfidencePill, Skeleton, Empty, fade } from "@/components/pc/ui";
import { SourceLogs } from "@/components/pc/SourceLogs";

const today = () => new Date().toISOString().slice(0, 10);

export default function MissionControl() {
  const { companyKey } = usePC();
  const { rows: invoices } = useLive("Invoice", { company_id: companyKey }, "-created_date", 100);
  const { rows: runs } = useLive("AgentRun", { company_id: companyKey }, "-created_date", 400);
  const { rows: evidence } = useLive("Evidence", { company_id: companyKey }, "-created_date", 300);
  const { rows: audit } = useLive("AuditLog", { company_id: companyKey }, "-created_date", 40, 2500);
  const { rows: usage } = useLive("BrightDataUsage", { day: today() }, "-created_date", 50, 4000);

  const bills = useMemo(() => (invoices ?? []).filter((i) => (i.seq ?? 1) > 0 || i.source !== "demo").sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0) || new Date(b.created_date) - new Date(a.created_date)), [invoices]);
  const runsBy = useMemo(() => { const m = {}; for (const r of runs ?? []) (m[r.invoice_id] ??= []).push(r); return m; }, [runs]);

  const stats = useMemo(() => {
    const t = today();
    const todays = bills.filter((b) => (b.created_date ?? "").slice(0, 10) === t);
    const done = todays.filter((b) => !["received", "running"].includes(b.status));
    const protectedAmt = bills.filter((b) => ["blocked", "needs_call", "calling", "needs_review"].includes(b.status) && b.decision !== "owner_approval").reduce((s, b) => s + (b.amount ?? 0), 0);
    return {
      checked: done.length,
      cleared: todays.filter((b) => b.status === "approved").length,
      review: todays.filter((b) => ["needs_review", "needs_call", "calling"].includes(b.status)).length,
      blocked: todays.filter((b) => b.status === "blocked").length,
      protectedAmt,
    };
  }, [bills]);

  // radar follows the bill whose Web Verifier ran most recently
  const radarInv = useMemo(() => {
    const wv = (runs ?? []).filter((r) => r.agent === "web_verifier").sort((a, b) => new Date(b.started_at) - new Date(a.started_at))[0];
    return wv ? { id: wv.invoice_id, running: wv.status === "running", run: wv } : null;
  }, [runs]);
  const radarStatus = useMemo(() => {
    if (!radarInv) return {};
    const s = { ...(radarInv.run?.output?.status ?? {}) };
    for (const e of (evidence ?? []).filter((e) => e.invoice_id === radarInv.id)) {
      const k = e.source_name;
      if (["Identity check", "Internal ledger", "Intake", "Phone call"].includes(k)) continue;
      const rank = { match: 0, mismatch: 1, not_found: 2, pending: 3 };
      if (!(k in s) || rank[e.match] < rank[s[k]]) s[k] = e.match;
    }
    if (radarInv.running) for (const k of ["Web search", "Google Maps", "Trustpilot", "Crunchbase", "LinkedIn", "Indeed", "Company website"]) if (!s[k]) s[k] = "pending";
    return s;
  }, [radarInv, evidence]);
  const radarBill = bills.find((b) => b.id === radarInv?.id);

  const ticker = useMemo(() => {
    const items = [];
    for (const e of (evidence ?? []).slice(0, 30)) {
      const bill = bills.find((b) => b.id === e.invoice_id);
      if (e.flag === "lookalike_domain") items.push({ text: `⚠ ${e.value} ≠ ${e.expected_value}`, color: C.block });
      else if (e.group === "call") items.push({ text: `📞 ${e.label}: ${e.value?.slice(0, 60)}`, color: C.calling });
      else if (e.match === "match") items.push({ text: `${e.source_name} → ${bill?.vendor_name_on_invoice ?? ""}: ${String(e.value).slice(0, 48)} ✓`, color: C.text });
      else if (e.match === "mismatch") items.push({ text: `⚠ ${e.source_name} → ${bill?.vendor_name_on_invoice ?? ""}: ${String(e.value).slice(0, 48)}`, color: C.review });
    }
    for (const a of (audit ?? []).filter((a) => a.action === "call_started").slice(0, 4)) items.unshift({ text: `📞 ${a.detail}`, color: C.calling });
    return items.slice(0, 24);
  }, [evidence, audit, bills]);

  const totalReq = (usage ?? []).reduce((s, u) => s + (u.requests ?? 0), 0);

  return (
    <div className="space-y-6 max-w-[1800px] mx-auto">
      {/* hero counters */}
      <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-4">
        {[
          { label: "Bills checked today", v: stats.checked, color: C.text },
          { label: "Auto-cleared", v: stats.cleared, color: C.safe },
          { label: "Needs review", v: stats.review, color: C.review },
          { label: "Blocked", v: stats.blocked, color: C.block },
        ].map((s) => (
          <motion.div key={s.label} {...fade} className="panel p-5">
            <div className="label">{s.label}</div>
            <div className="text-5xl 2xl:text-6xl font-extrabold tabular-nums mt-2" style={{ color: s.color }}><CountUp value={s.v} /></div>
          </motion.div>
        ))}
        <motion.div {...fade} className="panel p-5 relative overflow-hidden col-span-2 lg:col-span-1" style={{ boxShadow: "inset 0 0 0 1px rgba(16,185,129,.35), 0 0 40px rgba(16,185,129,.12)" }}>
          <div className="label text-[#10B981]">Money protected</div>
          <div className="text-5xl 2xl:text-6xl font-extrabold tabular-nums mt-2 text-[#10B981] glow-emerald truncate"><CountUp value={stats.protectedAmt} format={(v) => money(Math.round(v))} /></div>
          <div className="text-xs text-[#8B98A9] mt-1">held or blocked before anyone paid</div>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6">
        {/* live bill stream */}
        <div className="panel p-5 min-h-[560px]">
          <div className="flex items-center gap-2 mb-4">
            <Radio className="h-4 w-4 text-[#22D3EE] pc-pulse" /><h2 className="text-lg font-bold">Live bill stream</h2>
            <span className="text-sm text-[#8B98A9]">· every bill passes through 8 agents</span>
          </div>
          {invoices === null ? <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
            : !bills.length ? <Empty icon={Zap} title="No bills yet" hint="Press “Run demo” to watch 10 bills go through the crew, or upload your own PDFs." />
            : (
              <div className="space-y-3">
                <AnimatePresence initial={false}>
                  {bills.slice(0, 12).map((b) => (
                    <motion.div key={b.id} layout {...fade}>
                      <Link to={`/bill/${b.id}`} className="block raised p-4 hover:border-[#22D3EE]/50 transition-colors group">
                        <div className="flex items-center gap-4 mb-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-[17px] truncate">{b.vendor_name_on_invoice ?? "Reading bill…"}</span>
                              <span className="mono text-xs text-[#8B98A9]">{b.invoice_number}</span>
                              <ArrowUpRight className="h-4 w-4 text-[#8B98A9] opacity-0 group-hover:opacity-100 transition-opacity" />
                            </div>
                            <div className="mono text-xs text-[#8B98A9] mt-0.5">{b.sender_domain}</div>
                          </div>
                          <span className="mono text-xl font-bold tabular-nums">{money(b.amount, b.currency)}</span>
                          {b.trust_score != null && <span className="mono text-lg font-bold w-12 text-right" style={{ color: scoreColor(b.trust_score) }}>{b.trust_score}</span>}
                          <StatusChip value={b.status} short />
                        </div>
                        <AgentPipeline runs={runsBy[b.id] ?? []} />
                        {b.decision_reason && !["running", "received"].includes(b.status) && <div className="text-sm mt-3" style={{ color: STATUS[b.status]?.color }}>{b.decision_reason}</div>}
                      </Link>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
        </div>

        {/* radar */}
        <div className="space-y-4">
          <div className="panel p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold">Web evidence radar</h2>
              {radarInv?.running && <span className="text-xs font-semibold text-[#3B82F6] pc-pulse">SCANNING</span>}
            </div>
            <div className="text-sm text-[#8B98A9] mb-3 truncate">{radarBill ? <>Checking <span className="text-white font-semibold">{radarBill.vendor_name_on_invoice}</span></> : "Idle"}</div>
            <div className="flex justify-center"><RadarSweep status={radarStatus} active={!!radarInv?.running} size={330} /></div>
            <div className="flex justify-center gap-4 text-[11px] text-[#8B98A9] mt-2">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#10B981]" />found & matches</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#F59E0B]" />mismatch</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#475569]" />not found</span>
            </div>
            {radarBill?.web_confidence && <div className="flex justify-center mt-3"><ConfidencePill value={radarBill.web_confidence} /></div>}
            <div className="mt-4 pt-4 border-t border-[#1E2A38]"><SourceLogs invoiceId={radarInv?.id} title="Sources — click for the live log" compact /></div>
          </div>
          <div className="panel p-5">
            <div className="flex items-center gap-2 mb-3"><span className="h-2 w-2 rounded-full bg-[#3B82F6] pc-pulse" /><h3 className="font-bold">Powered by Bright Data</h3><span className="ml-auto mono text-sm text-[#3B82F6]"><CountUp value={totalReq} /> req today</span></div>
            <div className="space-y-2">
              {(usage ?? []).filter((u) => u.product !== "archive.org").sort((a, b) => b.requests - a.requests).map((u) => (
                <div key={u.id} className="flex items-center gap-3 text-sm">
                  <span className="w-36 truncate text-[#8B98A9]">{u.product}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-[#131B26] overflow-hidden"><motion.div className="h-full bg-[#3B82F6]" initial={{ width: 0 }} animate={{ width: `${Math.min(100, (u.requests / Math.max(1, totalReq)) * 100)}%` }} /></div>
                  <span className="mono w-10 text-right">{u.requests}</span>
                  <span className="mono w-14 text-right text-[11px] text-[#8B98A9]">{u.cache_hits ? `+${u.cache_hits} cached` : ""}</span>
                </div>
              ))}
              {!usage?.length && <div className="text-sm text-[#8B98A9]">No requests yet today.</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="panel"><ActivityTicker items={ticker} /></div>
    </div>
  );
}
