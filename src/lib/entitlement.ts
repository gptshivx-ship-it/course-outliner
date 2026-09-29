// Pro entitlement (shared by BioForge = one-time, CourseForge = subscription): server-side Stripe Checkout -> signature-verified webhook -> HMAC licence in durable KV.
// Every secret comes from the environment. This repository is PUBLIC: never commit a key, a webhook secret or a
// licence secret. Design: shivx-core docs/ops/DIGITAL_CCEO_RELAUNCH_DESIGN_2026-09-30.md
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// ---- KV ------------------------------------------------------------------------------------------------------------

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
}

export function memoryKV(): KV {
  const m = new Map<string, string>();
  return {
    async get(k) {
      return m.has(k) ? (m.get(k) as string) : null;
    },
    async set(k, v) {
      m.set(k, v);
    },
    async incr(k) {
      const n = Number(m.get(k) ?? "0") + 1;
      m.set(k, String(n));
      return n;
    },
    async expire() {},
  };
}

export function upstashKV(): KV {
  // Loaded lazily so tests never need the package's network client.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Redis } = require("@upstash/redis");
  const r = Redis.fromEnv();
  return {
    async get(k) {
      const v = await r.get(k);
      return v == null ? null : typeof v === "string" ? v : JSON.stringify(v);
    },
    async set(k, v) {
      await r.set(k, v);
    },
    async incr(k) {
      return Number(await r.incr(k));
    },
    async expire(k, s) {
      await r.expire(k, s);
    },
  };
}

// ---- deps ----------------------------------------------------------------------------------------------------------

export interface Deps {
  stripe: any; // the official `stripe` client (or a test fake with the same surface)
  kv: KV;
  webhookSecret: string;
  licenceSecret: string;
  product: string; // "bioforge_pro" | "courseforge_pro"
  priceId: string;
  mode?: "payment" | "subscription"; // default "payment"
  freeLimit?: number; // free generations per hashed IP per day; default FREE_LIMIT
  now: () => number;
  newId: () => string;
}

export interface Result {
  status: number;
  body: any;
  debugParams?: unknown; // never returned to a client by the routes
}

// ---- licence -------------------------------------------------------------------------------------------------------

export interface LicencePayload {
  lid: string;
  product: string;
  iat?: number;
}

const sign = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest("base64url");

export function mintLicence(p: LicencePayload, secret: string, iat: number): string {
  const payload = Buffer.from(JSON.stringify({ lid: p.lid, product: p.product, iat })).toString("base64url");
  return `SX1.${payload}.${sign(`SX1.${payload}`, secret)}`;
}

export function verifyLicence(token: string, secret: string): { ok: boolean; payload?: LicencePayload; reason: string } {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "SX1") return { ok: false, reason: "malformed" };
  const want = Buffer.from(sign(`SX1.${parts[1]}`, secret));
  const got = Buffer.from(parts[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "bad_signature" };
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof payload?.lid !== "string" || typeof payload?.product !== "string") return { ok: false, reason: "malformed" };
    return { ok: true, payload, reason: "" };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

// ---- webhook -------------------------------------------------------------------------------------------------------

export async function handleWebhook(raw: string, sig: string | null, d: Deps): Promise<Result> {
  let event: any;
  try {
    event = d.stripe.webhooks.constructEvent(raw, sig ?? "", d.webhookSecret);
  } catch {
    return { status: 400, body: { error: "invalid signature" } };
  }
  try {
    if (await d.kv.get(`evt:${event.id}`)) return { status: 200, body: { ok: true, duplicate: true } };
    const obj = event?.data?.object ?? {};
    if (event.type === "checkout.session.completed") {
      if (obj.payment_status === "paid" && obj?.metadata?.shivx_product === d.product && !(await d.kv.get(`sess:${obj.id}`))) {
        const lid = d.newId();
        const token = mintLicence({ lid, product: d.product }, d.licenceSecret, Math.floor(d.now() / 1000));
        await d.kv.set(`lic:${lid}`, JSON.stringify({ status: "active", product: d.product, session: obj.id, token }));
        await d.kv.set(`sess:${obj.id}`, lid);
        if (obj.payment_intent) await d.kv.set(`pi:${obj.payment_intent}`, lid);
        if (obj.subscription) await d.kv.set(`sub:${obj.subscription}`, lid);
      }
    } else if (event.type === "customer.subscription.deleted" || event.type === "customer.subscription.updated") {
      // The subscription's own status drives access: active/trialing = Pro; anything else (canceled, unpaid,
      // past_due, incomplete_expired, deleted) = revoked. Re-activation restores it.
      const lid = obj.id ? await d.kv.get(`sub:${obj.id}`) : null;
      if (lid) {
        const live = event.type === "customer.subscription.updated" && ["active", "trialing"].includes(obj.status);
        const rec = JSON.parse((await d.kv.get(`lic:${lid}`)) ?? "{}");
        await d.kv.set(
          `lic:${lid}`,
          JSON.stringify({ ...rec, status: live ? "active" : "revoked", revoked_reason: live ? undefined : `subscription_${obj.status ?? "deleted"}` })
        );
      }
    } else if (event.type === "charge.refunded") {
      const lid = obj.payment_intent ? await d.kv.get(`pi:${obj.payment_intent}`) : null;
      if (lid) {
        const rec = JSON.parse((await d.kv.get(`lic:${lid}`)) ?? "{}");
        await d.kv.set(`lic:${lid}`, JSON.stringify({ ...rec, status: "revoked", revoked_reason: "refunded" }));
      }
    }
    await d.kv.set(`evt:${event.id}`, "1");
    return { status: 200, body: { ok: true } };
  } catch {
    // Not acknowledged: Stripe retries the event, so nothing is lost while KV is down.
    return { status: 503, body: { error: "kv_unavailable" } };
  }
}

