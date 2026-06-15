import { describe, it, expect } from "vitest";
import {
  shellEscapeSingleQuotes,
  buildCurlCommand,
  buildSupplementaryDownloadScript,
} from "./downloadScript";

describe("shellEscapeSingleQuotes", () => {
  it("wraps a plain value in single quotes", () => {
    expect(shellEscapeSingleQuotes("http://x/f.gz")).toBe("'http://x/f.gz'");
  });
  it("escapes embedded single quotes", () => {
    expect(shellEscapeSingleQuotes("a'b")).toBe("'a'\"'\"'b'");
  });
});

describe("buildCurlCommand", () => {
  it("builds a single-file curl command", () => {
    expect(buildCurlCommand("http://x/f.gz")).toBe("curl -O 'http://x/f.gz'");
  });
});

describe("buildSupplementaryDownloadScript", () => {
  it("returns empty string for no items", () => {
    expect(buildSupplementaryDownloadScript([])).toBe("");
  });
  it("builds a resumable multi-file curl command", () => {
    expect(
      buildSupplementaryDownloadScript([
        { browserDownloadUrl: "http://a/1" },
        { browserDownloadUrl: "http://b/2" },
      ]),
    ).toBe(
      "curl -L -C - --retry 10 --retry-delay 5 --retry-all-errors --fail -O 'http://a/1' -O 'http://b/2'",
    );
  });
});
