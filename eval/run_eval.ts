// BillProof eval runner. Runs the SAME shared code that ships in the Base44 functions.
//   node --experimental-strip-types --no-warnings eval/run_eval.ts web_verify|lookalike|e2e|safety|call [--record] [--offline]
// Bright Data responses are cached in cache/bd (reused for the demo; never re-fetched in loops). --record posts EvalRun/EvalCase to Base44.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { makeBD, env } from "./lib.ts";
import { memStore } from "./memstore.ts";
import { verifyVendor } from "../base44/shared/verify.ts";
import { judge, band, compareDomains, splitDomain, normDomain, detectInjection, type Ev } from "../base44/shared/core.ts";
import { runCrewCore } from "../base44/shared/crew.ts";

const suite = process.argv[2];
const RECORD = process.argv.includes("--record");
const OFFLINE = process.argv.includes("--offline");
const OUT = new URL("./results/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

export function csv(path: string) {
  const [head, ...rows] = readFileSync(new URL(path, import.meta.url), "utf8").trim().split("\n");
  const cols = head.split(",");
  return rows.map((r) => { const v = r.split(","); return Object.fromEntries(cols.map((c, i) => [c, (v[i] ?? "").trim()])); });
}

async function record(run: any, cases: any[]) {
  writeFileSync(`${OUT}${run.suite}.json`, JSON.stringify({ run, cases }, null, 1));
  if (!RECORD) return;
  const r = await fetch("https://logical-smart-bill-guard.base44.app/functions/recordEval", {
    method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "curl/8.7.1", "x-paycrew-secret": env().PAYCREW_WEBHOOK_SECRET },
    body: JSON.stringify({ run, cases }),
  });
  console.log("recorded:", r.status, (await r.text()).slice(0, 120));
}

const pct = (a: number, b: number) => (b ? a / b : 0);

