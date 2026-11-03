import { describe, expect, it } from "vitest";
import { buildHash, parseHash } from "./lib/route";

describe("dashboard routing", () => {
  it("round trips a page and focus", () => {
    const hash = buildHash({ page: "services", focus: "service:demo:web" });
    expect(parseHash(hash)).toEqual({ page: "services", focus: "service:demo:web" });
  });
});
