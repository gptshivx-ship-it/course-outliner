// Per-day usage counters in the shared KV, read by ShivX's hourly notifier (never by a customer request).
// Key = m:<product>:<UTC YYYY-MM-DD>:<name>. Best-effort telemetry: a KV failure must never fail or slow a request.
import type { KV } from "./entitlement";

export const METRICS = ["gen", "busy", "checkout"] as const;
export type Metric = (typeof METRICS)[number];

const TTL_SECONDS = 45 * 86400;

export function metricKey(product: string, name: Metric, nowMs: number): string {
  return `m:${product}:${new Date(nowMs).toISOString().slice(0, 10)}:${name}`;
}

export async function bumpMetric(kv: KV, product: string, name: Metric, nowMs: number): Promise<void> {
  if (!METRICS.includes(name)) return;
  try {
    const key = metricKey(product, name, nowMs);
    const n = await kv.incr(key);
    if (n === 1) await kv.expire(key, TTL_SECONDS);
  } catch {
    // telemetry only: swallow
  }
}
