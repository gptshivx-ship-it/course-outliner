// FROZEN spec (ShivX lane 96, 2026-09-30, lead 84 + operator): per-day usage counters in the shared KV, read by ShivX's
// hourly notifier (scripts/cceo_usage_notify.py). Key = m:<product>:<UTC YYYY-MM-DD>:<name>, name in gen | busy | checkout.
// Counters are best-effort telemetry: a KV failure must never fail or slow a customer request (never throws).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bumpMetric, metricKey, METRICS } from "../src/lib/metrics";
import { memoryKV, type KV } from "../src/lib/entitlement";

const T = Date.UTC(2026, 8, 30, 23, 59, 59); // 2026-09-30 23:59:59 UTC
const src = (rel: string) => readFileSync(join(__dirname, "..", rel), "utf8");

describe("metrics", () => {
  it("names are exactly gen, busy, checkout", () => {
    expect([...METRICS].sort()).toEqual(["busy", "checkout", "gen"]);
  });
  it("the key is per product, per UTC day, per name", () => {
    expect(metricKey("courseforge_pro", "gen", T)).toBe("m:courseforge_pro:2026-09-30:gen");
    expect(metricKey("courseforge_pro", "gen", T + 2000)).toBe("m:courseforge_pro:2026-10-01:gen");
  });
  it("bumpMetric increments, and sets a 45-day expiry only when the counter is created", async () => {
    const kv = memoryKV();
    const expires: [string, number][] = [];
    const spy: KV = { ...kv, expire: async (k, s) => void expires.push([k, s]) };
    await bumpMetric(spy, "courseforge_pro", "gen", T);
    await bumpMetric(spy, "courseforge_pro", "gen", T);
    await bumpMetric(spy, "bioforge_pro", "busy", T);
    expect(await kv.get("m:courseforge_pro:2026-09-30:gen")).toBe("2");
    expect(await kv.get("m:bioforge_pro:2026-09-30:busy")).toBe("1");
    expect(expires.filter(([k]) => k === "m:courseforge_pro:2026-09-30:gen")).toEqual([
      ["m:courseforge_pro:2026-09-30:gen", 45 * 86400],
    ]);
  });
  it("never throws when the KV fails", async () => {
    const dead: KV = {
      get: async () => { throw new Error("x"); },
      set: async () => { throw new Error("x"); },
      incr: async () => { throw new Error("upstash down"); },
      expire: async () => { throw new Error("x"); },
    };
    await expect(bumpMetric(dead, "courseforge_pro", "gen", T)).resolves.toBeUndefined();
  });
  it("an unknown metric name is ignored (no stray keys)", async () => {
    const kv = memoryKV();
    await bumpMetric(kv, "courseforge_pro", "evil:name" as never, T);
    expect(await kv.get("m:courseforge_pro:2026-09-30:evil:name")).toBeNull();
  });
});

describe("routes count what they should", () => {
  it("generate counts gen on success and busy on LlmBusy", () => {
    const s = src("src/app/api/generate/route.ts");
    expect(s).toMatch(/bumpMetric\([^)]*"gen"/);
    expect(s).toMatch(/bumpMetric\([^)]*"busy"/);
    // gen is counted only after a successful generation, busy only inside the LlmBusy branch
    expect(s.indexOf('"gen"')).toBeGreaterThan(s.indexOf("await generateText"));
    expect(s.indexOf('"busy"')).toBeGreaterThan(s.indexOf("instanceof LlmBusy"));
  });
  it("checkout counts checkout when a session URL was created", () => {
    expect(src("src/app/api/checkout/route.ts")).toMatch(/bumpMetric\([^)]*"checkout"/);
  });
});
