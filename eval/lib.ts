// Local runner helpers: file-backed Bright Data cache (cache/bd/*.json) so evals and the demo reuse responses.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { BrightData, type Cache } from "../base44/shared/bd.ts";
const DIR = new URL("../cache/bd/", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
export class FileCache implements Cache {
  f(k: string) { return DIR + createHash("sha1").update(k).digest("hex").slice(0, 24) + ".json"; }
  async get(k: string) { const f = this.f(k); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined; }
  async set(k: string, v: unknown, day: string) { writeFileSync(this.f(k), JSON.stringify({ k, day, v })); }
}
export function env() {
  const t = readFileSync(new URL("../.env", import.meta.url), "utf8");
  return Object.fromEntries(t.split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
}
export const makeBD = (offline = false) => new BrightData(env().BRIGHTDATA_API_KEY, new FileCache(), { concurrency: 4, maxAgeDays: 30, offline });
