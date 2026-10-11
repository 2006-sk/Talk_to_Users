// PayCrew design-system components (§Phase 1).
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, animate } from "framer-motion";
import { ExternalLink, Check, X, Minus, Loader2 } from "lucide-react";
import { C, AGENTS, CONF, RISK, STATUS, SOURCES, confColor, scoreColor } from "@/lib/pc";

export const fade = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.25, ease: "easeOut" } };

export function CountUp({ value = 0, format = (v) => Math.round(v).toLocaleString(), className = "", duration = 1.1 }) {
  const [v, setV] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const c = animate(prev.current, value || 0, { duration, ease: "easeOut", onUpdate: setV });
    prev.current = value || 0;
    return () => c.stop();
  }, [value, duration]);
  return <span className={className}>{format(v)}</span>;
}

export function Pill({ color, children, className = "", pulse = false }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}
      style={{ color, background: `${color}1A`, boxShadow: `inset 0 0 0 1px ${color}40` }}>
      <span className={`h-1.5 w-1.5 rounded-full ${pulse ? "pc-pulse" : ""}`} style={{ background: color }} />
      {children}
    </span>
  );
}

export const ConfidencePill = ({ value, prefix = "Web confidence" }) =>
  value ? <Pill color={confColor(value)}>{prefix}: {CONF[value]?.label}</Pill> : <Pill color={C.muted}>{prefix}: pending</Pill>;

export const RiskBadge = ({ value }) => (value ? <Pill color={RISK[value]?.color}>{RISK[value]?.label}</Pill> : null);

export const StatusChip = ({ value, short = false }) => {
  const s = STATUS[value] ?? STATUS.received;
  return <Pill color={s.color} pulse={["running", "calling"].includes(value)}>{short ? s.short ?? s.label : s.label}</Pill>;
};

export function TrustGauge({ score, size = 220, label = "Trust Score" }) {
  const r = size / 2 - 16, circ = Math.PI * r; // half circle
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const color = scoreColor(score);
  return (
    <div className="relative flex flex-col items-center" style={{ width: size, height: size * 0.62 }}>
      <svg width={size} height={size * 0.62} viewBox={`0 0 ${size} ${size * 0.62}`}>
        <path d={`M16 ${size / 2} A ${r} ${r} 0 0 1 ${size - 16} ${size / 2}`} fill="none" stroke={C.border} strokeWidth="14" strokeLinecap="round" />
        <motion.path d={`M16 ${size / 2} A ${r} ${r} 0 0 1 ${size - 16} ${size / 2}`} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round"
          strokeDasharray={circ} initial={{ strokeDashoffset: circ }} animate={{ strokeDashoffset: circ * (1 - pct) }} transition={{ duration: 1.2, ease: "easeOut" }}
          style={{ filter: `drop-shadow(0 0 10px ${color}80)` }} />
      </svg>
      <div className="absolute bottom-0 flex flex-col items-center">
        <span className="text-6xl font-extrabold tabular-nums" style={{ color }}>{score == null ? "—" : <CountUp value={score} />}</span>
        <span className="label mt-1">{label}</span>
      </div>
    </div>
  );
}

export function ScoreRing({ score, size = 64 }) {
  const r = size / 2 - 5, circ = 2 * Math.PI * r, color = scoreColor(score);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke={C.border} strokeWidth="5" fill="none" />
        <motion.circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="5" fill="none" strokeLinecap="round" strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }} animate={{ strokeDashoffset: circ * (1 - (score ?? 0) / 100) }} transition={{ duration: 1 }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-bold tabular-nums" style={{ color }}>{score ?? "—"}</span>
    </div>
  );
}

const nodeColor = (run) => {
  if (!run) return C.border;
  if (run.status === "running") return run.agent === "call_agent" ? C.calling : C.running;
  if (run.status === "error") return C.block;
  if (run.status === "skipped") return "#334155";
  if (run.verdict === "info") return run.agent === "call_agent" ? C.calling : C.web; // ran, nothing to flag (e.g. services-only price check)
  return run.verdict === "fail" ? C.block : run.verdict === "warn" ? C.review : C.safe;
};

