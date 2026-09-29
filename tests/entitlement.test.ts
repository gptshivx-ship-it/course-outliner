// FROZEN spec (ShivX lane 96, lead 84 approved design 2026-09-29): CourseForge Pro entitlement (subscription).
// Design: shivx-core docs/ops/DIGITAL_CCEO_RELAUNCH_DESIGN_2026-09-30.md
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkPro,
  consumeFree,
  createCheckout,
  getLicenceForSession,
  handleWebhook,
  ipKey,
  memoryKV,
  mintLicence,
  verifyLicence,
  type Deps,
  type KV,
} from "../src/lib/entitlement";

const SECRET = "test-licence-secret-0123456789";
const PRODUCT = "courseforge_pro";

function fakeStripe(sessions: Record<string, any> = {}) {
  return {
    webhooks: {
      constructEvent(raw: string, sig: string, _secret: string) {
        if (sig !== "good-signature") throw new Error("No signatures found matching the expected signature");
        return JSON.parse(raw);
      },
    },
    checkout: {
      sessions: {
        async retrieve(id: string) {
          if (!sessions[id]) throw new Error("No such checkout.session");
          return sessions[id];
        },
        async create(params: any) {
          return { id: "cs_test_new", url: "https://checkout.stripe.com/c/pay/cs_test_new", params };
        },
      },
    },
  };
}

function deps(over: Partial<Deps> = {}): Deps {
  let n = 0;
  return {
    stripe: fakeStripe() as any,
    kv: memoryKV(),
    webhookSecret: "test-webhook-signing-secret",
    licenceSecret: SECRET,
    product: PRODUCT,
    priceId: "price_test_1",
    mode: "subscription",
    now: () => 1_790_700_000_000,
    newId: () => `lid${++n}`,
    ...over,
  };
}

const paidEvent = (id = "evt_1", session = "cs_1", pi = "pi_1", status = "paid", product = PRODUCT) =>
  JSON.stringify({
    id,
    type: "checkout.session.completed",
    data: { object: { id: session, payment_status: status, payment_intent: pi, metadata: { shivx_product: product } } },
  });

describe("licence token", () => {
  it("round-trips and carries no email or name", () => {
    const t = mintLicence({ lid: "abc", product: PRODUCT }, SECRET, 1);
    expect(t.startsWith("SX1.")).toBe(true);
    const v = verifyLicence(t, SECRET);
    expect(v.ok).toBe(true);
    expect(JSON.stringify(v.payload)).not.toMatch(/@|email|name/i);
  });
  it("refuses a tampered or foreign-signed token", () => {
    const t = mintLicence({ lid: "abc", product: PRODUCT }, SECRET, 1);
    const [a, p, s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ lid: "zzz", product: PRODUCT, iat: 1 })).toString("base64url");
    expect(verifyLicence(`${a}.${forged}.${s}`, SECRET).ok).toBe(false);
    expect(verifyLicence(t, "another-secret-000000000000").ok).toBe(false);
    expect(verifyLicence("garbage", SECRET).ok).toBe(false);
  });
});

describe("webhook", () => {
  it("a bad signature is 400 and mints nothing", async () => {
    const d = deps();
    const r = await handleWebhook(paidEvent(), "bad", d);
    expect(r.status).toBe(400);
    expect(await d.kv.get("sess:cs_1")).toBeNull();
  });
  it("a paid session mints exactly one licence, even when the event is replayed", async () => {
    const d = deps();
    expect((await handleWebhook(paidEvent(), "good-signature", d)).status).toBe(200);
    expect((await handleWebhook(paidEvent(), "good-signature", d)).status).toBe(200);
    const lid = await d.kv.get("sess:cs_1");
    expect(lid).toBe("lid1");
    expect(await d.kv.get("lic:lid2")).toBeNull();
  });
  it("an unpaid session or another product mints nothing", async () => {
    const d = deps();
    await handleWebhook(paidEvent("evt_2", "cs_2", "pi_2", "unpaid"), "good-signature", d);
    await handleWebhook(paidEvent("evt_3", "cs_3", "pi_3", "paid", "bioforge_pro"), "good-signature", d);
    expect(await d.kv.get("sess:cs_2")).toBeNull();
    expect(await d.kv.get("sess:cs_3")).toBeNull();
  });
  it("a refund revokes the licence", async () => {
    const d = deps();
    await handleWebhook(paidEvent(), "good-signature", d);
    const token = JSON.parse((await d.kv.get("lic:lid1"))!).token;
    expect((await checkPro(`Licence ${token}`, d)).pro).toBe(true);
    const refund = JSON.stringify({ id: "evt_r", type: "charge.refunded", data: { object: { payment_intent: "pi_1" } } });
    expect((await handleWebhook(refund, "good-signature", d)).status).toBe(200);
    const c = await checkPro(`Licence ${token}`, d);
    expect(c.pro).toBe(false);
    expect(c.reason).toMatch(/revoked/);
  });
});

