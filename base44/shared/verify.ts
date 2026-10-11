// Web Verifier collectors (Bright Data core) + identity matcher + price checker.
// Runtime-agnostic: used by Base44 functions and by eval/run_eval.ts. Never invents data: missing → match "not_found".
import { BrightData, DS, waybackFirstSeen } from "./bd.ts";
export { BrightData };
import { compareDomains, levenshtein, nameSimilar, normDomain, normName, normPhone, pickOfficialPhone, skeleton, splitDomain, type Ev, type LookalikeResult } from "./core.ts";

export interface VendorQuery {
  name: string;               // vendor name as printed on the bill
  city?: string | null;
  state?: string | null;
  sender_domain?: string | null;
  phone_on_invoice?: string | null;
  known_domain?: string | null;   // from the vendor master (company's own records), if any
  alternates?: string[];
}

export interface PhoneCand { phone: string; source: string; source_url?: string | null }

export interface VerifyResult {
  official_domain: string | null;
  official_name: string | null;
  domain_confidence: "high" | "medium" | "low" | "none";
  evidence: Ev[];
  phones: PhoneCand[];
  official_phone: ReturnType<typeof pickOfficialPhone>;
  lookalike: LookalikeResult | null;
  name_lookalike: boolean;      // bill name is a near-copy of a different real company's name
  ms: number;
  requests: number;
  status: Record<string, Ev["match"]>; // per-source status for the radar
}

const DIRECTORIES = /(^|\.)(yelp|linkedin|facebook|instagram|twitter|x|bbb|indeed|glassdoor|crunchbase|wikipedia|mapquest|yellowpages|bloomberg|zoominfo|dnb|trustpilot|amazon|walmart|youtube|tiktok|reddit|nextdoor|angi|homeadvisor|thumbtack|manta|chamberofcommerce|buzzfile|opencorporates|bizapedia|sec|apple|google|craigslist|pitchbook|cbinsights|owler|rocketreach|signalhire|apollo|ebay|etsy|alibaba|thomasnet|porch|houzz|birdeye|expertise|mapcarta|zaubacorp|corporationwiki|wiza|leadiq|clutch|g2|capterra)\.[a-z.]+$/i;
const RISK_WORDS = /\b(scam|fraud|lawsuit|sued|impersonat\w*|bankrupt\w*|phishing|ponzi|indicted|settlement|class action|cease and desist)\b/i;
const now = () => new Date().toISOString();

/** Letters in vanity numbers (1-800-GRAINGER) → digits. */
export function devanity(s: string): string {
  const map: Record<string, string> = { a: "2", b: "2", c: "2", d: "3", e: "3", f: "3", g: "4", h: "4", i: "4", j: "5", k: "5", l: "5", m: "6", n: "6", o: "6", p: "7", q: "7", r: "7", s: "7", t: "8", u: "8", v: "8", w: "9", x: "9", y: "9", z: "9" };
  return s.replace(/[a-z]/gi, (c) => map[c.toLowerCase()]);
}
export function phonesIn(text: string): string[] {
  const out = new Set<string>();
  const re = /(?:\+?1[\s.\-]?)?\(?\b([2-9]\d{2})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})\b/g;
  for (const m of text.matchAll(re)) out.add(`${m[1]}${m[2]}${m[3]}`);
  for (const m of text.matchAll(/\b1?[\s.\-]?(8(?:00|33|44|55|66|77|88))[\s.\-]([A-Z][A-Z0-9\-]{6,9})\b/g)) {
    const d = devanity(m[2].replace(/-/g, "")).slice(0, 7);
    if (d.length === 7) out.add(`${m[1]}${d}`);
  }
  return [...out];
}

function ev(e: Omit<Ev, "fetched_at"> & { fetched_at?: string | null; product?: string }): Ev & { product?: string } {
  return { fetched_at: now(), ...e };
}

