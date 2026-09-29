import { generateText, LlmBusy } from "@/lib/llm";
import { NextRequest, NextResponse } from "next/server";

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const FREE_LIMIT = 3;
const WINDOW_MS = 24 * 60 * 60 * 1000;

function checkRate(ip: string) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) { rateLimitMap.set(ip, { count: 0, resetAt: now + WINDOW_MS }); return { count: 0, limited: false }; }
  return { count: entry.count, limited: entry.count >= FREE_LIMIT };
}
function increment(ip: string) { const entry = rateLimitMap.get(ip); if (entry) entry.count++; }

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { limited, count } = checkRate(ip);
  if (limited) return NextResponse.json({ error: "limit", message: "Daily limit reached. Upgrade for unlimited!" }, { status: 429 });

  const { topic, audience, level, duration, format } = await request.json();
  if (!topic) return NextResponse.json({ error: "Topic is required" }, { status: 400 });

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
    increment(ip);
    return NextResponse.json({ outline: text, remaining: FREE_LIMIT - count - 1 });
  } catch (err) {
    console.error("Generation error:", err);
    if (err instanceof LlmBusy) {
      return NextResponse.json({ error: "The AI service is busy right now - please try again in a few minutes.", busy: true }, { status: 503 });
    }
    return NextResponse.json({ error: "Failed to generate. Try again." }, { status: 500 });
  }
}
