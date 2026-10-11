// BillProof core rules — pure, deterministic, no I/O.
// Imported by Base44 backend functions (Deno) and by the local eval runner (node --experimental-strip-types).
// Anything that decides a score, a band, a call or a status lives here so evals test exactly what ships.

export type Coverage = "high" | "medium" | "low" | "very_low";
export type Match = "match" | "mismatch" | "not_found" | "n/a" | "pending";
export type Group = "existence" | "identity" | "age" | "reputation" | "activity" | "risk_news" | "price" | "ledger" | "call";

export interface Ev {
  id?: string;
  group: Group;
  source_name: string;
  label: string;
  value?: string | number | null;
  expected_value?: string | null;
  match: Match;
  source_url?: string | null;
  fetched_at?: string | null;
  quote?: string | null;
  flag?: HardFlag | null; // set by collectors when the source itself is a hard signal
}

export type HardFlag = "lookalike_domain" | "bank_change_unofficial_domain" | "zero_presence" | "impersonation_reports";

export interface Issue { code: string; label: string; severity: "low" | "medium" | "high" | "critical"; evidence_ids: string[] }
/** Low-severity issues are informational (e.g. ignored prompt-injection text): shown and audited, never decision-changing. */
export const decisive = (issues: Issue[]) => issues.filter((i) => i.severity !== "low");

// ---------------------------------------------------------------- domains

export function normDomain(s?: string | null): string {
  if (!s) return "";
  let d = String(s).trim().toLowerCase();
  if (d.includes("@")) d = d.split("@").pop()!;
  d = d.replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0].replace(/^www\./, "").replace(/\.$/, "");
  return d;
}

