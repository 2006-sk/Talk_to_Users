// Landing (/) — live headline stats + how the crew works → Open Mission Control.
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ShieldCheck, ArrowRight, Play, Radar, Phone, Globe, FileSearch, BookOpen, Fingerprint, Tag, Scale, Route as RouteIcon, Loader2, Download, FileText } from "lucide-react";
import { useLive, money, C, FOOTER } from "@/lib/pc";
import { CountUp } from "@/components/pc/ui";
import { usePC, invoke, startCrew } from "@/components/pc/Shell";
import { toast } from "sonner";
import { IncomingCall } from "@/components/pc/IncomingCall";
import { useState } from "react";

const CREW = [
  { k: "Intake", d: "Reads the bill — bill text is data, never instructions", icon: FileSearch },
  { k: "Ledger", d: "Duplicates, PO match, amount vs history", icon: BookOpen },
  { k: "Web Verifier", d: "Bright Data: search, Maps, Trustpilot, LinkedIn, Crunchbase", icon: Globe, web: true },
  { k: "Identity", d: "Lookalike domains, homoglyphs, near-copy names", icon: Fingerprint },
  { k: "Price", d: "Line items vs Amazon market prices", icon: Tag, web: true },
  { k: "Risk Judge", d: "Trust Score with every signal linked to its source", icon: Scale },
  { k: "Call", d: "Calls the vendor's verified number — never the one on the bill", icon: Phone, call: true },
  { k: "Router", d: "Approve, review or block — humans pay, BillProof never does", icon: RouteIcon },
];

const SAMPLES = [
  ["1-CLEAN-Staples-should-approve", "1 · Clean — Staples (should approve)", C.safe],
  ["2-PRICE-Uline-3.5x-market-needs-review", "2 · Price padding — Uline 3.5× market", C.review],
  ["3-BANK-CHANGED-Grainger-calls-then-blocks", "3 · Bank changed — Grainger (calls you)", C.block],
  ["4-IMPOSTOR-Grainqer-FICTIONAL-calls-then-blocks", "4 · Impostor — Grainqer (calls you)", C.block],
];