// ---- licence delivery after checkout -------------------------------------------------------------------------------

export async function getLicenceForSession(sessionId: string, d: Deps): Promise<Result> {
  let s: any;
  try {
    s = await d.stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return { status: 404, body: { error: "unknown session" } };
  }
  if (s?.metadata?.shivx_product !== d.product) return { status: 404, body: { error: "unknown session" } };
  if (s.payment_status !== "paid") return { status: 402, body: { error: "not paid" } };
  try {
    const lid = await d.kv.get(`sess:${sessionId}`);
    if (!lid) return { status: 202, body: { pending: true, message: "payment received; licence is being issued - retry in a few seconds" } };
    const rec = JSON.parse((await d.kv.get(`lic:${lid}`)) ?? "{}");
    if (rec.status !== "active") return { status: 403, body: { error: `licence ${rec.status ?? "missing"}` } };
    return { status: 200, body: { licence: rec.token } };
  } catch {
    return { status: 503, body: { error: "kv_unavailable" } };
  }
}

// ---- pro check (fail CLOSED) ---------------------------------------------------------------------------------------

export async function checkPro(authorization: string | null, d: Deps): Promise<{ pro: boolean; reason: string }> {
  const m = /^Licence\s+(\S+)$/.exec(authorization ?? "");
  if (!m) return { pro: false, reason: "no_licence" };
  const v = verifyLicence(m[1], d.licenceSecret);
  if (!v.ok || v.payload?.product !== d.product) return { pro: false, reason: `invalid_licence:${v.reason || "product"}` };
  try {
    const rec = JSON.parse((await d.kv.get(`lic:${v.payload.lid}`)) ?? "{}");
    if (rec.status === "active" && rec.product === d.product) return { pro: true, reason: "" };
    return { pro: false, reason: `licence_${rec.status ?? "unknown"}` };
  } catch {
    return { pro: false, reason: "kv_unavailable" };
  }
}

// ---- free tier (durable; the key is a salted hash, never the raw IP) -----------------------------------------------

export const FREE_LIMIT = 5;

export function ipKey(ip: string, salt: string, product: string, nowMs: number): string {
  const day = new Date(nowMs).toISOString().slice(0, 10).replace(/-/g, "");
  const h = createHash("sha256").update(`${salt}:${ip}`).digest("hex");
  return `rl:${product}:${h}:${day}`;
}

export async function consumeFree(ip: string, salt: string, d: Deps): Promise<{ allowed: boolean; remaining: number; reason: string }> {
  const key = ipKey(ip, salt, d.product, d.now());
  try {
    const n = await d.kv.incr(key);
    if (n === 1) await d.kv.expire(key, 36 * 3600);
    const limit = d.freeLimit ?? FREE_LIMIT;
    if (n > limit) return { allowed: false, remaining: 0, reason: "daily_limit" };
    return { allowed: true, remaining: limit - n, reason: "" };
  } catch {
    return { allowed: false, remaining: 0, reason: "kv_unavailable" };
  }
}

// ---- checkout ------------------------------------------------------------------------------------------------------

export async function createCheckout(origin: string, d: Deps): Promise<Result> {
  const mode = d.mode ?? "payment";
  const params = {
    mode,
    line_items: [{ price: d.priceId, quantity: 1 }],
    success_url: `${origin}/pro?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/`,
    metadata: { shivx_product: d.product },
    ...(mode === "subscription"
      ? { subscription_data: { metadata: { shivx_product: d.product } } }
      : { payment_intent_data: { metadata: { shivx_product: d.product } } }),
  };
  try {
    const s = await d.stripe.checkout.sessions.create(params);
    if (!s?.url) return { status: 502, body: { error: "Stripe returned no checkout URL" }, debugParams: params };
    return { status: 200, body: { url: s.url }, debugParams: params };
  } catch (e: any) {
    return { status: 502, body: { error: `Stripe refused: ${String(e?.message ?? "unknown").slice(0, 200)}` }, debugParams: params };
  }
}