describe("licence delivery", () => {
  it("is pending (202) until the webhook has minted it, then returns the token", async () => {
    const d = deps({
      stripe: fakeStripe({ cs_1: { id: "cs_1", payment_status: "paid", metadata: { shivx_product: PRODUCT } } }) as any,
    });
    expect((await getLicenceForSession("cs_1", d)).status).toBe(202);
    await handleWebhook(paidEvent(), "good-signature", d);
    const r = await getLicenceForSession("cs_1", d);
    expect(r.status).toBe(200);
    expect(verifyLicence(r.body.licence, SECRET).ok).toBe(true);
  });
  it("an unpaid or unknown session gets no licence", async () => {
    const d = deps({ stripe: fakeStripe({ cs_9: { id: "cs_9", payment_status: "unpaid", metadata: { shivx_product: PRODUCT } } }) as any });
    expect((await getLicenceForSession("cs_9", d)).status).toBe(402);
    expect((await getLicenceForSession("cs_missing", d)).status).toBe(404);
  });
});

describe("pro check and free tier", () => {
  it("fails CLOSED when KV is unavailable, with the reason", async () => {
    const d = deps();
    await handleWebhook(paidEvent(), "good-signature", d);
    const token = JSON.parse((await d.kv.get("lic:lid1"))!).token;
    const broken: KV = {
      get: async () => {
        throw new Error("ECONNREFUSED");
      },
      set: async () => {
        throw new Error("ECONNREFUSED");
      },
      incr: async () => {
        throw new Error("ECONNREFUSED");
      },
      expire: async () => {
        throw new Error("ECONNREFUSED");
      },
    };
    const c = await checkPro(`Licence ${token}`, { ...d, kv: broken });
    expect(c.pro).toBe(false);
    expect(c.reason).toMatch(/kv_unavailable/);
    const f = await consumeFree("203.0.113.9", "salt-xyz", { ...d, kv: broken });
    expect(f.allowed).toBe(false);
    expect(f.reason).toMatch(/kv_unavailable/);
  });
  it("counts 5 free generations per hashed IP per day; the key holds no raw IP", async () => {
    const d = deps();
    const key = ipKey("203.0.113.9", "salt-xyz", PRODUCT, 1_790_700_000_000);
    expect(key).not.toContain("203.0.113.9");
    expect(key).toMatch(/^rl:courseforge_pro:[0-9a-f]{64}:\d{8}$/);
    for (let i = 0; i < 5; i++) expect((await consumeFree("203.0.113.9", "salt-xyz", d)).allowed).toBe(true);
    const sixth = await consumeFree("203.0.113.9", "salt-xyz", d);
    expect(sixth.allowed).toBe(false);
    expect(sixth.remaining).toBe(0);
  });
  it("no licence header = not pro", async () => {
    expect((await checkPro(null, deps())).pro).toBe(false);
  });
});

describe("checkout", () => {
  it("creates a server-side session for our price, tagged with the product, success URL carrying the session id", async () => {
    const d = deps();
    const r = await createCheckout("https://bioforge.example", d);
    expect(r.status).toBe(200);
    expect(r.body.url).toContain("checkout.stripe.com");
    const sent = JSON.stringify(r.debugParams);
    expect(sent).toContain("price_test_1");
    expect(sent).toContain("{CHECKOUT_SESSION_ID}");
    expect(sent).toContain(PRODUCT);
  });
});

describe("repository hygiene (the repo is PUBLIC)", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(join(__dirname, "..", "src"));
  it("no secret-looking value in src/", () => {
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/(sk|rk)_(live|test)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}|gsk_[A-Za-z0-9]{10,}/);
    }
  });
  it("the page no longer carries a static payment link", () => {
    const page = readFileSync(join(__dirname, "..", "src", "app", "page.tsx"), "utf8");
    expect(page).not.toMatch(/buy\.stripe\.com/);
  });
});

