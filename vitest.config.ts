import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // Several tests shell out to `npm pack` or the staging script against the real
    // repository, and one swaps the package version in place. Running files one at a
    // time keeps them from tripping over each other.
    fileParallelism: false,
    testTimeout: 120_000,
  },
});
