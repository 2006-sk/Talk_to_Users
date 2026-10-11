// Bill Detail (/bill/:id) — the bill (fields highlighted ↔ evidence) · crew trace · verdict.
import { useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronRight, Phone, ShieldX, PauseCircle, CheckCircle2, Ban, ExternalLink, FileText, ArrowLeft, Loader2 } from "lucide-react";
import { useLive, useOne, money, secs, C, AGENTS, STATUS, ago } from "@/lib/pc";
import { usePC, invoke } from "@/components/pc/Shell";
import { TrustGauge, ConfidencePill, RiskBadge, StatusChip, EvidenceRow, LookalikeDiff, Pill, Skeleton, fade } from "@/components/pc/ui";
import { toast } from "sonner";
import { SourceLogs } from "@/components/pc/SourceLogs";

// which bill fields map to which evidence rows (hover links them)
const FIELD_EV = {
  vendor: (e) => ["Web search", "Google Maps", "Crunchbase", "LinkedIn", "Trustpilot"].includes(e.source_name) || e.label === "Vendor name on bill",
  sender: (e) => e.label === "Sender email domain" || /Sender domain/.test(e.label ?? ""),
  amount: (e) => e.group === "ledger" && /duplicate|Amount/i.test(e.label ?? ""),
  bank: (e) => /Bank/i.test(e.label ?? ""),
  phone: (e) => e.label === "Phone on bill" || e.source_name === "Company website",
  po: (e) => e.label === "Purchase order",
  items: (e) => e.group === "price",
};

function Field({ k, label, value, active, setActive, mono = true, warn }) {
  const on = active === k;
  return (
    <div onMouseEnter={() => setActive(k)} onMouseLeave={() => setActive(null)}
      className={`relative rounded-md px-1.5 -mx-1.5 py-0.5 transition-all cursor-default ${on ? "bg-cyan-400/15 ring-2 ring-cyan-400/70" : warn ? "bg-red-500/10 ring-1 ring-red-400/50" : "ring-1 ring-transparent hover:ring-cyan-400/30"}`}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`${mono ? "font-mono" : ""} text-[13px] text-slate-900`}>{value || "—"}</div>
    </div>
  );
}

