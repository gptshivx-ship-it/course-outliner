// Shared LLM utility — Groq API (OpenAI-compatible)
// Copy this file into each product's src/lib/llm.ts

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export async function generateText(
  prompt: string,
  options?: { temperature?: number; maxTokens?: number; model?: string }
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options?.model || "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2048,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq API error: ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}
