import { describe, it, expect } from "vitest";
import { getProjectUrl, getProjectShortUrl } from "./shortUrl";

describe("shortUrl", () => {
  it("getProjectUrl builds the /p/ path", () => {
    expect(getProjectUrl("GSE196830")).toBe("/p/GSE196830");
    expect(getProjectUrl("SRP123456")).toBe("/p/SRP123456");
  });
  it("getProjectShortUrl is an alias for getProjectUrl", () => {
    expect(getProjectShortUrl("E-MTAB-1234")).toBe("/p/E-MTAB-1234");
  });
});