// registrable-ish split: "billing.grainger.com" -> {label:"grainger", tld:"com"}; handles co.uk-style 2-part TLDs
const TWO_PART_TLDS = new Set(["co.uk", "com.au", "co.jp", "com.br", "co.nz", "com.mx", "co.in", "com.sg", "org.uk", "ac.uk"]);
export function splitDomain(d: string): { sub: string; label: string; tld: string; base: string } {
  const parts = normDomain(d).split(".").filter(Boolean);
  if (parts.length < 2) return { sub: "", label: parts[0] ?? "", tld: "", base: parts[0] ?? "" };
  const last2 = parts.slice(-2).join(".");
  const tldLen = TWO_PART_TLDS.has(last2) && parts.length >= 3 ? 2 : 1;
  const tld = parts.slice(-tldLen).join(".");
  const label = parts[parts.length - tldLen - 1];
  const sub = parts.slice(0, parts.length - tldLen - 1).join(".");
  return { sub, label, tld, base: `${label}.${tld}` };
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// Visual confusables → canonical skeleton. Multi-char first (rn→m, vv→w, cl→d).
const MULTI: [RegExp, string][] = [[/rn/g, "m"], [/vv/g, "w"], [/cl/g, "d"], [/nn/g, "m"]];
const SINGLE: Record<string, string> = {
  "0": "o", "1": "l", "i": "l", "|": "l", "5": "s", "3": "e", "4": "a", "8": "b", "9": "g", "q": "g", "6": "b", "7": "t", "2": "z",
  // unicode homoglyphs (Cyrillic/Greek) that survive IDN display
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "l", "ј": "j", "ѕ": "s", "ԁ": "d", "ɡ": "g", "ο": "o", "ν": "v", "α": "a",
};
export function skeleton(s: string): string {
  let t = s.normalize("NFKC").toLowerCase();
  for (const [re, r] of MULTI) t = t.replace(re, r);
  return [...t].map((c) => SINGLE[c] ?? c).join("").replace(/[-_.]/g, "");
}

const BAIT_WORDS = ["billing", "billings", "invoice", "invoices", "invoicing", "payment", "payments", "pay", "remit", "remittance", "accounts", "ap", "ar", "finance", "secure", "support", "portal", "supply", "supplies", "inc", "llc", "corp", "group", "us", "usa", "online", "team", "office"];

export interface LookalikeResult {
  verdict: "same" | "alternate" | "lookalike" | "unrelated" | "unknown";
  kind?: "typo" | "homoglyph" | "added_word" | "hyphenation" | "tld_swap" | "subdomain_trick" | "bitsquat" | "combo";
  distance?: number;
  diff_positions?: number[]; // indices in sender label that differ (for LookalikeDiff)
  sender_base: string;
  official_base: string;
}

/** Compare a sender domain to the vendor's official domain(s). `alternates` = domains the vendor really uses (regional TLDs, billing providers it uses). */
export function compareDomains(sender: string, official: string, alternates: string[] = []): LookalikeResult {
  const s = splitDomain(sender), o = splitDomain(official);
  const base = { sender_base: s.base, official_base: o.base };
  if (!s.label || !o.label) return { verdict: "unknown", ...base };
  if (s.base === o.base) return { verdict: "same", ...base };
  if (alternates.map((a) => splitDomain(a).base).includes(s.base)) return { verdict: "alternate", ...base };

  const sl = s.label, ol = o.label;
  const diff = diffPositions(sl, ol);
  // official brand embedded as a subdomain of another domain: grainger.com-billing.net, grainger.billing-portal.com
  if (s.sub && (s.sub.split(".").includes(ol) || s.sub.includes(o.base))) return { verdict: "lookalike", kind: "subdomain_trick", distance: 0, diff_positions: [], ...base };
  if (sl === ol) return { verdict: "lookalike", kind: "tld_swap", distance: 0, diff_positions: [], ...base };
  if (sl.replace(/-/g, "") === ol.replace(/-/g, "")) return { verdict: "lookalike", kind: "hyphenation", distance: 1, diff_positions: diff, ...base };

  // added bait word: grainger-billing, graingerpayments, billing-grainger
  const stripped = stripBait(sl);
  if (stripped !== sl && (stripped === ol || skeleton(stripped) === skeleton(ol) || levenshtein(stripped, ol) <= 1))
    return { verdict: "lookalike", kind: stripped === ol ? "added_word" : "combo", distance: levenshtein(sl, ol), diff_positions: diff, ...base };

  if (skeleton(sl) === skeleton(ol)) return { verdict: "lookalike", kind: "homoglyph", distance: levenshtein(sl, ol), diff_positions: diff, ...base };
  const dist = levenshtein(sl, ol);
  if (dist === 1 && sl.length === ol.length && isBitflip(sl, ol)) return { verdict: "lookalike", kind: "bitsquat", distance: 1, diff_positions: diff, ...base };
  const maxD = ol.length <= 5 ? 1 : 2;
  if (dist > 0 && dist <= maxD) return { verdict: "lookalike", kind: "typo", distance: dist, diff_positions: diff, ...base };
  if (levenshtein(skeleton(sl), skeleton(ol)) <= 1 && ol.length > 5) return { verdict: "lookalike", kind: "combo", distance: dist, diff_positions: diff, ...base };
  return { verdict: "unrelated", distance: dist, ...base };
}

function stripBait(label: string): string {
  let t = label;
  for (let k = 0; k < 2; k++) {
    for (const w of BAIT_WORDS) {
      if (t.endsWith("-" + w)) t = t.slice(0, -(w.length + 1));
      else if (t.startsWith(w + "-")) t = t.slice(w.length + 1);
      else if (t.length > w.length + 3 && t.endsWith(w)) t = t.slice(0, -w.length);
    }
  }
  return t;
}

function isBitflip(a: string, b: string): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { const x = a.charCodeAt(i) ^ b.charCodeAt(i); return x > 0 && (x & (x - 1)) === 0; }
  return false;
}

