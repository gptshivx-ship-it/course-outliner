import { buildDeps } from "@/lib/deps";
import { handleWebhook } from "@/lib/entitlement";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Stripe signs the RAW body: read it as text, never re-serialise JSON before verifying.
export async function POST(request: NextRequest) {
  let deps;
  try {
    deps = buildDeps();
  } catch {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  const raw = await request.text();
  const r = await handleWebhook(raw, request.headers.get("stripe-signature"), deps);
  return NextResponse.json(r.body, { status: r.status });
}
