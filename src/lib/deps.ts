// Builds the entitlement deps from the ENVIRONMENT only (Vercel env vars). Nothing secret lives in this repo.
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { upstashKV, type Deps } from "./entitlement";

const REQUIRED = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "LICENSE_SIGNING_SECRET",
  "COURSEFORGE_PRICE_ID",
  "IP_HASH_SALT",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

export class NotConfigured extends Error {}

export function missingConfig(): string[] {
  return REQUIRED.filter((k) => !process.env[k]);
}

export function buildDeps(): Deps {
  const missing = missingConfig();
  if (missing.length) throw new NotConfigured(`missing env: ${missing.join(", ")}`);
  return {
    stripe: new Stripe(process.env.STRIPE_SECRET_KEY as string),
    kv: upstashKV(),
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET as string,
    licenceSecret: process.env.LICENSE_SIGNING_SECRET as string,
    product: "courseforge_pro",
    mode: "subscription",
    freeLimit: 3,
    priceId: process.env.COURSEFORGE_PRICE_ID as string,
    now: () => Date.now(),
    newId: () => randomUUID(),
  };
}

export const ipSalt = () => process.env.IP_HASH_SALT as string;
