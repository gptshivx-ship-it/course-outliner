// FROZEN spec (ShivX lane 96): no-spend LLM path - Groq free tier first, OpenRouter ":free" only as the 429/5xx
// fallback, never a paid model; a double failure throws (the route shows "try again").
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText, FALLBACK_MODEL, fallbackModel } from "../src/lib/llm";

const ok = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
const err = (status: number) => new Response(JSON.stringify({ error: { message: `e${status}` } }), { status });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("llm", () => {
  it("uses Groq when it answers", async () => {
    vi.stubEnv("GROQ_API_KEY", "g");
    const f = vi.fn().mockResolvedValue(ok("hi"));
    vi.stubGlobal("fetch", f);
    expect(await generateText("p")).toBe("hi");
    expect(f.mock.calls[0][0]).toContain("api.groq.com");
  });
  it("falls back to an OpenRouter :free model on a 429", async () => {
    vi.stubEnv("GROQ_API_KEY", "g");
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    const f = vi.fn().mockResolvedValueOnce(err(429)).mockResolvedValueOnce(ok("fallback"));
    vi.stubGlobal("fetch", f);
    expect(await generateText("p")).toBe("fallback");
    expect(f.mock.calls[1][0]).toContain("openrouter.ai");
    expect(JSON.parse(f.mock.calls[1][1].body).model).toBe(FALLBACK_MODEL);
    expect(FALLBACK_MODEL.endsWith(":free")).toBe(true);
  });
  it("does not fall back on a 400 (a bad request is not a capacity problem)", async () => {
    vi.stubEnv("GROQ_API_KEY", "g");
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    const f = vi.fn().mockResolvedValue(err(400));
    vi.stubGlobal("fetch", f);
    await expect(generateText("p")).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("a double failure throws", async () => {
    vi.stubEnv("GROQ_API_KEY", "g");
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(err(503)));
    await expect(generateText("p")).rejects.toThrow();
  });
});

describe("no-spend override", () => {
  it("a non-free override is ignored; a :free override is used", () => {
    vi.stubEnv("OPENROUTER_FREE_MODEL", "openai/gpt-5");
    expect(fallbackModel()).toBe(FALLBACK_MODEL);
    vi.stubEnv("OPENROUTER_FREE_MODEL", "qwen/qwen3.8-27b:free");
    expect(fallbackModel()).toBe("qwen/qwen3.8-27b:free");
  });
});
