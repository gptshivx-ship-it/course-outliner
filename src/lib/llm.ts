// LLM utility - NO SPEND. OpenRouter ":free" models are PRIMARY, tried in a fixed order; Groq's free tier is the last
// resort, only when GROQ_API_KEY exists. Never a paid model. Keys come from env only (this repo is public).
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
// Each verified present, answering, and CLEAN on the apps' real prompts 2026-09-29. nvidia/ models are excluded: they
// wrote their reasoning into the answer text even with reasoning.exclude. The free list churns, so OPENROUTER_FREE_MODEL
// may put one model first - but ONLY a ":free" model: anything else is ignored (the no-spend guarantee).
export const FREE_MODELS = ["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free"];

// Every model is at capacity, or the account's daily free cap is spent: the service is busy, not broken.
export class LlmBusy extends Error {}

export function modelChain(): string[] {
  const o = process.env.OPENROUTER_FREE_MODEL;
  return o && o.endsWith(":free") ? [o, ...FREE_MODELS.filter((m) => m !== o)] : [...FREE_MODELS];
}

// accept: the caller's output check - the cleaned text, or null to reject the answer and try the next model.
type Opts = { temperature?: number; maxTokens?: number; accept?: (text: string) => string | null };

async function call(url: string, key: string, model: string, prompt: string, o?: Opts) {
  return fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: o?.temperature ?? 0.7,
      max_tokens: o?.maxTokens ?? 2048,
      // Reasoning models (nemotron) otherwise put their thinking in the answer text - a customer must never see it.
      ...(url === OPENROUTER_URL ? { reasoning: { exclude: true } } : {}),
    }),
  });
}

async function reason(res: Response): Promise<string> {
  const err = await res.json().catch(() => ({}));
  return err?.error?.message || `HTTP ${res.status}`;
}

// One attempt: the text, or why not. `capacity` = another model may still answer; `cap` = the account itself is spent.
async function attempt(url: string, key: string, model: string, prompt: string, o?: Opts) {
  const res = await call(url, key, model, prompt, o);
  if (res.ok) {
    const data = await res.json().catch(() => ({}));
    const text: string = data?.choices?.[0]?.message?.content || "";
    if (!text) return { why: `${model}: empty completion`, capacity: true, cap: false };
    const kept = o?.accept ? o.accept(text) : text;
    return kept ? { text: kept } : { why: `${model}: answer failed the output check`, capacity: true, cap: false };
  }
  const why = await reason(res);
  const cap = res.status === 429 && /per-day|per day/i.test(why);
  return { why: `${model}: ${why}`, capacity: res.status === 429 || res.status >= 500, cap };
}

export async function generateText(prompt: string, options?: Opts): Promise<string> {
  const or = process.env.OPENROUTER_API_KEY;
  const groq = process.env.GROQ_API_KEY;
  if (!or && !groq) throw new Error("OPENROUTER_API_KEY not set");
  const whys: string[] = [];
  let capped = false;
  if (or) {
    for (const m of modelChain()) {
      const r = await attempt(OPENROUTER_URL, or, m, prompt, options);
      if (r.text) return r.text;
      whys.push(r.why!);
      if (r.cap) {
        capped = true;
        break;
      }
      if (!r.capacity) throw new Error(whys.join("; "));
    }
  }
  if (groq) {
    const r = await attempt(GROQ_API_URL, groq, GROQ_MODEL, prompt, options);
    if (r.text) return r.text;
    whys.push(`groq ${r.why}`);
    if (!r.capacity) throw new Error(whys.join("; "));
  }
  if (capped || whys.length) throw new LlmBusy(whys.join("; "));
  throw new Error("no model answered");
}
