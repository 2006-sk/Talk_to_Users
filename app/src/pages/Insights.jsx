// Analytics, Evals, Settings.
import { useMemo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { FlaskConical, CheckCircle2, XCircle, Save, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useLive, money, ago, C, CONF } from "@/lib/pc";
import { usePC, invoke } from "@/components/pc/Shell";
import { CountUp, Pill, Empty, Skeleton, fade } from "@/components/pc/ui";
import { toast } from "sonner";

const Title = ({ children, sub }) => (<div className="mb-5"><h1 className="text-3xl font-extrabold tracking-tight">{children}</h1>{sub && <div className="text-[#8B98A9] mt-1">{sub}</div>}</div>);
const tip = { contentStyle: { background: "#131B26", border: "1px solid #1E2A38", borderRadius: 12, color: "#E6EDF3" }, labelStyle: { color: "#8B98A9" } };

export function Analytics() {
  const { companyKey } = usePC();
  const { rows: inv } = useLive("Invoice", { company_id: companyKey }, "-created_date", 500, 5000);
  const { rows: calls } = useLive("VerifyCall", { company_id: companyKey }, "-created_date", 200, 5000);
  const { rows: usage } = useLive("BrightDataUsage", null, "-created_date", 300, 8000);
  const bills = (inv ?? []).filter((b) => b.seq !== 0);
  const d = useMemo(() => {
    const byDay = {};
    for (const b of bills) { const k = (b.created_date ?? "").slice(5, 10); byDay[k] ??= { day: k, protected: 0, checked: 0 }; byDay[k].checked++; if (["blocked", "needs_review", "needs_call", "calling"].includes(b.status) && b.decision !== "owner_approval") byDay[k].protected += b.amount ?? 0; }
    const issues = {};
    for (const b of bills) for (const i of b.issues ?? []) if (i.severity !== "low") issues[i.code] = (issues[i.code] ?? 0) + 1;
    const conf = {};
    for (const b of bills) if (b.web_confidence) conf[b.web_confidence] = (conf[b.web_confidence] ?? 0) + 1;
    const outcomes = {};
    for (const c of calls ?? []) if (c.outcome) outcomes[c.outcome] = (outcomes[c.outcome] ?? 0) + 1;
    const prod = {};
    for (const u of usage ?? []) if (u.product !== "archive.org") prod[u.product] = (prod[u.product] ?? 0) + (u.requests ?? 0);
    const times = bills.map((b) => b.crew_ms).filter(Boolean);
    return {
      series: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
      issues: Object.entries(issues).map(([k, v]) => ({ k: k.replace(/_/g, " "), v })).sort((a, b) => b.v - a.v),
      conf: ["high", "medium", "low", "very_low"].filter((k) => conf[k]).map((k) => ({ name: CONF[k].label, value: conf[k], color: CONF[k].color })),
      outcomes: Object.entries(outcomes).map(([k, v]) => ({ k, v })),
      prod: Object.entries(prod).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v),
      avg: times.length ? times.reduce((a, b) => a + b, 0) / times.length / 1000 : 0,
      protectedTotal: bills.filter((b) => ["blocked", "needs_review", "needs_call", "calling"].includes(b.status) && b.decision !== "owner_approval").reduce((s, b) => s + (b.amount ?? 0), 0),
    };
  }, [bills, calls, usage]);
  if (inv === null) return <Skeleton className="h-96" />;
  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      <Title sub="What the crew caught, and how">Analytics</Title>
      <div className="grid grid-cols-2 2xl:grid-cols-4 gap-4">
        {[["Money protected", money(d.protectedTotal), C.safe], ["Bills checked", bills.length, C.text], ["Avg crew time / bill", `${d.avg.toFixed(1)}s`, C.running], ["Verify calls", (calls ?? []).length, C.calling]].map(([l, v, c]) => (
          <div key={l} className="panel p-5"><div className="label">{l}</div><div className="text-5xl font-extrabold mt-2 tabular-nums" style={{ color: c }}>{v}</div></div>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <div className="panel p-5 h-80"><div className="label mb-3">Money protected over time</div>
          <ResponsiveContainer width="100%" height="88%"><AreaChart data={d.series}><defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={C.safe} stopOpacity={0.5} /><stop offset="1" stopColor={C.safe} stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid stroke="#1E2A38" vertical={false} /><XAxis dataKey="day" stroke="#8B98A9" fontSize={12} /><YAxis stroke="#8B98A9" fontSize={12} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} /><Tooltip {...tip} formatter={(v) => money(v)} />
            <Area type="monotone" dataKey="protected" stroke={C.safe} strokeWidth={2.5} fill="url(#g)" /></AreaChart></ResponsiveContainer></div>
        <div className="panel p-5 h-80"><div className="label mb-3">Issues by type</div>
          <ResponsiveContainer width="100%" height="88%"><BarChart data={d.issues} layout="vertical" margin={{ left: 40 }}><CartesianGrid stroke="#1E2A38" horizontal={false} /><XAxis type="number" stroke="#8B98A9" fontSize={12} allowDecimals={false} /><YAxis type="category" dataKey="k" stroke="#8B98A9" fontSize={12} width={110} /><Tooltip {...tip} /><Bar dataKey="v" fill={C.review} radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></div>
        <div className="panel p-5 h-80"><div className="label mb-3">Web confidence</div>
          <ResponsiveContainer width="100%" height="88%"><PieChart><Pie data={d.conf} dataKey="value" nameKey="name" innerRadius={70} outerRadius={110} paddingAngle={3}>{d.conf.map((c) => <Cell key={c.name} fill={c.color} />)}</Pie><Tooltip {...tip} /></PieChart></ResponsiveContainer></div>
        <div className="panel p-5 h-80"><div className="label mb-3">Bright Data requests by product (all time)</div>
          <ResponsiveContainer width="100%" height="88%"><BarChart data={d.prod}><CartesianGrid stroke="#1E2A38" vertical={false} /><XAxis dataKey="k" stroke="#8B98A9" fontSize={11} /><YAxis stroke="#8B98A9" fontSize={12} /><Tooltip {...tip} /><Bar dataKey="v" fill={C.web} radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
      </div>
      <div className="panel p-5"><div className="label mb-3">Call outcomes</div><div className="flex gap-3">{d.outcomes.length ? d.outcomes.map((o) => <Pill key={o.k} color={{ confirmed: C.safe, denied: C.block, unsure: C.review, no_answer: C.muted }[o.k]}>{o.k}: {o.v}</Pill>) : <span className="text-sm text-[#8B98A9]">No calls yet.</span>}</div></div>
    </div>
  );
}

const SUITES = [
  { k: "extraction", label: "Extraction" }, { k: "web_verify", label: "Web verification" }, { k: "lookalike", label: "Lookalike detection" },
  { k: "e2e", label: "End-to-end decisions" }, { k: "call", label: "Verify calls" }, { k: "safety", label: "Safety & grounding" },
];

export function Evals() {
  const { rows: runs } = useLive("EvalRun", null, "-created_date", 100, 8000);
  const [open, setOpen] = useState(null);
  const latest = useMemo(() => Object.fromEntries(SUITES.map((s) => [s.k, (runs ?? []).find((r) => r.suite === s.k)])), [runs]);
  const { rows: cases } = useLive("EvalCase", open ? { run_id: open } : { run_id: "__none__" }, "case_id", 500, 15000);
  const headline = (runs ?? []).find((r) => r.suite === "e2e")?.headline;
  return (
    <div className="max-w-[1600px] mx-auto space-y-5">
      <Title sub="We tested the crew on real vendors, impostor domains and scripted scenarios — results below are from real runs">Evals</Title>
      {headline && <motion.div {...fade} className="panel p-5 text-xl font-bold text-[#10B981] glow-emerald" style={{ boxShadow: "inset 0 0 0 1px rgba(16,185,129,.4)" }}>{headline}</motion.div>}
      {runs === null ? <Skeleton className="h-64" /> : (
        <div className="grid grid-cols-2 2xl:grid-cols-3 gap-4">{SUITES.map((s) => {
          const r = latest[s.k];
          return (
            <motion.button {...fade} key={s.k} onClick={() => r && setOpen(open === r.id ? null : r.id)} className={`panel p-5 text-left transition-colors ${open === r?.id ? "ring-2 ring-[#22D3EE]/60" : "hover:border-[#22D3EE]/40"}`}>
              <div className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-[#22D3EE]" /><span className="font-bold text-lg">{s.label}</span>
                <span className="ml-auto">{!r ? <Pill color={C.muted}>Not run</Pill> : r.passed ? <Pill color={C.safe}>Pass</Pill> : <Pill color={C.block}>Fail</Pill>}</span></div>
              {r ? (<>
                <div className="mt-3 space-y-1">{Object.entries(r.metrics ?? {}).slice(0, 6).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm"><span className="text-[#8B98A9]">{k.replace(/_/g, " ")}</span><span className="mono font-semibold">{typeof v === "number" ? (v <= 1 && !Number.isInteger(v) ? `${(v * 100).toFixed(0)}%` : v) : String(v)}</span></div>
                ))}</div>
                <div className="text-[11px] text-[#8B98A9] mt-3">Last run {ago(r.finished_at ?? r.created_date)}</div>
              </>) : <div className="text-sm text-[#8B98A9] mt-3">Run with <span className="mono">eval/run_eval.ts</span></div>}
            </motion.button>
          );
        })}</div>
      )}
      {open && (() => {
        const r = (runs ?? []).find((x) => x.id === open);
        const fails = (cases ?? []).filter((c) => !c.pass);
        return (
          <motion.div {...fade} className="grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] gap-5">
            <div className="panel p-5"><div className="label mb-3">Confusion matrix (expected → actual)</div>
              {r?.confusion ? (() => {
                const labels = [...new Set(Object.keys(r.confusion).concat(...Object.values(r.confusion).map((x) => Object.keys(x))))];
                return <table className="text-sm w-full"><thead><tr><th></th>{labels.map((l) => <th key={l} className="text-[10px] text-[#8B98A9] font-semibold p-1">{l}</th>)}</tr></thead>
                  <tbody>{labels.map((e) => <tr key={e}><td className="text-[10px] text-[#8B98A9] pr-2">{e}</td>{labels.map((a) => { const n = r.confusion?.[e]?.[a] ?? 0; return <td key={a} className="p-1 text-center"><span className={`inline-block w-9 py-1 rounded mono ${n ? (e === a ? "bg-[#10B981]/25 text-[#10B981]" : "bg-[#EF4444]/25 text-[#EF4444]") : "text-[#334155]"}`}>{n}</span></td>; })}</tr>)}</tbody></table>;
              })() : <div className="text-sm text-[#8B98A9]">No confusion matrix for this suite.</div>}
            </div>
            <div className="panel p-5"><div className="label mb-3">Failures ({fails.length} of {(cases ?? []).length})</div>
              {!fails.length ? <div className="text-[#10B981] flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Every case passed.</div> :
                <div className="space-y-2 max-h-[420px] overflow-auto">{fails.map((c) => (
                  <div key={c.id} className="raised p-3 text-sm"><div className="flex items-center gap-2"><XCircle className="h-4 w-4 text-[#EF4444]" /><span className="font-semibold">{c.case_id}</span></div>
                    <div className="text-[#8B98A9] mt-1">expected <span className="mono text-white">{JSON.stringify(c.expected)}</span> · got <span className="mono text-white">{JSON.stringify(c.actual)}</span></div>
                    {c.notes && <div className="text-xs text-[#C9D4E0] mt-1">{c.notes}</div>}</div>
                ))}</div>}
            </div>
          </motion.div>
        );
      })()}
    </div>
  );
}

export function SettingsPage() {
  const { company, setCompany, role, isDemo } = usePC();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (company) setF({ ...company }); }, [company]);
  if (!f) return <Skeleton className="h-96" />;
  const save = async () => {
    setBusy(true);
    try { const r = await invoke("updateSettings", { company_key: f.key, demo_role: role, patch: { name: f.name, approval_threshold: Number(f.approval_threshold), always_call_on_bank_change: f.always_call_on_bank_change, notification_email: f.notification_email, demo_mode: f.demo_mode, call_simulation: f.call_simulation, call_channel: f.call_channel } });
      if (r?.error) toast.error(r.error); else { setCompany(r.company); toast.success("Settings saved"); } }
    catch (e) { toast.error(e?.response?.data?.error ?? e?.message); } finally { setBusy(false); }
  };
  const Toggle = ({ k, label, hint }) => (
    <label className="flex items-start gap-3 raised p-4 cursor-pointer">
      <input type="checkbox" checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} className="mt-1 accent-[#10B981] h-4 w-4" disabled={role !== "owner"} />
      <div><div className="font-semibold">{label}</div><div className="text-sm text-[#8B98A9]">{hint}</div></div>
    </label>
  );
  return (
    <div className="max-w-[900px] mx-auto space-y-5">
      <Title sub={role === "owner" ? "Only the owner can change these" : "Read-only — switch to Owner to edit"}>Settings</Title>
      <div className="panel p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <label className="block"><div className="label mb-1">Company</div><input value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={role !== "owner"} className="w-full rounded-xl bg-[#070A0F] border border-[#1E2A38] px-3 py-2.5" /></label>
          <label className="block"><div className="label mb-1">Approval threshold (USD)</div><input type="number" value={f.approval_threshold ?? 5000} onChange={(e) => setF({ ...f, approval_threshold: e.target.value })} disabled={role !== "owner"} className="w-full rounded-xl bg-[#070A0F] border border-[#1E2A38] px-3 py-2.5 mono" /></label>
          <label className="block col-span-2"><div className="label mb-1">Notification email</div><input value={f.notification_email ?? ""} onChange={(e) => setF({ ...f, notification_email: e.target.value })} disabled={role !== "owner"} placeholder="owner@yourcompany.com" className="w-full rounded-xl bg-[#070A0F] border border-[#1E2A38] px-3 py-2.5" /></label>
        </div>
        <Toggle k="always_call_on_bank_change" label="Always call when bank details change" hint="Even if the vendor checks out on the web — mailbox takeovers come from the vendor's real domain." />
        <label className="block raised p-4">
          <div className="font-semibold">Verify call channel</div>
          <div className="text-sm text-[#8B98A9] mb-2">Browser: the call rings inside PayCrew and you answer as the vendor (Vapi web call). Phone: Vapi dials out through your Vapi phone number.</div>
          <select value={f.call_channel ?? "web"} onChange={(e) => setF({ ...f, call_channel: e.target.value })} disabled={role !== "owner"} className="rounded-xl bg-[#070A0F] border border-[#1E2A38] px-3 py-2">
            <option value="web">Browser call (Vapi web)</option><option value="phone">Phone call (Vapi + Twilio number)</option>
          </select>
        </label>
        <Toggle k="call_simulation" label="Call simulation" hint="Stream a pre-recorded vendor transcript instead of placing a real Vapi call (demo safety if the phone network fails)." />
        {isDemo && <Toggle k="demo_mode" label="Demo mode" hint="Real calls ring the teammate's demo phone; the UI still shows the vendor's verified number." />}
        <button onClick={save} disabled={role !== "owner" || busy} className="flex items-center gap-2 rounded-xl px-5 py-2.5 font-bold text-[#070A0F] bg-[#10B981] disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save</button>
      </div>
    </div>
  );
}
