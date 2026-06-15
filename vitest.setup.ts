import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// Only tear down the DOM for tests that opted into the jsdom environment.
// Pure-logic tests run in `node` env (no `document`) and skip this.
afterEach(async () => {
  if (typeof document !== "undefined") {
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  }
});