export default function Landing() {
  const { companyKey, isDemo, role } = usePC();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const { rows: inv } = useLive("Invoice", { company_id: companyKey }, "-created_date", 300, 6000);
  const { rows: usage } = useLive("BrightDataUsage", null, "-created_date", 300, 10000);
  const { rows: calls } = useLive("VerifyCall", { company_id: companyKey }, "-created_date", 100, 8000);
  const { rows: evals } = useLive("EvalRun", null, "-created_date", 50, 15000);
  const s = useMemo(() => {
    const bills = (inv ?? []).filter((b) => b.seq !== 0);
    return {
      checked: bills.filter((b) => !["received", "running"].includes(b.status)).length,
      protectedAmt: bills.filter((b) => ["blocked", "needs_review", "needs_call", "calling"].includes(b.status) && b.decision !== "owner_approval").reduce((t, b) => t + (b.amount ?? 0), 0),
      blocked: bills.filter((b) => b.status === "blocked").length,
      cleared: bills.filter((b) => b.status === "approved").length,
      requests: (usage ?? []).filter((u) => u.product !== "archive.org").reduce((t, u) => t + (u.requests ?? 0) + (u.cache_hits ?? 0), 0),
      calls: (calls ?? []).length,
      headline: (evals ?? []).find((e) => e.suite === "e2e")?.headline ?? (evals ?? []).find((e) => e.headline)?.headline,
    };
  }, [inv, usage, calls, evals]);

  const runDemo = async () => {
    setBusy(true);
    try {
      const r = await invoke("runDemo", {});
      const bills = (r?.bills ?? []).sort((a, b) => a.seq - b.seq);
      startCrew(bills.map((b) => b.id));
      toast.success(`Demo started — ${bills.length} bills entering the crew`);
      nav("/mission");
    } catch (e) { toast.error(`Couldn't start demo: ${e?.message ?? e}`); setBusy(false); }
  };

  const stats = [
    { label: "Money protected", v: s.protectedAmt, fmt: (v) => money(Math.round(v)), color: C.safe, glow: true },
    { label: "Bills checked", v: s.checked, color: C.text },
    { label: "High risk — blocked", v: s.blocked, color: C.block },
    { label: "Auto-cleared", v: s.cleared, color: C.safe },
    { label: "Verify calls", v: s.calls, color: C.calling },
    { label: "Bright Data lookups", v: s.requests, color: C.web },
  ];

  return (
    <div className="min-h-screen bg-[#070A0F] text-[#E6EDF3] grid-bg overflow-x-hidden">
      <IncomingCall />
      <div className="absolute inset-x-0 top-0 h-[520px] pointer-events-none" style={{ background: "radial-gradient(60% 60% at 50% 0%, rgba(16,185,129,.16), transparent 70%)" }} />
      <header className="relative max-w-[1400px] mx-auto px-8 py-6 flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-[#10B981]/15 ring-1 ring-[#10B981]/50 flex items-center justify-center"><ShieldCheck className="h-5 w-5 text-[#10B981]" /></div>
        <span className="font-extrabold text-xl tracking-tight">BillProof</span>
        <div className="flex-1" />
        <Link to="/evals" className="text-sm text-[#8B98A9] hover:text-white px-3">Evals</Link>
        <Link to="/mission" className="text-sm font-semibold rounded-xl px-4 py-2 raised hover:border-[#22D3EE]/60">Mission Control</Link>
      </header>

      <main className="relative max-w-[1400px] mx-auto px-8">
        <section className="pt-10 pb-12 text-center">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-[#22D3EE] ring-1 ring-[#22D3EE]/40 bg-[#22D3EE]/10 mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-[#22D3EE] pc-pulse" />An AI accounts-payable crew for one-person finance teams
          </motion.div>
          <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.05 }} className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.05]">
            Every bill checked.<br /><span className="text-[#10B981] glow-emerald">Nothing paid blind.</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15, duration: 0.3 }} className="mt-6 text-lg md:text-xl text-[#8B98A9] max-w-3xl mx-auto">
            Eight agents check each bill against your records and the real web, give it a Trust Score where every signal links to its source,
            and call the vendor's <span className="text-white">independently verified</span> number when something looks wrong. Humans approve. BillProof never sends payments.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.3 }} className="mt-10 flex flex-wrap justify-center gap-4">
            <Link to="/mission" className="group flex items-center gap-3 rounded-2xl px-8 py-4 text-lg font-bold text-[#070A0F] bg-[#10B981] hover:bg-[#34D399] transition-colors shadow-[0_0_40px_rgba(16,185,129,.4)]">
              <Radar className="h-5 w-5" />Open Mission Control<ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            {isDemo && role !== "viewer" && (
              <button onClick={runDemo} disabled={busy} className="flex items-center gap-3 rounded-2xl px-8 py-4 text-lg font-bold raised hover:border-[#22D3EE]/60 disabled:opacity-60">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5 text-[#22D3EE]" />}Run the 10-bill demo
              </button>
            )}
          </motion.div>
        </section>

        <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          {stats.map((x, i) => (
            <motion.div key={x.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.04, duration: 0.25 }}
              className="panel p-5" style={x.glow ? { boxShadow: "inset 0 0 0 1px rgba(16,185,129,.35), 0 0 40px rgba(16,185,129,.12)" } : undefined}>
              <div className="label" style={x.glow ? { color: C.safe } : undefined}>{x.label}</div>
              <div className={`text-4xl font-extrabold tabular-nums mt-2 truncate ${x.glow ? "glow-emerald" : ""}`} style={{ color: x.color }}>{inv === null ? "—" : <CountUp value={x.v} format={x.fmt} />}</div>
            </motion.div>
          ))}
        </section>
        {s.headline && <div className="mt-4 panel px-5 py-3 text-center text-[#10B981] font-semibold">{s.headline}</div>}

        <section className="mt-16">
          <div className="label text-center mb-6">The crew — every bill passes all eight</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {CREW.map((a, i) => (
              <motion.div key={a.k} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.04, duration: 0.25 }} className="panel p-5">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: `${a.call ? C.calling : a.web ? C.web : C.running}1F`, boxShadow: `inset 0 0 0 1px ${a.call ? C.calling : a.web ? C.web : C.running}55` }}>
                    <a.icon className="h-4 w-4" style={{ color: a.call ? C.calling : a.web ? C.web : C.running }} />
                  </div>
                  <div className="font-bold">{i + 1}. {a.k}</div>
                </div>
                <div className="text-sm text-[#8B98A9] mt-3">{a.d}</div>
              </motion.div>
            ))}
          </div>
        </section>

        <section className="mt-16 mb-16 grid md:grid-cols-3 gap-4">
          {[
            ["Grounded", "Every number on screen is an evidence row with a source link and fetch time. Missing means “Not found” — nothing is invented."],
            ["Safe calls", "The voice agent says it's automated, mentions only the last 4 digits, and never accepts bank changes by phone."],
            ["Human in charge", "Above-threshold or high-risk bills need the owner. BillProof marks bills ready to pay — it never pays."],
          ].map(([t, d]) => (
            <div key={t} className="panel p-6"><div className="font-bold text-lg">{t}</div><div className="text-sm text-[#8B98A9] mt-2">{d}</div></div>
          ))}
        </section>

        <section className="mb-16 panel p-6">
          <div className="flex items-center gap-2 mb-1"><Download className="h-4 w-4 text-[#22D3EE]" /><span className="font-bold text-lg">Sample bills to upload</span></div>
          <div className="text-sm text-[#8B98A9] mb-4">Download any of these and drag it onto “Upload bills” in Mission Control. Real-vendor samples are demo documents, not issued by those companies; the two impostors are fictional.</div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2">
            {SAMPLES.map(([f, label, color]) => (
              <a key={f} href={`/sample-invoices/${f}.pdf`} download className="raised px-3 py-2.5 text-sm hover:border-[#22D3EE]/60 flex items-center gap-2">
                <FileText className="h-4 w-4 shrink-0" style={{ color }} /><span className="truncate">{label}</span>
              </a>
            ))}
          </div>
        </section>

        <div className="text-center pb-16">
          <Link to="/mission" className="inline-flex items-center gap-2 text-[#22D3EE] font-semibold hover:underline">Go to Mission Control <ArrowRight className="h-4 w-4" /></Link>
          <div className="text-xs text-[#8B98A9] mt-6">Powered by Bright Data (web evidence) · Vapi (verify calls) · Base44 (app, data, agents)</div>
        </div>
      </main>
      <footer className="border-t border-[#1E2A38] px-8 py-3 text-xs text-[#8B98A9] flex items-center justify-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-[#10B981]" />{FOOTER}</footer>
    </div>
  );
}
