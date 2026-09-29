import { buildDeps } from "@/lib/deps";
import { getLicenceForSession } from "@/lib/entitlement";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id") ?? "";
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return NextResponse.json({ error: "invalid session id" }, { status: 400 });
  }
  let deps;
  try {
    deps = buildDeps();
  } catch {
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }
  const r = await getLicenceForSession(sessionId, deps);
  return NextResponse.json(r.body, { status: r.status });
}