describe("subscription lifecycle", () => {
  const completed = JSON.stringify({
    id: "evt_s1",
    type: "checkout.session.completed",
    data: { object: { id: "cs_s1", payment_status: "paid", subscription: "sub_1", metadata: { shivx_product: PRODUCT } } },
  });
  const upd = (id: string, status: string, type = "customer.subscription.updated") =>
    JSON.stringify({ id, type, data: { object: { id: "sub_1", status } } });

  it("checkout is a subscription session", async () => {
    const r = await createCheckout("https://courseforge.example", deps());
    expect(JSON.stringify(r.debugParams)).toContain('"mode":"subscription"');
    expect(JSON.stringify(r.debugParams)).toContain("subscription_data");
  });
  it("a lapsed or deleted subscription revokes Pro; re-activation restores it", async () => {
    const d = deps();
    await handleWebhook(completed, "good-signature", d);
    const token = JSON.parse((await d.kv.get(`lic:${await d.kv.get("sess:cs_s1")}`))!).token;
    const auth = `Licence ${token}`;
    expect((await checkPro(auth, d)).pro).toBe(true);
    await handleWebhook(upd("evt_s2", "past_due"), "good-signature", d);
    expect((await checkPro(auth, d)).pro).toBe(false);
    await handleWebhook(upd("evt_s3", "active"), "good-signature", d);
    expect((await checkPro(auth, d)).pro).toBe(true);
    await handleWebhook(upd("evt_s4", "canceled", "customer.subscription.deleted"), "good-signature", d);
    const c = await checkPro(auth, d);
    expect(c.pro).toBe(false);
    expect(c.reason).toMatch(/revoked/);
  });
});

describe("honest Pro card (claims must be built)", () => {
  const page = readFileSync(join(__dirname, "..", "src", "app", "page.tsx"), "utf8");
  it("lists no unbuilt feature and no unearned badge", () => {
    for (const claim of [/Curriculum advisor/i, /Slide deck/i, /worksheet/i, /Market research report/i, /Best Value/i]) {
      expect(page).not.toMatch(claim);
    }
  });
  it("no static or TEST-mode payment link remains", () => {
    expect(page).not.toMatch(/buy\.stripe\.com/);
  });
});

describe("CourseForge free tier", () => {
  it("honours its own 3/day limit", async () => {
    const d = { ...deps(), freeLimit: 3 };
    for (let i = 0; i < 3; i++) expect((await consumeFree("198.51.100.7", "salt", d)).allowed).toBe(true);
    expect((await consumeFree("198.51.100.7", "salt", d)).allowed).toBe(false);
  });
});

describe("two apps sharing one KV (one Upstash database, both webhook endpoints get every event)", () => {
  it("an event the OTHER product's endpoint already processed still mints here", async () => {
    const kv = memoryKV();
    const other = (PRODUCT as string) === "bioforge_pro" ? "courseforge_pro" : "bioforge_pro";
    const mine = deps({ kv });
    const theirs = deps({ kv, product: other });
    const ev = paidEvent("evt_shared", "cs_shared", "pi_shared", "paid", PRODUCT);
    expect((await handleWebhook(ev, "good-signature", theirs)).status).toBe(200); // other app sees it first: skips
    expect((await handleWebhook(ev, "good-signature", mine)).status).toBe(200);
    expect(await kv.get("sess:cs_shared")).not.toBeNull();
  });
});

describe("public identity (operator rule 2026-09-29)", () => {
  const page = readFileSync(join(__dirname, "..", "src", "app", "page.tsx"), "utf8");
  it("names ShivX Labs, the SHIVX LABS statement descriptor and the public support address, never the personal one", () => {
    expect(page).toMatch(/ShivX Labs/);
    expect(page).toMatch(/SHIVX LABS/);
    expect(page).toMatch(/gptshivx@gmail\.com/);
    expect(page).not.toMatch(/ojayshah/i);
  });
});

describe("fair free tier: a failed generation must not spend a free use", () => {
  it("peekFree checks the limit without consuming; only consumeFree counts", async () => {
    const d = deps();
    const { peekFree } = await import("../src/lib/entitlement");
    for (let i = 0; i < 10; i++) expect((await peekFree("198.51.100.9", "salt", d)).allowed).toBe(true);
    const limit = d.freeLimit ?? 5;
    for (let i = 0; i < limit; i++) await consumeFree("198.51.100.9", "salt", d);
    const p = await peekFree("198.51.100.9", "salt", d);
    expect(p.allowed).toBe(false);
    expect(p.reason).toBe("daily_limit");
  });
  it("peekFree fails closed when KV is down", async () => {
    const { peekFree } = await import("../src/lib/entitlement");
    const broken = { ...memoryKV(), get: async () => { throw new Error("down"); } };
    const p = await peekFree("198.51.100.9", "salt", deps({ kv: broken as any }));
    expect(p.allowed).toBe(false);
    expect(p.reason).toBe("kv_unavailable");
  });
  it("the generate route only counts a free use AFTER a successful generation", () => {
    const route = readFileSync(join(__dirname, "..", "src", "app", "api", "generate", "route.ts"), "utf8");
    expect(route).toMatch(/peekFree\(/);
    expect(route.indexOf("consumeFree(")).toBeGreaterThan(route.indexOf("generateText("));
  });
});
