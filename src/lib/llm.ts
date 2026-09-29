// LLM utility - NO SPEND. Groq's FREE tier first (no card on the account); on a capacity answer (429/5xx) ONE retry on
// an OpenRouter ":free" model. Never a paid model. Keys come from env only (this repo is public).
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const PRIMARY_MODEL = "llama-3.3-70b-versatile";
// Verified present on OpenRouter's public model list 2026-09-29. The free list churns, so OPENROUTER_FREE_MODEL may
// override it - but ONLY with a ":free" model: anything else is ignored (the no-spend guarantee).
export const FALLBACK_MODEL = "google/gemma-4-31b-it:free";

export function fallbackModel(): string {
  const o = process.env.OPENROUTER_FREE_MODEL;
  return o && o.endsWith(":free") ? o : FALLBACK_MODEL;
}

async function call(url: string, key: string, model: string, prompt: string, o?: { temperature?: number; maxTokens?: number }) {
  return fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: o?.temperature ?? 0.7,
      max_tokens: o?.maxTokens ?? 2048,
    }),
  });
}

async function text(res: Response): Promise<string> {
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function reason(res: Response): Promise<string> {
  const err = await res.json().catch(() => ({}));
  return err?.error?.message || `HTTP ${res.status}`;
}

export async function generateText(prompt: string, options?: { temperature?: number; maxTokens?: number }): Promise<string> {
  const groq = process.env.GROQ_API_KEY;
  if (!groq) throw new Error("GROQ_API_KEY not set");
  const res = await call(GROQ_API_URL, groq, PRIMARY_MODEL, prompt, options);
  if (res.ok) return text(res);
  const why = await reason(res);
  const capacity = res.status === 429 || res.status >= 500;
  const fallback = process.env.OPENROUTER_API_KEY;
  if (!capacity || !fallback) throw new Error(`Groq: ${why}`);
  const res2 = await call(OPENROUTER_URL, fallback, fallbackModel(), prompt, options);
  if (res2.ok) return text(res2);
  throw new Error(`Groq: ${why}; OpenRouter free: ${await reason(res2)}`);
}
