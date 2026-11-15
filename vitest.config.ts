import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest 4 mis-detects the CPU count inside proot/container launchers
    // ("Projects '' and '' have different maxWorkers") when the worker count is
    // left to auto-detection. A fixed pool keeps `npm test` deterministic.
    maxWorkers: 4,
  },
});