/** Step 1 — find the vendor's official domain from the web (SERP), never from the bill. */
export async function findOfficialDomain(bd: BrightData, q: VendorQuery) {
  const query = [q.name, q.city, q.state].filter(Boolean).join(" ");
  const r = await bd.serp(query, "", "Web search · official site");
  let { organic = [], knowledge = null, url } = r.value ?? {};
  if (!knowledge && q.city) {
    // the business panel often appears only without the state suffix
    const r2 = await bd.serp([q.name, q.city].join(" "), "", "Google business listing");
    if (r2.value?.knowledge) knowledge = r2.value.knowledge;
    if (!organic.length) organic = r2.value?.organic ?? [];
  }
  const cands: { domain: string; title: string; source?: string; link: string; why: string }[] = [];
  if (knowledge?.site && nameSimilar(knowledge.name, q.name)) cands.push({ domain: normDomain(knowledge.site), title: knowledge.name, link: knowledge.site, why: "Google business panel" });
  for (const o of organic.slice(0, 8)) {
    const d = normDomain(o.link);
    if (!d || DIRECTORIES.test(splitDomain(d).base)) continue;
    const label = splitDomain(d).label;
    const nm = normName(q.name).replace(/ /g, "");
    const titleOk = nameSimilar(o.source, q.name) || nameSimilar((o.title ?? "").split(/[|\-–:]/)[0], q.name);
    const lab = label.replace(/-/g, "");
    // the domain must spell (most of) the full name — "northbridge-anything.com" is not "Northbridge Facility Partners"
    const domOk = !!nm && (lab === nm || lab.includes(nm) || (nm.startsWith(lab) && lab.length >= 6 && lab.length >= nm.length * 0.6) || levenshtein(lab, nm) <= 1);
    if (titleOk || domOk) cands.push({ domain: d, title: o.title, source: o.source, link: o.link, why: titleOk ? "top web result with matching name" : "domain matches name" });
  }
  // the known (vendor master) domain wins if the web agrees with it
  const known = q.known_domain ? normDomain(q.known_domain) : null;
  let pick = cands[0] ?? null;
  if (known) { const k = cands.find((c) => splitDomain(c.domain).base === splitDomain(known).base); if (k) pick = k; }
  const agree = pick ? cands.filter((c) => splitDomain(c.domain).base === splitDomain(pick!.domain).base).length : 0;
  const confidence = !pick ? "none" : agree >= 2 ? "high" : knowledge?.site ? "medium" : "low";
  return { domain: pick ? splitDomain(pick.domain).base : null, pick, confidence: confidence as VerifyResult["domain_confidence"], knowledge, organic, serp_url: url, cached: r.cached };
}

/** Max 2 Web Scraper API jobs per bill, run in parallel: Trustpilot + (Amazon when there are products to price, else Crunchbase). */
export const SCRAPERS_PER_BILL = 2;

