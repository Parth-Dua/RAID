import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 20000,
    hookTimeout: 20000,
    // Integration/socket test files share one real Postgres database (raid_test) and each
    // truncates it between tests - running files in parallel workers races those truncations
    // against other files' in-flight requests. Correctness over speed for this suite.
    fileParallelism: false,
  },
});
