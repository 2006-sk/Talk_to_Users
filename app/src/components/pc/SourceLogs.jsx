// Bright Data activity per source: click a source (e.g. "Amazon scraper") to open its live log — started, snapshot, polling, completed, cache hit, failed.
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Loader2, CheckCircle2, XCircle, Database, Clock, RotateCw, Zap } from "lucide-react";
import { useLive, C } from "@/lib/pc";

const EV = {
  started: { label: "Started", color: C.running, icon: Zap },
  snapshot: { label: "Snapshot", color: C.web, icon: Database },
  polling: { label: "Polling", color: C.running, icon: Clock },
  retry: { label: "Retry", color: C.review, icon: RotateCw },
  completed: { label: "Completed", color: C.safe, icon: CheckCircle2 },
  cache_hit: { label: "Cache hit", color: "#34D399", icon: Database },
  failed: { label: "Failed", color: C.block, icon: XCircle },
  timeout: { label: "Timed out", color: C.review, icon: Clock },
};
const DONE = new Set(["completed", "cache_hit", "failed", "timeout"]);
const time = (d) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function SourceLogs({ invoiceId, title = "Bright Data activity", compact = false }) {
  const { rows } = useLive("BdLog", invoiceId ? { invoice_id: invoiceId } : { invoice_id: "__none__" }, "created_date", 300, 2000);
  const [open, setOpen] = useState(null);
  const sources = useMemo(() => {
    const m = new Map();
    for (const r of [...(rows ?? [])].sort((a, b) => new Date(a.at ?? a.created_date) - new Date(b.at ?? b.created_date))) {
      const s = m.get(r.source) ?? { source: r.source, product: r.product, lines: [] };
      s.lines.push(r);
      m.set(r.source, s);
    }
    return [...m.values()].map((s) => {
      const last = s.lines[s.lines.length - 1];
      const fin = [...s.lines].reverse().find((l) => DONE.has(l.event));
      const running = !fin || new Date(last.at ?? last.created_date) > new Date(fin.at ?? fin.created_date) && !DONE.has(last.event);
      return { ...s, last, state: running ? "running" : fin.event, ms: s.lines.reduce((t, l) => t + (l.ms ?? 0), 0), rows: fin?.rows };
    }).sort((a, b) => (a.state === "running" ? -1 : 0) - (b.state === "running" ? -1 : 0) || a.source.localeCompare(b.source));
  }, [rows]);
  const scrapers = sources.filter((s) => s.product === "Web Scraper API");
  const live = sources.filter((s) => s.state === "running").length;

  return (
    <div className={compact ? "" : "panel p-5"}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`h-2 w-2 rounded-full bg-[#3B82F6] ${live ? "pc-pulse" : ""}`} />
        <span className="label">{title}</span>
        <span className="ml-auto text-[11px] text-[#8B98A9]">{live ? `${live} running · ` : ""}{scrapers.length}/2 scrapers · {sources.length} sources</span>
      </div>
      {!invoiceId || rows === null ? <div className="text-sm text-[#8B98A9]">{invoiceId ? "Loading…" : "No bill selected."}</div>
        : !sources.length ? <div className="text-sm text-[#8B98A9]">No Bright Data requests for this bill yet.</div>
        : (
          <div className="space-y-1.5">
            {sources.map((s) => {
              const st = s.state === "running" ? { label: "Running", color: C.running } : EV[s.state] ?? EV.completed;
              const isOpen = open === s.source;
              return (
                <div key={s.source} className="raised overflow-hidden">
                  <button onClick={() => setOpen(isOpen ? null : s.source)} className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#1E2A38]/50 transition-colors">
                    {s.state === "running" ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" style={{ color: C.running }} /> : <span className="h-2 w-2 rounded-full shrink-0" style={{ background: st.color }} />}
                    <span className="text-sm font-semibold truncate">{s.source}</span>
                    {s.product === "Web Scraper API" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#3B82F6]/15 text-[#3B82F6] shrink-0">scraper</span>}
                    <span className="ml-auto text-[11px] shrink-0" style={{ color: st.color }}>{st.label}</span>
                    {s.ms > 0 && <span className="mono text-[11px] text-[#8B98A9] w-12 text-right shrink-0">{(s.ms / 1000).toFixed(1)}s</span>}
                    <ChevronDown className={`h-4 w-4 text-[#8B98A9] transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
                        <div className="border-t border-[#1E2A38] bg-[#070A0F] px-3 py-2 space-y-1 max-h-64 overflow-auto">
                          <div className="text-[10px] text-[#8B98A9] mb-1">{s.product}</div>
                          {s.lines.map((l) => {
                            const e = EV[l.event] ?? EV.started;
                            const Icon = e.icon;
                            return (
                              <motion.div key={l.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex items-start gap-2 text-[12px]">
                                <span className="mono text-[#475569] w-[62px] shrink-0">{time(l.at ?? l.created_date)}</span>
                                <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: e.color }} />
                                <span className="font-semibold w-[72px] shrink-0" style={{ color: e.color }}>{e.label}</span>
                                <span className="text-[#C9D4E0] break-words min-w-0">{l.detail}{l.rows != null ? <span className="text-[#8B98A9]"> · {l.rows} row{l.rows === 1 ? "" : "s"}</span> : null}</span>
                              </motion.div>
                            );
                          })}
                          {s.state === "running" && <div className="flex items-center gap-2 text-[12px] text-[#22D3EE] pl-[70px]"><Loader2 className="h-3 w-3 animate-spin" />waiting for Bright Data…</div>}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