export async function verifyVendor(bd: BrightData, q: VendorQuery, opts: { deadlineMs?: number; skipSlow?: boolean; crunchbase?: boolean } = {}): Promise<VerifyResult> {
  const t0 = Date.now(), req0 = bd.requests;
  const E: (Ev & { product?: string })[] = [];
  const phones: PhoneCand[] = [];
  const status: Record<string, Ev["match"]> = {};
  const set = (src: string, m: Ev["match"]) => { const order = ["match", "mismatch", "not_found", "pending", "n/a"]; if (!status[src] || order.indexOf(m) < order.indexOf(status[src])) status[src] = m; };

  // 1 — official domain (Web search)
  const od = await findOfficialDomain(bd, q);
  const official = od.domain;
  const officialName = (od.knowledge && nameSimilar(od.knowledge.name, q.name) ? od.knowledge.name : null) || od.pick?.source || od.pick?.title?.split(/[|\-–:]/)[0]?.trim() || null;
  E.push(ev({ group: "existence", source_name: "Web search", label: "Official website", value: official ?? "Not found", match: official ? "match" : "not_found", source_url: od.serp_url ? `https://www.google.com/search?q=${encodeURIComponent([q.name, q.city, q.state].filter(Boolean).join(" "))}` : null, quote: od.pick ? `${od.pick.why}: ${od.pick.title}` : null, product: "SERP API" }));
  set("Web search", official ? "match" : "not_found");

  // name on bill is a near-copy of a real company with a different spelling (Grainqer vs Grainger)
  const name_lookalike = isNameLookalike(q.name, officialName);

  // Google business panel (Maps data via SERP)
  const k = od.knowledge;
  if (k && nameSimilar(k.name, q.name)) {
    const mapsUrl = k.fid ? `https://www.google.com/maps?cid=${BigInt(String(k.fid).split(":")[1]).toString()}` : null;
    E.push(ev({ group: "existence", source_name: "Google Maps", label: "Business listing", value: [k.name, k.address].filter(Boolean).join(" — "), match: "match", source_url: mapsUrl, quote: k.subtitle ?? k.summary ?? null, product: "SERP API" }));
    if (k.rating) E.push(ev({ group: "reputation", source_name: "Google Maps", label: "Rating", value: `${k.rating}★ (${k.reviews_cnt ?? k.reviews ?? "?"} reviews)`, match: Number(k.rating) >= 3.5 ? "match" : "mismatch", source_url: mapsUrl, product: "SERP API" }));
    if (k.phone) phones.push({ phone: k.phone, source: "Google Maps", source_url: mapsUrl });
    set("Google Maps", "match");
  } else {
    E.push(ev({ group: "existence", source_name: "Google Maps", label: "Business listing", value: "Not found", match: "not_found", source_url: null, product: "SERP API" }));
    set("Google Maps", "not_found");
  }

  if (!official) {
    // zero presence: nothing else can be resolved safely — don't scrape a same-named stranger
    for (const s of ["Crunchbase", "Trustpilot", "LinkedIn", "Indeed", "Company website"]) {
      E.push(ev({ group: s === "Trustpilot" ? "reputation" : s === "LinkedIn" || s === "Indeed" ? "activity" : s === "Crunchbase" ? "age" : "existence", source_name: s, label: "Profile", value: "Not found (no official website to anchor the search)", match: "not_found", source_url: null }));
      set(s, "not_found");
    }
    const flag = !k ? "zero_presence" as const : null;
    if (flag) E.push(ev({ group: "existence", source_name: "Web search", label: "Web presence", value: "No website, listing or profile found for this name", match: "not_found", flag, source_url: null, product: "SERP API" }));
    // risk news about the sender domain still runs
    await senderChecks(bd, q, null, E, set);
    return finish();
  }

  const deadline = t0 + (opts.deadlineMs ?? 150_000);
  const within = <T,>(p: Promise<T>, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), Math.max(1000, deadline - Date.now())))]);
  // once the official company is known, look it up by its real name (the bill's spelling may be an impostor's)
  const nameQ = (officialName && officialName.length > 2 ? officialName : q.name || "").replace(/["]/g, "");

  await Promise.all([
    // Trustpilot (reputation) — URL is deterministic from the official domain
    within((async () => {
      const url = `https://www.trustpilot.com/review/${official}`;
      if (opts.skipSlow) { set("Trustpilot", "pending"); return; }
      const r = await bd.dataset("Trustpilot", DS.trustpilot, [{ url }], "", 100_000, "Trustpilot scraper");
      const rows = (r.value ?? []).filter((x: any) => !x.error);
      if (!rows.length) { E.push(ev({ group: "reputation", source_name: "Trustpilot", label: "Rating", value: "Not found", match: "not_found", source_url: url, product: "Web Scraper API" })); set("Trustpilot", "not_found"); return; }
      const top = rows[0];
      const hits = rows.filter((x: any) => /scam|fraud|fake invoice|impersonat|phishing/i.test(`${x.review_title ?? ""} ${x.review_content ?? ""}`));
      const rating = Number(top.company_overall_rating);
      E.push(ev({ group: "reputation", source_name: "Trustpilot", label: "Rating", value: `${rating}★ from ${top.company_total_reviews} reviews`, match: rating >= 3 ? "match" : "mismatch", source_url: url, quote: top.company_rating_name ?? null, product: "Web Scraper API" }));
      if (hits.length) E.push(ev({ group: "reputation", source_name: "Trustpilot", label: "Reviews mentioning scam/fraud/impersonation", value: `${hits.length} of ${rows.length} recent reviews`, match: "mismatch", source_url: hits[0].review_url ?? url, quote: String(hits[0].review_title ?? "").slice(0, 120), product: "Web Scraper API" }));
      set("Trustpilot", "match");
    })(), undefined).then(() => { if (!status["Trustpilot"]) { set("Trustpilot", "pending"); E.push(ev({ group: "reputation", source_name: "Trustpilot", label: "Rating", value: "Still loading", match: "pending", source_url: `https://www.trustpilot.com/review/${official}` })); } }),

    // LinkedIn (activity + age) via Business Search; accept only if anchored to the official domain or linked from its search results
    within((async () => {
      const docs = (await bd.business([nameQ, q.city].filter(Boolean).join(" "), "LinkedIn (Business Search)")).value ?? [];
      const serpLinked = new Set((od.organic ?? []).map((o: any) => String(o.link)).filter((l: string) => l.includes("linkedin.com/company")).map((l: string) => l.replace(/\/$/, "").toLowerCase()));
      const d = docs.find((x: any) => splitDomain(normDomain(x.website)).base === official) ?? docs.find((x: any) => serpLinked.has(String(x.url).replace(/\/$/, "").toLowerCase()))
        ?? docs.find((x: any) => nameSimilar(x.name, nameQ) && q.city && String(x.headquarters_location ?? "").toLowerCase().includes(String(q.city).toLowerCase()));
      if (!d) { E.push(ev({ group: "activity", source_name: "LinkedIn", label: "Company page", value: docs.length ? `Not found (${docs.length} same-name companies didn't match ${official})` : "Not found", match: "not_found", source_url: null, product: "Business Search" })); set("LinkedIn", "not_found"); return; }
      E.push(ev({ group: "activity", source_name: "LinkedIn", label: "Employees on LinkedIn", value: `${d.employees_in_linkedin ?? "?"} employees · HQ ${d.headquarters_location ?? "?"}`, match: Number(d.employees_in_linkedin) > 0 ? "match" : "not_found", source_url: d.url, quote: String(d.about ?? "").slice(0, 140), product: "Business Search" }));
      if (d.founded_year) E.push(ev({ group: "age", source_name: "LinkedIn", label: "Founded", value: String(d.founded_year), match: Number(d.founded_year) <= new Date().getFullYear() - 2 ? "match" : "mismatch", source_url: d.url, product: "Business Search" }));
      set("LinkedIn", "match");
    })(), undefined),

    // Crunchbase (age, existence) — candidate URLs from SERP, accepted only if its website = official domain
    within((async () => {
      if (opts.skipSlow) { set("Crunchbase", "pending"); return; }
      if (opts.crunchbase === false) return; // scraper budget used by Amazon pricing on this bill — Crunchbase not tried
      const s = await bd.serp(`site:crunchbase.com/organization ${nameQ}`, "", "Crunchbase · find profile");
      // one candidate only (scraper budget): the profile is accepted only if its website is the official domain
      const urls = [...new Set((s.value?.organic ?? []).map((o: any) => String(o.link).split("?")[0]).filter((l: string) => /crunchbase\.com\/organization\/[^/]+$/.test(l)))].slice(0, 1) as string[];
      let row: any = null, rejected = 0;
      for (const url of urls) {
        const r = await bd.dataset("Crunchbase", DS.crunchbase, [{ url }], "", 100_000, "Crunchbase scraper");
        const x = (r.value ?? []).find((y: any) => !y.error);
        if (x && splitDomain(normDomain(x.website)).base === official) { row = x; break; }
        if (x) rejected++;
      }
      if (!row) { E.push(ev({ group: "age", source_name: "Crunchbase", label: "Company profile", value: rejected ? `Not found (${rejected} same-name profile${rejected > 1 ? "s" : ""} belong to a different company)` : "Not found", match: "not_found", source_url: urls[0] ?? null, product: "Web Scraper API" })); set("Crunchbase", "not_found"); return; }
      E.push(ev({ group: "existence", source_name: "Crunchbase", label: "Operating status", value: `${row.operating_status ?? "?"} · ${row.num_employees ?? "?"} employees`, match: row.operating_status === "closed" ? "mismatch" : "match", source_url: row.url, quote: String(row.about ?? "").slice(0, 140), product: "Web Scraper API" }));
      if (row.founded_date) E.push(ev({ group: "age", source_name: "Crunchbase", label: "Founded", value: String(row.founded_date), match: "match", source_url: row.url, product: "Web Scraper API" }));
      if (row.contact_phone && /^\+?1|^\(?\d{3}/.test(row.contact_phone)) phones.push({ phone: row.contact_phone, source: "Crunchbase", source_url: row.url });
      set("Crunchbase", "match");
    })(), undefined).then(() => { if (!status["Crunchbase"] && opts.crunchbase !== false) { set("Crunchbase", "pending"); E.push(ev({ group: "age", source_name: "Crunchbase", label: "Company profile", value: "Still loading", match: "pending", source_url: null })); } }),

    // Indeed (activity: hiring) — search only, no scraper job (scraper budget): a company page whose title matches the real name
    within((async () => {
      const s = await bd.serp(`site:indeed.com/cmp ${nameQ}`, "", "Indeed · find page");
      const hit = (s.value?.organic ?? []).find((o: any) => /indeed\.com\/cmp\/[^/]+\/?$/.test(String(o.link).split("?")[0]) && nameSimilar(String(o.title ?? "").split(/[|\-–:]/)[0], nameQ));
      if (!hit) { E.push(ev({ group: "activity", source_name: "Indeed", label: "Company page", value: "Not found", match: "not_found", source_url: null, product: "SERP API" })); set("Indeed", "not_found"); return; }
      E.push(ev({ group: "activity", source_name: "Indeed", label: "Company page (search result)", value: String(hit.title).slice(0, 90), match: "match", source_url: String(hit.link).split("?")[0], quote: String(hit.description ?? "").slice(0, 140), product: "SERP API" }));
      set("Indeed", "match");
    })(), undefined),

    // Official contact (Company website): phones from the official site's own pages (SERP site: snippets + Web Unlocker contact page)
    within((async () => {
      const s = await bd.serp(`site:${official} contact phone`, "", "Company website · contact search");
      const org = (s.value?.organic ?? []).filter((o: any) => splitDomain(normDomain(o.link)).base === official);
      let found = 0;
      for (const o of org.slice(0, 5)) for (const p of phonesIn(`${o.title ?? ""} ${o.description ?? ""}`)) { phones.push({ phone: p, source: "Company website", source_url: o.link }); found++; }
      const contactUrl = org.find((o: any) => /contact|about|support|help/i.test(o.link))?.link ?? `https://${official}/`;
      if (found === 0) {
        const page = await bd.unlock(contactUrl, false, "Company website · contact page");
        for (const p of phonesIn(page.value ?? "").slice(0, 3)) { phones.push({ phone: p, source: "Company website", source_url: contactUrl }); found++; }
      }
      E.push(ev({ group: "existence", source_name: "Company website", label: "Contact phone on official site", value: found ? [...new Set(phones.filter((p) => p.source === "Company website").map((p) => fmtPhone(p.phone)))].slice(0, 2).join(", ") : "Not found", match: found ? "match" : "not_found", source_url: contactUrl, product: found ? "SERP API / Web Unlocker" : "Web Unlocker" }));
      set("Company website", found ? "match" : "not_found");
    })(), undefined),

    // Domain age (Web archive — free public API, not Bright Data)
    within((async () => {
      const w = await wayback(bd, official);
      const yrs = w ? (Date.now() - Date.parse(w.first_seen)) / (365 * 864e5) : 0;
      E.push(ev({ group: "age", source_name: "Web archive", label: "Website first seen", value: w ? `${w.first_seen} (${yrs.toFixed(1)} years)` : "Not found", match: w ? (yrs >= 1 ? "match" : "mismatch") : "not_found", source_url: w?.url ?? `https://web.archive.org/web/*/${official}`, product: "archive.org (not Bright Data)" }));
      set("Web archive", w ? "match" : "not_found");
    })(), undefined),

    // Risk news
    within((async () => {
      const s = await bd.serp(`"${nameQ}" scam OR fraud OR lawsuit OR impersonation OR bankruptcy`, "", "Web search · risk news");
      const hits = (s.value?.organic ?? []).filter((o: any) => RISK_WORDS.test(`${o.title} ${o.description}`) && nameSimilar(o.title, nameQ) || (RISK_WORDS.test(String(o.title)) && String(o.title).toLowerCase().includes(normName(nameQ).split(" ")[0])));
      // brand-impersonation warnings ("beware of fake X invoices") are about impostors, not the vendor — reported but neutral
      const impostor = hits.filter((o: any) => /impersonat|phishing|fake (invoice|email)|pretend|spoof/i.test(`${o.title} ${o.description}`));
      const real = hits.filter((o: any) => !impostor.includes(o));
      E.push(ev({ group: "risk_news", source_name: "Web search", label: "Risk news (scam, fraud, lawsuit, bankruptcy)", value: real.length ? `${real.length} result${real.length > 1 ? "s" : ""}: ${real[0].title}` : "None found", match: real.length >= 2 ? "mismatch" : "not_found", source_url: real[0]?.link ?? null, quote: real[0]?.description?.slice(0, 140) ?? null, product: "SERP API" }));
      if (impostor.length) E.push(ev({ group: "risk_news", source_name: "Web search", label: "Warnings about impostors using this brand", value: `${impostor.length}: ${impostor[0].title}`, match: "n/a", source_url: impostor[0].link, product: "SERP API" }));
    })(), undefined),
  ]);

  await senderChecks(bd, q, official, E, set);
  return finish();

  function finish(): VerifyResult {
    // identity: sender domain vs official
    let look: LookalikeResult | null = null;
    if (q.sender_domain) {
      look = official ? compareDomains(q.sender_domain, official, q.alternates ?? []) : null;
      if (look) {
        const isLook = look.verdict === "lookalike";
        E.push(ev({ group: "identity", source_name: "Identity check", label: "Sender email domain", value: normDomain(q.sender_domain), expected_value: official, match: look.verdict === "same" || look.verdict === "alternate" ? "match" : "mismatch", flag: isLook ? "lookalike_domain" : null, source_url: null, quote: isLook ? `Lookalike (${look.kind}) of ${official}` : look.verdict === "unrelated" ? "Sender domain is unrelated to the vendor's website" : null }));
      }
    }
    if (name_lookalike && officialName) E.push(ev({ group: "identity", source_name: "Identity check", label: "Vendor name on bill", value: q.name, expected_value: officialName, match: "mismatch", flag: "lookalike_domain", source_url: null, quote: `Near-copy of the real company name "${officialName}"` }));
    const official_phone = pickOfficialPhone(phones, q.phone_on_invoice);
    if (q.phone_on_invoice) {
      const bill = normPhone(q.phone_on_invoice);
      const known = phones.some((p) => normPhone(p.phone) === bill);
      E.push(ev({ group: "identity", source_name: "Identity check", label: "Phone on bill", value: fmtPhone(bill), expected_value: official_phone ? fmtPhone(official_phone.phone) : "no verified number", match: known ? "match" : official_phone ? "mismatch" : "not_found", source_url: null }));
    }
    return { official_domain: official, official_name: officialName, domain_confidence: od.confidence, evidence: E, phones, official_phone, lookalike: look, name_lookalike, ms: Date.now() - t0, requests: bd.requests - req0, status };
  }
}

/** Does the sender domain itself have a footprint? (age + any scam reports about that exact domain) */
async function senderChecks(bd: BrightData, q: VendorQuery, official: string | null, E: Ev[], set: (s: string, m: Ev["match"]) => void) {
  const sd = q.sender_domain ? splitDomain(q.sender_domain).base : null;
  if (!sd || sd === official || (q.alternates ?? []).some((a) => splitDomain(a).base === sd)) return;
  const [w, s] = await Promise.all([wayback(bd, sd), bd.serp(`"${sd}"`, "", "Web search · sender domain")]);
  const reports = (s.value?.organic ?? []).filter((o: any) => RISK_WORDS.test(`${o.title} ${o.description}`));
  E.push(ev({ group: "identity", source_name: "Web archive", label: `Sender domain ${sd} first seen`, value: w ? w.first_seen : "Never archived (new or unused domain)", match: w && (Date.now() - Date.parse(w.first_seen)) / 864e5 > 365 ? "match" : "mismatch", source_url: w?.url ?? null, product: "archive.org (not Bright Data)" }));
  if (reports.length) E.push(ev({ group: "risk_news", source_name: "Web search", label: `Scam reports mentioning ${sd}`, value: `${reports.length}: ${reports[0].title}`, match: "mismatch", flag: "impersonation_reports", source_url: reports[0].link, product: "SERP API" }));
}

/** "Grainqer Industrial Supply" vs "Grainger": first word is a 1–2 edit / homoglyph copy of the real brand, but not the same word. */
export function isNameLookalike(billName: string, officialName: string | null): boolean {
  if (!officialName) return false;
  const a = normName(billName).split(" ")[0] ?? "", b = normName(officialName).split(" ")[0] ?? "";
  if (!a || !b || a === b || b.length < 4) return false;
  return levenshtein(a, b) <= 2 || skeleton(a) === skeleton(b);
}

/** archive.org first capture (free public API, not Bright Data) — cached like everything else, one retry (it's flaky). */
async function wayback(bd: BrightData, domain: string) {
  const r = await bd.cached<{ first_seen: string; url: string } | null>("archive.org", domain, async () => {
    const w = (await waybackFirstSeen(domain)) ?? (await waybackFirstSeen(domain));
    return { ok: !!w, value: w };
  });
  return r.value ?? null;
}

export function fmtPhone(p: string) {
  const d = normPhone(p);
  return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}

// ---------------------------------------------------------------- price checker

const SERVICE = /\b(service|services|consult\w*|subscription|license|licen[cs]e|hour|hours|hr|labor|labour|cleaning|janitorial|maintenance|fee|fees|installation|install|support|retainer|saas|plan|seat|seats|month|monthly|annual|repair|design|audit|training)\b/i;

export const isRetail = (d?: string) => !!d && !SERVICE.test(d);

/** Amazon market prices — ONE batched scraper job for every uncached retail line (scraper budget), cached per item. */
export async function priceCheck(bd: BrightData, items: { description: string; qty?: number; unit_price?: number; total?: number }[]) {
  type Row = { description: string; unit_price: number; market_median: number | null; ratio: number | null; n: number; source_url: string | null; skipped?: string; samples: { name: string; price: number; url: string }[] };
  const out: Row[] = [];
  const todo: { it: any; unit: number; kw: string; input: any }[] = [];
  const num = (x: unknown) => { const n = typeof x === "number" ? x : parseFloat(String(x ?? "").replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : NaN; };
  for (const it of items.slice(0, 4)) {
    // extracted bills often have prices as text ("$49.00") or only a line total — normalise both
    const qty = num(it.qty) > 0 ? num(it.qty) : 1;
    const unit = num(it.unit_price) > 0 ? num(it.unit_price) : num(it.total) > 0 ? num(it.total) / qty : NaN;
    if (!it.description || !isFinite(unit) || unit <= 0) { out.push({ description: it.description, unit_price: unit, market_median: null, ratio: null, n: 0, source_url: null, skipped: "no unit price", samples: [] }); continue; }
    if (!isRetail(it.description)) { out.push({ description: it.description, unit_price: unit, market_median: null, ratio: null, n: 0, source_url: null, skipped: "service, not a retail product", samples: [] }); continue; }
    const kw = it.description.replace(/[^\w\s.\-x]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    todo.push({ it, unit, kw, input: { keyword: kw, url: "https://www.amazon.com", pages_to_search: 1 } });
  }
  const rowsByKw: Record<string, any[]> = {};
  const missing: typeof todo = [];
  for (const t of todo) {
    const hit = await bd.peek<any[]>("Amazon", JSON.stringify([t.input]));
    if (hit) rowsByKw[t.kw] = hit; else missing.push(t);
  }
  for (const t of todo.filter((t) => !missing.includes(t))) bd.note("Amazon scraper", "Web Scraper API", "cache_hit", `Reused market prices for “${t.kw}”`, { rows: rowsByKw[t.kw]?.length });
  if (missing.length) {
    const r = await bd.dataset("Amazon", DS.amazonSearch, missing.map((t) => t.input), "", 75_000, "Amazon scraper");
    for (const t of missing) {
      const mine = (r.value ?? []).filter((x: any) => String(x.keyword ?? x.input?.keyword ?? "") === t.kw);
      rowsByKw[t.kw] = missing.length === 1 && !mine.length ? (r.value ?? []) : mine;
      if (rowsByKw[t.kw]?.length) await bd.store("Amazon", JSON.stringify([t.input]), rowsByKw[t.kw]);
    }
  }
  for (const t of todo) {
    const rows = (rowsByKw[t.kw] ?? []).filter((x: any) => !x.error && Number(x.final_price) > 0 && String(x.sponsored) !== "true").slice(0, 12);
    const prices = rows.map((x: any) => Number(x.final_price)).sort((a: number, b: number) => a - b);
    const med = prices.length ? prices[Math.floor(prices.length / 2)] : null;
    out.push({ description: t.it.description, unit_price: t.unit, market_median: med, ratio: med ? t.unit / med : null, n: prices.length, source_url: `https://www.amazon.com/s?k=${encodeURIComponent(t.kw)}`,
      samples: rows.slice(0, 3).map((x: any) => ({ name: String(x.name).slice(0, 80), price: Number(x.final_price), url: String(x.url).split("/ref=")[0] })) });
  }
  return out;
}
