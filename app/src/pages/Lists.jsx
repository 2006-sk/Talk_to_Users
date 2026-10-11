// Bills, Vendors (+ profile), Approvals, Audit log.
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Download, Search, Building2, CheckSquare, ScrollText, ArrowLeft, CheckCircle2, XCircle, Loader2, Globe, Phone } from "lucide-react";
import { useLive, useOne, money, ago, C, STATUS, CONF, RISK } from "@/lib/pc";
import { usePC, invoke } from "@/components/pc/Shell";
import { StatusChip, ConfidencePill, RiskBadge, ScoreRing, EvidenceRow, Empty, Skeleton, Pill, fade } from "@/components/pc/ui";
import { toast } from "sonner";

const Title = ({ children, sub }) => (<div className="mb-5"><h1 className="text-3xl font-extrabold tracking-tight">{children}</h1>{sub && <div className="text-[#8B98A9] mt-1">{sub}</div>}</div>);

export function Bills() {
  const { companyKey } = usePC();
  const { rows } = useLive("Invoice", { company_id: companyKey }, "-created_date", 300, 3000);
  const [q, setQ] = useState("");
  const list = (rows ?? []).filter((b) => !q || `${b.vendor_name_on_invoice} ${b.invoice_number} ${b.sender_domain}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="max-w-[1500px] mx-auto">
      <Title sub="Every bill the crew has checked">Bills</Title>
      <div className="relative mb-4 w-96"><Search className="h-4 w-4 absolute left-3 top-3 text-[#8B98A9]" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendor, invoice, domain" className="w-full rounded-xl bg-[#0E141C] border border-[#1E2A38] pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-[#22D3EE]/60" /></div>
      <div className="panel overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-[#8B98A9] text-xs uppercase tracking-wider bg-[#0A0F16]"><tr>{["Vendor", "Invoice", "Amount", "Trust", "Web", "Risk", "Status", "Received"].map((h) => <th key={h} className="text-left font-semibold px-4 py-3">{h}</th>)}</tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={8} className="p-4"><Skeleton className="h-10" /></td></tr>}
            {list.map((b) => (
              <tr key={b.id} className="border-t border-[#1E2A38] hover:bg-[#131B26]">
                <td className="px-4 py-3"><Link to={`/bill/${b.id}`} className="font-semibold hover:text-[#22D3EE]">{b.vendor_name_on_invoice ?? "—"}</Link><div className="mono text-[11px] text-[#8B98A9]">{b.sender_domain}</div></td>
                <td className="px-4 py-3 mono text-xs">{b.invoice_number}</td>
                <td className="px-4 py-3 mono">{money(b.amount, b.currency)}</td>
                <td className="px-4 py-3 mono font-bold">{b.trust_score ?? "—"}</td>
                <td className="px-4 py-3">{b.web_confidence ? <span style={{ color: CONF[b.web_confidence]?.color }}>{CONF[b.web_confidence]?.label}</span> : "—"}</td>
                <td className="px-4 py-3">{b.risk_level ? <span style={{ color: RISK[b.risk_level]?.color }}>{b.risk_level}</span> : "—"}</td>
                <td className="px-4 py-3"><StatusChip value={b.status} short /></td>
                <td className="px-4 py-3 text-[#8B98A9]">{ago(b.created_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && !list.length && <Empty title="No bills" hint="Upload a bill or run the demo." />}
      </div>
    </div>
  );
}

export function Vendors() {
  const { companyKey } = usePC();
  const { rows } = useLive("Vendor", { company_id: companyKey }, "-updated_date", 200, 4000);
  return (
    <div className="max-w-[1600px] mx-auto">
      <Title sub="Trust is re-checked on every bill and nightly">Vendors</Title>
      {rows === null ? <div className="grid grid-cols-2 2xl:grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40" />)}</div> : !rows.length ? <div className="panel"><Empty icon={Building2} title="No vendors yet" /></div> : (
        <div className="grid grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {rows.map((v) => (
            <motion.div key={v.id} {...fade}>
              <Link to={`/vendors/${v.id}`} className="panel p-5 block hover:border-[#22D3EE]/50 transition-colors h-full">
                <div className="flex items-start gap-4">
                  <ScoreRing score={v.trust_score} />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-lg truncate">{v.name}</div>
                    <div className="mono text-xs text-[#8B98A9] truncate">{v.official_domain ?? "no website found"}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">{v.coverage ? <ConfidencePill value={v.coverage} prefix="Coverage" /> : <Pill color={C.muted}>Not verified yet</Pill>}{v.status !== "active" && <Pill color={C.review}>{v.status.replace("_", " ")}</Pill>}</div>
                  </div>
                </div>
                <div className="text-[11px] text-[#8B98A9] mt-3">Last verified {ago(v.last_verified_at)}{v.changes?.length ? <span className="text-[#F59E0B]"> · {v.changes.length} change{v.changes.length > 1 ? "s" : ""}</span> : null}</div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

export function VendorProfile() {
  const { id } = useParams();
  const { row: v } = useOne("Vendor", id, 4000);
  const { rows: bills } = useLive("Invoice", { vendor_id: id }, "-created_date", 50, 4000);
  const { rows: ev } = useLive("Evidence", { vendor_id: id }, "-created_date", 60, 6000);
  const { rows: calls } = useLive("VerifyCall", { vendor_id: id }, "-created_date", 20, 6000);
  const latest = useMemo(() => { const seen = new Set(); return (ev ?? []).filter((e) => { const k = `${e.source_name}|${e.label}`; if (seen.has(k)) return false; seen.add(k); return e.group !== "ledger"; }); }, [ev]);
  if (!v) return <Skeleton className="h-96" />;
  return (
    <div className="max-w-[1500px] mx-auto space-y-5">
      <div className="flex items-center gap-4"><Link to="/vendors" className="raised p-2"><ArrowLeft className="h-4 w-4" /></Link><ScoreRing score={v.trust_score} size={72} />
        <div><h1 className="text-3xl font-extrabold">{v.name}</h1><div className="flex gap-3 text-sm text-[#8B98A9] mt-1">
          <span className="flex items-center gap-1"><Globe className="h-3.5 w-3.5" />{v.official_domain ?? "Not found"}</span>
          <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{v.official_phone ?? "No verified phone"}{v.official_phone_sources?.length ? ` (${v.official_phone_sources.join(" + ")})` : ""}</span>
          {v.known_bank_last4 && <span>Bank on file •••• {v.known_bank_last4}</span>}</div></div></div>
      {!!v.changes?.length && <div className="panel p-5"><div className="label mb-2">Changes</div>{v.changes.map((c, i) => <div key={i} className="text-sm text-[#F59E0B]">Bank details changed on {new Date(c.at).toLocaleDateString()} — {c.from} → {c.to}</div>)}</div>}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-5">
        <div className="panel p-5"><div className="label mb-3">Latest evidence</div><div className="grid grid-cols-2 gap-2">{latest.map((e) => <EvidenceRow key={e.id} ev={e} />)}</div></div>
        <div className="space-y-5">
          <div className="panel p-5"><div className="label mb-3">Bills</div>{(bills ?? []).map((b) => <Link key={b.id} to={`/bill/${b.id}`} className="flex items-center gap-3 py-2 border-t border-[#1E2A38] text-sm"><span className="mono">{b.invoice_number}</span><span className="mono">{money(b.amount)}</span><span className="ml-auto"><StatusChip value={b.status} short /></span></Link>)}</div>
          <div className="panel p-5"><div className="label mb-3">Calls</div>{(calls ?? []).length ? calls.map((c) => <Link key={c.id} to={`/bill/${c.invoice_id}/call`} className="flex items-center justify-between py-2 border-t border-[#1E2A38] text-sm"><span className="mono">{c.number_displayed}</span><span>{c.outcome ?? c.status}</span></Link>) : <div className="text-sm text-[#8B98A9]">No calls.</div>}</div>
        </div>
      </div>
    </div>
  );
}

const RISK_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
export function Approvals() {
  const { companyKey, role, company } = usePC();
  const { rows } = useLive("Invoice", { company_id: companyKey }, "-created_date", 300, 2500);
  const [reasons, setReasons] = useState({});
  const [busy, setBusy] = useState(null);
  const queue = (rows ?? []).filter((b) => ["needs_review", "needs_call", "blocked"].includes(b.status)).sort((a, b) => (RISK_ORDER[a.risk_level] ?? 9) - (RISK_ORDER[b.risk_level] ?? 9) || String(a.due_date).localeCompare(String(b.due_date)));
  const act = async (b, action) => {
    setBusy(b.id + action);
    try { const r = await invoke("decide", { invoice_id: b.id, action: b.status === "blocked" && action === "approve" ? "release" : action, reason: reasons[b.id] ?? "", demo_role: role }); r?.error ? toast.error(r.error) : toast.success(`${b.vendor_name_on_invoice}: ${action}d`); }
    catch (e) { toast.error(e?.response?.data?.error ?? e?.message ?? "Failed"); } finally { setBusy(null); }
  };
  return (
    <div className="max-w-[1400px] mx-auto">
      <Title sub={`Anything above ${money(company?.approval_threshold ?? 5000)} or high/critical risk needs the owner. You're viewing as ${role}.`}>Approvals</Title>
      {rows && !queue.length ? <div className="panel"><Empty icon={CheckSquare} title="Nothing waiting" hint="Bills that need a human show up here." /></div> : (
        <div className="space-y-3">{queue.map((b) => (
          <motion.div key={b.id} {...fade} className="panel p-5 flex items-center gap-5">
            <div className="w-1.5 self-stretch rounded-full" style={{ background: RISK[b.risk_level]?.color ?? C.muted }} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3"><Link to={`/bill/${b.id}`} className="font-bold text-lg hover:text-[#22D3EE]">{b.vendor_name_on_invoice}</Link><span className="mono text-xs text-[#8B98A9]">{b.invoice_number}</span><RiskBadge value={b.risk_level} />{b.needs_owner && <Pill color={C.calling}>Owner</Pill>}</div>
              <div className="text-sm mt-1" style={{ color: STATUS[b.status]?.color }}>{b.decision_reason}</div>
              <div className="text-xs text-[#8B98A9] mt-1">Due {b.due_date ?? "—"}</div>
            </div>
            <div className="mono text-2xl font-bold">{money(b.amount)}</div>
            <input value={reasons[b.id] ?? ""} onChange={(e) => setReasons({ ...reasons, [b.id]: e.target.value })} placeholder="Reason" disabled={role === "viewer"} className="w-48 rounded-xl bg-[#070A0F] border border-[#1E2A38] px-3 py-2 text-sm" />
            <button disabled={role === "viewer" || !!busy} onClick={() => act(b, "approve")} className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 font-semibold text-sm text-[#10B981] bg-[#10B981]/10 ring-1 ring-[#10B981]/40 disabled:opacity-40">{busy === b.id + "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{b.status === "blocked" ? "Release" : "Approve"}</button>
            <button disabled={role === "viewer" || !!busy} onClick={() => act(b, "reject")} className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 font-semibold text-sm text-[#EF4444] bg-[#EF4444]/10 ring-1 ring-[#EF4444]/40 disabled:opacity-40"><XCircle className="h-4 w-4" />Reject</button>
          </motion.div>
        ))}</div>
      )}
    </div>
  );
}

export function Audit() {
  const { companyKey } = usePC();
  const { rows } = useLive("AuditLog", { company_id: companyKey }, "-created_date", 500, 3000);
  const [actor, setActor] = useState("all");
  const actors = [...new Set((rows ?? []).map((r) => r.actor?.split(" ")[0]))].filter(Boolean);
  const list = (rows ?? []).filter((r) => actor === "all" || r.actor?.startsWith(actor));
  const csv = () => {
    const lines = [["time", "actor", "action", "detail", "invoice_id"], ...list.map((r) => [r.created_date, r.actor, r.action, r.detail, r.invoice_id])].map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(","));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })); a.download = "paycrew-audit.csv"; a.click();
  };
  return (
    <div className="max-w-[1300px] mx-auto">
      <div className="flex items-end justify-between"><Title sub="Every agent action, call and human decision">Audit log</Title>
        <button onClick={csv} className="flex items-center gap-2 raised px-4 py-2.5 text-sm font-semibold mb-5"><Download className="h-4 w-4" />Export CSV</button></div>
      <div className="flex gap-2 mb-4 flex-wrap">{["all", ...actors].map((a) => <button key={a} onClick={() => setActor(a)} className={`px-3 py-1.5 rounded-full text-sm ${actor === a ? "bg-[#22D3EE]/15 text-[#22D3EE] ring-1 ring-[#22D3EE]/40" : "raised text-[#8B98A9]"}`}>{a}</button>)}</div>
      <div className="panel p-5">
        {!list.length ? <Empty icon={ScrollText} title="No entries" /> : (
          <div className="space-y-0">{list.map((r) => (
            <div key={r.id} className="grid grid-cols-[150px_160px_200px_1fr] gap-4 py-2.5 border-t border-[#1E2A38] text-sm first:border-0">
              <span className="text-[#8B98A9] mono text-xs">{new Date(r.created_date).toLocaleString()}</span>
              <span className="font-semibold truncate" style={{ color: r.actor?.startsWith("call") ? C.calling : r.actor?.match(/owner|bookkeeper/) ? C.safe : C.text }}>{r.actor}</span>
              <span className="mono text-xs text-[#22D3EE] truncate">{r.action}</span>
              <span className="text-[#C9D4E0]">{r.invoice_id ? <Link to={`/bill/${r.invoice_id}`} className="hover:text-[#22D3EE]">{r.detail}</Link> : r.detail}</span>
            </div>
          ))}</div>
        )}
      </div>
    </div>
  );
}
