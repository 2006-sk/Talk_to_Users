// Run the 10 seeded demo bills through the real crew locally (memory store, cached Bright Data, scripted call outcomes).
import { makeBD } from "./lib.ts";
import { memStore } from "./memstore.ts";
import { runCrewCore } from "../base44/shared/crew.ts";
import { DEMO_BILLS, DEMO_VENDORS, DEMO_HISTORY, DEMO_COMPANY } from "../base44/shared/demo.ts";
import { normDomain, nameSimilar, splitDomain } from "../base44/shared/core.ts";
const bd = makeBD(process.argv.includes("--offline"));
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const OUT: Record<string, string> = { denies: "denied", denies_bank: "denied", confirms: "confirmed" };
const hist: any[] = DEMO_HISTORY.map((h, i) => ({ id: `h${i}`, vendor_name: h.vendor, ...h }));
for (const b of DEMO_BILLS.filter((b) => !only.length || only.includes(b.key))) {
  const sd = splitDomain(normDomain(b.bill.sender_email)).base;
  const v = DEMO_VENDORS.find((x) => x.official_domain === sd) ?? DEMO_VENDORS.find((x) => nameSimilar(x.name, b.bill.vendor_name_on_invoice));
  const m = memStore([...hist]);
  const t = Date.now();
  let res = await runCrewCore({ ...b.bill, sender_domain: normDomain(b.bill.sender_email) }, v ? { ...v, id: v.name } : null, bd, m.store, { policy: { approval_threshold: DEMO_COMPANY.approval_threshold, always_call_on_bank_change: true } });
  let outcome = "";
  if (res.call.call) { outcome = OUT[b.persona ?? "confirms"]; res = await runCrewCore({ ...b.bill, sender_domain: normDomain(b.bill.sender_email) }, v ? { ...v, id: v.name } : null, bd, memStore([...hist]).store, { policy: { approval_threshold: 5000, always_call_on_bank_change: true }, call_outcome: outcome as any, call_attempts: 1 }); }
  hist.push({ id: b.key, vendor_name: b.bill.vendor_name_on_invoice, ...b.bill });
  console.log(`\n#${b.seq} ${b.key}: ${res.route.status} / ${res.route.decision}  (expect ${b.expect.decision}, call ${b.expect.call}) — trust ${res.judgement.trust_score} ${res.judgement.coverage} ${res.risk}; call=${res.call.call}${res.call.needed && !res.call.call ? " (needed: " + res.call.reason + ")" : ""}${outcome ? " → " + outcome : ""}; ${((Date.now() - t) / 1000).toFixed(1)}s`);
  console.log("   issues:", res.issues.map((i) => `${i.code}(${i.severity})`).join(", ") || "none", "| status:", JSON.stringify(res.verify?.status ?? {}));
  console.log("   reason:", res.route.reason, "| phone:", res.official_phone_display);
}
console.log("\nusage", JSON.stringify(bd.usage));
