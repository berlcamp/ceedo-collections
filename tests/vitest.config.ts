import { defineConfig } from "vitest/config";

// This suite shares one Postgres database and, from Task 2 on, one single-row `settings`
// table across every file. File-level parallelism over that shared mutable state is
// flake: membership-gate.test.ts already showed an intermittent failure under full-suite
// concurrency before this was set. Serializing files trades some wall-clock time for a
// suite that means the same thing on every run.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
