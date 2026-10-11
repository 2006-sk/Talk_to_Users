// App shell: sidebar + top bar (company, upload, run demo, role) + footer on every page.
import { createContext, useContext, useEffect, useState, useRef } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Radar, FileStack, Building2, CheckSquare, ScrollText, BarChart3, FlaskConical, Settings, Upload, Play, ShieldCheck, Loader2, ChevronDown } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { FOOTER, C } from "@/lib/pc";
import { toast } from "sonner";
import { IncomingCall } from "@/components/pc/IncomingCall";

const Ctx = createContext(null);
export const usePC = () => useContext(Ctx);

export function PCProvider({ children }) {
  const { user } = useAuth();
  const companyKey = user?.company_id || "demo";
  const isDemo = companyKey === "demo";
  const [demoRole, setDemoRole] = useState(() => { try { return localStorage.getItem("pc_role") || "owner"; } catch { return "owner"; } });
  useEffect(() => { try { localStorage.setItem("pc_role", demoRole); } catch { /* ignore */ } }, [demoRole]);
  const role = isDemo ? demoRole : user?.app_role || "viewer";
  const [company, setCompany] = useState(null);
  useEffect(() => {
    base44.entities.Company.filter({ key: companyKey }, "-created_date", 1).then((r) => setCompany(r?.[0] ?? null)).catch(() => setCompany(null));
  }, [companyKey]);
  return <Ctx.Provider value={{ companyKey, isDemo, role, setDemoRole, company, setCompany, user }}>{children}</Ctx.Provider>;
}

const NAV = [
  { to: "/mission", label: "Mission Control", icon: Radar, end: true },
  { to: "/bills", label: "Bills", icon: FileStack },
  { to: "/vendors", label: "Vendors", icon: Building2 },
  { to: "/approvals", label: "Approvals", icon: CheckSquare },
  { to: "/audit", label: "Audit log", icon: ScrollText },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/evals", label: "Evals", icon: FlaskConical },
  { to: "/settings", label: "Settings", icon: Settings },
];

export async function invoke(name, payload) {
  const r = await base44.functions.invoke(name, payload);
  return r?.data ?? r;
}

/** Each crew runs inside its own request (the platform stops background work after a response), so the browser starts them. */
export function startCrew(ids, { gapMs = 3500, pace = true } = {}) {
  ids.forEach((id, i) => setTimeout(() => {
    invoke("runCrew", { invoice_id: id, pace }).catch((e) => toast.error(`Crew failed on a bill: ${e?.message ?? e}`));
  }, i * gapMs));
}

function UploadButton() {
  const { companyKey, role } = usePC();
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const onFiles = async (files) => {
    if (!files?.length) return;
    if (role === "viewer") return toast.error("Viewers can't upload bills");
    setBusy(true);
    try {
      let last = null;
      for (const f of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file: f });
        const r = await invoke("ingestBill", { company_key: companyKey, file_url, file_name: f.name, demo_role: role });
        if (r?.error) throw new Error(r.error);
        last = r?.invoice_id;
        startCrew([last], { pace: false });
      }
      toast.success(`${files.length} bill${files.length > 1 ? "s" : ""} sent to the crew`);
      if (last && files.length === 1) nav(`/bill/${last}`);
    } catch (e) {
      toast.error(`Upload failed: ${e?.message ?? e}`);
    } finally { setBusy(false); }
  };
  return (
    <>
      <input ref={ref} type="file" accept="application/pdf,image/*" multiple className="hidden" onChange={(e) => onFiles([...e.target.files])} />
      <button onClick={() => ref.current?.click()} disabled={busy}
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFiles([...e.dataTransfer.files]); }}
        className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold border border-[#1E2A38] bg-[#131B26] hover:border-[#22D3EE]/60 transition-colors">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload bills
      </button>
    </>
  );
}