/** Character positions in `a` that differ from `b` (LCS alignment), for the letter-by-letter diff UI. */
export function diffPositions(a: string, b: string): number[] {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const keep = new Set<number>();
  let i = 0, j = 0;
  while (i < m && j < n) { if (a[i] === b[j]) { keep.add(i); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
  return [...Array(m).keys()].filter((k) => !keep.has(k));
}

// ---------------------------------------------------------------- names, phones

const NAME_NOISE = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|the|group|holdings|usa|us)\b\.?/g;
export function normName(s?: string | null) {
  return (s ?? "").toLowerCase().replace(/&/g, " and ").replace(NAME_NOISE, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
export function nameSimilar(a?: string | null, b?: string | null): boolean {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // containment only counts when the shorter name is the brand prefix ("staples" ⊂ "staples business advantage")
  // or covers most of the longer one — "partners" must not match "northbridge facility partners"
  const [sh, lo] = x.length <= y.length ? [x, y] : [y, x];
  if (lo.includes(sh) && sh.length >= 4 && ((lo.startsWith(sh + " ") || lo === sh) || sh.length >= lo.length * 0.6)) return true;
  return levenshtein(x, y) <= Math.max(1, Math.floor(Math.min(x.length, y.length) / 8));
}

export function normPhone(p?: string | null): string {
  if (!p) return "";
  let d = String(p).replace(/(ext|x)\.?\s*\d+$/i, "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length >= 10 ? d.slice(-10) : "";
}
export function e164(p: string): string {
  const d = normPhone(p);
  return d ? `+1${d}` : "";
}

/** Choose the call-back number: official sources only, most agreement wins. Never the bill's phone. */
export function pickOfficialPhone(cands: { phone?: string | null; source: string; source_url?: string | null }[], phoneOnInvoice?: string | null) {
  const bill = normPhone(phoneOnInvoice);
  const groups = new Map<string, { phone: string; sources: string[]; urls: string[] }>();
  for (const c of cands) {
    const n = normPhone(c.phone);
    if (!n) continue;
    const g = groups.get(n) ?? { phone: n, sources: [], urls: [] };
    if (!g.sources.includes(c.source)) g.sources.push(c.source);
    if (c.source_url) g.urls.push(c.source_url);
    groups.set(n, g);
  }
  const ranked = [...groups.values()].sort((a, b) => b.sources.length - a.sources.length);
  const best = ranked[0];
  if (!best) return null;
  // a number that only appears on the bill and in ONE other place is not independent enough if they agree by coincidence — still allowed (≥1 independent source), but flagged
  return { phone: best.phone, e164: `+1${best.phone}`, sources: best.sources, urls: best.urls, agreement: best.sources.length, same_as_bill: !!bill && bill === best.phone };
}

// ---------------------------------------------------------------- prompt injection

const INJECTION = [
  /ignore (all |any )?(previous|prior|above) (instructions|rules)/i,
  /\bsystem\s*:/i,
  /approve (this|immediately|now|without)/i,
  /(do not|don't) (flag|verify|call|check)/i,
  /you are (now )?(an?|the) /i,
  /call (this|the following) number/i,
  /mark (as )?(paid|approved|safe)/i,
  /override/i,
];
export function detectInjection(text?: string | null): string[] {
  if (!text) return [];
  const hits: string[] = [];
  for (const re of INJECTION) { const m = text.match(re); if (m) hits.push(m[0]); }
  return hits;
}

// ---------------------------------------------------------------- regex fallback parser (ported from BillProof rules.py)

export function parseInvoiceRules(text: string) {
  const g = (re: RegExp) => text.match(re)?.[1]?.trim() ?? null;
  const norm = text.replace(/,/g, "");
  const amt = norm.match(/(?:Amount Due|Total Due|Total|Amount)\s*:?\s*\$?\s*(\d+(?:\.\d+)?)/i) ?? norm.match(/\$\s*(\d+(?:\.\d+)?)/);
  const bank = g(/(?:Account(?: Number| No\.?| #)?|Acct\.?)\s*:?\s*[*xX•\- ]*(\d{4})\b/i);
  return {
    vendor_name: g(/(?:Vendor|From|Bill From)\s*:\s*(.+)/i),
    invoice_number: g(/Invoice\s*(?:Number|No\.?|#)\s*:?\s*([A-Z0-9\-\/]+)/i),
    po_number: g(/P\.?O\.?\s*(?:Number|No\.?|#|Reference)?\s*:?\s*(PO[-\s]?\d+|\d{3,})/i),
    amount: amt ? Number(amt[1]) : null,
    sender_email: g(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/),
    bank_account_last4: bank,
    phone_on_invoice: g(/(?:Phone|Tel|Call)\s*:?\s*(\+?1?[\s.\-(]*\d{3}[\s.\-)]*\d{3}[\s.\-]*\d{4})/i),
  };
}

// ---------------------------------------------------------------- ledger

export interface LedgerInvoice { id?: string; vendor_id?: string | null; vendor_name?: string | null; invoice_number?: string | null; amount?: number | null; invoice_date?: string | null; created_at?: string | null; po_number?: string | null }

export function findDuplicate(inv: LedgerInvoice, history: LedgerInvoice[]) {
  const t = Date.parse(inv.invoice_date ?? inv.created_at ?? "") || Date.now();
  for (const h of history) {
    if (h.id && h.id === inv.id) continue;
    const sameVendor = (inv.vendor_id && h.vendor_id === inv.vendor_id) || nameSimilar(inv.vendor_name, h.vendor_name);
    if (!sameVendor) continue;
    const ht = Date.parse(h.invoice_date ?? h.created_at ?? "") || t;
    if (Math.abs(t - ht) > 90 * 864e5) continue;
    const sameAmt = Math.abs((inv.amount ?? -1) - (h.amount ?? -2)) <= 1;
    const a = (inv.invoice_number ?? "").replace(/\W/g, "").toLowerCase(), b = (h.invoice_number ?? "").replace(/\W/g, "").toLowerCase();
    const sameNum = !!a && a === b, nearNum = !!a && !!b && levenshtein(a, b) <= 1;
    // same amount alone is only a duplicate when close in time — monthly subscriptions repeat the same amount legitimately
    const close = Math.abs(t - ht) <= 25 * 864e5;
    if (sameNum || (sameAmt && (nearNum || close))) return { duplicate: true, of: h, reason: sameNum ? "same invoice number" : nearNum ? "same amount, near-identical invoice number" : "same vendor and amount within 25 days" };
  }
  return { duplicate: false as const };
}

// ---------------------------------------------------------------- risk judge

export const WEIGHTS: Record<Exclude<Group, "price" | "ledger" | "call">, number> = { existence: 25, identity: 25, age: 15, reputation: 15, activity: 10, risk_news: 10 };

export interface Judgement {
  trust_score: number;
  coverage: Coverage;
  coverage_ratio: number;
  hard_flags: HardFlag[];
  group_scores: Record<string, number>;
  found: number;
  tried: number;
  reasons: string[];
}

/**
 * Deterministic trust score.
 * - Each group scores 0..1 from its evidence (match=1, not_found=0, mismatch=0 [or 0.5 for reputation]), times its weight.
 * - coverage = sources found ÷ tried (pending sources don't count as tried).
 * - Hard flags force very_low. Bad reviews alone never do (reputation can cost at most 15 points and is not a hard flag).
 */
export function judge(evidence: Ev[]): Judgement {
  const reasons: string[] = [];
  const web = evidence.filter((e) => e.group in WEIGHTS && e.match !== "pending" && e.match !== "n/a");
  const sources = new Map<string, boolean>();
  // coverage counts independent WEB sources only — our own identity comparisons and ledger aren't "found online"
  const NOT_WEB = new Set(["Identity check", "Internal ledger", "Intake", "Phone call"]);
  for (const e of web) if (!NOT_WEB.has(e.source_name) && e.group !== "identity") sources.set(e.source_name, (sources.get(e.source_name) ?? false) || e.match === "match" || e.match === "mismatch");
  const tried = sources.size, found = [...sources.values()].filter(Boolean).length;
  const ratio = tried ? found / tried : 0;

  const group_scores: Record<string, number> = {};
  let score = 0;
  for (const [g, w] of Object.entries(WEIGHTS)) {
    const es = web.filter((e) => e.group === g);
    if (!es.length) { group_scores[g] = 0; continue; }
    const vals: number[] = es.map((e): number => {
      if (e.match === "match") return 1;
      if (e.match === "mismatch") return g === "reputation" ? 0.4 : g === "risk_news" ? 0 : 0;
      return g === "risk_news" ? 1 : 0; // no risk news found = good
    });
    const v = vals.reduce((a, b) => a + b, 0) / vals.length;
    group_scores[g] = Math.round(v * w * 10) / 10;
    score += v * w;
  }

  const hard_flags = [...new Set(evidence.map((e) => e.flag).filter(Boolean) as HardFlag[])];
  let coverage: Coverage = ratio >= 0.7 ? "high" : ratio >= 0.4 ? "medium" : ratio >= 0.2 ? "low" : "very_low";
  if (tried === 0) coverage = "very_low";
  if (hard_flags.length) {
    coverage = "very_low";
    score = Math.min(score, 15);
    reasons.push(`hard flag: ${hard_flags.join(", ")}`);
  }
  // identity hard-fail: an identity source contradicts (e.g. sender domain unrelated to official & no alternate)
  const idFail = evidence.some((e) => e.group === "identity" && e.match === "mismatch" && e.flag === "lookalike_domain");
  if (idFail) coverage = "very_low";
  reasons.push(`coverage ${found}/${tried} sources = ${Math.round(ratio * 100)}%`);
  return { trust_score: Math.round(Math.max(0, Math.min(100, score))), coverage, coverage_ratio: ratio, hard_flags, group_scores, found, tried, reasons };
}

/** Coarse band used by the vendor eval: green ≥ 70 & coverage ≥ medium, red = very_low, else amber. */
export function band(j: Pick<Judgement, "trust_score" | "coverage">): "green" | "amber" | "red" {
  if (j.coverage === "very_low") return "red";
  if (j.trust_score >= 60 && (j.coverage === "high" || j.coverage === "medium")) return "green";
  return "amber";
}

export function riskLevel(coverage: Coverage, issues: Issue[]): "low" | "medium" | "high" | "critical" {
  const sev = decisive(issues).map((i) => i.severity);
  if (sev.includes("critical")) return "critical";
  if (sev.includes("high") || (coverage === "very_low" && sev.length)) return "high";
  if (sev.includes("medium") || coverage === "low" || coverage === "very_low") return "medium";
  return "low";
}

// ---------------------------------------------------------------- call rule + router

export interface Policy { always_call_on_bank_change: boolean; approval_threshold: number }
export const DEFAULT_POLICY: Policy = { always_call_on_bank_change: true, approval_threshold: 5000 };

export function callDecision(args: { issues: Issue[]; coverage: Coverage; bank_changed: boolean; official_phone: { e164: string; sources: string[] } | null; policy?: Policy }) {
  const p = args.policy ?? DEFAULT_POLICY;
  const needsByRule = (decisive(args.issues).length > 0 && (args.coverage === "low" || args.coverage === "very_low")) || (p.always_call_on_bank_change && args.bank_changed);
  if (!needsByRule) return { call: false as const, needed: false, reason: "Call rule not triggered" };
  if (!args.official_phone || !args.official_phone.sources.length) return { call: false as const, needed: true, reason: "No independently verified phone number." };
  return { call: true as const, needed: true, reason: args.bank_changed && p.always_call_on_bank_change ? "Bank details changed — always verify by phone" : "Issue found and web confidence is low", number: args.official_phone.e164, sources: args.official_phone.sources };
}

export type InvoiceStatus = "received" | "running" | "needs_call" | "calling" | "needs_review" | "approved" | "blocked" | "rejected";
export type PaymentStatus = "on_hold" | "ready_for_human" | "released" | "cancelled";
export type CallOutcome = "confirmed" | "denied" | "unsure" | "no_answer";

export interface RouteResult { status: InvoiceStatus; decision: string; reason: string; payment: PaymentStatus; needs_owner: boolean; retry_call?: boolean }

/** §3.5 decision table. Never produces a "sent" payment — PaymentStatus has no such value. */
export function route(args: { coverage: Coverage; issues: Issue[]; amount: number; risk: string; call?: ReturnType<typeof callDecision>; outcome?: CallOutcome | null; call_attempts?: number; policy?: Policy }): RouteResult {
  const p = args.policy ?? DEFAULT_POLICY;
  const real = decisive(args.issues);
  const hasIssue = real.length > 0;
  const lowWeb = args.coverage === "low" || args.coverage === "very_low";
  const overThreshold = args.amount > p.approval_threshold;
  const ownerNeeded = overThreshold || args.risk === "high" || args.risk === "critical";
  let r: RouteResult;

  if (args.call?.needed) {
    if (!args.call.call) r = { status: "needs_review", decision: "needs_review", reason: args.call.reason, payment: "on_hold", needs_owner: true };
    else if (!args.outcome) r = { status: "needs_call", decision: "verify_call", reason: args.call.reason, payment: "on_hold", needs_owner: true };
    else if (args.outcome === "denied") r = { status: "blocked", decision: "block", reason: "Vendor denied issuing this bill on a call to its verified number — high risk, blocked for review", payment: "on_hold", needs_owner: true };
    else if (args.outcome === "confirmed") r = { status: "needs_review", decision: "needs_review", reason: "Vendor confirmed on a call to its verified number — review transcript before paying", payment: "on_hold", needs_owner: ownerNeeded };
    else if ((args.call_attempts ?? 1) < 2) r = { status: "needs_call", decision: "hold_retry", reason: `Call ${args.outcome === "no_answer" ? "not answered" : "unclear"} — holding, one retry`, payment: "on_hold", needs_owner: true, retry_call: true };
    else r = { status: "needs_review", decision: "needs_review", reason: `Call ${args.outcome === "no_answer" ? "not answered" : "unclear"} after retry — needs a human`, payment: "on_hold", needs_owner: true };
  } else if (!hasIssue && !lowWeb) r = { status: "approved", decision: "approve", reason: "No issues; vendor verified on the web", payment: "ready_for_human", needs_owner: false };
  else if (!hasIssue && lowWeb) r = { status: "needs_review", decision: "needs_review", reason: "Little public information about this vendor — check before paying", payment: "on_hold", needs_owner: false };
  else r = { status: "needs_review", decision: "needs_review", reason: real.map((i) => i.label).join("; "), payment: "on_hold", needs_owner: ownerNeeded };

  if (overThreshold && r.status === "approved") r = { status: "needs_review", decision: "owner_approval", reason: `Above approval threshold ($${p.approval_threshold.toLocaleString()}) — owner approval required`, payment: "on_hold", needs_owner: true };
  else if (overThreshold) r.needs_owner = true;
  return r;
}
