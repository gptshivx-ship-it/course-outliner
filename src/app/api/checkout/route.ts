import { buildDeps } from "@/lib/deps";
import { createCheckout } from "@/lib/entitlement";
import { bumpMetric } from "@/lib/metrics";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let deps;
  try {
    deps = buildDeps();
  } catch {
    return NextResponse.json({ error: "Checkout is being configured - please try again later." }, { status: 503 });
  }
  const r = await createCheckout(request.nextUrl.origin, deps);
  if (r.status === 200) await bumpMetric(deps.kv, deps.product, "checkout", deps.now());
  return NextResponse.json(r.body, { status: r.status });
}
