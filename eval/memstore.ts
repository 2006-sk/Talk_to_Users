// In-memory Store for running the real crew locally (evals). Mirrors entityStore() in base44/shared/b44.ts.
import type { Store, AgentKey } from "../base44/shared/crew.ts";
import type { LedgerInvoice } from "../base44/shared/core.ts";
let n = 0;
export function memStore(history: LedgerInvoice[] = []) {
  const runs: any[] = [], evidence: any[] = [];
  let patched: Record<string, unknown> = {};
  const store: Store = {
    async startRun(agent: AgentKey) { const id = `r${++n}`; runs.push({ id, agent, status: "running", t0: Date.now() }); return id; },
    async endRun(id, p) { Object.assign(runs.find((r) => r.id === id), { status: p.status ?? "done", ...p, ms: Date.now() - runs.find((r) => r.id === id).t0 }); },
    async addEvidence(e) { const id = `e${++n}`; evidence.push({ id, ...e }); return id; },
    async history() { return history; },
    async patchInvoice(p) { patched = { ...patched, ...p }; },
  };
  return { store, runs, evidence, get patched() { return patched; } };
}
