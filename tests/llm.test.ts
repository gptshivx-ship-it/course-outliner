// FROZEN spec (ShivX lane 96, rev 2026-09-29 - lead 84: the operator's apps key is OpenRouter, Groq wanted a deposit):
// no-spend LLM path. OpenRouter ":free" models are PRIMARY, tried in a fixed order; an upstream capacity answer
// (429 from the shared provider pool / any 5xx) moves to the next model, anything else stops. The ACCOUNT's own
// daily free cap is not an upstream blip - it stops the chain and surfaces as LlmBusy (the route says "busy, try
// later"). Groq is the LAST resort and only when GROQ_API_KEY exists. Never a paid model.
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText, FREE_MODELS, modelChain, LlmBusy } from "../src/lib/llm";

const ok = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
const err = (status: number, message = `e${status}`) =>
  new Response(JSON.stringify({ error: { message, code: status } }), { status });
const upstream429 = () => err(429, "Provider returned error"); // shared-pool limit: another model may still answer
const dailyCap = () => err(429, "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day");
const model = (f: ReturnType<typeof vi.fn>, i: number) => JSON.parse(f.mock.calls[i][1].body).model;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("llm", () => {
  it("every model in the chain is a :free model", () => {
    expect(FREE_MODELS.length).toBeGreaterThanOrEqual(2);
    for (const m of FREE_MODELS) expect(m.endsWith(":free")).toBe(true);
  });
  it("the chain holds no nvidia/ model (measured 2026-09-29: they write their reasoning into the answer text)", () => {
    for (const m of FREE_MODELS) expect(m.startsWith("nvidia/")).toBe(false);
  });
  it("an answer the caller's check rejects moves to the next model; the check's cleaned text is returned", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    const f = vi.fn().mockResolvedValueOnce(ok("Here's a thinking process: ...")).mockResolvedValueOnce(ok("intro OPTION 1: a"));
    vi.stubGlobal("fetch", f);
    const accept = (t: string) => (t.includes("OPTION 1") ? t.slice(t.indexOf("OPTION 1")) : null);
    expect(await generateText("p", { accept })).toBe("OPTION 1: a");
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("every answer rejected by the check is busy, not a crash", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ok("thinking...")));
    await expect(generateText("p", { accept: () => null })).rejects.toBeInstanceOf(LlmBusy);
  });
  it("uses the first OpenRouter :free model when it answers", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    const f = vi.fn().mockResolvedValue(ok("hi"));
    vi.stubGlobal("fetch", f);
    expect(await generateText("p")).toBe("hi");
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toContain("openrouter.ai");
    expect(model(f, 0)).toBe(FREE_MODELS[0]);
  });
  it("OpenRouter calls exclude the model's reasoning from the answer; the Groq call does not send the field", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    vi.stubEnv("GROQ_API_KEY", "g");
    const f = vi.fn().mockImplementation(async (url: string) => (url.includes("groq") ? ok("groq") : upstream429()));
    vi.stubGlobal("fetch", f);
    await generateText("p");
    for (const c of f.mock.calls) {
      const body = JSON.parse(c[1].body);
      if (String(c[0]).includes("openrouter.ai")) expect(body.reasoning).toEqual({ exclude: true });
      else expect(body.reasoning).toBeUndefined();
    }
  });
  it("an upstream 429 or a 5xx moves to the next :free model", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    for (const first of [upstream429, () => err(502)]) {
      const f = vi.fn().mockResolvedValueOnce(first()).mockResolvedValueOnce(ok("second"));
      vi.stubGlobal("fetch", f);
      expect(await generateText("p")).toBe("second");
      expect([model(f, 0), model(f, 1)]).toEqual(FREE_MODELS.slice(0, 2));
    }
  });
  it("the account's daily free cap stops the chain and throws LlmBusy", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    const f = vi.fn().mockResolvedValue(dailyCap());
    vi.stubGlobal("fetch", f);
    await expect(generateText("p")).rejects.toBeInstanceOf(LlmBusy);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("every model at capacity throws LlmBusy (a busy service, not a broken one)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => upstream429()));
    await expect(generateText("p")).rejects.toBeInstanceOf(LlmBusy);
  });
  it("a 400/401 stops at once and is NOT reported as busy (the reason is kept)", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    const f = vi.fn().mockResolvedValue(err(401, "User not found."));
    vi.stubGlobal("fetch", f);
    const e = await generateText("p").catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(LlmBusy);
    expect(String(e.message)).toContain("User not found.");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("Groq is the last resort, only when its key exists", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    vi.stubEnv("GROQ_API_KEY", "g");
    const f = vi.fn().mockImplementation(async (url: string) => (url.includes("groq") ? ok("groq") : upstream429()));
    vi.stubGlobal("fetch", f);
    expect(await generateText("p")).toBe("groq");
    expect(f.mock.calls.at(-1)![0]).toContain("api.groq.com");
    expect(f).toHaveBeenCalledTimes(FREE_MODELS.length + 1);
  });
  it("no key at all is a configuration error, not busy", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn());
    const e = await generateText("p").catch((x) => x);
    expect(e).not.toBeInstanceOf(LlmBusy);
    expect(String(e.message)).toMatch(/not set/);
  });
  it("an empty completion is not a success", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ok("")));
    await expect(generateText("p")).rejects.toThrow();
  });
});

describe("no-spend override", () => {
  it("a :free override goes first; a non-free override is ignored", () => {
    vi.stubEnv("OPENROUTER_FREE_MODEL", "openai/gpt-5");
    expect(modelChain()).toEqual(FREE_MODELS);
    vi.stubEnv("OPENROUTER_FREE_MODEL", "qwen/qwen3.8-27b:free");
    expect(modelChain()[0]).toBe("qwen/qwen3.8-27b:free");
    for (const m of modelChain()) expect(m.endsWith(":free")).toBe(true);
  });
});