/** 8-node horizontal pipeline. runs = AgentRun[] for one invoice. */
export function AgentPipeline({ runs = [], compact = false }) {
  const by = Object.fromEntries(runs.map((r) => [r.agent, r]));
  return (
    <div className="flex items-center w-full">
      {AGENTS.map((a, i) => {
        const run = by[a.key], col = nodeColor(run), live = run?.status === "running";
        const nextRun = by[AGENTS[i + 1]?.key];
        return (
          <div key={a.key} className="flex items-center flex-1 last:flex-none min-w-0">
            <div className="flex flex-col items-center gap-1 min-w-0">
              <motion.div className={`relative rounded-full flex items-center justify-center ${compact ? "h-6 w-6" : "h-9 w-9"}`}
                animate={{ backgroundColor: `${col}22`, boxShadow: `0 0 0 2px ${col}, 0 0 ${live ? 18 : 0}px ${col}` }} transition={{ duration: 0.3 }}>
                {live ? <Loader2 className={`${compact ? "h-3 w-3" : "h-4 w-4"} animate-spin`} style={{ color: col }} />
                  : run?.status === "done" && run.verdict === "info" ? <span className="text-[11px] font-bold" style={{ color: col }}>i</span>
                  : run?.status === "done" ? (run.verdict === "fail" ? <X className="h-3.5 w-3.5" style={{ color: col }} /> : run.verdict === "warn" ? <span className="text-xs font-bold" style={{ color: col }}>!</span> : <Check className="h-3.5 w-3.5" style={{ color: col }} />)
                  : run?.status === "skipped" ? <Minus className="h-3 w-3 text-slate-500" /> : <span className="h-1.5 w-1.5 rounded-full" style={{ background: C.border }} />}
              </motion.div>
              {!compact && <span className="text-[11px] font-medium truncate" style={{ color: run ? C.text : C.muted }}>{a.label}</span>}
            </div>
            {i < AGENTS.length - 1 && (
              <svg className={`flex-1 mx-1 ${compact ? "" : "-mt-5"}`} height="4" preserveAspectRatio="none" viewBox="0 0 100 4">
                <line x1="0" y1="2" x2="100" y2="2" stroke={run?.status === "done" ? nodeColor(run) : C.border} strokeWidth="2" opacity={run?.status === "done" ? 0.7 : 1}
                  className={run?.status === "done" && (!nextRun || nextRun.status === "running") ? "pc-flow" : ""} />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}

const MATCH = {
  match: { icon: Check, color: C.safe, text: "Match" },
  mismatch: { icon: X, color: C.review, text: "Mismatch" },
  not_found: { icon: Minus, color: C.muted, text: "Not found" },
  pending: { icon: Loader2, color: C.running, text: "Checking" },
  "n/a": { icon: Minus, color: C.muted, text: "n/a" },
};

export function EvidenceRow({ ev, highlight = false, onHover }) {
  const m = MATCH[ev.match] ?? MATCH["n/a"];
  const Icon = m.icon;
  return (
    <motion.div {...fade} onMouseEnter={() => onHover?.(ev)} onMouseLeave={() => onHover?.(null)} id={`ev-${ev.id}`}
      className={`raised px-3 py-2.5 flex items-start gap-3 transition-colors ${highlight ? "ring-2 ring-cyan-400/60" : ""}`}>
      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${ev.match === "pending" ? "animate-spin" : ""}`} style={{ color: m.color }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold" style={{ color: ev.group === "call" ? C.calling : ev.group === "ledger" ? C.text : C.web }}>{ev.source_name}</span>
          <span className="text-[#8B98A9]">·</span>
          <span className="text-[#E6EDF3] truncate">{ev.label}</span>
        </div>
        <div className="mono text-[13px] text-[#E6EDF3] mt-0.5 break-words">{ev.value || "Not found"}
          {ev.expected_value ? <span className="text-[#8B98A9]"> vs {ev.expected_value}</span> : null}</div>
        {ev.quote && <div className="text-xs text-[#8B98A9] mt-1 italic line-clamp-2">“{ev.quote}”</div>}
        <div className="flex items-center gap-3 mt-1 text-[11px] text-[#8B98A9]">
          {ev.source_url && <a href={ev.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-[#3B82F6]"><ExternalLink className="h-3 w-3" />source</a>}
          {ev.fetched_at && <span>fetched {new Date(ev.fetched_at).toLocaleString()}</span>}
          <span className="mono opacity-60">ev:{ev.id?.slice(-6)}</span>
        </div>
      </div>
    </motion.div>
  );
}

/** Letter-by-letter domain diff (grainqer vs grainger). */
export function LookalikeDiff({ sender, official, positions = [] }) {
  if (!sender || !official) return null;
  const pos = new Set(positions);
  return (
    <div className="raised p-4 space-y-2">
      <div className="label">Sender domain vs official domain</div>
      <div className="mono text-2xl tracking-[0.18em] flex flex-wrap">
        {[...sender].map((ch, i) => (
          <motion.span key={i} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
            style={pos.has(i) ? { color: C.block, textShadow: `0 0 14px ${C.block}`, background: `${C.block}22`, borderRadius: 4 } : { color: C.text }}>{ch}</motion.span>
        ))}
      </div>
      <div className="mono text-2xl tracking-[0.18em] text-[#10B981]">{official}</div>
      <div className="text-xs text-[#8B98A9]">Red letters differ from the vendor's real domain.</div>
    </div>
  );
}

/** Radar sweep with one blip per Bright Data source. status: {source: match|mismatch|not_found|pending} */
export function RadarSweep({ status = {}, active = false, size = 300 }) {
  const R = size / 2;
  const colorOf = (s) => (s === "match" ? C.safe : s === "mismatch" ? C.review : s === "not_found" ? "#475569" : s === "pending" ? C.running : "transparent");
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        {[1, 0.72, 0.44, 0.18].map((k) => <circle key={k} cx={R} cy={R} r={R * k - 2} fill="none" stroke={C.border} />)}
        <line x1={R} y1="0" x2={R} y2={size} stroke={C.border} /><line x1="0" y1={R} x2={size} y2={R} stroke={C.border} />
        {active && (
          <g className="pc-sweep">
            <defs><linearGradient id="sw" x1="0" x2="1"><stop offset="0" stopColor={C.web} stopOpacity="0" /><stop offset="1" stopColor={C.web} stopOpacity=".45" /></linearGradient></defs>
            <path d={`M${R} ${R} L${R} 2 A ${R - 2} ${R - 2} 0 0 1 ${R + (R - 2) * Math.sin(Math.PI / 4)} ${R - (R - 2) * Math.cos(Math.PI / 4)} Z`} fill="url(#sw)" />
          </g>
        )}
        {SOURCES.map((s, i) => {
          const a = (i / SOURCES.length) * 2 * Math.PI - Math.PI / 2, rr = R * (0.5 + 0.35 * ((i % 3) / 2));
          const x = R + rr * Math.cos(a), y = R + rr * Math.sin(a), st = status[s];
          return (
            <g key={s}>
              <AnimatePresence>{st && (
                <motion.circle cx={x} cy={y} initial={{ r: 0, opacity: 0 }} animate={{ r: 7, opacity: 1 }} exit={{ opacity: 0 }} fill={colorOf(st)}
                  style={{ filter: `drop-shadow(0 0 8px ${colorOf(st)})` }} className={st === "pending" ? "pc-pulse" : ""} />
              )}</AnimatePresence>
              <text x={x} y={y + 20} textAnchor="middle" fontSize="10" fill={st ? C.text : "#475569"} fontFamily="Inter">{s}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function ActivityTicker({ items = [] }) {
  if (!items.length) return <div className="h-10 flex items-center px-4 text-sm text-[#8B98A9]">Waiting for bills…</div>;
  const row = [...items, ...items];
  return (
    <div className="h-10 overflow-hidden relative">
      <div className="pc-ticker flex gap-10 whitespace-nowrap absolute top-0 h-10 items-center">
        {row.map((t, i) => <span key={i} className="text-sm" style={{ color: t.color ?? C.text }}>{t.text}</span>)}
      </div>
    </div>
  );
}

export function Waveform({ active, bars = 48, color = C.calling }) {
  return (
    <div className="flex items-center justify-center gap-[3px] h-24">
      {Array.from({ length: bars }).map((_, i) => (
        <motion.span key={i} className="w-[5px] rounded-full" style={{ background: color }}
          animate={active ? { height: [8, 20 + ((i * 37) % 60), 10, 30 + ((i * 53) % 50), 8] } : { height: 6 }}
          transition={active ? { duration: 1.1 + (i % 5) * 0.12, repeat: Infinity, ease: "easeInOut", delay: (i % 7) * 0.05 } : { duration: 0.3 }} />
      ))}
    </div>
  );
}

const KEY_PHRASES = [/didn'?t send that|did not send|not our invoice|never (issued|sent)|don'?t recognize|not from us/gi, /yes,? that'?s our invoice|we did send|that'?s correct|we issued/gi, /automated assistant|AI assistant/gi];
export function TranscriptBubble({ role, text }) {
  const ai = role === "assistant" || role === "bot" || role === "ai";
  let html = String(text ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);
  KEY_PHRASES.forEach((re, k) => { html = html.replace(re, (m) => `<mark style="background:${[C.block, C.safe, C.calling][k]}33;color:${[C.block, C.safe, C.calling][k]};border-radius:4px;padding:0 3px">${m}</mark>`); });
  return (
    <motion.div {...fade} className={`flex ${ai ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${ai ? "rounded-bl-sm" : "rounded-br-sm"}`}
        style={ai ? { background: `${C.calling}1F`, border: `1px solid ${C.calling}55` } : { background: C.raised, border: `1px solid ${C.border}` }}>
        <div className="label mb-1" style={{ color: ai ? C.calling : C.muted }}>{ai ? "PayCrew AI" : "Vendor"}</div>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </motion.div>
  );
}

export function Empty({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 gap-3">
      {Icon && <Icon className="h-10 w-10 text-[#1E2A38]" />}
      <div className="text-lg font-semibold">{title}</div>
      {hint && <div className="text-sm text-[#8B98A9] max-w-md">{hint}</div>}
      {action}
    </div>
  );
}

export function Skeleton({ className = "" }) {
  return <div className={`animate-pulse rounded-xl bg-[#131B26] ${className}`} />;
}

export function ErrorNote({ children }) {
  return <div className="raised px-3 py-2 text-sm text-amber-300 border-amber-500/30">{children}</div>;
}
