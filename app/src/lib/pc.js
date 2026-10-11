// BillProof shared frontend helpers: tokens, formatters, live entity hooks.
import { useEffect, useRef, useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";

export const C = {
  bg: "#070A0F", panel: "#0E141C", raised: "#131B26", border: "#1E2A38", text: "#E6EDF3", muted: "#8B98A9",
  safe: "#10B981", review: "#F59E0B", block: "#EF4444", running: "#22D3EE", calling: "#A78BFA", web: "#3B82F6",
};

export const AGENTS = [
  { key: "intake", label: "Intake", short: "Reads the bill" },
  { key: "ledger", label: "Ledger", short: "Your records" },
  { key: "web_verifier", label: "Web Verifier", short: "Bright Data" },
  { key: "identity_matcher", label: "Identity", short: "Domain · phone" },
  { key: "price_checker", label: "Price", short: "Market price" },
  { key: "risk_judge", label: "Risk Judge", short: "Trust score" },
  { key: "call_agent", label: "Call", short: "Verify by phone" },
  { key: "router", label: "Router", short: "Decision" },
];

export const SOURCES = ["Web search", "Company website", "Crunchbase", "Trustpilot", "Google Maps", "LinkedIn", "Indeed", "Amazon", "Walmart"];

export const STATUS = {
  received: { label: "Received", color: C.muted },
  running: { label: "Checking", color: C.running },
  needs_call: { label: "Needs call", color: C.calling },
  calling: { label: "Calling vendor", color: C.calling },
  needs_review: { label: "Needs review", color: C.review },
  approved: { label: "Ready to pay", color: C.safe },
  blocked: { label: "High risk — blocked for review", short: "Blocked", color: C.block },
  rejected: { label: "Rejected", color: C.block },
};

export const CONF = {
  high: { label: "High", color: C.safe },
  medium: { label: "Medium", color: "#34D399" },
  low: { label: "Low", color: C.review },
  very_low: { label: "Very low", color: C.block },
};

export const RISK = {
  low: { label: "Low risk", color: C.safe },
  medium: { label: "Medium risk", color: C.review },
  high: { label: "High risk", color: "#F97316" },
  critical: { label: "Critical risk", color: C.block },
};

export const money = (n, cur = "USD") =>
  n == null || isNaN(n) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);

export const ago = (d) => {
  if (!d) return "—";
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(d).toLocaleDateString();
};

export const secs = (a, b) => (a && b ? ((new Date(b) - new Date(a)) / 1000).toFixed(1) + "s" : "");

export const confColor = (c) => CONF[c]?.color ?? C.muted;
export const scoreColor = (s) => (s == null ? C.muted : s >= 70 ? C.safe : s >= 40 ? C.review : C.block);

/**
 * Live list of an entity. Uses realtime subscribe when the SDK has it, and always polls as a fallback (§Phase 2: 1.5 s).
 * filter = plain object query; sort = "-created_date"; limit = number.
 */
export function useLive(entity, filter = null, sort = "-created_date", limit = 200, pollMs = 1500) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const key = JSON.stringify(filter);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const E = base44.entities[entity];
      const data = filter ? await E.filter(filter, sort, limit) : await E.list(sort, limit);
      if (alive.current) { setRows(data ?? []); setError(null); }
    } catch (e) {
      if (alive.current) setError(e);
    }
  }, [entity, key, sort, limit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    alive.current = true;
    load();
    let unsub = null, timer = null, live = false;
    // realtime events arrive in bursts while the crew writes — coalesce them into one refetch
    const kick = () => { clearTimeout(timer); timer = setTimeout(load, 350); };
    try {
      const E = base44.entities[entity];
      if (typeof E.subscribe === "function") { unsub = E.subscribe(kick); live = true; }
    } catch { /* realtime unavailable — polling covers it */ }
    // with realtime, poll only as a slow safety net; without it, poll at pollMs
    const t = setInterval(load, live ? Math.max(pollMs * 6, 10000) : pollMs);
    return () => { alive.current = false; clearInterval(t); clearTimeout(timer); try { typeof unsub === "function" && unsub(); } catch { /* ignore */ } };
  }, [load, entity, pollMs]);

  return { rows, error, reload: load, loading: rows === null && !error };
}

export function useOne(entity, id, pollMs = 1500) {
  const { rows, ...rest } = useLive(entity, id ? { id } : { id: "__none__" }, "-created_date", 1, pollMs);
  return { row: rows?.[0] ?? null, ...rest };
}

export async function audit(company_id, invoice_id, actor, action, detail) {
  try { await base44.entities.AuditLog.create({ company_id, invoice_id, actor, action, detail }); } catch { /* non-blocking */ }
}

export const FOOTER = "BillProof never sends payments. Every signal links to its source. A low score means check before paying, not an accusation.";