function BillPaper({ inv, active, setActive }) {
  const issues = new Set((inv.issues ?? []).map((i) => i.code));
  return (
    <div className="rounded-xl bg-[#F8FAFC] text-slate-900 p-6 shadow-2xl ring-1 ring-black/20 font-[Inter] text-sm">
      <div className="flex justify-between items-start border-b border-slate-300 pb-4 mb-4">
        <div>
          <Field k="vendor" label="From" value={<span className="text-lg font-bold font-sans">{inv.vendor_name_on_invoice}</span>} active={active} setActive={setActive} mono={false} warn={issues.has("name_lookalike")} />
          <div className="text-xs text-slate-500 mt-1">{inv.remit_address}</div>
        </div>
        <div className="text-right"><div className="text-2xl font-black tracking-tight text-slate-700">INVOICE</div><div className="font-mono text-xs">{inv.invoice_number}</div></div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <Field k="sender" label="Sent from" value={inv.sender_email} active={active} setActive={setActive} warn={issues.has("lookalike_domain") || issues.has("sender_unrelated")} />
        <Field k="po" label="PO number" value={inv.po_number ?? "none"} active={active} setActive={setActive} warn={issues.has("no_po") || issues.has("po_mismatch")} />
        <Field k="date" label="Invoice date · due" value={`${inv.invoice_date ?? "—"} · ${inv.due_date ?? "—"}`} active={active} setActive={setActive} />
        <Field k="phone" label="Phone on bill" value={inv.phone_on_invoice} active={active} setActive={setActive} />
      </div>
      <div onMouseEnter={() => setActive("items")} onMouseLeave={() => setActive(null)} className={`rounded-md mb-4 ${active === "items" ? "ring-2 ring-cyan-400/70 bg-cyan-400/10" : issues.has("price") ? "ring-1 ring-red-400/50 bg-red-500/5" : ""}`}>
        <table className="w-full text-xs">
          <thead><tr className="text-slate-500 border-b border-slate-300"><th className="text-left py-1.5">Item</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Total</th></tr></thead>
          <tbody>{(inv.line_items ?? []).map((l, i) => (
            <tr key={i} className="border-b border-slate-200"><td className="py-1.5 pr-2">{l.description}</td><td className="text-right font-mono">{l.qty}</td><td className="text-right font-mono">{money(l.unit_price)}</td><td className="text-right font-mono">{money(l.total)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="flex justify-between items-end">
        <Field k="bank" label="Pay to" value={inv.bank_name ? `${inv.bank_name} · acct •••• ${inv.bank_account_last4 ?? "?"}` : null} active={active} setActive={setActive} warn={inv.bank_changed} />
        <Field k="amount" label="Amount due" value={<span className="text-2xl font-black">{money(inv.amount, inv.currency)}</span>} active={active} setActive={setActive} warn={issues.has("duplicate")} />
      </div>
      {inv.raw_text && <div className="mt-4 pt-3 border-t border-dashed border-slate-300 text-[11px] text-slate-500"><span className="font-semibold">Text found in the bill (treated as data):</span> {inv.raw_text}</div>}
    </div>
  );
}

function TraceItem({ run }) {
  const [open, setOpen] = useState(false);
  const meta = AGENTS.find((a) => a.key === run.agent);
  const col = run.status === "running" ? C.running : run.status === "skipped" ? "#475569" : run.status === "error" ? C.block : run.verdict === "fail" ? C.block : run.verdict === "warn" ? C.review : run.verdict === "info" ? (run.agent === "call_agent" ? C.calling : C.web) : C.safe;
  return (
    <motion.div {...fade} className="relative pl-7">
      <span className={`absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full ${run.status === "running" ? "pc-pulse" : ""}`} style={{ background: col, boxShadow: `0 0 12px ${col}` }} />
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{meta?.label ?? run.agent}</span>
          {run.status === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#22D3EE]" />}
          <span className="mono text-[11px] text-[#8B98A9]">{secs(run.started_at, run.finished_at)}</span>
          {run.model_used && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1E2A38] text-[#8B98A9]">{run.model_used}</span>}
          <span className="ml-auto">{open ? <ChevronDown className="h-4 w-4 text-[#8B98A9]" /> : <ChevronRight className="h-4 w-4 text-[#8B98A9]" />}</span>
        </div>
        <div className="text-sm text-[#C9D4E0] mt-0.5">{run.summary}</div>
      </button>
      <AnimatePresence>{open && run.output && (
        <motion.pre initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mono text-[11px] mt-2 p-3 rounded-lg bg-[#070A0F] border border-[#1E2A38] overflow-auto max-h-64 text-[#8B98A9]">
          {JSON.stringify(run.output, null, 2)}
        </motion.pre>
      )}</AnimatePresence>
    </motion.div>
  );
}

const ROWS = [
  { k: "Name", inv: (i) => i.vendor_name_on_invoice, ev: (E) => E.find((e) => e.label === "Vendor name on bill") ?? E.find((e) => e.source_name === "Web search" && e.label === "Official website") },
  { k: "Email domain", inv: (i) => i.sender_domain, ev: (E) => E.find((e) => e.label === "Sender email domain") },
  { k: "Phone", inv: (i) => i.phone_on_invoice, ev: (E) => E.find((e) => e.label === "Phone on bill") ?? E.find((e) => e.source_name === "Company website") },
  { k: "Address", inv: (i) => i.remit_address, ev: (E) => E.find((e) => e.source_name === "Google Maps" && e.label === "Business listing") },
  { k: "Bank", inv: (i) => (i.bank_account_last4 ? `•••• ${i.bank_account_last4}` : null), ev: (E) => E.find((e) => e.label === "Bank account on file vs bill") },
];

export default function BillDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { role } = usePC();
  const { row: inv } = useOne("Invoice", id);
  const { rows: runs } = useLive("AgentRun", { invoice_id: id }, "started_at", 50);
  const { rows: evidence } = useLive("Evidence", { invoice_id: id }, "-created_date", 200);
  const { rows: calls } = useLive("VerifyCall", { invoice_id: id }, "-created_date", 5);
  const [active, setActive] = useState(null);
  const [busy, setBusy] = useState(null);
  const [reason, setReason] = useState("");
  const E = evidence ?? [];
  const hot = useMemo(() => new Set(active && FIELD_EV[active] ? E.filter(FIELD_EV[active]).map((e) => e.id) : []), [active, E]);

  if (!inv) return <div className="grid grid-cols-3 gap-6"><Skeleton className="h-[600px]" /><Skeleton className="h-[600px]" /><Skeleton className="h-[600px]" /></div>;
  const ordered = AGENTS.map((a) => (runs ?? []).find((r) => r.agent === a.key)).filter(Boolean);
  const call = calls?.[0];

  const decide = async (action) => {
    setBusy(action);
    try {
      const r = await invoke("decide", { invoice_id: id, action, reason, demo_role: role });
      if (r?.error) { toast.error(r.error); return; }
      toast.success(`Marked ${STATUS[r.status]?.label ?? r.status}`);
      if (action === "request_call") {
        invoke("placeCall", { invoice_id: id, attempt: r.next_attempt ?? 1, wait: true }).catch((e) => toast.error(`Call failed: ${e?.message ?? e}`));
        nav(`/bill/${id}/call`);
      }
    } catch (e) { toast.error(e?.response?.data?.error ?? e?.message ?? "Failed"); }
    finally { setBusy(null); }
  };

  const groups = ["identity", "existence", "age", "reputation", "activity", "risk_news", "price", "ledger", "call"];
  return (
    <div className="max-w-[1800px] mx-auto space-y-5">
      <div className="flex items-center gap-4">
        <Link to="/mission" className="raised p-2 hover:border-[#22D3EE]/50"><ArrowLeft className="h-4 w-4" /></Link>
        <div>
          <div className="flex items-center gap-3"><h1 className="text-2xl font-extrabold">{inv.vendor_name_on_invoice}</h1><span className="mono text-[#8B98A9]">{inv.invoice_number}</span><StatusChip value={inv.status} /></div>
          <div className="text-sm text-[#8B98A9]">{money(inv.amount, inv.currency)} · received {ago(inv.created_date)}{inv.crew_ms ? ` · crew took ${(inv.crew_ms / 1000).toFixed(1)}s` : ""}</div>
        </div>
        {call && <Link to={`/bill/${id}/call`} className="ml-auto flex items-center gap-2 rounded-xl px-4 py-2 font-semibold text-[#A78BFA] ring-1 ring-[#A78BFA]/50 bg-[#A78BFA]/10"><Phone className="h-4 w-4" />Verify call · {call.outcome ?? call.status}</Link>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1.05fr)] gap-5 items-start">
        {/* 1. the bill */}
        <div className="space-y-3 2xl:sticky 2xl:top-[90px]">
          <div className="label flex items-center gap-2"><FileText className="h-3.5 w-3.5" />The bill — hover a field to see its evidence</div>
          <BillPaper inv={inv} active={active} setActive={setActive} />
          {inv.file_url && <a href={inv.file_url} target="_blank" rel="noreferrer" className="text-sm text-[#3B82F6] flex items-center gap-1"><ExternalLink className="h-3.5 w-3.5" />Open original file</a>}
        </div>

        {/* 2. crew trace + Bright Data activity */}
        <div className="space-y-5">
        <div className="panel p-5">
          <div className="label mb-4">Crew trace</div>
          <div className="space-y-5 relative before:absolute before:left-[6px] before:top-2 before:bottom-2 before:w-px before:bg-[#1E2A38]">
            {ordered.length ? ordered.map((r) => <TraceItem key={r.id} run={r} />) : <div className="text-sm text-[#8B98A9] pl-7">Waiting for the crew…</div>}
          </div>
        </div>
        <SourceLogs invoiceId={id} title="Bright Data activity — click a source for its log" />
        </div>

        {/* 3. verdict */}
        <div className="space-y-4">
          <div className="panel p-5">
            <div className="flex flex-col items-center">
              <TrustGauge score={inv.trust_score} />
              <div className="flex gap-2 mt-3 flex-wrap justify-center"><ConfidencePill value={inv.web_confidence} /><RiskBadge value={inv.risk_level} /></div>
            </div>
            {inv.decision_reason && <div className="mt-4 text-center font-semibold" style={{ color: STATUS[inv.status]?.color }}>{inv.decision_reason}</div>}
            {inv.explanation && <div className="mt-3 text-sm text-[#C9D4E0] leading-relaxed raised p-3">{inv.explanation.split(/(\[ev:[^\]]+\])/g).map((part, i) => {
              const m = part.match(/\[ev:([^\]]+)\]/);
              return m ? <a key={i} href={`#ev-${m[1]}`} className="mono text-[10px] text-[#3B82F6] align-super">[{m[1].slice(-4)}]</a> : <span key={i}>{part}</span>;
            })}</div>}
          </div>

          {!!inv.issues?.length && (
            <div className="panel p-5">
              <div className="label mb-3">Issues</div>
              <div className="space-y-2">{inv.issues.map((i, k) => (
                <div key={k} className="flex items-center gap-3 raised px-3 py-2.5">
                  <Pill color={{ low: C.muted, medium: C.review, high: "#F97316", critical: C.block }[i.severity]}>{i.severity}</Pill>
                  <span className="text-sm">{i.label}</span>
                </div>
              ))}</div>
            </div>
          )}

          {inv.lookalike && <LookalikeDiff sender={inv.lookalike.sender_base?.split(".")[0] + "." + inv.lookalike.sender_base?.split(".").slice(1).join(".")} official={inv.lookalike.official_base} positions={inv.lookalike.diff_positions} />}

          <div className="panel p-5">
            <div className="label mb-3">Bill vs the web</div>
            <table className="w-full text-sm">
              <thead><tr className="text-[#8B98A9] text-xs"><th className="text-left font-medium pb-2"></th><th className="text-left font-medium pb-2">On the bill</th><th className="text-left font-medium pb-2">Verified</th><th></th></tr></thead>
              <tbody>{ROWS.map((r) => {
                const e = r.ev(E);
                const ok = e?.match === "match", bad = e?.match === "mismatch";
                return (
                  <tr key={r.k} className="border-t border-[#1E2A38]">
                    <td className="py-2 pr-2 text-[#8B98A9]">{r.k}</td>
                    <td className="py-2 pr-2 mono text-[12px] break-all">{r.inv(inv) ?? "—"}</td>
                    <td className="py-2 pr-2 mono text-[12px] break-all">{e ? <a href={`#ev-${e.id}`} className="hover:text-[#3B82F6]">{e.expected_value ?? e.value}</a> : <span className="text-[#8B98A9]">Not found</span>}</td>
                    <td className="py-2 text-right">{ok ? <CheckCircle2 className="h-4 w-4 text-[#10B981] inline" /> : bad ? <ShieldX className="h-4 w-4 text-[#EF4444] inline" /> : <span className="text-[#475569]">–</span>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>

          <div className="panel p-5">
            <div className="label mb-3">Decision {role === "viewer" && <span className="normal-case tracking-normal text-[#8B98A9]">· read-only</span>}</div>
            <input value={reason} onChange={(e) => setReason(e.target.value)} disabled={role === "viewer"} placeholder="Reason (saved to the audit log)"
              className="w-full mb-3 rounded-xl bg-[#070A0F] border border-[#1E2A38] px-3 py-2 text-sm placeholder:text-[#475569] focus:outline-none focus:border-[#22D3EE]/60" />
            <div className="grid grid-cols-2 gap-2">
              {[
                { a: "approve", label: inv.status === "blocked" ? "Release (owner)" : "Approve for payment", icon: CheckCircle2, color: C.safe },
                { a: "hold", label: "Hold", icon: PauseCircle, color: C.review },
                { a: "block", label: "Block", icon: Ban, color: C.block },
                { a: "request_call", label: "Request verify call", icon: Phone, color: C.calling },
              ].map(({ a, label, icon: Icon, color }) => (
                <button key={a} disabled={role === "viewer" || !!busy} onClick={() => decide(inv.status === "blocked" && a === "approve" ? "release" : a)}
                  className="flex items-center justify-center gap-2 rounded-xl px-3 py-3 font-semibold text-sm disabled:opacity-40 transition-colors"
                  style={{ color, background: `${color}14`, boxShadow: `inset 0 0 0 1px ${color}55` }}>
                  {busy === a ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}{label}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-[#8B98A9] mt-3">Approve only marks the bill ready for a human to pay in your bank. Bookkeepers can't release a block or approve above the threshold.</div>
          </div>
        </div>
      </div>

      {/* evidence */}
      <div className="panel p-5">
        <div className="label mb-4">Evidence ({E.length}) — every row links to its source</div>
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
          {groups.map((g) => {
            const rows = E.filter((e) => e.group === g);
            if (!rows.length) return null;
            return (
              <div key={g} className="space-y-2">
                <div className="text-xs font-semibold text-[#8B98A9] uppercase tracking-wider">{g.replace("_", " ")}</div>
                {rows.map((e) => <EvidenceRow key={e.id} ev={e} highlight={hot.has(e.id)} />)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