function RunDemoButton() {
  const { isDemo, role } = usePC();
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  if (!isDemo) return null;
  return (
    <button disabled={busy || role === "viewer"} onClick={async () => {
      setBusy(true);
      try {
        const r = await invoke("runDemo", {});
        const bills = (r?.bills ?? []).sort((a, b) => a.seq - b.seq);
        startCrew(bills.map((b) => b.id));
        toast.success(`Demo started — ${bills.length} bills entering the crew`); nav("/mission");
      }
      catch (e) { toast.error(`Couldn't start demo: ${e?.message ?? e}`); }
      finally { setTimeout(() => setBusy(false), 8000); }
    }} className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-[#070A0F] bg-[#10B981] hover:bg-[#34D399] disabled:opacity-60 transition-colors shadow-[0_0_24px_rgba(16,185,129,.35)]">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Run demo
    </button>
  );
}

function RoleSwitch() {
  const { isDemo, role, setDemoRole, user } = usePC();
  const [open, setOpen] = useState(false);
  const label = { owner: "Owner", bookkeeper: "Bookkeeper", viewer: "Viewer" }[role];
  return (
    <div className="relative">
      <button onClick={() => isDemo && setOpen((o) => !o)} className="flex items-center gap-2 rounded-xl px-3 py-2 raised text-sm">
        <span className="h-7 w-7 rounded-full bg-gradient-to-br from-[#22D3EE] to-[#A78BFA] flex items-center justify-center text-xs font-bold text-[#070A0F]">{(user?.full_name || label)[0]}</span>
        <span className="text-left leading-tight"><span className="block font-semibold">{user?.full_name || "Demo user"}</span><span className="block text-[11px] text-[#8B98A9]">{label}{isDemo ? " · demo" : ""}</span></span>
        {isDemo && <ChevronDown className="h-4 w-4 text-[#8B98A9]" />}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-56 raised p-1 z-50 shadow-2xl">
          <div className="label px-3 py-2">View as (demo)</div>
          {["owner", "bookkeeper", "viewer"].map((r) => (
            <button key={r} onClick={() => { setDemoRole(r); setOpen(false); }} className={`w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-[#1E2A38] ${r === role ? "text-[#10B981]" : ""}`}>
              {{ owner: "Owner / approver", bookkeeper: "Bookkeeper", viewer: "Viewer (read-only)" }[r]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Shell({ children }) {
  const { company } = usePC();
  return (
    <div className="min-h-screen flex bg-[#070A0F] text-[#E6EDF3]">
      <aside className="w-[232px] shrink-0 border-r border-[#1E2A38] bg-[#0A0F16] flex flex-col sticky top-0 h-screen">
        <NavLink to="/" className="px-5 py-5 flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-[#10B981]/15 ring-1 ring-[#10B981]/50 flex items-center justify-center"><ShieldCheck className="h-5 w-5 text-[#10B981]" /></div>
          <div><div className="font-extrabold text-lg tracking-tight">BillProof</div><div className="text-[11px] text-[#8B98A9] -mt-0.5">AP crew · checks every bill</div></div>
        </NavLink>
        <nav className="px-3 space-y-1 flex-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isActive ? "bg-[#131B26] text-white ring-1 ring-[#1E2A38]" : "text-[#8B98A9] hover:text-white hover:bg-[#0E141C]"}`}>
              {({ isActive }) => (<><Icon className="h-[18px] w-[18px]" style={{ color: isActive ? C.running : undefined }} />{label}</>)}
            </NavLink>
          ))}
        </nav>
        <div className="m-3 p-3 raised text-[11px] text-[#8B98A9] leading-relaxed">
          <div className="font-semibold text-[#E6EDF3] mb-1">Never pays</div>
          BillProof only marks bills ready for a human to pay in your bank.
        </div>
      </aside>
      <IncomingCall />
      <div className="flex-1 min-w-0 flex flex-col overflow-x-hidden">
        <header className="h-[72px] shrink-0 border-b border-[#1E2A38] flex items-center gap-4 px-8 bg-[#070A0F]/80 backdrop-blur sticky top-0 z-40">
          <div className="raised px-3 py-2 text-sm flex items-center gap-2"><Building2 className="h-4 w-4 text-[#8B98A9]" />{company?.name ?? "Acme Robotics (demo)"}</div>
          <div className="flex-1" />
          <UploadButton />
          <RunDemoButton />
          <RoleSwitch />
        </header>
        <motion.main key={typeof window !== "undefined" ? window.location.pathname : ""} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="flex-1 px-8 py-6 grid-bg">
          {children}
        </motion.main>
        <footer className="border-t border-[#1E2A38] px-8 py-3 text-xs text-[#8B98A9] flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-[#10B981]" />{FOOTER}
        </footer>
      </div>
    </div>
  );
}
