// FROZEN spec (ShivX lane 96, 2026-09-29): a customer sees the outline, never the model's thinking. Measured leak shapes
// ("Here's a thinking process:", "We need to...") before the first markdown heading are cut; no heading, or no modules
// after it, is rejected (the chain tries the next model).
import { describe, expect, it } from "vitest";
import { acceptOutline } from "../src/lib/accept";

describe("acceptOutline", () => {
  it("keeps a clean outline from its first heading", () => {
    const t = "# Intro to SQL\n\n## Modules\nModule 1: SELECT";
    expect(acceptOutline(t)).toBe(t);
  });
  it("cuts leaked thinking before the first heading", () => {
    expect(acceptOutline("Here's a thinking process:\n1. analyse\n\n# Intro to SQL\nModule 1: SELECT")).toBe(
      "# Intro to SQL\nModule 1: SELECT"
    );
  });
  it("keeps a bold title line that comes before the first heading (measured: prod cut the course title)", () => {
    const t = "**Course Title:** Photography Basics\n\n### Course Description\nModule 1: Light";
    expect(acceptOutline(t)).toBe(t);
  });
  it("does not treat a bold phrase inside a numbered thinking line as the start", () => {
    expect(acceptOutline("Here's a thinking process:\n1.  **Analyze the Request:**\n\n# Title\nModule 1")).toBe("# Title\nModule 1");
  });
  it("rejects an answer with no heading (all thinking)", () => {
    expect(acceptOutline("We need to produce a course outline with modules...")).toBeNull();
  });
  it("rejects a heading with no module content after it", () => {
    expect(acceptOutline("# Intro to SQL\nComing soon.")).toBeNull();
  });
});
