import { generateText, LlmBusy } from "@/lib/llm";
import { buildDeps, ipSalt, NotConfigured } from "@/lib/deps";
import { checkPro, consumeFree, peekFree } from "@/lib/entitlement";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let deps;
  try {
    deps = buildDeps();
  } catch (e) {
    const msg = e instanceof NotConfigured ? "Service is being configured - please try again later." : "Service unavailable.";
    return NextResponse.json({ error: msg }, { status: 503 });
  }

  const { topic, audience, level, duration, format } = await request.json();
  if (!topic) return NextResponse.json({ error: "Topic is required" }, { status: 400 });

  const pro = await checkPro(request.headers.get("authorization"), deps);
  let remaining: number | null = null;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!pro.pro) {
    if (pro.reason === "kv_unavailable") {
      return NextResponse.json({ error: "Service busy - please try again shortly." }, { status: 503 });
    }
    const free = await peekFree(ip, ipSalt(), deps);
    if (!free.allowed) {
      if (free.reason === "kv_unavailable") {
        return NextResponse.json({ error: "Service busy - please try again shortly." }, { status: 503 });
      }
      return NextResponse.json(
        {
          error: "limit",
          message: "Daily limit reached. Upgrade for unlimited!",
          licence_problem: pro.reason === "no_licence" ? undefined : pro.reason,
        },
        { status: 429 }
      );
    }
    remaining = free.remaining;
  }

  const prompt = `You are an expert instructional designer and course creator. Create a comprehensive course outline.

COURSE DETAILS:
- Topic: ${topic}
- Target Audience: ${audience || "general learners"}
- Skill Level: ${level || "beginner to intermediate"}
- Desired Duration: ${duration || "6-8 weeks"}
- Format: ${format || "self-paced online course"}

CREATE A STRUCTURED COURSE OUTLINE WITH:
1. COURSE TITLE & SUBTITLE
2. COURSE DESCRIPTION (2-3 sentences)
3. LEARNING OUTCOMES (5-7 specific outcomes)
4. MODULES (5-8 modules) each with module title, description, 3-5 lessons with key topics and duration, and a project/assignment
5. PRICING STRATEGY with suggested price range and tier suggestions
6. BONUS CONTENT SUGGESTIONS (3 ideas)

Format clearly with headers and markdown.`;

  try {
    const text = await generateText(prompt);
    if (!pro.pro) remaining = (await consumeFree(ip, ipSalt(), deps)).remaining; // count only a success
    return NextResponse.json({ outline: text, remaining, pro: pro.pro });
  } catch (err) {
    console.error("Generation error:", err);
    if (err instanceof LlmBusy) {
      // The free AI capacity is spent or saturated right now: say so plainly (no free use was counted).
      return NextResponse.json({ error: "The AI service is busy right now - please try again in a few minutes.", busy: true }, { status: 503 });
    }
    return NextResponse.json({ error: "Failed to generate. Try again." }, { status: 500 });
  }
}