// ------------------------------------------------------------------ Suite 2: web verification
async function webVerify() {
  const rows = csv("./vendors.csv");
  const bd = makeBD(OFFLINE);
  const started = new Date().toISOString();
  const cases: any[] = [];
  const confusion: Record<string, Record<string, number>> = {};
  let i = 0;
  // 3 vendors at a time (each vendor already fans out to ~8 Bright Data calls; account limit ~20 req/min)
  const queue = [...rows];
  async function worker() {
    while (queue.length) {
      const v = queue.shift()!;
      const idx = ++i;
      const t0 = Date.now(), r0 = bd.requests;
      const res = await verifyVendor(bd, { name: v.name, city: v.city || null, state: v.state || null, sender_domain: normDomain(v.invoice_email), alternates: v.alternate_domains ? v.alternate_domains.split(";") : [] });
      const j = judge(res.evidence);
      const b = band(j);
      const secs = (Date.now() - t0) / 1000;
      const expectedDomain = v.official_domain ? splitDomain(v.official_domain).base : null;
      const gotDomain = res.official_domain;
      const isFake = v.group === "fake";
      const entityOk = isFake ? true : gotDomain === expectedDomain || (v.alternate_domains ?? "").split(";").map((a: string) => splitDomain(a).base).includes(gotDomain ?? "");
      const isReal = !isFake;
      const pass = isReal ? b !== "red" && entityOk : b === "red";
      (confusion[v.expected_band] ??= {})[b] = ((confusion[v.expected_band] ?? {})[b] ?? 0) + 1;
      const reasons = [...j.reasons, ...res.evidence.filter((e) => e.flag || e.match === "mismatch").map((e) => `${e.source_name}: ${e.label} = ${e.value}${e.flag ? ` [${e.flag}]` : ""}`)];
      cases.push({
        case_id: v.name, input: { name: v.name, city: v.city, sender: v.invoice_email, group: v.group },
        expected: { band: v.expected_band, domain: expectedDomain }, actual: { band: b, trust: j.trust_score, coverage: j.coverage, domain: gotDomain, phone: res.official_phone?.e164 ?? null, phone_sources: res.official_phone?.sources ?? [], status: res.status },
        pass, notes: `${v.group} · ${secs.toFixed(1)}s · ${res.requests} BD requests · ${reasons.slice(0, 4).join(" | ")}`,
        _secs: secs, _req: bd.requests - r0, _entity: entityOk, _reasons: reasons, _evidence: res.evidence.map((e) => ({ s: e.source_name, l: e.label, v: e.value, m: e.match, u: e.source_url })),
      });
      console.log(`${String(idx).padStart(2)} ${pass ? "✓" : "✗"} [${v.group}] ${v.name} → ${b} (trust ${j.trust_score}, ${j.coverage}) domain ${gotDomain ?? "—"}${entityOk ? "" : ` ≠ ${expectedDomain}`} · ${secs.toFixed(1)}s`);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  const real = cases.filter((c) => c.input.group !== "fake");
  const fakes = cases.filter((c) => c.input.group === "fake");
  const falseAlarms = real.filter((c) => c.actual.band === "red");
  const fakesMissed = fakes.filter((c) => c.actual.band !== "red");
  const entity = real.filter((c) => c._entity).length;
  const metrics = {
    vendors: cases.length,
    false_alarms_real_to_red: falseAlarms.length,
    fakes_caught: `${fakes.length - fakesMissed.length}/${fakes.length}`,
    entity_resolution_accuracy: pct(entity, real.length),
    band_accuracy: pct(cases.filter((c) => c.expected.band === c.actual.band).length, cases.length),
    avg_seconds_per_vendor: +(cases.reduce((s, c) => s + c._secs, 0) / cases.length).toFixed(1),
    avg_requests_per_vendor: +(cases.reduce((s, c) => s + c._req, 0) / cases.length).toFixed(1),
    bright_data_requests_total: bd.requests,
    cache_hits_total: Object.values(bd.usage).reduce((s, u) => s + u.cache_hits, 0),
  };
  const passed = falseAlarms.length === 0 && fakesMissed.length === 0 && metrics.entity_resolution_accuracy >= 0.9;
  console.log(metrics, "usage", JSON.stringify(bd.usage));
  await record({ suite: "web_verify", started_at: started, finished_at: new Date().toISOString(), metrics, passed, confusion, headline: `${cases.length} vendors: ${falseAlarms.length} false alarms on real vendors, ${metrics.fakes_caught} fakes caught, ${(metrics.entity_resolution_accuracy * 100).toFixed(0)}% entity resolution` }, cases.map(({ _secs, _req, _entity, _reasons, _evidence, ...c }) => c));
  writeFileSync(`${OUT}web_verify_full.json`, JSON.stringify(cases, null, 1));
}

// ------------------------------------------------------------------ Suite 3: lookalike domains (dnstwist-style permutations)
const HOMO: Record<string, string[]> = { a: ["4", "а"], e: ["3", "е"], i: ["1", "l"], l: ["1", "i"], o: ["0", "о"], g: ["q", "9"], s: ["5"], m: ["rn"], w: ["vv"], c: ["с"], d: ["cl"] };
export function permutations(domain: string) {
  const { label, tld } = splitDomain(domain);
  const out: { d: string; kind: string }[] = [];
  const add = (l: string, t = tld, kind: string) => { if (l && l !== label || t !== tld) out.push({ d: `${l}.${t}`, kind }); };
  // typos: omission, repetition, transposition, replacement (adjacent keys)
  const KB: Record<string, string> = { a: "qs", b: "vn", c: "xv", d: "sf", e: "wr", f: "dg", g: "fh", h: "gj", i: "uo", k: "jl", l: "k", m: "n", n: "bm", o: "ip", p: "o", r: "et", s: "ad", t: "ry", u: "yi", w: "qe", x: "zc", y: "tu" };
  for (let i = 0; i < label.length; i++) {
    add(label.slice(0, i) + label.slice(i + 1), tld, "omission");
    if (i < label.length - 1) add(label.slice(0, i) + label[i + 1] + label[i] + label.slice(i + 2), tld, "transposition");
    for (const k of (KB[label[i]] ?? "").slice(0, 1)) add(label.slice(0, i) + k + label.slice(i + 1), tld, "replacement");
    for (const h of HOMO[label[i]] ?? []) add(label.slice(0, i) + h + label.slice(i + 1), tld, "homoglyph");
    // bitsquatting: flip one bit, keep a-z0-9
    for (let b = 0; b < 7; b++) { const c = String.fromCharCode(label.charCodeAt(i) ^ (1 << b)); if (/[a-z0-9]/.test(c)) { add(label.slice(0, i) + c + label.slice(i + 1), tld, "bitsquatting"); break; } }
  }
  add(label + label.at(-1), tld, "repetition");
  for (let i = 2; i < label.length - 1; i += 3) add(label.slice(0, i) + "-" + label.slice(i), tld, "hyphenation");
  for (const w of ["billing", "payments", "invoices", "pay", "secure", "ap"]) { add(`${label}-${w}`, tld, "added_word"); add(`${label}${w}`, tld, "added_word"); }
  for (const t of ["net", "co", "org", "io", "us", "biz"].filter((t) => t !== tld)) add(label, t, "tld_swap");
  out.push({ d: `${label}.${tld}-billing.com`, kind: "subdomain_trick" });
  const seen = new Set<string>();
  return out.filter((x) => (seen.has(x.d) ? false : (seen.add(x.d), true)));
}

async function lookalike() {
  const VENDORS = ["grainger.com", "staples.com", "uline.com", "cdw.com", "fastenal.com", "mcmaster.com", "officedepot.com", "atlassian.com", "zoom.us", "dropbox.com", "salesforce.com", "cintas.com", "fedex.com", "homedepot.com", "dell.com", "wayfair.com", "comcast.com", "sysco.com", "deltafaucet.com", "microsoft.com"];
  // legitimate alternates the companies really use (must NOT be flagged when listed as alternates)
  const LEGIT: [string, string, string[]][] = [
    ["billing.grainger.com", "grainger.com", []], ["email.staples.com", "staples.com", []], ["zoom.com", "zoom.us", ["zoom.com"]], ["comcastbusiness.com", "comcast.com", ["comcastbusiness.com"]],
    ["xfinity.com", "comcast.com", ["xfinity.com"]], ["dell.co.uk", "dell.com", ["dell.co.uk"]], ["microsoftonline.com", "microsoft.com", ["microsoftonline.com"]], ["fedex.com", "fedex.com", []],
    ["sysco.com", "sysco.com", []], ["officedepot.com", "officedepot.com", []],
  ];
  const started = new Date().toISOString();
  const cases: any[] = [];
  const byKind: Record<string, { n: number; caught: number }> = {};
  for (const off of VENDORS) for (const p of permutations(off)) {
    const r = compareDomains(p.d, off);
    const caught = r.verdict === "lookalike";
    (byKind[p.kind] ??= { n: 0, caught: 0 }).n++;
    if (caught) byKind[p.kind].caught++;
    cases.push({ case_id: `${p.d} vs ${off}`, input: { sender: p.d, official: off, kind: p.kind }, expected: { verdict: "lookalike" }, actual: { verdict: r.verdict, kind: r.kind ?? null }, pass: caught, notes: p.kind });
  }
  const fp = LEGIT.map(([s, o, alt]) => { const r = compareDomains(s, o, alt); const ok = r.verdict === "same" || r.verdict === "alternate"; cases.push({ case_id: `${s} vs ${o} (legit)`, input: { sender: s, official: o, alternates: alt }, expected: { verdict: "same|alternate" }, actual: { verdict: r.verdict }, pass: ok, notes: "legitimate domain" }); return !ok; });
  const imp = cases.filter((c) => c.notes !== "legitimate domain");
  const metrics: Record<string, number | string> = {
    impostor_domains: imp.length,
    lookalike_recall: pct(imp.filter((c) => c.pass).length, imp.length),
    false_positive_rate_on_real_domains: pct(fp.filter(Boolean).length, LEGIT.length),
    ...Object.fromEntries(Object.entries(byKind).map(([k, v]) => [`recall_${k}`, pct(v.caught, v.n)])),
  };
  const confusion = { lookalike: { lookalike: imp.filter((c) => c.pass).length, not_flagged: imp.filter((c) => !c.pass).length }, legit: { flagged: fp.filter(Boolean).length, not_flagged: LEGIT.length - fp.filter(Boolean).length } };
  console.log(metrics);
  for (const c of cases.filter((c) => !c.pass).slice(0, 30)) console.log("  ✗", c.case_id, c.notes, "→", c.actual.verdict);
  await record({ suite: "lookalike", started_at: started, finished_at: new Date().toISOString(), metrics, confusion, passed: (metrics.lookalike_recall as number) >= 0.9 && fp.filter(Boolean).length === 0, headline: `${imp.length} impostor domains: ${((metrics.lookalike_recall as number) * 100).toFixed(1)}% caught, ${fp.filter(Boolean).length}/${LEGIT.length} false positives on real domains` }, cases);
}

if (suite === "web_verify") await webVerify();
else if (suite === "lookalike") await lookalike();
else console.log("usage: run_eval.ts web_verify|lookalike [--record] [--offline]");
